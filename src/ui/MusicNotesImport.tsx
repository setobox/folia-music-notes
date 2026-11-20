import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Chips, Status, TextField } from '../kit';
import { LoadingBars } from '../kit/LoadingBars';
import type { MusicNotesPort, NoteImportAccount, NoteImportPlaylist } from '../hostTypes';

// Load the selected account's playlists inside the import sheet.
export default function MusicNotesImport({ port, disabled, onImport }: {
    port: MusicNotesPort; disabled: boolean; onImport: (playlist: NoteImportPlaylist) => Promise<void>;
}) {
    const { t } = useTranslation();
    const accounts = port.accounts();
    const [account, setAccount] = useState<NoteImportAccount | null>(null);
    const [playlists, setPlaylists] = useState<NoteImportPlaylist[]>([]);
    const [selected, setSelected] = useState<NoteImportPlaylist | null>(null);
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(30);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const abort = useRef<AbortController | null>(null);
    const list = useRef<HTMLDivElement>(null);
    useEffect(() => () => abort.current?.abort(), []);
    const active = account && accounts.find(item => item.source === account.source && item.id === account.id);
    const clearAccount = () => {
        abort.current?.abort();
        setAccount(null); setPlaylists([]); setSelected(null); setLoading(false); setError(false);
    };
    useEffect(() => {
        if (account && !active) clearAccount();
    }, [account, active?.id]);

    const load = async (next: NoteImportAccount) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setAccount(next); setSelected(null); setPlaylists([]); setLoading(true); setError(false); setLimit(30); setQuery('');
        try {
            const rows = await port.playlists(next.source, controller.signal);
            if (!controller.signal.aborted) setPlaylists(rows);
        } catch (cause) {
            if (!controller.signal.aborted) { console.warn('[MusicNotes] playlist read failed', cause); setError(true); }
        } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const term = query.trim().toLocaleLowerCase();
    const visible = active ? playlists.filter(playlist => playlist.accountId === active.id && playlist.source === active.source
        && playlist.name.toLocaleLowerCase().includes(term)) : [];
    const shown = visible.slice(0, limit);
    const choice = selected && shown.includes(selected) ? selected : null;
    const busyLabel = disabled ? t('musicNotes.importing') : active && loading ? t('musicNotes.loading') : null;
    const showList = Boolean(active && !loading && !error);
    return <section data-music-notes="import" className="flex min-h-0 flex-col items-start gap-3">
        {accounts.length ? <div className="max-w-full shrink-0"><Chips disabled={disabled} items={accounts.map(account => ({
            id: `${account.source}:${account.id}`, label: account.name, checked: active?.source === account.source && active.id === account.id,
            onChange: checked => { if (checked) void load(account); else clearAccount(); },
        }))} /></div> : <Status>{t('musicNotes.loginHint')}</Status>}
        {active && error && <Button onClick={() => void load(active)}>{t('musicNotes.retry')}</Button>}
        {showList && <>
            <div className="max-w-full shrink-0">
                <TextField value={query} disabled={disabled} onChange={value => {
                    setQuery(value); setLimit(30);
                    if (list.current) list.current.scrollTop = 0;
                }} placeholder={t('musicNotes.playlistSearchHint')} />
            </div>
            <div ref={list} className="st-scroll max-h-96 min-h-0 w-full overflow-y-auto overscroll-contain"
                role="group" aria-label={t('musicNotes.playlist')} aria-busy={disabled}>
                {shown.map(playlist => <button type="button" key={playlist.id} disabled={disabled}
                    aria-pressed={choice === playlist} onClick={() => setSelected(previous => previous === playlist ? null : playlist)}
                    className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--st-fill)] aria-pressed:bg-[var(--st-fill2)]">
                    {playlist.name}
                </button>)}
                {!visible.length && <Status>{t('musicNotes.noPlaylists')}</Status>}
            </div>
        </>}
        {(showList || busyLabel) && <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2">
            {busyLabel && <span role="status" className="mr-auto inline-flex items-center gap-2 text-sm text-[color:var(--st-t2)]">
                <LoadingBars size={20} />{busyLabel}
            </span>}
            {showList && <>
                {visible.length > limit && <Button disabled={disabled} onClick={() => setLimit(value => value + 30)}>{t('musicNotes.showMore')}</Button>}
                <Button disabled={disabled || !choice} icon={Download} onClick={() => { if (choice) void onImport(choice); }}>{t('musicNotes.import')}</Button>
            </>}
        </div>}
    </section>;
}
