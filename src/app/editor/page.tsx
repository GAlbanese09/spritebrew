'use client';

import { useState } from 'react';
import EditorLanding from '@/components/sprites/EditorLanding';
import PixelEditorBody from '@/components/sprites/PixelEditorBody';
import { useEditorStore } from '@/components/sprites/editorStore';

/**
 * /editor — full-page Pixel Editor (v2 Phase 1).
 *
 * Two states gated by a local `pending` value:
 *   1. No pending → render <EditorLanding>. User picks a starting point
 *      (blank canvas or uploaded image); the landing produces a dataUrl
 *      + dimensions and hands them up via onProjectReady.
 *   2. pending set → render <PixelEditorBody layout="page">. The body's
 *      own useEffect loads the frame into editorStore — single canonical
 *      load entry point, no duplicate dispatch.
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
  const reset = useEditorStore((s) => s.reset);

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
