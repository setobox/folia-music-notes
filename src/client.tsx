import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { FoliumClientApi, FoliumPanelContext } from '../types/folium';
import type { NoteSong } from './core';
import { createFoliumPort } from './foliumPort';
import { musicNotesResources } from './locales';
import { registerMusicNotesPonder } from './ponder';
import MusicNotesWindow from './ui/MusicNotesWindow';
import styles from './styles.css?inline';

// The module owns its page and preserves unsaved drafts while Folia changes home tabs.
export default function activate(folium: FoliumClientApi): (() => void) | undefined {
    if (folium.env.context !== 'main') return;
    const port = createFoliumPort(folium);
    const i18n = createInstance();
    void i18n.init({ resources: musicNotesResources, fallbackLng: 'en', lng: 'en',
        initAsync: false, interpolation: { escapeValue: false } });
    const page = document.createElement('div');
    page.style.cssText = 'width:100%;height:100%;min-height:0';
    const style = document.createElement('style');
    style.textContent = styles;
    let root: Root | undefined;
    let context: FoliumPanelContext | undefined;
    let requestId = 0;
    let requestedSong: NoteSong | null = null;
    let stopped = false;

    const render = () => {
        if (!context || stopped) return;
        root ??= createRoot(page);
        void i18n.changeLanguage(context.locale);
        root.render(<I18nextProvider i18n={i18n}>
            <MusicNotesWindow port={port} locale={context.locale} theme={context.getTheme()}
                requestId={requestId} requestedSong={requestedSong} onClose={() => { folium.ui.back(); }} />
        </I18nextProvider>);
    };
    const stopPonder = registerMusicNotesPonder(folium);
    const tab = folium.registries.homeTabs.register({
        id: 'notebook', order: 300,
        label: { 'zh-CN': '音乐笔记', 'zh-TW': '音樂筆記', en: 'Music notes', in: 'Catatan lagu', vi: 'Ghi chú bài hát' },
        mount(container, ctx) {
            context = ctx;
            container.append(style, page);
            render();
            const unsubscribe = ctx.onChange(render);
            return () => {
                unsubscribe();
                if (context === ctx) context = undefined;
                page.remove();
                style.remove();
            };
        },
    });
    const open = folium.registries.commands.register({
        id: 'open', globalShortcut: true,
        label: { 'zh-CN': '打开音乐笔记', 'zh-TW': '開啟音樂筆記', en: 'Open music notes', in: 'Buka catatan lagu', vi: 'Mở ghi chú bài hát' },
        keywords: ['notes', 'tags', '笔记', '备注', '标签'],
        run: () => { folium.ui.openHomeTab('notebook'); },
    });
    const current = folium.registries.commands.register({
        id: 'current', globalShortcut: true,
        label: { 'zh-CN': '记下当前歌曲', 'zh-TW': '記下目前歌曲', en: 'Note the current song', in: 'Catat lagu saat ini', vi: 'Ghi chú bài hát hiện tại' },
        run: () => {
            requestedSong = port.currentSong();
            requestId++;
            folium.ui.openHomeTab('notebook');
            render();
        },
    });
    return () => {
        stopped = true;
        root?.unmount();
        page.remove();
        style.remove();
        current.unregister();
        open.unregister();
        tab.unregister();
        stopPonder();
    };
}
