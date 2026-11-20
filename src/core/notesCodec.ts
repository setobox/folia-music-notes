import { NOTES_LIMITS, NotesCapacityError, NotesValidationError, tagKey } from './notesModel';
import { collectTagKeys, orderedKeys } from './notesOrder';
import { notesObject, parseMusicNote } from './notesValidation';
import type { MusicNote } from './notesTypes';

// Versioned, host-independent JSON backup format; no credentials or playback handles are stored.

export const readNotesBackup = (json: string): { notes: MusicNote[]; tagOrder?: string[] } => {
    if (json.length > NOTES_LIMITS.backupCharacters) throw new NotesCapacityError();
    let parsed: unknown;
    try {
        parsed = JSON.parse(json) as unknown;
    } catch {
        throw new NotesValidationError('JSON');
    }
    const backup = notesObject(parsed, 'backup');
    if (backup.format !== 'music-notes' || (backup.version !== 1 && backup.version !== 2)) {
        throw new NotesValidationError('backup version');
    }
    if (!Array.isArray(backup.notes)) throw new NotesValidationError('backup notes');
    if (backup.notes.length > NOTES_LIMITS.records) throw new NotesCapacityError();
    const notes = backup.notes.map((entry: unknown) => parseMusicNote(entry));
    if (new Set(notes.map(entry => entry.key)).size !== notes.length) throw new NotesValidationError('duplicate song');
    if (backup.version === 1) return { notes };
    const tags = [...collectTagKeys(notes)];
    const order: unknown = backup.tagOrder;
    if (!Array.isArray(order) || order.length !== tags.length || new Set(order).size !== tags.length) {
        throw new NotesValidationError('backup tag order');
    }
    const tagOrder = order.map((index: unknown) => {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= tags.length) {
            throw new NotesValidationError('backup tag index');
        }
        return tags[index];
    });
    return { notes, tagOrder };
};

export const decodeNotesBackup = (json: string): MusicNote[] => readNotesBackup(json).notes;

const BACKUP_PREFIX = '{"format":"music-notes","version":2,"notes":[\n';
const BACKUP_TAGS = '\n],"tagOrder":[';
const BACKUP_SUFFIX = ']}';

/** Store notes in display order and encode tag weights by first-seen index to fit legacy-sized libraries. */
const buildNotesBackup = (notes: readonly MusicNote[], collect: boolean, tagOrder: readonly string[] = []): string => {
    if (notes.length > NOTES_LIMITS.records) throw new NotesCapacityError();
    let characters = BACKUP_PREFIX.length + BACKUP_TAGS.length + BACKUP_SUFFIX.length;
    const tags = new Map<string, number>();
    const chunks: string[] = [];
    for (const [index, entry] of notes.entries()) {
        const record = parseMusicNote(entry);
        const chunk = JSON.stringify(record);
        characters += chunk.length + (index > 0 ? 2 : 0);
        for (const tag of record.tags) {
            const key = tagKey(tag);
            if (tags.has(key)) continue;
            const id = tags.size;
            tags.set(key, id);
            characters += String(id).length + Number(id > 0);
        }
        if (characters > NOTES_LIMITS.backupCharacters) throw new NotesCapacityError();
        if (collect) chunks.push(chunk);
    }
    if (!collect) return '';
    const indices = orderedKeys(new Set(tags.keys()), tagOrder).map(key => tags.get(key));
    return BACKUP_PREFIX + chunks.join(',\n') + BACKUP_TAGS + indices.join(',') + BACKUP_SUFFIX;
};

export const assertNotesCapacity = (notes: readonly MusicNote[]): void => {
    buildNotesBackup(notes, false);
};

export const encodeNotesBackup = (notes: readonly MusicNote[], tagOrder?: readonly string[]): string =>
    buildNotesBackup(notes, true, tagOrder);
