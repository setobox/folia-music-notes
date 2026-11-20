import { useSyncExternalStore } from 'react';
import type { Notebook } from '../notebook';

// Page and player mounts subscribe to the same activation-scoped notebook.
export const useMusicNotesLibrary = (notebook: Notebook) =>
    useSyncExternalStore(notebook.subscribe, notebook.getSnapshot);
