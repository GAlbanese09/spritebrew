'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/** How long a Leave by the browser's Back waits for the page to go before
 *  it falls back. */
export const LEAVE_BACK_WAIT_MS = 500;

/**
 * Leaves the page with the browser's Back, after the user's own Back took the
 * editor's history entry and they chose Leave (BUILD 2026-10-29). When there
 * is no page to go back to (the editor is the tab's first page), or the entry
 * below is this same page (Next keeps the editor mounted then), `fallback`
 * runs after LEAVE_BACK_WAIT_MS instead, so the editor does not stay open
 * with its session closed.
 *
 * The wait belongs to the editor session that started it (`sessionKey`, its
 * draft key), and so does the close it runs: the fallback as it was when the
 * Leave was chosen. It is cancelled when that session ends in the editor:
 * when the editor goes, or when another draft takes its place in the same
 * editor. The cancel runs in the commit that does either, so an old wait can
 * never close a later session (Second 121, 122).
 */
export function useLeaveByBack(fallback: () => void, sessionKey: string): () => void {
  const fallbackRef = useRef(fallback);
  useLayoutEffect(() => {
    fallbackRef.current = fallback;
  });
  const cancelRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, [sessionKey]);

  return useCallback(() => {
    cancelRef.current?.();
    const fallbackNow = fallbackRef.current;
    const from = window.location.pathname;
    let moved = false;
    const onPop = () => { moved = true; };
    window.addEventListener('popstate', onPop, { once: true });
    const timer = window.setTimeout(() => {
      cancelRef.current = null;
      window.removeEventListener('popstate', onPop);
      if (!moved || window.location.pathname === from) fallbackNow();
    }, LEAVE_BACK_WAIT_MS);
    cancelRef.current = () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
    };
    window.history.back();
  }, []);
}
