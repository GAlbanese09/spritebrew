/**
 * "Fix pixel grid" in /editor: the guard, the limits and the copy. Pure: no
 * DOM and no worker, so scripts/pixel-grid-test.mjs runs it in node.
 *
 * The fixer (wasm/pixel-grid) always finds a grid, because its smallest step
 * is 2 px: given art that is already clean it invents one and damages the art
 * (the w3 spike's report). The guard is the answer: where a real grid was
 * found, the middle of every output cell holds that cell's color, because
 * blur and upscaling smear only the borders between cells.
 */

/**
 * A fixed image must reproduce this share of the input's cell centers to be
 * offered as a fix. The lowest two-decimal value at which wrong or clean
 * results pass on real sheets at most 20% of the time (HQ's rule: refuse too
 * often rather than let a bad fix through, and "Show anyway" stands behind a
 * refusal). Measured on Nov 6, 2026 on the app's own path (PNG, the committed
 * .wasm, decode, this guard) on 988 images the editor can open, percent
 * passed, right results / wrong or clean results:
 *              real sheets    synthetic
 *   0.97       86.9 / 29.1    75.3 / 35.0
 *   0.98       80.0 / 14.0    70.2 / 28.7
 *   0.99       73.8 /  3.5    63.4 / 16.4
 *   old guard  95.9 / 77.9    87.7 / 77.9
 */
export const CELL_CENTER_MIN = 0.98;

/** How far apart two colors may be and still count as the same, on every RGB
 *  channel. Blur and JPEG leave colors close, not restored, so an exact match
 *  would fail real fake pixel art. */
export const CELL_CENTER_TOLERANCE = 24;

/** The alpha from which a pixel counts as visible to the guard. */
const VISIBLE_ALPHA = 128;

/** The most the x and y steps may differ, as a share of the larger: pixel art
 *  has square pixels, so very unequal steps mean a wrong grid. A true result
 *  can still differ a little (6.55% on the w3 spike's case 5). */
export const GRID_STEP_MAX_DIFFERENCE = 0.1;

/** The smallest side the fixer takes (the same in wasm/pixel-grid). */
export const MIN_SIDE = 16;

/** The most pixels the fixer takes (the same in wasm/pixel-grid). */
export const PIXEL_GRID_MAX_PIXELS = 4_000_000;

/** The cap on a device that reports 4 GB of memory or less: at the full cap
 *  the fixer's WebAssembly memory peaks near 280 MB. */
export const PIXEL_GRID_LOW_MEMORY_PIXELS = 2_000_000;

/**
 * For each input coordinate along one axis, the output cell it is counted for,
 * or -1 when it sits too near that cell's edge: a pixel counts when it is at
 * least floor(cell size / 3) px from both edges of its cell, so in a cell
 * under 3 px every pixel counts. Cell i starts at ceil(i * inSize / outSize).
 */
function coreCells(inSize: number, outSize: number): Int32Array {
  const cells = new Int32Array(inSize).fill(-1);
  const margin = Math.floor(inSize / (3 * outSize));
  for (let cell = 0; cell < outSize; cell++) {
    const first = Math.ceil((cell * inSize) / outSize);
    const last = Math.ceil(((cell + 1) * inSize) / outSize) - 1;
    for (let x = first + margin; x <= last - margin; x++) cells[x] = cell;
  }
  return cells;
}

/**
 * The share of the input's cell centers that the fixed image reproduces. Only
 * input pixels with alpha >= 128 away from their cell's edges count (coreCells
 * on both axes). One matches when its output cell has alpha >= 128 and every
 * RGB channel is within CELL_CENTER_TOLERANCE. 0 when nothing counts: there
 * is nothing to fix.
 */
export function cellCenterScore(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
): number {
  const cellX = coreCells(inW, outW);
  const cellY = coreCells(inH, outH);
  let counted = 0;
  let matched = 0;
  for (let y = 0; y < inH; y++) {
    if (cellY[y] < 0) continue;
    const row = cellY[y] * outW;
    for (let x = 0; x < inW; x++) {
      if (cellX[x] < 0) continue;
      const i = (y * inW + x) * 4;
      if (input[i + 3] < VISIBLE_ALPHA) continue;
      counted++;
      const o = (row + cellX[x]) * 4;
      if (output[o + 3] < VISIBLE_ALPHA) continue;
      const worst = Math.max(
        Math.abs(input[i] - output[o]),
        Math.abs(input[i + 1] - output[o + 1]),
        Math.abs(input[i + 2] - output[o + 2]),
      );
      if (worst <= CELL_CENTER_TOLERANCE) matched++;
    }
  }
  return counted === 0 ? 0 : matched / counted;
}

/** Whether the grid's x and y steps are within GRID_STEP_MAX_DIFFERENCE of
 *  each other, as a share of the larger. */
export function gridStepsAgree(inW: number, inH: number, outW: number, outH: number): boolean {
  const stepX = inW / outW;
  const stepY = inH / outH;
  return Math.abs(stepX - stepY) <= GRID_STEP_MAX_DIFFERENCE * Math.max(stepX, stepY);
}

/** The guard: whether a result of the fixer is offered as a fix. */
export function gridFixPasses(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
): boolean {
  return gridStepsAgree(inW, inH, outW, outH)
    && cellCenterScore(input, inW, inH, output, outW, outH) >= CELL_CENTER_MIN;
}

/** An image as the editor holds it. */
export interface FixGridImage {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Whether the editor's image is, byte for byte, the one a fix started from.
 *  A result is never shown or used against any other (audit r1, finding 3). */
export function sameImage(
  start: FixGridImage,
  now: { pixels: Uint8ClampedArray | null; width: number; height: number },
): boolean {
  const a = start.pixels;
  const b = now.pixels;
  if (!b || now.width !== start.width || now.height !== start.height || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** What a finished run leads to: 'changed', the image moved on while it ran,
 *  so the result is dropped; 'refused', the guard says no, and the result is
 *  kept for "Show anyway"; 'offered', the dialog opens. */
export type FixGridOutcome = 'changed' | 'refused' | 'offered';

export function fixGridOutcome(
  start: FixGridImage,
  now: { pixels: Uint8ClampedArray | null; width: number; height: number },
  fixed: FixGridImage,
): FixGridOutcome {
  if (!sameImage(start, now)) return 'changed';
  return gridFixPasses(start.pixels, start.width, start.height, fixed.pixels, fixed.width, fixed.height)
    ? 'offered'
    : 'refused';
}

/** The most pixels this device may fix. `deviceMemory` is
 *  navigator.deviceMemory, which only some browsers have. */
export function pixelGridCap(deviceMemory?: number): number {
  return typeof deviceMemory === 'number' && deviceMemory <= 4
    ? PIXEL_GRID_LOW_MEMORY_PIXELS
    : PIXEL_GRID_MAX_PIXELS;
}

/** The side of the largest square under `cap` (2000, or 1414). */
export function pixelGridCapSide(cap: number): number {
  return Math.floor(Math.sqrt(cap));
}

/** A base64 data URL's bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** PNG bytes as a data URL. */
export function pngBytesToDataUrl(png: Uint8Array): string {
  // In pieces: String.fromCharCode cannot take a whole image as arguments.
  const CHUNK = 0x8000;
  let text = '';
  for (let i = 0; i < png.length; i += CHUNK) {
    text += String.fromCharCode(...png.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(text)}`;
}

// The copy. George approves it at the go report.
export const FIX_GRID_LABEL = 'Fix pixel grid';
export const FIX_GRID_TOOLTIP = 'Fix pixel grid: turns blurry or upscaled pixel art into clean pixels';
/** The button's description for screen readers: the tooltip less the name,
 *  which they read already. */
export const FIX_GRID_DESCRIPTION = 'Turns blurry or upscaled pixel art into clean pixels';
export const FIX_GRID_RUNNING = 'Fixing the pixel grid...';
export const FIX_GRID_TOO_SMALL = 'This image is too small to need fixing.';
export const FIX_GRID_NOT_FOUND = "Couldn't find a pixel grid to fix in this image. Nothing changed.";
export const FIX_GRID_SHOW_ANYWAY = 'Show anyway';
export const FIX_GRID_MAY_BE_WRONG = 'This may not be right. Compare before you use it.';
export const FIX_GRID_DISMISS = 'Dismiss';
export const FIX_GRID_CHANGED = 'The image changed while fixing, so nothing changed. Press Fix pixel grid again.';
export const FIX_GRID_FAILED = 'Fix pixel grid could not load. Try again in a moment. The rest of the editor still works.';
export const FIX_GRID_USE = 'Use fixed image';
export const FIX_GRID_CANCEL = 'Cancel';
export const FIX_GRID_BEFORE = 'Before';
export const FIX_GRID_AFTER = 'After';
export const FIX_GRID_UNDO = 'Undo fix';
/** The divider's name for screen readers; no one sees it. */
export const FIX_GRID_DIVIDER_NAME = 'Before and after divider';

export function fixGridTooBig(cap: number): string {
  const side = pixelGridCapSide(cap);
  return `This image is too big to fix here. Try one up to ${side} x ${side}.`;
}

export function fixGridSizes(inW: number, inH: number, outW: number, outH: number): string {
  return `${inW} x ${inH} to ${outW} x ${outH}`;
}

/** The divider's value for screen readers, `before` a whole percentage. */
export function fixGridDividerValue(before: number): string {
  return `${before}% before, ${100 - before}% after`;
}

export function fixGridBanner(inW: number, inH: number, outW: number, outH: number): string {
  return `Pixel grid fixed: ${fixGridSizes(inW, inH, outW, outH)}.`;
}
