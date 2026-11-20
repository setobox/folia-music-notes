// Public entry point for hosts; pure model/codec files can also be consumed without the Dexie adapter.

export type {
    SongIdentity, NoteSong, NoteBookmark, NoteDraft, MusicNote, MusicNotesRepository, NotesImportResult, NotesLibrary,
} from './notesTypes';
export { NOTES_LIMITS, NotesCapacityError, NotesConflictError, NotesValidationError, emptyNoteDraft, filterNotes, nextBookmarkId, songKey } from './notesModel';
export { decodeNotesBackup, encodeNotesBackup } from './notesCodec';
export { createMusicNotesRepository, MUSIC_NOTES_DATABASE_NAME } from './notesDatabase';
export type { MusicNotesDatabaseOptions } from './notesDatabase';
