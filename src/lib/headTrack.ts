/**
 * Head tracking for Align: where each frame's head sits, relative to one
 * reference frame, found by matching the reference frame's head patch in
 * every other frame. A paint-weighted center follows a plume, cape, hair, arm
 * or blade that swings with the stride; this does not: each pixel of the
 * patch counts for an offset when it lands on a pixel of nearly the same
 * colour there, and the offset with the most such pixels wins. Pixels of a
 * part that swung elsewhere only fail to count; they cannot pull the offset.
 *
 * It says when it is not sure, and the caller then reads the paint-weighted
 * head as before: too few pixels to match for the body's size ('few'); a best offset that matches
 * too little of the patch, as when the head turns or changes shape ('shape');
 * a second peak a few pixels away that matches nearly as well ('rival'); a
 * best offset at the edge of the search ('reach'); or a head that moves 2 px
 * or more apart from the head and shoulders tracked the same way, so that
 * something in the head's patch swings on its own ('split').
 *
 * Pure: no React, no DOM, no dependencies, deterministic. Cost per frame: at
 * most `maxSamples` patch pixels against the offsets searched, and an offset
 * that falls well behind the best is dropped after a few dozen pixels.
 */

export type TrackFrame = { data: Uint8ClampedArray; width: number; height: number };
/** What the tracker reads from a body (BodyMeasure has all three): its first
 *  and last rows and the paint-weighted center column of its top quarter. */
export type TrackBody = { topRow: number; feetRow: number; headCol: number };
/** Whole pixels from the reference frame's head. `match` is the share of the
 *  patch's pixels that landed on nearly the same colour there. */
export type HeadOffset = { dx: number; dy: number; match: number };
/** Why a track is not sure. */
export type HeadDoubt = 'few' | 'shape' | 'rival' | 'reach' | 'split';
export interface HeadTrack {
  /** One per frame: null for a frame with no body to track. */
  offsets: (HeadOffset | null)[];
  /** True when every frame with a body matched surely; read the offsets only then. */
  sure: boolean;
  /** The first doubt met, or null when sure. */
  doubt: HeadDoubt | null;
  /** The reference frame's index, or -1 when no frame has a body. */
  reference: number;
}

export const HEAD_TRACK = {
  /** A pixel takes part when its alpha is at least this. */
  solidAlpha: 128,
  /** Nearly the same colour: the red, green and blue differences summed. */
  nearColour: 48,
  /** The patch: this share of the body's height down from its top row, and
   *  this share of it either side of the head column. */
  patchTo: 0.25,
  patchHalf: 0.25,
  /** At most this many patch pixels are matched, spread over the patch. */
  maxSamples: 256,
  /** A patch with fewer solid pixels than this: not sure ('few'). The number
   *  falls with a small body, to this share of its height in pixels and never
   *  under the floor, so a 16 px character's head, a dozen pixels or so, can
   *  be tracked (AUDIT align-walk-r2, M2-A). */
  minSamples: 24,
  minSamplesShare: 0.5,
  minSamplesFloor: 8,
  /** The best offset must match at least this share of the patch ('shape'). */
  minMatch: 0.5,
  /** A second peak at least this far away in x or y, matching at least this
   *  share of the best's count: not sure ('rival'). */
  rivalDistance: 3,
  rivalShare: 0.9,
  /** The search reaches this share of the body's height (within these
   *  bounds) around no move and around where the frame's own head column and
   *  feet row put the head. */
  reachShare: 1 / 24,
  minReach: 4,
  maxReach: 12,
  /** The second opinion: the body's top this share (the head and shoulders;
   *  0 for none), tracked the same way. Sure, and this far apart or more from
   *  the head in some frame: not sure ('split'). */
  twin: 0.4,
  twinApart: 2,
  /** Every this many pixels, an offset this far below a rival's share is dropped. */
  checkEvery: 32,
  slack: 0.2,
};
export type HeadTrackTuning = typeof HEAD_TRACK;

/** The golden ratio's fraction: a stride near it spreads any prefix of the pick. */
const GOLDEN = 0.6180339887498949;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Tracks the head through `frames` (all of one size). A null `bodies[i]`
 * skips frame i (no body, left out, or filling its cell). The reference is
 * the first frame with a body; its patch is the top quarter of its body's
 * rows, a quarter of its height either side of its head column, solid pixels
 * only.
 */
export function trackHeads(
  frames: TrackFrame[],
  bodies: (TrackBody | null)[],
  tuning: Partial<HeadTrackTuning> = {},
): HeadTrack {
  const t = { ...HEAD_TRACK, ...tuning };
  const offsets: (HeadOffset | null)[] = frames.map(() => null);
  const reference = bodies.findIndex((body) => body !== null);
  if (reference < 0) return { offsets, sure: false, doubt: 'few', reference };
  offsets[reference] = { dx: 0, dy: 0, match: 1 };
  const body = bodies[reference]!;
  const { data: refData, width, height: rows } = frames[reference];
  const height = body.feetRow - body.topRow + 1;
  const half = Math.max(2, Math.ceil(height * t.patchHalf));
  const mid = Math.round(body.headCol);
  const left = Math.max(0, mid - half), right = Math.min(width - 1, mid + half);
  const top = Math.max(0, body.topRow);
  const bottom = Math.min(rows - 1, body.feetRow, body.topRow + Math.max(2, Math.ceil(height * t.patchTo)) - 1);

  // The patch's solid pixels, then a pick of at most maxSamples in a stride
  // order near the golden ratio, so that any first part covers the whole patch.
  const solid: number[] = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) if (refData[(y * width + x) * 4 + 3] >= t.solidAlpha) solid.push(y * width + x);
  }
  const enough = Math.min(t.minSamples, Math.max(t.minSamplesFloor, Math.ceil(height * t.minSamplesShare)));
  if (solid.length < enough) return { offsets, sure: false, doubt: 'few', reference };
  const total = solid.length;
  let stride = Math.max(1, Math.round(total * GOLDEN));
  while (gcd(stride, total) !== 1) stride++;
  const count = Math.min(total, t.maxSamples);
  const at = new Int32Array(count), px = new Int32Array(count), py = new Int32Array(count);
  const pr = new Int32Array(count), pg = new Int32Array(count), pb = new Int32Array(count);
  let minX = width, maxX = 0, minY = rows, maxY = 0;
  for (let k = 0; k < count; k++) {
    const p = solid[(k * stride) % total];
    const x = p % width, y = (p - x) / width;
    at[k] = p * 4; px[k] = x; py[k] = y;
    pr[k] = refData[p * 4]; pg[k] = refData[p * 4 + 1]; pb[k] = refData[p * 4 + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }

  const reach = Math.min(t.maxReach, Math.max(t.minReach, Math.ceil(height * t.reachShare)));
  let doubt: HeadDoubt | null = null;
  for (let f = 0; f < frames.length && !doubt; f++) {
    const own = bodies[f];
    if (f === reference || !own) continue;
    if (frames[f].width !== width || frames[f].height !== rows) { doubt = 'shape'; break; }
    const { data } = frames[f];
    // Look around no move and around where the frame's own head column and
    // feet row put the head, so neither a pulled column nor a step hides it.
    const gx = Math.round(own.headCol - body.headCol), gy = own.feetRow - body.feetRow;
    const x0 = Math.min(0, gx) - reach, x1 = Math.max(0, gx) + reach;
    const y0 = Math.min(0, gy) - reach, y1 = Math.max(0, gy) + reach;
    const side = x1 - x0 + 1;
    const votes = new Int32Array(side * (y1 - y0 + 1)).fill(-1);
    let best = -1, bx = 0, by = 0;
    const test = (dx: number, dy: number) => {
      // A rival needs rivalShare of the best: an offset that cannot reach it
      // is dropped, at once when the pixels left cannot lift it there, or at
      // a check when it runs well behind.
      const floor = t.rivalShare * best;
      const pace = floor / count - t.slack;
      const inside = minX + dx >= 0 && maxX + dx < width && minY + dy >= 0 && maxY + dy < rows;
      const shift = (dy * width + dx) * 4;
      let hits = 0;
      for (let n = 0; n < count; n++) {
        if (hits + (count - n) < floor || (n > 0 && n % t.checkEvery === 0 && hits < pace * n)) return;
        if (!inside) {
          const x = px[n] + dx, y = py[n] + dy;
          if (x < 0 || y < 0 || x >= width || y >= rows) continue;
        }
        const i = at[n] + shift;
        if (data[i + 3] >= t.solidAlpha
          && Math.abs(data[i] - pr[n]) + Math.abs(data[i + 1] - pg[n]) + Math.abs(data[i + 2] - pb[n]) <= t.nearColour) hits++;
      }
      votes[(dy - y0) * side + (dx - x0)] = hits;
      if (hits > best) { best = hits; bx = dx; by = dy; }
    };
    // Rings around the guess, nearest first, so the best is found early and
    // most offsets are dropped; a tie keeps the nearer offset.
    const rings = Math.max(gx - x0, x1 - gx, gy - y0, y1 - gy);
    for (let r = 0; r <= rings; r++) {
      for (let dy = Math.max(y0, gy - r); dy <= Math.min(y1, gy + r); dy++) {
        const edge = dy === gy - r || dy === gy + r;
        for (let dx = gx - r; dx <= gx + r; dx += edge || r === 0 ? 1 : 2 * r) if (dx >= x0 && dx <= x1) test(dx, dy);
      }
    }
    offsets[f] = { dx: bx, dy: by, match: best / count };
    if (best < t.minMatch * count) doubt = 'shape';
    else if (bx === x0 || bx === x1 || by === y0 || by === y1) doubt = 'reach';
    else {
      // A rival: a peak (no neighbour counts more) far enough from the best.
      const vote = (dx: number, dy: number) =>
        (dx < x0 || dx > x1 || dy < y0 || dy > y1 ? -1 : votes[(dy - y0) * side + (dx - x0)]);
      for (let dy = y0; dy <= y1 && !doubt; dy++) {
        for (let dx = x0; dx <= x1 && !doubt; dx++) {
          const v = vote(dx, dy);
          if (v < t.rivalShare * best || Math.max(Math.abs(dx - bx), Math.abs(dy - by)) < t.rivalDistance) continue;
          let peak = true;
          for (let ny = dy - 1; ny <= dy + 1 && peak; ny++) for (let nx = dx - 1; nx <= dx + 1; nx++) if (vote(nx, ny) > v) peak = false;
          if (peak) doubt = 'rival';
        }
      }
    }
  }
  if (!doubt && t.twin > 0) {
    const second = trackHeads(frames, bodies, { ...tuning, patchTo: t.twin, twin: 0 });
    const apart = (a: HeadOffset | null, b: HeadOffset | null) =>
      !!a && !!b && Math.max(Math.abs(a.dx - b.dx), Math.abs(a.dy - b.dy)) >= t.twinApart;
    // The second opinion counts wherever it found an offset, sure of the
    // whole set or not: a head patch that mostly holds a plume is followed
    // surely and wrongly, and the taller patch is what shows it.
    if (offsets.some((offset, f) => apart(offset, second.offsets[f]))) doubt = 'split';
  }
  return { offsets, sure: doubt === null, doubt, reference };
}
