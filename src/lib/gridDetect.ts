import { SLICER_DETECT_TRY_SIZES } from '@/lib/constants';

// Same opacity threshold detectFrameGrid uses for its gutter scan.
const ALPHA_THRESHOLD = 10;

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
 * sides and gives at least 2 cells. It is clean when no interior grid line
 * x = k*s (or y = k*s) has opaque pixels on both sides in the same row (or
 * column). It is eligible when it is clean and at least half its cells hold
 * an opaque pixel. Returns the smallest eligible size, or null when there is
 * none, or the image has no transparent pixel or no opaque pixel.
 *
 * One pass over the pixels records which lines are straddled and which
 * blocks hold content; each candidate is then checked from those arrays.
 */
export function detectCleanGrid(imageData: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): { width: number; height: number; columns: number; rows: number } | null {
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

  // vSplit[x] = 1 when some row has opaque pixels at both x - 1 and x;
  // hSplit[y] = 1 when some column has opaque pixels at both y - 1 and y.
  const vSplit = new Uint8Array(width);
  const hSplit = new Uint8Array(height);
  // Opacity of the previous row, overwritten in place as the scan advances.
  const above = new Uint8Array(width);

  let anyOpaque = false;
  let anyTransparent = false;

  for (let y = 0; y < height; y++) {
    const rowBlock = Math.floor(y / block) * blockCols;
    let left = 0;
    let idx = y * width * 4 + 3;
    for (let x = 0; x < width; x++, idx += 4) {
      if (data[idx] > ALPHA_THRESHOLD) {
        anyOpaque = true;
        if (left) vSplit[x] = 1;
        if (above[x]) hSplit[y] = 1;
        blockFilled[rowBlock + Math.floor(x / block)] = 1;
        above[x] = 1;
        left = 1;
      } else {
        anyTransparent = true;
        above[x] = 0;
        left = 0;
      }
    }
  }

  if (!anyOpaque || !anyTransparent) return null;

  for (const s of sizes) {
    const columns = width / s;
    const rows = height / s;

    let clean = true;
    for (let k = 1; k < columns && clean; k++) {
      if (vSplit[k * s]) clean = false;
    }
    for (let k = 1; k < rows && clean; k++) {
      if (hSplit[k * s]) clean = false;
    }
    if (!clean) continue;

    const per = s / block;
    let contentCells = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        let filled = false;
        for (let by = r * per; by < (r + 1) * per && !filled; by++) {
          const base = by * blockCols;
          for (let bx = c * per; bx < (c + 1) * per; bx++) {
            if (blockFilled[base + bx]) {
              filled = true;
              break;
            }
          }
        }
        if (filled) contentCells++;
      }
    }

    if (contentCells * 2 >= columns * rows) {
      return { width: s, height: s, columns, rows };
    }
  }

  return null;
}
