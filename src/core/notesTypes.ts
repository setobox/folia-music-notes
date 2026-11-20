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

export interface MusicNotesRepository {
    list(): Promise<MusicNote[]>;
    get(identity: SongIdentity): Promise<MusicNote | undefined>;
    importSongs(songs: readonly NoteSong[]): Promise<NotesImportResult>;
    /** null means the editor opened a song which was not saved yet. */
    save(song: NoteSong, draft: NoteDraft, expectedRevision: number | null): Promise<MusicNote>;
    remove(identity: SongIdentity, expectedRevision: number): Promise<void>;
    exportBackup(): Promise<string>;
    /** Add missing records only: local records always win, even if the backup is newer. */
    importBackup(json: string): Promise<NotesImportResult>;
    close(): void;
}
