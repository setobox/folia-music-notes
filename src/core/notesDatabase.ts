import Dexie, { liveQuery, type Table } from 'dexie';
import { assertNotesCapacity, encodeNotesBackup, readNotesBackup } from './notesCodec';
import { NOTES_LIMITS, NotesCapacityError, NotesValidationError, assertRevision, emptyNoteDraft, songKey } from './notesModel';
import { collectTagKeys, legacyLibrary, moveKey, orderedKeys, readNotesOrder, sameKeys } from './notesOrder';
import { parseMusicNote, parseNoteDraft, parseNoteSong, parseSongIdentity } from './notesValidation';
import { initializeNotesRevision, reserveNoteRevisions } from './notesRevision';
import type { MusicNote, MusicNotesRepository, NotesImportResult, NotesLibrary } from './notesTypes';

// IndexedDB adapter owns a separate database, independent of the host's disposable playback cache.

export const MUSIC_NOTES_DATABASE_NAME = 'FoliaMusicNotes';

class NotesDatabase extends Dexie {
    notes!: Table<unknown, string>;
    metadata!: Table<unknown, string>;

    constructor(name: string, locale?: string) {
        super(name);
        this.version(1).stores({ notes: 'key' });
        this.version(2).stores({ notes: 'key', metadata: 'key' }).upgrade(initializeNotesRevision);
        this.version(3).stores({}).upgrade(async transaction => {
            const records = (await transaction.table<unknown, string>('notes').toArray()).map(parseMusicNote);
            const { notes, tagOrder } = legacyLibrary(records, locale);
            await transaction.table('metadata').put({ key: 'order', noteOrder: notes.map(note => note.key), tagOrder });
        });
        this.on('populate', initializeNotesRevision);
        this.on('populate', transaction => transaction.table('metadata').put({ key: 'order', noteOrder: [], tagOrder: [] }));
    }
}

export interface MusicNotesDatabaseOptions {
    databaseName?: string;
    locale?: string;
    now?: () => number;
}

/** Create one adapter per host lifetime; callers close it on disposal. No global instance is created. */
export const createMusicNotesRepository = (options: MusicNotesDatabaseOptions = {}): MusicNotesRepository => {
    const database = new NotesDatabase(options.databaseName ?? MUSIC_NOTES_DATABASE_NAME, options.locale);
    const now = options.now ?? Date.now;
    const read = async (key: string): Promise<MusicNote | undefined> => {
        const value = await database.notes.get(key);
        if (value === undefined) return undefined;
        const record = parseMusicNote(value);
        if (record.key !== key) throw new NotesValidationError('stored key');
        return record;
    };
    const readAll = async () => (await database.notes.toArray()).map(parseMusicNote);
    const readOrder = async () => readNotesOrder(await database.metadata.get('order'));
    const library = (): Promise<NotesLibrary> => database.transaction('r', database.notes, database.metadata, async () => {
        const [records, order] = await Promise.all([readAll(), readOrder()]);
        const byKey = new Map(records.map(record => [record.key, record]));
        return {
            notes: orderedKeys(new Set(byKey.keys()), order.noteOrder).map(key => byKey.get(key)!),
            tagOrder: orderedKeys(collectTagKeys(records), order.tagOrder),
        };
    });

    // Update weights in the same transaction that changes membership, preserving all surviving neighbors.
    const updateOrder = async (records: MusicNote[], addedKeys: string[] = [], importedTags: string[] = []) => {
        const order = await readOrder();
        const noteOrder = orderedKeys(new Set(records.map(note => note.key)), addedKeys.concat(order.noteOrder));
        const tagOrder = orderedKeys(collectTagKeys(records), order.tagOrder.concat(importedTags));
        if (!sameKeys(noteOrder, order.noteOrder) || !sameKeys(tagOrder, order.tagOrder)) {
            await database.metadata.put({ key: 'order', noteOrder, tagOrder });
        }
    };

    // Validate all records before the transaction so malformed imports never partially change the library.
    const addMissing = async (records: readonly MusicNote[], importedTags?: string[]): Promise<NotesImportResult> => {
        const unique = new Map(records.map(record => [record.key, record]));
        return database.transaction('rw', database.notes, database.metadata, async () => {
            const keys = [...unique.keys()];
            const existing = await database.notes.bulkGet(keys);
            const additions = keys.flatMap((key, index) => {
                const previous = existing[index];
                if (previous !== undefined) {
                    parseMusicNote(previous);
                    return [];
                }
                const record = unique.get(key);
                return record ? [record] : [];
            });
            if (await database.notes.count() + additions.length > NOTES_LIMITS.records) {
                throw new NotesCapacityError();
            }
            if (additions.length > 0) {
                const firstRevision = await reserveNoteRevisions(database.metadata, additions.length);
                const incoming = additions.map((record, index) => ({ ...record, revision: firstRevision + index }));
                const all = (await readAll()).concat(incoming);
                assertNotesCapacity(all);
                await database.notes.bulkAdd(incoming);
                await updateOrder(all, incoming.map(record => record.key), importedTags);
            }
            return { added: additions.length, skipped: records.length - additions.length };
        });
    };

    const removeMany: MusicNotesRepository['removeMany'] = async entries => {
        const keys = entries.map(entry => songKey(parseSongIdentity(entry.song)));
        if (!keys.length) return;
        await database.transaction('rw', database.notes, database.metadata, async () => {
            const records = await database.notes.bulkGet(keys);
            records.forEach((value, index) => {
                const record = value === undefined ? undefined : parseMusicNote(value);
                assertRevision(record, entries[index].revision);
            });
            if (records.some(record => record !== undefined)) {
                await database.notes.bulkDelete(keys);
                await updateOrder(await readAll());
            }
        });
    };

    return {
        list: async () => (await library()).notes,
        library,
        async move(kind, key, target, side) {
            if ((kind !== 'note' && kind !== 'tag') || (side !== 'before' && side !== 'after')) return;
            await database.transaction('rw', database.metadata, async () => {
                const order = await readOrder();
                const field = kind === 'note' ? 'noteOrder' : 'tagOrder';
                const next = moveKey(order[field], key, target, side);
                if (next) await database.metadata.put({ key: 'order', ...order, [field]: next });
            });
        },
        watch(onChange, onError) {
            const changes = liveQuery(() => Promise.all([database.metadata.get('revision'),
                database.metadata.get('order'), database.notes.count()]));
            const subscription = changes.subscribe({ next: onChange, error: onError });
            return () => subscription.unsubscribe();
        },
        get: identity => read(songKey(parseSongIdentity(identity))),
        async importSongs(songs) {
            if (songs.length > NOTES_LIMITS.records) throw new NotesCapacityError();
            const timestamp = now();
            const records = songs.map(value => {
                const song = parseNoteSong(value);
                return parseMusicNote({
                    key: songKey(song), song, ...emptyNoteDraft(),
                    createdAt: timestamp, updatedAt: timestamp, revision: 1,
                });
            });
            return addMissing(records);
        },
        async save(songValue, draftValue, expectedRevision) {
            const song = parseNoteSong(songValue);
            const draft = parseNoteDraft(draftValue);
            const key = songKey(song);
            return database.transaction('rw', database.notes, database.metadata, async () => {
                const previous = await read(key);
                assertRevision(previous, expectedRevision);
                if (!previous && await database.notes.count() >= NOTES_LIMITS.records) {
                    throw new NotesCapacityError();
                }
                const timestamp = Math.max(now(), previous?.updatedAt ?? 0);
                const record = parseMusicNote({
                    key, song, ...draft,
                    createdAt: previous?.createdAt ?? timestamp,
                    updatedAt: timestamp,
                    revision: await reserveNoteRevisions(database.metadata, 1),
                });
                const all = (await readAll()).filter(entry => entry.key !== key).concat(record);
                assertNotesCapacity(all);
                await database.notes.put(record);
                if (!previous || !sameKeys(previous.tags, record.tags)) {
                    await updateOrder(all, previous ? [] : [key]);
                }
                return record;
            });
        },
        remove: (song, revision) => removeMany([{ song, revision }]),
        removeMany,
        async exportBackup() {
            const { notes, tagOrder } = await library();
            return encodeNotesBackup(notes, tagOrder);
        },
        async importBackup(json) {
            const backup = readNotesBackup(json);
            const ordered = backup.tagOrder === undefined ? legacyLibrary(backup.notes, options.locale) : backup;
            return addMissing(ordered.notes, ordered.tagOrder);
        },
        close: () => database.close(),
    };
};
