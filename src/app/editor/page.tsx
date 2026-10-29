'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import EditorLanding from '@/components/sprites/EditorLanding';
import PixelEditorBody from '@/components/sprites/PixelEditorBody';
import {
  useEditorStore,
  dimsWithinEditorLimits,
  editorDimsRejectionMessage,
} from '@/components/sprites/editorStore';
import type { SpriteProjectSource, SpriteProjectV1 } from '@/lib/spriteProject';
import { useSpriteStore } from '@/stores/spriteStore';
import {
  IndexedDbDraftStore,
  isRecoveryAvailable,
  draftsFor,
  newDraftKey,
  type RecoveryManifestV1,
} from '@/lib/editorRecovery';
import { discardEditorDraft, editorWritesSettled, isEditorSessionOpen, visibleDraft } from '@/components/sprites/useEditorRecovery';

/**
 * /editor — full-page Pixel Editor (v2 Phase 1).
 *
 * Three render states gated by local React state:
 *   1. isLoadingHandoff === true → "Send to Editor" intent detected on
 *      mount and the source image is being decoded for dimensions. Brief
 *      transient state; flips to pending-set as soon as img.onload fires.
 *   2. pending === null → render <EditorLanding>. User picks a starting
 *      point (blank canvas or uploaded image); the landing produces a
 *      dataUrl + dimensions and hands them up via onProjectReady.
 *   3. pending set → render <PixelEditorBody layout="page">. The body's
 *      own useEffect loads the frame into editorStore — single canonical
 *      load entry point, no duplicate dispatch.
 *
 * "Send to Editor" handoff:
 *   GenerationResult sets spriteStore.pendingEditorHandoff = true and
 *   pushes /editor. This page's mount effect consumes-and-clears the flag,
 *   derives the source image dimensions client-side from
 *   spriteStore.generatedImageDataUrl, and dispatches setPending().
 *   The image stays in spriteStore (not cleared) so the user can navigate
 *   back to /generate and still see their result preserved.
 *
 * Back from editor → reset() the store AND clear local pending, returning
 * to the landing. The body's unmount cleanup also calls reset(), so the
 * order is safe either way.
 *
 * No `runtime = 'edge'` — pure client page, matches /upload, /generate,
 * /gallery, /preview, /export.
 */

// Every session has its own draft key (BUILD 2026-10-29): a new one for a
// new image, or the restored draft's own key, so a restored session keeps
// saving into the draft it came from.
type EditorPending =
  | { kind: 'image'; draftKey: string; dataUrl: string; width: number; height: number; source?: SpriteProjectSource }
  | { kind: 'restore'; draftKey: string; envelope: SpriteProjectV1; bytes: Uint8ClampedArray };

const NO_DRAFTS: RecoveryManifestV1[] = [];

export default function EditorPage() {
  const [pending, setPending] = useState<EditorPending | null>(null);
  const { isLoaded: authLoaded, userId } = useAuth();
  // The signed-in user id, null when signed out, undefined until Clerk knows.
  const account = authLoaded ? (userId ?? null) : undefined;
  // This account's saved drafts, newest first (any editor surface), with the
  // account they were listed for: shown only to that account, so a sign-out
  // or an account change hides them at once (Second 121).
  const [listed, setListed] = useState<{ account: string | null; drafts: RecoveryManifestV1[] } | null>(null);
  const drafts = listed && listed.account === account ? listed.drafts : NO_DRAFTS;
  // The account as of the latest render, and a count that every restore,
  // every new image and every account change moves on: an async restore
  // opens its draft only if nothing has moved it since it began.
  const accountRef = useRef(account);
  const intentRef = useRef(0);
  useLayoutEffect(() => {
    if (accountRef.current !== account) {
      accountRef.current = account;
      intentRef.current++;
    }
  });
  const [isLoadingHandoff, setIsLoadingHandoff] = useState(false);
  // Handoff-source rejection (Fix #5). When a Send-to-Editor handoff carries
  // an image whose dimensions exceed the editor's caps, surface a clear error
  // on the landing instead of mounting the body just to bounce out.
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const reset = useEditorStore((s) => s.reset);

  // One reused draft-store instance (its connection is cached) for the page's
  // probe / restore / discard. Separate from the body controller's instance.
  const draftStoreRef = useRef<IndexedDbDraftStore | null>(null);
  const getDraftStore = useCallback(
    () => (draftStoreRef.current ??= new IndexedDbDraftStore()),
    [],
  );

  // Probe cancellation handle that can be flipped from OUTSIDE the probe
  // effect (specifically by handleDiscardDraft). The effect's local `cancelled`
  // flag only flips on effect re-run — discard doesn't change any dep, so
  // without this ref a stale getLatest could resolve after deleteDraft and
  // resurrect the banner pointing at a deleted draft.
  const probeCancelRef = useRef<{ cancelled: boolean } | null>(null);

  // Consume the "Send to Editor" handoff intent flag on mount. Read state
  // imperatively via getState() so the effect doesn't re-fire on every
  // spriteStore change — the flag is a one-shot, not a subscription.
  useEffect(() => {
    const { pendingEditorHandoff, generatedImageDataUrl, clearPendingEditorHandoff } =
      useSpriteStore.getState();

    if (!pendingEditorHandoff || !generatedImageDataUrl) return;

    // Clear the flag immediately (before async image load) to prevent
    // double-consumption if this effect re-fires for any reason. The
    // image itself stays in the store for back-navigation preservation.
    clearPendingEditorHandoff();
    setIsLoadingHandoff(true);

    const img = new Image();
    img.onload = () => {
      // Fix #5: refuse oversized handoff sources before committing to the
      // body mount. PixelEditorBody also enforces this defensively, but
      // catching here keeps the user on the landing with a clear message
      // instead of bouncing through the body's error UI.
      if (!dimsWithinEditorLimits(img.naturalWidth, img.naturalHeight)) {
        setHandoffError(editorDimsRejectionMessage(img.naturalWidth, img.naturalHeight));
        setIsLoadingHandoff(false);
        return;
      }
      intentRef.current++;
      setPending({
        kind: 'image',
        draftKey: newDraftKey('page'),
        dataUrl: generatedImageDataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        source: { kind: 'generation' },
      });
      setIsLoadingHandoff(false);
    };
    img.onerror = () => {
      // Decode failed — fall back to Landing rather than locking the page
      // on the loading state. PixelEditorBody can't open without dimensions.
      setIsLoadingHandoff(false);
    };
    img.src = generatedImageDataUrl;
    // Mount-only — the handoff is a one-shot consumed on arrival. The
    // effect doesn't close over any reactive values (uses getState()
    // imperatively), so an empty deps array is genuinely correct here.
  }, []);

  // Probe for this user's saved drafts whenever the landing is about to show
  // (no pending project, not mid-handoff, no handoff queued). Re-runs when
  // pending returns to null (e.g. after Back) so the list is current. A
  // draft an editor in this tab is still working on is left out. Best-
  // effort: any failure leaves the landing without a list.
  useEffect(() => {
    if (pending !== null || isLoadingHandoff || account === undefined) return;
    if (useSpriteStore.getState().pendingEditorHandoff) return;

    const token = { cancelled: false };
    probeCancelRef.current = token;
    (async () => {
      try {
        if (!(await isRecoveryAvailable())) return;
        // The editor session that just ended has saved or closed its draft.
        await editorWritesSettled();
        const all = (await getDraftStore().listDrafts())
          .map((c) => c.manifest)
          .filter((m) => !isEditorSessionOpen(m.draftId));
        if (!token.cancelled) setListed({ account, drafts: draftsFor(all, account) });
      } catch {
        if (!token.cancelled) setListed(null);
      }
    })();
    return () => { token.cancelled = true; };
  }, [pending, isLoadingHandoff, account, getDraftStore]);

  const unlist = useCallback((draftId: string) => {
    setListed((l) => l && { ...l, drafts: l.drafts.filter((m) => m.draftId !== draftId) });
  }, []);

  // Shared dismiss for both pending kinds. Keep-it-simple lifecycle: in-editor
  // Back does NOT delete the draft (it persists and is offered again next
  // visit); only the banner's Discard deletes.
  const handleDismiss = useCallback(() => {
    reset();
    setPending(null);
  }, [reset]);

  // Opens a draft for the account signed in when it was chosen, if that
  // account may see it (its owner checked against the store, not the list on
  // screen), and only if no account change, other restore or new image came
  // in the meantime (Second 121).
  const handleRestoreDraft = useCallback(async (draftId: string) => {
    const intent = ++intentRef.current;
    const who = accountRef.current;
    if (who === undefined) return;
    const stillWanted = () => intentRef.current === intent && accountRef.current === who;
    try {
      const found = await visibleDraft(draftId, who);
      if (!stillWanted()) return;
      if (!found) { unlist(draftId); return; }
      const draft = await getDraftStore().loadDraft(draftId);
      if (!stillWanted()) return;
      setPending({ kind: 'restore', draftKey: draftId, envelope: draft.project, bytes: draft.bytes });
    } catch {
      // Draft corrupt or gone: drop it from the list; the editor starts fresh.
      if (stillWanted()) unlist(draftId);
    }
  }, [getDraftStore, unlist]);

  // Deletes a draft only if the account signed in at the click may see it,
  // and still is when the check answers (Second 121).
  const handleDiscardDraft = useCallback(async (draftId: string) => {
    const who = accountRef.current;
    // Cancel any in-flight probe BEFORE deleting, so its stale result can't
    // resurrect the draft in the list after we remove it.
    if (probeCancelRef.current) probeCancelRef.current.cancelled = true;
    if (who !== undefined && (await visibleDraft(draftId, who)) && accountRef.current === who) {
      await discardEditorDraft(draftId);
    }
    unlist(draftId);
  }, [unlist]);

  // "Restore in Editor" on Generate: open that draft (one-shot, like the
  // Send to Editor handoff above), once Clerk knows the account, and only
  // for the account that chose it there.
  useEffect(() => {
    if (account === undefined) return;
    const { pendingEditorRestore, setPendingEditorRestore } = useSpriteStore.getState();
    if (!pendingEditorRestore) return;
    setPendingEditorRestore(null);
    if (pendingEditorRestore.account !== account) return;
    setIsLoadingHandoff(true);
    void handleRestoreDraft(pendingEditorRestore.draftId).finally(() => setIsLoadingHandoff(false));
  }, [handleRestoreDraft, account]);

  if (isLoadingHandoff) {
    return (
      <div className="max-w-5xl mx-auto p-8 text-center">
        <p className="text-sm font-mono text-text-secondary">
          Loading your sprite into the editor…
        </p>
      </div>
    );
  }

  if (!pending) {
    return (
      <>
        {handoffError && (
          <div className="max-w-3xl mx-auto px-8 pt-6">
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-semibold text-red-400 mb-1">
                  Couldn&apos;t bring that image into the editor
                </p>
                <p className="text-[11px] font-mono text-text-secondary leading-relaxed">
                  {handoffError}
                </p>
              </div>
              <button
                onClick={() => setHandoffError(null)}
                className="text-[10px] font-mono text-text-muted hover:text-text-primary cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        <EditorLanding
          onProjectReady={(dataUrl, width, height, source) => {
            intentRef.current++;
            setPending({ kind: 'image', draftKey: newDraftKey('page'), dataUrl, width, height, source });
          }}
          drafts={drafts}
          onRestoreDraft={(draftId) => void handleRestoreDraft(draftId)}
          onDiscardDraft={(draftId) => void handleDiscardDraft(draftId)}
        />
      </>
    );
  }

  return (
    // HotkeysProvider scopes the editor's hotkeys to the 'editor' scope so
    // they don't fire while a text input (project name, gallery search, etc.)
    // is focused. Matches the modal-mode provider in PixelEditor.tsx.
    //
    // The h-dvh wrapper gives PixelEditorBody's `h-full` a definite parent
    // so the mobile single-column grid's `1fr` canvas row resolves to real
    // pixels instead of collapsing to zero (the canvas children are
    // absolutely positioned and don't contribute intrinsic height). The
    // modal layout gets the same effect via Dialog.Panel's own h-dvh.
    // h-dvh (not h-screen) avoids iOS Safari's URL-bar 100vh trap.
    <HotkeysProvider initiallyActiveScopes={['editor']}>
      <div className="h-editor-page overflow-hidden">
        {pending.kind === 'image' ? (
          <PixelEditorBody
            frameDataUrl={pending.dataUrl}
            frameWidth={pending.width}
            frameHeight={pending.height}
            onSave={() => {}}
            onDismiss={handleDismiss}
            layout="page"
            source={pending.source}
            draftKey={pending.draftKey}
          />
        ) : (
          <PixelEditorBody
            frameDataUrl=""
            frameWidth={pending.envelope.canvas.width}
            frameHeight={pending.envelope.canvas.height}
            onSave={() => {}}
            onDismiss={handleDismiss}
            layout="page"
            source={pending.envelope.source}
            restore={{ envelope: pending.envelope, bytes: pending.bytes }}
            draftKey={pending.draftKey}
            onDiscardDraft={async () => {
              await handleDiscardDraft(pending.draftKey);
              handleDismiss();
            }}
          />
        )}
      </div>
    </HotkeysProvider>
  );
}
