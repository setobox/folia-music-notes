import Dexie, { type Table } from 'dexie';
import { assertNotesCapacity, decodeNotesBackup, encodeNotesBackup } from './notesCodec';
import { NOTES_LIMITS, NotesCapacityError, NotesValidationError, assertRevision, emptyNoteDraft, songKey } from './notesModel';
import { parseMusicNote, parseNoteDraft, parseNoteSong, parseSongIdentity } from './notesValidation';
import { initializeNotesRevision, reserveNoteRevisions } from './notesRevision';
import type { MusicNote, MusicNotesRepository, NotesImportResult } from './notesTypes';

// IndexedDB adapter owns a separate database, independent of the host's disposable playback cache.

export const MUSIC_NOTES_DATABASE_NAME = 'FoliaMusicNotes';

class NotesDatabase extends Dexie {
    notes!: Table<unknown, string>;
    metadata!: Table<unknown, string>;

    constructor(name: string) {
        super(name);
        this.version(1).stores({ notes: 'key' });
        this.version(2).stores({ notes: 'key', metadata: 'key' }).upgrade(initializeNotesRevision);
        this.on('populate', initializeNotesRevision);
    }
}

export interface MusicNotesDatabaseOptions {
    databaseName?: string;
    now?: () => number;
}

/** Create one adapter per host lifetime; callers close it on disposal. No global instance is created. */
export const createMusicNotesRepository = (options: MusicNotesDatabaseOptions = {}): MusicNotesRepository => {
    const database = new NotesDatabase(options.databaseName ?? MUSIC_NOTES_DATABASE_NAME);
    const now = options.now ?? Date.now;
    const read = async (key: string): Promise<MusicNote | undefined> => {
        const value = await database.notes.get(key);
        if (value === undefined) return undefined;
        const record = parseMusicNote(value);
        if (record.key !== key) throw new NotesValidationError('stored key');
        return record;
    };
    const list = async (): Promise<MusicNote[]> => {
        const records = (await database.notes.toArray()).map(parseMusicNote);
        return records.sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key));
    };

    // Validate all records before the transaction so malformed imports never partially change the library.
    const addMissing = async (records: readonly MusicNote[]): Promise<NotesImportResult> => {
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
                assertNotesCapacity([...(await database.notes.toArray()).map(parseMusicNote), ...incoming]);
                await database.notes.bulkAdd(incoming);
            }
            return { added: additions.length, skipped: records.length - additions.length };
        });
    };

    return {
        list,
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
                const unchanged = (await database.notes.toArray()).map(parseMusicNote).filter(entry => entry.key !== key);
                assertNotesCapacity([...unchanged, record]);
                await database.notes.put(record);
                return record;
            });
        },
        async remove(identity, expectedRevision) {
            const key = songKey(parseSongIdentity(identity));
            await database.transaction('rw', database.notes, async () => {
                assertRevision(await read(key), expectedRevision);
                await database.notes.delete(key);
            });
        },
        async exportBackup() {
            return encodeNotesBackup(await list());
        },
        async importBackup(json) {
            return addMissing(decodeNotesBackup(json));
        },
        close: () => database.close(),
    };
};
