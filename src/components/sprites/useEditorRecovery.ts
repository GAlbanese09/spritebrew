'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import { useEditorStore, selectHasPixelChanges } from './editorStore';
import {
  IndexedDbDraftStore,
  isRecoveryAvailable,
  requestPersistentStorage,
  MAX_DRAFTS,
  draftVisibleTo,
  type DraftSurface,
  type RecoveryManifestV1,
  type SaveReason,
} from '@/lib/editorRecovery';
import type { SpriteProjectV1 } from '@/lib/spriteProject';
import type { LeaveSaveState } from '@/lib/editorCopy';
import { isDevHost } from '@/lib/isDevHost';

/** The full-page editor's draft key from before every session had its own
 *  (BUILD 2026-10-29). Drafts saved under it are still listed and restored. */
export const PAGE_SCRATCH_KEY = 'page:scratch';
const DEBOUNCE_MS = 1000;
const MAX_WAIT_MS = 10000;
// How long a session waits for Clerk to know the account before it saves as
// no account rather than hold the work back (Clerk can fail to load).
const CLERK_WAIT_MS = 5000;

// One store for every session and for the close and discard calls, so its
// database connection is opened once.
let sharedStore: IndexedDbDraftStore | null = null;
/** The editor's draft store, shared by every editor surface in this tab. */
export function editorDraftStore(): IndexedDbDraftStore {
  return (sharedStore ??= new IndexedDbDraftStore());
}

// Shared by a session's saver and the explicit discard and close calls,
// per draft key: the chain of writes in flight, the session's "save the
// newest state now", and the drafts no later save may touch.
const writeChains = new Map<string, Promise<void>>();
const flushers = new Map<string, () => void>();
const ended = new Set<string>();
// Sessions open in this tab: their drafts are not offered for restore.
const openSessions = new Set<string>();

/** True while an editor in this tab is working on the draft. */
export function isEditorSessionOpen(key: string): boolean {
  return openSessions.has(key);
}

// How an open session's work is kept, for the leave question (SB-25, the
// outside audit of Nov 24, 2026: it promised a saved copy when the save had
// failed). Revisions are the editor store's: the newest write that landed,
// the last write that finished and whether it landed, the writes still on
// their way, and the newest revision with nothing to keep.
interface SaveTrack {
  available: boolean | undefined;
  landed: number;
  settled: { revision: number; ok: boolean } | null;
  pending: number;
  nothing: number;
}
const tracks = new Map<string, SaveTrack>();
const trackListeners = new Set<() => void>();
const notifyTracks = () => trackListeners.forEach((l) => l());

/** How the session's work under `key` is kept right now: "saved" once the
 *  write of what is on screen has landed (or there is nothing to keep),
 *  "unsaved" when that write failed or this browser cannot keep drafts,
 *  else "saving". Never "saved" on a guess. */
export function leaveSaveState(key: string): LeaveSaveState {
  const t = tracks.get(key);
  if (!t) return 'saving';
  if (t.available === false) return 'unsaved';
  const revision = useEditorStore.getState().revision;
  if (t.nothing === revision) return 'saved';
  // A write on its way decides nothing yet: saving, even when an earlier
  // write of the same picture landed, so the words never say saved and then
  // not saved (AUDIT data-loss r2, L1). Writes run in order, so one on its
  // way is of what is on screen or of an older picture.
  if (t.pending > 0) return 'saving';
  // The newest finished write of what is on screen decides: a later write of
  // the same picture that failed outweighs an earlier one that landed (AUDIT
  // data-loss r1, L3).
  if (t.settled?.revision === revision && !t.settled.ok) return 'unsaved';
  if (t.landed === revision) return 'saved';
  return 'saving';
}

/** Calls `onChange` whenever leaveSaveState may have changed: a write
 *  asked for or finished, or the editor's state moved. */
export function subscribeLeaveSaveState(onChange: () => void): () => void {
  trackListeners.add(onChange);
  const unsub = useEditorStore.subscribe(onChange);
  return () => { trackListeners.delete(onChange); unsub(); };
}

/** Saves the session's newest state now rather than after the usual wait
 *  (the leave question asks for it as it opens). */
export function flushEditorDraft(key: string): void {
  flushers.get(key)?.();
}

const settle = (p: Promise<void> | undefined) => (p ?? Promise.resolve()).catch(() => {});

/** Settles once every draft write already asked for in this tab has landed
 *  (at most 2 s), so a list of drafts read after it sees them: an editor
 *  that just went has saved or closed its draft by then. */
export function editorWritesSettled(): Promise<void> {
  const all = Promise.all([...writeChains.values()].map(settle)).then(() => undefined);
  return Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
}

/** Runs `step` after every write already asked for under `key`, in the same
 *  queue, so a later session's writes under the key come after it. */
function afterWrites(key: string, step: () => Promise<void>): Promise<void> {
  const chain = settle(writeChains.get(key)).then(() => step().catch(() => { /* best-effort */ }));
  writeChains.set(key, chain);
  return chain;
}

/** The draft's manifest when `owner` (the signed-in user id, or null when
 *  signed out) may restore or discard it now, else null: its own, or one no
 *  account owns (Second 121). */
export async function visibleDraft(draftId: string, owner: string | null): Promise<RecoveryManifestV1 | null> {
  const found = await editorDraftStore().getLatest(draftId);
  return found && draftVisibleTo(found.manifest, owner) ? found.manifest : null;
}

/** Discard in the editor or on a restore banner: no later save may write
 *  the draft, and it is deleted once any write in flight has landed. */
export function discardEditorDraft(key: string): Promise<void> {
  ended.add(key);
  return afterWrites(key, () => editorDraftStore().deleteDraft(key));
}

/** The session ended the way the user chose (Save, Back, a confirmed
 *  Leave). Its newest state is saved first, then the draft is marked
 *  closed, so Generate no longer offers it; the Editor still lists it. Call
 *  it before the editor unmounts: the newest state is read at once. If the
 *  editor stays open and is edited again, the session goes on (see the
 *  revision subscription below). */
export function closeEditorDraft(key: string): Promise<void> {
  flushers.get(key)?.();
  ended.add(key);
  return afterWrites(key, () => editorDraftStore().markClosed(key));
}

interface UseEditorRecoveryOptions {
  /** Off only where there is nothing to save. */
  enabled: boolean;
  /** Reads the body's current palette so it can be merged into the saved
   *  envelope (toProject() emits an empty palette). Called at save time. */
  getPalette: () => string[];
  /** This session's draft key (newDraftKey), or a restored draft's key. */
  projectKey: string;
  surface: DraftSurface;
}

/**
 * Saves the editor's work to IndexedDB as the user edits, on every editor
 * surface (BUILD 2026-10-29: the modal used to save nothing, and an iPhone
 * reload lost a whole session): 1 s after an edit, at least every 10 s while
 * editing goes on, and at once when the tab is hidden or Back is used.
 * Each write is a snapshot read when it is asked for; writes run one after
 * another, so the newest snapshot lands last. The draft records the signed-
 * in account, so it is offered only to that account.
 */
export function useEditorRecovery({
  enabled,
  getPalette,
  projectKey,
  surface,
}: UseEditorRecoveryOptions): void {
  // Latest palette-getter in a ref so the long-lived subscription and
  // lifecycle handlers read the current palette without being rebuilt on
  // every palette change.
  const getPaletteRef = useRef(getPalette);
  const { isLoaded, userId } = useAuth();
  const authRef = useRef({ isLoaded, userId });
  // The open session's account, pinned the first time Clerk is known to
  // have loaded while it is open: at its start if Clerk had loaded by then,
  // else at the first render after. A sign-out or another account later in
  // the session never moves its draft (Second 121). undefined: not known.
  // Only the session of this render's key is pinned: in a render that both
  // ends a session (a new key) and first knows the account, the ending
  // session keeps what it knew (Second 122).
  const sessionRef = useRef<{ key: string; owner: string | null | undefined } | null>(null);
  useLayoutEffect(() => {
    getPaletteRef.current = getPalette;
    authRef.current = { isLoaded, userId };
    const session = sessionRef.current;
    if (session && session.key === projectKey && session.owner === undefined && isLoaded) session.owner = userId ?? null;
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const store = editorDraftStore();
    let disposed = false;
    let available = false;
    let persistRequested = false;
    const session: { key: string; owner: string | null | undefined } = {
      key: projectKey,
      owner: authRef.current.isLoaded ? (authRef.current.userId ?? null) : undefined,
    };
    sessionRef.current = session;
    let clerkWaitOver = false;
    const clerkTimer = setTimeout(() => { clerkWaitOver = true; }, CLERK_WAIT_MS);
    // True once this session has asked for a write (it had edits).
    let wrote = false;
    const track: SaveTrack = { available: undefined, landed: -1, settled: null, pending: 0, nothing: -1 };
    tracks.set(projectKey, track);
    // A session that starts under a key (a restore) may write it again.
    ended.delete(projectKey);
    openSessions.add(projectKey);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
    };

    // Synchronous snapshot: read envelope and raw bytes back-to-back so they
    // describe the same frame, then merge the live palette. Null when there is
    // nothing worth saving (reset / empty, or the picture as it was loaded
    // with no draft of this session's to bring back in line). Reading
    // synchronously and handing the bytes straight to saveDraft (which copies
    // them) is what makes this safe against the unmount reset() that nulls
    // the store while a save is still in flight.
    //
    // What is on screen is what is saved, whatever the history index says
    // (SB-26, the outside audit of Nov 24, 2026): an Undo back to the start,
    // or to the oldest step history keeps (index 0 after MAX_HISTORY steps,
    // with edits still on the canvas), used to save nothing, so a restore
    // brought back the edits the user had undone.
    const snapshot = (): { project: SpriteProjectV1; bytes: Uint8ClampedArray } | null => {
      const s = useEditorStore.getState();
      if (s.historyIndex < 0) return null;
      if (!wrote && !selectHasPixelChanges(s)) return null;
      const project = s.toProject();
      if (!project) return null;
      const bytes = s.getFramePixels(project.frames[0].id);
      if (!bytes) return null;
      project.color.palette = getPaletteRef.current() ?? [];
      return { project, bytes: new Uint8ClampedArray(bytes) };
    };

    const scheduleSave = () => {
      if (!available || ended.has(projectKey)) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { clearTimers(); doSave('edit'); }, DEBOUNCE_MS);
      if (!maxWaitTimer) {
        maxWaitTimer = setTimeout(() => { clearTimers(); doSave('idle'); }, MAX_WAIT_MS);
      }
    };

    // `last`: the session's final save (its editor is going), which cannot
    // wait for Clerk any longer.
    const doSave = (reason: SaveReason, last = false) => {
      if (!available || ended.has(projectKey)) return;
      // Until Clerk has loaded the session's account is not known. A save
      // waits for it, but not past CLERK_WAIT_MS and never on the session's
      // last save; meanwhile the draft is saved with no owner of its own (a
      // draft that has one keeps it), and the first save once the account is
      // known sets it. The owner travels with this snapshot.
      const owner = session.owner;
      if (owner === undefined && !clerkWaitOver && !last) {
        scheduleSave();
        return;
      }
      const revision = useEditorStore.getState().revision;
      const snap = snapshot();
      if (!snap) {
        track.nothing = revision;
        notifyTracks();
        return;
      }
      wrote = true;
      track.pending++;
      notifyTracks();
      // Queued behind the writes already asked for, so a Discard or a close
      // asked for after this write comes after it too.
      void afterWrites(projectKey, async () => {
        let ok = false;
        try {
          await store.saveDraft({ projectKey, project: snap.project, bytes: snap.bytes, reason, owner, surface });
          ok = true;
          void store.prune(MAX_DRAFTS, projectKey).catch(() => { /* best-effort */ });
          if (!persistRequested) { persistRequested = true; void requestPersistentStorage(); }
        } catch (err) {
          if (isDevHost()) console.warn('[editorRecovery] save failed', err);
        } finally {
          track.pending--;
          track.settled = { revision, ok };
          if (ok && revision > track.landed) track.landed = revision;
          notifyTracks();
        }
      });
    };

    const flushUrgent = () => {
      if (!available) return;
      clearTimers();
      doSave('lifecycle');
    };

    // closeEditorDraft's "save the newest state now": the session's last
    // save, so it never waits for Clerk (Second 121: a close before Clerk
    // loaded saved nothing).
    const flushExplicit = () => {
      clearTimers();
      doSave('explicit', true);
    };
    flushers.set(projectKey, flushExplicit);

    // revision bumps on every history write (stroke end, undo, redo, revert,
    // flip, load, reset). historyIndex alone stops moving once the stack is
    // at its cap, since endStroke then shifts the stack and leaves the index
    // in place, which silently ended autosave after 50 strokes.
    // subscribeWithSelector is already enabled.
    const unsub = useEditorStore.subscribe((s) => s.revision, () => {
      // An edit after a close or a Discard while this editor is still open
      // (a Leave whose Back had nowhere to go, say): the session goes on, so
      // its work is saved again, until the next close or Discard. An Undo
      // back to index 0 counts too when it leaves something to keep (SB-26);
      // a reset (index -1) never does.
      const s = useEditorStore.getState();
      if (ended.has(projectKey) && (s.historyIndex > 0 || (s.historyIndex === 0 && (wrote || selectHasPixelChanges(s))))) ended.delete(projectKey);
      scheduleSave();
    });

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
      track.available = ok;
      notifyTracks();
      if (!ok) {
        if (isDevHost()) console.warn('[editorRecovery] unavailable in this browser context');
        return;
      }
      if (selectHasPixelChanges(useEditorStore.getState())) scheduleSave();
    }).catch(() => {
      // No recovery in this context.
      if (disposed) return;
      track.available = false;
      notifyTracks();
    });

    return () => {
      // The editor goes without a close or a Discard (a sign-out, or the
      // page around it going away): its newest state is saved now. This
      // cleanup runs before the body's own reset(), so the store still
      // holds it; where the store was reset first (the page's own Back),
      // there is nothing to save. A Save, a Leave or a Discard has ended
      // the session already, and doSave skips it.
      clearTimers();
      doSave('lifecycle', true);
      if (sessionRef.current === session) sessionRef.current = null;
      disposed = true;
      available = false;
      openSessions.delete(projectKey);
      if (tracks.get(projectKey) === track) tracks.delete(projectKey);
      unsub();
      clearTimeout(clerkTimer);
      if (flushers.get(projectKey) === flushExplicit) flushers.delete(projectKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('popstate', onPopState);
      // A session that saved nothing (no edit of its own) and ends any way
      // at all (a Back or a link from a restored draft left as it was)
      // closes the draft it opened, as the editor's own Back would, so
      // Generate stops offering it; the Editor still lists it. A new session
      // has no draft, so this does nothing there. Queued now, so a list read
      // after editorWritesSettled() sees it; it waits one task first, so a
      // StrictMode remount (which reopens the session at once) is not taken
      // for an end.
      if (!wrote) {
        void afterWrites(projectKey, () => new Promise<void>((resolve) => setTimeout(resolve, 0))
          .then(() => (openSessions.has(projectKey) ? undefined : store.markClosed(projectKey))));
      }
    };
  }, [enabled, projectKey, surface]);
}
