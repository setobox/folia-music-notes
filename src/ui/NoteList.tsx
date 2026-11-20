import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Square, SquareCheck, Trash2 } from 'lucide-react';
import { Button, TextField } from '../kit';
import { Popover } from '../kit/Popover';
import { SheetButton } from '../kit/Sheet';
import { filterNotes, NotesConflictError, songKey, type MusicNote, type NoteSong } from '../core';
import { tagKey } from '../core/notesModel';
import type { MusicNotesPort } from '../hostTypes';
import type { Notebook } from '../notebook';
import { NotebookSheet } from './NotebookActions';
import { NoteCover } from './NoteCover';
import { CHIP } from './NoteTags';

// Measure real chip widths so long names and translated labels also fit the sidebar's single line.
function TagFilter({ tags, active, onChange }: {
    tags: readonly string[]; active: string; onChange: (key: string) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [count, setCount] = useState(0);
    const [measureLimit, setMeasureLimit] = useState(16);
    const frame = useRef<HTMLDivElement>(null);
    const ruler = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const selected = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const all = t('musicNotes.all');
    const viewAll = t('musicNotes.viewAll');
    const activeIndex = tags.findIndex(name => tagKey(name) === active);
    const activeName = tags[activeIndex];
    useLayoutEffect(() => {
        const measure = () => {
            if (!frame.current || !ruler.current) return;
            const [allWidth, viewAllWidth, activeWidth, ...widths] = [...ruler.current.children].map(node => node.getBoundingClientRect().width);
            const gap = parseFloat(getComputedStyle(ruler.current).columnGap) || 0;
            const room = frame.current.clientWidth - allWidth;
            if (widths.reduce((sum, width) => sum + gap + width, 0) <= room) {
                if (widths.length < tags.length) {
                    setMeasureLimit(limit => limit * 2);
                } else {
                    setCount(tags.length);
                    setOpen(false);
                }
                return;
            }
            const fitting = (triggerWidth: number) => {
                let remaining = room - gap - triggerWidth;
                const index = widths.findIndex(width => {
                    remaining -= gap + width;
                    return remaining < 0;
                });
                return index === -1 ? widths.length : index;
            };
            const defaultCount = fitting(viewAllWidth);
            // Keep a selected overflow tag on the trigger even when its name is shorter than “View all”.
            const visible = activeIndex >= defaultCount ? Math.min(defaultCount, fitting(activeWidth)) : defaultCount;
            setCount(visible);
        };
        measure();
        if (typeof ResizeObserver === 'undefined' || !frame.current || !ruler.current) return;
        const observer = new ResizeObserver(measure);
        observer.observe(frame.current); observer.observe(ruler.current);
        return () => observer.disconnect();
    }, [tags, all, viewAll, activeIndex, measureLimit]);
    const names = tags.slice(0, count);
    const hasOverflow = count < tags.length;
    const activeInOverflow = activeIndex >= count;
    const base = `${CHIP} px-2 text-[color:var(--st-t2)] aria-pressed:bg-[var(--st-fill)] aria-pressed:text-[color:var(--st-t1)]`;
    const chip = (name: string, panel: boolean) => {
        const key = tagKey(name);
        return <button type="button" key={key} ref={panel && key === active ? selected : undefined}
            aria-pressed={active === key} className={`${base} max-w-full`} onClick={() => { onChange(key); setOpen(false); }}>
            <span className="truncate">{name}</span>
        </button>;
    };
    return <div ref={frame} className="relative min-w-0">
        <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
            <div ref={ruler} className="flex w-max gap-1.5">
                {[all, viewAll, activeName ?? viewAll, ...tags.slice(0, measureLimit)].map((name, index) => <span key={index} className={base}>{name}</span>)}
            </div>
        </div>
        <div role="group" aria-label={t('musicNotes.filterTag')} className="relative flex min-w-0 items-center gap-1.5">
            <button type="button" className={base} aria-pressed={!active} onClick={() => onChange('')}>{all}</button>
            {names.map(name => chip(name, false))}
            {hasOverflow && <span className="inline-flex min-w-0">
                <button type="button" ref={button} className={`${base} max-w-full`} aria-pressed={activeInOverflow}
                    aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
                    <span className="truncate">{activeInOverflow ? activeName : viewAll}</span>
                </button>
            </span>}
        </div>
        {open && hasOverflow && <Popover open id={menuId} role="dialog" aria-label={t('musicNotes.filterTag')} anchorRef={button} matchWidthRef={frame}
            focusRef={selected} onClose={() => setOpen(false)}>
            <div className="st-scroll relative min-h-0 max-h-52 overflow-y-auto overscroll-contain p-2"
                onFocus={event => event.target.scrollIntoView?.({ block: 'nearest' })}
                onKeyDown={event => {
                    if (event.altKey || event.ctrlKey || event.metaKey) return;
                    if (event.key === 'Tab') { setOpen(false); return; }
                    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([inert] *)')];
                    const index = items.indexOf(event.target as HTMLButtonElement);
                    let next: number;
                    if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = items.length - 1;
                    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % items.length;
                    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
                    else return;
                    event.preventDefault(); event.stopPropagation();
                    items[next]?.focus({ preventScroll: true });
                }}>
                <div className="relative flex flex-wrap items-center gap-1.5">
                    {tags.map(name => chip(name, true))}
                </div>
            </div>
        </Popover>}
    </div>;
}

function summary(note: MusicNote): string {
    const firstLine = note.note.trim().split(/\r?\n/u, 1)[0];
    const lastMoment = note.bookmarks.at(-1)?.text.trim();
    return firstLine || lastMoment || note.tags.join(' · ');
}

export function NoteList({ notes, tags, port, current, paused, selection, select, notebook, notify }: {
    notes: readonly MusicNote[];
    tags: readonly string[];
    port: MusicNotesPort;
    current: NoteSong | null;
    paused: boolean;
    selection: string | null;
    select: (song: NoteSong, focusBody: boolean, openDetail: boolean) => void;
    notebook: Notebook;
    notify: (message: string) => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const [filter, setFilter] = useState('');
    const [limit, setLimit] = useState(50);
    const [checked, setChecked] = useState<Set<string> | null>(null);
    const [confirming, setConfirming] = useState<MusicNote[] | null>(null);
    const [deleting, setDeleting] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const scroll = useRef<HTMLDivElement>(null);
    const chosen = useMemo(() => checked ? notes.filter(note => checked.has(note.key)) : [], [checked, notes]);
    const exitSelection = () => {
        setChecked(null);
        requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    };
    const deleteSelected = async () => {
        if (!confirming || deleting) return;
        setDeleting(true);
        try {
            await notebook.removeMany(confirming);
            exitSelection();
        } catch (error) {
            console.warn('[MusicNotes] batch delete failed', error);
            notify(t(error instanceof NotesConflictError ? 'musicNotes.deleteConflict' : 'musicNotes.failed'));
        } finally {
            setConfirming(null);
            setDeleting(false);
        }
    };
    const tag = tags.find(name => tagKey(name) === filter);
    useEffect(() => {
        const timer = setTimeout(() => { setDebounced(query); setLimit(50); }, 180);
        return () => clearTimeout(timer);
    }, [query]);
    const visible = useMemo(() => !debounced.trim() && !tag ? notes : filterNotes(notes, debounced, tag), [notes, debounced, tag]);
    const allSelected = checked !== null && visible.length > 0 && visible.every(note => checked.has(note.key));
    const toggleAll = () => {
        if (!checked) return;
        const next = new Set(checked);
        for (const note of visible) {
            if (allSelected) next.delete(note.key);
            else next.add(note.key);
        }
        setChecked(next);
    };
    const currentKey = current && songKey(current);
    const currentNote = currentKey ? notes.find(note => note.key === currentKey) : undefined;
    const rows = visible.slice(0, limit);
    const choose = (key: string) => { setFilter(key); setLimit(50); };
    const row = (song: NoteSong, note?: MusicNote) => {
        const key = songKey(song);
        const CheckedIcon = checked?.has(key) ? SquareCheck : Square;
        return <button type="button" key={key} data-song-key={key} role={checked ? 'checkbox' : undefined}
            aria-checked={checked?.has(key)} aria-pressed={checked ? undefined : key === selection}
            className="group st-focus-inside flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--st-fill)] aria-pressed:bg-[var(--st-fill2)] aria-checked:bg-[var(--st-fill2)]"
            onClick={() => {
                if (!checked) { select(song, !note, true); return; }
                setChecked(previous => {
                    if (!previous) return previous;
                    const next = new Set(previous);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                });
            }}>
            {checked && <CheckedIcon aria-hidden size={16} className="shrink-0 text-[color:var(--st-t2)]" />}
            <NoteCover song={song} port={port} />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-[color:var(--st-t1)]">{[song.title, song.artist].filter(Boolean).join(' · ')}</span>
                <span className="truncate text-xs text-[color:var(--st-t2)]">{note ? summary(note) || t('musicNotes.noContent') : t('musicNotes.writeNote')}</span>
            </span>
            {!!note?.bookmarks.length && <span className={`text-xs tabular-nums text-[color:var(--st-t3)] ${key === selection ? '' : 'music-notes-hover'}`}>
                {t('musicNotes.momentCount', { count: note.bookmarks.length })}
            </span>}
        </button>;
    };
    return <aside className="music-notes-list flex flex-col gap-4 p-4" aria-label={t('musicNotes.allNotes')}>
        <div className="shrink-0 space-y-2">
            <label className="block [&_input]:w-full"><span className="sr-only">{t('musicNotes.searchHint')}</span>
                <TextField value={query} onChange={setQuery} placeholder={t('musicNotes.searchHint')} /></label>
            <TagFilter tags={tags} active={tag ? filter : ''} onChange={choose} />
        </div>
        <div ref={scroll} className="st-scroll min-h-0 space-y-4 overflow-y-auto overscroll-contain" onKeyDown={event => {
            if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-song-key]:not([inert] *)')];
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index === -1) return;
            event.preventDefault(); event.stopPropagation();
            const target = buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
            const key = target.dataset.songKey;
            const selected = key === currentKey ? current : rows.find(note => note.key === key)?.song;
            if (!checked && selected) select(selected, false, false);
            target.focus();
        }}>
            {!checked && current && <section><h3 className="mb-2 px-2 text-xs font-medium text-[color:var(--st-t2)]">
                {t(paused ? 'musicNotes.paused' : 'musicNotes.nowPlaying')}
            </h3>{row(current, currentNote)}</section>}
            <section>
                <div className={`mb-2 flex flex-wrap items-center justify-between gap-1 px-2 ${checked ? 'sticky top-0 z-10 bg-[var(--st-win)]' : ''}`}>
                    <h3 className="text-xs font-medium text-[color:var(--st-t2)]">{t('musicNotes.allNotes')}</h3>
                    {checked ? <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
                        <Button variant="quiet" disabled={!visible.length || query.trim() !== debounced.trim()} onClick={toggleAll}>
                            {t(allSelected ? 'musicNotes.deselectAll' : 'musicNotes.selectAll')}
                        </Button>
                        <Button variant="quiet" data-cancel-note-selection="" onClick={exitSelection}>{t('musicNotes.cancel')}</Button>
                        <Button variant="quiet" icon={Trash2} disabled={!chosen.length} onClick={() => setConfirming(chosen)}>
                            {t('musicNotes.deleteSelected', { count: chosen.length })}
                        </Button>
                    </div> : <Button buttonRef={trigger} variant="quiet" onClick={() => {
                        setChecked(new Set());
                        requestAnimationFrame(() => {
                            const target = scroll.current?.querySelector<HTMLButtonElement>('[role="checkbox"]') ??
                                scroll.current?.querySelector<HTMLButtonElement>('[data-cancel-note-selection]');
                            target?.focus({ preventScroll: true });
                        });
                    }}>{t('musicNotes.bulkDelete')}</Button>}
                </div>
                <div className="relative min-w-0">
                    {rows.map(note => row(note.song, note))}
                </div>
                {visible.length > limit && <Button variant="quiet" onClick={() => setLimit(value => value + 50)}>{t('musicNotes.showMore')}</Button>}
                {!visible.length && (debounced.trim() || tag) && <div className="flex items-center gap-2 px-2 py-2 text-sm text-[color:var(--st-t2)]">
                    {t('musicNotes.noMatches')} <Button variant="quiet" onClick={() => { setQuery(''); setDebounced(''); choose(''); }}>{t('musicNotes.clearSearch')}</Button>
                </div>}
            </section>
        </div>
        <NotebookSheet open={confirming !== null} title={t('musicNotes.bulkDelete')} busy={deleting} onClose={() => setConfirming(null)}
            footer={<>
                <SheetButton data-autofocus disabled={deleting} onClick={() => setConfirming(null)}>{t('musicNotes.cancel')}</SheetButton>
                <SheetButton variant="danger" disabled={deleting} onClick={() => { void deleteSelected(); }}>{t('musicNotes.confirmRemove')}</SheetButton>
            </>}>
            <p className="text-sm"><Trans i18nKey="musicNotes.confirmBulkDelete" count={confirming?.length ?? 0}
                components={{ strong: <strong className="font-bold" /> }} /></p>
        </NotebookSheet>
    </aside>;
}
