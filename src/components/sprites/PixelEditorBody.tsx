'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Eraser, Pipette, Undo2, Redo2, History, Save, X, ArrowLeft, Film, AlertCircle } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import Button from '@/components/ui/Button';
import {
  useEditorStore,
  selectCanUndo,
  selectCanRedo,
  VALID_BRUSH_SIZES,
  dimsWithinEditorLimits,
  editorDimsRejectionMessage,
  type Tool,
  type DirtyRect,
} from './editorStore';
import type { SpriteProjectSource } from '@/lib/spriteProject';

/** Scope key for editor hotkeys — keeps brush-size / undo / redo bindings
 *  isolated to the editor subtree so they don't fire when a text input
 *  outside the editor is focused (or when a future input INSIDE the editor
 *  is focused — react-hotkeys-hook's default `enableOnFormTags: false`
 *  also handles that, but scoping is the cleaner contract). The matching
 *  <HotkeysProvider initiallyActiveScopes={['editor']}> lives in
 *  PixelEditor.tsx (modal) and app/editor/page.tsx (page route). */
const EDITOR_HOTKEY_SCOPE = 'editor';

// Wave 2a continuous-zoom range. Buttons remain as preset shortcuts inside
// [4, 16], but pinch/wheel can land anywhere in [MIN_ZOOM, MAX_ZOOM] including
// non-integer values.
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
import { useSpriteStore } from '@/stores/spriteStore';
import { extractPaletteFromImageData } from '@/lib/imagePalette';
import { ViewportVars } from './ViewportVars';
import { useEditorRecovery } from './useEditorRecovery';
import { isDevHost } from '@/lib/isDevHost';
import { devRecoverySelfTest } from '@/lib/editorRecovery';

/** Module-scope so the dev self-test runs at most once per page load, even
 *  if the editor body remounts (e.g. Strict Mode double-invoke in dev). */
let recoverySelfTestRan = false;

/**
 * Chrome-free Pixel Editor body. Hosts all the Wave 1 logic (store wiring,
 * hotkeys, canvas rendering, beforeunload guard, palette extraction) plus
 * the v2 Phase 1 structural CSS Grid layout that fixes the swatch clip
 * by construction.
 *
 * Two modes:
 *   - layout="modal" — mounted inside <PixelEditor>'s Dialog. Header shows
 *     title + X; footer shows Cancel + Save (existing UX preserved). Save
 *     calls onSave(dataUrl) then onDismiss(); dismiss routes through the
 *     wrapper's confirm-discard logic.
 *   - layout="page" — mounted directly by /editor. Header shows title +
 *     "← Back" link + "Save (download PNG)". No footer. Save triggers a
 *     PNG download via <a download>; the editor stays open. Dismiss is the
 *     parent's responsibility (clears store + landing).
 */

interface PixelEditorBodyProps {
  frameDataUrl: string;
  frameWidth: number;
  frameHeight: number;
  onSave: (newDataUrl: string) => void;
  onDismiss: () => void;
  layout: 'modal' | 'page';
  /**
   * Origin lineage for the loaded image (Wave 1b). Threaded into the
   * SpriteProjectV1 document via loadFrame so the editor's document model
   * carries provenance. Optional — when omitted, the project's source is
   * left undefined.
   */
  source?: SpriteProjectSource;
}

export default function PixelEditorBody({
  frameDataUrl,
  frameWidth,
  frameHeight,
  onSave,
  onDismiss,
  layout,
  source,
}: PixelEditorBodyProps) {
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  // Display-resolution overlay canvas — hosts ONLY the grid (Wave 1c). DPR-
  // aware so 1px strokes stay crisp on HiDPI. Redrawn on zoom / dims / window
  // resize; never touched during paint. Sits between the image canvas and the
  // cursor footprint div in the DOM (paint-order stacking).
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  // Tracks the last pointer cell of the active stroke so handleMouseMove can
  // interpolate via Bresenham (paintLine) instead of just stamping discrete
  // points (which left gaps at high pointer speeds).
  const prevCellRef = useRef<{ x: number; y: number } | null>(null);

  // Non-pixel store subscriptions (re-render on change).
  const tool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const color = useEditorStore((s) => s.foregroundColor);
  const setColor = useEditorStore((s) => s.setForegroundColor);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const isDirty = useEditorStore((s) => s.historyIndex > 0);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);

  // Send-to-Animator handoff (v0.5.9): the editor → animator round-trip.
  // Selectors are pulled imperatively from spriteStore so they don't trigger
  // unrelated re-renders of the editor body. router is from next/navigation.
  const router = useRouter();
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setOriginalCharacter = useSpriteStore((s) => s.setOriginalCharacter);
  const setPendingAnimatorHandoff = useSpriteStore((s) => s.setPendingAnimatorHandoff);
  const setPendingAnimatorSkipBgRemoval = useSpriteStore((s) => s.setPendingAnimatorSkipBgRemoval);

  const loadFrame = useEditorStore((s) => s.loadFrame);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const endStroke = useEditorStore((s) => s.endStroke);
  const cancelStroke = useEditorStore((s) => s.cancelStroke);
  const paintPixel = useEditorStore((s) => s.paintPixel);
  const erasePixel = useEditorStore((s) => s.erasePixel);
  const paintLine = useEditorStore((s) => s.paintLine);
  const eraseLine = useEditorStore((s) => s.eraseLine);
  const eyedrop = useEditorStore((s) => s.eyedrop);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const revertToOriginal = useEditorStore((s) => s.revertToOriginal);
  const reset = useEditorStore((s) => s.reset);

  // Wave 2a refs for pointer-events arbitration + transform-based pan/zoom.
  // containerRef hosts the pointer/wheel handlers (so a finger landing on
  // padding still counts toward the gesture). stackRef is the canvas-stack
  // wrapper that carries the transform during a pinch and the committed pan.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    startDist: number;
    startMid: { x: number; y: number };
    startPan: { x: number; y: number };
    startZoom: number;
    localCss: { x: number; y: number };
    lastScale: number;
    /** The two pointerIds that initiated this gesture (insertion order on
     *  pointerdown→size===2). Identified explicitly so that a 3rd-finger
     *  arrival followed by one of the originals lifting commits cleanly
     *  rather than continuing with mismatched (B, C) geometry against an
     *  (A, B) baseline. */
    pointerIds: [number, number];
  } | null>(null);
  // True from the moment 2 pointers land until ALL pointers lift. Blocks the
  // leftover finger from accidentally drawing after the user lifts one finger
  // post-pinch (spec arbitration rule 4).
  const gestureSessionRef = useRef<boolean>(false);
  // Set by a committer (gesture-end or wheel) to the post-commit transform
  // string. The useLayoutEffect keyed on [zoom] writes it AFTER React has
  // applied the new canvas CSS size but BEFORE paint — same frame, no flicker.
  const pendingTransformRef = useRef<string | null>(null);

  // Dimension-guardrail error path (Fix #5). If the loaded image exceeds
  // EDITOR_MAX_DIMENSION / EDITOR_MAX_PIXELS, the load effect bails out before
  // touching the store and sets this — the canvas area renders a friendly
  // refusal instead of an empty canvas, and the editor stays in a valid state.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [zoom, setZoom] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);

  // Stage 2 crash-recovery capture. Active in page mode only; modal mount
  // path is Stage 3+. Reads the live palette at save time via the closure so
  // the saved envelope includes it (toProject emits an empty palette).
  useEditorRecovery({ enabled: layout === 'page', getPalette: () => palette });

  // Mobile-only Colors sheet (Wave 2b-2). Hosts the color picker + palette
  // on phones; never opens at md+ (the close-on-md effect dismisses if the
  // viewport reaches desktop width via rotation).
  const [sheetOpen, setSheetOpen] = useState(false);

  // Transient toast for keyboard-driven brush-size changes.
  const [brushToast, setBrushToast] = useState<string | null>(null);
  const brushToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cursor overlay (mirrors brush footprint at canvas-pixel coords).
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(false);
  const cursorRafRef = useRef<number | null>(null);

  // Fit-to-viewport zoom on dim changes. Wave 2a resets the committed pan +
  // writes a (0,0) translate transform directly so a fresh frame opens at
  // its natural (flex-centered) position rather than carrying over the prior
  // frame's pan/pinch state. We also clear pendingTransformRef so any stale
  // string staged by a concurrent gesture commit can't leak through the
  // next zoom change (defensive — handles a narrow race where a gesture
  // commits in the same render cycle as a frame change).
  useEffect(() => {
    const maxEditorPx = Math.min(window.innerWidth - 200, window.innerHeight - 200, 640);
    const idealZoom = Math.floor(maxEditorPx / Math.max(frameWidth, frameHeight));
    panRef.current = { x: 0, y: 0 };
    pendingTransformRef.current = null;
    if (stackRef.current) {
      stackRef.current.style.transform = 'translate3d(0px, 0px, 0)';
    }
    setZoom(Math.max(4, Math.min(16, idealZoom)));
  }, [frameWidth, frameHeight]);

  // Load frame pixels into the store + extract palette. Reset on unmount so
  // the next editor open gets a clean slate.
  //
  // Fix #5: defensive dimension guardrail. Callers (EditorLanding upload,
  // EditorPage handoff) also check, but this is the last line of defense
  // before any pixel buffer is allocated/copied.
  //
  // Fix #4: if the incoming URL is a blob URL (from UploadZone or the gallery
  // Send-to-Editor path), revoke it AFTER decode — the bytes are now in the
  // store and the browser can release the underlying File/Blob reference.
  useEffect(() => {
    setLoadError(null);

    // Pre-flight check on the props' declared dimensions.
    if (!dimsWithinEditorLimits(frameWidth, frameHeight)) {
      setLoadError(editorDimsRejectionMessage(frameWidth, frameHeight));
      return () => { reset(); };
    }

    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      // Double-check against the decoded natural dims in case the props lied.
      if (!dimsWithinEditorLimits(img.naturalWidth, img.naturalHeight)) {
        setLoadError(editorDimsRejectionMessage(img.naturalWidth, img.naturalHeight));
        return;
      }
      const tmp = document.createElement('canvas');
      tmp.width = frameWidth;
      tmp.height = frameHeight;
      const ctx = tmp.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, frameWidth, frameHeight);
      const imageData = ctx.getImageData(0, 0, frameWidth, frameHeight);

      setPalette(extractPaletteFromImageData(imageData, 16));
      loadFrame('current', new Uint8ClampedArray(imageData.data), frameWidth, frameHeight, source);

      if (frameDataUrl.startsWith('blob:')) {
        // We own the consumption side of this blob URL. UploadZone created
        // it; once the bytes are copied into the store, the underlying File
        // can be released.
        URL.revokeObjectURL(frameDataUrl);
      }
    };
    img.src = frameDataUrl;

    return () => {
      cancelled = true;
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameDataUrl, frameWidth, frameHeight]);

  // Full image repaint — runs on mount, zoom change, frame load, undo/redo.
  // Wave 1c: visible canvas backing store is NATIVE WxH; the browser handles
  // the upscale via CSS + image-rendering: pixelated, so the work is now
  // zoom-independent (O(W*H) bytes, not O(W*H*zoom^2)). The transparency
  // checkerboard lives in CSS on the canvas element; the grid lives in the
  // overlay canvas — neither is touched here.
  const renderCanvasesFull = useCallback(() => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels || width === 0 || height === 0) return;

    const ec = editorCanvasRef.current;
    if (ec) {
      // Assigning width/height clears the canvas, so only re-size when the
      // native dims actually change (avoids the zoom-change wipe).
      if (ec.width !== width || ec.height !== height) {
        ec.width = width;
        ec.height = height;
      }
      // CSS size carries the visible scale. Backing store stays native.
      ec.style.width = `${width * zoom}px`;
      ec.style.height = `${height * zoom}px`;
      const ctx = ec.getContext('2d')!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    }

    const pc = previewCanvasRef.current;
    if (pc && ec) {
      pc.width = width;
      pc.height = height;
      const ctx = pc.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      // Source from the visible canvas (now native res) — the off-screen
      // stage canvas is gone in Wave 1c.
      ctx.drawImage(ec, 0, 0);
    }
  }, [zoom]);

  // Per-event patch — writes only the dirty sub-region at native resolution.
  // Wave 1c: ONE putImageData straight to the visible canvas (which is native
  // res now), no stage, no scaled drawImage. This is the real-time erase fix:
  // putImageData REPLACES bytes (no source-over composite), so alpha=0 pixels
  // become transparent immediately — the CSS-bg checkerboard shows through
  // during the drag, not just after stroke-end.
  const patchDirtyRect = useCallback((rect: DirtyRect) => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels || width === 0 || height === 0) return;
    const ec = editorCanvasRef.current;
    if (!ec) return;
    if (ec.width !== width || ec.height !== height) {
      // Visible canvas not yet sized for these dims (race with a fresh load);
      // bootstrap with a full render then bail — the patch is included in the
      // bytes the full render just wrote.
      renderCanvasesFull();
      return;
    }

    // Build a small ImageData containing only the dirty sub-region (row-by-row
    // copy because the source rows aren't contiguous in the full-frame buffer).
    const subData = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let row = 0; row < rect.h; row++) {
      const srcOffset = ((rect.y + row) * width + rect.x) * 4;
      const dstOffset = row * rect.w * 4;
      subData.set(pixels.subarray(srcOffset, srcOffset + rect.w * 4), dstOffset);
    }
    const subImageData = new ImageData(subData, rect.w, rect.h);

    // Single native-res write.
    const ctx = ec.getContext('2d')!;
    ctx.putImageData(subImageData, rect.x, rect.y);

    // Preview canvas — source from the visible canvas (also native res).
    const pc = previewCanvasRef.current;
    if (pc) {
      const pctx = pc.getContext('2d')!;
      pctx.imageSmoothingEnabled = false;
      pctx.clearRect(0, 0, width, height);
      pctx.drawImage(ec, 0, 0);
    }
  }, [renderCanvasesFull]);

  // Grid overlay — stroked on a separate DPR-aware canvas (Wave 1c). Crisp
  // 1 device px on HiDPI, never touched during paint. Called on mount, zoom
  // change, dims/frame-load change, and window resize (DPR may have changed
  // if the window moved to another monitor).
  const drawGridOverlay = useCallback(() => {
    const { width, height } = useEditorStore.getState();
    const oc = overlayCanvasRef.current;
    if (!oc || width === 0 || height === 0) return;

    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const cssW = width * zoom;
    const cssH = height * zoom;

    // Backing store at device res for crisp 1px lines. Assigning width/height
    // resets the transform too, so reapply scale immediately after.
    const bsW = Math.round(cssW * dpr);
    const bsH = Math.round(cssH * dpr);
    if (oc.width !== bsW || oc.height !== bsH) {
      oc.width = bsW;
      oc.height = bsH;
    }
    oc.style.width = `${cssW}px`;
    oc.style.height = `${cssH}px`;

    const ctx = oc.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    // Wave 2a: sub-4x grids render as gray mush — skip the loop and leave
    // the overlay cleared. The image itself is the visual reference at low
    // zoom; the grid only earns its keep at pixel-art-editing zooms.
    if (zoom < 4) return;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    // CSS-logical space (the DPR transform handles HiDPI).
    for (let x = 0; x <= width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * zoom + 0.5, 0);
      ctx.lineTo(x * zoom + 0.5, cssH);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * zoom + 0.5);
      ctx.lineTo(cssW, y * zoom + 0.5);
      ctx.stroke();
    }
  }, [zoom]);

  // Pixel subscription — fires outside React reconciliation, no re-render.
  // Subscribes to `pixels` (always changes reference on any pixel mutation),
  // then reads `lastDirtyRect` via getState to decide between full vs patch.
  // We subscribe to pixels (not lastDirtyRect) so wholesale replacements
  // — undo/redo, which set lastDirtyRect: null — still trigger the listener
  // even when prior lastDirtyRect was also null (Object.is would miss that).
  useEffect(() => {
    renderCanvasesFull();
    drawGridOverlay();
    const unsub = useEditorStore.subscribe(
      (s) => s.pixels,
      () => {
        const rect = useEditorStore.getState().lastDirtyRect;
        if (rect === null) {
          renderCanvasesFull();
          // Wholesale change may be a frame load with new dims — refresh grid.
          drawGridOverlay();
        } else {
          patchDirtyRect(rect);
        }
      }
    );
    return unsub;
  }, [renderCanvasesFull, patchDirtyRect, drawGridOverlay]);

  // Re-render on zoom change (image canvas's CSS size + overlay's full
  // geometry). Wave 2a: this MUST be a layout effect so the canvas CSS size
  // updates BEFORE paint and BEFORE the pendingTransformRef flush effect
  // (declared after this one) writes the post-commit transform. Together,
  // both updates land in the same pre-paint phase, eliminating the
  // intermediate "old size + new no-scale transform" frame.
  useLayoutEffect(() => {
    renderCanvasesFull();
    drawGridOverlay();
  }, [zoom, renderCanvasesFull, drawGridOverlay]);

  // Window resize — DPR may have changed (e.g., window dragged to another
  // monitor). Overlay-only; the image canvas is DPR-agnostic.
  useEffect(() => {
    const handler = () => drawGridOverlay();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [drawGridOverlay]);

  // Close the mobile Colors sheet if the viewport grows to md+ (e.g. rotate
  // to landscape), where the desktop sidepanel takes over and an open sheet
  // would be a stranded overlay.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = () => { if (mq.matches) setSheetOpen(false); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Escape closes the mobile Colors sheet (parity with the old Dialog).
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  // Wave 2a commit contract: when a gesture/wheel committer wants to atomic-
  // ally swap the wrapper transform from `translate(p) scale(s)` to
  // `translate(p')`, it stages the new transform string in pendingTransformRef
  // and calls setZoom(newZoom). React commits the new zoom -> the zoom-change
  // effects run renderCanvasesFull (resizing the canvas CSS to native*newZoom)
  // -> THIS layout effect writes the staged transform. All in one frame
  // before paint, so the user never sees an intermediate-state flicker.
  useLayoutEffect(() => {
    if (pendingTransformRef.current !== null && stackRef.current) {
      stackRef.current.style.transform = pendingTransformRef.current;
      pendingTransformRef.current = null;
    }
  }, [zoom]);

  // Bound the committed pan to the viewport.
  //   Canvas LARGER than viewport on an axis: bound so the canvas still covers
  //     the viewport (edge can't pass center) — can't shove it off-screen.
  //   Canvas SMALLER (fits): let it slide within the viewport (stay fully
  //     visible) so you can pan to a feature near an edge, instead of locking
  //     it dead-center. |W*zoom - vp| handles both with one expression.
  //   Behavior note: zoom-OUT no longer auto-recenters via gesture (it stays
  //     where you left it, bounded); the zoom BUTTONS still recenter (pan {0,0}).
  // Valid ONLY where the committed scale is 1 (post-commit zoom + wheel-pan);
  //   NOT during a live pinch (scale != 1, transform-origin 0,0 → pan=0 isn't
  //   "centered"). Never called from the live gesture-move branch.
  const clampPan = useCallback(
    (pan: { x: number; y: number }, zoomLevel: number) => {
      const vp = containerRef.current?.getBoundingClientRect();
      const { width, height } = useEditorStore.getState();
      if (!vp || width === 0 || height === 0) return pan;
      const maxX = Math.abs(width * zoomLevel - vp.width) / 2;
      const maxY = Math.abs(height * zoomLevel - vp.height) / 2;
      return { x: clamp(pan.x, -maxX, maxX), y: clamp(pan.y, -maxY, maxY) };
    },
    []
  );

  // Single commit point for the wrapper transform + zoom state. Every
  // committer (gesture-end, wheel zoom, zoom buttons) routes through here so
  // the commit contract is honored in one place:
  //   - If zoom changes, stage the new transform string and call setZoom;
  //     the [zoom]-keyed useLayoutEffect above flushes it AFTER the canvas
  //     CSS size update in the same pre-paint phase (no flicker).
  //   - If zoom is unchanged (idempotent setZoom skips re-render so the
  //     layout effect can't fire), write the transform directly and clear
  //     pendingTransformRef so no stale string carries into the next commit.
  // panRef is always updated to the (clamped) new pan so subsequent gestures
  // pick up the current committed position.
  const commitZoomPan = useCallback(
    (nextZoom: number, nextPan: { x: number; y: number }) => {
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const clampedPan = clampPan(nextPan, clampedZoom);
      panRef.current = clampedPan;
      const transform = `translate3d(${clampedPan.x}px, ${clampedPan.y}px, 0)`;
      if (clampedZoom === zoom) {
        if (stackRef.current) stackRef.current.style.transform = transform;
        pendingTransformRef.current = null;
      } else {
        pendingTransformRef.current = transform;
        setZoom(clampedZoom);
      }
    },
    [zoom, clampPan]
  );

  // Wave 2a desktop wheel:
  //   - ctrl/cmd+wheel = ZOOM, anchored at the cursor (trackpad pinch on
  //     macOS surfaces as ctrlKey wheel).
  //   - plain wheel / two-finger swipe = PAN (replaces the prior scroll-pan
  //     since the viewport is now overflow-hidden). Bounded by clampPan.
  // Attached via addEventListener with { passive: false } because React's
  // synthetic onWheel is passive and preventDefault would no-op.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const s = Math.exp(-e.deltaY * 0.0015);
        const newZoom = clamp(zoom * s, MIN_ZOOM, MAX_ZOOM);
        if (newZoom === zoom) return;
        const stackRect = stackRef.current?.getBoundingClientRect();
        if (!stackRect) return;
        const localCss = { x: e.clientX - stackRect.left, y: e.clientY - stackRect.top };
        const sEff = newZoom / zoom;
        const newPan = {
          x: panRef.current.x + (1 - sEff) * localCss.x,
          y: panRef.current.y + (1 - sEff) * localCss.y,
        };
        commitZoomPan(newZoom, newPan);
      } else {
        // Plain wheel / two-finger swipe = pan (clamped). No zoom change, so
        // write the transform directly; no setZoom / pendingTransform needed.
        const newPan = clampPan(
          { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY },
          zoom
        );
        panRef.current = newPan;
        if (stackRef.current) {
          stackRef.current.style.transform = `translate3d(${newPan.x}px, ${newPan.y}px, 0)`;
        }
      }
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [zoom, commitZoomPan, clampPan]);

  // Wave 2a getPixelCoords — accepts a {clientX, clientY} payload (so it
  // works with pointer / wheel / synthetic events) and derives the visual
  // scale FROM THE RECT, not from the React zoom state. This single change
  // makes every tool correct under any pan/zoom/pinch state (spec AD-2).
  // canvas.width is native pixels; rect.width is current CSS pixels under
  // whatever transform chain sits above the canvas.
  const getPixelCoords = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const canvas = editorCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / Math.max(1, canvas.width);
      if (scale <= 0) return null;
      const x = Math.floor((e.clientX - rect.left) / scale);
      const y = Math.floor((e.clientY - rect.top) / scale);
      return { x, y };
    },
    []
  );

  const applyAt = useCallback(
    (x: number, y: number) => {
      if (tool === 'pencil') {
        paintPixel(x, y, color);
      } else if (tool === 'eraser') {
        erasePixel(x, y);
      } else if (tool === 'eyedropper') {
        const hex = eyedrop(x, y);
        if (hex) {
          setColor(hex);
          setTool('pencil');
        }
      }
    },
    [tool, color, paintPixel, erasePixel, eyedrop, setColor, setTool]
  );

  // Interpolated line stamp for mid-stroke pointermove. Single store action
  // (one subscription fire) regardless of segment length. Eyedropper not
  // applicable (filtered out by the caller).
  const applyLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      if (tool === 'pencil') {
        paintLine(x0, y0, x1, y1, color);
      } else if (tool === 'eraser') {
        eraseLine(x0, y0, x1, y1);
      }
    },
    [tool, color, paintLine, eraseLine]
  );

  // Mouse-cursor brush footprint overlay. RAF-coalesced so rapid mouse moves
  // produce at most one setState per frame. Hides when the mouse is outside
  // canvas bounds. Touch/pen pointers do NOT call this — fingers occlude the
  // footprint and there's nothing to show.
  //
  // canvas.getBoundingClientRect() includes ALL parent transforms (the
  // wrapper's pan/zoom via stackRef), so scale = rect.width / canvas.width
  // is the EFFECTIVE on-screen scale. cellX/cellY are correct canvas-pixel
  // indices, and the cursor offset (cellX - half) * scale lands at the right
  // CSS-pixel position within the (pre-transform) wrapper, where the cursor
  // div is a child — the wrapper's transform then carries it to the final
  // screen position. Same technique as getPixelCoords (Wave 2a spec AD-2).
  const updateCursorForMouse = useCallback((clientX: number, clientY: number) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / Math.max(1, canvas.width);
    if (scale <= 0) return;
    const cellX = Math.floor((clientX - rect.left) / scale);
    const cellY = Math.floor((clientY - rect.top) / scale);
    if (cellX < 0 || cellX >= canvas.width || cellY < 0 || cellY >= canvas.height) {
      setCursorVisible(false);
      return;
    }
    setCursorVisible(true);
    const half = Math.floor(brushSize / 2);
    const ox = (cellX - half) * scale;
    const oy = (cellY - half) * scale;
    if (cursorRafRef.current !== null) cancelAnimationFrame(cursorRafRef.current);
    cursorRafRef.current = requestAnimationFrame(() => {
      setCursorX(ox);
      setCursorY(oy);
    });
  }, [brushSize]);

  // Wave 2a pointer handlers — replace the prior mouse handlers entirely.
  // Bound on the CONTAINER (the flex div) so fingers on the padding still
  // count toward a pinch; setPointerCapture routes all subsequent moves to
  // us regardless of where the pointer ends up.

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Skip presses that land on an interactive control inside the container
      // (zoom buttons, etc.). Calling setPointerCapture on the container
      // would retarget the matching pointerup off the button and suppress
      // its synthetic click. The canvas and padding are not interactive
      // elements, so drawing + gesture-start on the canvas/padding still
      // route through this handler.
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest('button, input, a, select, textarea, [role="button"]')) {
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers throw if pointerId isn't currently captureable; ignore.
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const size = pointersRef.current.size;

      if (size === 1 && !gestureSessionRef.current) {
        // Drawing branch — but only if the press landed on the canvas.
        const coords = getPixelCoords(e);
        if (!coords) return;
        const canvas = editorCanvasRef.current;
        if (!canvas) return;
        if (coords.x < 0 || coords.x >= canvas.width || coords.y < 0 || coords.y >= canvas.height) {
          // Inside container but outside canvas (padding/zoom-controls row).
          // Don't start a stroke; the pointer is still captured so a pinch
          // started here would still work.
          return;
        }
        if (tool !== 'eyedropper') beginStroke();
        setIsDrawing(true);
        prevCellRef.current = null;
        applyAt(coords.x, coords.y);
        if (tool !== 'eyedropper') {
          prevCellRef.current = coords;
        }
      } else if (size === 2) {
        // Second pointer landed — kill any drawing in progress, start gesture.
        // cancelStroke restores the pre-stroke snapshot from history so the
        // partial stroke is invisible (spec AD-4).
        if (isDrawing) {
          cancelStroke();
          setIsDrawing(false);
          prevCellRef.current = null;
        }
        gestureSessionRef.current = true;
        const ids = Array.from(pointersRef.current.keys());
        const p0Id = ids[0];
        const p1Id = ids[1];
        const p0 = pointersRef.current.get(p0Id)!;
        const p1 = pointersRef.current.get(p1Id)!;
        const startMid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const startDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const stackRect = stackRef.current?.getBoundingClientRect();
        const localCss = stackRect
          ? { x: startMid.x - stackRect.left, y: startMid.y - stackRect.top }
          : { x: 0, y: 0 };
        gestureRef.current = {
          startDist: Math.max(1, startDist), // avoid div-by-zero on coincident touches
          startMid,
          startPan: { x: panRef.current.x, y: panRef.current.y },
          startZoom: zoom,
          localCss,
          lastScale: 1,
          pointerIds: [p0Id, p1Id],
        };
      }
      // size > 2: ignore extra pointers (still captured/tracked, but no behavior).
    },
    [tool, beginStroke, isDrawing, applyAt, cancelStroke, getPixelCoords, zoom]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Cursor footprint tracking — runs BEFORE the capture guard so plain
      // mouse hover (uncaptured pointermove on the container) still updates
      // the brush outline. Skipped during an active pinch (the wrapper is
      // mid-transform; an in-flight overlay position would be misleading).
      if (e.pointerType === 'mouse' && !gestureRef.current) {
        updateCursorForMouse(e.clientX, e.clientY);
      }
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const size = pointersRef.current.size;
      const g = gestureRef.current;

      if (g && size >= 2) {
        // Active pinch/pan — compute geometry from the SAME two pointer ids
        // that initiated the gesture, not the two oldest currently tracked.
        // If a 3rd finger joined and then one of the originals lifted, the
        // Map iteration order would otherwise hand us the wrong pair against
        // the baseline (startDist / startMid). If either original is gone,
        // bail; pointerup will commit the gesture cleanly.
        const p0 = pointersRef.current.get(g.pointerIds[0]);
        const p1 = pointersRef.current.get(g.pointerIds[1]);
        if (!p0 || !p1) return;
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const rawS = dist / g.startDist;
        const minS = MIN_ZOOM / g.startZoom;
        const maxS = MAX_ZOOM / g.startZoom;
        const s = clamp(rawS, minS, maxS);
        const newPan = {
          x: g.startPan.x + (mid.x - g.startMid.x) + (1 - s) * g.localCss.x,
          y: g.startPan.y + (mid.y - g.startMid.y) + (1 - s) * g.localCss.y,
        };
        if (stackRef.current) {
          stackRef.current.style.transform = `translate3d(${newPan.x}px, ${newPan.y}px, 0) scale(${s})`;
        }
        g.lastScale = s;
        panRef.current = newPan;
        return;
      }

      if (isDrawing && size === 1 && tool !== 'eyedropper') {
        // Mid-stroke move — Bresenham interpolation. Cursor footprint was
        // already updated at the top of this function.
        const coords = getPixelCoords(e);
        if (!coords) return;
        const prev = prevCellRef.current;
        if (prev && (prev.x !== coords.x || prev.y !== coords.y)) {
          applyLine(prev.x, prev.y, coords.x, coords.y);
        } else if (!prev) {
          applyAt(coords.x, coords.y);
        }
        prevCellRef.current = coords;
      }
    },
    [isDrawing, tool, getPixelCoords, applyAt, applyLine, updateCursorForMouse]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Double-fire guard: W3C says when releasePointerCapture is called
      // inside pointerup, the browser ALSO fires lostpointercapture — and
      // we've wired both to this same handler. The second call would
      // double-execute endStroke (pushing a duplicate history entry).
      // Bail if the pointer is already gone from our tracker.
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);
      const container = containerRef.current;
      try {
        container?.releasePointerCapture(e.pointerId);
      } catch {
        // Capture may already be implicitly released; ignore.
      }
      const size = pointersRef.current.size;
      const g = gestureRef.current;

      // Commit the gesture either when size drops below 2 OR when one of the
      // gesture's original pointer ids is gone (3rd finger arrived, then an
      // original lifted while size remains >= 2). The latter prevents
      // continuing with wrong-pair geometry against the original baseline.
      const gestureOriginalLost =
        g && (!pointersRef.current.has(g.pointerIds[0]) || !pointersRef.current.has(g.pointerIds[1]));

      if (g && (size < 2 || gestureOriginalLost)) {
        const newZoom = g.startZoom * g.lastScale;
        // Flex-shift correction. The canvas stack is flex-centered, so its
        // layout origin moves by dims*(newZoom - startZoom)/2 when the
        // committed zoom changes. panRef holds the live pan in the START
        // zoom's centered frame; re-express it in the NEW zoom's centered
        // frame so the commit lands exactly where the live pinch left it
        // (otherwise it snaps toward center on release — the "pinch
        // recenter" bug). Pure pan (newZoom === startZoom) => correction is
        // 0. commitZoomPan then clamps the result.
        const { width, height } = useEditorStore.getState();
        const correctedPan = {
          x: panRef.current.x + (width * (newZoom - g.startZoom)) / 2,
          y: panRef.current.y + (height * (newZoom - g.startZoom)) / 2,
        };
        commitZoomPan(newZoom, correctedPan);
        gestureRef.current = null;
        // gestureSessionRef stays true until size === 0 (spec rule 4).
      } else if (isDrawing && size === 0) {
        if (tool !== 'eyedropper') {
          endStroke();
          // Wave 1c correctness backstop — putImageData full buffer to the
          // visible canvas, in case per-event patches drifted from the store's
          // final state.
          const ec = editorCanvasRef.current;
          const { pixels, width, height } = useEditorStore.getState();
          if (
            ec && pixels && width > 0 && height > 0 &&
            ec.width === width && ec.height === height
          ) {
            const ctx = ec.getContext('2d')!;
            ctx.putImageData(
              new ImageData(new Uint8ClampedArray(pixels), width, height),
              0, 0,
            );
          }
        }
        setIsDrawing(false);
        prevCellRef.current = null;
      }

      if (size === 0) {
        gestureSessionRef.current = false;
      }

      // Mouse: recompute visibility (we may have ended outside canvas bounds).
      if (e.pointerType === 'mouse') {
        updateCursorForMouse(e.clientX, e.clientY);
      }
    },
    [isDrawing, tool, endStroke, updateCursorForMouse, commitZoomPan]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Match handlePointerUp's guard against double-fire — if we already
      // processed this id, bail.
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      // OS stole the gesture — don't commit a half-stroke.
      if (isDrawing) {
        cancelStroke();
        setIsDrawing(false);
        prevCellRef.current = null;
      }
      // Only abandon the gesture if the cancellation actually terminates it
      // — i.e., we've dropped below 2 pointers OR one of the gesture's
      // original pointer ids is now gone. Cancelling a 3rd-finger palm-touch
      // while a 2-finger pinch is ongoing must NOT kill the active pinch.
      const g = gestureRef.current;
      const size = pointersRef.current.size;
      const gestureOriginalLost =
        g && (!pointersRef.current.has(g.pointerIds[0]) || !pointersRef.current.has(g.pointerIds[1]));
      if (g && (size < 2 || gestureOriginalLost)) {
        // Abandon the in-progress gesture without committing zoom changes.
        // The wrapper transform stays at its last imperatively-written value
        // until the next gesture or zoom commit — acceptable for 2a.
        gestureRef.current = null;
      }
      if (size === 0) {
        gestureSessionRef.current = false;
      }
    },
    [isDrawing, cancelStroke]
  );

  // Serialize current store pixels to a PNG dataURL.
  const renderToDataUrl = useCallback((): string | null => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    return canvas.toDataURL('image/png');
  }, []);

  // Modal-mode Save: callback + dismiss (parent handles flow).
  const doSaveAndDismiss = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (dataUrl) onSave(dataUrl);
    onDismiss();
  }, [renderToDataUrl, onSave, onDismiss]);

  // Send-to-Animator (page-mode only). Snapshot the canvas synchronously
  // BEFORE any state change or navigation. The dataUrl is a JS string copy
  // — once it's staged in spriteStore (which is decoupled from editorStore),
  // the natural unmount-driven editorStore.reset() can fire without harming
  // it. Do NOT call onDismiss here — onDismiss triggers reset() before the
  // snapshot completes and zeros out the canvas.
  const handleSendToAnimator = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (!dataUrl) return;

    setGeneratedImage(dataUrl, dataUrl);
    setOriginalCharacter(null);                    // clear stale Animate-source if any
    setPendingAnimatorSkipBgRemoval(true);         // user just edited; respect what they made
    setPendingAnimatorHandoff(true);

    router.push('/generate');
  }, [renderToDataUrl, setGeneratedImage, setOriginalCharacter, setPendingAnimatorSkipBgRemoval, setPendingAnimatorHandoff, router]);

  // Page-mode Save: PNG download via <a download>. Editor stays open.
  const doSaveAsDownload = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `spritebrew-edit-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [renderToDataUrl]);

  // beforeunload guard — fires in BOTH layouts. Wave 1 invariant: register
  // only while dirty so a clean editor session doesn't pollute navigation.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Hotkeys — same Wave 1 + Day-9 useKey/splitKey fixes.
  const cycleBrushSize = useCallback(
    (delta: number) => {
      const cur = useEditorStore.getState().brushSize;
      const idx = VALID_BRUSH_SIZES.indexOf(cur);
      const nextIdx = Math.max(0, Math.min(VALID_BRUSH_SIZES.length - 1, idx + delta));
      const next = VALID_BRUSH_SIZES[nextIdx];
      if (next !== cur) {
        setBrushSize(next);
        if (brushToastTimerRef.current) clearTimeout(brushToastTimerRef.current);
        setBrushToast(`Brush: ${next}px`);
        brushToastTimerRef.current = setTimeout(() => setBrushToast(null), 1200);
      }
    },
    [setBrushSize]
  );

  // Fix #3: scope every editor hotkey to the 'editor' scope so they don't
  // fire while a text input (e.g., the future project-name prompt or a
  // gallery search) is focused. The matching <HotkeysProvider initiallyActive
  // Scopes={['editor']}> wraps both editor mount sites (modal + page).
  useHotkeys('[', () => cycleBrushSize(-1), { useKey: true, scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys(']', () => cycleBrushSize(+1), { useKey: true, scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys('-', () => cycleBrushSize(-1), { useKey: true, scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys(['=', '+'], () => cycleBrushSize(+1), { useKey: true, splitKey: '_', scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys('mod+z', (e) => { e.preventDefault(); undo(); }, { scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys('mod+shift+z', (e) => { e.preventDefault(); redo(); }, { scopes: [EDITOR_HOTKEY_SCOPE] });

  // Fix #4: cancel pending RAF + brush-toast timer on unmount. They're
  // otherwise no-ops if the component is gone (React 19 swallows setState),
  // but explicit cleanup prevents any post-unmount callbacks from firing.
  useEffect(() => {
    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
      if (brushToastTimerRef.current !== null) {
        clearTimeout(brushToastTimerRef.current);
        brushToastTimerRef.current = null;
      }
    };
  }, []);

  // Dev-only round-trip self-test for the recovery store. Hostname-gated
  // (NODE_ENV is 'production' on dev.spritebrew.pages.dev too — Cloudflare
  // Pages builds every deployment with `next build`). Module-scope flag
  // ensures we run once per page load even across Strict Mode remounts.
  useEffect(() => {
    if (!isDevHost() || recoverySelfTestRan) return;
    recoverySelfTestRan = true;
    void devRecoverySelfTest()
      .then((pass) => console.log(`[editorRecovery] self-test: ${pass ? 'PASS' : 'FAIL'}`))
      .catch((err) => console.warn('[editorRecovery] self-test threw', err));
  }, []);


  const toolButtons: Array<{ id: Tool; icon: typeof Pencil; label: string }> = [
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  ];

  return (
    <>
    <ViewportVars />
    <div
      className="h-full grid bg-bg-primary grid-rows-[auto_minmax(0,1fr)_auto] grid-cols-1 [grid-template-areas:'header''canvas''bottombar'] md:grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[56px_1fr_280px] md:[grid-template-areas:'header_header_header''toolbar_canvas_sidepanel']"
    >
      {/* Header */}
      <header className="[grid-area:header] flex items-center justify-between gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-3 border-b border-border-default bg-bg-primary">
        <h2 className="flex-1 min-w-0 truncate text-sm font-mono font-semibold text-text-primary">
          <span className="hidden md:inline">Pixel Editor</span>
          <span className="sr-only md:not-sr-only md:ml-2 text-text-muted font-normal">
            {frameWidth} × {frameHeight}
          </span>
        </h2>

        {layout === 'modal' ? (
          <button
            onClick={onDismiss}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer shrink-0"
            aria-label="Close editor"
          >
            <X size={16} />
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/editor" onClick={onDismiss}>
              <Button variant="ghost" size="sm">
                <ArrowLeft size={14} />
                <span className="sr-only md:not-sr-only">Back</span>
              </Button>
            </Link>
            {layout === 'page' && (
              <Button variant="secondary" size="sm" onClick={handleSendToAnimator}>
                <Film size={14} />
                Send to Animator
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={doSaveAsDownload}>
              <Save size={14} />
              <span className="md:hidden">PNG</span>
              <span className="hidden md:inline">Save (download PNG)</span>
            </Button>
          </div>
        )}
      </header>

      {/* Toolbar — vertical rail on md+ (its original placement); horizontal
          bottom bar on mobile (overflow-x scrolls if needed). Buttons grow to
          a 44×44 touch target on mobile and revert to compact sizing on md. */}
      <aside className="[grid-area:bottombar] flex flex-row items-center gap-2 overflow-x-auto border-t border-border-default bg-bg-secondary p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:[grid-area:toolbar] md:flex-col md:items-stretch md:overflow-x-visible md:overflow-y-auto md:[scrollbar-gutter:stable] md:border-t-0 md:border-r md:pb-2">
        {toolButtons.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTool(id)}
            title={label}
            className={`p-2 rounded cursor-pointer transition-colors min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0
              ${tool === id
                ? 'bg-accent-amber text-bg-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
          >
            <Icon size={16} />
          </button>
        ))}

        {/* Mobile-only Colors trigger — opens the slide-up sheet (color +
            palette). Shows the current color. The desktop equivalent lives
            in the sidepanel (hidden below md). */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Colors"
          title="Colors"
          className="w-11 h-11 shrink-0 rounded border border-border-default cursor-pointer md:hidden p-1"
        >
          <span className="block w-full h-full rounded-sm" style={{ backgroundColor: color }} />
        </button>

        <div className="w-full h-px bg-border-subtle my-1 hidden md:block" />

        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider text-center hidden md:block">
          Brush
        </div>
        <div className="flex gap-1 md:grid md:grid-cols-3">
          {VALID_BRUSH_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setBrushSize(size)}
              aria-label={`Brush size ${size}px`}
              title={`Brush size ${size}px ( [ / ] )`}
              className={`h-11 w-11 shrink-0 md:h-7 md:w-auto rounded text-[10px] font-mono cursor-pointer transition-colors
                ${brushSize === size
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {size}
            </button>
          ))}
        </div>

        <div className="w-full h-px bg-border-subtle my-1 hidden md:block" />

        <button
          onClick={undo}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
        >
          <Redo2 size={16} />
        </button>

        <div className="w-full h-px bg-border-subtle my-1 hidden md:block" />

        <button
          onClick={revertToOriginal}
          title="Revert to original (undoable)"
          disabled={!isDirty}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
          aria-label="Revert to original"
        >
          <History size={16} />
        </button>
      </aside>

      {/* Canvas (center) — a fixed clipping viewport. Pan is fully transform-
          based now (the wheel handler pans on plain wheel), so we drop the
          overflow-auto scroll plane. Controls float above as overlays.
          min-h-0/min-w-0 lets the grid track shrink to its assigned size —
          without these, the absolutely-positioned canvas region would create
          intrinsic min-size pressure and push the track past 1fr. */}
      <main className="[grid-area:canvas] overflow-hidden bg-bg-primary relative min-h-0 min-w-0">
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center p-8 z-20">
            <div className="max-w-md rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-semibold text-red-400 mb-1">
                  Can&apos;t open this image
                </p>
                <p className="text-[11px] font-mono text-text-secondary leading-relaxed">
                  {loadError}
                </p>
                <button
                  onClick={onDismiss}
                  className="mt-3 text-[10px] font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer underline"
                >
                  Go back
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Zoom controls — floating overlay above the canvas. Outside the
            pointer-capturing container so button presses never reach the
            gesture handlers (the closest() guard in handlePointerDown stays
            as defense but isn't load-bearing anymore). Presets + continuous
            readout. Pinch/wheel land on non-preset values (e.g. 7.3x), so
            no button may be highlighted after a gesture; intentional. */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-2 py-1 rounded bg-bg-primary/80 backdrop-blur-sm border border-border-subtle">
          <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
            Zoom
          </label>
          {([4, 8, 12, 16] as const).map((z) => (
            <button
              key={z}
              onClick={() => commitZoomPan(z, { x: 0, y: 0 })}
              className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors
                ${zoom === z
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {z}x
            </button>
          ))}
          <span className="text-[10px] font-mono text-text-muted tabular-nums" aria-live="polite">
            {zoom.toFixed(1)}x
          </span>
        </div>

        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerUp}
          className="absolute inset-0 flex items-center justify-center"
          style={{
            // Wave 2a touch CSS: kill browser's default touch behaviors so
            // one-finger drags hit our pointer handlers instead of scrolling
            // the page, two-finger gestures don't trigger pinch-zoom of the
            // whole page, and iOS's long-press magnifier / text-selection
            // popup don't fight with drawing.
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          {/* Canvas stack — image (bottom) → grid overlay (middle) → cursor
              footprint (top). DOM order = paint order. The image canvas has
              the transparency checkerboard as its CSS background, so any
              alpha-0 region (eraser strokes, transparent project canvases)
              reveals it through the canvas — no in-canvas tile fill needed.
              The wrapper carries the pan/pinch transform (transform-origin
              0 0 — see commit contract in the layout effect). */}
          <div ref={stackRef} className="relative" style={{ transformOrigin: '0 0' }}>
            <canvas
              ref={editorCanvasRef}
              className="block"
              style={{
                imageRendering: 'pixelated',
                // Eyedropper tool gets its own cursor (lucide pipette SVG,
                // hotspot at the tip 2,22). Pencil/eraser keep cursor:none
                // so the brush-footprint overlay below is the only indicator.
                cursor: tool === 'eyedropper' ? "url('/cursors/eyedropper.svg') 2 22, crosshair" : 'none',
                // Wave 1c CSS checkerboard. Fixed 16px screen tile (8px
                // squares) — intentional look change from the prior zoom-
                // scaled in-canvas fill.
                backgroundColor: '#1e1b18',
                backgroundImage:
                  'linear-gradient(45deg, #2a2725 25%, transparent 25%, transparent 75%, #2a2725 75%, #2a2725), ' +
                  'linear-gradient(45deg, #2a2725 25%, transparent 25%, transparent 75%, #2a2725 75%, #2a2725)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 8px 8px',
              }}
            />
            <canvas
              ref={overlayCanvasRef}
              aria-hidden="true"
              className="absolute top-0 left-0 pointer-events-none block"
            />
            <div
              aria-hidden="true"
              className="absolute pointer-events-none border border-white"
              style={{
                mixBlendMode: 'difference',
                top: 0,
                left: 0,
                width: brushSize * zoom,
                height: brushSize * zoom,
                transform: `translate(${cursorX}px, ${cursorY}px)`,
                display: cursorVisible && tool !== 'eyedropper' ? 'block' : 'none',
              }}
            />
          </div>

          {/* Brush-size toast */}
          {brushToast && (
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded bg-black/80 text-amber-300 text-xs font-mono pointer-events-none"
              role="status"
              aria-live="polite"
            >
              {brushToast}
            </div>
          )}
        </div>
      </main>

      {/* Sidepanel (right): color + palette + future preview. Hidden on
          mobile (palette returns as the Wave 2b-2 slide-up sheet; color is
          surfaced inline in the mobile bottom bar). */}
      <aside className="[grid-area:sidepanel] hidden md:flex flex-col gap-4 border-l border-border-default bg-bg-secondary overflow-y-auto [scrollbar-gutter:stable] p-3">
        {/* Current color — single styled input acts as both swatch and picker. */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Color
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded border border-border-default cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm"
              aria-label="Foreground color"
              title="Click to pick a foreground color"
            />
            <span className="text-xs font-mono text-text-muted">Click to pick</span>
          </div>
        </div>

        {/* Palette */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Palette
          </div>
          {palette.length === 0 ? (
            <p className="text-[11px] font-mono text-text-muted italic leading-relaxed">
              Use the color picker above — colors from your source image will appear here when you upload one.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {palette.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setColor(c);
                    setTool('pencil');
                  }}
                  className={`w-3 h-3 rounded-sm border cursor-pointer ${
                    color === c ? 'border-accent-amber ring-1 ring-accent-amber' : 'border-border-subtle'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        {/* 1× preview — sidepanel placement (Phase 1.5: was below the canvas
            grid, now lives alongside the palette so it's visible without
            scrolling past the canvas). */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            1× preview
          </div>
          <div
            className="border border-border-default rounded inline-block self-start"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
              backgroundSize: '4px 4px',
              backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0',
            }}
          >
            <canvas
              ref={previewCanvasRef}
              style={{ imageRendering: 'pixelated', display: 'block' }}
            />
          </div>
        </div>

        {/* Animation preview — Phase 4 */}

        {/* Modal footer slot: Cancel / Save sits inline at the bottom of the
            sidepanel only in modal mode. Page mode puts Save in the header,
            so this block is hidden there. */}
        {layout === 'modal' && (
          <div className="mt-auto pt-3 border-t border-border-subtle flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={doSaveAndDismiss}>
              <Save size={14} />
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Cancel
            </Button>
          </div>
        )}
      </aside>
    </div>

    {/* Mobile Colors sheet — plain inline overlay (NOT a HeadlessUI Dialog).
        In the sheet-frame flow the editor is itself a Dialog; a nested Dialog
        portals to <body>, outside the editor's panel, so the editor's outside-
        click guard fired on sheet taps (spurious unsaved-changes prompt + dead
        canvas). This overlay renders inline, stays inside the editor panel's
        DOM, and has no Dialog to collide with. Backdrop tap and Done close it;
        Escape closes it via the keydown effect. Always mounted so it can slide;
        pointer-events are gated off when closed so it never blocks the canvas,
        and md:hidden keeps it off desktop entirely. */}
    <div
      aria-hidden={!sheetOpen}
      onClick={() => setSheetOpen(false)}
      className={`fixed inset-0 z-[105] bg-black/50 transition-opacity duration-200 md:hidden ${
        sheetOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    />
    <div
      role="dialog"
      aria-label="Colors"
      aria-hidden={!sheetOpen}
      className={`fixed inset-x-0 bottom-0 z-[106] md:hidden flex flex-col gap-4 bg-bg-secondary border-t border-border-default rounded-t-2xl shadow-2xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] transition-transform duration-200 ease-out ${
        sheetOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none'
      }`}
    >
      {/* drag handle */}
      <div className="mx-auto h-1 w-10 rounded-full bg-border-default" />

      <div className="flex items-center justify-between">
        <span className="text-sm font-mono font-semibold text-text-primary">Colors</span>
        <button
          type="button"
          onClick={() => setSheetOpen(false)}
          className="text-xs font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer px-2 py-1"
        >
          Done
        </button>
      </div>

      {/* Custom color picker (native) */}
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Foreground color"
          className="w-12 h-12 rounded border border-border-default cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm"
        />
        <span className="text-xs font-mono text-text-muted">Tap to pick a custom color</span>
      </div>

      {/* Palette */}
      <div className="flex flex-col gap-2">
        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">Palette</div>
        {palette.length === 0 ? (
          <p className="text-[11px] font-mono text-text-muted italic leading-relaxed">
            Colors from your source image appear here when you upload one.
          </p>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setColor(c); setTool('pencil'); setSheetOpen(false); }}
                className={`aspect-square w-full rounded-sm border cursor-pointer ${
                  color === c ? 'border-accent-amber ring-1 ring-accent-amber' : 'border-border-subtle'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
