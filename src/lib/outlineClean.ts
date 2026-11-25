/**
 * The white outline clean (George, Nov 24, 2026: "there's a white outline
 * around the sprite.... This should be removalable with the background
 * removal and with the editor"; DESIGN's ticket design/tickets/outline-clean.md).
 *
 * Retro Diffusion's Classic Pixel Art style sometimes returns a sprite on a
 * white sticker: one solid near-white colour around the art, a few pixels
 * thick, filling the hollows between the art and its ground, on a
 * transparent background (ENG 2026-11-24-152). The page's Remove background
 * already sees the image as done, so nothing took it off.
 *
 * The idea is #86's: what touches the outside is not the character.
 * - The ring colour: the most common exact colour among the near-white
 *   pixels on the art's outer edge (visible pixels next to a fully
 *   transparent pixel or the image edge). A sticker is one flat colour;
 *   white art is shaded, so its other shades are not taken.
 * - It must look like a ring: pixels of that colour (within
 *   OUTLINE_MATCH) cover at least OUTLINE_EDGE_SHARE of the outer edge.
 *   Below that it is white art at the edge (a shirt, snow) and nothing is
 *   offered.
 * - It must be as thin as a ring (the ticket's thickness T): the depth, in
 *   4-way steps from the outside through near-white pixels, at which that
 *   near-white run meets the art most often is at most
 *   OUTLINE_MAX_THICKNESS. A thick white border is not a ring.
 * - It must hug the art, as a sticker does: at least OUTLINE_HUG of the
 *   ring colour's outer edge lies within T + OUTLINE_SLACK px (chessboard
 *   steps) of the art (visible pixels that are not near-white). A white
 *   sprite with no dark outline (a cat, a cloud) has most of its edge far
 *   from any art, so nothing is offered (AUDIT, outline clean r1, M1).
 * - The outline is two parts, 4-way from the outside:
 *   - any near-white reached through near-white, as deep as T: the
 *     ticket's rule, which also takes the sticker's lighter fringe;
 *   - deeper, the ring colour reached through the ring colour, one
 *     connected patch at a time, and only a patch shaped like a hollow the
 *     sticker fills (patchShape): narrow, with its holes filled, so no
 *     pixel of it lies more than T from its edge (a sticker T thick fills a
 *     gap no wider than 2T); and open onto the shell along its width (it
 *     touches the shell along at least as many pixels as that half-width). The sticker is the art grown by
 *     T, so the hollows under the arms and between the legs (9 to 44 px
 *     deep on George's two ringed sprites, Nov 18) go. White art reached
 *     through a gap in the dark outline meets the shell only at the gap,
 *     and buttons, a fold or texture drawn inside it do not make it narrow,
 *     so it stays (AUDIT r1, r2 and r3, M1).
 *   4-way steps cannot slip between two dark pixels into the art, so white
 *   eyes, highlights and a white shirt inside a closed dark outline are
 *   never reached, and neither is a patch of the sticker the art closes in.
 * - It must not be nearly the whole picture: a clean that would take more
 *   than OUTLINE_MAX_SHARE of the visible pixels is not offered (M1's
 *   backstop).
 *
 * Known limit: white art next to the sticker goes with it when it is within
 * T of the outside, or in the ring's own colour, no wider than 2T and open
 * to the ring along its width (a strap 1 or 2 px wide behind a gap as wide,
 * or a white body that narrow inside its own line). A sticker that thick
 * would fill such a gap, so the two cannot be told apart.
 * Show where and Undo are its guard, as with #86.
 *
 * Pure, on RGBA data, so it is tested offline. The editor's "Erase area"
 * flood is here too (floodRegion).
 */

/** Near-white: every channel at least this much. */
export const OUTLINE_MIN = 215;
/** Near-white: no channel more than this from another. */
export const OUTLINE_SPREAD = 30;
/** How close (per channel) a pixel must be to the ring colour to be the
 *  ring's. */
export const OUTLINE_MATCH = 8;
/** The share of the art's outer edge the ring colour must cover. */
export const OUTLINE_EDGE_SHARE = 0.6;
/** The thickest a ring may be, in px; a thicker white border is not a ring. */
export const OUTLINE_MAX_THICKNESS = 12;
/** How far past the ring's thickness, in px, a sticker's outer edge may lie
 *  from the art for the hug test (its corners and soft edges). */
export const OUTLINE_SLACK = 2;
/** The share of the ring colour's outer edge that must lie within
 *  T + OUTLINE_SLACK of the art. */
export const OUTLINE_HUG = 0.8;
/** The most of the visible pixels a clean may take: never nearly the whole
 *  picture. A thick sticker round small art can be three quarters of it
 *  (12 px round 20 by 24 is 77%), so the line sits above that. */
export const OUTLINE_MAX_SHARE = 0.9;

/** A pixel the outline clean takes (same value as RESIDUE_CLEAR, so
 *  residueOverlay marks it in the same cyan). */
export const OUTLINE_CLEAR = 1;

/** Whether a colour is near-white. */
export function isNearWhite(r: number, g: number, b: number): boolean {
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b);
  return lo >= OUTLINE_MIN && hi - lo <= OUTLINE_SPREAD;
}

export interface OutlineScan {
  /** One entry per pixel: OUTLINE_CLEAR for the outline, 0 elsewhere. */
  kinds: Uint8Array;
  /** How many pixels the clean takes (0 when nothing is offered). */
  count: number;
  /** The ring colour, or null when the outer edge has no near-white. */
  colour: readonly [number, number, number] | null;
  /** The share of the outer edge in the ring colour (0 to 1). */
  edgeShare: number;
  /** The ring's thickness: the most common depth at which it meets the art
   *  (0 when it never does). */
  thickness: number;
  /** The share of the ring colour's outer edge within T + OUTLINE_SLACK of
   *  the art (0 until the thickness test passes). */
  hug: number;
}

const close = (px: Uint8ClampedArray | Uint8Array, i: number, c: readonly [number, number, number]) =>
  Math.abs(px[i] - c[0]) <= OUTLINE_MATCH && Math.abs(px[i + 1] - c[1]) <= OUTLINE_MATCH && Math.abs(px[i + 2] - c[2]) <= OUTLINE_MATCH;

/**
 * The shape of one deep patch of the ring colour (pixel indices in a W x H
 * image), for the sticker test (AUDIT, outline clean r2, M1):
 * - half: how far its farthest pixel lies from the edge of the patch, in
 *   chessboard steps, with its holes filled (anything the patch closes in
 *   counts as patch, so buttons, a fold line or texture drawn inside white
 *   art do not make it look narrow).
 * - mouth: how many of its pixels touch the shell (inShell), 4-way: the
 *   width of the opening it shares with the ring.
 * A hollow the sticker fills is narrow and opens onto the ring along its
 * width; white art behind a gap in the outline is wider, or meets the ring
 * only at the gap.
 */
export function patchShape(
  patch: readonly number[],
  W: number,
  H: number,
  inShell: (q: number) => boolean,
): { half: number; mouth: number } {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const p of patch) {
    const x = p % W;
    const y = (p - x) / W;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { half: 0, mouth: 0 };
  // A box one pixel wider all round, so its border is outside the patch.
  const bw = x1 - x0 + 3;
  const bh = y1 - y0 + 3;
  const ox = x0 - 1;
  const oy = y0 - 1;
  const inP = new Uint8Array(bw * bh);
  let mouth = 0;
  for (const p of patch) {
    const x = p % W;
    const y = (p - x) / W;
    inP[(y - oy) * bw + (x - ox)] = 1;
    if ((x > 0 && inShell(p - 1)) || (x < W - 1 && inShell(p + 1)) || (y > 0 && inShell(p - W)) || (y < H - 1 && inShell(p + W))) mouth++;
  }
  // Outside the patch: reached from the box border without crossing it.
  const out = new Uint8Array(bw * bh);
  let wave: number[] = [];
  for (let b = 0; b < bw * bh; b++) {
    const bx = b % bw;
    const by = (b - bx) / bw;
    if (bx === 0 || by === 0 || bx === bw - 1 || by === bh - 1) {
      out[b] = 1;
      wave.push(b);
    }
  }
  while (wave.length > 0) {
    const next: number[] = [];
    for (const b of wave) {
      const bx = b % bw;
      const by = (b - bx) / bw;
      for (const c of [bx > 0 ? b - 1 : -1, bx < bw - 1 ? b + 1 : -1, by > 0 ? b - bw : -1, by < bh - 1 ? b + bw : -1]) {
        if (c >= 0 && !out[c] && !inP[c]) {
          out[c] = 1;
          next.push(c);
        }
      }
    }
    wave = next;
  }
  // Chessboard steps from outside into the filled patch.
  const dist = new Int32Array(bw * bh).fill(-1);
  wave = [];
  for (let b = 0; b < bw * bh; b++) {
    if (out[b]) {
      dist[b] = 0;
      wave.push(b);
    }
  }
  let half = 0;
  for (let d = 1; wave.length > 0; d++) {
    const next: number[] = [];
    for (const b of wave) {
      const bx = b % bw;
      const by = (b - bx) / bw;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = by + dy;
        if (yy < 0 || yy >= bh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = bx + dx;
          if (xx < 0 || xx >= bw) continue;
          const c = yy * bw + xx;
          if (dist[c] === -1) {
            dist[c] = d;
            next.push(c);
          }
        }
      }
    }
    wave = next;
  }
  for (let b = 0; b < bw * bh; b++) if (inP[b] && dist[b] > half) half = dist[b];
  return { half, mouth };
}

/**
 * Finds the white outline in a W x H RGBA image without changing it (see
 * the top of this file). Nothing is marked unless the image passes the
 * ring test and the thickness test.
 */
export function scanOutline(px: Uint8ClampedArray | Uint8Array, W: number, H: number): OutlineScan {
  const N = W * H;
  const kinds = new Uint8Array(N);
  const none: OutlineScan = { kinds, count: 0, colour: null, edgeShare: 0, thickness: 0, hug: 0 };
  if (N === 0 || px.length < N * 4) return none;

  // The outer edge: visible pixels with a fully transparent 4-way neighbour
  // or on the image edge.
  const onEdge = (p: number): boolean => {
    const x = p % W;
    const y = (p - x) / W;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return true;
    return px[(p - 1) * 4 + 3] === 0 || px[(p + 1) * 4 + 3] === 0 || px[(p - W) * 4 + 3] === 0 || px[(p + W) * 4 + 3] === 0;
  };
  const edge: number[] = [];
  const counts = new Map<number, number>();
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (px[i + 3] === 0 || !onEdge(p)) continue;
    edge.push(p);
    if (isNearWhite(px[i], px[i + 1], px[i + 2])) {
      const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (edge.length === 0 || counts.size === 0) return none;
  let best = -1;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN || (n === bestN && k > best)) {
      best = k;
      bestN = n;
    }
  }
  const colour = [(best >> 16) & 255, (best >> 8) & 255, best & 255] as const;

  // The ring test.
  let inRing = 0;
  for (const p of edge) if (close(px, p * 4, colour)) inRing++;
  const edgeShare = inRing / edge.length;
  if (edgeShare < OUTLINE_EDGE_SHARE) return { ...none, colour, edgeShare };

  // Two floods, 4-way from the outside: through the ring colour (the
  // sticker, however deep its hollows go) and through any near-white (the
  // ticket's run, which also holds the sticker's lighter fringe).
  const flood = (take: (i: number) => boolean): Uint16Array => {
    const depth = new Uint16Array(N);
    let frontier: number[] = [];
    for (const p of edge) {
      if (take(p * 4)) {
        depth[p] = 1;
        frontier.push(p);
      }
    }
    for (let d = 2; frontier.length > 0; d++) {
      const next: number[] = [];
      for (const p of frontier) {
        const x = p % W;
        const y = (p - x) / W;
        const visit = (q: number) => {
          if (depth[q] === 0 && px[q * 4 + 3] !== 0 && take(q * 4)) {
            depth[q] = Math.min(d, 65535);
            next.push(q);
          }
        };
        if (x > 0) visit(p - 1);
        if (x < W - 1) visit(p + 1);
        if (y > 0) visit(p - W);
        if (y < H - 1) visit(p + W);
      }
      frontier = next;
    }
    return depth;
  };
  const ringDepth = flood((i) => close(px, i, colour));
  const whiteDepth = flood((i) => isNearWhite(px[i], px[i + 1], px[i + 2]));

  // The thickness: the most common depth at which the near-white run meets
  // the art (a visible 4-way neighbour that is not near-white).
  const meet = new Map<number, number>();
  for (let p = 0; p < N; p++) {
    if (whiteDepth[p] === 0) continue;
    const x = p % W;
    const y = (p - x) / W;
    const art = (q: number) => px[q * 4 + 3] !== 0 && !isNearWhite(px[q * 4], px[q * 4 + 1], px[q * 4 + 2]);
    if ((x > 0 && art(p - 1)) || (x < W - 1 && art(p + 1)) || (y > 0 && art(p - W)) || (y < H - 1 && art(p + W))) {
      meet.set(whiteDepth[p], (meet.get(whiteDepth[p]) ?? 0) + 1);
    }
  }
  let thickness = 0;
  let thickN = 0;
  for (const [d, n] of meet) {
    if (n > thickN || (n === thickN && d < thickness)) {
      thickness = d;
      thickN = n;
    }
  }
  if (thickness === 0 || thickness > OUTLINE_MAX_THICKNESS) return { ...none, colour, edgeShare, thickness };

  // How far each pixel is from the art, in chessboard steps (8-way, across
  // anything: it is a distance, not a path).
  const reach = thickness + OUTLINE_SLACK;
  const artDist = new Uint16Array(N).fill(65535);
  let wave: number[] = [];
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (px[i + 3] !== 0 && !isNearWhite(px[i], px[i + 1], px[i + 2])) {
      artDist[p] = 0;
      wave.push(p);
    }
  }
  for (let d = 1; wave.length > 0 && d <= reach; d++) {
    const next: number[] = [];
    for (const p of wave) {
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const q = yy * W + xx;
          if (artDist[q] > d) {
            artDist[q] = d;
            next.push(q);
          }
        }
      }
    }
    wave = next;
  }

  // The hug test: a sticker's outer edge lies along the art all round.
  let edgeRing = 0;
  let hugging = 0;
  for (const p of edge) {
    if (!close(px, p * 4, colour)) continue;
    edgeRing++;
    if (artDist[p] <= reach) hugging++;
  }
  const hug = edgeRing === 0 ? 0 : hugging / edgeRing;
  if (hug < OUTLINE_HUG) return { ...none, colour, edgeShare, thickness, hug };

  // The outline: any near-white in the run as deep as the ring is thick,
  // then each deeper patch of the ring colour that lies wholly within
  // reach of the art.
  let count = 0;
  for (let p = 0; p < N; p++) {
    if (whiteDepth[p] !== 0 && whiteDepth[p] <= thickness) {
      kinds[p] = OUTLINE_CLEAR;
      count++;
    }
  }
  const seen = new Uint8Array(N);
  const patch: number[] = [];
  const inShell = (q: number) => whiteDepth[q] !== 0 && whiteDepth[q] <= thickness;
  for (let p0 = 0; p0 < N; p0++) {
    if (ringDepth[p0] === 0 || kinds[p0] === OUTLINE_CLEAR || seen[p0]) continue;
    patch.length = 0;
    const stack = [p0];
    seen[p0] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      patch.push(p);
      const x = p % W;
      const y = (p - x) / W;
      const visit = (q: number) => {
        if (!seen[q] && ringDepth[q] !== 0 && kinds[q] !== OUTLINE_CLEAR) {
          seen[q] = 1;
          stack.push(q);
        }
      };
      if (x > 0) visit(p - 1);
      if (x < W - 1) visit(p + 1);
      if (y > 0) visit(p - W);
      if (y < H - 1) visit(p + W);
    }
    const { half, mouth } = patchShape(patch, W, H, inShell);
    if (half > thickness || mouth < half) continue;
    for (const p of patch) {
      kinds[p] = OUTLINE_CLEAR;
      count++;
    }
  }

  // The backstop: never most of the picture.
  let visible = 0;
  for (let i = 3; i < N * 4; i += 4) if (px[i] !== 0) visible++;
  if (count > OUTLINE_MAX_SHARE * visible) return { ...none, colour, edgeShare, thickness, hug };
  return { kinds, count, colour, edgeShare, thickness, hug };
}

/**
 * Clears the outline in place to transparent (colour too, so no white hides
 * under the transparency for an engine's filtering to bleed back in) and
 * returns how many pixels changed. A second run changes nothing.
 */
export function cleanOutline(px: Uint8ClampedArray | Uint8Array, W: number, H: number): number {
  const { kinds, count } = scanOutline(px, W, H);
  if (count === 0) return 0;
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (kinds[p] !== OUTLINE_CLEAR) continue;
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
    px[i + 3] = 0;
  }
  return count;
}

/** "Erase area": the tolerance's range and default (DESIGN's ticket). */
export const ERASE_AREA_MAX = 64;
export const ERASE_AREA_DEFAULT = 24;

/**
 * The editor's "Erase area" region: the visible pixels 4-way connected to
 * (x, y) whose colour is within `tolerance` of its colour in every channel
 * (alpha aside, so a see-through edge of the same colour goes with it). At
 * 0 it is exactly one colour. A click on a fully transparent pixel, or
 * outside the image, takes nothing.
 */
export function floodRegion(
  px: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  x: number,
  y: number,
  tolerance: number
): { mask: Uint8Array; count: number } {
  const N = W * H;
  const mask = new Uint8Array(N);
  if (x < 0 || y < 0 || x >= W || y >= H || px.length < N * 4) return { mask, count: 0 };
  const start = y * W + x;
  const s = start * 4;
  if (px[s + 3] === 0) return { mask, count: 0 };
  const t = Math.max(0, Math.min(255, Math.round(tolerance)));
  const r = px[s];
  const g = px[s + 1];
  const b = px[s + 2];
  const near = (q: number) => {
    const i = q * 4;
    return px[i + 3] !== 0 && Math.abs(px[i] - r) <= t && Math.abs(px[i + 1] - g) <= t && Math.abs(px[i + 2] - b) <= t;
  };
  const stack = [start];
  mask[start] = 1;
  let count = 0;
  while (stack.length > 0) {
    const p = stack.pop()!;
    count++;
    const px0 = p % W;
    const py0 = (p - px0) / W;
    const visit = (q: number) => {
      if (!mask[q] && near(q)) {
        mask[q] = 1;
        stack.push(q);
      }
    };
    if (px0 > 0) visit(p - 1);
    if (px0 < W - 1) visit(p + 1);
    if (py0 > 0) visit(p - W);
    if (py0 < H - 1) visit(p + W);
  }
  return { mask, count };
}

/** Erases a region in place to transparent; returns how many pixels changed. */
export function eraseRegion(px: Uint8ClampedArray | Uint8Array, mask: Uint8Array): number {
  let n = 0;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (!mask[p]) continue;
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
    px[i + 3] = 0;
    n++;
  }
  return n;
}

/** "{n} pixels", or "1 pixel". */
function pixels(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'pixel' : 'pixels'}`;
}

/** The words (DESIGN's ticket, sections 2, 3 and 5). */
export function outlineFoundLine(n: number): string {
  return `A white outline is left around the sprite: ${pixels(n)}.`;
}
export function outlineCleanedLine(n: number): string {
  return `Outline cleaned: ${pixels(n)}.`;
}
export const OUTLINE_RESTORED = 'Outline restored.';
export function editorOutlineCleaned(n: number): string {
  return `Cleaned ${n.toLocaleString('en-US')} outline ${n === 1 ? 'pixel' : 'pixels'}.`;
}
/** On a touch screen, the status after a first tap with "Erase area": the
 *  run is marked, and a second tap inside the mark erases it (DESIGN,
 *  2026-11-25-006). */
export function tapAgainLine(n: number): string {
  return `Tap again to erase ${pixels(n)}.`;
}

export function erasedLine(n: number): string {
  return `Erased ${pixels(n)}.`;
}
export const NO_OUTLINE_TITLE = 'No white outline found.';
