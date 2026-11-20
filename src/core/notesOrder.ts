import { NotesValidationError, tagKey } from './notesModel';
import type { MusicNote, NotesLibrary } from './notesTypes';
import { notesObject } from './notesValidation';

// Array positions are persistent weights. Reordering never writes note content or edit tokens.

export interface NotesOrder {
    noteOrder: string[];
    tagOrder: string[];
}

export const readNotesOrder = (value: unknown): NotesOrder => {
    const row = notesObject(value, 'library order');
    const keys = (input: unknown): string[] => {
        if (!Array.isArray(input) || !input.every((key: unknown) => typeof key === 'string')) {
            throw new NotesValidationError('library order keys');
        }
        return input as string[];
    };
    return { noteOrder: keys(row.noteOrder), tagOrder: keys(row.tagOrder) };
};

/** Upgrade the first ordering from the list and tag-frequency rules used by earlier versions. */
export function legacyLibrary(notes: MusicNote[], locale?: string): NotesLibrary {
    notes.sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key));
    const tags = new Map<string, { name: string; count: number }>();
    for (const note of notes) for (const name of note.tags) {
        const key = tagKey(name);
        const existing = tags.get(key);
        if (existing) existing.count++;
        else tags.set(key, { name, count: 1 });
    }
    const byFrequency = [...tags.entries()].sort(([, a], [, b]) =>
        b.count - a.count || a.name.localeCompare(b.name, locale));
    return { notes, tagOrder: byFrequency.map(([key]) => key) };
}

/** Retain only live keys, preserving their weights and appending unseen entries in encounter order. */
export function orderedKeys(live: Set<string>, preferred: readonly string[]): string[] {
    const result = preferred.filter(key => live.delete(key));
    return result.concat([...live]);
}

export function collectTagKeys(notes: readonly MusicNote[]): Set<string> {
    const keys = new Set<string>();
    for (const note of notes) for (const tag of note.tags) keys.add(tagKey(tag));
    return keys;
}

export const sameKeys = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((key, index) => key === right[index]);

/** Return undefined for stale drops and for moves that would leave the current weights intact. */
export function moveKey(keys: string[], key: string, target: string, side: 'before' | 'after'): string[] | undefined {
    const source = keys.indexOf(key);
    const anchor = keys.indexOf(target);
    if (source < 0 || anchor < 0 || source === anchor) return undefined;
    const destination = anchor - Number(source < anchor) + Number(side === 'after');
    if (source === destination) return undefined;
    const next = keys.slice();
    next.splice(source, 1);
    next.splice(destination, 0, key);
    return next;
}
