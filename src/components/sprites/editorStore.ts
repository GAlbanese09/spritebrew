// Zustand store for the Pixel Editor. Source of truth for pixel data while
// the editor is open; the visible canvas is a render target that mirrors
// store state.
//
// Wave 1 of the Pixel Editor Redesign — replaces the previous dataCanvasRef
// pattern that lived only in DOM, which silently lost user edits on
// backdrop/Esc close. With the store owning pixels, the editor can
// detect isDirty and gate close behind a confirm dialog.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type Tool = 'pencil' | 'eraser' | 'eyedropper';
export type BrushSize = 1 | 2 | 4 | 8 | 16;
export const VALID_BRUSH_SIZES: readonly BrushSize[] = [1, 2, 4, 8, 16];

const MAX_HISTORY = 50;

// Dimension guardrails (Wave 1a — Fix #5). Cap any image loaded into the
// editor so untrusted dims from Open Project / Pick from Gallery can't blow
// memory. EDITOR_MAX_DIMENSION is the per-side cap; EDITOR_MAX_PIXELS guards
// against e.g. a 4096×64 strip whose per-side caps are within bounds but
// whose total area is large. Both must be respected.
// TODO(wave-1b): per-tier frame caps come with the frame model; this is a
// flat ceiling for now.
export const EDITOR_MAX_DIMENSION = 1024;
export const EDITOR_MAX_PIXELS = EDITOR_MAX_DIMENSION * EDITOR_MAX_DIMENSION;

/** Friendly message for the over-limit error path. */
export function editorDimsRejectionMessage(w: number, h: number): string {
  return `Image is too large for the editor (${w}×${h}). Max ${EDITOR_MAX_DIMENSION}×${EDITOR_MAX_DIMENSION} per side, up to ${EDITOR_MAX_PIXELS.toLocaleString()} total pixels.`;
}

/** True when (w, h) fit the editor's load caps. */
export function dimsWithinEditorLimits(w: number, h: number): boolean {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (w <= 0 || h <= 0) return false;
  if (w > EDITOR_MAX_DIMENSION || h > EDITOR_MAX_DIMENSION) return false;
  if (w * h > EDITOR_MAX_PIXELS) return false;
  return true;
}

export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute the canvas-clipped bounding box of a brush stamp centered at (cx, cy).
 * Matches applyBrushSquare's footprint exactly: brushSize × brushSize square,
 * `half = floor(brushSize/2)`, dx range [-half, brushSize-half-1].
 *
 * Returns null when the brush is fully off-canvas — callers should treat that
 * as a no-op (no pixel changes, no dirty rect to render).
 */
function computeStampBbox(
  cx: number,
  cy: number,
  brushSize: number,
  width: number,
  height: number
): DirtyRect | null {
  const half = Math.floor(brushSize / 2);
  const left = Math.max(0, cx - half);
  const top = Math.max(0, cy - half);
  const right = Math.min(width - 1, cx + brushSize - half - 1);
  const bottom = Math.min(height - 1, cy + brushSize - half - 1);
  if (right < left || bottom < top) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * Union bbox of two brush stamps at (x0,y0) and (x1,y1) — used as the dirty
 * rect for a Bresenham-interpolated line. The line is monotonic in each axis
 * within this AABB, so the union of endpoints fully covers all intermediate
 * stamps too. Clipped to canvas bounds.
 */
function computeLineBbox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  brushSize: number,
  width: number,
  height: number
): DirtyRect | null {
  const half = Math.floor(brushSize / 2);
  const left = Math.max(0, Math.min(x0, x1) - half);
  const top = Math.max(0, Math.min(y0, y1) - half);
  const right = Math.min(width - 1, Math.max(x0, x1) + brushSize - half - 1);
  const bottom = Math.min(height - 1, Math.max(y0, y1) + brushSize - half - 1);
  if (right < left || bottom < top) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

export interface PixelEditorState {
  // Pixel data: source of truth at native frame resolution. RGBA bytes,
  // length = width * height * 4. Stored as Uint8ClampedArray (not ImageData)
  // because ImageData's internal buffer is non-cloneable and breaks
  // Zustand's structural sharing.
  pixels: Uint8ClampedArray | null;
  frameId: string | null;
  width: number;
  height: number;

  // Undo/redo timeline. historyStack[0] = initial loaded frame UNTIL the
  // 50-entry cap forces a shift; after overflow, historyStack[0] is no longer
  // the loaded baseline — use `originalPixels` for that instead. Each
  // subsequent entry = post-stroke snapshot. historyIndex points to the
  // entry that currently matches `pixels`.
  historyStack: Uint8ClampedArray[];
  historyIndex: number; // -1 = empty, 0 = initial state, 1+ = edits

  /**
   * Loaded-frame baseline, captured by loadFrame and independent of the
   * history stack. Survives history overflow so "Revert to original" remains
   * possible after >50 strokes. Cleared by reset() between frame loads.
   */
  originalPixels: Uint8ClampedArray | null;

  activeTool: Tool;
  foregroundColor: string;
  brushSize: BrushSize;

  /**
   * Per-event dirty rect for the brush-smoothness fix: when set, only this
   * sub-region of the canvas needs re-rendering (chrome — checkerboard, grid —
   * is preserved across patches). When null, signals "full repaint needed"
   * (mount, undo/redo, frame load, stroke end). The Body subscribes to `pixels`
   * and reads this field via getState to decide between full vs patch render.
   */
  lastDirtyRect: DirtyRect | null;

  loadFrame: (
    frameId: string,
    pixels: Uint8ClampedArray,
    width: number,
    height: number
  ) => void;
  // Stroke boundaries: beginStroke clears any redo branch; endStroke
  // pushes the post-stroke pixel snapshot as a single history entry.
  // Editor calls these on mousedown / mouseup so each stroke = one undo
  // entry (matches the original PixelEditor behaviour).
  beginStroke: () => void;
  endStroke: () => void;
  paintPixel: (x: number, y: number, color: string) => void;
  erasePixel: (x: number, y: number) => void;
  /** Stamp the brush at every cell from (x0,y0) to (x1,y1) via Bresenham, in
   *  a single store mutation (one subscription fire instead of N). Used by
   *  Body for mid-stroke interpolation to close the per-event gap. */
  paintLine: (x0: number, y0: number, x1: number, y1: number, color: string) => void;
  eraseLine: (x0: number, y0: number, x1: number, y1: number) => void;
  eyedrop: (x: number, y: number) => string | null;
  undo: () => void;
  redo: () => void;
  /**
   * Restore the loaded-frame baseline as a new undoable history entry. No-ops
   * if there's no baseline or the current pixels already byte-match it. The
   * revert itself is undoable (pushes onto historyStack like a normal stroke).
   */
  revertToOriginal: () => void;
  setActiveTool: (tool: Tool) => void;
  setForegroundColor: (color: string) => void;
  setBrushSize: (size: BrushSize) => void;
  reset: () => void;
}

/**
 * Parse a CSS hex color into [r, g, b, a] bytes (0–255). Accepts #RGB, #RGBA,
 * #RRGGBB, #RRGGBBAA. Expands 3/4-digit shorthand the standard way (#abc →
 * #aabbcc). Returns null on any malformed input — callers MUST no-op the
 * paint rather than coerce a bad parse to NaN→0 (silent black).
 *
 * Module-private: paint callers handle the null path here. Eyedrop produces
 * its own #RRGGBB output and never needs this in reverse.
 */
function hexToRgb(hex: string): [number, number, number, number] | null {
  if (typeof hex !== 'string') return null;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) {
    // Expand shorthand: each nibble doubled. #abc → #aabbcc, #abcd → #aabbccdd.
    h = h.split('').map((c) => c + c).join('');
  }
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

// Dev-only round-trip assertions for hexToRgb. Stripped in production.
if (process.env.NODE_ENV !== 'production') {
  console.assert(
    JSON.stringify(hexToRgb('#ff8800')) === JSON.stringify([255, 136, 0, 255]),
    'hexToRgb #ff8800',
  );
  console.assert(
    JSON.stringify(hexToRgb('#abc')) === JSON.stringify([170, 187, 204, 255]),
    'hexToRgb #abc shorthand expansion',
  );
  console.assert(
    JSON.stringify(hexToRgb('#abcd')) === JSON.stringify([170, 187, 204, 221]),
    'hexToRgb #abcd shorthand expansion',
  );
  console.assert(
    JSON.stringify(hexToRgb('#ff880080')) === JSON.stringify([255, 136, 0, 128]),
    'hexToRgb #ff880080 8-digit alpha',
  );
  console.assert(hexToRgb('#zz') === null, 'hexToRgb #zz rejects non-hex');
  console.assert(hexToRgb('garbage') === null, 'hexToRgb garbage rejects');
  console.assert(hexToRgb('') === null, 'hexToRgb empty rejects');
  console.assert(hexToRgb('#fffff') === null, 'hexToRgb 5-digit rejects');
}

function applyBrushSquare(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  brushSize: number,
  rgba: [number, number, number, number]
) {
  // Square footprint, Aseprite convention. brushSize=1 → 1×1 at (cx, cy).
  // brushSize=4 → 4×4 spanning (cx-2..cx+1, cy-2..cy+1).
  const half = Math.floor(brushSize / 2);
  for (let dy = -half; dy < brushSize - half; dy++) {
    for (let dx = -half; dx < brushSize - half; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const idx = (py * width + px) * 4;
      pixels[idx] = rgba[0];
      pixels[idx + 1] = rgba[1];
      pixels[idx + 2] = rgba[2];
      pixels[idx + 3] = rgba[3];
    }
  }
}

export const useEditorStore = create<PixelEditorState>()(
  subscribeWithSelector((set, get) => ({
    pixels: null,
    frameId: null,
    width: 0,
    height: 0,
    historyStack: [],
    historyIndex: -1,
    originalPixels: null,
    activeTool: 'pencil',
    foregroundColor: '#d4871c',
    brushSize: 1,
    lastDirtyRect: null,

    loadFrame: (frameId, pixels, width, height) => {
      // Capture three independent copies of the source bytes: live pixels
      // (mutated by paint), history seed (cycled by undo/redo + capped at 50),
      // and originalPixels (immortal baseline for Revert).
      const liveCopy = new Uint8ClampedArray(pixels);
      const historySeed = new Uint8ClampedArray(pixels);
      const baselineCopy = new Uint8ClampedArray(pixels);
      set({
        frameId,
        width,
        height,
        pixels: liveCopy,
        historyStack: [historySeed],
        historyIndex: 0,
        originalPixels: baselineCopy,
        lastDirtyRect: null, // full repaint needed for a fresh frame
      });
    },

    beginStroke: () => {
      const { historyStack, historyIndex } = get();
      if (historyIndex < historyStack.length - 1) {
        set({ historyStack: historyStack.slice(0, historyIndex + 1) });
      }
    },

    endStroke: () => {
      const { pixels, historyStack } = get();
      if (!pixels) return;
      const next = [...historyStack, new Uint8ClampedArray(pixels)];
      while (next.length > MAX_HISTORY) next.shift();
      set({ historyStack: next, historyIndex: next.length - 1 });
    },

    paintPixel: (x, y, color) => {
      const { pixels, width, height, brushSize } = get();
      if (!pixels) return;
      const bbox = computeStampBbox(x, y, brushSize, width, height);
      if (!bbox) return; // fully off-canvas — no-op
      const rgba = hexToRgb(color);
      if (!rgba) return; // malformed color — no-op (do NOT silently paint black)
      const next = new Uint8ClampedArray(pixels);
      applyBrushSquare(next, width, height, x, y, brushSize, rgba);
      set({ pixels: next, lastDirtyRect: bbox });
    },

    erasePixel: (x, y) => {
      const { pixels, width, height, brushSize } = get();
      if (!pixels) return;
      const bbox = computeStampBbox(x, y, brushSize, width, height);
      if (!bbox) return;
      const next = new Uint8ClampedArray(pixels);
      applyBrushSquare(next, width, height, x, y, brushSize, [0, 0, 0, 0]);
      set({ pixels: next, lastDirtyRect: bbox });
    },

    paintLine: (x0, y0, x1, y1, color) => {
      const { pixels, width, height, brushSize } = get();
      if (!pixels) return;
      const bbox = computeLineBbox(x0, y0, x1, y1, brushSize, width, height);
      if (!bbox) return;
      const rgba = hexToRgb(color);
      if (!rgba) return; // malformed color — no-op
      const next = new Uint8ClampedArray(pixels);
      // Bresenham. Both endpoints stamped (idempotent w.r.t. last event's prev).
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      let cx = x0;
      let cy = y0;
      while (true) {
        applyBrushSquare(next, width, height, cx, cy, brushSize, rgba);
        if (cx === x1 && cy === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; cx += sx; }
        if (e2 < dx) { err += dx; cy += sy; }
      }
      set({ pixels: next, lastDirtyRect: bbox });
    },

    eraseLine: (x0, y0, x1, y1) => {
      const { pixels, width, height, brushSize } = get();
      if (!pixels) return;
      const bbox = computeLineBbox(x0, y0, x1, y1, brushSize, width, height);
      if (!bbox) return;
      const next = new Uint8ClampedArray(pixels);
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      let cx = x0;
      let cy = y0;
      while (true) {
        applyBrushSquare(next, width, height, cx, cy, brushSize, [0, 0, 0, 0]);
        if (cx === x1 && cy === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; cx += sx; }
        if (e2 < dx) { err += dx; cy += sy; }
      }
      set({ pixels: next, lastDirtyRect: bbox });
    },

    eyedrop: (x, y) => {
      const { pixels, width, height } = get();
      if (!pixels || x < 0 || y < 0 || x >= width || y >= height) return null;
      const idx = (y * width + x) * 4;
      if (pixels[idx + 3] < 10) return null;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    },

    undo: () => {
      const { historyStack, historyIndex } = get();
      if (historyIndex <= 0) return;
      const newIndex = historyIndex - 1;
      set({
        historyIndex: newIndex,
        pixels: new Uint8ClampedArray(historyStack[newIndex]),
        lastDirtyRect: null, // wholesale pixel replacement → full repaint
      });
    },

    redo: () => {
      const { historyStack, historyIndex } = get();
      if (historyIndex >= historyStack.length - 1) return;
      const newIndex = historyIndex + 1;
      set({
        historyIndex: newIndex,
        pixels: new Uint8ClampedArray(historyStack[newIndex]),
        lastDirtyRect: null, // wholesale pixel replacement → full repaint
      });
    },

    revertToOriginal: () => {
      const { originalPixels, pixels, historyStack, historyIndex } = get();
      if (!originalPixels || !pixels) return;
      if (originalPixels.length !== pixels.length) return; // defensive
      // Byte-equal check, early-exit on first diff. Cheap at editor sizes
      // (≤ EDITOR_MAX_PIXELS × 4 bytes = ~4 MB worst case at 1024×1024).
      let equal = true;
      for (let i = 0; i < originalPixels.length; i++) {
        if (originalPixels[i] !== pixels[i]) { equal = false; break; }
      }
      if (equal) return; // already at baseline — no-op
      // Truncate any redo branch (same shape as beginStroke), then push the
      // baseline as a new history entry so the revert itself is undoable.
      const truncated = historyIndex < historyStack.length - 1
        ? historyStack.slice(0, historyIndex + 1)
        : historyStack;
      const nextStack = [...truncated, new Uint8ClampedArray(originalPixels)];
      while (nextStack.length > MAX_HISTORY) nextStack.shift();
      set({
        pixels: new Uint8ClampedArray(originalPixels),
        historyStack: nextStack,
        historyIndex: nextStack.length - 1,
        lastDirtyRect: null, // wholesale replacement → full repaint
      });
    },

    setActiveTool: (tool) => set({ activeTool: tool }),
    setForegroundColor: (color) => set({ foregroundColor: color }),
    setBrushSize: (size) => set({ brushSize: size }),

    reset: () =>
      set({
        pixels: null,
        frameId: null,
        width: 0,
        height: 0,
        historyStack: [],
        historyIndex: -1,
        originalPixels: null,
        activeTool: 'pencil',
        foregroundColor: '#d4871c',
        brushSize: 1,
        lastDirtyRect: null,
      }),
  }))
);

// Derived selectors — pass to useEditorStore(selector) to subscribe.
export const selectIsDirty = (s: PixelEditorState) => s.historyIndex > 0;
export const selectCanUndo = (s: PixelEditorState) => s.historyIndex > 0;
export const selectCanRedo = (s: PixelEditorState) =>
  s.historyIndex >= 0 && s.historyIndex < s.historyStack.length - 1;
