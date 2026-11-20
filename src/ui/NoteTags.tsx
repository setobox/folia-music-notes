import { useId, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../kit';
import { FIELD_CLASS } from '../kit/TextField';
import { NOTES_LIMITS, normalizeTags, splitTagInput, tagKey } from '../core/notesModel';

// Neutral form of the settings chip, shared by the editor and single-select library filter.
export const CHIP = 'st-t-fast inline-flex h-8 min-w-0 shrink-0 items-center justify-center rounded-lg text-sm transition-colors hover:bg-[var(--st-fill2)]';

export function NoteTags({ tags, options, change, notify }: {
    tags: readonly string[];
    options: readonly string[];
    change: (update: (previous: string[]) => string[]) => void;
    notify: (message: string) => void;
}) {
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [input, setInput] = useState('');
    const [highlight, setHighlight] = useState(-1);
    const listId = useId();
    const control = useRef<HTMLSpanElement>(null);
    const selected = useMemo(() => new Map(tags.map(name => [tagKey(name), name])), [tags]);
    const term = tagKey(splitTagInput(input).at(-1) ?? '');
    const choices = useMemo(() => {
        const result: string[] = [];
        if (!editing) return result;
        for (const tag of options) {
            const key = tagKey(tag);
            if (!selected.has(key) && key.includes(term)) result.push(tag);
            if (result.length === 8) break;
        }
        return result;
    }, [options, selected, term, editing]);
    const LIMIT = NOTES_LIMITS;
    const close = (returnFocus: boolean) => {
        setEditing(false);
        setInput('');
        setHighlight(-1);
        if (returnFocus) requestAnimationFrame(() => control.current?.querySelector('button')?.focus());
    };
    const commit = (choice?: string, returnFocus = true) => {
        const tokens = splitTagInput(input);
        if (choice) tokens.splice(-1, 1, choice);
        const next = normalizeTags([...tags, ...tokens]);
        if (next.length > LIMIT.tags || next.some(tag => tag.length > LIMIT.tag)) {
            notify(t('musicNotes.tagLimit', { tags: LIMIT.tags, length: LIMIT.tag }));
            return;
        }
        if (next.length > tags.length) change(previous => normalizeTags([...previous, ...tokens]));
        close(returnFocus);
    };
    const add = <span ref={control} className="relative inline-flex min-w-0">
        {!editing ? <Button variant="quiet" icon={Plus} tip={t('musicNotes.addTagLabel')} onClick={() => setEditing(true)} /> : <>
            <input autoFocus role="combobox" aria-label={t('musicNotes.tags')} aria-expanded={choices.length > 0} aria-autocomplete="list"
                aria-controls={choices.length ? listId : undefined} aria-activedescendant={highlight >= 0 && choices[highlight] ? `${listId}-${highlight}` : undefined}
                className={`${FIELD_CLASS} w-40 px-2.5`} value={input} onChange={event => { setInput(event.currentTarget.value); setHighlight(-1); }}
                onBlur={() => commit(undefined, false)}
                onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
                    if (event.key === 'Enter') { event.preventDefault(); commit(choices[highlight]); }
                    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && choices.length) {
                        event.preventDefault(); event.stopPropagation();
                        setHighlight(index => event.key === 'ArrowDown' ? (index + 1) % choices.length
                            : (index <= 0 ? choices.length : index) - 1);
                    }
                }} />
            {choices.length > 0 && <div id={listId} role="listbox" className="absolute left-0 top-full z-10 mt-1 min-w-full rounded-lg border border-[var(--st-line)] bg-[var(--st-card)] p-1 shadow-lg">
                {choices.map((tag, index) => <button type="button" role="option" id={`${listId}-${index}`} key={tagKey(tag)} tabIndex={-1}
                    aria-selected={highlight === index} onMouseDown={event => event.preventDefault()} onClick={() => commit(tag)}
                    className="block w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-[var(--st-fill)] aria-selected:bg-[var(--st-fill)]">{tag}</button>)}
            </div>}
        </>}
    </span>;
    return <div data-music-notes="tags">
        <div role="group" aria-label={t('musicNotes.tags')}
            className="relative flex flex-wrap items-center gap-1.5">
            {tags.map(tag => <span key={tagKey(tag)} role="group" aria-label={tag}
                className={`${CHIP} st-focus-inside group relative max-w-full bg-[var(--st-fill)] px-4`}>
                <span className="truncate">{tag}</span>
                <button type="button" aria-label={t('musicNotes.removeTag', { tag })}
                    className="music-notes-hover absolute right-0 top-0 inline-flex size-4 items-center justify-center rounded-md text-[color:var(--st-t2)] hover:text-[color:var(--st-t1)]"
                    onClick={() => change(previous => previous.filter(value => tagKey(value) !== tagKey(tag)))}>
                    <X size={12} aria-hidden />
                </button>
            </span>)}
            {add}
        </div>
    </div>;
}
