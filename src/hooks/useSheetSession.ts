'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSpriteStore } from '@/stores/spriteStore';
import {
  clearSheetSession,
  hasSheetSession,
  isSheetSessionSaving,
  loadSheetSession,
  saveSheetSession,
  type SheetSessionState,
} from '@/lib/sheetSession';
import type { SpriteSheet } from '@/lib/types';

/** Same cadence as the editor's recovery controller (useEditorRecovery). */
const DEBOUNCE_MS = 1000;
const MAX_WAIT_MS = 10000;

// One autosave for the whole app, shared by every Sheet Tools page that is
// mounted. Module scope because the sprite store it watches is module scope
// too, and moving between /upload, /preview and /export must not drop a
// pending save.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let resaveQueued = false;
let mounts = 0;
let stopAutosave: (() => void) | null = null;
/** What the device holds now, by reference, so an unchanged store is not
 *  saved again (including right after a restore). */
let lastSaved: SheetSessionState | null = null;
/** A sheet the user threw away; never saved again, even by a save that was
 *  already scheduled when they did. */
let forgottenSheet: SpriteSheet | null = null;

function snapshot(): SheetSessionState | null {
  const s = useSpriteStore.getState();
  if (!s.spriteSheet || s.spriteSheet === forgottenSheet) return null;
  return {
    spriteSheet: s.spriteSheet,
    animations: s.animations,
    frameDataUrls: s.frameDataUrls,
    currentSheetMetadata: s.currentSheetMetadata,
    generationStyle: s.generationStyle,
  };
}

function sameSession(a: SheetSessionState | null, b: SheetSessionState | null): boolean {
  return !!a && !!b &&
    a.spriteSheet === b.spriteSheet &&
    a.animations === b.animations &&
    a.frameDataUrls === b.frameDataUrls &&
    a.currentSheetMetadata === b.currentSheetMetadata &&
    a.generationStyle === b.generationStyle;
}

function clearTimers() {
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
}

async function doSave() {
  if (saving) { resaveQueued = true; return; }
  const snap = snapshot();
  if (!snap || sameSession(snap, lastSaved)) return;
  saving = true;
  try {
    // Never throws; a failure turns saving off for the page session.
    await saveSheetSession(snap);
    lastSaved = snap;
  } finally {
    saving = false;
    if (resaveQueued) { resaveQueued = false; scheduleSave(); }
  }
}

function scheduleSave() {
  if (!isSheetSessionSaving()) return;
  const snap = snapshot();
  if (!snap || sameSession(snap, lastSaved)) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { clearTimers(); void doSave(); }, DEBOUNCE_MS);
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => { clearTimers(); void doSave(); }, MAX_WAIT_MS);
  }
}

function flush() {
  if (!debounceTimer && !maxWaitTimer) return;
  clearTimers();
  void doSave();
}

function startAutosave(): () => void {
  const unsub = useSpriteStore.subscribe((s, prev) => {
    if (
      s.spriteSheet !== prev.spriteSheet ||
      s.animations !== prev.animations ||
      s.frameDataUrls !== prev.frameDataUrls ||
      s.currentSheetMetadata !== prev.currentSheetMetadata ||
      s.generationStyle !== prev.generationStyle
    ) {
      scheduleSave();
    }
  });
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);
  scheduleSave();
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flush);
    flush();
  };
}

/**
 * The user threw away the sheet in the store (Replace sheet, or Continue on
 * PR 6's "This clears your frames and groups" confirm): delete the saved
 * session too. No-op when the store holds no sheet, so a saved session the
 * user has not been offered yet is never deleted behind their back.
 */
export function forgetSheetSession(): void {
  const sheet = useSpriteStore.getState().spriteSheet;
  if (!sheet) return;
  forgottenSheet = sheet;
  lastSaved = null;
  clearTimers();
  void clearSheetSession();
}

/**
 * Sheet Tools session on this device, for /upload, /preview and /export.
 * Autosaves the sheet, frames and groups while the page is mounted, and
 * offers the saved session back when the page opens with an empty store.
 */
export function useSheetSession() {
  const hasSheet = useSpriteStore((s) => s.spriteSheet !== null);
  const [saved, setSaved] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (mounts++ === 0) stopAutosave = startAutosave();
    return () => {
      if (--mounts === 0 && stopAutosave) {
        stopAutosave();
        stopAutosave = null;
      }
    };
  }, []);

  // Offer only when the page opens with nothing in the store. Once the store
  // holds a sheet again, the saved one is either restored or about to be
  // overwritten, so the offer goes for the rest of this visit.
  useEffect(() => {
    if (useSpriteStore.getState().spriteSheet) return;
    let cancelled = false;
    void hasSheetSession().then((yes) => {
      if (!cancelled && yes && !useSpriteStore.getState().spriteSheet) setSaved(true);
    });
    const unsub = useSpriteStore.subscribe((s) => {
      if (s.spriteSheet) setSaved(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  /** Puts the saved session back in the store. False when there was nothing
   *  usable to restore or the store got a sheet in the meantime. */
  const restore = useCallback(async (): Promise<boolean> => {
    setRestoring(true);
    try {
      const session = await loadSheetSession();
      if (!session || useSpriteStore.getState().spriteSheet) {
        if (session) URL.revokeObjectURL(session.spriteSheet.sourceImage);
        setSaved(false);
        return false;
      }
      lastSaved = session;
      useSpriteStore.getState().restoreSheetSession(session);
      setSaved(false);
      return true;
    } finally {
      setRestoring(false);
    }
  }, []);

  const discard = useCallback(() => {
    setSaved(false);
    void clearSheetSession();
  }, []);

  return { offerRestore: saved && !hasSheet, restoring, restore, discard };
}
