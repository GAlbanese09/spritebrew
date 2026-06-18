'use client';

import { useEffect, useRef } from 'react';
import { useEditorStore } from './editorStore';
import {
  IndexedDbDraftStore,
  isRecoveryAvailable,
  requestPersistentStorage,
  type SaveReason,
} from '@/lib/editorRecovery';
import type { SpriteProjectV1 } from '@/lib/spriteProject';

const PAGE_DRAFT_KEY = 'page:scratch';
const DEBOUNCE_MS = 1000;
const MAX_WAIT_MS = 10000;

interface UseEditorRecoveryOptions {
  /** Active only for the full-page editor. The modal surface is Stage 3+. */
  enabled: boolean;
  /** Reads the body's current palette so it can be merged into the saved
   *  envelope (toProject() emits an empty palette). Called at save time. */
  getPalette: () => string[];
  projectKey?: string;
}

export function useEditorRecovery({
  enabled,
  getPalette,
  projectKey = PAGE_DRAFT_KEY,
}: UseEditorRecoveryOptions): void {
  // Latest palette-getter in a ref so the long-lived subscription and
  // lifecycle handlers read the current palette without being rebuilt on
  // every palette change.
  const getPaletteRef = useRef(getPalette);
  getPaletteRef.current = getPalette;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const store = new IndexedDbDraftStore();
    let disposed = false;
    let available = false;
    let persistRequested = false;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let saving = false;
    let resaveQueued = false;

    const clearTimers = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
    };

    // Synchronous snapshot: read envelope and raw bytes back-to-back so they
    // describe the same frame, then merge the live palette. Null when there is
    // nothing worth saving (not dirty / reset / empty). Reading synchronously
    // and handing the bytes straight to saveDraft (which copies them) is what
    // makes this safe against the unmount reset() that nulls the store while a
    // save is still in flight.
    const snapshot = (): { project: SpriteProjectV1; bytes: Uint8ClampedArray } | null => {
      const s = useEditorStore.getState();
      if (s.historyIndex <= 0) return null;
      const project = s.toProject();
      if (!project) return null;
      const bytes = s.getFramePixels(project.frames[0].id);
      if (!bytes) return null;
      project.color.palette = getPaletteRef.current() ?? [];
      return { project, bytes };
    };

    const scheduleSave = () => {
      if (!available) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { clearTimers(); void doSave('edit'); }, DEBOUNCE_MS);
      if (!maxWaitTimer) {
        maxWaitTimer = setTimeout(() => { clearTimers(); void doSave('idle'); }, MAX_WAIT_MS);
      }
    };

    const doSave = async (reason: SaveReason) => {
      if (saving) { resaveQueued = true; return; }
      const snap = snapshot();
      if (!snap) return;
      saving = true;
      try {
        await store.saveDraft({ projectKey, project: snap.project, bytes: snap.bytes, reason });
        if (!persistRequested) { persistRequested = true; void requestPersistentStorage(); }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') console.warn('[editorRecovery] save failed', err);
      } finally {
        saving = false;
        if (resaveQueued && !disposed) { resaveQueued = false; scheduleSave(); }
      }
    };

    const flushUrgent = () => {
      if (!available) return;
      clearTimers();
      void doSave('lifecycle');
    };

    // historyIndex is the existing per-stroke revision signal (bumps on stroke
    // end, undo, redo, revert). subscribeWithSelector is already enabled.
    const unsub = useEditorStore.subscribe((s) => s.historyIndex, () => scheduleSave());

    // popstate is the SPA Back signal in this App Router app (pagehide does NOT
    // fire for client-side back). popstate and visibilitychange keep the page
    // alive so the async save completes; pagehide is best-effort.
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushUrgent(); };
    const onPageHide = () => flushUrgent();
    const onPopState = () => flushUrgent();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('popstate', onPopState);

    void isRecoveryAvailable().then((ok) => {
      if (disposed) return;
      available = ok;
      if (!ok) {
        if (process.env.NODE_ENV !== 'production') console.warn('[editorRecovery] unavailable in this browser context');
        return;
      }
      if (useEditorStore.getState().historyIndex > 0) scheduleSave();
    });

    return () => {
      disposed = true;
      unsub();
      clearTimers();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('popstate', onPopState);
      // Deliberately NO flush and NO delete here. reset() has very likely
      // already nulled the store, and unmount also fires on browser-Back, the
      // exact case we want left recoverable. Discard-on-dismiss is Stage 3.
    };
  }, [enabled, projectKey]);
}
