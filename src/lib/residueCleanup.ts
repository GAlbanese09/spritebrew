/**
 * The purple residue cleanup (George, Oct 31, 2026: "one of our biggest
 * enemies"; HQ 2026-10-31-057).
 *
 * Every animate request is flattened onto #FF00FF and Retro Diffusion
 * removes the background; fillCleanup then keys what is left of the exact
 * fill and despills the rim. What still survives is residue: magenta blended
 * into the outline and small runs of off-colour fill, from bright
 * (176,41,177) to dark (85,1,89). The rim despill skips a run 5 px or
 * thicker, since thick magenta reads as violet art, so on George's goblin
 * (Oct 31) the Gallery's cleanup changed none of its 344 residue pixels.
 *
 * Residue is found by colour and by shape:
 * - Colour: mostly magenta (fillCleanup's mostlyMagenta) with red and blue
 *   within RESIDUE_HUE_SPREAD of each other, so deep pinks and reds never
 *   count. A muted purple (a loincloth, a cape's shade) falls short.
 * - Shape: residue hugs the art. A connected run of residue-coloured pixels
 *   (8-way) is residue when every pixel in it is within RESIDUE_REACH steps
 *   (8-way, through the run) of a visible pixel that is not residue-coloured;
 *   across a straight band that is the Chebyshev distance. A thicker
 *   run, a violet cape or a magic effect, is art and is left alone, all of
 *   it.
 *
 * What happens to residue (George's idea: "target anything outside of the
 * body with that color"):
 * - A run that touches the outside (a fully transparent pixel or the image
 *   edge) is cleared to transparent.
 * - An enclosed run: its bright pixels, fill left in a gap the art closes,
 *   are cleared too; its dark ones (luminance 90 or less), outline blended
 *   with the fill, lose their magenta excess, as the rim despill does.
 *
 * A violet that is the character's own looks the same: a skeleton's purple
 * loincloth (133,66,133) is as thin as residue. So a caller that knows the
 * character an animation was made from passes its mostly-magenta colours as
 * `protect` (characterPalette), and a pixel within PROTECT_TOLERANCE of one
 * of them is the character's, never residue; the rest of the magenta is
 * still cleaned. Without that knowledge (the Gallery), callers run this only
 * when a person asks for it, as the editor does after showing the residue.
 * Pure, on RGBA data, so it is tested offline
 * (scripts/residue-cleanup-test.mjs).
 */

import { magentaExcess, mostlyMagenta } from './fillCleanup';

/** How far residue reaches from the art it clings to, in 8-way steps
 *  through the run (px across a straight band). */
export const RESIDUE_REACH = 3;

/** How far apart red and blue may be, as a share of the larger: magenta,
 *  not a deep pink or a blue violet. */
export const RESIDUE_HUE_SPREAD = 0.35;

/** Enclosed residue at or under this luminance is outline blended with the
 *  fill: it keeps its alpha and loses its magenta. */
export const RESIDUE_DARK_LUMA = 90;

/** Whether a colour can be residue: mostly magenta, red and blue close. */
export function isResidueColour(r: number, g: number, b: number): boolean {
  return mostlyMagenta(r, g, b) && Math.abs(r - b) <= RESIDUE_HUE_SPREAD * Math.max(r, b);
}

/** How close (per channel) a pixel must be to a protected colour to count
 *  as the character's own. The animation redraws the character, so its
 *  colours drift a little from the ones sent. */
export const PROTECT_TOLERANCE = 16;

/** At most this many protected colours are kept (the most common first). */
export const PROTECT_MAX = 32;

/** A colour as [r, g, b]. */
export type Rgb = readonly [number, number, number];

/**
 * The residue-coloured colours a character has of its own, among its visible
 * pixels (alpha ART_ALPHA or more, as characterColours counts), most common
 * first, at most PROTECT_MAX: what an animation of it passes as `protect`.
 * Empty when the character has none, which is most characters.
 */
export function characterPalette(px: Uint8ClampedArray | Uint8Array): Rgb[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    if (!isResidueColour(px[i], px[i + 1], px[i + 2])) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, PROTECT_MAX)
    .map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255] as const);
}

function isProtected(r: number, g: number, b: number, protect: readonly Rgb[]): boolean {
  for (const c of protect) {
    if (Math.abs(r - c[0]) <= PROTECT_TOLERANCE && Math.abs(g - c[1]) <= PROTECT_TOLERANCE && Math.abs(b - c[2]) <= PROTECT_TOLERANCE) {
      return true;
    }
  }
  return false;
}

/** What the cleanup does to one pixel. */
export const RESIDUE_NONE = 0;
/** Residue that is cleared to transparent. */
export const RESIDUE_CLEAR = 1;
/** Enclosed dark residue that loses its magenta. */
export const RESIDUE_DESPILL = 2;
/** Residue-coloured, but in a run too thick to be residue: left alone. */
export const RESIDUE_KEEP = 3;

export interface ResidueScan {
  /** One entry per pixel: RESIDUE_NONE, _CLEAR, _DESPILL or _KEEP. */
  kinds: Uint8Array;
  clear: number;
  despill: number;
  keep: number;
}

/**
 * Finds the residue in a W x H RGBA image without changing it. The kinds
 * array is what an editor can highlight before a person cleans. A pixel near
 * a `protect` colour is the character's own and never residue.
 */
export function scanResidue(
  px: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  protect: readonly Rgb[] = []
): ResidueScan {
  const N = W * H;
  const kinds = new Uint8Array(N);
  const scan: ResidueScan = { kinds, clear: 0, despill: 0, keep: 0 };
  if (N === 0) return scan;

  // Residue-coloured visible pixels.
  const res = new Uint8Array(N);
  let any = false;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (px[i + 3] !== 0 && isResidueColour(px[i], px[i + 1], px[i + 2]) && !isProtected(px[i], px[i + 1], px[i + 2], protect)) {
      res[p] = 1;
      any = true;
    }
  }
  if (!any) return scan;

  // Distance from each residue pixel to the nearest visible pixel that is
  // not residue, in 8-way steps through residue pixels (the Chebyshev
  // distance across a straight band; longer where a run bends round a gap),
  // out to RESIDUE_REACH + 1 (255: farther, or none).
  // Residue pixels next to such a pixel are at 1; the rest are reached
  // through residue only.
  const dist = new Uint8Array(N).fill(255);
  let frontier: number[] = [];
  for (let p = 0; p < N; p++) {
    if (!res[p]) continue;
    const x = p % W;
    const y = (p - x) / W;
    let art = false;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1) && !art; ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
        const q = ny * W + nx;
        if (!res[q] && px[q * 4 + 3] !== 0) {
          art = true;
          break;
        }
      }
    }
    if (art) {
      dist[p] = 1;
      frontier.push(p);
    }
  }
  for (let d = 2; d <= RESIDUE_REACH + 1 && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % W;
      const y = (p - x) / W;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
          const q = ny * W + nx;
          if (res[q] && dist[q] === 255) {
            dist[q] = d;
            next.push(q);
          }
        }
      }
    }
    frontier = next;
  }

  // Each run (8-way component) of residue-coloured pixels, judged whole.
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const run: number[] = [];
  for (let start = 0; start < N; start++) {
    if (!res[start] || seen[start]) continue;
    run.length = 0;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let outside = false;
    let far = false;
    while (top > 0) {
      const p = stack[--top];
      run.push(p);
      if (dist[p] > RESIDUE_REACH) far = true;
      const x = p % W;
      const y = (p - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) outside = true;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
          const q = ny * W + nx;
          if (px[q * 4 + 3] === 0) outside = true;
          else if (res[q] && !seen[q]) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    for (const p of run) {
      let kind: number;
      if (far) kind = RESIDUE_KEEP;
      else if (outside) kind = RESIDUE_CLEAR;
      else {
        const i = p * 4;
        const dark = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] <= RESIDUE_DARK_LUMA;
        kind = dark ? RESIDUE_DESPILL : RESIDUE_CLEAR;
      }
      kinds[p] = kind;
      if (kind === RESIDUE_CLEAR) scan.clear++;
      else if (kind === RESIDUE_DESPILL) scan.despill++;
      else scan.keep++;
    }
  }
  return scan;
}

/**
 * Cleans the residue in place (see the top of this file) and returns what
 * changed: `cleared` pixels made transparent (0,0,0,0), `despilled` dark pixels that
 * lost their magenta, and `kept`, residue-coloured pixels in runs too thick
 * to be residue. A second run changes nothing.
 */
export function cleanResidue(
  px: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  protect: readonly Rgb[] = []
): { cleared: number; despilled: number; kept: number } {
  const { kinds, clear, despill, keep } = scanResidue(px, W, H, protect);
  if (clear + despill === 0) return { cleared: 0, despilled: 0, kept: keep };
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (kinds[p] === RESIDUE_CLEAR) {
      // Colour too, so no magenta hides under the transparency for an
      // engine's filtering to bleed back in.
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = 0;
    } else if (kinds[p] === RESIDUE_DESPILL) {
      const excess = magentaExcess(px[i], px[i + 1], px[i + 2]);
      px[i] -= excess;
      px[i + 2] -= excess;
    }
  }
  return { cleared: clear, despilled: despill, kept: keep };
}

/** "Show residue" mark for a pixel a clean would clear (cyan). */
export const OVERLAY_CLEAR: Rgb = [0, 229, 255];
/** "Show residue" mark for a pixel a clean would despill (yellow). */
export const OVERLAY_DESPILL: Rgb = [255, 214, 0];

/**
 * The editor's "Show residue" layer for a scan: one opaque mark on every
 * pixel a clean would change (OVERLAY_CLEAR or OVERLAY_DESPILL) and
 * transparent elsewhere, as W x H RGBA. Kept runs are not marked, because a
 * clean leaves them. Pure, so the marks are tested offline with the scan.
 */
export function residueOverlay(kinds: Uint8Array, W: number, H: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(W * H * 4);
  const n = Math.min(kinds.length, W * H);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const k = kinds[p];
    const c = k === RESIDUE_CLEAR ? OVERLAY_CLEAR : k === RESIDUE_DESPILL ? OVERLAY_DESPILL : null;
    if (!c) continue;
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
    out[i + 3] = 255;
  }
  return out;
}
