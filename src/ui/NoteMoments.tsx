import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Pin, Play, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../kit';
import { Tooltip } from '../kit/Tooltip';
import { NOTES_LIMITS, type NoteSong } from '../core';
import type { MusicNotesPort } from '../hostTypes';
import type { Notebook } from '../notebook';

// Keep playback clock updates local to the header button.
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export type SongPanelProps = { notebook: Notebook; port: MusicNotesPort; song: NoteSong; notify: (message: string) => void };

export function MarkMomentButton({ port, onMark }: { port: MusicNotesPort; onMark: () => void }) {
    const { t } = useTranslation();
    const timeId = useId();
    const [second, setSecond] = useState(() => Math.floor(port.currentTime()));
    useEffect(() => {
        const timer = window.setInterval(() => setSecond(Math.floor(port.currentTime())), 1000);
        return () => window.clearInterval(timer);
    }, [port]);
    const label = t('musicNotes.markHere');
    return <Tooltip text={label} className="inline-flex shrink-0">
        <button type="button" aria-label={label} aria-describedby={timeId} onClick={onMark}
            className="st-t-fast inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-yellow-400 px-2.5 text-xs text-zinc-950 hover:opacity-90 active:scale-[0.97]">
            <Pin size={14} aria-hidden="true" />
            <span id={timeId} className="tabular-nums">{timeLabel(second)}</span>
        </button>
    </Tooltip>;
}

export function NoteMoments({ notebook, port, song, notify, focusRequest, showHint }: SongPanelProps & {
    focusRequest: { id: string } | null; showHint: boolean;
}) {
    const { t } = useTranslation();
    const inputs = useRef(new Map<string, HTMLInputElement>());
    const marks = [...notebook.getDraft(song).bookmarks].sort((a, b) => a.positionSeconds - b.positionSeconds);
    useLayoutEffect(() => {
        if (!focusRequest) return;
        const field = inputs.current.get(focusRequest.id);
        field?.focus({ preventScroll: true });
        field?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [focusRequest]);
    const jump = async (seconds: number) => {
        try { if (await port.playAt(song, seconds)) return; } catch { /* Use the same toast when the source rejects playback. */ }
        notify(t('musicNotes.unavailable'));
    };
    const rows = marks.map(mark => <div key={mark.id} className="group flex min-w-0 items-center gap-2 border-b border-[var(--st-line)] py-1">
        <button type="button" className="rounded-md px-1 py-1 text-sm tabular-nums text-[color:var(--st-t2)] hover:bg-[var(--st-fill)]"
            onClick={() => { void jump(mark.positionSeconds); }}>{timeLabel(mark.positionSeconds)}</button>
        <input type="text" value={mark.text} ref={node => { if (node) inputs.current.set(mark.id, node); else inputs.current.delete(mark.id); }}
            maxLength={NOTES_LIMITS.bookmarkText} placeholder={t('musicNotes.bookmarkPlaceholder')}
            aria-label={`${timeLabel(mark.positionSeconds)} · ${t('musicNotes.bookmarkPlaceholder')}`}
            className="min-w-0 flex-1 bg-transparent py-1 text-sm text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)]"
            onChange={event => { const text = event.currentTarget.value; notebook.edit(song, draft => ({
                ...draft, bookmarks: draft.bookmarks.map(item => item.id === mark.id ? { ...item, text } : item),
            })); }}
            onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) event.currentTarget.blur();
            }}
            onBlur={() => { void notebook.flush(song).catch(() => undefined); }} />
        <div className="music-notes-hover flex shrink-0 gap-1">
            <Button variant="quiet" icon={Play} tip={t('musicNotes.play')} onClick={() => { void jump(mark.positionSeconds); }} />
            <Button variant="quiet" icon={Trash2} tip={t('musicNotes.removeBookmark')} onClick={() => notebook.edit(song, draft => ({
                ...draft, bookmarks: draft.bookmarks.filter(item => item.id !== mark.id),
            }), true)} />
        </div>
    </div>);
    return <section data-music-notes="bookmarks" className="space-y-2 border-t border-[var(--st-line)] pt-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">{t('musicNotes.bookmarks')} <span className="font-normal tabular-nums text-[color:var(--st-t3)]">{marks.length}</span></h3>
        {rows.length ? <div>{rows}</div> : showHint && <p className="text-sm text-[color:var(--st-t2)]">{t('musicNotes.markHint')}</p>}
    </section>;
}
