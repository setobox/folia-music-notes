import { NOTES_LIMITS, NotesCapacityError, NotesValidationError } from './notesModel';
import { notesObject, parseMusicNote } from './notesValidation';
import type { MusicNote } from './notesTypes';

// Versioned, host-independent JSON backup format; no credentials or playback handles are stored.

export const decodeNotesBackup = (json: string): MusicNote[] => {
    if (json.length > NOTES_LIMITS.backupCharacters) throw new NotesCapacityError();
    let parsed: unknown;
    try {
        parsed = JSON.parse(json) as unknown;
    } catch {
        throw new NotesValidationError('JSON');
    }
    const backup = notesObject(parsed, 'backup');
    if (backup.format !== 'music-notes' || backup.version !== 1) throw new NotesValidationError('backup version');
    if (!Array.isArray(backup.notes)) throw new NotesValidationError('backup notes');
    if (backup.notes.length > NOTES_LIMITS.records) throw new NotesCapacityError();
    const notes = backup.notes.map((entry: unknown) => parseMusicNote(entry));
    if (new Set(notes.map(entry => entry.key)).size !== notes.length) throw new NotesValidationError('duplicate song');
    return notes;
};

const BACKUP_PREFIX = '{\n  "format": "music-notes",\n  "version": 1,\n  "notes": [\n';
const BACKUP_SUFFIX = '\n  ]\n}';

/** Count the exact exported JSON, including escapes and indentation, stopping before oversized allocation. */
const buildNotesBackup = (notes: readonly MusicNote[], collect: boolean): string => {
    if (notes.length > NOTES_LIMITS.records) throw new NotesCapacityError();
    if (notes.length === 0) return JSON.stringify({ format: 'music-notes', version: 1, notes: [] }, null, 2);
    let characters = BACKUP_PREFIX.length + BACKUP_SUFFIX.length;
    const chunks: string[] = [];
    for (const [index, entry] of notes.entries()) {
        const chunk = JSON.stringify(parseMusicNote(entry), null, 2).split('\n').map(line => `    ${line}`).join('\n');
        characters += chunk.length + (index > 0 ? 2 : 0);
        if (characters > NOTES_LIMITS.backupCharacters) throw new NotesCapacityError();
        if (collect) chunks.push(chunk);
    }
    return collect ? BACKUP_PREFIX + chunks.join(',\n') + BACKUP_SUFFIX : '';
};

export const assertNotesCapacity = (notes: readonly MusicNote[]): void => {
    buildNotesBackup(notes, false);
};

export const encodeNotesBackup = (notes: readonly MusicNote[]): string => buildNotesBackup(notes, true);
