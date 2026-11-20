// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliumTheme } from '../types/folium';
import type * as MusicNotes from '../src/core';
import type { MusicNotesRepository, NoteSong } from '../src/core/notesTypes';
import type { MusicNotesPort } from '../src/hostTypes';
import { createMusicNotesRepository } from '../src/core/notesDatabase';
import { emptyNoteDraft } from '../src/core/notesModel';
import MusicNotesWindow from '../src/ui/MusicNotesWindow';

// Exercises the real settings kit in a shadow root, with real persistence and only host edges replaced.
const host = vi.hoisted(() => ({
    repository: vi.fn<() => MusicNotesRepository>(),
    readPlaylist: vi.fn<MusicNotesPort['readPlaylist']>(),
    play: vi.fn<MusicNotesPort['play']>(),
    close: vi.fn(),
    translate: (key: string) => key,
    playing: { source: 'online:test', id: 'playing', title: 'Playing song', artist: 'Artist' },
}));
vi.mock('../src/core', async importOriginal => ({
    ...await importOriginal<typeof MusicNotes>(), createMusicNotesRepository: host.repository,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: host.translate }) }));
vi.mock('../src/useReducedMotionFor', () => ({ useReducedMotionFor: () => true }));

const theme: FoliumTheme = { name: 'Test', backgroundColor: '#111111', primaryColor: '#eeeeee', accentColor: '#eeeeee', secondaryColor: '#aaaaaa', fontStyle: 'sans', animationIntensity: 'calm', isDaylight: false };
const port: MusicNotesPort = {
    currentSong: () => host.playing,
    currentTime: () => 12,
    subscribe: () => () => undefined,
    play: host.play,
    seek: vi.fn(),
    accounts: () => [{ source: 'test', id: 'account', name: 'Test account' }],
    playlists: () => Promise.resolve([{ source: 'test', id: 'playlist', accountId: 'account', name: 'Saved playlist' }]),
    readPlaylist: host.readPlaylist,
};
let root: Root;
let container: HTMLDivElement;
let surface: ShadowRoot;
let repository: MusicNotesRepository;
let databaseName: string;

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};
const accessibleLabel = (element: HTMLElement) => element.getAttribute('aria-label')
    ?? element.getAttribute('aria-labelledby')?.split(' ').map(id => surface.querySelector(`[id="${id}"]`)?.textContent).join(' ')
    ?? element.textContent?.trim();
const button = (label: string): HTMLButtonElement => {
    const match = [...surface.querySelectorAll('button')].find(item => accessibleLabel(item) === label || item.textContent?.trim() === label);
    if (!match) throw new Error(`Missing button: ${label}`);
    return match;
};
const click = async (label: string) => { await act(async () => { button(label).click(); }); };
const tagInput = () => surface.querySelector<HTMLInputElement>('input[placeholder="musicNotes.tagPlaceholder"]');
const typeInto = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const enterTag = async (value: string) => {
    const element = tagInput();
    if (!element) throw new Error('Missing tag input');
    await typeInto(element, value);
};
const ready = async () => {
    await act(async () => {
        root.render(createElement(MusicNotesWindow, { port, locale: 'zh-CN', theme, requestId: 1, requestedSong: host.playing, onClose: host.close }));
    });
    await vi.waitFor(() => expect(tagInput()).not.toBeNull());
};

beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host.play.mockResolvedValue(false);
    databaseName = `notes-window-${crypto.randomUUID()}`;
    repository = createMusicNotesRepository({ databaseName });
    await repository.save(host.playing, { ...emptyNoteDraft(), note: 'Original memory' }, null);
    host.repository.mockReturnValue(repository);
    container = document.createElement('div'); document.body.append(container);
    surface = container.attachShadow({ mode: 'open' });
    root = createRoot(surface);
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove(); repository.close(); await Dexie.delete(databaseName);
    vi.restoreAllMocks();
});

describe('music notes mod user flows', () => {
    it('locks mutations during the complete playlist read and preserves drafts across page changes', async () => {
        const read = deferred<NoteSong[]>();
        const imported: NoteSong = { source: 'online:test', id: 'imported', title: 'Imported song', artist: 'Singer' };
        host.readPlaylist.mockReturnValue(read.promise);
        await ready(); await enterTag('pending tag');
        await click('musicNotes.importTab'); await click('Test account'); await click('Saved playlist');
        await click('musicNotes.import');
        expect(host.readPlaylist).toHaveBeenCalledOnce();
        expect(button('musicNotes.play').disabled).toBe(true);
        expect(button('musicNotes.save').disabled).toBe(true);
        await click('musicNotes.play'); await click('musicNotes.save'); await click('musicNotes.close');
        expect(host.play).not.toHaveBeenCalled(); expect(host.close).not.toHaveBeenCalled();
        await act(async () => { read.resolve([imported, host.playing]); });
        await vi.waitFor(async () => expect(await repository.get(imported)).toBeDefined());
        await click('musicNotes.collection');
        expect(surface.textContent).toContain('Imported song');
        expect((await repository.get(host.playing))?.note).toBe('Original memory');
        expect((await repository.get(host.playing))?.tags).toEqual([]);
        expect(tagInput()?.value).toBe('pending tag');
    });

    it('saves typed tags directly and keeps matching songs filtered across case changes', async () => {
        await repository.save({ ...host.playing, id: 'second', title: 'Second song' }, { ...emptyNoteDraft(), tags: ['BASS'] }, null);
        await repository.save({ ...host.playing, id: 'other', title: 'Other song' }, { ...emptyNoteDraft(), tags: ['Jazz'] }, null);
        await ready();
        await enterTag('夜路，bass,BASS'); await click('musicNotes.save');
        await vi.waitFor(async () => expect((await repository.get(host.playing))?.tags).toEqual(['夜路', 'bass']));
        await vi.waitFor(() => expect(button('musicNotes.play').disabled).toBe(false));
        expect(tagInput()?.value).toBe('');
        for (const unchanged of [',，、', ' BASS ']) {
            await enterTag(unchanged);
            expect(button('musicNotes.add').disabled).toBe(true);
            expect(button('musicNotes.save').disabled).toBe(true);
        }

        const collection = surface.querySelector('[data-music-notes="collection"] > section')!;
        const bassFilters = () => [...collection.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')]
            .filter(chip => chip.textContent?.trim().toLowerCase() === 'bass');
        expect(bassFilters()).toHaveLength(1);
        await act(async () => { bassFilters()[0].click(); });
        expect(collection.textContent).not.toContain('Other song');
        await act(async () => { surface.querySelector<HTMLButtonElement>('[data-music-notes="tags"] [data-settings-row="bass"]')!.click(); });
        await click('musicNotes.save');
        await vi.waitFor(async () => expect((await repository.get(host.playing))?.tags).toEqual(['夜路']));
        await vi.waitFor(() => expect(bassFilters()[0].textContent?.trim()).toBe('BASS'));
        expect(bassFilters()[0].getAttribute('aria-checked')).toBe('true');
        expect(collection.textContent).toContain('Second song');
        expect(collection.textContent).not.toContain('Other song');
    });

    it('saves a personal note and a bookmark at the current position', async () => {
        await ready();
        await typeInto(surface.querySelector('textarea')!, 'Worth hearing again');
        await click('musicNotes.bookmark');
        await typeInto(surface.querySelector<HTMLInputElement>('input[placeholder="musicNotes.bookmarkPlaceholder"]')!, 'First chorus');
        await click('musicNotes.save');
        await vi.waitFor(async () => expect(await repository.get(host.playing)).toMatchObject({
            note: 'Worth hearing again', bookmarks: [{ positionSeconds: 12, text: 'First chorus' }],
        }));
    });

    it('keeps the draft after a revision conflict and requires explicit deletion', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await ready(); await enterTag('keep my draft');
        const original = (await repository.get(host.playing))!;
        await repository.save(host.playing, { ...emptyNoteDraft(), note: 'Changed elsewhere' }, original.revision);
        await click('musicNotes.save');
        await vi.waitFor(() => expect(surface.textContent).toContain('musicNotes.conflict'));
        expect((await repository.get(host.playing))?.note).toBe('Changed elsewhere');
        expect(surface.textContent).toContain('keep my draft');
        await click('musicNotes.refresh'); await click('musicNotes.discard');
        await vi.waitFor(() => expect(surface.querySelector('textarea')?.value).toBe('Changed elsewhere'));
        await click('musicNotes.remove'); await click('musicNotes.cancel');
        expect(await repository.get(host.playing)).toBeDefined();
        await click('musicNotes.remove'); await click('musicNotes.confirmRemove');
        await vi.waitFor(async () => expect(await repository.get(host.playing)).toBeUndefined());
        expect(warn).toHaveBeenCalledOnce();
    });

    it('moves settings tabs with arrow keys inside the mod shadow root', async () => {
        await ready(); const collection = button('musicNotes.collection');
        collection.focus(); expect(document.activeElement).toBe(container);
        await act(async () => { collection.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
        expect(button('musicNotes.importTab').getAttribute('aria-selected')).toBe('true');
        expect(surface.activeElement).toBe(button('musicNotes.importTab'));
    });
});
