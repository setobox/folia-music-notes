import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliumClientApi, FoliumSong } from '../types/folium';
import { createFoliumPort } from '../src/foliumPort';
import type { NoteSong } from '../src/core/notesTypes';

// Exercises the installable mod's public SDK boundary and its deliberately narrow compatibility reads.
const rawSong = (id: string, providerId = 'example') => ({
    id,
    name: `Song ${id}`,
    artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' },
    sourceRef: { kind: 'online', providerId, mediaId: id },
});
const dtoSong = (id: string, source: string): FoliumSong => ({
    id, source, title: `Song ${id}`, artist: 'Artist', album: 'Album', ref: `opaque:${source}:${id}`,
});
const noteSong = (id: string, source = 'online:example'): NoteSong => ({
    id, source, title: `Song ${id}`, artist: 'Artist', album: 'Album',
});
const collection = { providerId: 'example', id: 'p1', name: 'Saved songs', type: 'playlist', isLiked: true };
const account = (providerId = 'example') => ({
    providerId, status: 'signed-in', user: { nickname: 'Listener' }, accountKey: `opaque-account:${providerId}`,
});
const provider = (providerId = 'example') => ({ providerId, configured: true, displayName: providerId });

const makeHost = () => {
    const host = {
        host: { folium: { major: 1, minor: 10 }, folia: '0.7.29' },
        env: { context: 'main' },
        playback: {
            getState: vi.fn((): { song: FoliumSong | null; position: number; state?: string; duration?: number } => ({ song: null, position: 12 })),
            playSong: vi.fn().mockResolvedValue(true),
            play: vi.fn(),
            pause: vi.fn(),
            seek: vi.fn(),
        },
        omni: { listProviders: vi.fn(() => [provider()]), resolveSongs: vi.fn() },
        account: { getState: vi.fn(() => account()) },
        events: { on: () => () => undefined },
        internals: {
            omni: {
                getProviderCapabilities: vi.fn(() => ({ userLibrary: true })),
                refreshProviderPlaylists: vi.fn().mockResolvedValue([collection]),
                getCollectionTracks: vi.fn(),
            },
            stores: { playback: { getState: vi.fn() } },
        },
    };
    return { host, sdk: host as unknown as FoliumClientApi };
};
let fixture: ReturnType<typeof makeHost>;
beforeAll(async () => {
    // Load the shipped entry with a different host Dexie already registered in the same page.
    const hostDexie = { semVer: '4.4.6' };
    vi.stubGlobal(Symbol.for('Dexie'), hostDexie);
    try {
        const entry = new URL('../dist/music-notes/client.mjs', import.meta.url).href;
        const client: unknown = await import(/* @vite-ignore */ entry);
        expect(client).toHaveProperty('default', expect.any(Function));
        expect(Reflect.get(globalThis, Symbol.for('Dexie'))).toBe(hostDexie);
    } finally {
        vi.unstubAllGlobals();
    }
});
beforeEach(() => { fixture = makeHost(); });

describe('music notes Folium port playback', () => {
    it('keeps the original QQ songmid identity across current playback, imports, bookmarks and saved-note replay', async () => {
        const mid = '0039MnYb0qxYhV';
        const dto = dtoSong('212877890', 'qq');
        const raw = { ...rawSong(mid, 'qq'), id: 212877890, name: dto.title, qqMid: mid };
        fixture.host.playback.getState.mockReturnValue({ song: dto, position: 12 });
        fixture.host.internals.stores.playback.getState.mockReturnValue({ currentSong: raw });
        fixture.host.omni.listProviders.mockReturnValue([provider('qq')]);
        fixture.host.account.getState.mockReturnValue(account('qq'));
        fixture.host.internals.omni.refreshProviderPlaylists.mockResolvedValue([{ ...collection, providerId: 'qq' }]);
        fixture.host.internals.omni.getCollectionTracks.mockResolvedValue({ items: [raw], hasMore: false });
        const port = createFoliumPort(fixture.sdk);
        const [playlist] = await port.playlists('qq');
        const [imported] = await port.readPlaylist(playlist);
        expect(port.currentSong()).toEqual(imported);
        expect(imported).toMatchObject({ source: 'online:qq', id: mid });
        port.seek(noteSong('other', 'online:qq'), 30);
        port.seek(imported, 45);
        expect(fixture.host.playback.seek).toHaveBeenCalledExactlyOnceWith(45);
        fixture.host.playback.getState.mockReturnValue({ song: null, position: 0 });
        fixture.host.omni.resolveSongs.mockResolvedValue([{ status: 'found', song: dto }]);
        // A fresh activation has no in-memory alias cache; previously saved sourceRef identities still work.
        fixture.host.playback.playSong.mockImplementationOnce(async () => {
            fixture.host.playback.getState.mockReturnValue({ song: dto, position: 0, state: 'playing', duration: 200 });
            return true;
        });
        await expect(createFoliumPort(fixture.sdk).playAt(noteSong(mid, 'online:qq'), 20)).resolves.toBe(true);
        expect(fixture.host.omni.resolveSongs).toHaveBeenCalledExactlyOnceWith([{ source: 'qq', id: mid }]);
        expect(fixture.host.playback.playSong).toHaveBeenCalledExactlyOnceWith(dto);
        expect(fixture.host.playback.seek).toHaveBeenLastCalledWith(20);
        // A different song winning the playback request must never receive the seek.
        fixture.host.playback.getState.mockReturnValue({ song: null, position: 0 });
        fixture.host.playback.playSong.mockImplementationOnce(async () => {
            fixture.host.playback.getState.mockReturnValue({ song: dtoSong('other', 'qq'), position: 0, state: 'playing', duration: 200 });
            fixture.host.internals.stores.playback.getState.mockReturnValue({ currentSong: rawSong('other', 'qq') });
            return true;
        });
        await expect(port.playAt(imported, 80)).resolves.toBe(false);
        expect(fixture.host.playback.seek).toHaveBeenCalledTimes(2);
        const earlier = port.playAt(imported, 45);
        const later = port.play(imported);
        await expect(earlier).resolves.toBe('superseded');
        await expect(later).resolves.toBe(true);
    });

    it('plays a known local file by its host reference and refuses an unresolved file', async () => {
        const dto = dtoSong('-123', 'local');
        fixture.host.playback.getState.mockReturnValue({ song: dto, position: 12, state: 'paused' });
        fixture.host.internals.stores.playback.getState.mockReturnValue({ currentSong: { id: -123, sourceRef: { kind: 'local', mediaId: 'file-uuid' } } });
        const port = createFoliumPort(fixture.sdk);
        expect(port.currentSong()).toMatchObject({ source: 'local', id: 'file-uuid' });
        expect(port.playbackState()).toBe('paused');
        await expect(port.play(noteSong('file-uuid', 'local'))).resolves.toBe(true);
        expect(fixture.host.playback.play).toHaveBeenCalledOnce();
        expect(fixture.host.playback.playSong).not.toHaveBeenCalled();
        fixture.host.playback.getState.mockReturnValue({ song: dto, position: 12, state: 'playing' });
        port.pause(noteSong('different-file', 'local'));
        expect(fixture.host.playback.pause).not.toHaveBeenCalled();
        port.pause(noteSong('file-uuid', 'local'));
        expect(fixture.host.playback.pause).toHaveBeenCalledOnce();
        expect(fixture.host.playback.seek).not.toHaveBeenCalled();
        fixture.host.playback.getState.mockReturnValue({ song: null, position: 0, state: 'stopped' });
        await expect(port.play(noteSong('file-uuid', 'local'))).resolves.toBe(true);
        await expect(port.play(noteSong('different-file', 'local'))).resolves.toBe(false);
        expect(fixture.host.playback.playSong).toHaveBeenCalledExactlyOnceWith(dto);
        expect(fixture.host.omni.resolveSongs).not.toHaveBeenCalled();
    });
});

describe('music notes Folium port imports', () => {
    it('reads every page before returning songs and deduplicates repeated identities', async () => {
        const port = createFoliumPort(fixture.sdk);
        const [playlist] = await port.playlists('example');
        fixture.host.internals.omni.getCollectionTracks
            .mockResolvedValueOnce({ items: [rawSong('1'), rawSong('2')], hasMore: true, nextOffset: 2, total: 4 })
            .mockResolvedValueOnce({ items: [rawSong('2'), rawSong('3')], hasMore: false, nextOffset: 4, total: 4 });
        expect(await port.readPlaylist(playlist)).toEqual([noteSong('1'), noteSong('2'), noteSong('3')]);
        expect(fixture.host.internals.omni.getCollectionTracks).toHaveBeenNthCalledWith(2, collection, { limit: 100, offset: 2 });
    });

    it('rejects a playlist when later pages omit expected tracks', async () => {
        const port = createFoliumPort(fixture.sdk);
        const [playlist] = await port.playlists('example');
        fixture.host.internals.omni.getCollectionTracks
            .mockResolvedValueOnce({ items: [rawSong('1')], hasMore: true, nextOffset: 1, total: 3 })
            .mockResolvedValueOnce({ items: [rawSong('2')], hasMore: false, nextOffset: 2 });
        await expect(port.readPlaylist(playlist)).rejects.toMatchObject({ code: 'incomplete' });
    });

    it('refuses a late track response after sign-out', async () => {
        const port = createFoliumPort(fixture.sdk);
        const [playlist] = await port.playlists('example');
        fixture.host.internals.omni.getCollectionTracks.mockImplementation(() => {
            fixture.host.account.getState.mockReturnValue({ ...account(), status: 'signed-out' });
            return Promise.resolve({ items: [rawSong('1')], hasMore: false });
        });
        await expect(port.readPlaylist(playlist)).rejects.toMatchObject({ code: 'account-changed' });
    });
});
