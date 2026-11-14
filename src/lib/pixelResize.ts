/**
 * The pixel-art resize engine (DESIGN, design/tickets/editor-tools-batch.md
 * v4.1, B2 to B4; HQ 2026-11-14-160 and -170). One library for every door:
 * the editor's Resize and Canvas size, the download size pills, /export,
 * /upload's resizer and the free /resize page.
 *
 * Never smooths. Every size, down or up, whole factor or not, goes through
 * one mapping (sourceIndex) in integer maths, so a pixel is always a copy of
 * one source pixel. A fully transparent pixel stays fully transparent.
 *
 * Pure: it imports nothing, keeps no state between calls, never reads the
 * page and never changes the image it is given. So it runs the same in
 * node, in the page and in a worker (/resize runs it in one for large
 * images). Images are plain { width, height, data }, the shape of ImageData:
 * `ctx.getImageData(0, 0, w, h)` goes in as it is, and a result goes back
 * with `new ImageData(out.data, out.width, out.height)`.
 *
 * Tested in scripts/pixel-resize-test.mjs.
 */

/** RGBA, row by row, 4 bytes a pixel: the shape of ImageData. */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A sheet: frames of one size in a grid, no gaps, no margin. */
export interface SheetGrid {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

/** The editor's load cap, a side. */
export const EDITOR_SIDE_CAP = 1024;
/** Downloads and /resize, a side (4096 by 4096 is allowed). */
export const DOWNLOAD_SIDE_CAP = 4096;

/** The whole divisors offered for a smaller size, and the multipliers for a
 *  bigger one (B2). */
const DOWN_FACTORS: readonly number[] = Object.freeze([2, 3, 4, 5, 6, 7, 8]);
const UP_FACTORS: readonly number[] = Object.freeze([2, 4, 8]);
/** A smaller size is offered only if the unit's smaller side keeps at least
 *  this many pixels (B2). */
const SMALLEST_OFFERED_SIDE = 8;

/** Is this a size or a count the engine accepts: a whole number, at least
 *  1? A door that takes typed sizes calls it first; every function here
 *  refuses anything else with a RangeError. */
export function isWholeSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function assertWhole(name: string, value: unknown, unit: 'px' | 'count'): void {
  if (!isWholeSize(value)) {
    const what = unit === 'px' ? 'a whole number of pixels' : 'a whole number';
    throw new RangeError(`${name} must be ${what}, at least 1 (got ${JSON.stringify(value) ?? String(value)})`);
  }
}
const assertSide = (name: string, value: unknown): void => assertWhole(name, value, 'px');
const assertCount = (name: string, value: unknown): void => assertWhole(name, value, 'count');

function assertImage(image: PixelImage): void {
  if (image === null || typeof image !== 'object' || !(image.data instanceof Uint8ClampedArray)) {
    throw new RangeError('the image must be { width, height, data } with data a Uint8ClampedArray');
  }
  assertSide('width', image.width);
  assertSide('height', image.height);
  if (image.data.length !== image.width * image.height * 4) {
    throw new RangeError(`data holds ${image.data.length} bytes; a ${image.width} by ${image.height} image needs ${image.width * image.height * 4}`);
  }
}

function assertGrid(image: PixelImage, grid: SheetGrid): void {
  assertSide('frameWidth', grid.frameWidth);
  assertSide('frameHeight', grid.frameHeight);
  assertCount('columns', grid.columns);
  assertCount('rows', grid.rows);
  if (grid.frameWidth * grid.columns !== image.width || grid.frameHeight * grid.rows !== image.height) {
    throw new RangeError(
      `a grid of ${grid.columns} by ${grid.rows} frames of ${grid.frameWidth} by ${grid.frameHeight} px does not fill a ${image.width} by ${image.height} px image exactly`,
    );
  }
}

/**
 * B2's one mapping on one axis: destination pixel i of `dest` takes this
 * source pixel of `src`: ceil((i + 0.5) * src / dest) - 1, clamped to
 * 0..src-1, worked out in whole numbers. At a whole factor k down it is the
 * block's centre pixel, index floor((k - 1) / 2) in each block (for an even
 * k, the upper-left of the middle four). At a whole factor up it makes k by
 * k blocks.
 */
export function sourceIndex(i: number, dest: number, src: number): number {
  // ceil(a / b) for whole a >= 0, b > 0 is floor((a + b - 1) / b);
  // (i + 0.5) * src / dest = (2i + 1) * src / (2 * dest).
  const a = (2 * i + 1) * src;
  const b = 2 * dest;
  const index = Math.floor((a + b - 1) / b) - 1;
  return index < 0 ? 0 : index > src - 1 ? src - 1 : index;
}

/** The source index of every destination pixel on one axis. */
function axisMap(dest: number, src: number): Int32Array {
  const map = new Int32Array(dest);
  for (let i = 0; i < dest; i++) map[i] = sourceIndex(i, dest, src);
  return map;
}

/** Copies a region at (sx, sy) of `from` into a region at (dx, dy) of `to`
 *  by the one mapping; the axis maps (from axisMap) set both sizes. */
function resizeRegion(
  from: PixelImage, sx: number, sy: number,
  to: PixelImage, dx: number, dy: number, mapX: Int32Array, mapY: Int32Array,
): void {
  const destW = mapX.length;
  const destH = mapY.length;
  const src = from.data;
  const out = to.data;
  for (let y = 0; y < destH; y++) {
    const srcRow = (sy + mapY[y]) * from.width;
    const outRow = (dy + y) * to.width;
    for (let x = 0; x < destW; x++) {
      const s = (srcRow + sx + mapX[x]) * 4;
      const o = (outRow + dx + x) * 4;
      out[o] = src[s];
      out[o + 1] = src[s + 1];
      out[o + 2] = src[s + 2];
      out[o + 3] = src[s + 3];
    }
  }
}

/**
 * Any size, down or up, whole factor or not, by B2's one mapping. Never
 * smooths: each pixel is a copy of one source pixel, so a fully transparent
 * pixel stays fully transparent (its RGB is copied as it is).
 *
 * Throws a RangeError when the image is not well formed (missing, `data`
 * not a Uint8ClampedArray, a side under 1 or not whole, or `data` of the
 * wrong length) or `width` or `height` is under 1 or not whole. It checks
 * no cap: the caller does (passesCap).
 */
export function resizeImage(image: PixelImage, width: number, height: number): PixelImage {
  assertImage(image);
  assertSide('width', width);
  assertSide('height', height);
  const out: PixelImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  resizeRegion(image, 0, 0, out, 0, 0, axisMap(width, image.width), axisMap(height, image.height));
  return out;
}

/**
 * Every frame of a sheet resized to a new frame size; columns and rows
 * stay, and no frame takes a pixel from its neighbour. Frame by frame, the
 * one mapping gives exactly the pixels it gives on the whole sheet at its
 * new total size, because it shifts by whole frames: for frame f of S
 * pixels made D wide, ceil(((2(fD + j) + 1) S) / 2D) - 1 is
 * fS + ceil(((2j + 1) S) / 2D) - 1. So the sheet is resized whole, with the
 * axis maps made once (the test holds the frame-by-frame reading to it).
 * Throws a RangeError when the grid does not fill the image exactly, and as
 * resizeImage does. It checks no cap.
 */
export function resizeSheet(image: PixelImage, grid: SheetGrid, frameWidth: number, frameHeight: number): PixelImage {
  assertImage(image);
  assertGrid(image, grid);
  assertSide('frameWidth', frameWidth);
  assertSide('frameHeight', frameHeight);
  return resizeImage(image, frameWidth * grid.columns, frameHeight * grid.rows);
}

/**
 * Does a size fit under a side cap? `width` and `height` are the unit's
 * (the frame's, for a sheet); `columns` and `rows` (default 1) say how many
 * units make the whole image. A side equal to the cap fits.
 */
export function passesCap(width: number, height: number, sideCap: number, columns = 1, rows = 1): boolean {
  assertSide('width', width);
  assertSide('height', height);
  assertSide('sideCap', sideCap);
  assertCount('columns', columns);
  assertCount('rows', rows);
  return width * columns <= sideCap && height * rows <= sideCap;
}

/** A choice in the size rows. width and height are the unit's (the frame's,
 *  for a sheet). */
export interface SizeChoice {
  width: number;
  height: number;
  direction: 'down' | 'same' | 'up';
  /** 1 for 'same'; the whole divisor (2 to 8) or the multiplier (2, 4, 8). */
  factor: number;
  /** The whole image at this size would pass the side cap. Marked on
   *  'same' too, when the start is already over it; what a door does then
   *  is DESIGN's rule (AUDIT pixel-resize r1, L3). */
  overCap: boolean;
}

/**
 * B2's choices for a start size: 'same' first, then each whole divisor from
 * 2 to 8 that divides both sides evenly and leaves at least 8 px on the
 * smaller side (largest first), then 2x, 4x and 8x. `columns` and `rows`
 * (default 1) say how many units make the whole image, for the cap.
 */
export function sizeChoices(width: number, height: number, sideCap: number, columns = 1, rows = 1): SizeChoice[] {
  assertSide('width', width);
  assertSide('height', height);
  assertSide('sideCap', sideCap);
  assertCount('columns', columns);
  assertCount('rows', rows);
  const choice = (w: number, h: number, direction: SizeChoice['direction'], factor: number): SizeChoice => ({
    width: w, height: h, direction, factor, overCap: !passesCap(w, h, sideCap, columns, rows),
  });
  const out: SizeChoice[] = [choice(width, height, 'same', 1)];
  for (const k of DOWN_FACTORS) {
    if (width % k !== 0 || height % k !== 0) continue;
    if (Math.min(width, height) / k < SMALLEST_OFFERED_SIDE) continue;
    out.push(choice(width / k, height / k, 'down', k));
  }
  for (const k of UP_FACTORS) out.push(choice(width * k, height * k, 'up', k));
  return out;
}

/** Is (width, height) a whole factor of the start, the same factor on both
 *  sides? Any whole factor counts here, not only those sizeChoices offers.
 *  null if not. Refuses a size that is not whole, as the resize does. */
export function wholeFactor(
  startWidth: number, startHeight: number, width: number, height: number,
): { direction: 'down' | 'same' | 'up'; factor: number } | null {
  assertSizes(startWidth, startHeight, width, height);
  if (width === startWidth && height === startHeight) return { direction: 'same', factor: 1 };
  if (width < startWidth && height < startHeight && startWidth % width === 0 && startHeight % height === 0) {
    const k = startWidth / width;
    return startHeight / height === k ? { direction: 'down', factor: k } : null;
  }
  if (width > startWidth && height > startHeight && width % startWidth === 0 && height % startHeight === 0) {
    const k = width / startWidth;
    return height / startHeight === k ? { direction: 'up', factor: k } : null;
  }
  return null;
}

function assertSizes(startWidth: number, startHeight: number, width: number, height: number): void {
  assertSide('start width', startWidth);
  assertSide('start height', startHeight);
  assertSide('width', width);
  assertSide('height', height);
}

/** One axis of a size change: which way it goes, and whether it is a whole
 *  factor (every source pixel kept or dropped evenly, or made exactly k
 *  wide). `factor` is the whole divisor or multiplier when `exact`, 1 for
 *  'same', and null otherwise. */
export interface AxisChange {
  direction: 'down' | 'same' | 'up';
  exact: boolean;
  factor: number | null;
}

export function axisChange(start: number, size: number): AxisChange {
  assertSide('start', start);
  assertSide('size', size);
  if (size === start) return { direction: 'same', exact: true, factor: 1 };
  if (size < start) return start % size === 0 ? { direction: 'down', exact: true, factor: start / size } : { direction: 'down', exact: false, factor: null };
  return size % start === 0 ? { direction: 'up', exact: true, factor: size / start } : { direction: 'up', exact: false, factor: null };
}

/** Both axes of a size change, for warnings worded per axis (64 by 64 to
 *  64 by 32 changes the shape, though each axis is exact). */
export function sizeChange(startWidth: number, startHeight: number, width: number, height: number): { width: AxisChange; height: AxisChange } {
  assertSizes(startWidth, startHeight, width, height);
  return { width: axisChange(startWidth, width), height: axisChange(startHeight, height) };
}

/** What "Other size" is, for its warning (B2):
 *  'clean': a whole factor of the start, the same on both sides (or the start itself);
 *  'uneven-down': smaller or equal on both sides, and neither clean nor stretched;
 *  'uneven-up': larger or equal on both sides, and neither clean nor stretched;
 *  'stretched': each side by a whole factor (or unchanged), but not the same one, so the art
 *    changes shape and nothing is dropped unevenly (DESIGN room 2026-11-14-249, item 1);
 *  'uneven-mixed': one side smaller and the other larger, not both exact. */
export type SizeKind = 'clean' | 'stretched' | 'uneven-down' | 'uneven-up' | 'uneven-mixed';

export function classifySize(startWidth: number, startHeight: number, width: number, height: number): SizeKind {
  assertSizes(startWidth, startHeight, width, height);
  if (wholeFactor(startWidth, startHeight, width, height) !== null) return 'clean';
  if (axisChange(startWidth, width).exact && axisChange(startHeight, height).exact) return 'stretched';
  if (width <= startWidth && height <= startHeight) return 'uneven-down';
  if (width >= startWidth && height >= startHeight) return 'uneven-up';
  return 'uneven-mixed';
}

/** Does the start have any clean smaller size that sizeChoices offers? (B2:
 *  "97 px has no clean smaller size.") */
export function hasCleanSmaller(startWidth: number, startHeight: number): boolean {
  assertSide('start width', startWidth);
  assertSide('start height', startHeight);
  return sizeChoices(startWidth, startHeight, Number.MAX_SAFE_INTEGER).some((c) => c.direction === 'down');
}

/**
 * For "Other size": the nearest offered choices either side of a size that
 * is not clean. `smaller` is the largest choice that fits inside it on both
 * sides; `larger` the smallest that covers it on both sides (which may be
 * the start itself, 'same'). A choice over the cap is never returned.
 * Either may be null.
 */
export function nearestCleanSizes(
  startWidth: number, startHeight: number, width: number, height: number,
  sideCap: number, columns = 1, rows = 1,
): { smaller: SizeChoice | null; larger: SizeChoice | null } {
  assertSizes(startWidth, startHeight, width, height);
  const choices = sizeChoices(startWidth, startHeight, sideCap, columns, rows).filter((c) => !c.overCap);
  let smaller: SizeChoice | null = null;
  let larger: SizeChoice | null = null;
  for (const c of choices) {
    if (c.width === width && c.height === height) continue;
    if (c.width <= width && c.height <= height && (smaller === null || c.width > smaller.width)) smaller = c;
    if (c.width >= width && c.height >= height && (larger === null || c.width < larger.width)) larger = c;
  }
  return { smaller, larger };
}

const FRACTION_WORDS: Readonly<Record<number, string>> = Object.freeze({
  2: 'half', 3: 'a third', 4: 'a quarter', 5: 'a fifth', 6: 'a sixth', 7: 'a seventh', 8: 'an eighth',
});

/** A size in words: "64 px", or "24 by 32 px" for a unit that is not square. */
export function sizeText(width: number, height: number): string {
  return width === height ? `${width} px` : `${width} by ${height} px`;
}

/**
 * B5's words for a choice, one place for every door, so the dialog, the
 * download pills and /resize cannot drift: 'same' reads "64 px, as is" in
 * the resize dialog and on /resize, and "As made (64 px)" on a download;
 * down "32 px, half", "a third" and so on to "an eighth"; up "2x", under
 * the row's own label "Bigger, for posting". A unit that is not square
 * reads "24 by 32 px, half".
 */
export function sizeChoiceLabel(choice: SizeChoice, door: 'resize' | 'download' = 'resize'): string {
  const size = sizeText(choice.width, choice.height);
  if (choice.direction === 'same') return door === 'download' ? `As made (${size})` : `${size}, as is`;
  if (choice.direction === 'up') return `${choice.factor}x`;
  return `${size}, ${FRACTION_WORDS[choice.factor] ?? `1/${choice.factor}`}`;
}

/** Canvas size (no scaling): where the old image sits in the new canvas. */
export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

/** The nine anchors, by name. */
export const ANCHORS: readonly Anchor[] = Object.freeze([
  'top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right',
] as Anchor[]);

/** Where an anchor holds the art on each axis: 'start' (left or top),
 *  'center' or 'end' (right or bottom). Throws a RangeError on a name
 *  outside the nine. Canvas size uses it, and so can a door wording B5's
 *  lines with canvasShare. */
export function anchorSides(anchor: Anchor): { x: 'start' | 'center' | 'end'; y: 'start' | 'center' | 'end' } {
  if (!ANCHORS.includes(anchor)) throw new RangeError(`anchor must be one of ${ANCHORS.join(', ')} (got ${JSON.stringify(anchor) ?? String(anchor)})`);
  const x = anchor.endsWith('left') ? 'start' : anchor.endsWith('right') ? 'end' : 'center';
  const y = anchor.startsWith('top') ? 'start' : anchor.startsWith('bottom') ? 'end' : 'center';
  return { x, y };
}

/**
 * How a change of one axis is shared: pixels added (positive) or trimmed
 * (negative) before (left or top) and after (right or bottom). Anchored at
 * the start, it all goes after; at the end, before; at the centre, half
 * each, and an odd pixel goes after (right, down), for adding and trimming
 * alike (B3).
 */
export function canvasShare(oldSize: number, newSize: number, at: 'start' | 'center' | 'end'): { before: number; after: number } {
  assertSide('old size', oldSize);
  assertSide('new size', newSize);
  if (at !== 'start' && at !== 'center' && at !== 'end') throw new RangeError(`at must be start, center or end (got ${JSON.stringify(at) ?? String(at)})`);
  const d = newSize - oldSize;
  if (at === 'start') return { before: 0, after: d };
  if (at === 'end') return { before: d, after: 0 };
  const before = Math.trunc(d / 2);
  return { before, after: d - before };
}

/** Copies one frame onto a transparent frame of the new size, at the
 *  anchor's offset, clipped. */
function placeRegion(
  from: PixelImage, sx: number, sy: number, oldW: number, oldH: number,
  to: PixelImage, dx: number, dy: number, newW: number, newH: number, anchor: Anchor,
): void {
  const { x, y } = anchorSides(anchor);
  const offX = canvasShare(oldW, newW, x).before;
  const offY = canvasShare(oldH, newH, y).before;
  for (let row = 0; row < newH; row++) {
    const oy = row - offY;
    if (oy < 0 || oy >= oldH) continue;
    for (let col = 0; col < newW; col++) {
      const ox = col - offX;
      if (ox < 0 || ox >= oldW) continue;
      const s = ((sy + oy) * from.width + sx + ox) * 4;
      const o = ((dy + row) * to.width + dx + col) * 4;
      to.data[o] = from.data[s];
      to.data[o + 1] = from.data[s + 1];
      to.data[o + 2] = from.data[s + 2];
      to.data[o + 3] = from.data[s + 3];
    }
  }
}

/** Canvas size: adds transparent space or trims, without scaling, around
 *  the anchor. Throws as resizeImage does; checks no cap. */
export function resizeCanvas(image: PixelImage, width: number, height: number, anchor: Anchor): PixelImage {
  assertImage(image);
  assertSide('width', width);
  assertSide('height', height);
  anchorSides(anchor);
  const out: PixelImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  placeRegion(image, 0, 0, image.width, image.height, out, 0, 0, width, height, anchor);
  return out;
}

/** The same for every frame of a sheet; width and height are per frame,
 *  columns and rows stay. Throws when the grid does not fill the image. */
export function resizeCanvasSheet(
  image: PixelImage, grid: SheetGrid, frameWidth: number, frameHeight: number, anchor: Anchor,
): PixelImage {
  assertImage(image);
  assertGrid(image, grid);
  assertSide('frameWidth', frameWidth);
  assertSide('frameHeight', frameHeight);
  anchorSides(anchor);
  const out: PixelImage = {
    width: frameWidth * grid.columns,
    height: frameHeight * grid.rows,
    data: new Uint8ClampedArray(frameWidth * grid.columns * frameHeight * grid.rows * 4),
  };
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.columns; col++) {
      placeRegion(
        image, col * grid.frameWidth, row * grid.frameHeight, grid.frameWidth, grid.frameHeight,
        out, col * frameWidth, row * frameHeight, frameWidth, frameHeight, anchor,
      );
    }
  }
  return out;
}

/**
 * The sides where a trim would cut a pixel that is not fully transparent,
 * for "This cuts into the art on the {side}." For a sheet (`grid` given),
 * width and height are per frame and every frame is looked at. Sides in the
 * order left, right, top, bottom; empty when nothing is cut.
 */
export function trimCuts(
  image: PixelImage, width: number, height: number, anchor: Anchor, grid?: SheetGrid,
): Array<'left' | 'right' | 'top' | 'bottom'> {
  assertImage(image);
  assertSide('width', width);
  assertSide('height', height);
  const g: SheetGrid = grid ?? { frameWidth: image.width, frameHeight: image.height, columns: 1, rows: 1 };
  assertGrid(image, g);
  const { x, y } = anchorSides(anchor);
  const sx = canvasShare(g.frameWidth, width, x);
  const sy = canvasShare(g.frameHeight, height, y);
  // Each side's band of the old frame that the trim removes: [from, to).
  const bands = {
    left: sx.before < 0 ? { x0: 0, x1: -sx.before, y0: 0, y1: g.frameHeight } : null,
    right: sx.after < 0 ? { x0: g.frameWidth + sx.after, x1: g.frameWidth, y0: 0, y1: g.frameHeight } : null,
    top: sy.before < 0 ? { x0: 0, x1: g.frameWidth, y0: 0, y1: -sy.before } : null,
    bottom: sy.after < 0 ? { x0: 0, x1: g.frameWidth, y0: g.frameHeight + sy.after, y1: g.frameHeight } : null,
  };
  const cut: Array<'left' | 'right' | 'top' | 'bottom'> = [];
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const band = bands[side];
    if (band === null) continue;
    let found = false;
    for (let row = 0; row < g.rows && !found; row++) {
      for (let col = 0; col < g.columns && !found; col++) {
        for (let py = Math.max(0, band.y0); py < Math.min(g.frameHeight, band.y1) && !found; py++) {
          const lineStart = (row * g.frameHeight + py) * image.width + col * g.frameWidth;
          for (let px = Math.max(0, band.x0); px < Math.min(g.frameWidth, band.x1); px++) {
            if (image.data[(lineStart + px) * 4 + 3] !== 0) { found = true; break; }
          }
        }
      }
    }
    if (found) cut.push(side);
  }
  return cut;
}

/** The rows and columns picker: every pair of counts that divides both
 *  sides evenly, so every frame is whole pixels; 1 by 1 is left out.
 *  Ordered by columns, then rows. */
export function wholeGrids(width: number, height: number): Array<{ columns: number; rows: number }> {
  assertSide('width', width);
  assertSide('height', height);
  const divisors = (n: number): number[] => {
    const out: number[] = [];
    for (let d = 1; d <= n; d++) if (n % d === 0) out.push(d);
    return out;
  };
  const out: Array<{ columns: number; rows: number }> = [];
  for (const columns of divisors(width)) {
    for (const rows of divisors(height)) {
      if (columns === 1 && rows === 1) continue;
      out.push({ columns, rows });
    }
  }
  return out;
}
