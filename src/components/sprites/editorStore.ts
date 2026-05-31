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

  // Undo/redo timeline. historyStack[0] = initial loaded frame; each
  // subsequent entry = post-stroke snapshot. historyIndex points to the
  // entry that currently matches `pixels`.
  historyStack: Uint8ClampedArray[];
  historyIndex: number; // -1 = empty, 0 = initial state, 1+ = edits

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
  setActiveTool: (tool: Tool) => void;
  setForegroundColor: (color: string) => void;
  setBrushSize: (size: BrushSize) => void;
  reset: () => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
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
    activeTool: 'pencil',
    foregroundColor: '#d4871c',
    brushSize: 1,
    lastDirtyRect: null,

    loadFrame: (frameId, pixels, width, height) => {
      const snap = new Uint8ClampedArray(pixels);
      set({
        frameId,
        width,
        height,
        pixels: new Uint8ClampedArray(pixels),
        historyStack: [snap],
        historyIndex: 0,
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
      const [r, g, b] = hexToRgb(color);
      const next = new Uint8ClampedArray(pixels);
      applyBrushSquare(next, width, height, x, y, brushSize, [r, g, b, 255]);
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
      const [r, g, b] = hexToRgb(color);
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
        applyBrushSquare(next, width, height, cx, cy, brushSize, [r, g, b, 255]);
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
