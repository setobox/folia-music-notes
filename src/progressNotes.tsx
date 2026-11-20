import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Pin } from 'lucide-react';
import type { i18n } from 'i18next';
import type { FoliumClientApi, FoliumProgressContext } from '../types/folium';
import { NOTES_LIMITS, songKey, type NoteBookmark, type NoteSong } from './core';
import type { MusicNotesPort } from './hostTypes';
import { Button } from './kit/Button';
import { Tooltip } from './kit/Tooltip';
import { FIELD_CLASS } from './kit/TextField';
import { SettingsKitThemeContext, settingsTokens } from './kit/kitTheme';
import { placePopover } from './kit/popoverPlace';
import type { Notebook } from './notebook';
import styles from './styles.css?inline';

// A progress-bar registration may mount in several players; all instances share the notebook.
const timeLabel = (seconds: number) => [Math.floor(seconds / 60), Math.floor(seconds % 60)]
    .map(part => String(part).padStart(2, '0')).join(':');

interface ProgressProps {
    signal: AbortSignal;
    folium: FoliumClientApi;
    port: MusicNotesPort;
    notebook: Notebook;
    i18n: i18n;
    notify: (message: string) => void;
}

function PinEditor({ anchor, bookmark, notebook, song, placeholder, close, reportFailure, signal }: {
    signal: AbortSignal;
    anchor: HTMLElement;
    bookmark: NoteBookmark;
    notebook: Notebook;
    song: NoteSong;
    placeholder: string;
    close: () => void;
    reportFailure: () => void;
}) {
    const field = useRef<HTMLInputElement>(null);
    const initialText = useRef(bookmark.text);
    const text = useRef(initialText.current);
    const finished = useRef(false);
    // Enter, blur, a track change, or the bar unmounting commit to the ORIGINAL song.
    // Escape keeps the mark and discards just the uncommitted label.
    const finish = (commit: boolean) => {
        if (finished.current) return;
        finished.current = true;
        if (commit && text.current !== initialText.current) {
            try {
                notebook.edit(song, draft => ({ ...draft, bookmarks: draft.bookmarks.map(item =>
                    item.id === bookmark.id ? { ...item, text: text.current } : item) }), true);
                void notebook.flush(song).catch(reportFailure);
            } catch { reportFailure(); }
        }
    };
    const finishRef = useRef(finish);
    finishRef.current = finish;
    useLayoutEffect(() => {
        const input = field.current;
        if (!input) return;
        input.showPopover();
        const position = () => {
            const frame = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            const place = placePopover(anchor.getBoundingClientRect(), input.getBoundingClientRect(), frame,
                { side: 'over', align: 'center' });
            input.style.left = `${place.left}px`;
            input.style.top = place.top === undefined ? 'auto' : `${place.top}px`;
            input.style.bottom = place.bottom === undefined ? 'auto' : `${place.bottom}px`;
        };
        position();
        input.focus({ preventScroll: true });
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        const commit = () => finishRef.current(true);
        // Folium may unmount the bar after deactivation has already closed the notebook.
        signal.addEventListener('abort', commit, { once: true });
        window.addEventListener('pagehide', commit);
        return () => {
            signal.removeEventListener('abort', commit);
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
            window.removeEventListener('pagehide', commit);
            commit();
        };
    }, [anchor, signal]);
    return <input ref={field} popover="manual" type="text" defaultValue={bookmark.text}
        className={`${FIELD_CLASS} fixed inset-auto m-0 w-64 bg-[var(--st-menu)] px-2.5 shadow-lg`}
        aria-label={placeholder} placeholder={placeholder} maxLength={NOTES_LIMITS.bookmarkText}
        onChange={event => { text.current = event.currentTarget.value; }}
        onBlur={() => { finish(true); close(); }}
        onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                finish(event.key === 'Enter');
                close();
                anchor.querySelector('button')?.focus({ preventScroll: true });
            }
        }} />;
}

function PinButton({ folium, port, notebook, i18n, notify, ctx, song, signal }: ProgressProps & {
    ctx: FoliumProgressContext; song: NoteSong | null;
}) {
    const anchor = useRef<HTMLSpanElement>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const bookmark = song && editingId && notebook.getDraft(song).bookmarks.find(mark => mark.id === editingId);
    const theme = folium.host.folium.minor >= 10 ? folium.theme.getCurrent() : undefined;
    const isDaylight = theme?.isDaylight ?? false;
    const tokens = { ...settingsTokens(isDaylight, theme), '--text-primary': theme?.primaryColor ?? ctx.getColors().text,
        '--st-accent': theme?.accentColor ?? ctx.getColors().fill } as CSSProperties;
    const reportFailure = () => notify(i18n.t('musicNotes.failed'));
    return <SettingsKitThemeContext.Provider value={{ theme, isDaylight }}>
        <span ref={anchor} className="inline-flex" style={tokens}>
            <Button icon={Pin} variant="primary" tip={i18n.t('musicNotes.markMoment')}
                disabled={!song || !notebook.getSnapshot().ready} onClick={() => {
                    const current = port.currentSong();
                    if (!song || !current || songKey(current) !== songKey(song)) return;
                    try {
                        setEditingId(notebook.mark(current, ctx.playbackTime.get()));
                        void notebook.flush(current).catch(reportFailure);
                    }
                    catch { reportFailure(); }
                }} />
            {anchor.current && song && bookmark && <PinEditor key={bookmark.id} anchor={anchor.current}
                notebook={notebook} song={song} bookmark={bookmark} signal={signal} close={() => setEditingId(null)}
                reportFailure={reportFailure} placeholder={`${timeLabel(bookmark.positionSeconds)} · ${i18n.t('musicNotes.bookmarkPlaceholder')}`} />}
        </span>
    </SettingsKitThemeContext.Provider>;
}

export function registerProgressNotes(folium: FoliumClientApi, port: MusicNotesPort, notebook: Notebook, i18n: i18n,
    notify: (message: string) => void, signal: AbortSignal): () => void {
    const mountView = (paint: (ctx: FoliumProgressContext, song: NoteSong | null) => ReactNode) =>
        (container: HTMLElement, ctx: FoliumProgressContext) => {
            const style = document.createElement('style');
            style.textContent = styles;
            const view = document.createElement('div');
            container.append(style, view);
            const root = createRoot(view);
            const render = () => root.render(paint(ctx, port.currentSong()));
            const dispose = [ctx.onChange(render), port.subscribe(render), notebook.subscribe(render)];
            i18n.on('languageChanged', render);
            render();
            return () => {
                dispose.forEach(off => off());
                i18n.off('languageChanged', render);
                root.unmount();
                view.remove();
                style.remove();
            };
        };
    const button = folium.registries.progressButtons.register({
        id: 'mark-moment', slot: 'progress.trailing',
        mount: mountView((ctx, song) => <PinButton key={song && songKey(song)} {...{ folium, port, notebook, i18n, notify, ctx, song, signal }} />),
    });
    const layer = folium.registries.progressLayers.register({
        id: 'moments',
        mount: mountView((ctx, song) => {
            if (!song || !notebook.getSnapshot().ready || !ctx.getDuration()) return null;
            const theme = folium.host.folium.minor >= 10 ? folium.theme.getCurrent() : undefined;
            return <SettingsKitThemeContext.Provider value={{ theme, isDaylight: theme?.isDaylight ?? false }}>
                {notebook.getDraft(song).bookmarks.map(mark => {
                const title = [timeLabel(mark.positionSeconds), mark.text].filter(Boolean).join(' · ');
                return <span key={mark.id} className="pointer-events-auto absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${ctx.timeToRatio(mark.positionSeconds) * 100}%`, color: ctx.getColors().text }}>
                    <Tooltip text={title} className="inline-flex">
                        <button type="button" aria-label={title} className="flex h-3 w-2 items-center justify-center opacity-70 hover:opacity-100"
                            onClick={() => {
                                const current = port.currentSong();
                                if (current && songKey(current) === songKey(song)) ctx.seek(mark.positionSeconds);
                            }}><span className="h-full w-px bg-current" /></button>
                    </Tooltip>
                </span>;
            })}</SettingsKitThemeContext.Provider>;
        }),
    });
    return () => { layer.unregister(); button.unregister(); };
}
