import { useEffect, useMemo, useRef, useState } from 'react';
import { createMusicNotesRepository, emptyNoteDraft, NotesCapacityError, NotesConflictError, songKey, type MusicNote, type MusicNotesRepository, type NoteDraft, type NoteSong } from '../core';
import { normalizeTags, splitTagInput } from '../core/notesModel';

// Owns one repository for the mounted notebook, with explicit discard prompts and revision-safe writes.
export interface NotesNotice {
    key: string;
    tone: 'ok' | 'warn' | 'error';
    values?: { added: number; skipped: number };
}

const draftOf = (note: MusicNote | null): NoteDraft => note
    ? { tags: [...note.tags], note: note.note, bookmarks: note.bookmarks.map(value => ({ ...value })) }
    : emptyNoteDraft();

export function useMusicNotesLibrary(requestId: number, requestedSong: NoteSong | null, onClose: () => void) {
    const repository = useRef<MusicNotesRepository | null>(null);
    const lifetime = useRef<AbortController | null>(null);
    const lock = useRef(false);
    const handledRequest = useRef(-1);
    const [notes, setNotes] = useState<MusicNote[]>([]);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<NotesNotice | null>(null);
    const [editorVersion, setEditorVersion] = useState(0);
    const [song, setSong] = useState<NoteSong | null>(null);
    const [original, setOriginal] = useState<MusicNote | null>(null);
    const [draft, setDraft] = useState<NoteDraft>(emptyNoteDraft);
    const [tagInput, setTagInput] = useState('');
    const nextTags = useMemo(() => normalizeTags([...draft.tags, ...splitTagInput(tagInput)]), [draft.tags, tagInput]);
    const [confirmation, setConfirmation] = useState<{ kind: 'discard' | 'remove'; proceed: () => void } | null>(null);
    const dirty = JSON.stringify({ ...draft, tags: nextTags }) !== JSON.stringify(draftOf(original));

    useEffect(() => {
        const db = createMusicNotesRepository();
        const controller = new AbortController();
        repository.current = db;
        lifetime.current = controller;
        void db.list().then(rows => {
            if (!controller.signal.aborted) { setNotes(rows); setReady(true); }
        }).catch((error: unknown) => {
            if (controller.signal.aborted) return;
            console.warn('[MusicNotes] open failed', error);
            setNotice({ key: 'musicNotes.failed', tone: 'error' });
        });
        return () => { controller.abort(); repository.current = null; db.close(); };
    }, []);

    const requestDiscard = (proceed: () => void) => {
        if (lock.current) return;
        if (dirty) setConfirmation({ kind: 'discard', proceed });
        else proceed();
    };
    const select = (next: NoteSong) => {
        if (lock.current || (song && songKey(song) === songKey(next))) return;
        requestDiscard(() => {
            const found = notes.find(value => value.key === songKey(next)) ?? null;
            setSong(next); setOriginal(found); setTagInput(''); setDraft(draftOf(found));
            setEditorVersion(value => value + 1); setNotice(null);
        });
    };

    // Host commands may select a song even while the notebook's root is temporarily detached.
    useEffect(() => {
        if (!ready || lock.current || handledRequest.current === requestId) return;
        handledRequest.current = requestId;
        if (requestedSong) select(requestedSong);
    });

    useEffect(() => {
        if (!dirty) return;
        const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', preventUnload);
        return () => window.removeEventListener('beforeunload', preventUnload);
    }, [dirty]);

    const run = async (work: (db: MusicNotesRepository, signal: AbortSignal) => Promise<void>) => {
        const db = repository.current;
        const signal = lifetime.current?.signal;
        if (!db || !signal || !ready || lock.current) return;
        const isActive = () => !signal.aborted;
        if (!isActive()) return;
        lock.current = true; setBusy(true); setNotice(null);
        try { await work(db, signal); }
        catch (error: unknown) {
            if (isActive()) {
                console.warn('[MusicNotes] operation failed', error);
                setNotice({ key: error instanceof NotesConflictError ? 'musicNotes.conflict' : error instanceof NotesCapacityError ? 'musicNotes.capacity' : 'musicNotes.failed', tone: 'error' });
            }
        } finally {
            lock.current = false;
            if (isActive()) setBusy(false);
        }
    };
    const refresh = async (db: MusicNotesRepository) => {
        const rows = await db.list();
        if (!lifetime.current?.signal.aborted) setNotes(rows);
    };
    const save = (nextDraft: NoteDraft = draft) => run(async (db, signal) => {
        if (!song) return;
        const result = await db.save(song, nextDraft, original?.revision ?? null);
        if (signal.aborted) return;
        setOriginal(result); setTagInput(''); setDraft(draftOf(result));
        setEditorVersion(value => value + 1);
        await refresh(db); setNotice({ key: 'musicNotes.saved', tone: 'ok' });
    });
    const remove = () => {
        if (!song || !original || lock.current) return;
        const target = song; const revision = original.revision;
        setConfirmation({ kind: 'remove', proceed: () => {
            void run(async (db, signal) => {
                await db.remove(target, revision);
                if (signal.aborted) return;
                setSong(null); setOriginal(null); setTagInput(''); setDraft(emptyNoteDraft());
                await refresh(db); setNotice({ key: 'musicNotes.removed', tone: 'ok' });
            });
        } });
    };
    const reload = () => requestDiscard(() => {
        void run(async (db, signal) => {
            const rows = await db.list();
            const fresh = song ? await db.get(song) ?? null : null;
            if (signal.aborted) return;
            setNotes(rows); setOriginal(fresh); setTagInput(''); setDraft(draftOf(fresh));
            setEditorVersion(value => value + 1);
        });
    });
    const confirm = () => {
        if (lock.current || !confirmation) return;
        const action = confirmation.proceed;
        setConfirmation(null); action();
    };
    const close = () => requestDiscard(() => {
        setTagInput(''); setDraft(draftOf(original)); setEditorVersion(value => value + 1);
        onClose();
    });
    return { notes, ready, busy, notice, setNotice, editorVersion, song, original, draft, setDraft, tagInput, setTagInput, nextTags, dirty, select, run, save, remove, reload, refresh, confirmation, confirm, cancel: () => setConfirmation(null), close };
}
