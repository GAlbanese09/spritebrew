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
 * Unforgiven cuts along one cell's edge on a grid line: the pixels just left
 * of the vertical line at x = pos (over rows from to to - 1), or just above
 * the horizontal line at y = pos (over columns from to to - 1), that touch an
 * opaque pixel just across it, straight across or diagonally. Diagonal
 * neighbours count because the slicer's own sprite detection joins them, so
 * a line through a one-pixel diagonal weapon cuts it. 0 when there are none,
 * or when a column (or row) within tol px of the line is fully transparent
 * over that edge: a sprite spilling a few pixels past its cell line with a
 * clear gap beyond.
 */
function edgeCuts(img: Pixels, vertical: boolean, pos: number, from: number, to: number, tol: number): number {
  const { width, height, data } = img;
  const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD;
  const span = vertical ? height : width;
  const end = Math.min(to, span);
  let cuts = 0;
  for (let t = from; t < end; t++) {
    if (!(vertical ? opaque(pos - 1, t) : opaque(t, pos - 1))) continue;
    for (let u = Math.max(0, t - 1); u <= Math.min(span - 1, t + 1); u++) {
      if (vertical ? opaque(pos, u) : opaque(u, pos)) {
        cuts++;
        break;
      }
    }
  }
  if (cuts === 0) return 0;
  const limit = vertical ? width : height;
  for (let g = Math.max(0, pos - 1 - tol); g <= Math.min(limit - 1, pos + tol); g++) {
    let clear = true;
    for (let t = from; t < end && clear; t++) clear = !(vertical ? opaque(g, t) : opaque(t, g));
    if (clear) return 0;
  }
  return cuts;
}

/**
 * countGridCuts, edge by edge, without the cuts a nearby clear gap forgives
 * (see edgeCuts; tolerance lineTolerance of the cell).
 */
export function countUnresolvedCuts(img: Pixels, cellW: number, cellH: number): number {
  const { width, height } = img;
  let cuts = 0;
  for (let x = cellW; x < width; x += cellW) {
    for (let y = 0; y < height; y += cellH) cuts += edgeCuts(img, true, x, y, y + cellH, lineTolerance(cellW));
  }
  for (let y = cellH; y < height; y += cellH) {
    for (let x = 0; x < width; x += cellW) cuts += edgeCuts(img, false, y, x, x + cellW, lineTolerance(cellH));
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
function cellsSplitInTwo(img: Pixels, s: number): boolean {
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
      const splitV = left && right && edgeCuts(img, true, x0 + half, y0, y0 + s, tol) === 0;
      const splitH = top && bottom && edgeCuts(img, false, y0 + half, x0, x0 + s, tol) === 0;
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
export function detectCleanGrid(imageData: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): { width: number; height: number; columns: number; rows: number } | null {
  const found = findCleanGrid(imageData);
  return found && { width: found.width, height: found.height, columns: found.columns, rows: found.rows };
}

/**
 * detectCleanGrid's answer, plus whether that size was clean only because a
 * spill was forgiven (rescued). The gutter step's near-size correction uses
 * it: a measured gutter grid yields only to a grid that is clean outright.
 */
export function findCleanGrid(imageData: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): { width: number; height: number; columns: number; rows: number; rescued: boolean } | null {
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
        clean = edgeCuts(imageData, true, k * s, r * s, (r + 1) * s, tol) === 0;
      }
    }
    for (let k = 1; k < rows && clean; k++) {
      if (!hSplit[k * s]) continue;
      rescued = true;
      for (let c = 0; c < columns && clean; c++) {
        clean = edgeCuts(imageData, false, k * s, c * s, (c + 1) * s, tol) === 0;
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
      if (countUnresolvedCuts(imageData, half, half) <= (columns + rows) * half) continue;
      if (cellsSplitInTwo(imageData, s)) continue;
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
