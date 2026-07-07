'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Companion primitive: measure a container's clientWidth reactively via a
 * ResizeObserver. Returns null until the first measurement lands (callers can
 * then fall back to their legacy sizing for the first frame).
 *
 * Used by ExportConfig where the "image" width (a runtime-assembled preview
 * sheet) isn't known when the hook is called — the caller needs the raw
 * container width to plug into its own Math.min alongside other terms
 * (maxWidth, maxHeight, an upscale factor).
 */
export function useContainerWidth(
  containerRef: RefObject<HTMLElement | null>,
): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return width;
}

/**
 * Container-aware canvas fit-scale.
 *
 * Replaces the pre-Wave-M2 pattern of `const scale = Math.min(MAX_W / imageWidth, 1)`
 * that lived duplicated across SlicerConfig / SpriteDetector / FrameSizeResizer /
 * ExportConfig. That pattern used a fixed pixel maxWidth and ignored the actual
 * container width, so mobile-portrait viewports (where the container is ~270-300px
 * wide inside the padded card) still tried to draw a 400- or 600-pixel-wide
 * canvas, forcing horizontal scroll on the wrapper.
 *
 * The hook observes the container's clientWidth with a ResizeObserver and
 * returns Math.min(maxWidth/imageWidth, containerWidth/imageWidth, 1). Callers
 * pass their previous fixed maxWidth as `opts.maxWidth` so desktop rendering
 * is pixel-identical — the container clamp only kicks in when the container is
 * narrower than the legacy max.
 *
 * Before the first ResizeObserver callback fires the container's clientWidth
 * hasn't been read yet, so we return the legacy value
 * `Math.min(maxWidth/imageWidth, 1)` — same as before Wave M2 — to avoid a
 * one-frame zero-width flash.
 *
 * imageWidth <= 0 returns 1 (defensive; callers already guard against 0-dim
 * images upstream via dims validation).
 */
export function useCanvasFitScale(
  imageWidth: number,
  containerRef: RefObject<HTMLElement | null>,
  opts?: { maxWidth?: number },
): number {
  const maxWidth = opts?.maxWidth ?? Infinity;
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Seed from current clientWidth so the very next render has a real value.
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // contentRect.width matches clientWidth (excludes padding on
        // content-box, includes it on border-box — but our wrappers are the
        // default content-box, so contentRect is what we want).
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  if (imageWidth <= 0) return 1;

  // Pre-measurement: legacy behavior (max cap only). This is the identical
  // scale the file used before Wave M2, so a slow ResizeObserver on a large
  // desktop viewport paints correctly on the first frame.
  if (containerWidth === null) {
    return Math.min(maxWidth / imageWidth, 1);
  }

  return Math.min(maxWidth / imageWidth, containerWidth / imageWidth, 1);
}
