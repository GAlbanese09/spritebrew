/**
 * Onion skin for the pixel editor (W2, competitive push; HQ 2026-11-03-007
 * and -021). While a person edits one frame of an animation, the frames
 * before and after it show faintly behind it, as Aseprite does: previous
 * frames tinted red, next frames tinted blue, fainter the further away.
 *
 * The editor holds one frame at a time, so the caller that knows the
 * animation (FrameGrid on /upload) picks the neighbours (onionNeighbours)
 * and the editor draws them on a layer behind the frame (onionLayer). The
 * layer is only drawn on screen: it never enters the frame's pixels, the
 * undo history or a saved file.
 *
 * Pure, on RGBA data, so it is tested offline (scripts/onion-skin-test.mjs).
 */

/** The most frames shown on each side. */
export const ONION_MAX = 3;
/** Defaults: one back, one ahead, at 40% (HQ 2026-11-03-021). */
export const ONION_DEFAULT_BACK = 1;
export const ONION_DEFAULT_AHEAD = 1;
export const ONION_DEFAULT_OPACITY = 0.4;
/** Tints, Aseprite's convention: previous frames red, next frames blue. */
export const ONION_TINT_BACK: readonly [number, number, number] = [255, 64, 64];
export const ONION_TINT_AHEAD: readonly [number, number, number] = [64, 128, 255];
/** How much of a pixel's colour gives way to the tint. */
export const ONION_TINT_STRENGTH = 0.6;
/** Each step further from the edited frame keeps this share of the
 *  opacity of the step before (1, 0.6, 0.36). */
export const ONION_FALLOFF = 0.6;

/** The frames around one frame of an animation, nearest first. */
export interface OnionNeighbours<T> {
  back: T[];
  ahead: T[];
}

/**
 * The up-to-`max` frames before and after `frameId` in `frames`, nearest
 * first, without wrapping round the ends. Found by id, so two frames that
 * look alike are never confused. Empty when the frame is not in the list.
 */
export function onionNeighbours<T extends { id: string }>(
  frames: readonly T[],
  frameId: string,
  max: number = ONION_MAX
): OnionNeighbours<T> {
  const i = frames.findIndex((f) => f.id === frameId);
  if (i < 0) return { back: [], ahead: [] };
  const n = Math.max(0, Math.floor(max));
  const back: T[] = [];
  const ahead: T[] = [];
  for (let d = 1; d <= n; d++) {
    if (i - d >= 0) back.push(frames[i - d]);
    if (i + d < frames.length) ahead.push(frames[i + d]);
  }
  return { back, ahead };
}

/** A decoded neighbour frame: RGBA bytes and its size. */
export interface OnionFrame {
  pixels: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface OnionOptions {
  /** How many back and ahead frames to show (each clamped to 0..ONION_MAX). */
  back: number;
  ahead: number;
  /** Opacity of the nearest frames, 0 to 1. */
  opacity: number;
}

/**
 * The onion layer for a W x H frame, as W x H RGBA. `frames.back` and
 * `frames.ahead` are nearest first. Each shown frame is tinted (red back,
 * blue ahead), its alpha scaled by the opacity and the falloff for its
 * distance, and composited far to near, so the nearest frames sit on top.
 * A frame whose size is not W x H is skipped. Fully transparent where no
 * neighbour has a pixel.
 */
export function onionLayer(
  frames: OnionNeighbours<OnionFrame | null>,
  W: number,
  H: number,
  opts: OnionOptions
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(W * H * 4);
  const clampCount = (v: number) => Math.max(0, Math.min(ONION_MAX, Math.floor(Number.isFinite(v) ? v : 0)));
  const nBack = clampCount(opts.back);
  const nAhead = clampCount(opts.ahead);
  const opacity = Math.max(0, Math.min(1, Number.isFinite(opts.opacity) ? opts.opacity : 0));
  if (W <= 0 || H <= 0 || opacity === 0) return out;

  // Far to near; at each distance, back then ahead.
  const layers: { f: OnionFrame; tint: readonly [number, number, number]; a: number }[] = [];
  for (let d = Math.max(nBack, nAhead); d >= 1; d--) {
    const a = opacity * Math.pow(ONION_FALLOFF, d - 1);
    const b = d <= nBack ? frames.back[d - 1] : null;
    const f = d <= nAhead ? frames.ahead[d - 1] : null;
    if (b && b.width === W && b.height === H && b.pixels.length >= W * H * 4) layers.push({ f: b, tint: ONION_TINT_BACK, a });
    if (f && f.width === W && f.height === H && f.pixels.length >= W * H * 4) layers.push({ f, tint: ONION_TINT_AHEAD, a });
  }

  const k = ONION_TINT_STRENGTH;
  for (const { f, tint, a } of layers) {
    const px = f.pixels;
    for (let i = 0; i < W * H * 4; i += 4) {
      const sa = (px[i + 3] / 255) * a;
      if (sa <= 0) continue;
      const sr = px[i] * (1 - k) + tint[0] * k;
      const sg = px[i + 1] * (1 - k) + tint[1] * k;
      const sb = px[i + 2] * (1 - k) + tint[2] * k;
      // Source over, on non-premultiplied bytes.
      const da = out[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      out[i] = Math.round((sr * sa + out[i] * da * (1 - sa)) / oa);
      out[i + 1] = Math.round((sg * sa + out[i + 1] * da * (1 - sa)) / oa);
      out[i + 2] = Math.round((sb * sa + out[i + 2] * da * (1 - sa)) / oa);
      out[i + 3] = Math.round(oa * 255);
    }
  }
  return out;
}

/**
 * Decodes the neighbour images with the caller's decoder (the browser's
 * image decode in the editor, a stand-in in tests), keeping each frame's
 * place. A source that is null or fails to decode becomes null, which
 * onionLayer skips. Returns null instead when `isCurrent()` is false once
 * the decodes finish (the editor closed, or other neighbours arrived), so a
 * late result never lands on a newer visit.
 */
export async function decodeOnionSources(
  sources: OnionNeighbours<string | null>,
  decode: (url: string) => Promise<OnionFrame>,
  isCurrent: () => boolean
): Promise<OnionNeighbours<OnionFrame | null> | null> {
  const one = async (url: string | null): Promise<OnionFrame | null> => {
    if (!url) return null;
    try {
      return await decode(url);
    } catch {
      return null;
    }
  };
  const [back, ahead] = await Promise.all([
    Promise.all(sources.back.map(one)),
    Promise.all(sources.ahead.map(one)),
  ]);
  return isCurrent() ? { back, ahead } : null;
}

/**
 * The frame list onion skin reads neighbours from: the edited frame's own
 * group when it sits exactly once in exactly one group (a direction row of a
 * 4-direction sheet), otherwise the sheet's own list that holds it (slice
 * order). Groups may repeat a frame (ping-pong cycles); a frame repeated or
 * shared is ambiguous, so the sheet's order is used. Null when no list
 * holds the frame.
 */
export function onionFrameList<T extends { id: string }>(
  groups: readonly { frames: readonly T[] }[],
  sheetLists: readonly { frames: readonly T[] }[],
  frameId: string
): readonly T[] | null {
  const holders = groups.filter((g) => g.frames.some((f) => f.id === frameId));
  if (holders.length === 1 && holders[0].frames.filter((f) => f.id === frameId).length === 1) return holders[0].frames;
  return sheetLists.find((a) => a.frames.some((f) => f.id === frameId))?.frames ?? null;
}
