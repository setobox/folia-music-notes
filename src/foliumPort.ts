import type { FoliumClientApi, FoliumSong } from '../types/folium';
import type { NoteSong } from './core/notesTypes';
import { parseNoteSong } from './core/notesValidation';
import { NotesValidationError, songKey } from './core/notesModel';
import type { MusicNotesPort } from './hostTypes';
import { assertSupportedHost, currentIdentityOf, NoteImportError } from './foliumCompatibility';
import { createPlaylistPort } from './foliumPlaylistImport';

// Public Folium APIs supply playback, account state and catalog lookups; compatibility reads remain isolated.
export const createFoliumPort = (folium: FoliumClientApi): MusicNotesPort => {
    assertSupportedHost(folium);
    const fromCurrentSong = (song: FoliumSong | null): NoteSong | null => {
        if (!song?.id || !song.source || song.source === 'stage' || song.source === 'navidrome') return null;
        try {
            const id = currentIdentityOf(folium, song);
            if (!id) return null;
            return parseNoteSong({ source: song.source === 'local' ? 'local' : `online:${song.source}`,
                id, title: song.title, artist: song.artist, ...(song.album != null ? { album: song.album } : {}) });
        } catch (error) {
            // A song the portable notebook cannot represent must not unmount an editor or lose its draft.
            if (error instanceof NotesValidationError || error instanceof NoteImportError && error.code === 'incomplete') return null;
            throw error;
        }
    };
    const currentSong = () => fromCurrentSong(folium.playback.getState().song);
    return {
        ...createPlaylistPort(folium),
        currentSong,
        currentTime: () => folium.playback.getState().position,
        subscribe(listener) {
            const dispose = [folium.events.on('playback.songChanged', listener), folium.events.on('account.changed', listener)];
            return () => { dispose.forEach(off => off()); };
        },
        async play(song) {
            const current = folium.playback.getState().song;
            const identity = fromCurrentSong(current);
            if (current && identity && songKey(identity) === songKey(song)) return folium.playback.playSong(current);
            if (!song.source.startsWith('online:')) return false;
            const source = song.source.slice(7);
            if (!source) return false;
            const result = (await folium.omni.resolveSongs([{ source, id: song.id }])).at(0);
            if (result?.status !== 'found' || result.song.source !== source) return false;
            // resolveSongs answers each requested key in order. Its DTO id need not equal that key
            // (a QQ songmid lookup returns the numeric catalog id); retain the returned opaque ref.
            return folium.playback.playSong(result.song);
        },
        seek(song, seconds) {
            const current = currentSong();
            if (current && songKey(current) === songKey(song) && Number.isFinite(seconds) && seconds >= 0) {
                folium.playback.seek(seconds);
            }
        },
    };
};
