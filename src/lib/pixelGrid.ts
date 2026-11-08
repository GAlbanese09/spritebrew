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
 * whole px, up to half a cell either way (at least 1 px from steps of 1.5),
 * and the best pair of shifts counts, since the art's grid may start partway
 * into a cell. On a 0.005 grid, the lowest value at which wrong or clean
 * results pass on real sheets at most 20% of the time, offset grids and none
 * together (HQ's rule: refuse rather than offer a bad fix, and "Show anyway"
 * keeps a refusal one press from the dialog). A result is right when it is
 * the native size of the art it was given (a cell a crop cut at an image edge
 * may be kept or dropped) and at least 95% of the overlapping pixels equal
 * the native art; clean art is never right. Measured on Nov 8, 2026 on the
 * app's own path (PNG, the committed .wasm, decode, this guard) on 5,524
 * images the editor can open: the r1 set, and the same art cropped so its
 * grid starts a third and a half of a cell in, on x, y and both. Percent
 * passed, right / wrong or clean:
 *                     real sheets                                synthetic
 *                     together      no offset     offsets       together
 *   0.980             82.6 / 22.6   89.4 / 21.1   81.4 / 23.1   81.2 / 21.4
 *   0.985             77.9 / 12.8   87.9 / 12.6   76.0 / 12.8   75.3 / 18.2
 *   0.990             68.8 /  5.4   85.1 /  7.4   65.8 /  4.8   64.8 / 14.4
 *   commit 3, 0.985   77.8 / 12.8   87.9 / 12.6   75.9 / 12.8   74.5 / 18.0
 *   commit 2's guard  53.4 / 10.6   82.3 / 12.6   48.0 /  9.9   55.2 / 17.9
 * Commit 3 searched one axis at a time with half a cell, rounded down, of
 * reach (audit r3, findings 3 and 5).
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

/** How far an axis's cell edges may move: half a cell, in whole px, and at
 *  least 1 px from steps of 1.5, so x2 art cut by 1 px (cells of 2 px and
 *  one of 1 px) can still be lined up (audit r3, finding 5). */
function maxShift(inSize: number, outSize: number): number {
  const half = Math.floor(inSize / (2 * outSize));
  return half === 0 && 2 * inSize >= 3 * outSize ? 1 : half;
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

/** Whether a share of matches, matched of counted, is above best's (exact:
 *  no division). Nothing counted is never above; anything matched is above
 *  nothing counted. */
function better(counted: number, matched: number, best: { counted: number; matched: number }): boolean {
  if (counted === 0) return false;
  if (best.counted === 0) return matched > 0;
  return matched * best.counted > best.matched * counted;
}

/**
 * One axis of the search. Over every shift in range, the cells coreCells
 * gives an input coordinate a lie within lo[a] to lo[a] + 2: the shifts span
 * 2 x reach px, which cross at most one cell edge from steps of 2 (reach is
 * floor(step / 2)) and at most two below that (reach 1 from steps of 1.5,
 * cells of 1 or 2 px). A coordinate's place is its cell less lo[a] (0, 1 or
 * 2, and 2 only below a step of 2), or -1 when it is not counted. Kept: the
 * places at the first shift, -reach; which places each coordinate takes at
 * some shift (bits); and each change of place from one shift to the next,
 * which are few (a cell's core gains a coordinate at one end and loses one at
 * the other), so no shift rebuilds the axis.
 */
interface ShiftAxis {
  reach: number;
  lo: Int32Array;
  first: Int8Array;
  taken: Uint8Array;
  /** The changes from shift k - reach to k + 1 - reach are changes[ends[k]]
   *  up to changes[ends[k + 1]], as triples: coordinate, place before, place
   *  after. */
  ends: Int32Array;
  changes: Int32Array;
}

function shiftAxis(inSize: number, outSize: number): ShiftAxis {
  const reach = maxShift(inSize, outSize);
  const lo = new Int32Array(inSize);
  for (let a = 0; a < inSize; a++) lo[a] = Math.floor(((a - reach) * outSize) / inSize);
  const placesAt = (shift: number): Int8Array => {
    const cells = coreCells(inSize, outSize, shift);
    const places = new Int8Array(inSize);
    for (let a = 0; a < inSize; a++) places[a] = cells[a] < 0 ? -1 : cells[a] - lo[a];
    return places;
  };
  const first = placesAt(-reach);
  const taken = new Uint8Array(inSize);
  for (let a = 0; a < inSize; a++) if (first[a] >= 0) taken[a] |= 1 << first[a];
  const ends = new Int32Array(2 * reach + 1);
  const changes: number[] = [];
  let before = first;
  for (let k = 0; k < 2 * reach; k++) {
    const after = placesAt(k + 1 - reach);
    for (let a = 0; a < inSize; a++) {
      if (after[a] === before[a]) continue;
      changes.push(a, before[a], after[a]);
      if (after[a] >= 0) taken[a] |= 1 << after[a];
    }
    ends[k + 1] = changes.length;
    before = after;
  }
  return { reach, lo, first, taken, ends, changes: Int32Array.from(changes) };
}

/** A pixel's code in the search: this bit when it counts (alpha >= 128, on a
 *  row and a column some shift counts), and bit 3 x py + px when the output
 *  cell at its row's place py and its column's place px reproduces it. */
const COUNTS = 1 << 9;

/** The best pair of shifts, with the pixels counted and matched there. */
interface Shifts {
  shiftX: number;
  shiftY: number;
  counted: number;
  matched: number;
}

/**
 * The best pair of shifts over the whole range, exactly: every y shift, each
 * with its best x shift (audit r3, finding 3: a search one axis at a time
 * could stop on a local peak). Each pixel is compared once with each output
 * cell its row and column can take. For the y shift at hand, each column
 * keeps its counted pixels and its matches at each of its places; a y shift
 * moves only the rows that change place, and an x shift only the columns
 * that do. So each pixel is compared with at most four output cells (nine
 * below a step of 2), the cost hardly depends on the step, and the tallies
 * are the rule's own counts: the result always equals cellScoreAt at the
 * shifts it gives. The first best pair found is kept.
 */
function bestShifts(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
): Shifts {
  const ax = shiftAxis(inW, outW);
  const ay = shiftAxis(inH, outH);
  const codes = new Uint16Array(inW * inH);
  for (let y = 0; y < inH; y++) {
    const rows = ay.taken[y];
    if (rows === 0) continue;
    for (let x = 0, i = y * inW * 4; x < inW; x++, i += 4) {
      const cols = ax.taken[x];
      if (cols === 0 || input[i + 3] < VISIBLE_ALPHA) continue;
      let code = COUNTS;
      for (let py = 0; py < 3; py++) {
        if ((rows & (1 << py)) === 0) continue;
        const cell = (ay.lo[y] + py) * outW + ax.lo[x];
        for (let px = 0; px < 3; px++) {
          if ((cols & (1 << px)) !== 0 && reproduces(input, i, output, (cell + px) * 4)) code |= 1 << (3 * py + px);
        }
      }
      codes[y * inW + x] = code;
    }
  }
  const counts = new Int32Array(inW);
  const matches = new Int32Array(3 * inW);
  const addRow = (y: number, py: number, by: number) => {
    for (let x = 0, k = y * inW; x < inW; x++, k++) {
      const code = codes[k];
      if (code === 0) continue;
      const bits = code >> (3 * py);
      counts[x] += by;
      matches[3 * x] += by * (bits & 1);
      matches[3 * x + 1] += by * ((bits >> 1) & 1);
      matches[3 * x + 2] += by * ((bits >> 2) & 1);
    }
  };
  let best: Shifts = { shiftX: 0, shiftY: 0, counted: 0, matched: 0 };
  const scanX = (shiftY: number) => {
    let counted = 0;
    let matched = 0;
    for (let x = 0; x < inW; x++) {
      const p = ax.first[x];
      if (p < 0) continue;
      counted += counts[x];
      matched += matches[3 * x + p];
    }
    if (better(counted, matched, best)) best = { shiftX: -ax.reach, shiftY, counted, matched };
    for (let k = 0; k < 2 * ax.reach; k++) {
      for (let c = ax.ends[k]; c < ax.ends[k + 1]; c += 3) {
        const x = ax.changes[c];
        const was = ax.changes[c + 1];
        const now = ax.changes[c + 2];
        if (was >= 0) {
          counted -= counts[x];
          matched -= matches[3 * x + was];
        }
        if (now >= 0) {
          counted += counts[x];
          matched += matches[3 * x + now];
        }
      }
      if (better(counted, matched, best)) best = { shiftX: k + 1 - ax.reach, shiftY, counted, matched };
    }
  };
  for (let y = 0; y < inH; y++) if (ay.first[y] >= 0) addRow(y, ay.first[y], 1);
  scanX(-ay.reach);
  for (let k = 0; k < 2 * ay.reach; k++) {
    for (let c = ay.ends[k]; c < ay.ends[k + 1]; c += 3) {
      const y = ay.changes[c];
      if (ay.changes[c + 1] >= 0) addRow(y, ay.changes[c + 1], -1);
      if (ay.changes[c + 2] >= 0) addRow(y, ay.changes[c + 2], 1);
    }
    scanX(k + 1 - ay.reach);
  }
  return best;
}

/**
 * The share of the input's cell centers that the fixed image reproduces,
 * scored against the cells the art really has, and the shifts that give it.
 * The fixer cuts even cells from the image's corner and gives each the color
 * of the art's cell that covers most of it, but the art's grid may start
 * partway into a cell (an AI image, a crop, a padded edge): so each axis's
 * cell edges may move by whole px, up to half a cell either way (maxShift),
 * and the best score over every pair of shifts counts (bestShifts). Only
 * input pixels with alpha >= 128 away from their cell's edges count
 * (coreCells on both axes). One matches when its output cell has alpha >=
 * 128 and every RGB channel is within CELL_CENTER_TOLERANCE. A score of 0
 * when nothing counts: there is nothing to fix.
 */
export function cellCenterSearch(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
): { score: number; shiftX: number; shiftY: number } {
  if (!(inW > 0 && inH > 0 && outW > 0 && outH > 0)) return { score: 0, shiftX: 0, shiftY: 0 };
  const best = bestShifts(input, inW, inH, output, outW, outH);
  return { score: best.counted > 0 ? best.matched / best.counted : 0, shiftX: best.shiftX, shiftY: best.shiftY };
}

/** cellCenterSearch's score: what the guard compares with CELL_CENTER_MIN. */
export function cellCenterScore(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
): number {
  return cellCenterSearch(input, inW, inH, output, outW, outH).score;
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
