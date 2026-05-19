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

    loadFrame: (frameId, pixels, width, height) => {
      const snap = new Uint8ClampedArray(pixels);
      set({
        frameId,
        width,
        height,
        pixels: new Uint8ClampedArray(pixels),
        historyStack: [snap],
        historyIndex: 0,
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
      const [r, g, b] = hexToRgb(color);
      const next = new Uint8ClampedArray(pixels);
      applyBrushSquare(next, width, height, x, y, brushSize, [r, g, b, 255]);
      set({ pixels: next });
    },

    erasePixel: (x, y) => {
      const { pixels, width, height, brushSize } = get();
      if (!pixels) return;
      const next = new Uint8ClampedArray(pixels);
      applyBrushSquare(next, width, height, x, y, brushSize, [0, 0, 0, 0]);
      set({ pixels: next });
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
      });
    },

    redo: () => {
      const { historyStack, historyIndex } = get();
      if (historyIndex >= historyStack.length - 1) return;
      const newIndex = historyIndex + 1;
      set({
        historyIndex: newIndex,
        pixels: new Uint8ClampedArray(historyStack[newIndex]),
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
      }),
  }))
);

// Derived selectors — pass to useEditorStore(selector) to subscribe.
export const selectIsDirty = (s: PixelEditorState) => s.historyIndex > 0;
export const selectCanUndo = (s: PixelEditorState) => s.historyIndex > 0;
export const selectCanRedo = (s: PixelEditorState) =>
  s.historyIndex >= 0 && s.historyIndex < s.historyStack.length - 1;
