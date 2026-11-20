import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { FoliumClientApi, FoliumHomeTabDef } from '../types/folium';
import { createFoliumPort } from './foliumPort';
import { createMusicNotesRepository } from './core/notesDatabase';
import { songKey } from './core/notesModel';
import { musicNotesResources } from './locales';
import { Notebook } from './notebook';
import { registerMusicNotesPonder } from './ponder';
import MusicNotesWindow from './ui/MusicNotesWindow';
import styles from './styles.css?inline';

// The notebook persists drafts independently of which home tab is mounted.
export default function activate(folium: FoliumClientApi): (() => void) | undefined {
    if (folium.env.context !== 'main') return;
    const lifetime = new AbortController();
    const port = createFoliumPort(folium, lifetime.signal);
    const locale = document.documentElement.lang || navigator.language;
    const notebook = new Notebook(createMusicNotesRepository({ locale }));
    const i18n = createInstance();
    void i18n.init({ resources: musicNotesResources, fallbackLng: 'en',
        lng: locale, initAsync: false, interpolation: { escapeValue: false } });
    const notify = (message: string) => folium.ui.toast(message);
    const flush = () => { void notebook.flush().catch(error => folium.log.warn('Could not save music notes', error)); };
    const playbackSelection: { key: string | null } = { key: null };
    const offSong = folium.events.on('playback.songChanged', () => {
        flush();
        if (playbackSelection.key) {
            const current = port.currentSong();
            if (!current || songKey(current) !== playbackSelection.key) playbackSelection.key = null;
        }
    });
    window.addEventListener('pagehide', flush);
    const stopPonder = registerMusicNotesPonder(folium);
    const notebookTab: FoliumHomeTabDef = {
        id: 'notebook', order: 300,
        label: { 'zh-CN': '音乐笔记', 'zh-TW': '音樂筆記', en: 'Music notes', in: 'Catatan lagu', vi: 'Ghi chú bài hát' },
        mount(container, ctx) {
            const page = document.createElement('div');
            page.style.cssText = 'width:100%;height:100%;min-height:0';
            const style = document.createElement('style');
            style.textContent = styles;
            container.append(style, page);
            const tree = page.getRootNode();
            // Folia initially focuses its own navigation tab, just outside the mod's shadow root.
            const keyScope = (tree instanceof ShadowRoot ? tree.host.closest('[data-folium-home-page]') : null) ?? container;
            const closeOnEscape = (event: Event) => {
                if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.defaultPrevented ||
                    event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey ||
                    event.shiftKey || event.metaKey || event.altKey) return;
                // Child controls consume Escape first. A busy sheet also retains the keyboard.
                if (page.querySelector('[data-folia-sheet="true"]')) return;
                event.preventDefault();
                event.stopPropagation();
                // Selection also owns Escape when focus has moved to the editor or the host tab.
                const cancelSelection = page.querySelector<HTMLButtonElement>('[data-cancel-note-selection]');
                if (cancelSelection) { cancelSelection.click(); return; }
                // Removing the active Folium tab returns to the native library. Re-register its launcher.
                tab.unregister();
                tab = folium.registries.homeTabs.register(notebookTab);
            };
            keyScope.addEventListener('keydown', closeOnEscape);
            const root = createRoot(page);
            void i18n.changeLanguage(ctx.locale);
            const render = () => root.render(<I18nextProvider i18n={i18n}>
                <MusicNotesWindow port={port} notebook={notebook} playbackSelection={playbackSelection} locale={ctx.locale} theme={ctx.getTheme()}
                    notify={notify} />
            </I18nextProvider>);
            render();
            const unsubscribe = ctx.onChange(render);
            return () => {
                keyScope.removeEventListener('keydown', closeOnEscape);
                unsubscribe();
                root.unmount();
                flush();
                page.remove();
                style.remove();
            };
        },
    };
    let tab = folium.registries.homeTabs.register(notebookTab);
    const open = folium.registries.commands.register({
        id: 'open', globalShortcut: true,
        label: { 'zh-CN': '打开音乐笔记', 'zh-TW': '開啟音樂筆記', en: 'Open music notes', in: 'Buka catatan lagu', vi: 'Mở ghi chú bài hát' },
        keywords: ['notes', 'tags', '笔记', '备注', '标签'],
        run: () => { folium.ui.openHomeTab('notebook'); },
    });
    return () => {
        lifetime.abort();
        window.removeEventListener('pagehide', flush);
        offSong();
        open.unregister();
        tab.unregister();
        stopPonder();
        void notebook.dispose().catch(error => folium.log.warn('Could not close music notes', error));
    };
}
