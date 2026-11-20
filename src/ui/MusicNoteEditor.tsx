import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FoliumPlaybackState } from '../../types/folium';
import { Button } from '../kit';
import { GROUP_CARD_CLASS } from '../kit/Group';
import { NOTES_LIMITS, NotesCapacityError, songKey } from '../core';
import { DeleteNoteAction } from './NotebookActions';
import { NoteTags } from './NoteTags';
import { NoteCover } from './NoteCover';
import { MarkMomentButton, NoteMoments, type SongPanelProps } from './NoteMoments';

// The first-note card and the detail pane share the same editor and focused textarea.
export default function MusicNoteEditor({ notebook, port, song, playbackState, notify, tags, first, revision, bodyRef, onImport }: SongPanelProps & {
    playbackState: FoliumPlaybackState;
    tags: readonly string[]; first: boolean; revision?: number; bodyRef: RefObject<HTMLTextAreaElement | null>; onImport: () => void;
}) {
    const { t } = useTranslation();
    const draft = notebook.getDraft(song);
    const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
    const isCurrentSong = () => {
        const current = port.currentSong();
        return current !== null && songKey(current) === songKey(song);
    };
    const controlPlayback = async () => {
        try {
            if (playbackState === 'playing') { port.pause(song); return; }
            if (playbackState === 'paused' && (!isCurrentSong() || port.playbackState() !== 'paused')) return;
            if (await port.play(song)) return;
        } catch { /* Surface rejected playback in the same way as an unavailable source. */ }
        notify(t('musicNotes.unavailable'));
    };
    const mark = () => {
        if (!isCurrentSong() || port.playbackState() === 'stopped') return;
        try { setFocusRequest({ id: notebook.mark(song, port.currentTime()) }); }
        catch (error) { notify(t(error instanceof NotesCapacityError ? 'musicNotes.capacity' : 'musicNotes.failed')); }
    };
    const resize = () => {
        const field = bodyRef.current;
        if (field) { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px`; }
    };
    useLayoutEffect(resize, [draft.note, bodyRef, first]);
    useEffect(() => {
        const field = bodyRef.current;
        if (!field?.parentElement || typeof ResizeObserver === 'undefined') return;
        let width = field.clientWidth;
        const observer = new ResizeObserver(() => {
            if (field.clientWidth !== width) { width = field.clientWidth; resize(); }
        });
        observer.observe(field.parentElement);
        return () => observer.disconnect();
    }, [bodyRef]);
    return <div data-music-notes="editor" className={`music-notes-editor flex w-full flex-col gap-4 ${first ? GROUP_CARD_CLASS + ' p-4 md:p-6 [&.st-card]:overflow-visible' : ''}`}>
        {first && <h2 className="text-xl font-semibold">{t('musicNotes.firstNote')}</h2>}
        <header className="flex min-w-0 flex-wrap items-center gap-3">
            <NoteCover song={song} port={port} large />
            <div className="min-w-0 flex-1 basis-32 space-y-1">
                <h2 className="break-words text-lg font-semibold">{song.title}</h2>
                <p className="text-sm text-[color:var(--st-t2)]">{[song.artist, song.album].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-3">
                <Button variant="primary" icon={playbackState === 'playing' ? Square : Play} onClick={() => { void controlPlayback(); }}>
                    {t(playbackState === 'playing' ? 'musicNotes.stop' : playbackState === 'paused' ? 'musicNotes.resume' : 'musicNotes.play')}
                </Button>
                {playbackState !== 'stopped' && <MarkMomentButton port={port} onMark={mark} />}
                {revision !== undefined && !first && <DeleteNoteAction notebook={notebook} song={song} revision={revision} notify={notify} />}
            </div>
        </header>
        <NoteTags tags={draft.tags} options={tags} notify={notify}
            change={update => notebook.edit(song, old => ({ ...old, tags: update(old.tags) }), true)} />
        <div data-music-notes="note">
            <textarea ref={bodyRef} rows={2} value={draft.note} aria-label={t('musicNotes.reason')} placeholder={t('musicNotes.reasonPlaceholder')}
                maxLength={NOTES_LIMITS.note} className="block min-h-12 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-base font-normal text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)]"
                onChange={event => { const note = event.currentTarget.value; notebook.edit(song, old => ({ ...old, note })); }}
                onBlur={() => { void notebook.flush(song).catch(() => undefined); }} />
        </div>
        {first ? <div><Button onClick={onImport}>{t('musicNotes.importPlaylist')}</Button></div> :
            <NoteMoments {...{ notebook, port, song, notify, focusRequest }} showHint={playbackState === 'stopped'} />}
    </div>;
}
