import { useEffect, type RefObject } from 'react';

/**
 * Calls `onAway` on a mouse-down outside `ref` (or Escape) while `active`.
 * Used instead of a full-screen `fixed` backdrop, which the header's backdrop-blur would
 * confine to the header's own box.
 */
export function useClickAway(ref: RefObject<HTMLElement>, active: boolean, onAway: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onAway();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, active, onAway]);
}
