import type { NoteSong } from './core';

// The notebook only sees these host capabilities; Folium and platform objects stay in the adapter.
export interface NoteImportAccount {
    source: string;
    id: string;
    name: string;
}

export interface NoteImportPlaylist {
    id: string;
    source: string;
    accountId: string;
    name: string;
    trackCount?: number;
}

export interface MusicNotesPort {
    currentSong(): NoteSong | null;
    currentTime(): number;
    subscribe(listener: () => void): () => void;
    play(song: NoteSong): Promise<boolean>;
    seek(song: NoteSong, seconds: number): void;
    accounts(): NoteImportAccount[];
    playlists(source: string, signal?: AbortSignal): Promise<NoteImportPlaylist[]>;
    readPlaylist(playlist: NoteImportPlaylist, signal?: AbortSignal): Promise<NoteSong[]>;
}
