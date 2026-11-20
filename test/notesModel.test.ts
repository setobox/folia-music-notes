import { expect, it } from 'vitest';
import { filterNotes, songKey, type MusicNote } from '../src/core';

// Domain tests exercise portable records without any host/player state.

it('searches metadata, note and bookmark text and combines tag filters', () => {
    const song = { source: 'test', id: '42', title: 'Night train', artist: 'Someone', album: 'Travel' };
    const entry: MusicNote = {
        key: songKey(song), song, tags: ['夜路'], note: '毕业旅行',
        bookmarks: [{ id: 'chorus', positionSeconds: 123.4, text: '最后一段和声' }],
        createdAt: 100, updatedAt: 200, revision: 1,
    };
    expect(filterNotes([entry], 'travel 毕业 和声', '夜路')).toEqual([entry]);
    expect(filterNotes([entry], 'NIGHT SOMEONE')).toEqual([entry]);
    expect(filterNotes([entry], '毕业', '钢琴')).toEqual([]);
    expect(filterNotes([entry], '毕业 missing')).toEqual([]);
});
