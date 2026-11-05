/**
 * A sprite sheet of an Animate result's frames as they play: the order after
 * Remove and Duplicate, with ping-pong expanded. The result card's Download
 * saves this, so the file matches the loop on the card; the frames are cut by
 * framesFromSheet in gifExport.ts, the same cut the GIF uses.
 *
 * Pure: the canvas is passed in, so the layout is tested offline
 * (scripts/played-sheet-test.mjs).
 */

export interface PlayedSheetSize {
  cols: number;
  rows: number;
  width: number;
  height: number;
}

/** The two parts of a 2D canvas this module uses; a real canvas has both. */
export interface PlayedSheetContext {
  putImageData(data: ImageData, x: number, y: number): void;
}
export interface PlayedSheetCanvas {
  getContext(kind: '2d'): PlayedSheetContext | null;
}

/** A column count an engine can read: a whole number, at least 1. */
function wholeCols(cols: number): number {
  return Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 1;
}

/**
 * The sheet's size for this many frames. The column count is the source
 * sheet's, kept even when fewer frames remain (HQ ruling 2), so a frame size
 * and column count set up in an engine still fit; the empty cells stay
 * transparent. No frames, no rows.
 */
export function playedSheetSize(count: number, cols: number, frameW: number, frameH: number): PlayedSheetSize {
  const c = wholeCols(cols);
  const rows = count > 0 ? Math.ceil(count / c) : 0;
  return { cols: c, rows, width: c * frameW, height: rows * frameH };
}

/** Where a frame sits on the sheet, read row-major. */
export function framePosition(index: number, cols: number, frameW: number, frameH: number): { x: number; y: number } {
  const c = wholeCols(cols);
  return { x: (index % c) * frameW, y: Math.floor(index / c) * frameH };
}

/**
 * Lays the frames out on a new canvas. putImageData keeps each pixel as it
 * was cut, with no smoothing and no blending over the cell. Throws when the
 * canvas has no 2D context; the caller shows its own message.
 */
export function assemblePlayedSheet<C extends PlayedSheetCanvas>(
  frames: readonly ImageData[],
  frameW: number,
  frameH: number,
  cols: number,
  createCanvas: (width: number, height: number) => C
): C {
  const { width, height } = playedSheetSize(frames.length, cols, frameW, frameH);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context to assemble the sheet');
  frames.forEach((frame, i) => {
    const { x, y } = framePosition(i, cols, frameW, frameH);
    ctx.putImageData(frame, x, y);
  });
  return canvas;
}
