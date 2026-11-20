import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { RotateCcw, X } from 'lucide-react';
import type { i18n } from 'i18next';
import type { FoliumClientApi, FoliumSettingsPanelContext } from '../types/folium';
import { Button } from './kit/Button';
import { FIELD_CLASS } from './kit/TextField';
import { Toggle } from './kit/Toggle';
import { settingsTokens } from './kit/kitTheme';
import styles from './styles.css?inline';

// The host stores the binding. Only a keypress inside the foreground Folia window can use it.
const DEFAULT_BINDING = 'Ctrl+N';
const FIELD = 'openNotebook';
const ENABLED = 'shortcutsEnabled';
const title = { 'zh-CN': '快捷键', 'zh-TW': '快速鍵', en: 'Keyboard shortcut', in: 'Pintasan papan ketik' };
const enabledLabel = { 'zh-CN': '启用快捷键', 'zh-TW': '啟用快速鍵', en: 'Enable shortcuts', in: 'Aktifkan pintasan' };
const name = { 'zh-CN': '打开音乐笔记', 'zh-TW': '開啟音樂筆記', en: 'Open music notes', in: 'Buka catatan lagu', vi: 'Mở ghi chú bài hát' };

// Folia or the operating system already uses these combinations.
function isReserved(binding: string): boolean {
    return /^(?:Ctrl|Meta)\+[BFGJKP]$/u.test(binding) || ['Alt+F4', 'Meta+Q', 'F6', 'Shift+F6'].includes(binding);
}

function shortcutOf(event: KeyboardEvent): string | null {
    if (event.getModifierState('AltGraph')) return null;
    const key = /^(?:Key[A-Z]|Digit\d)$/u.test(event.code) ? event.code.replace(/^(Key|Digit)/u, '')
        : /^F(?:[1-9]|1\d|2[0-4])$/u.test(event.key) ? event.key : null;
    if (!key || (!event.ctrlKey && !event.metaKey && !event.altKey && !/^F\d+$/u.test(key))) return null;
    return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
}

type PanelProps = { ctx: FoliumSettingsPanelContext; i18n: i18n };

function ShortcutPanel({ ctx, i18n }: PanelProps) {
    const enabled = ctx.settings.get()[ENABLED] !== false;
    const labelId = useId();
    const theme = ctx.getTheme();
    const tokens = { ...settingsTokens(theme.isDaylight, theme), '--text-primary': theme.primaryColor } as CSSProperties;
    return <div className="space-y-3 text-sm" style={tokens}>
        <div className="flex items-center justify-between gap-3">
            <span id={labelId}>{i18n.getFixedT(ctx.locale)('musicNotes.shortcutEnabled')}</span>
            <Toggle checked={enabled} labelledBy={labelId} onChange={value => ctx.settings.set({ [ENABLED]: value })} />
        </div>
        <Recorder key={String(enabled)} ctx={ctx} i18n={i18n} enabled={enabled} />
    </div>;
}

function Recorder({ ctx, i18n, enabled }: PanelProps & { enabled: boolean }) {
    const [recording, setRecording] = useState(false);
    const [feedback, setFeedback] = useState<'unsupported' | { conflict: string } | null>(null);
    const valueId = useId();
    const button = useRef<HTMLButtonElement>(null);
    useLayoutEffect(() => {
        const root = button.current?.getRootNode();
        if (!recording || !(root instanceof ShadowRoot)) return;
        // Folia's capture-phase shortcuts see the panel's shadow host as the key target.
        const host = root.host;
        const previous = host.getAttribute('data-folia-key-capture');
        host.setAttribute('data-folia-key-capture', 'true');
        return () => {
            if (previous === null) host.removeAttribute('data-folia-key-capture');
            else host.setAttribute('data-folia-key-capture', previous);
        };
    }, [recording]);
    const value = ctx.settings.get()[FIELD];
    const binding = typeof value === 'string' ? value : DEFAULT_BINDING;
    const t = i18n.getFixedT(ctx.locale);
    const prompt = feedback === 'unsupported' ? t('musicNotes.shortcutUnsupported')
        : feedback ? t('musicNotes.shortcutConflict', { binding: feedback.conflict }) : t('musicNotes.shortcutCapture');
    const setBinding = (next: string) => {
        ctx.settings.set({ [FIELD]: next });
        setRecording(false);
        button.current?.focus();
    };
    return <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{t('musicNotes.shortcutLabel')}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button ref={button} type="button" data-music-notes-recorder="" data-folia-key-capture={recording || undefined} aria-label={t('musicNotes.shortcutLabel')}
                aria-pressed={recording} aria-describedby={valueId} disabled={!enabled}
                className={`${FIELD_CLASS} px-3 disabled:cursor-not-allowed disabled:opacity-40`}
                onClick={() => { setRecording(true); setFeedback(null); }}
                onBlur={() => setRecording(false)}
                onKeyDown={event => {
                    if (!recording || event.key === 'Tab') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === 'Escape') { setRecording(false); return; }
                    const clear = ['Delete', 'Backspace'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey;
                    if (['Control', 'Alt', 'Meta', 'Shift'].includes(event.key)) return;
                    const next = clear ? '' : shortcutOf(event.nativeEvent);
                    if (next === null) { setFeedback('unsupported'); return; }
                    if (isReserved(next)) { setFeedback({ conflict: next }); return; }
                    setBinding(next);
                }}>
                <span id={valueId} aria-live="polite">{recording ? prompt
                    : binding ? binding.split('+').join(' + ') : t('musicNotes.shortcutNone')}</span>
            </button>
            {binding && <Button variant="quiet" icon={X} tip={t('musicNotes.shortcutClear')}
                disabled={!enabled} onClick={() => setBinding('')} />}
            {binding !== DEFAULT_BINDING && <Button variant="quiet" icon={RotateCcw} tip={t('musicNotes.shortcutReset')}
                disabled={!enabled} onClick={() => setBinding(DEFAULT_BINDING)} />}
        </div>
    </div>;
}

export function registerShortcut(folium: FoliumClientApi, i18n: i18n, open: () => void) {
    const section = folium.registries.settingsSections.register({
        id: 'shortcuts', label: title, settings: [
            { key: ENABLED, type: 'boolean', label: enabledLabel, defaultValue: true },
            { key: FIELD, type: 'text', label: name, defaultValue: DEFAULT_BINDING },
        ],
        settingsPanel(container, ctx) {
            const style = document.createElement('style'); style.textContent = styles;
            const view = document.createElement('div');
            container.append(style, view);
            const root = createRoot(view);
            const render = () => root.render(<ShortcutPanel ctx={ctx} i18n={i18n} />);
            const offContext = ctx.onChange(render);
            const offSettings = ctx.settings.onChange(render);
            render();
            return () => { offContext(); offSettings(); root.unmount(); view.remove(); style.remove(); };
        },
    });
    const onKey = (event: KeyboardEvent) => {
        if (event.repeat || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (event.composedPath().some(node => node instanceof HTMLElement &&
            (node.isContentEditable || node.matches('input, textarea, select, dialog, [role="dialog"], [role="menu"], [role="textbox"], [role="combobox"], [data-music-notes-recorder]')))) return;
        const key = shortcutOf(event);
        if (!key || key !== section.settings.get()[FIELD] || isReserved(key)) return;
        event.preventDefault();
        event.stopPropagation();
        open();
    };
    const registerOpen = (globalShortcut: boolean) => folium.registries.commands.register({
        id: 'open', globalShortcut, label: name, keywords: ['notes', 'tags', '笔记', '备注', '标签'], run: open,
    });
    let enabled = section.settings.get()[ENABLED] !== false;
    let command = registerOpen(enabled);
    if (enabled) window.addEventListener('keydown', onKey, true);
    // Folium reads globalShortcut when registering. Keep the same command ID so the host retains its binding.
    const offSettings = section.settings.onChange(() => {
        const next = section.settings.get()[ENABLED] !== false;
        if (next === enabled) return;
        enabled = next;
        command.unregister();
        command = registerOpen(enabled);
        if (enabled) window.addEventListener('keydown', onKey, true);
        else window.removeEventListener('keydown', onKey, true);
    });
    return () => {
        offSettings();
        window.removeEventListener('keydown', onKey, true);
        command.unregister();
        section.unregister();
    };
}
