import { useEffect, useState } from 'react';

/** matchMedia hook; false when matchMedia is unavailable (tests, old browsers). */
export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

/** Touch-first devices get two-step confirmation for placements. */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)');
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/**
 * Estimated SERVER time, ticking locally. `offsetMs` = serverNow − local receive time, so local
 * clock drift never decides deadlines (the server still verifies every timeout request).
 * Only components that display time use this, so the board does not rerender every second.
 */
export function useServerNow(offsetMs: number, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNow(Date.now() + offsetMs);
    const id = setInterval(() => setNow(Date.now() + offsetMs), intervalMs);
    return () => clearInterval(id);
  }, [offsetMs, intervalMs]);
  return now;
}
