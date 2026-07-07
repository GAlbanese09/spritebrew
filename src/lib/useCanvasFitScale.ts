'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

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
 * Wave M2.1 fixes the first-render race that shipped in Wave M2:
 *   - Uses useLayoutEffect (not useEffect) so the synchronous initial
 *     measurement lands BEFORE the browser paints the first frame. Without
 *     this, iOS Safari painted the canvas at the legacy maxWidth on the first
 *     tick, then never re-rendered because the ResizeObserver was slow to
 *     fire (or, in the SpriteDetector case, never attached at all).
 *   - Measures the container's content-box width consistently for BOTH the
 *     synchronous seed AND the ResizeObserver callback — clientWidth includes
 *     padding on content-box AND border-box elements, while
 *     ResizeObserverEntry.contentRect.width always excludes padding. The
 *     inconsistency caused a one-frame shrink flash whenever imageWidth fell
 *     in the ~padding-width band where one metric was < 1 and the other was
 *     ≥ 1. We normalize to content-box (matching contentRect.width) by
 *     subtracting computed padding from clientWidth.
 *   - Pre-measurement fallback is a SMALL effective width (320px), not the
 *     legacy maxWidth. Erring small self-corrects on the observer's first
 *     callback; erring big painted the overflowing canvas that motivated
 *     M2 in the first place.
 *
 * imageWidth <= 0 returns 1 (defensive; callers already guard upstream).
 */

// If the ref hasn't attached by the first useLayoutEffect run (unusual — the
// consumer's wrapper renders unconditionally, and this hook is only used with
// stable refs) OR if the first measurement produces an implausible 0, cap the
// effective width so the canvas underdraws rather than overflowing. 320px is
// the smallest common phone content-area (iPhone SE portrait minus AppShell
// padding).
const FALLBACK_EFFECTIVE_WIDTH_PX = 320;

/** Content-box (padding-excluded) width. Matches ResizeObserverEntry.contentRect.width. */
function measureContentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  const paddingRight = parseFloat(cs.paddingRight) || 0;
  // clientWidth = content + padding (regardless of box-sizing). Subtracting
  // padding leaves the content-only width, which is what contentRect.width
  // reports from RO. Guard against negative widths on hidden elements.
  return Math.max(0, el.clientWidth - paddingLeft - paddingRight);
}

export function useCanvasFitScale(
  imageWidth: number,
  containerRef: RefObject<HTMLElement | null>,
  opts?: { maxWidth?: number },
): number {
  const maxWidth = opts?.maxWidth ?? Infinity;
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Synchronous initial measurement before paint. Consumers rely on this
    // to paint the FIRST frame at the correct scale — without it iOS Safari
    // paints at the fallback and takes a full ResizeObserver tick to correct.
    setContainerWidth(measureContentWidth(el));
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // contentRect.width is content-only (excludes padding); matches the
        // seed above.
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  if (imageWidth <= 0) return 1;

  // Pre-measurement fallback. Small-and-safe — the observer's first callback
  // corrects it within a frame. NEVER falls back to the legacy maxWidth,
  // which was the Wave M2 bug: painted a wide canvas that never re-rendered.
  if (containerWidth === null || containerWidth === 0) {
    return Math.min(
      maxWidth / imageWidth,
      FALLBACK_EFFECTIVE_WIDTH_PX / imageWidth,
      1,
    );
  }

  return Math.min(maxWidth / imageWidth, containerWidth / imageWidth, 1);
}

/**
 * Companion primitive: measure a container's content-box width reactively via
 * a ResizeObserver + synchronous useLayoutEffect seed. Returns a number so
 * callers don't need to branch on null — the small-fallback semantic lives
 * here too, matching useCanvasFitScale.
 *
 * Used by ExportConfig where the "image" width (a runtime-assembled preview
 * sheet) isn't known when the hook is called — the caller needs the raw
 * container width to plug into its own Math.min alongside other terms
 * (maxWidth, maxHeight, an upscale factor).
 */
export function useContainerWidth(
  containerRef: RefObject<HTMLElement | null>,
): number {
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(measureContentWidth(el));
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Same small-fallback contract as useCanvasFitScale — never returns null,
  // never returns a legacy-max value that would cause an oversize first paint.
  if (width === null || width === 0) return FALLBACK_EFFECTIVE_WIDTH_PX;
  return width;
}
