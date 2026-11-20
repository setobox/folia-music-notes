import type { MusicNote, NoteBookmark, NoteDraft, SongIdentity } from './notesTypes';

// Pure identity, query and conflict helpers shared by all music-note hosts.

export const NOTES_LIMITS = Object.freeze({
    identity: 512,
    metadata: 2000,
    tags: 32,
    tag: 64,
    note: 50000,
    bookmarks: 500,
    bookmarkText: 2000,
    positionSeconds: 604800,
    records: 50000,
    backupCharacters: 20000000,
});

export class NotesValidationError extends Error {
    constructor(field: string) {
        super(`Invalid music notes data: ${field}`);
        this.name = 'NotesValidationError';
    }
}

export class NotesConflictError extends Error {
    constructor() {
        super('This music note changed after the editor opened it. Reload before saving.');
        this.name = 'NotesConflictError';
    }
}

export class NotesCapacityError extends Error {
    constructor() {
        super('The music notes library exceeds its backup capacity. Remove records or shorten notes before saving.');
        this.name = 'NotesCapacityError';
    }
}

export const songKey = (identity: SongIdentity): string => JSON.stringify([identity.source, identity.id]);

export const emptyNoteDraft = (): NoteDraft => ({ tags: [], note: '', bookmarks: [] });

// Bookmark identities are scoped to one note, so no browser crypto or global counter is needed.
export const nextBookmarkId = (bookmarks: readonly NoteBookmark[]): string => {
    const existing = new Set(bookmarks.map(bookmark => bookmark.id));
    let suffix = 1;
    while (existing.has(`bookmark-${suffix}`)) suffix += 1;
    return `bookmark-${suffix}`;
};

export const tagKey = (tag: string): string => tag.trim().toLowerCase();
export const splitTagInput = (input: string): string[] => input.split(/[,，、\n]/u);

export const normalizeTags = (tags: readonly string[]): string[] => {
    const seen = new Set<string>();
    return tags.map(tag => tag.trim()).filter(tag => {
        const key = tagKey(tag);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

/** Every search term must occur somewhere in the saved metadata, tags, note or bookmarks. */
export const filterNotes = (notes: readonly MusicNote[], query: string, tag?: string): MusicNote[] => {
    const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
    const selectedTag = tagKey(tag ?? '');
    return notes.filter(entry => {
        if (selectedTag && !entry.tags.some(value => tagKey(value) === selectedTag)) return false;
        const text = [entry.song.title, entry.song.artist, entry.song.album ?? '', entry.note,
            ...entry.tags, ...entry.bookmarks.map(bookmark => bookmark.text)].join('\n').toLowerCase();
        return terms.every(term => text.includes(term));
    });
};

export const assertRevision = (record: MusicNote | undefined, expected: number | null): void => {
    if ((record?.revision ?? null) !== expected) throw new NotesConflictError();
};
