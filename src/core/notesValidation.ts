import { NOTES_LIMITS, NotesValidationError, normalizeTags, songKey } from './notesModel';
import type { MusicNote, NoteBookmark, NoteDraft, NoteSong, SongIdentity } from './notesTypes';

// Validate persisted and imported values before they enter the portable domain.

export const notesObject = (value: unknown, field: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new NotesValidationError(field);
    return value as Record<string, unknown>;
};

const text = (value: unknown, field: string, max: number, required = false): string => {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
        throw new NotesValidationError(field);
    }
    return value;
};

const integer = (value: unknown, field: string, minimum = 0): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        throw new NotesValidationError(field);
    }
    return value;
};

export const parseSongIdentity = (value: unknown): SongIdentity => {
    const item = notesObject(value, 'song');
    return {
        source: text(item.source, 'source', NOTES_LIMITS.identity, true),
        id: text(item.id, 'id', NOTES_LIMITS.identity, true),
    };
};

export const parseNoteSong = (value: unknown): NoteSong => {
    const item = notesObject(value, 'song');
    return {
        ...parseSongIdentity(item),
        title: text(item.title, 'title', NOTES_LIMITS.metadata, true),
        artist: text(item.artist, 'artist', NOTES_LIMITS.metadata),
        ...(item.album === undefined ? {} : { album: text(item.album, 'album', NOTES_LIMITS.metadata) }),
    };
};

const parseBookmark = (value: unknown): NoteBookmark => {
    const item = notesObject(value, 'bookmark');
    if (typeof item.positionSeconds !== 'number' || !Number.isFinite(item.positionSeconds)
        || item.positionSeconds < 0 || item.positionSeconds > NOTES_LIMITS.positionSeconds) {
        throw new NotesValidationError('bookmark.positionSeconds');
    }
    return {
        id: text(item.id, 'bookmark.id', NOTES_LIMITS.identity, true),
        positionSeconds: item.positionSeconds,
        text: text(item.text, 'bookmark.text', NOTES_LIMITS.bookmarkText),
    };
};

export const parseNoteDraft = (value: unknown): NoteDraft => {
    const item = notesObject(value, 'draft');
    if (!Array.isArray(item.tags) || item.tags.length > NOTES_LIMITS.tags) throw new NotesValidationError('tags');
    const tags = normalizeTags(item.tags.map((tag: unknown) => text(tag, 'tag', NOTES_LIMITS.tag)));
    if (!Array.isArray(item.bookmarks) || item.bookmarks.length > NOTES_LIMITS.bookmarks) {
        throw new NotesValidationError('bookmarks');
    }
    const bookmarks = item.bookmarks.map((bookmark: unknown) => parseBookmark(bookmark));
    if (new Set(bookmarks.map(bookmark => bookmark.id)).size !== bookmarks.length) {
        throw new NotesValidationError('bookmark.id duplicate');
    }
    return { tags, note: text(item.note, 'note', NOTES_LIMITS.note), bookmarks };
};

export const parseMusicNote = (value: unknown): MusicNote => {
    const item = notesObject(value, 'record');
    const song = parseNoteSong(item.song);
    if (item.key !== songKey(song)) throw new NotesValidationError('record.key');
    const createdAt = integer(item.createdAt, 'createdAt');
    const updatedAt = integer(item.updatedAt, 'updatedAt');
    if (updatedAt < createdAt) throw new NotesValidationError('updatedAt');
    return {
        key: songKey(song), song, ...parseNoteDraft(item), createdAt, updatedAt,
        revision: integer(item.revision, 'revision', 1),
    };
};
