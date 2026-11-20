import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Chips, Group, Row, Status, TextField } from '../kit';
import type { MusicNotesPort, NoteImportPlaylist } from '../hostTypes';

// Playlist selection stays inside the mod's surface; only the port knows the host's account APIs.
export default function MusicNotesImport({ port, disabled, onImport }: { port: MusicNotesPort; disabled: boolean; onImport: (playlist: NoteImportPlaylist) => Promise<void> }) {
    const { t } = useTranslation();
    const accounts = port.accounts();
    const [source, setSource] = useState('');
    const [playlists, setPlaylists] = useState<NoteImportPlaylist[]>([]);
    const [selected, setSelected] = useState<NoteImportPlaylist | null>(null);
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(30);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const abort = useRef<AbortController | null>(null);
    useEffect(() => () => abort.current?.abort(), []);

    const load = async (next: string) => {
        if (disabled) return;
        abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
        setSource(next); setSelected(null); setPlaylists([]); setLoading(true); setError(false); setLimit(30);
        try { const rows = await port.playlists(next, controller.signal); if (!controller.signal.aborted) setPlaylists(rows); }
        catch (cause: unknown) { if (!controller.signal.aborted) { console.warn('[MusicNotes] playlist read failed', cause); setError(true); } }
        finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const visible = playlists.filter(playlist => playlist.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const locked = disabled || loading;
    return (
        <section data-music-notes="import">
            <Group def={{ id: 'music-notes-import', titleKey: 'musicNotes.importPlaylist' }} foot={t('musicNotes.importHint')}>
                {accounts.length === 0 ? <Row notice={t('musicNotes.loginHint')} /> : <>
                    <Row label={t('musicNotes.account')} below={<Chips disabled={locked} items={accounts.map(account => ({ id: `${account.source}:${account.id}`, label: account.name, checked: source === account.source, onChange: () => { void load(account.source); } }))} />} />
                    <Row label={t('musicNotes.playlistSearch')}><TextField value={query} disabled={locked} onChange={value => { setQuery(value); setLimit(30); }} placeholder={t('musicNotes.playlistSearchHint')} /></Row>
                    <Row label={t('musicNotes.playlist')} hint={selected?.name ?? t(source ? 'musicNotes.choosePlaylist' : 'musicNotes.chooseAccount')}>
                        <Button icon={RefreshCw} disabled={locked || !source} onClick={() => { void load(source); }}>{t('musicNotes.refreshPlaylists')}</Button>
                        <Button variant="primary" icon={Download} disabled={locked || !selected} onClick={() => { if (selected) void onImport(selected); }}>{t('musicNotes.import')}</Button>
                    </Row>
                    {loading && <Row label={<Status>{t('musicNotes.loading')}</Status>} />}
                    {error && <Row label={<Status tone="error">{t('musicNotes.importFailed')}</Status>} />}
                    {!loading && source && visible.length === 0 && <Row label={t('musicNotes.noPlaylists')} />}
                    {visible.slice(0, limit).map(playlist => <Row key={`${playlist.accountId}:${playlist.id}`} label={playlist.name} hint={playlist.trackCount === undefined ? undefined : t('musicNotes.trackCount', { count: playlist.trackCount })} tag={selected === playlist ? t('musicNotes.selected') : undefined} disabled={locked} onClick={() => setSelected(playlist)} />)}
                    {visible.length > limit && <Row><Button disabled={locked} onClick={() => setLimit(value => value + 30)}>{t('musicNotes.showMore')}</Button></Row>}
                </>}
            </Group>
        </section>
    );
}
