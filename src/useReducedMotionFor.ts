import { useSyncExternalStore } from 'react';

// Read the host's published CSS motion preference without importing its settings store.
const subscribe = (listener: () => void): (() => void) => {
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] });
    return () => { observer.disconnect(); };
};

export const useReducedMotionFor = (surface: string): boolean => useSyncExternalStore(subscribe,
    () => (document.documentElement.getAttribute('data-reduce-motion') ?? '').split(' ').includes(surface),
    () => true);

export default useReducedMotionFor;
