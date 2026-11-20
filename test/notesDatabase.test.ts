import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    NotesConflictError, NotesValidationError, createMusicNotesRepository, emptyNoteDraft, songKey,
} from '../src/core';
import type { MusicNotesRepository, NoteSong } from '../src/core';
import { Notebook } from '../src/notebook';

// Persistence tests use isolated databases and exercise public operations across adapter instances.

const databases: string[] = [];
const repositories: MusicNotesRepository[] = [];
const song: NoteSong = { source: 'test', id: '42', title: 'Home', artist: 'Artist' };

const createRepository = (databaseName = `notes-test-${crypto.randomUUID()}`): MusicNotesRepository => {
    databases.push(databaseName);
    const repository = createMusicNotesRepository({ databaseName, now: () => 100 });
    repositories.push(repository);
    return repository;
};

afterEach(async () => {
    repositories.splice(0).forEach(repository => repository.close());
    await Promise.all(databases.splice(0).map(name => Dexie.delete(name)));
});

describe('music notes IndexedDB adapter', () => {
    it('autosaves edits from the editor and player, and keeps notes and empty imports after reopening', async () => {
        const name = `notes-test-${crypto.randomUUID()}`;
        const repository = createRepository(name);
        await repository.save(song, { ...emptyNoteDraft(), bookmarks: [{ id: 'legacy', positionSeconds: 10.8, text: '' }] }, null);
        const notebook = new Notebook(repository);
        await vi.waitFor(() => expect(notebook.getSnapshot().ready).toBe(true));
        expect(notebook.mark(song, 9.9)).toBe('legacy');
        const importedSong = { ...song, id: 'empty' };
        const firstInPlaylist = { ...song, id: 'zzz' };
        expect(await notebook.importSongs([firstInPlaylist, importedSong, firstInPlaylist])).toEqual({ added: 2, skipped: 1 });
        notebook.edit(song, draft => ({ ...draft, note: 'Personal reason' }));
        await vi.waitFor(async () => expect((await repository.get(song))?.note).toBe('Personal reason'), { timeout: 2500 });
        const mark = notebook.mark(song, 21.8);
        expect(notebook.mark(song, 22)).toBe(mark);
        notebook.edit(song, draft => ({ ...draft, tags: ['夜路'] }));
        await notebook.dispose();
        const reopened = createRepository(name);
        expect(await reopened.get(importedSong)).toMatchObject(emptyNoteDraft());
        expect(await reopened.importSongs([{ ...song, title: 'Changed upstream' }])).toEqual({ added: 0, skipped: 1 });
        const library = await reopened.library();
        expect(library.notes.map(note => note.song.id)).toEqual(['zzz', 'empty', '42']);
        expect(library.tagOrder).toEqual(['夜路']);
        expect(await reopened.get(song)).toMatchObject({
            song, note: 'Personal reason', tags: ['夜路'], bookmarks: [
                { id: 'legacy', positionSeconds: 10.8, text: '' }, { id: mark, positionSeconds: 21, text: '' },
            ],
        });
    });

    it('prevents two editors from silently overwriting each other', async () => {
        const name = `notes-test-${crypto.randomUUID()}`;
        const first = createRepository(name);
        const second = createRepository(name);
        const original = await first.save(song, emptyNoteDraft(), null);
        const results = await Promise.allSettled([
            first.save(song, { ...emptyNoteDraft(), note: 'first' }, original.revision),
            second.save(song, { ...emptyNoteDraft(), note: 'second' }, original.revision),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const failure = results.find(result => result.status === 'rejected');
        expect(failure?.status === 'rejected' && failure.reason instanceof NotesConflictError).toBe(true);

        const notebook = new Notebook(first);
        await vi.waitFor(() => expect(notebook.getSnapshot().ready).toBe(true));
        notebook.edit(song, draft => ({ ...draft, note: 'local edit' }));
        const latest = (await second.get(song))!;
        await second.save(song, { ...emptyNoteDraft(), note: 'external edit', tags: ['external'] }, latest.revision);
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            await expect(notebook.flush(song)).rejects.toThrow(NotesConflictError);
            expect(notebook.status(song)).toBe('error');
            expect(notebook.getDraft(song).note).toBe('local edit');
            expect((await second.get(song))?.note).toBe('external edit');
            await notebook.retry(song);
            expect(await second.get(song)).toMatchObject({ note: 'local edit', tags: ['external'] });

            const other = { ...song, id: 'keep-this-note' };
            await notebook.importSongs([other]);
            const confirmed = notebook.getSnapshot().notes;
            const base = confirmed.find(note => note.key === songKey(song))!;
            let releaseSave!: () => void;
            const gate = new Promise<void>(resolve => { releaseSave = resolve; });
            const save = first.save;
            const pendingSave = vi.spyOn(first, 'save').mockImplementationOnce(async (...args) => {
                await gate;
                return save(...args);
            });
            try {
                notebook.edit(song, draft => ({ ...draft, note: 'Pending locally' }), true);
                expect(pendingSave).toHaveBeenCalledOnce();
                await second.save(song, { ...base, tags: ['Other window'] }, base.revision);
                const removal = notebook.removeMany(confirmed);
                releaseSave();
                await expect(removal).rejects.toThrow(NotesConflictError);
                expect(await second.get(song)).toMatchObject({ note: 'Pending locally', tags: ['Other window'] });
                expect(await second.get(other)).toBeDefined();
            } finally {
                releaseSave();
                pendingSave.mockRestore();
            }
        } finally {
            warning.mockRestore();
            await notebook.dispose();
        }

        const observer = createRepository(name);
        const onChanged = vi.fn();
        const unsubscribe = observer.watch(onChanged, error => { throw error; });
        try {
            const [other, edited] = await observer.list();
            await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
            onChanged.mockClear();
            await second.move('note', edited.key, other.key, 'before');
            await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
            expect(await observer.list()).toEqual([edited, other]);
            const extra = { ...song, id: 'elsewhere' };
            await Promise.all([observer.move('note', other.key, edited.key, 'before'), second.importSongs([extra])]);
            expect((await observer.list()).map(note => note.song)).toEqual([extra, other.song, edited.song]);
            await Promise.all([observer.move('note', other.key, edited.key, 'after'), second.remove(edited.song, edited.revision)]);
            await observer.move('note', edited.key, other.key, 'before');
            expect((await second.list()).map(note => note.song)).toEqual([extra, other.song]);
            expect((await second.library()).tagOrder).toEqual([]);
        } finally {
            unsubscribe();
        }
    });

    it('migrates version-one notes without changing content and starts above every existing revision', async () => {
        const name = `notes-test-${crypto.randomUUID()}`;
        const legacy = new Dexie(name);
        legacy.version(1).stores({ notes: 'key' });
        const original = {
            key: songKey(song), song, ...emptyNoteDraft(), note: 'Legacy content',
            tags: ['Zulu', 'Alpha'], createdAt: 10, updatedAt: 20, revision: 70,
        };
        const newerSong = { ...song, id: 'zzz' };
        const sameTimeSong = { ...song, id: 'aaa' };
        const newer = { ...original, key: songKey(newerSong), song: newerSong, updatedAt: 30, tags: ['ZULU', 'Beta'] };
        const sameTime = { ...original, key: songKey(sameTimeSong), song: sameTimeSong, tags: ['omega'] };
        await legacy.table('notes').bulkAdd([sameTime, original, newer]);
        legacy.close();
        const repository = createRepository(name);
        expect(await repository.get(song)).toEqual(original);
        expect(await repository.library()).toEqual({ notes: [newer, original, sameTime], tagOrder: ['zulu', 'alpha', 'beta', 'omega'] });
        await repository.remove(song, original.revision);
        await repository.importSongs([song]);
        expect((await repository.get(song))?.revision).toBeGreaterThan(original.revision);
        await expect(repository.save(song, emptyNoteDraft(), original.revision)).rejects.toThrow(NotesConflictError);
        const other = await repository.save({ ...song, id: 'other' }, emptyNoteDraft(), null);
        await expect(repository.removeMany([other, original])).rejects.toThrow(NotesConflictError);
        expect(await repository.list()).toHaveLength(4);
        const before = await repository.library();
        await repository.move('tag', 'alpha', 'beta', 'before');
        await repository.move('note', other.key, 'missing-target', 'before');
        expect(await repository.library()).toEqual(before);
    });

    it('restores missing notes with their bookmarks and preserves existing local edits', async () => {
        const original = createRepository();
        await original.save(song, { ...emptyNoteDraft(), note: 'Backup reason', tags: ['Backup only', 'ECHO'] }, null);
        const other = { ...song, source: 'local' };
        const draft = { note: 'Chorus', tags: ['Live', 'Duet', 'Echo'], bookmarks: [{ id: 'chorus', text: 'Vocals', positionSeconds: 42 }] };
        await original.save(other, draft, null);
        await original.move('note', songKey(song), songKey(other), 'before');
        await original.move('tag', 'duet', 'echo', 'before');
        const backup = await original.exportBackup();
        const fresh = createRepository();
        await fresh.importBackup(backup);
        const restored = await fresh.library();
        expect(restored.notes.map(note => note.song)).toEqual([song, other]);
        expect(restored.tagOrder).toEqual(['backup only', 'duet', 'echo', 'live']);
        const destination = createRepository();
        await destination.save(song, { ...emptyNoteDraft(), note: 'Local reason', tags: ['Local first', 'Echo'] }, null);
        expect(await destination.importBackup(backup)).toEqual({ added: 1, skipped: 1 });
        expect((await destination.get(song))?.note).toBe('Local reason');
        expect(await destination.get(other)).toMatchObject(draft);
        expect((await destination.library()).tagOrder).toEqual(['local first', 'echo', 'duet', 'live']);
        expect((await destination.list()).map(note => note.song)).toEqual([other, song]);
        expect(await destination.importBackup(backup)).toEqual({ added: 0, skipped: 2 });
        const legacy = createRepository();
        await legacy.importBackup(JSON.stringify({ format: 'music-notes', version: 1, notes: restored.notes }));
        expect((await legacy.library()).tagOrder).toEqual(['echo', 'backup only', 'duet', 'live']);
        expect((await legacy.list()).map(note => note.song)).toEqual([other, song]);
    });

    it('does not partially restore a backup with one invalid record', async () => {
        const original = createRepository();
        await original.importSongs([song, { ...song, id: 'other' }]);
        const records = await original.list();
        const json = JSON.stringify({ format: 'music-notes', version: 1, notes: [records[0], { ...records[1], note: null }] });
        const destination = createRepository();
        await expect(destination.importBackup(json)).rejects.toThrow(NotesValidationError);
        const invalidWeights = JSON.stringify({ format: 'music-notes', version: 2, notes: records, tagOrder: [0] });
        await expect(destination.importBackup(invalidWeights)).rejects.toThrow(NotesValidationError);
        expect(await destination.list()).toEqual([]);
    });
});
