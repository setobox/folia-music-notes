import type { FoliumClientApi, FoliumSong } from '../types/folium';
import type { NoteSong } from './core/notesTypes';
import { parseNoteSong } from './core/notesValidation';

// The only compatibility boundary: private playlists and original sourceRef identities are not public Folium APIs.
export class NoteImportError extends Error {
    constructor(readonly code: 'account-unavailable' | 'account-changed' | 'incomplete' | 'limit' | 'unsupported-host') {
        super(`Music notes host: ${code}`);
        this.name = 'NoteImportError';
    }
}

export const objectOf = (value: unknown): Record<string, unknown> => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function') || Array.isArray(value)) {
        throw new NoteImportError('incomplete');
    }
    return value as Record<string, unknown>;
};

export const idOf = (value: unknown): string => {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === ''
        || (typeof value === 'number' && !Number.isFinite(value))) throw new NoteImportError('incomplete');
    return String(value);
};

export const methodOf = (owner: Record<string, unknown>, name: string): ((...args: unknown[]) => unknown) => {
    const value = owner[name];
    if (typeof value !== 'function') throw new NoteImportError('unsupported-host');
    const method = value as (...args: unknown[]) => unknown;
    return (...args) => method.call(owner, ...args);
};

export const assertSupportedHost = (folium: FoliumClientApi): void => {
    const version = /^0\.7\.(\d+)(?:[-+].*)?$/u.exec(folium.host.folia ?? '');
    if (folium.host.folium.major !== 1 || folium.host.folium.minor < 9
        || folium.env.context !== 'main' || !version || Number(version[1]) < 29) {
        throw new NoteImportError('unsupported-host');
    }
};

const internalsOf = (folium: FoliumClientApi): Record<string, unknown> => {
    assertSupportedHost(folium);
    try { return objectOf((folium as unknown as Record<string, unknown>).internals); }
    catch { throw new NoteImportError('unsupported-host'); }
};

/** Only call private library methods through this object; public catalog reads stay on folium.omni. */
export const privateLibraryOf = (folium: FoliumClientApi): Record<string, unknown> => {
    try { return objectOf(internalsOf(folium).omni); }
    catch { throw new NoteImportError('unsupported-host'); }
};

/** Preserve the pre-mod sourceRef key: DTO ids can instead be numeric catalog ids or synthetic local ids. */
export const currentIdentityOf = (folium: FoliumClientApi, dto: FoliumSong): string | null => {
    let readState: () => unknown;
    try {
        const stores = objectOf(internalsOf(folium).stores);
        readState = methodOf(objectOf(stores.playback), 'getState');
    } catch { throw new NoteImportError('unsupported-host'); }
    const state = objectOf(readState());
    const transition = state.transitionDisplay == null ? null : objectOf(state.transitionDisplay);
    const rawValue = transition?.song ?? state.currentSong;
    if (!rawValue) return null;
    const raw = objectOf(rawValue);
    if (idOf(raw.id) !== dto.id) return null;
    if (raw.sourceRef != null) {
        const source = objectOf(raw.sourceRef);
        const matches = dto.source === 'local' ? source.kind === 'local'
            : source.kind === 'online' && source.providerId === dto.source;
        return matches ? idOf(source.mediaId) : null;
    }
    // Old online playback objects had no sourceRef; the host DTO already identifies their source.
    if (dto.source !== 'local') return dto.id;
    if (raw.localRef == null) return null;
    return idOf(objectOf(raw.localRef).songId);
};

/** Reduce raw playlist tracks to portable metadata, without retaining provider data or session fields. */
export const importedSongOf = (value: unknown, providerId: string): NoteSong => {
    const raw = objectOf(value);
    const source = objectOf(raw.sourceRef);
    if (source.kind !== 'online' || source.providerId !== providerId) throw new NoteImportError('incomplete');
    if (!Array.isArray(raw.artists)) throw new NoteImportError('incomplete');
    const names = raw.artists.map((artist: unknown) => {
        const name = objectOf(artist).name;
        if (typeof name !== 'string') throw new NoteImportError('incomplete');
        return name;
    });
    const album = objectOf(raw.album).name;
    return parseNoteSong({ source: `online:${providerId}`, id: idOf(source.mediaId),
        title: raw.name, artist: names.join(' / '), ...(album === undefined || album === '' ? {} : { album }) });
};
