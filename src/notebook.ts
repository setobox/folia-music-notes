import {
    createMusicNotesRepository, emptyNoteDraft, nextBookmarkId, NOTES_LIMITS, NotesCapacityError,
    NotesConflictError, songKey, type MusicNote, type MusicNotesRepository, type NoteDraft, type NoteSong, type NotesLibrary,
} from './core';
import { tagKey } from './core/notesModel';

// One notebook belongs to the activated mod, so the page and the player can edit the same song.
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
interface Snapshot extends NotesLibrary { ready: boolean; error: boolean }
interface Edit {
    song: NoteSong;
    base: MusicNote | undefined;
    draft: NoteDraft;
    updatedAt: number;
    version: number;
    savedVersion: number;
    savedFromRevision?: number | null;
    failed: boolean;
    timer?: ReturnType<typeof setTimeout>;
    writing?: Promise<void>;
}

const draftOf = (note: NoteDraft | undefined): NoteDraft => note
    ? { note: note.note, tags: note.tags, bookmarks: note.bookmarks } : emptyNoteDraft();

const equal = <T>(left: T, right: T) => left === right || JSON.stringify(left) === JSON.stringify(right);

/** Preserve changes to untouched fields. Competing edits to the same field require an explicit retry. */
function rebase(base: NoteDraft, draft: NoteDraft, latest: NoteDraft, preferDraft: boolean): NoteDraft {
    function field<T>(before: T, edited: T, current: T): T {
        if (equal(edited, before)) return current;
        if (preferDraft || equal(current, before) || equal(current, edited)) return edited;
        throw new NotesConflictError();
    }
    return {
        note: field(base.note, draft.note, latest.note),
        tags: field(base.tags, draft.tags, latest.tags),
        bookmarks: field(base.bookmarks, draft.bookmarks, latest.bookmarks),
    };
}

export class Notebook {
    private readonly listeners = new Set<() => void>();
    private records = new Map<string, MusicNote>();
    private readonly edits = new Map<string, Edit>();
    private readonly removing = new Set<string>();
    private snapshot: Snapshot = { ready: false, notes: [], tagOrder: [], error: false };
    private readVersion = 0;
    private reading?: Promise<void>;
    private orderWrite: Promise<void> = Promise.resolve();
    private closing = false;
    private readonly unwatch: () => void;

    constructor(private readonly db: MusicNotesRepository = createMusicNotesRepository()) {
        this.unwatch = this.db.watch(() => {
            void this.refresh().catch(error => this.readError(error));
        }, error => this.readError(error));
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    getSnapshot = (): Snapshot => this.snapshot;

    getDraft(song: NoteSong): NoteDraft {
        const key = songKey(song);
        return this.edits.get(key)?.draft ?? draftOf(this.records.get(key));
    }

    status(song: NoteSong): SaveStatus {
        const key = songKey(song);
        const entry = this.edits.get(key);
        if (entry) return entry.failed ? 'error' : 'saving';
        return this.records.has(key) ? 'saved' : 'idle';
    }

    private publish() {
        // Overlay drafts in place so typing never changes a saved note's manual position.
        const saved = new Map(this.records);
        const newNotes: MusicNote[] = [];
        for (const [key, { song, base, draft, updatedAt }] of this.edits) {
            const note = { key, song, ...draft, revision: base?.revision ?? 0, updatedAt,
                createdAt: base?.createdAt ?? updatedAt };
            if (saved.has(key)) saved.set(key, note);
            else newNotes.push(note);
        }
        const notes = [...newNotes.reverse(), ...saved.values()];
        this.snapshot = { ...this.snapshot, notes };
        for (const listener of this.listeners) listener();
    }

    private readError(error: unknown) {
        if (this.closing) return;
        console.warn('[MusicNotes] Could not read the notebook', error);
        this.snapshot = { ...this.snapshot, error: true };
        this.publish();
    }

    private refresh() {
        this.readVersion++;
        return this.reading ??= this.readChanges();
    }

    /** A change during a read invalidates that snapshot. Coalesce notifications into one more read. */
    private async readChanges() {
        try {
            let version: number;
            do {
                version = this.readVersion;
                const { notes, tagOrder } = await this.db.library();
                if (this.closing) return;
                if (version === this.readVersion) {
                    this.records = new Map(notes.map(row => [row.key, row]));
                    this.snapshot = { ...this.snapshot, tagOrder, ready: true, error: false };
                    this.publish();
                }
            } while (version !== this.readVersion);
        } finally {
            this.reading = undefined;
        }
    }

    edit(song: NoteSong, updater: (draft: NoteDraft) => NoteDraft, immediate = false) {
        const key = songKey(song);
        if (this.closing || this.removing.has(key) || !this.snapshot.ready) return;
        const old = this.getDraft(song);
        const draft = updater(old);
        if (draft.note === old.note && equal(draft.tags, old.tags) && equal(draft.bookmarks, old.bookmarks)) return;
        const base = this.records.get(key);
        const entry = this.edits.get(key) ?? {
            song, base, draft, updatedAt: 0, version: 0, savedVersion: 0, failed: false,
        } satisfies Edit;
        entry.draft = draft;
        entry.updatedAt = Math.max(Date.now(), base?.updatedAt ?? 0);
        entry.version++;
        entry.failed = false;
        this.edits.set(key, entry);
        clearTimeout(entry.timer);
        const save = () => { void this.flush(song).catch(() => { /* The draft and retry state stay visible. */ }); };
        if (immediate) save();
        else entry.timer = setTimeout(save, 800);
        this.publish();
    }

    mark(song: NoteSong, seconds: number): string {
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > NOTES_LIMITS.positionSeconds) {
            throw new RangeError('Invalid playback position');
        }
        if (!this.snapshot.ready || this.closing || this.removing.has(songKey(song))) {
            throw new Error('The notebook is unavailable');
        }
        const time = Math.floor(seconds);
        const { bookmarks } = this.getDraft(song);
        const existing = bookmarks.find(item => Math.abs(Math.floor(item.positionSeconds) - time) <= 1);
        if (existing) return existing.id;
        if (bookmarks.length >= NOTES_LIMITS.bookmarks) throw new NotesCapacityError();
        const id = nextBookmarkId(bookmarks);
        this.edit(song, draft => ({ ...draft, bookmarks: [...draft.bookmarks, { id, positionSeconds: time, text: '' }] }), true);
        return id;
    }

    private async write(key: string, entry: Edit, preferDraft: boolean) {
        const { base, draft, version, song } = entry;
        try {
            let record: MusicNote;
            let fromRevision = base?.revision ?? null;
            try {
                record = await this.db.save(song, draft, fromRevision);
            } catch (error) {
                if (!(error instanceof NotesConflictError)) throw error;
                const latest = await this.db.get(song);
                if (!latest && base && !preferDraft) throw error;
                const merged = rebase(draftOf(base), draft, draftOf(latest), preferDraft);
                fromRevision = latest?.revision ?? null;
                record = await this.db.save(song, merged, fromRevision);
            }
            this.readVersion++;
            if (this.records.has(key)) this.records.set(key, record);
            else this.records = new Map([[key, record], ...this.records]);
            entry.savedVersion = version;
            entry.savedFromRevision = fromRevision;
            entry.base = record;
            if (version === entry.version) {
                this.edits.delete(key);
            } else {
                entry.draft = rebase(draft, entry.draft, draftOf(record), true);
            }
        } catch (error) {
            entry.failed = true;
            console.warn('[MusicNotes] Could not save the note', error);
            throw error;
        } finally {
            this.publish();
        }
    }

    private async flushSong(key: string, preferDraft = false) {
        const entry = this.edits.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        const target = entry.version;
        while (entry.savedVersion < target && !this.removing.has(key)) {
            entry.writing ??= this.write(key, entry, preferDraft).finally(() => { entry.writing = undefined; });
            await entry.writing;
        }
    }

    async flush(song?: NoteSong): Promise<void> {
        if (song) return this.flushSong(songKey(song));
        const results = await Promise.allSettled([...this.edits.keys()].map(key => this.flushSong(key)));
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
    }

    retry(song: NoteSong): Promise<void> {
        return this.flushSong(songKey(song), true);
    }

    move(...[kind, key, target, side]: Parameters<MusicNotesRepository['move']>): Promise<void> {
        if (this.closing || !this.snapshot.ready || key === target) return Promise.resolve();
        // A later drop must follow an earlier drop even if the first is waiting for an autosave.
        const moved = this.orderWrite.then(() => this.moveSaved(kind, key, target, side));
        this.orderWrite = moved.catch(() => undefined);
        return moved;
    }

    private async moveSaved(...[kind, key, target, side]: Parameters<MusicNotesRepository['move']>) {
        // Only a newly created item needs its content committed before an order can reference it.
        if (kind === 'note') {
            for (const id of [key, target]) if (!this.records.has(id)) await this.flushSong(id);
        } else {
            const pending = new Set([key, target].filter(id => !this.snapshot.tagOrder.includes(id)));
            for (const [id, edit] of this.edits) {
                if (!pending.size) break;
                const tags = edit.draft.tags.map(tagKey).filter(tag => pending.has(tag));
                if (!tags.length) continue;
                await this.flushSong(id);
                for (const tag of tags) pending.delete(tag);
            }
        }
        await this.db.move(kind, key, target, side);
        await this.refresh();
    }

    remove(song: NoteSong, revision: number) {
        return this.removeMany([{ song, revision }]);
    }

    /** Hold all selected drafts until the database has validated and committed the whole batch. */
    async removeMany(notes: readonly Pick<MusicNote, 'song' | 'revision'>[]) {
        const targets = notes.map(({ song, revision }) => {
            const key = songKey(song);
            const edit = this.edits.get(key);
            const current = edit?.base?.revision ?? this.records.get(key)?.revision ?? 0;
            if (this.removing.has(key) || current !== revision) throw new NotesConflictError();
            return { key, song, revision, edit };
        });
        for (const { key, edit } of targets) {
            this.removing.add(key);
            clearTimeout(edit?.timer);
        }
        try {
            // Writes already in flight may commit a new revision before the deletion starts.
            await Promise.allSettled(targets.map(target => target.edit?.writing));
            await this.db.removeMany(targets.map(({ song, revision, edit }) => {
                const confirmed = revision || null;
                const committed = edit?.base?.revision ?? confirmed;
                // Accept our own pending save only if it did not incorporate another writer's revision.
                if (committed !== confirmed && edit?.savedFromRevision !== confirmed) throw new NotesConflictError();
                return { song, revision: committed };
            }));
            this.readVersion++;
            for (const { key } of targets) {
                this.records.delete(key);
                this.edits.delete(key);
            }
        } catch (error) {
            // Pending autosaves were cancelled above. Retain their drafts and expose Retry.
            for (const { key } of targets) {
                const edit = this.edits.get(key);
                if (edit) edit.failed = true;
            }
            throw error;
        } finally {
            for (const { key } of targets) this.removing.delete(key);
            this.publish();
        }
    }

    async importSongs(songs: readonly NoteSong[]) {
        await this.flush();
        const result = await this.db.importSongs(songs);
        await this.refresh();
        return result;
    }

    async importBackup(json: string) {
        await this.flush();
        const result = await this.db.importBackup(json);
        await this.refresh();
        return result;
    }

    async exportBackup() {
        await Promise.all([this.flush(), this.orderWrite]);
        return this.db.exportBackup();
    }

    async dispose() {
        this.closing = true;
        this.unwatch();
        try { await this.flush(); }
        finally {
            await this.orderWrite;
            this.listeners.clear();
            this.db.close();
        }
    }
}
