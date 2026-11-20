import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Download, FileUp, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Chips, Group, PageHeader, Row, Status, Tabs, TextField } from '../kit';
import { SettingsKitThemeContext, settingsTokens } from '../kit/kitTheme';
import { kitMotionTokens, useKitReducedMotion } from '../kit/motion';
import type { FoliumTheme } from '../../types/folium';
import { filterNotes, nextBookmarkId, NOTES_LIMITS, NotesCapacityError, songKey, type NoteSong } from '../core';
import { normalizeTags, tagKey } from '../core/notesModel';
import type { MusicNotesPort } from '../hostTypes';
import MusicNoteEditor from './MusicNoteEditor';
import MusicNotesImport from './MusicNotesImport';
import { useMusicNotesLibrary } from './useMusicNotesLibrary';
import './musicNotes.css';

// A self-contained mod page: the host supplies only playback, accounts, language and theme.
const TAGS_PER_PAGE = 32;

export interface MusicNotesWindowProps {
    port: MusicNotesPort;
    locale: string;
    theme: FoliumTheme;
    requestId: number;
    requestedSong: NoteSong | null;
    onClose: () => void;
}

export function MusicNotesWindow({ port, locale, theme, requestId, requestedSong, onClose }: MusicNotesWindowProps) {
    const { t } = useTranslation();
    const library = useMusicNotesLibrary(requestId, requestedSong, onClose);
    const [tab, setTab] = useState('collection');
    const [query, setQuery] = useState('');
    const [selectedTagKey, setSelectedTagKey] = useState('');
    const [tagPage, setTagPage] = useState(0);
    const [limit, setLimit] = useState(50);
    const [, updateHost] = useState(0);
    const fileInput = useRef<HTMLInputElement>(null);
    const downloadLink = useRef<HTMLAnchorElement>(null);
    const download = useRef<{ url: string; timer: ReturnType<typeof setTimeout> } | null>(null);
    const reduced = useKitReducedMotion();
    const locked = library.busy || !library.ready || Boolean(library.confirmation);
    const current = port.currentSong();
    const canBookmark = Boolean(current && library.song && songKey(current) === songKey(library.song));
    const tags = useMemo(() => normalizeTags(library.notes.flatMap(note => note.tags)).sort((a, b) => a.localeCompare(b)), [library.notes]);
    const selectedTag = useMemo(() => selectedTagKey ? tags.find(value => tagKey(value) === selectedTagKey) : undefined, [selectedTagKey, tags]);
    const lastTagPage = Math.max(0, Math.ceil(tags.length / TAGS_PER_PAGE) - 1);
    const currentTagPage = Math.min(tagPage, lastTagPage);
    const pageTags = tags.slice(currentTagPage * TAGS_PER_PAGE, (currentTagPage + 1) * TAGS_PER_PAGE);
    const visible = useMemo(() => filterNotes(library.notes, query, selectedTag), [library.notes, query, selectedTag]);

    useEffect(() => port.subscribe(() => updateHost(value => value + 1)), [port]);
    useEffect(() => { if (requestedSong) setTab('collection'); }, [requestId, requestedSong]);
    useEffect(() => { if (selectedTagKey && !selectedTag) setSelectedTagKey(''); }, [selectedTagKey, selectedTag]);
    useEffect(() => () => {
        if (download.current) { clearTimeout(download.current.timer); URL.revokeObjectURL(download.current.url); }
    }, []);

    const exportBackup = () => library.run(async (db, signal) => {
        const json = await db.exportBackup();
        if (signal.aborted || !downloadLink.current) return;
        if (download.current) { clearTimeout(download.current.timer); URL.revokeObjectURL(download.current.url); }
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        downloadLink.current.href = url;
        downloadLink.current.download = `folia-music-notes-${new Date().toISOString().slice(0, 10)}.json`;
        downloadLink.current.click();
        download.current = { url, timer: setTimeout(() => { URL.revokeObjectURL(url); download.current = null; }, 1000) };
        library.setNotice({ key: 'musicNotes.exported', tone: 'ok' });
    });
    const importBackup = (file: File) => library.run(async (db, signal) => {
        if (file.size > NOTES_LIMITS.backupCharacters * 4) throw new NotesCapacityError();
        const json = await file.text();
        signal.throwIfAborted();
        const result = await db.importBackup(json);
        if (signal.aborted) return;
        await library.refresh(db); library.setNotice({ key: 'musicNotes.imported', tone: 'ok', values: result });
    });
    const style = { ...settingsTokens(theme.isDaylight, theme), ...kitMotionTokens(reduced), '--text-primary': theme.primaryColor } as CSSProperties;

    return (
        <SettingsKitThemeContext.Provider value={{ isDaylight: theme.isDaylight, theme }}>
            <div className="st-window music-notes-page" style={style} lang={locale} aria-busy={library.busy}>
                <PageHeader title={t('musicNotes.title')} contents={[]} activeId={null} onSelect={() => undefined} summary={t('musicNotes.privateHint')} closeLabel={t('musicNotes.close')} onClose={library.close} />
                <Tabs label={t('musicNotes.sections')} tabs={['collection', 'importTab', 'backup'].map((key, index) => ({ id: ['collection', 'import', 'backup'][index], label: t(`musicNotes.${key}`) }))} activeId={tab} onSelect={setTab} className="px-4 pt-1 md:px-8" />
                <div className="music-notes-content st-scroll">
                    {library.confirmation && <Group def={{ id: 'music-notes-confirm', titleKey: `musicNotes.${library.confirmation.kind}Title` }}>
                        <Row notice={t(`musicNotes.${library.confirmation.kind}Description`)}>
                            <Button disabled={library.busy} onClick={library.cancel}>{t('musicNotes.cancel')}</Button>
                            <Button variant="primary" disabled={library.busy} onClick={library.confirm}>{t(library.confirmation.kind === 'remove' ? 'musicNotes.confirmRemove' : 'musicNotes.discard')}</Button>
                        </Row>
                    </Group>}
                    {library.notice && <div className="music-notes-notice"><Status tone={library.notice.tone}>{t(library.notice.key, library.notice.values)}</Status></div>}
                    <div hidden={tab !== 'collection'} className="music-notes-columns" data-music-notes="collection">
                        <section>
                            <Group def={{ id: 'music-notes-library', titleKey: 'musicNotes.collection' }}>
                                <Row label={t('musicNotes.current')} hint={current ? `${current.title} · ${current.artist}` : t('musicNotes.noCurrent')}>
                                    <Button icon={Plus} disabled={locked || !current} onClick={() => { if (current) library.select(current); }}>{t('musicNotes.current')}</Button>
                                </Row>
                                <Row label={t('musicNotes.search')}><TextField value={query} disabled={!library.ready} placeholder={t('musicNotes.searchHint')} onChange={value => { setQuery(value); setLimit(50); }} /></Row>
                                {tags.length > 0 && <Row label={t('musicNotes.filterTag')} hint={selectedTag} below={<Chips items={pageTags.map(value => ({
                                    id: tagKey(value), label: value, checked: value === selectedTag,
                                    onChange: checked => { setSelectedTagKey(checked ? tagKey(value) : ''); setLimit(50); },
                                }))} />}>
                                    {lastTagPage > 0 && <>
                                        <Button disabled={currentTagPage === 0} onClick={() => setTagPage(currentTagPage - 1)}>{t('musicNotes.previousTags')}</Button>
                                        <Button disabled={currentTagPage === lastTagPage} onClick={() => setTagPage(currentTagPage + 1)}>{t('musicNotes.nextTags')}</Button>
                                    </>}
                                </Row>}
                                <Row label={t('musicNotes.count', { count: visible.length })}>
                                    <Button icon={RefreshCw} disabled={locked} onClick={library.reload}>{t('musicNotes.refresh')}</Button>
                                </Row>
                                {!library.ready && !library.notice && <Row label={<Status>{t('musicNotes.loading')}</Status>} />}
                                {library.ready && visible.length === 0 && <Row label={t(library.notes.length ? 'musicNotes.noMatches' : 'musicNotes.empty')} hint={t('musicNotes.emptyHint')} />}
                                {visible.slice(0, limit).map(note => <Row key={note.key} label={note.song.title} hint={[note.song.artist, note.tags.join(' · ')].filter(Boolean).join(' — ')} tag={library.song && songKey(library.song) === note.key ? t('musicNotes.selected') : undefined} disabled={locked} onClick={() => library.select(note.song)} />)}
                                {visible.length > limit && <Row><Button onClick={() => setLimit(value => value + 50)}>{t('musicNotes.showMore')}</Button></Row>}
                            </Group>
                        </section>
                        {library.song ? <MusicNoteEditor key={`${songKey(library.song)}:${library.editorVersion}`} song={library.song} draft={library.draft} dirty={library.dirty} saved={Boolean(library.original)} busy={locked} canBookmark={canBookmark} onChange={library.setDraft} tagInput={library.tagInput} nextTags={library.nextTags} onTagInputChange={library.setTagInput} onSave={draft => { void library.save(draft); }} onRemove={library.remove} onPlay={() => {
                            void library.run(async (_db, signal) => {
                                if (library.song && !await port.play(library.song) && !signal.aborted) library.setNotice({ key: 'musicNotes.unavailable', tone: 'warn' });
                            });
                        }} onBookmark={() => library.setDraft(draft => ({ ...draft, bookmarks: [...draft.bookmarks, { id: nextBookmarkId(draft.bookmarks), positionSeconds: port.currentTime(), text: '' }] }))} onSeek={seconds => { if (library.song) port.seek(library.song, seconds); }} /> : <Group def={{ id: 'music-notes-start', titleKey: 'musicNotes.editor' }}><Row label={t('musicNotes.chooseSong')} hint={t('musicNotes.chooseSongHint')} /></Group>}
                    </div>
                    <div hidden={tab !== 'import'}><MusicNotesImport port={port} disabled={locked} onImport={playlist => library.run(async (db, signal) => {
                        const songs = await port.readPlaylist(playlist, signal);
                        signal.throwIfAborted();
                        const result = await db.importSongs(songs);
                        if (signal.aborted) return;
                        await library.refresh(db); library.setNotice({ key: 'musicNotes.imported', tone: 'ok', values: result });
                    })} /></div>
                    <div hidden={tab !== 'backup'} data-music-notes="backup">
                        <Group def={{ id: 'music-notes-backup', titleKey: 'musicNotes.backup' }} foot={t('musicNotes.backupHint')}>
                            <Row label={t('musicNotes.export')} hint={t('musicNotes.exportHint')}><Button icon={Download} disabled={locked} onClick={() => { void exportBackup(); }}>{t('musicNotes.export')}</Button></Row>
                            <Row label={t('musicNotes.restore')} hint={t('musicNotes.restoreHint')}><Button icon={FileUp} disabled={locked} onClick={() => fileInput.current?.click()}>{t('musicNotes.restore')}</Button></Row>
                        </Group>
                    </div>
                    <input ref={fileInput} hidden type="file" accept="application/json,.json" aria-label={t('musicNotes.restore')} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importBackup(file); }} />
                    <a ref={downloadLink} hidden aria-hidden="true" />
                </div>
            </div>
        </SettingsKitThemeContext.Provider>
    );
}

export default MusicNotesWindow;
