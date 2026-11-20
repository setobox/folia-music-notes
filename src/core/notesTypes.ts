// Portable music-note contracts; no player, UI framework or storage implementation is required.

export interface SongIdentity {
    source: string;
    id: string;
}

export interface NoteSong extends SongIdentity {
    title: string;
    artist: string;
    album?: string;
}

export interface NoteBookmark {
    id: string;
    positionSeconds: number;
    text: string;
}

export interface NoteDraft {
    tags: string[];
    note: string;
    bookmarks: NoteBookmark[];
}

export interface MusicNote extends NoteDraft {
    key: string;
    song: NoteSong;
    createdAt: number;
    updatedAt: number;
    /** Opaque local edit token; never infer the next value or carry it across repositories. */
    revision: number;
}

export interface NotesImportResult {
    added: number;
    skipped: number;
}

export interface NotesLibrary {
    notes: MusicNote[];
    tagOrder: string[];
}

export interface MusicNotesRepository {
    list(): Promise<MusicNote[]>;
    library(): Promise<NotesLibrary>;
    move(kind: 'note' | 'tag', key: string, target: string, side: 'before' | 'after'): Promise<void>;
    /** Fires on initial observation and whenever a committed edit changes this library. */
    watch(onChange: () => void, onError: (error: unknown) => void): () => void;
    get(identity: SongIdentity): Promise<MusicNote | undefined>;
    importSongs(songs: readonly NoteSong[]): Promise<NotesImportResult>;
    /** null means the editor opened a song which was not saved yet. */
    save(song: NoteSong, draft: NoteDraft, expectedRevision: number | null): Promise<MusicNote>;
    remove(identity: SongIdentity, expectedRevision: number): Promise<void>;
    /** Check all revisions before deleting any selected note. A null revision is a local, unsaved draft. */
    removeMany(entries: readonly { song: SongIdentity; revision: number | null }[]): Promise<void>;
    exportBackup(): Promise<string>;
    /** Add missing records only: local records always win, even if the backup is newer. */
    importBackup(json: string): Promise<NotesImportResult>;
    close(): void;
}
