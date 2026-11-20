// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMusicNotesRepository, emptyNoteDraft, type MusicNotesRepository, type NoteSong } from '../src/core';
import { Notebook } from '../src/notebook';
import type { FoliumTheme } from '../types/folium';
import type { MusicNotesPort } from '../src/hostTypes';
import MusicNotesWindow from '../src/ui/MusicNotesWindow';
import { musicNotesResources } from '../src/locales';

// Drive the page in a shadow root against an isolated copy of the production note database.
const i18n = createInstance();
await i18n.init({ resources: musicNotesResources, lng: 'zh-CN', initAsync: false });
vi.mock('../src/useReducedMotionFor', () => ({ useReducedMotionFor: () => true }));

const song: NoteSong = { source: 'online:test', id: 'one', title: 'Playing song', artist: 'Artist' };
const second = { ...song, id: 'two', title: 'Second song' };
const theme: FoliumTheme = { name: 'Test', backgroundColor: '#111111', primaryColor: '#eeeeee', accentColor: '#eeeeee',
    secondaryColor: '#aaaaaa', fontStyle: 'sans', animationIntensity: 'calm', isDaylight: false };
const readPlaylist = vi.fn<MusicNotesPort['readPlaylist']>();
const port: MusicNotesPort = {
    currentSong: () => song, currentTime: () => 12, isPlaying: () => true, playbackState: () => 'playing',
    pause: vi.fn(), cover: async () => null,
    subscribe: () => () => undefined, play: async () => false, playAt: vi.fn(async () => false), seek: vi.fn(),
    accounts: () => [{ source: 'test', id: 'account', name: 'Test account' }],
    playlists: async () => [{ source: 'test', id: 'playlist', accountId: 'account', name: 'Saved playlist' }],
    readPlaylist,
};
let root: Root, surface: ShadowRoot, db: MusicNotesRepository, notebook: Notebook, databaseName: string;
let playbackSelection: { key: string | null };
const notify = vi.fn();

const button = (name: string, scope: ParentNode = surface) => {
    const result = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(element =>
        !element.closest('[inert]') && (element.getAttribute('aria-label') === name || element.textContent?.trim() === name));
    if (!result) throw new Error(`Missing button: ${name}`);
    return result;
};
const click = (name: string, scope?: ParentNode) => act(async () => { button(name, scope).click(); });
const press = (element: HTMLElement, key: string) => act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }));
});
const typeInto = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
});
const openPage = () => act(async () => root.render(createElement(I18nextProvider, { i18n }, createElement(MusicNotesWindow, {
    port, locale: 'zh-CN', theme, notebook, playbackSelection, notify,
}))));
async function ready() {
    notebook = new Notebook(db);
    playbackSelection = { key: null };
    await vi.waitFor(() => expect(notebook.getSnapshot().ready).toBe(true));
    await openPage();
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    databaseName = `notes-window-${crypto.randomUUID()}`;
    db = createMusicNotesRepository({ databaseName });
    surface = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
    root = createRoot(surface);
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    await notebook?.dispose();
    surface.host.remove(); db.close(); await Dexie.delete(databaseName);
    vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('music notes mod user flows', () => {
    it('imports from a sheet and retains existing content and empty imported songs', async () => {
        await db.save(song, { ...emptyNoteDraft(), note: 'Original memory' }, null);
        let finishImport!: (songs: NoteSong[]) => void;
        readPlaylist.mockReturnValue(new Promise<NoteSong[]>(resolve => { finishImport = resolve; }));
        let accountChanged = () => {};
        vi.spyOn(port, 'subscribe').mockImplementation(callback => { accountChanged = callback; return () => {}; });
        const accounts = vi.spyOn(port, 'accounts');
        await ready();
        const header = surface.querySelector('header')!;
        expect(button('备份（导出）', header).querySelector('svg')).not.toBeNull();
        const picker = vi.spyOn(surface.querySelector<HTMLInputElement>('input[type="file"]')!, 'click');
        await click('恢复备份（导入）', header);
        expect(picker).toHaveBeenCalledOnce();
        expect(surface.querySelector('[role="dialog"]')).toBeNull();
        await click('从歌单导入', header);
        const dialog = surface.querySelector<HTMLElement>('[role="dialog"]')!;
        for (const keys of [{ key: 'F6' }, { key: 'k', ctrlKey: true }, { key: 'k', metaKey: true }]) {
            const event = new KeyboardEvent('keydown', { ...keys, bubbles: true, composed: true, cancelable: true });
            expect(dialog.dispatchEvent(event)).toBe(false);
        }
        await click('Test account'); await click('Saved playlist');
        accounts.mockReturnValue([{ source: 'test', id: 'different', name: 'Other account' }]);
        await act(async () => accountChanged());
        expect(dialog.textContent).not.toContain('Saved playlist');
        accounts.mockRestore(); await act(async () => accountChanged());
        await click('Test account'); await click('Test account');
        expect(dialog.textContent).not.toContain('Saved playlist');
        await click('Test account'); await click('Saved playlist');
        await click('Saved playlist');
        expect(button('导入').disabled).toBe(true);
        await click('Saved playlist');
        const query = surface.querySelector<HTMLInputElement>('input[placeholder="搜索歌单"]')!;
        await typeInto(query, 'different playlist');
        expect(button('导入').disabled).toBe(true);
        await typeInto(query, 'Saved'); await click('导入');
        expect(dialog.textContent).toContain('正在导入');
        await vi.waitFor(() => expect(readPlaylist).toHaveBeenCalledOnce());
        await act(async () => finishImport([song, second]));
        await vi.waitFor(async () => expect((await db.get(second))?.note).toBe(''));
        expect((await db.get(song))?.note).toBe('Original memory');
        expect(readPlaylist).toHaveBeenCalledOnce();
    });

    it('commits comma-separated tags, deduplicates labels, and preserves the selected filter across case changes', async () => {
        // Leave room for “All” and the overflow button, but no individual tag.
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(80);
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 24));
        await db.save(second, { ...emptyNoteDraft(), tags: ['BASS'] }, null);
        await db.importSongs([{ ...second, id: 'three', title: 'Other song' }]);
        await ready(); await click('新增标签');
        const field = surface.querySelector<HTMLInputElement>('[role="combobox"]')!;
        await typeInto(field, '夜路，bass,BASS'); await press(field, 'Enter');
        await act(async () => {
            await vi.waitFor(async () => expect((await db.get(song))?.tags).toEqual(['夜路', 'bass']));
            await vi.waitFor(() => expect(surface.activeElement).toBe(button('新增标签')));
        });
        const filters = surface.querySelector('[aria-label="按标签筛选"]')!;
        const trigger = button('查看全部', filters);
        await act(async () => { trigger.focus(); trigger.click(); });
        const panel = surface.querySelector('[role="dialog"]')!;
        const bass = [...panel.querySelectorAll('button')].find(item => item.textContent?.trim().toLowerCase() === 'bass')!;
        await act(async () => bass.click());
        expect(trigger.textContent).toBe(bass.textContent);
        await click('移除标签 bass');
        await act(async () => {
            await vi.waitFor(async () => expect((await db.get(song))?.tags).toEqual(['夜路']));
        });
        expect(trigger.getAttribute('aria-pressed')).toBe('true');
        expect(trigger.textContent).toBe('BASS');
        expect(surface.querySelector('aside')?.textContent).toContain('Second song');
        expect(surface.querySelector('aside')?.textContent).not.toContain('Other song');
        await click('全部', filters);
        expect(trigger.textContent).toBe('查看全部');
    });

    it('keeps the first song on pause, resumes it and focuses a single mark at its current position', async () => {
        let state: 'playing' | 'paused' = 'playing';
        let playbackChanged = () => {};
        vi.spyOn(port, 'subscribe').mockImplementation(callback => { playbackChanged = callback; return () => {}; });
        vi.spyOn(port, 'playbackState').mockImplementation(() => state);
        vi.spyOn(port, 'isPlaying').mockImplementation(() => state === 'playing');
        vi.spyOn(port, 'pause').mockImplementation(() => { state = 'paused'; playbackChanged(); });
        const play = vi.spyOn(port, 'play').mockImplementation(async () => { state = 'playing'; playbackChanged(); return true; });
        await ready();
        await click('停止');
        expect(port.pause).toHaveBeenCalledWith(song);
        await act(async () => root.render(null));
        await openPage();
        expect(button('记下这个时刻').textContent).toBe('00:12');
        await click('继续');
        expect(play).toHaveBeenCalledWith(song);
        expect(button('停止')).toBeDefined();
        const current = vi.spyOn(port, 'currentSong').mockReturnValue(second);
        await click('记下这个时刻');
        expect(notebook.getDraft(song).bookmarks).toEqual([]);
        current.mockRestore();
        await click('记下这个时刻');
        const moment = surface.querySelector<HTMLInputElement>('input[placeholder="为标记添加注释"]')!;
        expect(surface.activeElement).toBe(moment);
        const body = surface.querySelector<HTMLTextAreaElement>('textarea[placeholder="这首歌勾起了我的回忆..."]')!;
        await act(async () => body.focus());
        await typeInto(body, 'Worth hearing again');
        expect(surface.activeElement).toBe(body);
        await click('停止');
        await click('记下这个时刻');
        expect(surface.activeElement).toBe(moment);
        await typeInto(moment, 'First chorus');
        await act(async () => moment.blur());
        await vi.waitFor(async () => expect(await db.get(song)).toMatchObject({
            note: 'Worth hearing again', bookmarks: [{ positionSeconds: 12, text: 'First chorus' }],
        }));
        await click('00:12', surface.querySelector('[data-music-notes="bookmarks"]')!);
        expect(port.playAt).toHaveBeenCalledWith(song, 12);
        expect(notify).toHaveBeenCalledWith('暂时无法播放这首歌。');
        await act(async () => {
            await notebook.importSongs([second]);
            await notebook.remove(song, (await db.get(song))!.revision);
            root.render(null);
        });
        await openPage();
        const pausedGroup = [...surface.querySelectorAll('aside section')].find(group => group.querySelector('h3')?.textContent === '已暂停');
        const pausedRow = pausedGroup?.querySelector('button');
        expect(pausedRow?.textContent).toContain(song.title);
        await act(async () => pausedRow!.click());
        await click('继续');
        expect(surface.querySelector('aside')?.textContent).not.toContain('已暂停');
    });

    it('keeps notes until single or bulk deletion is confirmed and preserves unchecked songs', async () => {
        await db.save(song, { ...emptyNoteDraft(), note: 'Original' }, null);
        // A clock correction must not hide the confirmation of a successful local write.
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 3_600_000);
        await ready(); const body = surface.querySelector('textarea')!;
        await typeInto(body, '');
        await act(async () => notebook.flush(song));
        expect((await db.get(song))?.note).toBe('');
        expect(surface.querySelector('header')?.textContent).toContain('已保存到本地 · 刚刚');
        await click('删除这条笔记');
        expect(surface.querySelector('[role="dialog"]')).toBeNull();
        await press(button('确认删除？'), 'Escape');
        expect(await db.get(song)).toBeDefined();
        await click('删除这条笔记');
        const before = (await db.get(song))!;
        await act(async () => { await db.save(song, { ...before, note: 'Changed elsewhere' }, before.revision); });
        await vi.waitFor(() => expect(body.value).toBe('Changed elsewhere'));
        await click('确认删除？');
        expect(notify).toHaveBeenCalledWith('笔记已更改，请重新确认删除。');
        expect((await db.get(song))?.note).toBe('Changed elsewhere');
        await click('删除这条笔记'); await click('确认删除？');
        await vi.waitFor(async () => expect(await db.get(song)).toBeUndefined());
        const untouched = { ...song, id: 'three', title: 'Keep this song' };
        const album = 'Selection group';
        const others = Array.from({ length: 50 }, (_, i) => ({ ...song, id: `z-${i}`, title: `Track ${i}`, album }));
        await act(async () => { await notebook.importSongs([{ ...song, album }, second, untouched, ...others]); });
        await click('批量删除');
        const checks = [...surface.querySelectorAll<HTMLButtonElement>('aside button[role="checkbox"]')];
        expect(checks).toHaveLength(50);
        await act(async () => checks.find(row => row.textContent?.includes(second.title))!.click());
        await typeInto(surface.querySelector<HTMLInputElement>('aside input')!, album);
        expect(button('全选').disabled).toBe(true);
        await vi.waitFor(() => expect(button('全选').disabled).toBe(false));
        await click('全选');
        await click('取消全选');
        expect(button('删除（1）').disabled).toBe(false);
        await click('全选'); await click('删除（52）');
        const confirm = () => surface.querySelector<HTMLElement>('[role="dialog"]:not([inert])')!;
        expect(confirm().querySelector('p')?.textContent).toBe('确认删除选中的 52 首？');
        expect(confirm().querySelector('p strong')?.textContent).toBe('52');
        expect(confirm().textContent).not.toContain(second.title);
        await click('取消', confirm());
        expect(await db.list()).toHaveLength(53);
        await click('删除（52）'); await click('删除', confirm());
        await vi.waitFor(async () => expect((await db.list()).map(note => note.song)).toEqual([untouched]));
    });

    it('navigates notes with the keyboard, reorders by dragging, and searches inside a moment', async () => {
        const third = { ...song, id: 'three', title: 'Third song' };
        await db.save(third, emptyNoteDraft(), null);
        await db.save(second, { ...emptyNoteDraft(), bookmarks: [{ id: 'b', positionSeconds: 22, text: 'bridge' }] }, null);
        await db.importSongs([song]);
        await ready();
        const allNotes = [...surface.querySelectorAll('aside section')].find(section => section.querySelector('h3')?.textContent === '全部笔记')!;
        const rows = () => [...allNotes.querySelectorAll<HTMLButtonElement>('button[data-song-key]')];
        const [firstRow, secondRow, thirdRow] = rows();
        await act(async () => firstRow.focus()); await press(firstRow, 'ArrowDown');
        expect(surface.activeElement).toBe(secondRow);
        expect(surface.querySelector('[data-music-notes="editor"]')?.textContent).toContain('Second song');
        await act(async () => {
            firstRow.focus();
            firstRow.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true, composed: true,
            }));
        });
        expect((await db.list()).map(note => note.song.id)).toEqual([song.id, second.id, third.id]);
        const dataTransfer = { setData: vi.fn() };
        const drag = (node: HTMLElement, type: string) => node.dispatchEvent(Object.assign(
            new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 1 }), { dataTransfer }));
        await act(async () => {
            drag(firstRow, 'dragstart');
            drag(thirdRow, 'dragover');
            expect(thirdRow.dataset.insert).toBe('after');
            drag(thirdRow, 'drop');
        });
        await vi.waitFor(() => expect(rows()[2]).toBe(firstRow));
        expect(thirdRow.dataset.insert).toBeUndefined();
        await act(async () => {
            firstRow.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            firstRow.click();
        });
        const body = surface.querySelector<HTMLTextAreaElement>('textarea')!;
        await typeInto(body, 'Still in the same position'); await act(async () => notebook.flush(song));
        expect((await db.list()).map(note => note.song.id)).toEqual([second.id, third.id, song.id]);
        const search = surface.querySelector<HTMLInputElement>('input[placeholder="搜索歌名、歌手、标签或笔记"]')!;
        await typeInto(search, 'missing');
        await vi.waitFor(() => expect(surface.textContent).toContain('没有找到'));
        await typeInto(search, 'bridge');
        await vi.waitFor(() => expect(surface.querySelector('aside')?.textContent).toContain('Second song'));
    });
});
