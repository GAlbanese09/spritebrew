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
 * offered as a fix, by cellCenterScore: each axis's cell edges may move by
 * whole px, up to half a cell either way, and the best shift counts, since
 * the art's grid may start partway into a cell. On a 0.005 grid, the lowest
 * value at which wrong or clean results pass on real sheets at most 20% of
 * the time, offset grids and none together (HQ's rule: refuse rather than
 * offer a bad fix, and "Show anyway" keeps a refusal one press from the
 * dialog). A result is right when it is the native size of the art it was
 * given (a cell a crop cut at an image edge may be kept or dropped) and at
 * least 95% of the overlapping pixels equal the native art; clean art is
 * never right. Measured on Nov 7, 2026 on the app's own path (PNG, the
 * committed .wasm, decode, this guard) on 5,524 images the editor can open:
 * the r1 set, and the same art cropped so its grid starts a third and a half
 * of a cell in, on x, y and both. Percent passed, right / wrong or clean:
 *                     real sheets                                synthetic
 *                     together      no offset     offsets       together
 *   0.980             82.3 / 22.1   89.4 / 21.1   81.0 / 22.4   80.5 / 21.3
 *   0.985             77.8 / 12.8   87.9 / 12.6   75.9 / 12.8   74.5 / 18.0
 *   0.990             68.6 /  5.4   85.1 /  7.4   65.6 /  4.8   64.1 / 14.3
 *   commit 2's guard  53.4 / 10.6   82.3 / 12.6   48.0 /  9.9   55.2 / 17.9
 */
export const CELL_CENTER_MIN = 0.985;

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
 * One axis's cells with their edges moved `shift` px: for each input
 * coordinate, the output cell it is counted for, or -1. Cell i spans
 * ceil(i * inSize / outSize) + shift to ceil((i + 1) * inSize / outSize) - 1
 * + shift, so pixel x falls in cell floor((x - shift) * outSize / inSize). A
 * pixel counts when it is at least floor(width / 3) px from both edges of its
 * cell, by that cell's own width: in a 2 px cell both count, in a 3 px cell
 * the middle one. A pixel the shift leaves outside every cell does not count.
 */
function coreCells(inSize: number, outSize: number, shift: number): Int32Array {
  const cells = new Int32Array(inSize).fill(-1);
  let first = 0;
  for (let cell = 0; cell < outSize; cell++) {
    const next = Math.ceil(((cell + 1) * inSize) / outSize);
    const margin = Math.floor((next - first) / 3);
    const from = Math.max(0, first + margin + shift);
    const to = Math.min(inSize - 1, next - 1 - margin + shift);
    for (let x = from; x <= to; x++) cells[x] = cell;
    first = next;
  }
  return cells;
}

/** How far an axis's cell edges may move: half a cell, in whole px. */
function maxShift(inSize: number, outSize: number): number {
  return Math.floor(inSize / (2 * outSize));
}

/** Whether an input pixel is reproduced by an output cell: the cell is
 *  visible and every RGB channel is within the tolerance. */
function reproduces(input: Uint8ClampedArray, i: number, output: Uint8ClampedArray, o: number): boolean {
  return output[o + 3] >= VISIBLE_ALPHA
    && Math.abs(input[i] - output[o]) <= CELL_CENTER_TOLERANCE
    && Math.abs(input[i + 1] - output[o + 1]) <= CELL_CENTER_TOLERANCE
    && Math.abs(input[i + 2] - output[o + 2]) <= CELL_CENTER_TOLERANCE;
}

/**
 * The rule cellCenterScore searches with, at one pair of shifts: the share
 * of the counted input pixels (coreCells on both axes, alpha >= 128) whose
 * output cell reproduces them. 0 when nothing counts. The tests hold the
 * search to it.
 */
export function cellScoreAt(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
  shiftX: number,
  shiftY: number,
): number {
  if (!(inW > 0 && inH > 0 && outW > 0 && outH > 0)) return 0;
  const cellX = coreCells(inW, outW, shiftX);
  const cellY = coreCells(inH, outH, shiftY);
  let counted = 0;
  let matched = 0;
  for (let y = 0; y < inH; y++) {
    if (cellY[y] < 0) continue;
    const row = cellY[y] * outW;
    for (let x = 0, i = y * inW * 4; x < inW; x++, i += 4) {
      if (cellX[x] < 0 || input[i + 3] < VISIBLE_ALPHA) continue;
      counted++;
      if (reproduces(input, i, output, (row + cellX[x]) * 4)) matched++;
    }
  }
  return counted === 0 ? 0 : matched / counted;
}

/** The pixels counted under a pair of shifts, and how many of them match. */
interface Tally {
  shift: number;
  /** The swept axis's cells under `shift`. */
  cells: Int32Array;
  counted: number;
  matched: number;
}

/** Whether a's share of matches is above b's (exact: no division). */
function better(a: Tally, b: Tally): boolean {
  if (a.counted === 0) return false;
  if (b.counted === 0) return a.matched > 0;
  return a.matched * b.counted > b.matched * a.counted;
}

/**
 * The best shift of one axis's cells, the other axis's cells held as given
 * (`fixed`), starting from `current`, which a tie keeps. Every shift puts an
 * input coordinate a in output cell lo[a] or lo[a] + 1 (a cell is at least
 * as wide as the shifts span), so one pass over the image tallies, per
 * coordinate, its visible pixels and its matches against both, and each
 * shift then costs one pass along the axis, however wide the cells are.
 */
function bestShift(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
  alongX: boolean,
  fixed: Int32Array,
  current: number,
): Tally {
  const inSize = alongX ? inW : inH;
  const outSize = alongX ? outW : outH;
  const reach = maxShift(inSize, outSize);
  const lo = new Int32Array(inSize);
  for (let a = 0; a < inSize; a++) lo[a] = Math.floor(((a - reach) * outSize) / inSize);
  const visible = new Int32Array(inSize);
  const nearer = new Int32Array(inSize);
  const further = new Int32Array(inSize);
  if (alongX) {
    for (let y = 0; y < inH; y++) {
      if (fixed[y] < 0) continue;
      const row = fixed[y] * outW;
      for (let x = 0, i = y * inW * 4; x < inW; x++, i += 4) {
        if (input[i + 3] < VISIBLE_ALPHA) continue;
        const c = lo[x];
        visible[x]++;
        if (c >= 0 && reproduces(input, i, output, (row + c) * 4)) nearer[x]++;
        if (c + 1 < outW && reproduces(input, i, output, (row + c + 1) * 4)) further[x]++;
      }
    }
  } else {
    for (let y = 0; y < inH; y++) {
      const near = lo[y] >= 0 ? lo[y] * outW : -1;
      const far = lo[y] + 1 < outH ? (lo[y] + 1) * outW : -1;
      let v = 0;
      let n = 0;
      let f = 0;
      for (let x = 0, i = y * inW * 4; x < inW; x++, i += 4) {
        const cx = fixed[x];
        if (cx < 0 || input[i + 3] < VISIBLE_ALPHA) continue;
        v++;
        if (near >= 0 && reproduces(input, i, output, (near + cx) * 4)) n++;
        if (far >= 0 && reproduces(input, i, output, (far + cx) * 4)) f++;
      }
      visible[y] = v;
      nearer[y] = n;
      further[y] = f;
    }
  }
  const tally = (shift: number): Tally => {
    const cells = coreCells(inSize, outSize, shift);
    let counted = 0;
    let matched = 0;
    for (let a = 0; a < inSize; a++) {
      const c = cells[a];
      if (c < 0) continue;
      counted += visible[a];
      matched += c === lo[a] ? nearer[a] : further[a];
    }
    return { shift, cells, counted, matched };
  };
  let best = tally(current);
  for (let shift = -reach; shift <= reach; shift++) {
    if (shift === current) continue;
    const t = tally(shift);
    if (better(t, best)) best = t;
  }
  return best;
}

/** Sweeps of the coordinate search: x, y, x, y. It settles in two or three. */
const SHIFT_SWEEPS = 4;

/**
 * The share of the input's cell centers that the fixed image reproduces,
 * scored against the cells the art really has. The fixer cuts even cells
 * from the image's corner and gives each the color of the art's cell that
 * covers most of it, but the art's grid may start partway into a cell (an AI
 * image, a crop): so each axis's cell edges may move by whole px, up to half
 * a cell either way, and the best score over those shifts counts. The shifts
 * are found one axis at a time, x then y and again, until neither moves.
 * Only input pixels with alpha >= 128 away from their cell's edges count
 * (coreCells on both axes). One matches when its output cell has alpha >=
 * 128 and every RGB channel is within CELL_CENTER_TOLERANCE. 0 when nothing
 * counts: there is nothing to fix.
 */
export function cellCenterScore(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
): number {
  if (!(inW > 0 && inH > 0 && outW > 0 && outH > 0)) return 0;
  const shifts = [0, 0];
  let held = coreCells(inH, outH, 0);
  let best: Tally | null = null;
  for (let sweep = 0; sweep < SHIFT_SWEEPS; sweep++) {
    const axis = sweep % 2;
    const t = bestShift(input, inW, inH, output, outW, outH, axis === 0, held, shifts[axis]);
    const moved = t.shift !== shifts[axis];
    shifts[axis] = t.shift;
    best = t;
    held = t.cells;
    // The other axis was swept with these cells already.
    if (sweep > 0 && !moved) break;
  }
  return best && best.counted > 0 ? best.matched / best.counted : 0;
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
/** An edit came after the fix started (during the run, before Show anyway,
 *  or with the dialog open), so its result is dropped. */
export const FIX_GRID_CHANGED = 'The image changed, so the fix was dropped. Press Fix pixel grid again.';
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
