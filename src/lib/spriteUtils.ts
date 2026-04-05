import { SPRITE_SIZES } from '@/lib/constants';

let _idCounter = 0;

export function generateFrameId(): string {
  return `frame-${Date.now()}-${_idCounter++}`;
}

export function generateAnimationId(): string {
  return `anim-${Date.now()}-${_idCounter++}`;
}

// Known Retro Diffusion output layouts: total image size → frame size
const KNOWN_LAYOUTS: Array<{
  imgW: number;
  imgH: number;
  frameW: number;
  frameH: number;
}> = [
  // four_angle_walking: 4x4 grid of 48x48
  { imgW: 192, imgH: 192, frameW: 48, frameH: 48 },
  // walking_and_idle: various 48x48 layouts
  { imgW: 192, imgH: 96, frameW: 48, frameH: 48 },
  { imgW: 288, imgH: 192, frameW: 48, frameH: 48 },
  { imgW: 192, imgH: 288, frameW: 48, frameH: 48 },
  // small_sprites: 32x32
  { imgW: 128, imgH: 128, frameW: 32, frameH: 32 },
  { imgW: 128, imgH: 64, frameW: 32, frameH: 32 },
  { imgW: 192, imgH: 128, frameW: 32, frameH: 32 },
  // any_animation: 64x64
  { imgW: 256, imgH: 256, frameW: 64, frameH: 64 },
  { imgW: 256, imgH: 64, frameW: 64, frameH: 64 },
  { imgW: 384, imgH: 64, frameW: 64, frameH: 64 },
  // 8_dir_rotation: 80x80
  { imgW: 640, imgH: 80, frameW: 80, frameH: 80 },
  { imgW: 320, imgH: 160, frameW: 80, frameH: 80 },
];

/**
 * Analyze an image to detect frame grid dimensions.
 * Prioritizes known layouts and standard sprite sizes.
 */
export function detectFrameGrid(
  imageData: ImageData
): { width: number; height: number; columns: number; rows: number } | null {
  const { width, height, data } = imageData;

  // 1) Check known Retro Diffusion layouts first (highest priority)
  for (const layout of KNOWN_LAYOUTS) {
    if (width === layout.imgW && height === layout.imgH) {
      return {
        width: layout.frameW,
        height: layout.frameH,
        columns: width / layout.frameW,
        rows: height / layout.frameH,
      };
    }
  }

  // 2) Try transparent gutter detection
  const isTransparentColumn = (col: number): boolean => {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + col) * 4;
      if (data[idx + 3] > 10) return false;
    }
    return true;
  };

  const isTransparentRow = (row: number): boolean => {
    for (let x = 0; x < width; x++) {
      const idx = (row * width + x) * 4;
      if (data[idx + 3] > 10) return false;
    }
    return true;
  };

  const vGutters: number[] = [];
  for (let x = 1; x < width - 1; x++) {
    if (isTransparentColumn(x)) vGutters.push(x);
  }

  const hGutters: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    if (isTransparentRow(y)) hGutters.push(y);
  }

  const gutterW = detectConsistentSpacing(vGutters, width);
  const gutterH = detectConsistentSpacing(hGutters, height);

  if (gutterW && gutterH) {
    // If gutter detection found a size, check if a standard size also fits
    // and is close — prefer the standard size
    const standardMatch = findBestStandardSize(width, height, gutterW, gutterH);
    if (standardMatch) return standardMatch;

    return {
      width: gutterW,
      height: gutterH,
      columns: Math.floor(width / gutterW),
      rows: Math.floor(height / gutterH),
    };
  }

  // 3) Find all standard SPRITE_SIZES that evenly divide the image,
  //    prefer the one that produces the most frames (smallest frame size)
  const candidates: Array<{ w: number; h: number; cols: number; rows: number; frames: number }> = [];

  for (const s of SPRITE_SIZES) {
    if (width % s.width === 0 && height % s.height === 0) {
      const cols = width / s.width;
      const rows = height / s.height;
      candidates.push({ w: s.width, h: s.height, cols, rows, frames: cols * rows });
    }
  }

  if (candidates.length > 0) {
    // Most frames = smallest frame size = most likely for animation sheets
    candidates.sort((a, b) => b.frames - a.frames);
    const best = candidates[0];
    return { width: best.w, height: best.h, columns: best.cols, rows: best.rows };
  }

  // 4) Try any square size that evenly divides, prefer standard sizes
  const trySizes = [16, 24, 32, 48, 64, 80, 96, 128];
  const squareCandidates: Array<{ size: number; frames: number; isStandard: boolean }> = [];
  for (const size of trySizes) {
    if (width % size === 0 && height % size === 0) {
      const isStandard = SPRITE_SIZES.some((s) => s.width === size && s.height === size);
      squareCandidates.push({ size, frames: (width / size) * (height / size), isStandard });
    }
  }

  if (squareCandidates.length > 0) {
    // Prefer standard sizes, then most frames
    squareCandidates.sort((a, b) => {
      if (a.isStandard !== b.isStandard) return a.isStandard ? -1 : 1;
      return b.frames - a.frames;
    });
    const best = squareCandidates[0];
    return {
      width: best.size,
      height: best.size,
      columns: width / best.size,
      rows: height / best.size,
    };
  }

  // 5) Last resort: 32x32
  return {
    width: 32,
    height: 32,
    columns: Math.max(1, Math.floor(width / 32)),
    rows: Math.max(1, Math.floor(height / 32)),
  };
}

/**
 * If a gutter-detected size is close to a standard SPRITE_SIZES entry
 * that also evenly divides the image, prefer the standard size.
 */
function findBestStandardSize(
  imgW: number,
  imgH: number,
  detectedW: number,
  detectedH: number
): { width: number; height: number; columns: number; rows: number } | null {
  const tolerance = 4; // px
  for (const s of SPRITE_SIZES) {
    if (
      Math.abs(s.width - detectedW) <= tolerance &&
      Math.abs(s.height - detectedH) <= tolerance &&
      imgW % s.width === 0 &&
      imgH % s.height === 0
    ) {
      return {
        width: s.width,
        height: s.height,
        columns: imgW / s.width,
        rows: imgH / s.height,
      };
    }
  }
  return null;
}

/**
 * Given a sorted list of gutter positions and the total dimension,
 * detect a repeating frame width/height.
 */
function detectConsistentSpacing(gutters: number[], totalSize: number): number | null {
  if (gutters.length === 0) return null;

  // Group consecutive gutters into gutter bands
  const bands: Array<{ start: number; end: number }> = [];
  let bandStart = gutters[0];
  let bandEnd = gutters[0];

  for (let i = 1; i < gutters.length; i++) {
    if (gutters[i] === bandEnd + 1) {
      bandEnd = gutters[i];
    } else {
      bands.push({ start: bandStart, end: bandEnd });
      bandStart = gutters[i];
      bandEnd = gutters[i];
    }
  }
  bands.push({ start: bandStart, end: bandEnd });

  if (bands.length < 1) return null;

  // Measure distances between band starts
  const firstFrame = bands[0].start;
  if (bands.length === 1) {
    // Single gutter — frame size is the gutter position
    if (firstFrame > 4 && totalSize % firstFrame < 4) {
      return firstFrame;
    }
    return null;
  }

  // Check if spacing is consistent
  const spacings: number[] = [];
  spacings.push(bands[0].start);
  for (let i = 1; i < bands.length; i++) {
    spacings.push(bands[i].start - bands[i - 1].start);
  }

  const mode = findMode(spacings);
  if (mode && mode > 4) {
    const tolerance = 2;
    const consistent = spacings.filter((s) => Math.abs(s - mode) <= tolerance);
    if (consistent.length >= spacings.length * 0.6) {
      return mode;
    }
  }

  return null;
}

function findMode(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const freq = new Map<number, number>();
  for (const v of arr) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  let maxCount = 0;
  let mode: number | null = null;
  for (const [val, count] of freq) {
    if (count > maxCount) {
      maxCount = count;
      mode = val;
    }
  }
  return mode;
}

/**
 * Extract a single frame from a sprite sheet canvas.
 */
export function extractFrame(
  sourceCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): HTMLCanvasElement {
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = width;
  frameCanvas.height = height;
  const ctx = frameCanvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return frameCanvas;
}

/**
 * Convert a canvas frame to a data URL.
 */
export function frameToDataURL(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

/**
 * Load an image from a URL into an HTMLImageElement.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Draw an image onto a canvas and return the canvas.
 */
export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * Create a checkerboard / grid background canvas tile.
 */
export function createGridBackground(
  tileSize: number,
  color1: string,
  color2: string
): HTMLCanvasElement {
  const size = tileSize * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = color2;
  ctx.fillRect(0, 0, tileSize, tileSize);
  ctx.fillRect(tileSize, tileSize, tileSize, tileSize);
  return canvas;
}

/**
 * Scale a canvas with nearest-neighbor interpolation.
 */
export function scaleCanvasNearestNeighbor(
  source: HTMLCanvasElement,
  scale: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(source.width * scale);
  canvas.height = Math.floor(source.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Resize pixel art to exact target dimensions using nearest-neighbor.
 * Returns a data URL of the resized PNG. imageSmoothingEnabled = false is
 * the critical flag — it prevents the browser from blurring pixel art.
 */
export function resizePixelArt(
  source: HTMLCanvasElement | HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL('image/png');
}

/**
 * Fit an image into a square canvas, preserving aspect ratio. The longest
 * side scales to `targetSize`, the shorter side scales proportionally and is
 * centered, with the remaining area filled by `bgColor`. Uses nearest-neighbor
 * scaling. Returns a PNG data URL.
 */
export function fitToSquare(
  image: HTMLCanvasElement | HTMLImageElement,
  targetSize: number,
  bgColor: string
): string {
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Fill background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, targetSize, targetSize);

  const srcW = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const srcH = 'naturalHeight' in image ? image.naturalHeight : image.height;

  // Scale so the longest side fits exactly in targetSize
  const scale = Math.min(targetSize / srcW, targetSize / srcH);
  const scaledW = Math.max(1, Math.round(srcW * scale));
  const scaledH = Math.max(1, Math.round(srcH * scale));
  const offsetX = Math.round((targetSize - scaledW) / 2);
  const offsetY = Math.round((targetSize - scaledH) / 2);

  ctx.drawImage(image, offsetX, offsetY, scaledW, scaledH);
  return canvas.toDataURL('image/png');
}

// ─────────────────────────────────────────────────────────────────────────
// Sprite detection (contour/blob detection for non-grid sprite sheets).
//
// Used by the Upload page's "Auto-detect Sprites" mode. Produces a list of
// axis-aligned bounding boxes for every distinct sprite in an image,
// regardless of layout.
// ─────────────────────────────────────────────────────────────────────────

export interface DetectedSprite {
  /** 1-based index in the original detection order. */
  id: number;
  /** Position in the source image (pixels). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteDetectionResult {
  sprites: DetectedSprite[];
  /** The ImageData used for detection, so callers can re-crop from it. */
  imageData: ImageData;
}

/** Build a binary content mask from the image data. `true` = sprite pixel. */
function buildContentMask(imageData: ImageData): Uint8Array {
  const { width: W, height: H, data } = imageData;
  const mask = new Uint8Array(W * H);

  // Detect transparency usage: if any pixel has alpha < 10 we consider the
  // image to use transparency, and treat transparent as background.
  let hasTransparency = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 10) {
      hasTransparency = true;
      break;
    }
  }

  if (hasTransparency) {
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      mask[p] = data[i + 3] >= 10 ? 1 : 0;
    }
    return mask;
  }

  // No transparency — sample the four corners and treat that color (±15) as bg
  const cornerIdx = (x: number, y: number) => (y * W + x) * 4;
  const corners = [
    cornerIdx(0, 0),
    cornerIdx(W - 1, 0),
    cornerIdx(0, H - 1),
    cornerIdx(W - 1, H - 1),
  ];
  let sr = 0, sg = 0, sb = 0;
  for (const c of corners) {
    sr += data[c];
    sg += data[c + 1];
    sb += data[c + 2];
  }
  const bgR = Math.round(sr / corners.length);
  const bgG = Math.round(sg / corners.length);
  const bgB = Math.round(sb / corners.length);
  const TOL = 15;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const dr = Math.abs(data[i] - bgR);
    const dg = Math.abs(data[i + 1] - bgG);
    const db = Math.abs(data[i + 2] - bgB);
    mask[p] = dr <= TOL && dg <= TOL && db <= TOL ? 0 : 1;
  }
  return mask;
}

/**
 * 8-connectivity flood fill using an iterative stack. Returns the bounding
 * box of the connected region and marks all visited pixels in `visited`.
 */
function floodFillBoundingBox(
  mask: Uint8Array,
  visited: Uint8Array,
  W: number,
  H: number,
  startX: number,
  startY: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = startX, minY = startY, maxX = startX, maxY = startY;

  // Use a typed-array stack of packed (y * W + x) indices for speed
  const stack: number[] = [startY * W + startX];
  visited[startY * W + startX] = 1;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % W;
    const y = (idx - x) / W;

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;

    // 8-connectivity neighbors
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const nIdx = ny * W + nx;
        if (visited[nIdx] || !mask[nIdx]) continue;
        visited[nIdx] = 1;
        stack.push(nIdx);
      }
    }
  }

  return { minX, minY, maxX, maxY };
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Do two bounding boxes overlap or sit within `gap` pixels of each other? */
function bboxesNear(a: BBox, b: BBox, gap: number): boolean {
  return (
    a.minX <= b.maxX + gap &&
    a.maxX >= b.minX - gap &&
    a.minY <= b.maxY + gap &&
    a.maxY >= b.minY - gap
  );
}

/** Merge two bounding boxes into their union. */
function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * Merge boxes that are within `gap` pixels of each other. Runs until no more
 * merges happen — O(n²) per pass but n is small after noise filtering.
 */
function mergeNearbyBBoxes(boxes: BBox[], gap: number): BBox[] {
  let changed = true;
  let current = boxes.slice();
  while (changed) {
    changed = false;
    const next: BBox[] = [];
    const consumed = new Array(current.length).fill(false);
    for (let i = 0; i < current.length; i++) {
      if (consumed[i]) continue;
      let merged = current[i];
      for (let j = i + 1; j < current.length; j++) {
        if (consumed[j]) continue;
        if (bboxesNear(merged, current[j], gap)) {
          merged = bboxUnion(merged, current[j]);
          consumed[j] = true;
          changed = true;
        }
      }
      next.push(merged);
    }
    current = next;
  }
  return current;
}

/**
 * Sort bounding boxes in reading order: top-to-bottom, then left-to-right
 * within the same row. Two boxes are on the "same row" if their vertical
 * centers are within 25% of the average sprite height.
 */
function sortReadingOrder(boxes: BBox[]): BBox[] {
  if (boxes.length === 0) return boxes;

  const avgHeight =
    boxes.reduce((sum, b) => sum + (b.maxY - b.minY + 1), 0) / boxes.length;
  const rowTolerance = avgHeight * 0.25;

  // Augment with vertical centers
  const augmented = boxes.map((b) => ({
    box: b,
    cy: (b.minY + b.maxY) / 2,
  }));

  // Sort by cy first
  augmented.sort((a, b) => a.cy - b.cy);

  // Group into rows
  const rows: (typeof augmented)[] = [];
  for (const item of augmented) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(item.cy - lastRow[0].cy) <= rowTolerance) {
      lastRow.push(item);
    } else {
      rows.push([item]);
    }
  }

  // Within each row, sort by minX
  const result: BBox[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.box.minX - b.box.minX);
    for (const { box } of row) result.push(box);
  }
  return result;
}

/**
 * Detect individual sprites in an image using connected-component labeling.
 *
 * Steps:
 *   1. Build a content mask (transparent pixels = bg, or corner-color ±15 = bg)
 *   2. Flood-fill every unvisited content pixel to find connected regions (8-way)
 *   3. Filter out regions smaller than `minSize` (default 4×4)
 *   4. Merge boxes within `mergeGap` pixels of each other (default 2)
 *   5. Sort in reading order
 */
export interface DetectSpritesOptions {
  /** Minimum width or height for a region to count as a sprite. Default 4. */
  minSize?: number;
  /** Gap in pixels within which nearby boxes get merged. Default 2. */
  mergeGap?: number;
}

export function detectSprites(
  imageData: ImageData,
  options: DetectSpritesOptions = {}
): SpriteDetectionResult {
  const { minSize = 4, mergeGap = 2 } = options;
  const { width: W, height: H } = imageData;

  const mask = buildContentMask(imageData);
  const visited = new Uint8Array(W * H);
  const rawBoxes: BBox[] = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!mask[idx] || visited[idx]) continue;
      const bbox = floodFillBoundingBox(mask, visited, W, H, x, y);
      const w = bbox.maxX - bbox.minX + 1;
      const h = bbox.maxY - bbox.minY + 1;
      if (w < minSize || h < minSize) continue;
      rawBoxes.push(bbox);
    }
  }

  // Merge nearby boxes (e.g. detached weapons, particles)
  const merged = mergeGap > 0 ? mergeNearbyBBoxes(rawBoxes, mergeGap) : rawBoxes;

  // Sort reading order and assign 1-based IDs
  const sorted = sortReadingOrder(merged);
  const sprites: DetectedSprite[] = sorted.map((b, i) => ({
    id: i + 1,
    x: b.minX,
    y: b.minY,
    width: b.maxX - b.minX + 1,
    height: b.maxY - b.minY + 1,
  }));

  return { sprites, imageData };
}

/**
 * Crop a sprite region from a source canvas, optionally centered and padded
 * to a target size with transparent background.
 */
export function extractSpriteRegion(
  sourceCanvas: HTMLCanvasElement,
  sprite: DetectedSprite,
  targetWidth?: number,
  targetHeight?: number
): HTMLCanvasElement {
  const tw = targetWidth ?? sprite.width;
  const th = targetHeight ?? sprite.height;

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Center the sprite if the target is larger than the sprite
  const offsetX = Math.floor((tw - sprite.width) / 2);
  const offsetY = Math.floor((th - sprite.height) / 2);

  ctx.drawImage(
    sourceCanvas,
    sprite.x,
    sprite.y,
    sprite.width,
    sprite.height,
    offsetX,
    offsetY,
    sprite.width,
    sprite.height
  );
  return canvas;
}

/**
 * Remove a background color from an image by making matching pixels transparent.
 *
 * Auto-detects the dominant background color by sampling the four corners
 * (unless `overrideColor` is supplied). Pixels within `tolerance` RGB distance
 * of the background color have their alpha set to 0.
 *
 * Returns an object with the processed PNG data URL and the detected color
 * (as a `{r,g,b}` object) so the UI can display it.
 */
export interface BackgroundRemovalResult {
  dataUrl: string;
  detectedColor: { r: number; g: number; b: number };
}

export function removeBackgroundColor(
  image: HTMLCanvasElement | HTMLImageElement,
  tolerance = 10,
  overrideColor?: { r: number; g: number; b: number }
): BackgroundRemovalResult {
  const srcW = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const srcH = 'naturalHeight' in image ? image.naturalHeight : image.height;

  const canvas = document.createElement('canvas');
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);

  const imageData = ctx.getImageData(0, 0, srcW, srcH);
  const data = imageData.data;

  // Detect background: sample the four corners and average
  let bg: { r: number; g: number; b: number };
  if (overrideColor) {
    bg = overrideColor;
  } else {
    const corners: Array<[number, number]> = [
      [0, 0],
      [srcW - 1, 0],
      [0, srcH - 1],
      [srcW - 1, srcH - 1],
    ];
    let sumR = 0, sumG = 0, sumB = 0;
    for (const [x, y] of corners) {
      const idx = (y * srcW + x) * 4;
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
    }
    bg = {
      r: Math.round(sumR / corners.length),
      g: Math.round(sumG / corners.length),
      b: Math.round(sumB / corners.length),
    };
  }

  // Mask out matching pixels
  for (let i = 0; i < data.length; i += 4) {
    const dr = Math.abs(data[i] - bg.r);
    const dg = Math.abs(data[i + 1] - bg.g);
    const db = Math.abs(data[i + 2] - bg.b);
    if (dr <= tolerance && dg <= tolerance && db <= tolerance) {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), detectedColor: bg };
}
