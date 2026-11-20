import type { FoliumClientApi } from '../types/folium';
import type { NoteSong } from './core/notesTypes';
import { songKey } from './core/notesModel';
import type { MusicNotesPort, NoteImportAccount, NoteImportPlaylist } from './hostTypes';
import { idOf, importedSongOf, methodOf, NoteImportError, objectOf, privateLibraryOf } from './foliumCompatibility';

// Private-list reads are bounded and tied to the account that selected the list; persistence happens only after completion.
const PAGE_SIZE = 100;
const MAX_SONGS = 10000;
const countOf = (value: unknown): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new NoteImportError('incomplete');
    return value;
};

export const createPlaylistPort = (folium: FoliumClientApi): Pick<MusicNotesPort, 'accounts' | 'playlists' | 'readPlaylist'> => {
    const collections = new WeakMap<NoteImportPlaylist, Record<string, unknown>>();
    const accounts = (): NoteImportAccount[] => folium.omni.listProviders().flatMap(provider => {
        if (!provider.configured) return [];
        const state = folium.account.getState(provider.providerId);
        if (state?.status !== 'signed-in' || !state.accountKey) return [];
        const capabilities = objectOf(methodOf(privateLibraryOf(folium), 'getProviderCapabilities')(provider.providerId));
        return capabilities.userLibrary === true
            ? [{ source: provider.providerId, id: state.accountKey, name: provider.displayName }] : [];
    });
    const watchAccount = (source: string, accountId: string, signal?: AbortSignal) => {
        let changed = false;
        const stop = folium.events.on('account.changed', event => { if (event.providerId === source) changed = true; });
        return {
            stop,
            assert() {
                signal?.throwIfAborted();
                if (changed || !accounts().some(account => account.source === source && account.id === accountId)) {
                    throw new NoteImportError('account-changed');
                }
            },
        };
    };

    return {
        accounts,
        async playlists(source, signal) {
            signal?.throwIfAborted();
            const account = accounts().find(candidate => candidate.source === source);
            if (!account) throw new NoteImportError('account-unavailable');
            const watch = watchAccount(source, account.id, signal);
            try {
                watch.assert();
                const rows: unknown = await methodOf(privateLibraryOf(folium), 'refreshProviderPlaylists')(source);
                watch.assert();
                if (!Array.isArray(rows)) throw new NoteImportError('incomplete');
                return rows.flatMap((value: unknown): NoteImportPlaylist[] => {
                    const collection = objectOf(value);
                    if (collection.providerId !== source || collection.type !== 'playlist') return [];
                    if (typeof collection.name !== 'string') throw new NoteImportError('incomplete');
                    const playlist: NoteImportPlaylist = { id: idOf(collection.id), source, accountId: account.id,
                        name: collection.name, trackCount: countOf(collection.trackCount) };
                    collections.set(playlist, collection);
                    return [playlist];
                });
            } finally { watch.stop(); }
        },
        async readPlaylist(playlist, signal) {
            signal?.throwIfAborted();
            const collection = collections.get(playlist);
            if (!collection) throw new NoteImportError('incomplete');
            const watch = watchAccount(playlist.source, playlist.accountId, signal);
            const songs = new Map<string, NoteSong>();
            let offset = 0;
            let received = 0;
            let expectedTotal = playlist.trackCount;
            try {
                // A full final page can advertise more; allow its empty termination probe at exactly the limit.
                for (let pageIndex = 0; pageIndex <= MAX_SONGS / PAGE_SIZE; pageIndex += 1) {
                    watch.assert();
                    const response: unknown = await methodOf(privateLibraryOf(folium), 'getCollectionTracks')(
                        collection, { limit: PAGE_SIZE, offset });
                    watch.assert();
                    const page = objectOf(response);
                    if (!Array.isArray(page.items) || typeof page.hasMore !== 'boolean') throw new NoteImportError('incomplete');
                    const reportedTotal = countOf(page.total);
                    if (reportedTotal !== undefined) expectedTotal = Math.max(reportedTotal, expectedTotal ?? 0);
                    received += page.items.length;
                    if (received > MAX_SONGS) throw new NoteImportError('limit');
                    for (const value of page.items) {
                        const song = importedSongOf(value, playlist.source);
                        songs.set(songKey(song), song);
                    }
                    if (!page.hasMore) {
                        if (expectedTotal !== undefined && received < expectedTotal) throw new NoteImportError('incomplete');
                        return [...songs.values()];
                    }
                    const next = countOf(page.nextOffset);
                    if (!page.items.length || next === undefined || next <= offset) throw new NoteImportError('incomplete');
                    offset = next;
                }
                throw new NoteImportError('limit');
            } finally { watch.stop(); }
        },
    };
};
