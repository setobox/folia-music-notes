import { useEffect, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NoteSong } from '../core';
import type { MusicNotesPort } from '../hostTypes';

// Use the shared playlist thumbnail treatment. A missing or offline cover keeps its platform badge.
export function NoteCover({ song, port, large = false }: { song: NoteSong; port: MusicNotesPort; large?: boolean }) {
    const { t } = useTranslation();
    const frame = useRef<HTMLSpanElement>(null);
    const [url, setUrl] = useState<string | null>(null);
    const { id, source } = song;
    const songRef = useRef(song);
    songRef.current = song;
    useEffect(() => {
        let active = true;
        setUrl(null);
        const load = () => { void port.cover(songRef.current).then(value => { if (active) setUrl(value); }, () => undefined); };
        let observer: IntersectionObserver | undefined;
        if (frame.current && typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
            });
            observer.observe(frame.current);
        } else load();
        return () => { active = false; observer?.disconnect(); };
    }, [port, source, id]);
    const provider = source.replace(/^online:/u, '');
    const name = source === 'local' ? t('musicNotes.sourceLocal') : provider === 'qq' ? t('musicNotes.sourceQq')
        : provider === 'netease' ? t('musicNotes.sourceNetease') : provider;
    const badge = provider === 'local' ? t('musicNotes.localBadge') : provider === 'netease' ? t('musicNotes.neteaseBadge')
        : provider === 'qq' ? 'QQ' : provider;
    return <span ref={frame} className={`relative shrink-0 ${large ? 'size-16' : 'size-10'}`}>
        <span className="grid size-full place-items-center overflow-hidden rounded-lg bg-[var(--st-fill2)] text-[color:var(--st-t3)]">
            {url ? <img src={url} alt="" draggable={large ? undefined : false} loading="lazy" decoding="async" className="size-full object-cover" onError={() => setUrl(null)} />
                : <Music2 size={large ? 24 : 16} aria-hidden />}
        </span>
        <span title={name} aria-label={name} className="absolute bottom-0 right-0 max-w-full truncate rounded bg-[var(--st-card)] px-1 text-xs leading-none text-[color:var(--st-t2)]">{badge}</span>
    </span>;
}
