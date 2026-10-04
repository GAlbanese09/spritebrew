/**
 * Sheet geometry for generated animations. Pure: no React, no store.
 *
 * A generated animation sheet is a grid of square cells read row-major.
 * When the generation is known (result card), the slicer uses the size the
 * request was sent at plus the frame count; when only the image is known
 * (gallery), it guesses the size with galleryFrameSizeGuess.
 */

export interface SheetGeometry {
  frameW: number;
  frameH: number;
  cols: number;
  rows: number;
  /** Frames to keep, read row-major. Trailing empty cells are dropped. */
  frames: number;
}

export interface SheetGeometryInput {
  imageW: number;
  imageH: number;
  frameSize?: number;
  frameCount?: number;
}

/** The fallback pipeline's fixed cell size when the consumer did not report one. */
export const RESCUE_CELL_SIZE = 64;

/** The smallest frame count Animate offers (src/lib/animateConfig.ts VALID_FRAME_COUNTS). */
const MIN_ANIMATION_FRAMES = 4;

const isPositiveInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0;

export function sheetGeometry({
  imageW,
  imageH,
  frameSize,
  frameCount,
}: SheetGeometryInput): SheetGeometry | null {
  if (!isPositiveInt(imageW) || !isPositiveInt(imageH)) return null;
  const count = isPositiveInt(frameCount) ? frameCount : undefined;

  let size: number;
  if (frameSize !== undefined) {
    if (!isPositiveInt(frameSize)) return null;
    size = frameSize;
  } else if (count !== undefined) {
    const root = Math.sqrt((imageW * imageH) / count);
    if (!Number.isInteger(root)) return null;
    size = root;
  } else {
    return null;
  }

  if (imageW % size !== 0 || imageH % size !== 0) return null;
  const cols = imageW / size;
  const rows = imageH / size;
  const cells = cols * rows;
  return {
    frameW: size,
    frameH: size,
    cols,
    rows,
    frames: Math.min(count ?? cells, cells),
  };
}

/**
 * Frame size for a gallery sheet, which records no size: 128 when the image
 * splits into at least MIN_ANIMATION_FRAMES cells of 128, else 64 on the same
 * test, else null.
 */
export function galleryFrameSizeGuess(imageW: number, imageH: number): number | null {
  for (const size of [128, 64]) {
    if (imageW % size === 0 && imageH % size === 0 && (imageW / size) * (imageH / size) >= MIN_ANIMATION_FRAMES) {
      return size;
    }
  }
  return null;
}

/**
 * Cell size a finished animate job delivered: the requested size, or on a
 * rescued sheet the consumer's deliveredCellSize, else RESCUE_CELL_SIZE.
 */
export function generatedFrameSize(
  requestedSize: number,
  rescue?: { deliveredCellSize?: number } | null
): number {
  if (!rescue) return requestedSize;
  return isPositiveInt(rescue.deliveredCellSize) ? rescue.deliveredCellSize : RESCUE_CELL_SIZE;
}
