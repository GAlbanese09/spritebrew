import { SLICER_DETECT_TRY_SIZES } from '@/lib/constants';

// Same opacity threshold detectFrameGrid uses for its gutter scan.
const ALPHA_THRESHOLD = 10;

/** How far from a grid line, in px, a clear gap still counts as that line:
 *  4 px for cells of 64 px and more, less for small cells (2 at 32). */
function lineTolerance(cell: number): number {
  return Math.min(4, Math.floor(cell / 16));
}

type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/**
 * Memo for the spill walks of one detection pass. For each grid line, side
 * and tolerance there is one band: the columns (or rows) within the
 * tolerance of the line on that side, by the image's length along the line.
 * A walk visits a band pixel at most once in the whole pass and marks it as
 * part of something that stays within the band (1) or reaches past it (-1),
 * so a long bar beside a line is walked once, not once per edge and
 * crossing, and the work stays in proportion to the bands (Second 060).
 * walked counts the band pixels visited, which the tests read.
 */
type Band = { lo: number; hi: number; span: number; marks: Int8Array; opaque: Uint8Array };
export type SpillMemo = { bands: Map<number, Band>; walked: number };

export function newSpillMemo(): SpillMemo {
  return { bands: new Map(), walked: 0 };
}

/**
 * The band of the line at pos on one side: pos..pos + tol - 1 on the far
 * side, pos - tol..pos - 1 on the near side. Its opacity is copied once, in
 * one sweep along the line, with the column (or row) just past the band
 * after it, so the walks read a small local copy instead of the image.
 */
function bandFor(img: Pixels, memo: SpillMemo, vertical: boolean, pos: number, tol: number, far: boolean): Band {
  const key = ((pos * 8 + tol) * 2 + (vertical ? 1 : 0)) * 2 + (far ? 1 : 0);
  let band = memo.bands.get(key);
  if (!band) {
    const { width, height, data } = img;
    const span = vertical ? height : width;
    const limit = vertical ? width : height;
    const lo = far ? pos : pos - tol;
    const hi = lo + tol - 1;
    const past = far ? hi + 1 : lo - 1;
    const opaque = new Uint8Array((tol + 1) * span);
    for (let l = 0; l < span; l++) {
      for (let k = 0; k <= tol; k++) {
        const a = k < tol ? lo + k : past;
        if (a < 0 || a >= limit) continue;
        if (data[vertical ? (l * width + a) * 4 + 3 : (a * width + l) * 4 + 3] > ALPHA_THRESHOLD) opaque[k * span + l] = 1;
      }
    }
    band = { lo, hi, span, marks: new Int8Array(tol * span), opaque };
    memo.bands.set(key, band);
  }
  return band;
}

/**
 * Unforgiven cuts along one cell's edge on a grid line: the pixels just left
 * of the vertical line at x = pos (over rows from to to - 1), or just above
 * the horizontal line at y = pos (over columns from to to - 1), that touch an
 * opaque pixel just across it, straight across or diagonally. Diagonal
 * neighbours count because the slicer's own sprite detection joins them, so
 * a line through a one-pixel diagonal weapon cuts it.
 *
 * 0 when there are none, or when every crossing is a spill: a sprite
 * reaching a few pixels past its cell line, with a clear column (or row)
 * within tol px of the line over this edge, and, for each crossing, either
 * everything it touches across the line or everything it joins on its own
 * side, followed across other edges too, within tol px of the line. Every
 * pixel it touches across the line is followed, not only the first: a
 * one-pixel spur beside a weapon does not hide the weapon (Second 060). A
 * weapon that passes through a grid corner and runs on for thirty pixels is
 * not a spill, however clear this edge's own columns are (Second 059); feet
 * two pixels into the row below are.
 */
function edgeCuts(
  img: Pixels,
  vertical: boolean,
  pos: number,
  from: number,
  to: number,
  tol: number,
  memo: SpillMemo = newSpillMemo()
): number {
  const { width, height, data } = img;
  const span = vertical ? height : width;
  const limit = vertical ? width : height;
  const end = Math.min(to, span);
  // Alpha byte offsets: one step along the line, one step across it.
  const along = vertical ? width * 4 : 4;
  const across = vertical ? 4 : width * 4;
  const alphaAt = (a: number, l: number) => (vertical ? (l * width + a) * 4 + 3 : (a * width + l) * 4 + 3);
  // Each crossing is stored as t * 8 + the far pixels it touches: bit 0 for
  // u = t - 1, bit 1 for u = t, bit 2 for u = t + 1. farBits keeps those of
  // the last row with a near pixel, so a run of rows reads each far pixel once.
  let crossings: Int32Array | null = null;
  let cuts = 0;
  let farBits = 0;
  let last = -2;
  for (let t = from, near = alphaAt(pos - 1, from); t < end; t++, near += along) {
    if (data[near] <= ALPHA_THRESHOLD) continue;
    const farI = near + across;
    if (last === t - 1) {
      farBits >>= 1;
    } else {
      farBits = 0;
      if (t > 0 && data[farI - along] > ALPHA_THRESHOLD) farBits |= 1;
      if (data[farI] > ALPHA_THRESHOLD) farBits |= 2;
    }
    if (t + 1 < span && data[farI + along] > ALPHA_THRESHOLD) farBits |= 4;
    last = t;
    if (farBits === 0) continue;
    if (!crossings) crossings = new Int32Array(end - t);
    crossings[cuts++] = t * 8 + farBits;
  }
  if (!crossings) return 0;
  // With no tolerance (cells under 16 px) nothing is a spill.
  if (tol < 1) return cuts;
  let gap = false;
  for (let g = Math.max(0, pos - 1 - tol); g <= Math.min(limit - 1, pos + tol) && !gap; g++) {
    let clear = true;
    for (let t = from, i = alphaAt(g, from); t < end && clear; t++, i += along) clear = data[i] <= ALPHA_THRESHOLD;
    gap = clear;
  }
  if (!gap) return cuts;
  // The far band starts at the line, so the pixel at (pos, u) is marks[u];
  // the near pixel at (pos - 1, t) is marks[(tol - 1) * span + t].
  const farBand = bandFor(img, memo, vertical, pos, tol, true);
  let nearBand: Band | null = null;
  for (let i = 0; i < cuts; i++) {
    const t = crossings[i] >> 3;
    const bits = crossings[i] & 7;
    let farStays = true;
    for (let k = 0; k < 3 && farStays; k++) {
      if ((bits & (1 << k)) === 0) continue;
      const u = t - 1 + k;
      const m = farBand.marks[u];
      farStays = m === 1 || (m === 0 && staysWithin(pos, u, farBand, true, memo));
    }
    if (farStays) continue;
    if (!nearBand) nearBand = bandFor(img, memo, vertical, pos, tol, false);
    const m = nearBand.marks[(tol - 1) * span + t];
    if (m === 1 || (m === 0 && staysWithin(pos - 1, t, nearBand, false, memo))) continue;
    return cuts;
  }
  return 0;
}

/**
 * True when every opaque pixel joined (eight-connected) to the opaque pixel
 * at (across0, along0) on its side of the line stays within the band: the
 * far side when far is true (an opaque pixel just past band.hi fails), the
 * near side otherwise (one just before band.lo fails). across is the
 * coordinate across the line (x for a vertical line), along the one along
 * it. The walk reads the band's copy, crosses cell edges freely, stops at the
 * first pixel an earlier walk judged, and marks its answer on every band
 * pixel it visited.
 */
function staysWithin(across0: number, along0: number, band: Band, far: boolean, memo: SpillMemo): boolean {
  const { lo, hi, span, marks, opaque } = band;
  const first = (across0 - lo) * span + along0;
  if (marks[first] === 1) return true;
  if (marks[first] === -1) return false;
  const past = (hi - lo + 1) * span;
  // Marked pixels are opaque: 2 while this walk is on them, then 1 or -1.
  const visited = [first];
  const stack = [across0, along0];
  marks[first] = 2;
  let result = true;
  walk: while (stack.length > 0) {
    const along = stack.pop() as number;
    const across = stack.pop() as number;
    for (let da = -1; da <= 1; da++) {
      const na = across + da;
      if (far ? na < lo : na > hi) continue;
      const inBand = na >= lo && na <= hi;
      for (let dl = -1; dl <= 1; dl++) {
        const nl = along + dl;
        if ((da === 0 && dl === 0) || nl < 0 || nl >= span) continue;
        if (!inBand) {
          if (opaque[past + nl]) {
            result = false;
            break walk;
          }
          continue;
        }
        const j = (na - lo) * span + nl;
        const m = marks[j];
        if (m === 2) continue;
        if (m !== 0) {
          // Joined to a part an earlier walk already judged.
          result = m === 1;
          break walk;
        }
        if (!opaque[j]) continue;
        marks[j] = 2;
        visited.push(j);
        stack.push(na, nl);
      }
    }
  }
  const mark = result ? 1 : -1;
  for (const j of visited) marks[j] = mark;
  memo.walked += visited.length;
  return result;
}

/**
 * countGridCuts, edge by edge, without the cuts a nearby clear gap forgives
 * (see edgeCuts; tolerance lineTolerance of the cell).
 */
export function countUnresolvedCuts(img: Pixels, cellW: number, cellH: number, memo: SpillMemo = newSpillMemo()): number {
  const { width, height } = img;
  let cuts = 0;
  for (let x = cellW; x < width; x += cellW) {
    for (let y = 0; y < height; y += cellH) cuts += edgeCuts(img, true, x, y, y + cellH, lineTolerance(cellW), memo);
  }
  for (let y = cellH; y < height; y += cellH) {
    for (let x = 0; x < width; x += cellW) cuts += edgeCuts(img, false, y, x, x + cellW, lineTolerance(cellH), memo);
  }
  return cuts;
}

/** True when the w x h box at (x0, y0) holds an opaque pixel more than tolX
 *  px inside its left and right edges and tolY px inside its top and bottom. */
function holdsContentInside(
  img: Pixels,
  x0: number,
  y0: number,
  w: number,
  h: number,
  tolX: number,
  tolY: number
): boolean {
  const { width, data } = img;
  for (let y = y0 + tolY; y < y0 + h - tolY; y++) {
    let i = (y * width + x0 + tolX) * 4 + 3;
    for (let x = tolX; x < w - tolX; x++, i += 4) {
      if (data[i] > ALPHA_THRESHOLD) return true;
    }
  }
  return false;
}

/**
 * How many cells of the cellW x cellH grid hold an opaque pixel more than
 * lineTolerance px inside their edges (a spill from the cell next door is
 * not content of its own).
 */
export function cellsWithContent(img: Pixels, cellW: number, cellH: number): number {
  const tolW = lineTolerance(cellW);
  const tolH = lineTolerance(cellH);
  let n = 0;
  for (let y = 0; y + cellH <= img.height; y += cellH) {
    for (let x = 0; x + cellW <= img.width; x += cellW) {
      if (holdsContentInside(img, x, y, cellW, cellH, tolW, tolH)) n++;
    }
  }
  return n;
}

/**
 * True when every s x s cell that holds content holds two things that the
 * grid at half the size separates: along the cell's vertical (or horizontal)
 * middle no cut is left unforgiven, and both halves hold content more than
 * the tolerance inside their edges. Frames of half the size that touch their
 * neighbours across one axis look like big cut sprites to countUnresolvedCuts;
 * a clean middle with content on both sides shows the cell is two frames.
 */
function cellsSplitInTwo(img: Pixels, s: number, memo: SpillMemo): boolean {
  const half = s / 2;
  const tol = lineTolerance(half);
  const columns = img.width / s;
  const rows = img.height / s;
  let any = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const x0 = c * s;
      const y0 = r * s;
      const left = holdsContentInside(img, x0, y0, half, s, tol, tol);
      const right = holdsContentInside(img, x0 + half, y0, half, s, tol, tol);
      const top = holdsContentInside(img, x0, y0, s, half, tol, tol);
      const bottom = holdsContentInside(img, x0, y0 + half, s, half, tol, tol);
      if (!left && !right && !top && !bottom) continue;
      any = true;
      const splitV = left && right && edgeCuts(img, true, x0 + half, y0, y0 + s, tol, memo) === 0;
      const splitH = top && bottom && edgeCuts(img, false, y0 + half, x0, x0 + s, tol, memo) === 0;
      if (!splitV && !splitH) return false;
    }
  }
  return any;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Find the smallest square cell size whose grid lines cut through no sprite
 * and whose cells are mostly filled, so large-cell sheets (128 or 256 px)
 * are not proposed at 16 px just because 16 divides the image.
 *
 * A size s from SLICER_DETECT_TRY_SIZES is a candidate when it divides both
 * sides and gives at least 2 cells. It is clean when, along every cell edge
 * on an interior grid line x = k*s (or y = k*s), either no row (or column)
 * has opaque pixels on both sides of the line, or a fully transparent column
 * (or row) lies within lineTolerance(s) px of it over that edge: sprites that
 * touch or spill a few pixels past their cell line, with a clear gap just
 * beyond, as generated sheets often have (a 512x512 sheet of four 256 px
 * characters whose feet reach 2 px into the row below). It is eligible when
 * it is clean and at least half its cells hold an opaque pixel. A size that
 * is clean only because a spill was forgiven has three more rules: a pixel
 * within that tolerance of a cell's edges does not count as content, since
 * a spill is part of the sprite next door; and when half the size is also
 * a candidate, the size is skipped if the grid at half the size is nearly
 * clean, or if every cell with content is split in two by a clean middle
 * (frames of half the size that touch). Returns the smallest eligible size,
 * or null when there is none, or the image has no transparent pixel or no
 * opaque pixel.
 *
 * One pass over the pixels records which lines are straddled and which
 * blocks hold content; each candidate is then checked from those arrays, and
 * only a straddled line is looked at again, edge by edge.
 */
export function detectCleanGrid(
  imageData: { width: number; height: number; data: Uint8ClampedArray },
  memo: SpillMemo = newSpillMemo()
): { width: number; height: number; columns: number; rows: number } | null {
  const found = findCleanGrid(imageData, memo);
  return found && { width: found.width, height: found.height, columns: found.columns, rows: found.rows };
}

/**
 * detectCleanGrid's answer, plus whether that size was clean only because a
 * spill was forgiven (rescued). The gutter step's near-size correction uses
 * it: a measured gutter grid yields only to a grid that is clean outright.
 * Every spill walk of the search shares memo (see SpillMemo).
 */
export function findCleanGrid(
  imageData: { width: number; height: number; data: Uint8ClampedArray },
  memo: SpillMemo = newSpillMemo()
): { width: number; height: number; columns: number; rows: number; rescued: boolean } | null {
  const { width, height, data } = imageData;

  const sizes = SLICER_DETECT_TRY_SIZES
    .filter((s) => width % s === 0 && height % s === 0 && (width / s) * (height / s) >= 2)
    .sort((a, b) => a - b);
  if (sizes.length === 0) return null;

  // Every candidate is a multiple of the block size, so a block's content
  // flag answers the content rule for any candidate's cells.
  let block = sizes[0];
  for (const s of sizes) block = gcd(block, s);
  const blockCols = width / block;
  const blockRows = height / block;
  const blockFilled = new Uint8Array(blockCols * blockRows);

  // vSplit[x] = 1 when an opaque pixel at x - 1 touches one at x, straight
  // across or diagonally; hSplit[y] the same across y - 1 and y.
  const vSplit = new Uint8Array(width);
  const hSplit = new Uint8Array(height);
  // Opacity of the previous row, overwritten in place as the scan advances.
  const above = new Uint8Array(width);

  let anyOpaque = false;
  let anyTransparent = false;

  for (let y = 0; y < height; y++) {
    const rowBlock = Math.floor(y / block) * blockCols;
    let left = 0;
    // The previous row at x - 1, read before above[x - 1] was overwritten.
    let upLeft = 0;
    let idx = y * width * 4 + 3;
    for (let x = 0; x < width; x++, idx += 4) {
      const up = above[x];
      if (data[idx] > ALPHA_THRESHOLD) {
        anyOpaque = true;
        if (left || upLeft) vSplit[x] = 1;
        if (up || upLeft) hSplit[y] = 1;
        // A diagonal neighbour up and to the right crosses x + 1 and y.
        if (x + 1 < width && above[x + 1]) {
          vSplit[x + 1] = 1;
          hSplit[y] = 1;
        }
        blockFilled[rowBlock + Math.floor(x / block)] = 1;
        above[x] = 1;
        left = 1;
      } else {
        anyTransparent = true;
        above[x] = 0;
        left = 0;
      }
      upLeft = up;
    }
  }

  if (!anyOpaque || !anyTransparent) return null;

  for (const s of sizes) {
    const columns = width / s;
    const rows = height / s;
    const tol = lineTolerance(s);

    let clean = true;
    let rescued = false;
    for (let k = 1; k < columns && clean; k++) {
      if (!vSplit[k * s]) continue;
      rescued = true;
      for (let r = 0; r < rows && clean; r++) {
        clean = edgeCuts(imageData, true, k * s, r * s, (r + 1) * s, tol, memo) === 0;
      }
    }
    for (let k = 1; k < rows && clean; k++) {
      if (!hSplit[k * s]) continue;
      rescued = true;
      for (let c = 0; c < columns && clean; c++) {
        clean = edgeCuts(imageData, false, k * s, c * s, (c + 1) * s, tol, memo) === 0;
      }
    }
    if (!clean) continue;

    // A size that is clean only because spills were forgiven is trusted
    // only when its cells look like one big sprite each (a full-height
    // character), not like frames of half the size. It is not taken when
    // the grid at half its size is nearly clean: its unforgiven cuts,
    // counted over all of its lines at its own tolerance, average at most
    // one half cell's length per line it adds (blocked only by a few frames
    // that touch). Nor when every cell with content is split in two by a
    // clean middle (frames that touch across the other axis). Both apply
    // only when the half size is itself a candidate the slicer can answer.
    if (rescued && s % 2 === 0 && sizes.includes(s / 2)) {
      const half = s / 2;
      if (countUnresolvedCuts(imageData, half, half, memo) <= (columns + rows) * half) continue;
      if (cellsSplitInTwo(imageData, s, memo)) continue;
    }

    const per = s / block;
    let contentCells = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        let filled = false;
        if (rescued) {
          // A forgiven spill is part of the sprite next door, so a cell whose
          // only content lies within tol px of its edges is not filled.
          filled = holdsContentInside(imageData, c * s, r * s, s, s, tol, tol);
        } else {
          for (let by = r * per; by < (r + 1) * per && !filled; by++) {
            const base = by * blockCols;
            for (let bx = c * per; bx < (c + 1) * per; bx++) {
              if (blockFilled[base + bx]) {
                filled = true;
                break;
              }
            }
          }
        }
        if (filled) contentCells++;
      }
    }

    if (contentCells * 2 >= columns * rows) {
      return { width: s, height: s, columns, rows, rescued };
    }
  }

  return null;
}

/**
 * How much the cellW x cellH grid cuts through sprites: the number of pixel
 * pairs, over every interior line (x = k * cellW or y = k * cellH), that are
 * opaque directly on both sides of the line in the same row or column. Same
 * alpha rule as detectCleanGrid. One effect reaching across a line gives a
 * few; a grid at the wrong spacing, which cuts whole sprites, gives hundreds.
 */
export function countGridCuts(
  imageData: { width: number; height: number; data: Uint8ClampedArray },
  cellW: number,
  cellH: number
): number {
  const { width, height, data } = imageData;
  let cuts = 0;
  for (let x = cellW; x < width; x += cellW) {
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4 + 3;
      if (data[i] > ALPHA_THRESHOLD && data[i - 4] > ALPHA_THRESHOLD) cuts++;
    }
  }
  for (let y = cellH; y < height; y += cellH) {
    const row = y * width * 4 + 3;
    const above = row - width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4] > ALPHA_THRESHOLD && data[above + x * 4] > ALPHA_THRESHOLD) cuts++;
    }
  }
  return cuts;
}

type Content = { spans: boolean; count: number; square: number; line: boolean };

/**
 * What the w x h box at (x0, y0) holds, less tolX px at its left and right
 * and tolY px at its top and bottom: whether its content spans more than an
 * eighth of the box each way, how many opaque pixels it has, the side of its
 * largest solid square of opaque pixels, and whether its pixels lie along a
 * line, their spread across their main direction under a third of their
 * spread along it (from the pixels' covariance), at any slant.
 */
function measureContent(img: Pixels, x0: number, y0: number, w: number, h: number, tolX: number, tolY: number): Content {
  const { width, data } = img;
  const xs = x0 + tolX;
  const n = Math.max(0, w - 2 * tolX);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  // side[x]: the side of the largest solid square whose bottom right pixel
  // is at column xs + x - 1 of this row; prev holds the row above.
  let prev = new Int32Array(n + 1);
  let side = new Int32Array(n + 1);
  let square = 0;
  for (let y = y0 + tolY; y < y0 + h - tolY; y++) {
    let i = (y * width + xs) * 4 + 3;
    for (let x = 1; x <= n; x++, i += 4) {
      if (data[i] > ALPHA_THRESHOLD) {
        const v = 1 + Math.min(prev[x], prev[x - 1], side[x - 1]);
        side[x] = v;
        if (v > square) square = v;
        count++;
        const dy = y - y0;
        sumX += x;
        sumY += dy;
        sumXX += x * x;
        sumYY += dy * dy;
        sumXY += x * dy;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        side[x] = 0;
      }
    }
    const done = prev;
    prev = side;
    side = done;
  }
  const spans = count > 0 && (maxX - minX + 1) * 8 > w && (maxY - minY + 1) * 8 > h;
  let line = false;
  if (count > 0) {
    const mx = sumX / count;
    const my = sumY / count;
    const cxx = sumXX / count - mx * mx;
    const cyy = sumYY / count - my * my;
    const cxy = sumXY / count - mx * my;
    const half = (cxx + cyy) / 2;
    const root = Math.sqrt(Math.max(0, half * half - (cxx * cyy - cxy * cxy)));
    // Variances along and across the main direction; a third of the
    // spread is a ninth of the variance.
    line = (half - root) * 9 < half + root;
  }
  return { spans, count, square, line };
}

/**
 * True when the two halves a and b of a cell (each w x h, measured by
 * measureContent) each hold a body. Content counts when it spans more than
 * an eighth of its half each way, unless it is a line beside a body: under
 * half the other half's pixels, with no solid square more than an eighth of
 * its half's shorter side, and lying along one direction. A weapon or arm
 * reaching across from the body, straight or slanted, is no second body
 * (Second 060); outlined, dithered, thin-limbed or small sprites beside a
 * bigger one, and any two halves of a size, stay two frames.
 */
function twoBodies(a: Content, b: Content, w: number, h: number): boolean {
  if (!a.spans || !b.spans) return false;
  const small = a.count <= b.count ? a : b;
  const large = a.count <= b.count ? b : a;
  return small.count * 2 >= large.count || small.square * 8 > Math.min(w, h) || !small.line;
}

/**
 * True when some cell of the cellW x cellH grid holds two things side by
 * side or one above the other: a body (see twoBodies, more than the
 * tolerance inside its edges) in each half of the cell, with the middle
 * line crossed by nothing thicker than an effect (at most an eighth of the
 * edge's length, unforgiven). A grid whose cell holds two frames' sprites,
 * joined only by an effect between them, is too coarse; a sprite whose body
 * straddles the middle, or whose arm or weapon alone reaches across it, at
 * any slant, is one.
 */
export function cellHoldsTwoHalves(img: Pixels, cellW: number, cellH: number): boolean {
  const memo = newSpillMemo();
  const halfW = cellW / 2;
  const halfH = cellH / 2;
  const tolW = lineTolerance(halfW);
  const tolH = lineTolerance(halfH);
  const columns = Math.floor(img.width / cellW);
  const rows = Math.floor(img.height / cellH);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const x0 = c * cellW;
      const y0 = r * cellH;
      if (
        Number.isInteger(halfW) &&
        twoBodies(
          measureContent(img, x0, y0, halfW, cellH, tolW, tolH),
          measureContent(img, x0 + halfW, y0, halfW, cellH, tolW, tolH),
          halfW,
          cellH
        ) &&
        edgeCuts(img, true, x0 + halfW, y0, y0 + cellH, tolW, memo) * 8 <= cellH
      ) {
        return true;
      }
      if (
        Number.isInteger(halfH) &&
        twoBodies(
          measureContent(img, x0, y0, cellW, halfH, tolW, tolH),
          measureContent(img, x0, y0 + halfH, cellW, halfH, tolW, tolH),
          cellW,
          halfH
        ) &&
        edgeCuts(img, false, y0 + halfH, x0, x0 + cellW, tolH, memo) * 8 <= cellW
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when some cell of the cellW x cellH grid holds content in two or more
 * of its four quadrants (the cells of the grid at half the size). Content
 * within lineTolerance px of a quadrant's edges does not count: that is a
 * spill, across the cell's middle or into the cell from the one next door,
 * which edgeCuts forgives, not a second sprite. Used when the grid at half
 * the size has no unforgiven cut: it then separates that content, so the
 * cell holds two sprites, which a frame does not. cellW and cellH must be
 * even.
 */
export function cellHoldsTwoQuadrants(
  imageData: { width: number; height: number; data: Uint8ClampedArray },
  cellW: number,
  cellH: number
): boolean {
  const halfW = cellW / 2;
  const halfH = cellH / 2;
  const tolW = lineTolerance(halfW);
  const tolH = lineTolerance(halfH);
  const columns = Math.floor(imageData.width / cellW);
  const rows = Math.floor(imageData.height / cellH);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      let quadrants = 0;
      for (let q = 0; q < 4 && quadrants < 2; q++) {
        const x0 = c * cellW + (q % 2) * halfW;
        const y0 = r * cellH + Math.floor(q / 2) * halfH;
        if (holdsContentInside(imageData, x0, y0, halfW, halfH, tolW, tolH)) quadrants++;
      }
      if (quadrants >= 2) return true;
    }
  }
  return false;
}
