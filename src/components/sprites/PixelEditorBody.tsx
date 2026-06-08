'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
import { useSpriteStore } from '@/stores/spriteStore';
import { extractPaletteFromImageData } from '@/lib/imagePalette';

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
  const paintPixel = useEditorStore((s) => s.paintPixel);
  const erasePixel = useEditorStore((s) => s.erasePixel);
  const paintLine = useEditorStore((s) => s.paintLine);
  const eraseLine = useEditorStore((s) => s.eraseLine);
  const eyedrop = useEditorStore((s) => s.eyedrop);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const revertToOriginal = useEditorStore((s) => s.revertToOriginal);
  const reset = useEditorStore((s) => s.reset);

  // Dimension-guardrail error path (Fix #5). If the loaded image exceeds
  // EDITOR_MAX_DIMENSION / EDITOR_MAX_PIXELS, the load effect bails out before
  // touching the store and sets this — the canvas area renders a friendly
  // refusal instead of an empty canvas, and the editor stays in a valid state.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [zoom, setZoom] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);

  // Transient toast for keyboard-driven brush-size changes.
  const [brushToast, setBrushToast] = useState<string | null>(null);
  const brushToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cursor overlay (mirrors brush footprint at canvas-pixel coords).
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(false);
  const cursorRafRef = useRef<number | null>(null);

  // Fit-to-viewport zoom on dim changes.
  useEffect(() => {
    const maxEditorPx = Math.min(window.innerWidth - 200, window.innerHeight - 200, 640);
    const idealZoom = Math.floor(maxEditorPx / Math.max(frameWidth, frameHeight));
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

  // Re-render on zoom change (image canvas's CSS size + overlay's full geometry).
  useEffect(() => {
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

  const getPixelCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = editorCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / zoom);
      const y = Math.floor((e.clientY - rect.top) / zoom);
      return { x, y };
    },
    [zoom]
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getPixelCoords(e);
      if (!coords) return;
      if (tool !== 'eyedropper') beginStroke();
      setIsDrawing(true);
      // Fresh stroke — no previous cell to interpolate from.
      prevCellRef.current = null;
      applyAt(coords.x, coords.y);
      // After the initial stamp, seed prev so the next pointermove can
      // Bresenham-interpolate from here. Eyedropper is one-shot; no prev.
      if (tool !== 'eyedropper') {
        prevCellRef.current = coords;
      }
    },
    [getPixelCoords, tool, beginStroke, applyAt]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = editorCanvasRef.current?.getBoundingClientRect();
      if (rect) {
        const cellX = Math.floor((e.clientX - rect.left) / zoom);
        const cellY = Math.floor((e.clientY - rect.top) / zoom);
        const half = Math.floor(brushSize / 2);
        const ox = (cellX - half) * zoom;
        const oy = (cellY - half) * zoom;
        if (cursorRafRef.current !== null) cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = requestAnimationFrame(() => {
          setCursorX(ox);
          setCursorY(oy);
        });
      }

      if (!isDrawing || tool === 'eyedropper') return;
      const coords = getPixelCoords(e);
      if (!coords) return;

      const prev = prevCellRef.current;
      if (prev && (prev.x !== coords.x || prev.y !== coords.y)) {
        // Interpolate to close per-event gaps on fast strokes. Bresenham
        // walks each cell from prev→current; the line bbox covers the whole
        // segment so the patch render captures every stamp in one update.
        applyLine(prev.x, prev.y, coords.x, coords.y);
      } else if (!prev) {
        // Defensive — shouldn't happen given handleMouseDown seeds prev,
        // but fall back to a single stamp so the user's input isn't lost.
        applyAt(coords.x, coords.y);
      }
      // Same cell as prev → no-op (no stamp, no render).
      prevCellRef.current = coords;
    },
    [isDrawing, tool, brushSize, zoom, getPixelCoords, applyAt, applyLine]
  );

  const handleMouseUp = useCallback(() => {
    if (isDrawing && tool !== 'eyedropper') {
      endStroke();
      // Wave 1c: minimal correctness backstop. The grid + checkerboard live
      // on separate layers and weren't touched by the patch path, so the old
      // full-chrome redraw is unnecessary (it caused a visible flash). A
      // single putImageData of the canonical buffer is cheap and zoom-
      // independent — guards against any sub-pixel drift between the per-
      // event patches and the store's final buffer state.
      const ec = editorCanvasRef.current;
      const { pixels, width, height } = useEditorStore.getState();
      if (ec && pixels && width > 0 && height > 0 && ec.width === width && ec.height === height) {
        const ctx = ec.getContext('2d')!;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      }
    }
    setIsDrawing(false);
    prevCellRef.current = null;
  }, [isDrawing, tool, endStroke]);

  const handleMouseEnter = useCallback(() => setCursorVisible(true), []);
  const handleMouseLeaveCanvas = useCallback(() => {
    setCursorVisible(false);
    handleMouseUp();
  }, [handleMouseUp]);

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


  const toolButtons: Array<{ id: Tool; icon: typeof Pencil; label: string }> = [
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  ];

  return (
    <div
      className="h-full grid grid-rows-[auto_1fr] grid-cols-[56px_1fr_280px] [grid-template-areas:'header_header_header''toolbar_canvas_sidepanel'] bg-bg-primary"
    >
      {/* Header */}
      <header className="[grid-area:header] flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-primary">
        <h2 className="text-sm font-mono font-semibold text-text-primary">
          Pixel Editor
          <span className="ml-2 text-text-muted font-normal">
            {frameWidth}x{frameHeight}
          </span>
        </h2>

        {layout === 'modal' ? (
          <button
            onClick={onDismiss}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
            aria-label="Close editor"
          >
            <X size={16} />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/editor" onClick={onDismiss}>
              <Button variant="ghost" size="sm">
                <ArrowLeft size={14} />
                Back
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
              Save (download PNG)
            </Button>
          </div>
        )}
      </header>

      {/* Toolbar (left) */}
      <aside className="[grid-area:toolbar] border-r border-border-default bg-bg-secondary overflow-y-auto [scrollbar-gutter:stable] p-2 flex flex-col gap-2">
        {toolButtons.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTool(id)}
            title={label}
            className={`p-2 rounded cursor-pointer transition-colors
              ${tool === id
                ? 'bg-accent-amber text-bg-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
          >
            <Icon size={16} />
          </button>
        ))}

        <div className="w-full h-px bg-border-subtle my-1" />

        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider text-center">
          Brush
        </div>
        <div className="grid grid-cols-3 gap-1">
          {VALID_BRUSH_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setBrushSize(size)}
              aria-label={`Brush size ${size}px`}
              title={`Brush size ${size}px ( [ / ] )`}
              className={`h-7 rounded text-[10px] font-mono cursor-pointer transition-colors
                ${brushSize === size
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {size}
            </button>
          ))}
        </div>

        <div className="w-full h-px bg-border-subtle my-1" />

        <button
          onClick={undo}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Redo2 size={16} />
        </button>

        <div className="w-full h-px bg-border-subtle my-1" />

        <button
          onClick={revertToOriginal}
          title="Revert to original (undoable)"
          disabled={!isDirty}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Revert to original"
        >
          <History size={16} />
        </button>
      </aside>

      {/* Canvas (center) */}
      <main className="[grid-area:canvas] overflow-auto bg-bg-primary relative">
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center p-8 z-10">
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
        <div className="min-h-full flex flex-col items-center justify-center p-4 gap-4">
          {/* Zoom controls (Wave 2 replaces with react-zoom-pan-pinch) */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Zoom
            </label>
            {([4, 8, 12, 16] as const).map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors
                  ${zoom === z
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {z}x
              </button>
            ))}
          </div>

          {/* Canvas stack — image (bottom) → grid overlay (middle) → cursor
              footprint (top). DOM order = paint order. The image canvas has
              the transparency checkerboard as its CSS background, so any
              alpha-0 region (eraser strokes, transparent project canvases)
              reveals it through the canvas — no in-canvas tile fill needed. */}
          <div className="relative">
            <canvas
              ref={editorCanvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeaveCanvas}
              className="block"
              style={{
                imageRendering: 'pixelated',
                cursor: 'none',
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
                display: cursorVisible ? 'block' : 'none',
              }}
            />
          </div>

          {/* Brush-size toast */}
          {brushToast && (
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded bg-black/80 text-amber-300 text-xs font-mono pointer-events-none"
              role="status"
              aria-live="polite"
            >
              {brushToast}
            </div>
          )}
        </div>
      </main>

      {/* Sidepanel (right): color + palette + future preview */}
      <aside className="[grid-area:sidepanel] border-l border-border-default bg-bg-secondary overflow-y-auto [scrollbar-gutter:stable] p-3 flex flex-col gap-4">
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
  );
}
