import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, ListMusic, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../kit/Button';
import Sheet, { SheetLayerContext } from '../kit/Sheet';
import { NOTES_LIMITS, NotesCapacityError, NotesConflictError, type NoteSong } from '../core';
import type { Notebook } from '../notebook';
import type { MusicNotesPort } from '../hostTypes';
import MusicNotesImport from './MusicNotesImport';

// Each sheet stays within the notebook's host-provided shadow root.
export function NotebookSheet({ open, title, onClose, busy, footer, fill, children }: {
    open: boolean; title: string; onClose: () => void; busy?: boolean; footer?: ReactNode; fill?: boolean; children: ReactNode;
}) {
    const [layer, setLayer] = useState<HTMLDivElement | null>(null);
    return <>
        <div ref={setLayer} className="contents" />
        <SheetLayerContext.Provider value={layer}>
            <Sheet isOpen={open} onClose={onClose} title={title} size={footer ? 's' : 'm'} body={fill ? 'fill' : 'scroll'}
                closeDisabled={busy} footer={footer}>{children}</Sheet>
        </SheetLayerContext.Provider>
    </>;
}

type ActionsProps = { notebook: Notebook; port: MusicNotesPort; notify: (message: string) => void; importRequest: number };

export function NotebookActions({ notebook, port, notify, importRequest }: ActionsProps) {
    const { t } = useTranslation();
    const [importOpen, setImportOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const importButton = useRef<HTMLButtonElement>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const lastImportRequest = useRef(importRequest);
    const input = useRef<HTMLInputElement>(null);
    const link = useRef<HTMLAnchorElement>(null);
    const operation = useRef<AbortController | null>(null);
    useEffect(() => {
        if (lastImportRequest.current !== importRequest) {
            lastImportRequest.current = importRequest;
            const scope = importButton.current?.getRootNode() as ShadowRoot | undefined;
            const active = scope?.activeElement;
            returnFocus.current = active instanceof HTMLElement ? active : importButton.current;
            setImportOpen(true);
        }
    }, [importRequest]);
    useEffect(() => () => operation.current?.abort(), []);

    const openImport = () => {
        returnFocus.current = importButton.current;
        setImportOpen(true);
    };
    const closeImport = () => {
        setImportOpen(false);
        requestAnimationFrame(() => {
            const target = returnFocus.current;
            (target?.isConnected ? target : importButton.current)?.focus({ preventScroll: true });
        });
    };

    const run = async (work: (signal: AbortSignal) => Promise<void>) => {
        if (operation.current) return;
        const controller = new AbortController();
        operation.current = controller;
        setBusy(true);
        try { await work(controller.signal); }
        catch (error) {
            if (!controller.signal.aborted) {
                console.warn('[MusicNotes] library operation failed', error);
                notify(t(error instanceof NotesCapacityError ? 'musicNotes.capacity' : 'musicNotes.failed'));
            }
        } finally {
            operation.current = null;
            if (!controller.signal.aborted) setBusy(false);
        }
    };
    const exportNotes = () => void run(async signal => {
        const json = await notebook.exportBackup();
        if (signal.aborted || !link.current) return;
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        try {
            link.current.href = url;
            link.current.download = `folia-music-notes-${new Date().toISOString().slice(0, 10)}.json`;
            link.current.click();
        } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
        notify(t('musicNotes.exported'));
    });
    return <>
        <div className="flex shrink-0 items-center gap-1">
            <Button buttonRef={importButton} variant="quiet" icon={ListMusic} tip={t('musicNotes.importPlaylist')}
                disabled={busy} onClick={openImport} />
            <Button variant="quiet" icon={Download} tip={t('musicNotes.restore')}
                aria-disabled={busy} onClick={() => { if (!operation.current) input.current?.click(); }} />
            <Button variant="quiet" icon={Upload} tip={t('musicNotes.export')} aria-disabled={busy} onClick={exportNotes} />
        </div>
        <NotebookSheet open={importOpen} title={t('musicNotes.importPlaylist')} onClose={closeImport} busy={busy} fill>
            <MusicNotesImport port={port} disabled={busy} onImport={playlist => run(async signal => {
                // Let the busy indicator paint before parsing a cached playlist and writing it to IndexedDB.
                if (document.visibilityState === 'visible') {
                    await new Promise<void>(resolve => {
                        const finish = () => {
                            cancelAnimationFrame(frame);
                            window.clearTimeout(timer);
                            signal.removeEventListener('abort', finish);
                            resolve();
                        };
                        const frame = requestAnimationFrame(() => {
                            window.clearTimeout(timer);
                            timer = window.setTimeout(finish, 0);
                        });
                        // A minimized window can stop receiving animation frames.
                        let timer = window.setTimeout(finish, 80);
                        signal.addEventListener('abort', finish, { once: true });
                    });
                }
                signal.throwIfAborted();
                const songs = await port.readPlaylist(playlist, signal);
                signal.throwIfAborted();
                const result = await notebook.importSongs(songs);
                if (!signal.aborted) { notify(t('musicNotes.imported', { ...result })); closeImport(); }
            })} />
        </NotebookSheet>
        <input type="file" hidden ref={input} accept="application/json,.json" aria-label={t('musicNotes.restore')}
            onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void run(async signal => {
                    if (file.size > NOTES_LIMITS.backupCharacters * 4) throw new NotesCapacityError();
                    const json = await file.text();
                    signal.throwIfAborted();
                    const result = await notebook.importBackup(json);
                    if (!signal.aborted) notify(t('musicNotes.imported', { ...result }));
                });
            }} />
        <a hidden ref={link} />
    </>;
}

export function DeleteNoteAction({ song, revision, notebook, notify }: Pick<ActionsProps, 'notebook' | 'notify'> & { song: NoteSong; revision: number }) {
    const { t } = useTranslation();
    const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
    const confirming = confirmedRevision !== null;
    const [busy, setBusy] = useState(false);
    const remove = async () => {
        if (busy || confirmedRevision === null) return;
        setConfirmedRevision(null);
        setBusy(true);
        try { await notebook.remove(song, confirmedRevision); }
        catch (error) {
            console.warn('[MusicNotes] delete failed', error);
            notify(t(error instanceof NotesConflictError ? 'musicNotes.deleteConflict' : 'musicNotes.failed'));
        }
        finally { setBusy(false); }
    };
    return <span className="inline-grid" data-confirming={confirming || undefined} onBlur={() => setConfirmedRevision(null)}
        onKeyDown={event => {
            if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
            if (confirming && event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                event.stopPropagation();
                setConfirmedRevision(null);
            }
        }}>
        <Button variant="dangerOutline" icon={Trash2} tip={confirming ? undefined : t('musicNotes.remove')}
            disabled={busy} onClick={() => {
                if (confirming) { void remove(); return; }
                setConfirmedRevision(revision);
            }}>
            {confirming ? t('musicNotes.confirmRemoveInline') : undefined}
        </Button>
    </span>;
}
