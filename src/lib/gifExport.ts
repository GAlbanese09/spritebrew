/**
 * Animated GIF export (Wave 1 addendum A2). Encodes frames with gifenc as a
 * looping GIF with one shared palette and a 1-bit transparent index.
 *
 * gifDelaysCs and scaledSize are pure. encodeGif needs only Blob, so it runs
 * in node too when given ImageData-shaped frames; framesFromSheet and canvas
 * frames need a DOM.
 */

import { GIFEncoder, quantize, applyPalette, type GifPalette } from 'gifenc';
import type { SheetGeometry } from '@/lib/animationGeometry';

export const GIF_SCALES = [1, 2, 4, 8] as const;
export type GifScale = (typeof GIF_SCALES)[number];
export const GIF_SCALE_DEFAULT: GifScale = 4;

/** GIF players clamp shorter delays (often to 10 cs), so none go below this. */
const MIN_DELAY_CS = 2;
/** Alpha at or above this is opaque; below it is the transparent index. */
const ALPHA_CUTOFF = 128;
/** Palette slot 0 is the transparent index; opaque colors take 1..255. */
const TRANSPARENT_INDEX = 0;
const MAX_OPAQUE_COLORS = 255;

/**
 * Per-frame delays in centiseconds. Each delay is the difference of the
 * rounded running total, so the total tracks count * 100 / fps: 8 fps gives
 * 13, 12, 13, 12 and a total of 50 cs every 4 frames. Never below 2 cs. A
 * non-positive or non-numeric fps falls back to 8.
 */
export function gifDelaysCs(fps: number, count: number): number[] {
  const f = Number.isFinite(fps) && fps > 0 ? fps : 8;
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const delays: number[] = [];
  for (let i = 0; i < n; i++) {
    const step = Math.round(((i + 1) * 100) / f) - Math.round((i * 100) / f);
    delays.push(Math.max(MIN_DELAY_CS, step));
  }
  return delays;
}

export function isGifScale(scale: number): scale is GifScale {
  return (GIF_SCALES as readonly number[]).includes(scale);
}

/** Output size at an integer scale. Throws for a scale other than 1, 2, 4 or 8. */
export function scaledSize(w: number, h: number, scale: number): { w: number; h: number } {
  if (!isGifScale(scale)) throw new RangeError(`GIF scale must be 1, 2, 4 or 8, got ${scale}`);
  return { w: w * scale, h: h * scale };
}

interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type GifFrameSource = ImageData | HTMLCanvasElement;

function toRgba(frame: GifFrameSource): RgbaFrame {
  if (typeof (frame as HTMLCanvasElement).getContext === 'function') {
    const canvas = frame as HTMLCanvasElement;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D context for a GIF frame');
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
  const img = frame as ImageData;
  // gifenc reads the whole buffer as 32-bit pixels, so hand it an exact copy
  // when the data is a view into a larger buffer.
  const data =
    img.data.byteOffset === 0 && img.data.byteLength === img.data.buffer.byteLength
      ? img.data
      : new Uint8ClampedArray(img.data);
  return { width: img.width, height: img.height, data };
}

/** One palette for every frame, so colors do not shift between frames.
 *  Exact when the opaque pixels hold 255 colors or fewer; quantized
 *  otherwise. Returns the opaque colors (slot 0 not included). */
function sharedPalette(frames: RgbaFrame[]): { colors: GifPalette; exact: Map<number, number> | null } {
  const exact = new Map<number, number>();
  let opaqueCount = 0;
  let overflow = false;
  for (const { data } of frames) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < ALPHA_CUTOFF) continue;
      opaqueCount++;
      if (overflow) continue;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      if (!exact.has(key)) {
        if (exact.size === MAX_OPAQUE_COLORS) overflow = true;
        else exact.set(key, exact.size + 1);
      }
    }
  }
  if (!overflow) {
    const colors: GifPalette = [];
    for (const key of exact.keys()) colors.push([(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);
    return { colors, exact };
  }
  // Quantize the opaque pixels of all frames together.
  const opaque = new Uint8Array(opaqueCount * 4);
  let o = 0;
  for (const { data } of frames) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < ALPHA_CUTOFF) continue;
      opaque[o] = data[i];
      opaque[o + 1] = data[i + 1];
      opaque[o + 2] = data[i + 2];
      opaque[o + 3] = 255;
      o += 4;
    }
  }
  return { colors: quantize(opaque, MAX_OPAQUE_COLORS).slice(0, MAX_OPAQUE_COLORS), exact: null };
}

/** Palette indexes for one frame at native size: 0 for alpha below the
 *  cutoff, else 1 + the opaque color's slot. */
function indexFrame(frame: RgbaFrame, colors: GifPalette, exact: Map<number, number> | null): Uint8Array {
  const { data } = frame;
  const px = data.length / 4;
  const out = new Uint8Array(px);
  if (exact) {
    for (let p = 0, i = 0; p < px; p++, i += 4) {
      out[p] =
        data[i + 3] < ALPHA_CUTOFF
          ? TRANSPARENT_INDEX
          : exact.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])!;
    }
    return out;
  }
  const mapped = applyPalette(data, colors);
  for (let p = 0, i = 3; p < px; p++, i += 4) {
    out[p] = data[i] < ALPHA_CUTOFF ? TRANSPARENT_INDEX : mapped[p] + 1;
  }
  return out;
}

/** Nearest-neighbor integer upscale of an index buffer. */
function scaleIndex(src: Uint8Array, w: number, h: number, s: number): Uint8Array {
  if (s === 1) return src;
  const outW = w * s;
  const out = new Uint8Array(outW * h * s);
  for (let y = 0; y < h; y++) {
    const rowStart = y * s * outW;
    for (let x = 0; x < w; x++) {
      const start = rowStart + x * s;
      out.fill(src[y * w + x], start, start + s);
    }
    for (let r = 1; r < s; r++) out.copyWithin(rowStart + r * outW, rowStart, rowStart + outW);
  }
  return out;
}

/**
 * Encodes frames as a GIF that loops forever. Every frame must be the same
 * size. Throws on bad input; callers show their own error.
 */
export function encodeGif(frames: readonly GifFrameSource[], opts: { scale: number; fps: number }): Blob {
  if (frames.length === 0) throw new Error('No frames to encode');
  const { scale } = opts;
  if (!isGifScale(scale)) throw new RangeError(`GIF scale must be 1, 2, 4 or 8, got ${scale}`);

  // A frame repeated in the order (duplicates) is read and indexed once.
  const unique = new Map<GifFrameSource, number>();
  const rgba: RgbaFrame[] = [];
  const slots = frames.map((f) => {
    let slot = unique.get(f);
    if (slot === undefined) {
      slot = rgba.length;
      unique.set(f, slot);
      rgba.push(toRgba(f));
    }
    return slot;
  });
  const { width, height } = rgba[0];
  if (width < 1 || height < 1) throw new Error('GIF frames must not be empty');
  if (rgba.some((f) => f.width !== width || f.height !== height)) {
    throw new Error('GIF frames must all be the same size');
  }
  const out = scaledSize(width, height, scale);

  const { colors, exact } = sharedPalette(rgba);
  const palette: GifPalette = [[0, 0, 0], ...colors];
  const indexed = rgba.map((f) => indexFrame(f, colors, exact));
  const delays = gifDelaysCs(opts.fps, frames.length);

  const gif = GIFEncoder();
  slots.forEach((slot, i) => {
    gif.writeFrame(scaleIndex(indexed[slot], width, height, scale), out.w, out.h, {
      // Only the first frame carries the palette, as the global color table;
      // later frames reuse it, so no frame gets a local table.
      palette: i === 0 ? palette : undefined,
      // gifenc takes milliseconds and writes Math.round(ms / 10) cs.
      delay: delays[i] * 10,
      transparent: true,
      transparentIndex: TRANSPARENT_INDEX,
      repeat: 0,
    });
  });
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}

/**
 * Cuts frames from a sheet, read row-major, in the given order. Indexes may
 * repeat; a repeated index returns the same ImageData. Indexes outside the
 * sheet are skipped.
 */
export function framesFromSheet(
  src: CanvasImageSource,
  geometry: Pick<SheetGeometry, 'frameW' | 'frameH' | 'cols' | 'frames'>,
  order: readonly number[]
): ImageData[] {
  const { frameW, frameH, cols, frames } = geometry;
  const canvas = document.createElement('canvas');
  canvas.width = frameW;
  canvas.height = frameH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D context to cut GIF frames');
  ctx.imageSmoothingEnabled = false;
  const cut = new Map<number, ImageData>();
  const out: ImageData[] = [];
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= frames) continue;
    let frame = cut.get(index);
    if (!frame) {
      ctx.clearRect(0, 0, frameW, frameH);
      const sx = (index % cols) * frameW;
      const sy = Math.floor(index / cols) * frameH;
      ctx.drawImage(src, sx, sy, frameW, frameH, 0, 0, frameW, frameH);
      frame = ctx.getImageData(0, 0, frameW, frameH);
      cut.set(index, frame);
    }
    out.push(frame);
  }
  return out;
}
