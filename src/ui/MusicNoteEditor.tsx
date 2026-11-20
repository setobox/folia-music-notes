import { BookmarkPlus, Save, Trash2, Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Chips, Group, Row, Status, TextArea, TextField } from '../kit';
import { NOTES_LIMITS, splitTagInput, tagKey } from '../core/notesModel';
import type { NoteDraft, NoteSong } from '../core/notesTypes';

// A controlled note editor using the same rows, controls and colors as Folia's settings pages.
export interface NoteEditorProps {
    song: NoteSong;
    draft: NoteDraft;
    busy: boolean;
    dirty: boolean;
    canBookmark: boolean;
    saved: boolean;
    onChange: (draft: NoteDraft) => void;
    onSave: (draft: NoteDraft) => void;
    tagInput: string;
    nextTags: string[];
    onTagInputChange: (value: string) => void;
    onRemove: () => void;
    onPlay: () => void;
    onBookmark: () => void;
    onSeek: (seconds: number) => void;
}

const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function MusicNoteEditor(props: NoteEditorProps) {
    const { t } = useTranslation();
    const { song, draft, busy, onChange, tagInput, nextTags, onTagInputChange } = props;
    const hasNewTags = nextTags.length > draft.tags.length;
    const invalidTags = nextTags.length > NOTES_LIMITS.tags || nextTags.some(tag => tag.length > NOTES_LIMITS.tag);
    const sourceLabel = song.source === 'local' ? t('musicNotes.sourceLocal')
        : song.source === 'online:netease' ? t('musicNotes.sourceNetease')
            : song.source === 'online:qq' ? t('musicNotes.sourceQq')
                : song.source.replace(/^online:/u, '');
    const commitTag = () => {
        const next = { ...draft, tags: nextTags };
        onChange(next);
        onTagInputChange('');
        return next;
    };
    const removeTag = (tag: string) => {
        const removedKey = tagKey(tag);
        const input = splitTagInput(tagInput);
        const remaining = input.filter(value => tagKey(value) !== removedKey);
        if (remaining.length !== input.length) onTagInputChange(remaining.join(','));
        onChange({ ...draft, tags: draft.tags.filter(value => value !== tag) });
    };
    return (
        <section aria-label={t('musicNotes.editor')} data-music-notes="editor">
            <Group def={{ id: 'music-notes-song', titleKey: 'musicNotes.editor' }}>
                <Row label={song.title} hint={[song.artist, song.album].filter(Boolean).join(' · ')}>
                    <Button icon={Play} disabled={busy} onClick={props.onPlay}>{t('musicNotes.play')}</Button>
                </Row>
                <Row label={t('musicNotes.source')} hint={t('musicNotes.sourceHint')}>
                    <span className="break-all text-[13px] text-[color:var(--st-t2)]">{sourceLabel}</span>
                </Row>
            </Group>
            <div data-music-notes="tags">
                <Group def={{ id: 'music-notes-tags', titleKey: 'musicNotes.tags' }} foot={t('musicNotes.tagsFoot')}>
                    <Row label={t('musicNotes.addTag')} hint={invalidTags
                        ? t('musicNotes.tagLimit', { tags: NOTES_LIMITS.tags, length: NOTES_LIMITS.tag })
                        : t('musicNotes.tagHint')} below={
                        <div className="music-notes-field-line">
                            <TextField value={tagInput} disabled={busy} placeholder={t('musicNotes.tagPlaceholder')} onChange={onTagInputChange} />
                            <Button icon={Plus} disabled={busy || invalidTags || !hasNewTags} onClick={commitTag}>{t('musicNotes.add')}</Button>
                        </div>
                    } />
                    {draft.tags.length > 0 && <Row label={t('musicNotes.savedTags')} below={<Chips disabled={busy} items={draft.tags.map(tag => ({ id: tag, label: tag, checked: true, onChange: () => removeTag(tag) }))} />} />}
                </Group>
            </div>
            <div data-music-notes="note">
                <Group def={{ id: 'music-notes-note', titleKey: 'musicNotes.reason' }} foot={t('musicNotes.privateHint')}>
                    <Row label={t('musicNotes.reason')} hint={t('musicNotes.reasonHint')} below={<TextArea value={draft.note} disabled={busy} placeholder={t('musicNotes.reasonPlaceholder')} onChange={value => onChange({ ...draft, note: value })} />} />
                </Group>
            </div>
            <div data-music-notes="bookmarks">
                <Group def={{ id: 'music-notes-bookmarks', titleKey: 'musicNotes.bookmarks' }}>
                    <Row label={t('musicNotes.bookmark')} hint={t(props.canBookmark ? 'musicNotes.bookmarkDescription' : 'musicNotes.bookmarkHint')}>
                        <Button icon={BookmarkPlus} disabled={busy || !props.canBookmark || draft.bookmarks.length >= NOTES_LIMITS.bookmarks} onClick={props.onBookmark}>{t('musicNotes.bookmark')}</Button>
                    </Row>
                    {draft.bookmarks.map(bookmark => <Row key={bookmark.id} label={t('musicNotes.bookmarkText')} hint={timeLabel(bookmark.positionSeconds)} below={
                        <div className="music-notes-field-line">
                            <TextField value={bookmark.text} disabled={busy} placeholder={t('musicNotes.bookmarkPlaceholder')} onChange={value => onChange({ ...draft, bookmarks: draft.bookmarks.map(item => item.id === bookmark.id ? { ...item, text: value } : item) })} />
                            <Button disabled={!props.canBookmark || busy} onClick={() => props.onSeek(bookmark.positionSeconds)}>{timeLabel(bookmark.positionSeconds)}</Button>
                            <Button icon={Trash2} disabled={busy} onClick={() => onChange({ ...draft, bookmarks: draft.bookmarks.filter(value => value.id !== bookmark.id) })}>{t('musicNotes.removeBookmark')}</Button>
                        </div>
                    } />)}
                </Group>
            </div>
            <Group def={{ id: 'music-notes-save', titleKey: 'musicNotes.save' }} bare>
                <Row label={<Status tone={props.dirty || !props.saved ? 'warn' : 'ok'}>{t(props.dirty || !props.saved ? 'musicNotes.unsaved' : 'musicNotes.saved')}</Status>}>
                    {props.saved && <Button variant="quiet" icon={Trash2} disabled={busy} onClick={props.onRemove}>{t('musicNotes.remove')}</Button>}
                    <Button variant="primary" icon={Save} disabled={busy || invalidTags || (!props.dirty && props.saved)} onClick={() => props.onSave(hasNewTags ? commitTag() : draft)}>{t('musicNotes.save')}</Button>
                </Row>
            </Group>
        </section>
    );
}
