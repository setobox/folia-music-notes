import type { FoliumClientApi, FoliumSong } from '../types/folium';
import type { NoteSong } from './core/notesTypes';
import { parseNoteSong } from './core/notesValidation';
import { NotesValidationError, songKey } from './core/notesModel';
import type { MusicNotesPort, PlaybackAttempt } from './hostTypes';
import { assertSupportedHost, currentIdentityOf, NoteImportError } from './foliumCompatibility';
import { createPlaylistPort } from './foliumPlaylistImport';

// Public Folium APIs supply playback, account state and catalog lookups; compatibility reads remain isolated.
export const createFoliumPort = (folium: FoliumClientApi, signal?: AbortSignal): MusicNotesPort => {
    assertSupportedHost(folium);
    const localRefs = new Map<string, FoliumSong>();
    const covers = new Map<string, Promise<string | null>>();
    let playRequest = 0;
    const fromCurrentSong = (song: FoliumSong | null): NoteSong | null => {
        if (!song?.id || !song.source || song.source === 'stage' || song.source === 'navidrome') return null;
        try {
            const id = currentIdentityOf(folium, song);
            if (!id) return null;
            const note = parseNoteSong({ source: song.source === 'local' ? 'local' : `online:${song.source}`,
                id, title: song.title, artist: song.artist, ...(song.album != null ? { album: song.album } : {}) });
            if (note.source === 'local' && song.ref) {
                if (localRefs.size >= 256 && !localRefs.has(id)) localRefs.delete(localRefs.keys().next().value!);
                localRefs.set(id, song);
            }
            return note;
        } catch (error) {
            // A song the portable notebook cannot represent must not unmount an editor or lose its draft.
            if (error instanceof NotesValidationError || error instanceof NoteImportError && error.code === 'incomplete') return null;
            throw error;
        }
    };
    const currentSong = () => fromCurrentSong(folium.playback.getState().song);
    const currentKey = () => {
        const song = currentSong();
        return song && songKey(song);
    };
    const findSong = async (song: NoteSong): Promise<FoliumSong | null> => {
        const current = folium.playback.getState().song;
        const identity = fromCurrentSong(current);
        if (identity && songKey(identity) === songKey(song)) return current;
        if (song.source === 'local') return localRefs.get(song.id) ?? null;
        if (!song.source.startsWith('online:')) return null;
        const source = song.source.slice(7);
        const [result] = await folium.omni.resolveSongs([{ source, id: song.id }]);
        // QQ may return its numeric catalog id for a songmid; play the returned opaque ref.
        return result?.status === 'found' && result.song.source === source ? result.song : null;
    };
    const obsolete = (request: number) => signal?.aborted || request !== playRequest;
    const play = async (song: NoteSong, request: number): Promise<PlaybackAttempt> => {
        const previous = currentKey();
        try {
            const dto = await findSong(song);
            if (obsolete(request) || previous !== currentKey()) return 'superseded';
            if (!dto) return false;
            const started = await folium.playback.playSong(dto);
            return obsolete(request) ? 'superseded' : started;
        } catch (error) {
            if (obsolete(request)) return 'superseded';
            throw error;
        }
    };
    return {
        ...createPlaylistPort(folium),
        currentSong,
        currentTime: () => folium.playback.getState().position,
        playbackState: () => folium.playback.getState().state,
        isPlaying: () => folium.playback.getState().state === 'playing',
        cover(song) {
            if (song.source === 'local') return Promise.resolve(null);
            const key = songKey(song);
            const cached = covers.get(key);
            if (cached) return cached;
            const result = findSong(song).then(dto => dto ? folium.omni.describeSong(dto)?.coverUrl ?? null : null)
                .catch(() => null);
            if (covers.size >= 512) covers.delete(covers.keys().next().value!);
            covers.set(key, result);
            return result;
        },
        subscribe(listener) {
            const dispose = [folium.events.on('playback.songChanged', listener),
                folium.events.on('playback.stateChanged', listener), folium.events.on('account.changed', listener)];
            return () => { dispose.forEach(off => off()); };
        },
        async play(song) {
            const request = ++playRequest;
            const state = folium.playback.getState();
            const current = fromCurrentSong(state.song);
            if (current && songKey(current) === songKey(song)) {
                // Resume the loaded track in place, preserving its position and the open notebook.
                if (state.state === 'paused') { folium.playback.play(); return true; }
                if (state.state === 'playing') return true;
            }
            return play(song, request);
        },
        pause(song) {
            const state = folium.playback.getState();
            const current = fromCurrentSong(state.song);
            if (state.state === 'playing' && current && songKey(current) === songKey(song)) {
                ++playRequest;
                folium.playback.pause();
            }
        },
        async playAt(song, seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) return false;
            const key = songKey(song);
            const previous = currentKey();
            const request = ++playRequest;
            if (previous === key) {
                folium.playback.seek(seconds);
                if (folium.playback.getState().state !== 'playing') folium.playback.play();
                return true;
            }
            const started = await play(song, request);
            if (started !== true) return started;
            // Some transports resolve playSong before the display and audio clock switch tracks.
            const deadline = Date.now() + 5000;
            do {
                if (obsolete(request)) return 'superseded';
                const active = currentKey();
                if (active && active !== key && active !== previous) return false;
                const state = folium.playback.getState();
                if (active === key && state.state === 'playing' && state.duration > 0) {
                    folium.playback.seek(seconds);
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 75));
            } while (Date.now() < deadline);
            return false;
        },
        seek(song, seconds) {
            const current = currentSong();
            if (current && songKey(current) === songKey(song) && Number.isFinite(seconds) && seconds >= 0) {
                folium.playback.seek(seconds);
            }
        },
    };
};
