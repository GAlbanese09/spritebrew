'use client';

import { useCallback, useEffect, useRef } from 'react';
import { freshPress } from '@/lib/freshPress';

/**
 * For a question's destructive button: `bind` goes on the button, and
 * `accept(e)` says whether its click counts (freshPress). The clock starts
 * when `open` turns true, so the press that opened the question, or a second
 * press of a double tap, does not count.
 */
export function useFreshPress(open: boolean) {
  const openedAt = useRef<number | null>(null);
  const pressedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    openedAt.current = performance.now();
    pressedAt.current = null;
    return () => { openedAt.current = null; pressedAt.current = null; };
  }, [open]);
  const onPointerDown = useCallback(() => { pressedAt.current = performance.now(); }, []);
  const accept = useCallback((e: { detail: number }) => {
    const ok = freshPress(openedAt.current, pressedAt.current, e.detail);
    pressedAt.current = null;
    return ok;
  }, []);
  return { onPointerDown, accept };
}
