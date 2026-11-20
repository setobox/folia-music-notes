import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
    NotesConflictError, NotesValidationError, createMusicNotesRepository, emptyNoteDraft, songKey,
} from '../src/core';
import type { MusicNotesRepository, NoteSong } from '../src/core';

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
    it('keeps saved notes and metadata when reimporting a playlist after reopening', async () => {
        const name = `notes-test-${crypto.randomUUID()}`;
        const repository = createRepository(name);
        expect(await repository.importSongs([song, song])).toEqual({ added: 1, skipped: 1 });
        const imported = (await repository.get(song))!;
        const saved = await repository.save(song, { ...emptyNoteDraft(), note: 'Personal reason', tags: ['夜路'] }, imported.revision);
        repository.close();
        const reopened = createRepository(name);
        expect(await reopened.importSongs([{ ...song, title: 'Changed upstream' }])).toEqual({ added: 0, skipped: 1 });
        expect(await reopened.get(song)).toEqual(saved);
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
    });

    it('migrates version-one notes without changing content and starts above every existing revision', async () => {
        const name = `notes-test-${crypto.randomUUID()}`;
        const legacy = new Dexie(name);
        legacy.version(1).stores({ notes: 'key' });
        const original = {
            key: songKey(song), song, ...emptyNoteDraft(), note: 'Legacy content',
            createdAt: 10, updatedAt: 20, revision: 70,
        };
        await legacy.table('notes').put(original);
        legacy.close();
        const repository = createRepository(name);
        expect(await repository.get(song)).toEqual(original);
        await repository.remove(song, original.revision);
        await repository.importSongs([song]);
        expect((await repository.get(song))?.revision).toBeGreaterThan(original.revision);
        await expect(repository.save(song, emptyNoteDraft(), original.revision)).rejects.toThrow(NotesConflictError);
    });

    it('restores missing notes with their bookmarks and preserves existing local edits', async () => {
        const original = createRepository();
        await original.save(song, { ...emptyNoteDraft(), note: 'Backup reason' }, null);
        const other = { ...song, source: 'local' };
        const draft = { note: 'Chorus', tags: ['Live'], bookmarks: [{ id: 'chorus', text: 'Vocals', positionSeconds: 42 }] };
        await original.save(other, draft, null);
        const backup = await original.exportBackup();
        const destination = createRepository();
        await destination.save(song, { ...emptyNoteDraft(), note: 'Local reason' }, null);
        expect(await destination.importBackup(backup)).toEqual({ added: 1, skipped: 1 });
        expect((await destination.get(song))?.note).toBe('Local reason');
        expect(await destination.get(other)).toMatchObject(draft);
    });

    it('does not partially restore a backup with one invalid record', async () => {
        const original = createRepository();
        await original.importSongs([song, { ...song, id: 'other' }]);
        const records = await original.list();
        const json = JSON.stringify({ format: 'music-notes', version: 1, notes: [records[0], { ...records[1], note: null }] });
        const destination = createRepository();
        await expect(destination.importBackup(json)).rejects.toThrow(NotesValidationError);
        expect(await destination.list()).toEqual([]);
    });
});
