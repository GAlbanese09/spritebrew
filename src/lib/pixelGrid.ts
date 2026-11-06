/**
 * "Fix pixel grid" in /editor: the guard, the limits and the copy. Pure: no
 * DOM and no worker, so scripts/pixel-grid-test.mjs runs it in node.
 *
 * The fixer (wasm/pixel-grid) always finds a grid, because its smallest step
 * is 2 px: given art that is already clean it invents one and damages the art
 * (the w3 spike's report). The guard is the answer: true fake pixel art,
 * scaled back up from the fixed image, reproduces the input; clean art
 * reduced to an invented grid does not.
 */

/**
 * A fixed image that reproduces less than this share of the input is not a
 * fix. Halfway between the two groups measured on Nov 6, 2026 (W3 step 5):
 * fake pixel art scored 0.8086 to 1.0000 (the lowest is the fixer's dragon
 * example), clean sheets 0.1254 to 0.7998 (the highest is a sheet stored at
 * 2x, which the fixer took to 261 x 258). The gap is small: 0.0088.
 */
export const ROUND_TRIP_MIN = 0.804212;

/** How far apart two colours may be and still count as the same, as the
 *  largest difference on one RGB channel. Blur and JPEG leave colours close,
 *  not restored, so an exact match would fail real fake pixel art. */
export const ROUND_TRIP_TOLERANCE = 24;

/** The smallest side the fixer takes (the same in wasm/pixel-grid). */
export const MIN_SIDE = 16;

/** The most pixels the fixer takes (the same in wasm/pixel-grid). */
export const PIXEL_GRID_MAX_PIXELS = 4_000_000;

/** The cap on a device that reports 4 GB of memory or less: at the full cap
 *  the fixer's WebAssembly memory peaks near 280 MB. */
export const PIXEL_GRID_LOW_MEMORY_PIXELS = 2_000_000;

/**
 * The share of input pixels with alpha > 0 whose RGB is within
 * ROUND_TRIP_TOLERANCE of the output cell they map to (cell x =
 * floor(x * outW / inW), the same for y). 1 means the fixed image, scaled back
 * up, reproduces the input. An image with no visible pixel scores 0: there is
 * nothing to fix in it.
 */
export function roundTripScore(
  input: Uint8ClampedArray,
  inW: number,
  inH: number,
  output: Uint8ClampedArray,
  outW: number,
  outH: number,
): number {
  let visible = 0;
  let matched = 0;
  for (let y = 0; y < inH; y++) {
    const cellRow = Math.floor((y * outH) / inH) * outW;
    for (let x = 0; x < inW; x++) {
      const i = (y * inW + x) * 4;
      if (input[i + 3] === 0) continue;
      visible++;
      const o = (cellRow + Math.floor((x * outW) / inW)) * 4;
      const worst = Math.max(
        Math.abs(input[i] - output[o]),
        Math.abs(input[i + 1] - output[o + 1]),
        Math.abs(input[i + 2] - output[o + 2]),
      );
      if (worst <= ROUND_TRIP_TOLERANCE) matched++;
    }
  }
  return visible === 0 ? 0 : matched / visible;
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
export const FIX_GRID_RUNNING = 'Fixing the pixel grid...';
export const FIX_GRID_TOO_SMALL = 'This image is too small to need fixing.';
export const FIX_GRID_ALREADY_CLEAN = 'This already looks like clean pixel art. Nothing changed.';
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

export function fixGridBanner(inW: number, inH: number, outW: number, outH: number): string {
  return `Pixel grid fixed: ${fixGridSizes(inW, inH, outW, outH)}.`;
}
