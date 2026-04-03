let _idCounter = 0;

export function generateFrameId(): string {
  return `frame-${Date.now()}-${_idCounter++}`;
}

export function generateAnimationId(): string {
  return `anim-${Date.now()}-${_idCounter++}`;
}

/**
 * Analyze an image to detect frame grid dimensions.
 * Scans for consistent transparent/uniform-color gutters between frames.
 */
export function detectFrameGrid(
  imageData: ImageData
): { width: number; height: number; columns: number; rows: number } | null {
  const { width, height, data } = imageData;

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

  // Find vertical gutters (transparent columns)
  const vGutters: number[] = [];
  for (let x = 1; x < width - 1; x++) {
    if (isTransparentColumn(x)) {
      vGutters.push(x);
    }
  }

  // Find horizontal gutters (transparent rows)
  const hGutters: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    if (isTransparentRow(y)) {
      hGutters.push(y);
    }
  }

  // Extract consistent spacing from gutter positions
  const frameWidth = detectConsistentSpacing(vGutters, width);
  const frameHeight = detectConsistentSpacing(hGutters, height);

  if (frameWidth && frameHeight) {
    return {
      width: frameWidth,
      height: frameHeight,
      columns: Math.floor(width / frameWidth),
      rows: Math.floor(height / frameHeight),
    };
  }

  // Fallback: try common sizes that evenly divide the image
  const commonSizes = [128, 64, 48, 32, 24, 16];
  for (const size of commonSizes) {
    if (width % size === 0 && height % size === 0) {
      return {
        width: size,
        height: size,
        columns: width / size,
        rows: height / size,
      };
    }
  }

  // Try non-square common sizes
  for (const w of commonSizes) {
    for (const h of commonSizes) {
      if (w !== h && width % w === 0 && height % h === 0) {
        return { width: w, height: h, columns: width / w, rows: height / h };
      }
    }
  }

  // Last resort: treat as 32x32
  return {
    width: 32,
    height: 32,
    columns: Math.max(1, Math.floor(width / 32)),
    rows: Math.max(1, Math.floor(height / 32)),
  };
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
