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
