import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Status } from '../kit';
import { LoadingBars } from '../kit/LoadingBars';
import { SettingsKitThemeContext, settingsTokens } from '../kit/kitTheme';
import { kitMotionTokens, useKitReducedMotion } from '../kit/motion';
import type { FoliumTheme } from '../../types/folium';
import { songKey, type NoteSong } from '../core';
import { tagKey } from '../core/notesModel';
import type { MusicNotesPort } from '../hostTypes';
import type { Notebook } from '../notebook';
import { NotebookActions } from './NotebookActions';
import MusicNoteEditor from './MusicNoteEditor';
import { NoteList } from './NoteList';
import { useMusicNotesLibrary } from './useMusicNotesLibrary';

// The host owns navigation; the mod keeps its own master/detail selection and a shared notebook.
export interface MusicNotesWindowProps {
    notebook: Notebook;
    port: MusicNotesPort;
    playbackSelection: { key: string | null };
    locale: string;
    theme: FoliumTheme;
    notify: (message: string) => void;
}

// A new revision acknowledges a completed write, even if a restored note has a different device's clock.
function SaveStatus({ notebook, song, revision }: { notebook: Notebook; song: NoteSong; revision: number }) {
    const { t } = useTranslation();
    const status = notebook.status(song);
    const previous = useRef(revision);
    const [justSaved, setJustSaved] = useState(false);
    useEffect(() => {
        if (previous.current === revision) return;
        previous.current = revision;
        setJustSaved(revision > 0);
        if (!revision) return;
        const timer = window.setTimeout(() => setJustSaved(false), 60_000);
        return () => window.clearTimeout(timer);
    }, [revision]);
    return <div role="status" className="text-xs text-[color:var(--st-t2)]">
        {status === 'error' ? <Button variant="quiet" onClick={() => { void notebook.retry(song).catch(() => undefined); }}>{t('musicNotes.saveRetry')}</Button>
            : status === 'saving' ? t('musicNotes.saving') : status === 'saved' && justSaved ? t('musicNotes.saved') : null}
    </div>;
}

export function MusicNotesWindow({ notebook, port, playbackSelection, locale, theme, notify }: MusicNotesWindowProps) {
    const { t } = useTranslation();
    const { notes, tagOrder, ready, error } = useMusicNotesLibrary(notebook);
    const [, updatePlayer] = useState(0);
    useEffect(() => port.subscribe(() => updatePlayer(version => version + 1)), [port]);
    const displayedSong = port.currentSong();
    const displayedKey = displayedSong && songKey(displayedSong);
    const playbackState = port.playbackState();
    const current = playbackState === 'playing' ? displayedSong : null;
    useLayoutEffect(() => {
        if (playbackState !== 'paused') playbackSelection.key = playbackState === 'playing' ? displayedKey : null;
    }, [playbackState, displayedKey, playbackSelection]);
    const [choice, setChoice] = useState<NoteSong | null>(null);
    const [detail, setDetail] = useState(false);
    const [importRequest, setImportRequest] = useState(0);
    const [focusRequest, setFocusRequest] = useState(0);
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const wantsFocus = useRef(false);
    const frame = useRef<HTMLDivElement>(null);
    const lastDetailControl = useRef<HTMLElement | null>(null);
    const returnToList = useRef(false);
    const enterDetail = useRef(false);
    const songs = useMemo(() => new Map(notes.map(note => [note.key, note])), [notes]);
    const chosenKey = choice && songKey(choice);
    const chosen = chosenKey ? songs.get(chosenKey)?.song ??
        (chosenKey === displayedKey ? displayedSong : null) : null;
    // Reopening the tab can resume the song paused here, even before the first note is written.
    const pausedSelection = playbackState === 'paused' && playbackSelection.key === displayedKey ? displayedSong : null;
    const latest = useMemo(() => notes.reduce<(typeof notes)[number] | undefined>((last, note) =>
        !last || note.updatedAt > last.updatedAt || (note.updatedAt === last.updatedAt && note.key.localeCompare(last.key) < 0)
            ? note : last, undefined), [notes]);
    const selected = chosen ?? current ?? pausedSelection ?? latest?.song ?? null;
    const listCurrent = current ?? (displayedKey && !songs.has(displayedKey) ? pausedSelection : null);
    const key = selected && songKey(selected);
    const revision = key ? songs.get(key)?.revision : undefined;
    const previousSavedKey = useRef<string | null>(null);
    const hadNotes = useRef(false);
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    // Current playback can change outside the page; commit the previous song before its editor leaves.
    useEffect(() => {
        const previous = selectedRef.current;
        return () => { if (previous) void notebook.flush(previous).catch(() => undefined); };
    }, [key, notebook]);
    const tags = useMemo(() => {
        const names = new Map<string, string>();
        for (const note of notes) for (const name of note.tags) {
            const id = tagKey(name);
            if (!names.has(id)) names.set(id, name);
        }
        const ordered: string[] = [];
        for (const key of tagOrder) {
            const name = names.get(key);
            if (name !== undefined) { ordered.push(name); names.delete(key); }
        }
        return [...ordered, ...names.values()];
    }, [notes, tagOrder]);
    const moments = useMemo(() => notes.reduce((total, note) => total + note.bookmarks.length, 0), [notes]);
    const select = (song: NoteSong, focusText: boolean, openDetail: boolean) => {
        if (selected && songKey(song) !== key) void notebook.flush(selected).catch(() => undefined);
        setChoice(song);
        if (openDetail) { enterDetail.current = !detail; setDetail(true); }
        if (focusText) { wantsFocus.current = true; setFocusRequest(value => value + 1); }
    };
    useLayoutEffect(() => {
        const page = frame.current;
        const previous = previousSavedKey.current;
        previousSavedKey.current = key && songs.has(key) ? key : null;
        const emptied = hadNotes.current && songs.size === 0;
        hadNotes.current = songs.size > 0;
        if (!page || !ready) return;
        const list = page.querySelector<HTMLElement>('.music-notes-list');
        const root = page.getRootNode() as Document | ShadowRoot;
        const documentFocus = page.ownerDocument.activeElement;
        const focusWasLost = (!root.activeElement || root.activeElement === page.ownerDocument.body) &&
            (!documentFocus || documentFocus === page.ownerDocument.body || (root instanceof ShadowRoot && documentFocus === root.host));
        // A deleted note can unmount the focused confirmation button, even if this song is still playing.
        if (focusWasLost && (emptied || (previous && !songs.has(previous) &&
            lastDetailControl.current && !lastDetailControl.current.isConnected))) {
            if (list) {
                returnToList.current = true;
                if (detail) setDetail(false);
            } else {
                const next = bodyRef.current ?? page.querySelector<HTMLButtonElement>('.music-notes-detail button');
                next?.focus();
            }
        }
        if (!detail && returnToList.current) {
            returnToList.current = false;
            const target = list?.querySelector<HTMLButtonElement>('button[data-song-key][aria-pressed="true"]') ??
                list?.querySelector<HTMLInputElement>('input');
            target?.focus();
        } else if (wantsFocus.current && bodyRef.current) {
            bodyRef.current.focus(); wantsFocus.current = false;
        } else if (detail && enterDetail.current) {
            const back = page.querySelector<HTMLButtonElement>('.music-notes-back button');
            if (back?.getClientRects().length) back.focus();
        }
        enterDetail.current = false;
    }, [focusRequest, key, ready, detail, songs]);
    const reduced = useKitReducedMotion();
    const style = { ...settingsTokens(theme.isDaylight, theme), ...kitMotionTokens(reduced), '--text-primary': theme.primaryColor } as CSSProperties;
    const first = !notes.length;
    const openImport = () => setImportRequest(value => value + 1);
    return <SettingsKitThemeContext.Provider value={{ isDaylight: theme.isDaylight, theme }}>
        <div ref={frame} className="st-window music-notes-page relative flex size-full min-h-0 flex-col overflow-hidden bg-[var(--st-win)] text-[color:var(--st-t1)]" lang={locale} style={style}>
            <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--st-line)] px-4 py-3 md:px-8">
                <div className="flex flex-wrap items-center gap-x-3">
                    <h1 className="text-xl font-semibold">{t('musicNotes.title')}</h1>
                    {ready && selected && <SaveStatus key={key} notebook={notebook} song={selected} revision={revision ?? 0} />}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-right text-xs tabular-nums text-[color:var(--st-t2)]">{ready && t('musicNotes.stats', { songs: notes.length, moments })}</span>
                    <NotebookActions {...{ notebook, port, notify, importRequest }} />
                </div>
            </header>
            {!ready ? <div className="grid flex-1 place-items-center">{error ? <Status tone="error">{t('musicNotes.failed')}</Status> :
                <span role="status" className="text-[color:var(--st-t2)]"><LoadingBars size={20} /><span className="sr-only">{t('musicNotes.loading')}</span></span>}</div> :
            <div className="music-notes-layout min-h-0 flex-1" data-first={first || undefined} data-detail={detail || undefined}>
                {!first && <NoteList {...{ notes, tags, port, select, notebook, notify }} current={listCurrent}
                    paused={playbackState === 'paused'} selection={key} />}
                <section key="detail" className="music-notes-detail st-scroll min-h-0 min-w-0 overflow-y-auto p-4 md:px-8" onFocusCapture={event => {
                    lastDetailControl.current = event.target;
                    if (first) setDetail(true);
                }}>
                    {!first && <div className="music-notes-back mb-3"><Button variant="quiet" icon={ChevronLeft} onClick={() => {
                        if (selected) void notebook.flush(selected).catch(() => undefined);
                        returnToList.current = true;
                        setDetail(false);
                    }}>{t('musicNotes.back')}</Button></div>}
                    {selected ? <MusicNoteEditor key={key} {...{ notebook, port, notify, tags, first, bodyRef }} song={selected}
                        revision={revision} playbackState={key === displayedKey ? playbackState : 'stopped'} onImport={openImport} /> :
                        <div className="space-y-4 text-center"><p className="text-sm text-[color:var(--st-t2)]">{t('musicNotes.noCurrent')}</p>
                            <Button onClick={openImport}>{t('musicNotes.importPlaylist')}</Button></div>}
                </section>
            </div>}
        </div>
    </SettingsKitThemeContext.Provider>;
}

export default MusicNotesWindow;
