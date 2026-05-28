'use client';

import { useState, useEffect } from 'react';
import EditorLanding from '@/components/sprites/EditorLanding';
import PixelEditorBody from '@/components/sprites/PixelEditorBody';
import { useEditorStore } from '@/components/sprites/editorStore';
import { useSpriteStore } from '@/stores/spriteStore';

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

export default function EditorPage() {
  const [pending, setPending] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [isLoadingHandoff, setIsLoadingHandoff] = useState(false);
  const reset = useEditorStore((s) => s.reset);

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
      setPending({
        dataUrl: generatedImageDataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
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
      <EditorLanding
        onProjectReady={(dataUrl, width, height) =>
          setPending({ dataUrl, width, height })
        }
      />
    );
  }

  return (
    <PixelEditorBody
      frameDataUrl={pending.dataUrl}
      frameWidth={pending.width}
      frameHeight={pending.height}
      onSave={() => {
        // Page-mode Save is a PNG download, handled inside PixelEditorBody.
        // This callback is unused in page layout but kept for prop parity.
      }}
      onDismiss={() => {
        reset();
        setPending(null);
      }}
      layout="page"
    />
  );
}
