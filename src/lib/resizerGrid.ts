// Grid detection for the FrameSizeResizer (src/components/sprites/FrameSizeResizer.tsx).
//
// Separate from the slicer's `detectFrameGrid` in spriteUtils.ts on purpose:
// that function answers "what frame size" for a sheet the user will slice
// as is; this one answers "what grid (cols x rows)" for a sheet the user
// will resize next. Since PR #19 the slicer's pixel-reading steps run
// first here too, because for a large-cell sheet they are the only steps
// that look at the image.
//
// Priority order:
//   0. The slicer's pixel-based steps (known layouts, gutters, clean grid),
//      except that the answer of steps 1 to 4 wins when it is finer and the
//      pixels allow it (see detectGridSmart).
//   1. Common grid layouts (4x4, 3x4, 8x8, etc.) that divide the image
//      evenly with a reasonable per-frame size. This catches the 800x800 to
//      4x4 case that the old algorithm missed.
//   2. Standard SPRITE_SIZES that divide the image evenly (for sheets that
//      are already at pixel-art resolutions like 192x192 to 48x48 frames).
//   3. Transparent or uniform gutter detection.
//   4. Dimension-based fallback (square to 4x4, strip to W/H columns, etc.)

import { SLICER_FRAME_PRESETS } from '@/lib/constants';
import { cellHoldsTwoQuadrants, cellsWithContent, countUnresolvedCuts } from '@/lib/gridDetect';
import { detectFrameGridFromPixels } from '@/lib/spriteUtils';

export type DetectionConfidence = 'high' | 'medium' | 'low';

export interface DetectionResult {
  cols: number;
  rows: number;
  confidence: DetectionConfidence;
}

/** Preferred grid layouts in order of commonality for sprite sheets. */
const COMMON_GRIDS: ReadonlyArray<readonly [number, number]> = [
  [4, 4],
  [3, 4],
  [4, 3],
  [8, 8],
  [4, 8],
  [8, 4],
  [2, 2],
  [3, 3],
  [2, 4],
  [4, 2],
  [5, 5],
  [6, 6],
  [2, 3],
  [3, 2],
];

// Square sizes from the canonical preset list, descending; order matters for
// detectByStandardSize iteration priority.
const STANDARD_FRAME_SIZES: readonly number[] = SLICER_FRAME_PRESETS
  .filter((p) => p.width === p.height)
  .map((p) => p.width)
  .sort((a, b) => b - a);

/** Validate a (cols, rows) candidate produces a sensible sprite sheet. */
function isValidGrid(imgW: number, imgH: number, cols: number, rows: number): boolean {
  if (cols < 1 || rows < 1 || cols > 16 || rows > 16) return false;
  const count = cols * rows;
  if (count < 2 || count > 256) return false;
  const fw = imgW / cols;
  const fh = imgH / rows;
  if (!Number.isInteger(fw) || !Number.isInteger(fh)) return false;
  if (fw < 8 || fh < 8 || fw > 512 || fh > 512) return false;
  // Reject extreme aspect ratios unless the grid itself is non-square
  const frameRatio = fw / fh;
  if (frameRatio < 0.4 || frameRatio > 2.5) return false;
  return true;
}

/** Priority 1: check common grid layouts first. */
function detectByCommonGrid(imgW: number, imgH: number): DetectionResult | null {
  for (const [c, r] of COMMON_GRIDS) {
    if (isValidGrid(imgW, imgH, c, r)) {
      return { cols: c, rows: r, confidence: 'high' };
    }
  }
  return null;
}

/** Priority 2: standard frame sizes that divide the image evenly. */
function detectByStandardSize(imgW: number, imgH: number): DetectionResult | null {
  for (const fw of STANDARD_FRAME_SIZES) {
    for (const fh of STANDARD_FRAME_SIZES) {
      if (imgW % fw !== 0 || imgH % fh !== 0) continue;
      const cols = imgW / fw;
      const rows = imgH / fh;
      if (!isValidGrid(imgW, imgH, cols, rows)) continue;
      return { cols, rows, confidence: 'high' };
    }
  }
  return null;
}

/** Priority 3: transparent/uniform gutter analysis. */
function detectByGutters(imgData: ImageData): DetectionResult | null {
  const { width: W, height: H, data } = imgData;

  const isTransparentColumn = (x: number): boolean => {
    for (let y = 0; y < H; y++) {
      if (data[(y * W + x) * 4 + 3] > 10) return false;
    }
    return true;
  };
  const isTransparentRow = (y: number): boolean => {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 10) return false;
    }
    return true;
  };

  // Collect transparent column/row indices, group into bands
  const groupBands = (indices: number[]): number[] => {
    if (indices.length === 0) return [];
    const bands: number[] = [];
    let bandStart = indices[0];
    let prev = indices[0];
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === prev + 1) {
        prev = indices[i];
      } else {
        bands.push(Math.floor((bandStart + prev) / 2));
        bandStart = indices[i];
        prev = indices[i];
      }
    }
    bands.push(Math.floor((bandStart + prev) / 2));
    return bands;
  };

  const transparentCols: number[] = [];
  for (let x = 0; x < W; x++) if (isTransparentColumn(x)) transparentCols.push(x);
  const transparentRows: number[] = [];
  for (let y = 0; y < H; y++) if (isTransparentRow(y)) transparentRows.push(y);

  const colBands = groupBands(transparentCols);
  const rowBands = groupBands(transparentRows);

  // Number of frames = bands between edges. If the image has edge gutters,
  // bands will include start and end; otherwise they're interior dividers.
  // Interior-divider case: cols = bands.length + 1
  // Edge-inclusive case: cols = bands.length - 1 (if first/last band is at 0/W)
  let cols = 0;
  let rows = 0;
  if (colBands.length >= 1) {
    const hasLeftEdge = colBands[0] < 5;
    const hasRightEdge = colBands[colBands.length - 1] > W - 5;
    cols = colBands.length + 1 - (hasLeftEdge ? 1 : 0) - (hasRightEdge ? 1 : 0);
  }
  if (rowBands.length >= 1) {
    const hasTopEdge = rowBands[0] < 5;
    const hasBottomEdge = rowBands[rowBands.length - 1] > H - 5;
    rows = rowBands.length + 1 - (hasTopEdge ? 1 : 0) - (hasBottomEdge ? 1 : 0);
  }

  if (cols >= 2 && rows >= 2 && cols <= 16 && rows <= 16) {
    return { cols, rows, confidence: 'medium' };
  }
  if (cols >= 2 && cols <= 16 && rows === 0 && H > 0) {
    return { cols, rows: 1, confidence: 'medium' };
  }
  if (rows >= 2 && rows <= 16 && cols === 0 && W > 0) {
    return { cols: 1, rows, confidence: 'medium' };
  }
  return null;
}

/** Priority 4: dimension-based heuristic. */
function detectByDimensions(imgW: number, imgH: number): DetectionResult {
  if (imgW === imgH) {
    // Square: 4x4 is by far the most common sprite sheet layout
    return { cols: 4, rows: 4, confidence: 'low' };
  }
  if (imgW > 2 * imgH) {
    // Horizontal strip
    const c = Math.max(2, Math.min(16, Math.round(imgW / imgH)));
    return { cols: c, rows: 1, confidence: 'low' };
  }
  if (imgH > 2 * imgW) {
    // Vertical strip
    const r = Math.max(2, Math.min(16, Math.round(imgH / imgW)));
    return { cols: 1, rows: r, confidence: 'low' };
  }
  // Rectangular but not extreme: guess 4x4
  return { cols: 4, rows: 4, confidence: 'low' };
}

/** Steps 1 to 4: the grid from the image's shape and its gutters alone,
 *  which is what the resizer answered before PR #19. */
function detectByShape(imgData: ImageData): DetectionResult {
  const { width: W, height: H } = imgData;
  return (
    detectByCommonGrid(W, H) ??
    detectByStandardSize(W, H) ??
    detectByGutters(imgData) ??
    detectByDimensions(W, H)
  );
}

/** True when the pixels allow the grid g: its cells tile the image, it cuts
 *  nothing the slicer would not forgive, and at least three quarters of its
 *  cells hold content of their own. */
function pixelsAllow(imgData: ImageData, g: DetectionResult): boolean {
  const { width: W, height: H } = imgData;
  const cellW = W / g.cols;
  const cellH = H / g.rows;
  if (!Number.isInteger(cellW) || !Number.isInteger(cellH)) return false;
  if (countUnresolvedCuts(imgData, cellW, cellH) !== 0) return false;
  return cellsWithContent(imgData, cellW, cellH) * 4 >= g.cols * g.rows * 3;
}

/** Step 0: the slicer's pixel answer, as described in detectGridSmart. */
function detectByPixels(imgData: ImageData): DetectionResult | null {
  const { width: W, height: H } = imgData;
  const fromSlicer = detectFrameGridFromPixels(imgData);
  if (
    !fromSlicer ||
    !isValidGrid(W, H, fromSlicer.columns, fromSlicer.rows) ||
    Math.abs(W / fromSlicer.columns - fromSlicer.width) * 8 > fromSlicer.width ||
    Math.abs(H / fromSlicer.rows - fromSlicer.height) * 8 > fromSlicer.height
  ) {
    return null;
  }
  const { width: cellW, height: cellH, columns, rows } = fromSlicer;
  if (
    cellW % 2 === 0 &&
    cellH % 2 === 0 &&
    isValidGrid(W, H, columns * 2, rows * 2) &&
    countUnresolvedCuts(imgData, cellW / 2, cellH / 2) === 0 &&
    cellHoldsTwoQuadrants(imgData, cellW, cellH)
  ) {
    return { cols: columns * 2, rows: rows * 2, confidence: 'medium' };
  }
  return { cols: columns, rows: rows, confidence: 'high' };
}

/** Main detection entry point. Runs all priorities and returns the first match. */
export function detectGridSmart(imgData: ImageData): DetectionResult {
  // 0) The slicer's own detector first. Its gutter step and clean-grid step
  //    (src/lib/gridDetect.ts) read the pixels, so a 512x512 sheet of four
  //    256 px frames comes back as 2x2, where the shape-only steps below
  //    answered 4x4 of 128 (PR #19). Only a pixel-based answer counts: a
  //    result the slicer reached by its own shape fallbacks (steps 3 to 5)
  //    is no better than the shape steps here, so those are skipped. Three
  //    checks guard it:
  //    - The grid must be one the resizer can show (isValidGrid).
  //    - The resizer shows frames of width / cols by height / rows. When the
  //      answer's cells do not tile the image (a padded texture, or a gutter
  //      spacing measured a few pixels off), those frames must stay within
  //      an eighth of the cells it measured; a charset whose rows measured
  //      49 for 48 (3 rows of 64) falls through to the shape steps instead.
  //    - The clean grid only takes a size whose cells are at least half
  //      filled, so a 4x4 template of 128 px frames with 3 to 7 frames drawn
  //      comes back as 2x2 of 256 (audit r5). When the grid with twice the
  //      columns and rows is valid, cuts nothing that the slicer would not
  //      forgive (a spill of a few pixels with a clear gap beyond), and some
  //      cell holds content in two of its quadrants, not counting such
  //      spills (cellHoldsTwoQuadrants), that cell held two frames, not one,
  //      and the finer grid answers instead, as 'medium': a grid the pixels
  //      allow rather than force. One sprite per big cell (a real 2x2 of 256
  //      with small sprites) keeps the coarse answer, and so does a cell
  //      whose sprite the finer grid would cut, even with only a thin arm or
  //      weapon (audit r7). An effect that reaches farther than a spill into
  //      the next frame keeps the coarse answer too.
  //    The shape steps' answer, which every upload got before PR #19, still
  //    wins over a coarser pixel answer when the pixels allow it
  //    (pixelsAllow): its grid cuts no sprite and nearly every cell holds
  //    one. Square-only clean grids cannot read non-square frames, so a
  //    4x4 of 48x64 or of 128x64 came back as 64 or 128 squares (audit r8);
  //    the shape steps read those 4x4, and then this keeps 4x4, as 'medium'.
  const shape = detectByShape(imgData);
  const fromPixels = detectByPixels(imgData);
  if (!fromPixels) return shape;
  if (shape.cols * shape.rows > fromPixels.cols * fromPixels.rows && pixelsAllow(imgData, shape)) {
    return { cols: shape.cols, rows: shape.rows, confidence: 'medium' };
  }
  return fromPixels;
}
