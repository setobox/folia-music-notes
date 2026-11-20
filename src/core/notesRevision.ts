import type { Table, Transaction } from 'dexie';
import { NotesValidationError } from './notesModel';
import { notesObject, parseMusicNote } from './notesValidation';

// Persistent, database-wide edit tokens are never reused after deletion or backup restoration.

export const initializeNotesRevision = async (transaction: Transaction): Promise<void> => {
    const existing = await transaction.table<unknown, string>('notes').toArray();
    const value = existing.reduce<number>((highest, record) => Math.max(highest, parseMusicNote(record).revision), 0);
    await transaction.table('metadata').put({ key: 'revision', value });
};

/** Reserve consecutive tokens inside the same read-write transaction as the note writes. */
export const reserveNoteRevisions = async (metadata: Table<unknown, string>, count: number): Promise<number> => {
    const item = notesObject(await metadata.get('revision'), 'revision counter');
    const previous = item.value;
    if (item.key !== 'revision' || typeof previous !== 'number' || !Number.isSafeInteger(previous) || previous < 0
        || !Number.isSafeInteger(count) || count < 1 || previous > Number.MAX_SAFE_INTEGER - count) {
        throw new NotesValidationError('revision counter');
    }
    await metadata.put({ key: 'revision', value: previous + count });
    return previous + 1;
};
