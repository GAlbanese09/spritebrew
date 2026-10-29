'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** How long a Leave by the browser's Back waits for the page to go before
 *  it falls back. */
export const LEAVE_BACK_WAIT_MS = 500;

/**
 * Leaves the page with the browser's Back, after the user's own Back took the
 * editor's history entry and they chose Leave (BUILD 2026-10-29). When there
 * is no page to go back to (the editor is the tab's first page), or the entry
 * below is this same page (Next keeps the editor mounted then), `fallback`
 * runs after LEAVE_BACK_WAIT_MS instead, so the editor does not stay open
 * with its session closed. The wait belongs to the editor that started it:
 * it is cancelled when that editor unmounts, so it can never act on a later
 * one (Second 121).
 */
export function useLeaveByBack(fallback: () => void): () => void {
  const fallbackRef = useRef(fallback);
  useLayoutEffect(() => {
    fallbackRef.current = fallback;
  });
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  return useCallback(() => {
    cancelRef.current?.();
    const from = window.location.pathname;
    let moved = false;
    const onPop = () => { moved = true; };
    window.addEventListener('popstate', onPop, { once: true });
    const timer = window.setTimeout(() => {
      cancelRef.current = null;
      window.removeEventListener('popstate', onPop);
      if (!moved || window.location.pathname === from) fallbackRef.current();
    }, LEAVE_BACK_WAIT_MS);
    cancelRef.current = () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
    };
    window.history.back();
  }, []);
}
