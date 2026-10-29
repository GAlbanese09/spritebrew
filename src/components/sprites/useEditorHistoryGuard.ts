'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** The history state field that marks the editor's own entry. */
const ENTRY_KEY = '__spritebrewEditor';

// The guard that armed the current entry last. An editor that went takes
// the entry off only if no newer editor has taken it over in the meantime
// (Second 121: a replaced guard could pop its successor's entry).
let entryHolder: object | null = null;

/**
 * Keeps the browser's Back inside the editor while `active` (BUILD
 * 2026-10-29). On iOS an edge swipe is a Back that no page can block, and it
 * gives no warning, so it could take a user out of the editor in the middle
 * of their work.
 *
 * While active, an entry of the editor's own sits on top of the history (the
 * same URL; Next.js copies its router state into it, so its router treats the
 * entry as its own). A Back pops that entry and calls onBack, which decides
 * what happens: ask first, close the editor, or leave. To stay, the caller
 * calls rearm(), which puts the entry back. When the guard ends another way
 * (the editor closes, or `active` turns false), the entry is taken off again
 * if it is still on top, so the user's next Back is not spent on it. A
 * navigation away while the entry is on top should replace it rather than
 * push past it (ownsTop), so the user's Back from there comes straight back.
 */
export function useEditorHistoryGuard(
  active: boolean,
  onBack: () => void,
): { rearm: () => void; ownsTop: () => boolean } {
  // This guard's own entry id, made when it first arms, and its identity.
  const idRef = useRef<string | null>(null);
  const selfRef = useRef<object>({});
  const onBackRef = useRef(onBack);
  // True while our entry is on the history and not yet popped.
  const armedRef = useRef(false);
  const activeRef = useRef(active);
  // The latest props for the listeners. A layout effect runs before any
  // passive cleanup below reads them.
  useLayoutEffect(() => {
    onBackRef.current = onBack;
    activeRef.current = active;
  });
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isOurs = useCallback(() => {
    const state = window.history.state as Record<string, unknown> | null;
    return idRef.current !== null && state?.[ENTRY_KEY] === idRef.current;
  }, []);

  const arm = useCallback(() => {
    if (idRef.current === null) {
      // An entry an editor left on top before a reload (a crash in the
      // middle of a session) is taken over, rather than another pushed on
      // it, so it is taken off again when this editor closes.
      const left = (window.history.state as Record<string, unknown> | null)?.[ENTRY_KEY];
      idRef.current = typeof left === 'string' ? left : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    if (!isOurs()) window.history.pushState({ [ENTRY_KEY]: idRef.current }, '');
    armedRef.current = true;
    entryHolder = selfRef.current;
  }, [isOurs]);

  useEffect(() => {
    if (!active) return;
    const self = selfRef.current;
    arm();
    const onPopState = () => {
      if (!armedRef.current || isOurs()) return;
      // Our entry was popped: a Back from the editor.
      armedRef.current = false;
      onBackRef.current();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // After this task, so a StrictMode remount (which re-arms the same
      // entry at once) is not undone: if the guard is still off and our
      // entry is still on top, take it off.
      setTimeout(() => {
        if (mountedRef.current && activeRef.current) return;
        if (armedRef.current && isOurs() && entryHolder === self) {
          armedRef.current = false;
          entryHolder = null;
          window.history.back();
        }
      }, 0);
    };
  }, [active, arm, isOurs]);

  const rearm = useCallback(() => {
    if (activeRef.current) arm();
  }, [arm]);

  /** True while the guard's own entry is the current history entry. */
  const ownsTop = useCallback(() => armedRef.current && isOurs(), [isOurs]);

  return { rearm, ownsTop };
}
