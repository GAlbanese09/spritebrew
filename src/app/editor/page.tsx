'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  type RecoveryCandidate,
} from '@/lib/editorRecovery';
import { PAGE_SCRATCH_KEY } from '@/components/sprites/useEditorRecovery';

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

type EditorPending =
  | { kind: 'image'; dataUrl: string; width: number; height: number; source?: SpriteProjectSource }
  | { kind: 'restore'; envelope: SpriteProjectV1; bytes: Uint8ClampedArray };

export default function EditorPage() {
  const [pending, setPending] = useState<EditorPending | null>(null);
  const [recoveryCandidate, setRecoveryCandidate] = useState<RecoveryCandidate | null>(null);
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
      setPending({
        kind: 'image',
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

  // Stage 3: probe for a recoverable page-mode draft whenever we're about to
  // show the landing (no pending project, not mid-handoff, no handoff queued).
  // Re-runs when pending returns to null (e.g. after Back) so the banner
  // reflects the latest draft. Best-effort: any failure leaves the landing
  // un-gated. getLatest returns null when there's no draft, which also clears
  // a stale banner.
  useEffect(() => {
    if (pending !== null || isLoadingHandoff) return;
    if (useSpriteStore.getState().pendingEditorHandoff) return;

    const token = { cancelled: false };
    probeCancelRef.current = token;
    (async () => {
      try {
        if (!(await isRecoveryAvailable())) return;
        const candidate = await getDraftStore().getLatest(PAGE_SCRATCH_KEY);
        if (!token.cancelled) setRecoveryCandidate(candidate);
      } catch {
        if (!token.cancelled) setRecoveryCandidate(null);
      }
    })();
    return () => { token.cancelled = true; };
  }, [pending, isLoadingHandoff, getDraftStore]);

  // Shared dismiss for both pending kinds. Keep-it-simple lifecycle: in-editor
  // Back does NOT delete the draft (it persists and is offered again next
  // visit); only the banner's Discard deletes.
  const handleDismiss = useCallback(() => {
    reset();
    setPending(null);
  }, [reset]);

  const handleRestoreDraft = useCallback(async () => {
    try {
      const draft = await getDraftStore().loadDraft(PAGE_SCRATCH_KEY);
      setPending({ kind: 'restore', envelope: draft.project, bytes: draft.bytes });
    } catch {
      // Draft corrupt or gone — drop the banner; the editor starts fresh.
      setRecoveryCandidate(null);
    }
  }, [getDraftStore]);

  const handleDiscardDraft = useCallback(async () => {
    // Cancel any in-flight probe BEFORE deleting, so its stale getLatest
    // result can't resurrect the banner after we clear it. The probe effect's
    // local cancelled flag only flips on effect re-run; discard doesn't
    // change any dep, so without this we'd see the banner reappear pointing
    // at a deleted draft.
    if (probeCancelRef.current) probeCancelRef.current.cancelled = true;
    try {
      await getDraftStore().deleteDraft(PAGE_SCRATCH_KEY);
    } catch {
      // best-effort
    }
    setRecoveryCandidate(null);
  }, [getDraftStore]);

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
          onProjectReady={(dataUrl, width, height, source) =>
            setPending({ kind: 'image', dataUrl, width, height, source })
          }
          recoveryCandidate={recoveryCandidate}
          onRestoreDraft={handleRestoreDraft}
          onDiscardDraft={handleDiscardDraft}
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
      <div className="h-app-vh overflow-hidden">
        {pending.kind === 'image' ? (
          <PixelEditorBody
            frameDataUrl={pending.dataUrl}
            frameWidth={pending.width}
            frameHeight={pending.height}
            onSave={() => {}}
            onDismiss={handleDismiss}
            layout="page"
            source={pending.source}
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
            onDiscardDraft={async () => {
              await handleDiscardDraft();
              handleDismiss();
            }}
          />
        )}
      </div>
    </HotkeysProvider>
  );
}
