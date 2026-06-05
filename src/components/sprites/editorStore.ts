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
import { hexToRgb } from '@/lib/colorUtils';
import {
  ACTIVE_FRAME_MEMORY_KEY,
  createProjectFromImageData,
  validateProject,
  type SpriteProjectSource,
  type SpriteProjectV1,
} from '@/lib/spriteProject';

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
  // ── Document model (Wave 1b) ───────────────────────────────────────────
  // The editor's runtime backs ONE frame of a SpriteProjectV1 document.
  // Today: single-frame, but the document carries frames[] so save/import
  // never need a frames migration (Wave 5 lights up the multi-buffer
  // runtime on top of this same shape).

  /** Server-side project identifier, set when the project has been saved.
   *  Null for unsaved in-memory documents. Wave 3 will populate this. */
  projectId: string | null;
  /** Human-facing project name. Defaults to "Untitled project" until the
   *  user (or a future Save dialog) renames. */
  projectName: string;
  /** Origin lineage — see SpriteProjectSource. Null when unknown. */
  source: SpriteProjectSource | null;

  // ── Active-frame runtime state ─────────────────────────────────────────
  // Pixel data: source of truth at native frame resolution. RGBA bytes,
  // length = width * height * 4. Stored as Uint8ClampedArray (not ImageData)
  // because ImageData's internal buffer is non-cloneable and breaks
  // Zustand's structural sharing.
  pixels: Uint8ClampedArray | null;
  /** Active frame's stable id (matches frames[activeIndex].id in the
   *  document). Today there is exactly one frame, so this is the only id
   *  getFramePixels accepts. */
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

  /**
   * The seam (Wave 1b). Returns the bytes for a given frame id, or null if
   * the editor doesn't have that frame loaded. Today only the active frame's
   * id is recognized; Wave 5 multi-buffer runtime will broaden this.
   */
  getFramePixels: (frameId: string) => Uint8ClampedArray | null;

  /**
   * Materialize a SpriteProjectV1 into the editor's runtime. Validates the
   * envelope first (boundary check from the Plan); on failure returns false
   * and leaves state untouched. On success: copies pixels into the active
   * buffer, captures the originalPixels baseline, resets history, populates
   * document fields. The `framePixels` argument supplies the bytes for
   * frames[0] — for {kind:'memory'} pixelRefs the bytes can't live inside
   * the JSON envelope, so they're passed in alongside.
   */
  loadProject: (
    project: SpriteProjectV1,
    framePixels: Uint8ClampedArray
  ) => boolean;

  /**
   * Serialize the current runtime state into a SpriteProjectV1 envelope.
   * The bytes themselves are NOT embedded — frames[0].pixelRef points to
   * the active-memory key, and a future caller (Wave 3 Save) will fetch
   * the bytes via getFramePixels(frames[0].id).
   */
  toProject: () => SpriteProjectV1 | null;

  loadFrame: (
    frameId: string,
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    source?: SpriteProjectSource,
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

// hexToRgb lifted to @/lib/colorUtils in Wave 1b — single source of truth for
// editor paint + spriteProject validation. Behavior is byte-identical to the
// Wave 1a private version.

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
    // Document fields (Wave 1b)
    projectId: null,
    projectName: 'Untitled project',
    source: null,

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

    getFramePixels: (frameId) => {
      const s = get();
      // Single-frame runtime: only the active frame is materialized. Future
      // multi-buffer (Wave 5) keeps this seam stable.
      if (!s.frameId || s.frameId !== frameId) return null;
      return s.pixels;
    },

    loadProject: (project, framePixels) => {
      // Boundary validator first (defense in depth; Wave 3 untrusted loads
      // will hit this same path). On failure, leave state untouched.
      const result = validateProject(project);
      if (!result.ok) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[editorStore.loadProject] validation failed:', result.error);
        }
        return false;
      }
      const p = result.project;

      // Wave 1b only materializes frames[0]. Multi-frame runtime is Wave 5.
      const frame0 = p.frames[0];

      // Cross-check the supplied pixel bytes against the document's declared
      // canvas dims. A length mismatch is an integration bug — refuse rather
      // than corrupt the buffer.
      const expectedLength = p.canvas.width * p.canvas.height * 4;
      if (framePixels.length !== expectedLength) {
        if (process.env.NODE_ENV !== 'production') {
          console.error(
            '[editorStore.loadProject] pixel buffer size mismatch:',
            `expected ${expectedLength} bytes for ${p.canvas.width}x${p.canvas.height}, got ${framePixels.length}`,
          );
        }
        return false;
      }

      // Capture three independent copies of the source bytes (matches the
      // prior loadFrame contract exactly).
      const liveCopy = new Uint8ClampedArray(framePixels);
      const historySeed = new Uint8ClampedArray(framePixels);
      const baselineCopy = new Uint8ClampedArray(framePixels);

      set({
        projectId: p.projectId ?? null,
        projectName: p.name,
        source: p.source ?? null,
        frameId: frame0.id,
        width: p.canvas.width,
        height: p.canvas.height,
        pixels: liveCopy,
        historyStack: [historySeed],
        historyIndex: 0,
        originalPixels: baselineCopy,
        foregroundColor: p.color.foreground,
        lastDirtyRect: null, // full repaint needed for a fresh frame
      });

      // Dev-only round-trip assert (Wave 1b): the freshly loaded state must
      // serialize back to a valid project. Catches regressions in the
      // document <-> runtime translation on every editor open.
      if (process.env.NODE_ENV !== 'production') {
        const roundTripped = get().toProject();
        const reValidated = roundTripped ? validateProject(roundTripped) : { ok: false as const, error: 'toProject returned null' };
        console.assert(
          reValidated.ok === true,
          '[editorStore] toProject round-trip failed:',
          reValidated.ok === false ? reValidated.error : '',
        );
        if (reValidated.ok) {
          console.assert(
            reValidated.project.canvas.width === p.canvas.width &&
            reValidated.project.canvas.height === p.canvas.height,
            '[editorStore] round-trip dims drifted',
          );
        }
      }

      return true;
    },

    toProject: () => {
      const s = get();
      if (!s.pixels || !s.frameId || s.width === 0 || s.height === 0) return null;
      const now = Date.now();
      return {
        schema: 'spritebrew.project',
        schemaVersion: 1,
        projectId: s.projectId ?? undefined,
        name: s.projectName,
        createdAt: now,
        updatedAt: now,
        canvas: { width: s.width, height: s.height, transparent: true },
        color: {
          mode: 'rgba',
          palette: [], // Palette lives in PixelEditorBody local state today;
                      // Wave 3 Save will source it from the caller.
          recentColors: [],
          foreground: s.foregroundColor,
          background: 'none',
        },
        frames: [
          {
            id: s.frameId,
            index: 0,
            durationMs: Math.round(1000 / 12),
            pixelRef: { kind: 'memory', key: ACTIVE_FRAME_MEMORY_KEY },
          },
        ],
        animation: { fps: 12, playback: 'loop' },
        source: s.source ?? undefined,
      };
    },

    loadFrame: (frameId, pixels, width, height, source) => {
      // Wave 1b: route every loadFrame through the document model so the
      // SpriteProjectV1 path is exercised on every editor open (not dead
      // code waiting for Wave 3). The frameId arg is ignored — the document
      // model assigns a fresh id via createProjectFromImageData — because
      // callers today only ever pass the literal 'current', and routing
      // through the project model normalizes that.
      void frameId; // intentionally unused — kept in signature for compat
      // Defense in depth: editor dim caps re-checked here (the canonical
      // entry points already check via dimsWithinEditorLimits, and
      // validateProject inside loadProject checks again).
      if (!dimsWithinEditorLimits(width, height)) {
        if (process.env.NODE_ENV !== 'production') {
          console.error(
            '[editorStore.loadFrame] dims exceed editor caps:',
            editorDimsRejectionMessage(width, height),
          );
        }
        return;
      }
      // Build a one-frame ImageData from the supplied bytes purely for the
      // document factory's dims hint. The bytes themselves are also passed
      // to loadProject; ImageData is not retained.
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      const project = createProjectFromImageData(imageData, { source });
      get().loadProject(project, pixels);
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
        projectId: null,
        projectName: 'Untitled project',
        source: null,
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
