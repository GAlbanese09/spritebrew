/**
 * The pink cleanup for animation sheets (HQ 2026-10-28-004 and -005). Every
 * animate request is flattened onto a fill (#FF00FF since July 15) and sent
 * to Retro Diffusion, which removes the background itself. Three kinds of
 * fill can survive in the sheet it returns:
 *
 * 1. Exact fill, in pockets RD's removal does not reach: gaps enclosed by
 *    the art, or between the character and scenery the input kept.
 * 2. Fill RD returned slightly off, such as 226,9,227: the same pockets, in
 *    a tight band around #FF00FF.
 * 3. A pink cast on the outline: opaque pixels next to the removed
 *    background that blend the art with the fill.
 *
 * keyFill makes 1 and 2 transparent, only for the #FF00FF fill and only in
 * that tight band, so other pinks are never keyed. despillRim takes the cast
 * out of 3, as despillChromaEdges always did, for dark pixels, and, when the
 * caller knows the character had no mostly-magenta colours of its own, for
 * bright ones that are mostly magenta; a violet or deep pink that continues
 * into the art is left alone either way (see despillRim). Pure, on RGBA
 * data, so it is tested offline
 * (scripts/fill-cleanup-test.mjs); spriteUtils runs it on a canvas for the
 * result card and the Gallery.
 */

/** The fill every animate request is flattened onto. */
export const MAGENTA_FILL = '#ff00ff';

/**
 * The key band: the exact fill and the tight band around it that George's
 * sheets needed (226,9,227 on Oct 28), not wider. Red and blue at 226 or
 * more and green at 9 or less; any other colour is never keyed.
 */
export const KEY_BAND = { minR: 226, maxG: 9, minB: 226 } as const;

export function inKeyBand(r: number, g: number, b: number): boolean {
  return r >= KEY_BAND.minR && g <= KEY_BAND.maxG && b >= KEY_BAND.minB;
}

/** Whether a fill is the magenta one, whose band keyFill knows. */
export function isMagentaFill(fillHex: string): boolean {
  return fillHex.trim().toLowerCase() === MAGENTA_FILL;
}

/** How much more red and blue than green a pixel has: the magenta a
 *  despill removes. Negative or 0 for pixels with no magenta in them. */
export function magentaExcess(r: number, g: number, b: number): number {
  return Math.min(r, b) - g;
}

/**
 * A bright outline pixel that is still mostly the fill's magenta, such as
 * 207,67,158 on George's second sheet: an excess of 60 or more, and at least
 * 40% of its brightest channel. Ordinary pinks and skin tones fall short:
 * pink 255,192,203 has 11; hot pink 255,105,180 has 75, but that is under
 * 40% of 255; skin 235,170,150 has none.
 */
export function mostlyMagenta(r: number, g: number, b: number): boolean {
  const excess = magentaExcess(r, g, b);
  return excess >= 60 && excess >= 0.4 * Math.max(r, g, b);
}

/** Pixels whose alpha is at least this count as part of the art when a
 *  character is checked for the fill (hasFillPixels). */
export const ART_ALPHA = 128;

/** Whether an image (the character an animate request sends) already has
 *  pixels in the key band, so a sheet made from it must not be keyed. */
export function hasFillPixels(px: Uint8ClampedArray | Uint8Array): boolean {
  return characterColours(px).fill;
}

/**
 * What the character an animate request sends (before it is flattened onto
 * the fill) has of its own, among its visible pixels: `fill`, pixels in the
 * key band, so the sheet's fill pockets are not keyed; `magenta`, pixels
 * that are mostly magenta (violet, orchid, deep pink, the fill itself), so
 * the bright rim rule stays off and those colours are never taken for a
 * cast. Every fill pixel is also mostly magenta.
 */
export function characterColours(px: Uint8ClampedArray | Uint8Array): { fill: boolean; magenta: boolean } {
  let magenta = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < ART_ALPHA) continue;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (inKeyBand(r, g, b)) return { fill: true, magenta: true };
    if (!magenta && mostlyMagenta(r, g, b)) magenta = true;
  }
  return { fill: false, magenta };
}

/** Makes every visible pixel in the key band transparent. Returns how many. */
export function keyFill(px: Uint8ClampedArray | Uint8Array): number {
  let keyed = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] !== 0 && inKeyBand(px[i], px[i + 1], px[i + 2])) {
      px[i + 3] = 0;
      keyed++;
    }
  }
  return keyed;
}

/** How far (Chebyshev, in px) the bright rim rule looks for the same
 *  mostly-magenta colour inside the art before it calls a pixel a cast. */
export const INTERIOR_REACH = 4;

/**
 * The rim despill (despillChromaEdges' rules, on RGBA data). Only opaque
 * pixels within 2 px (Chebyshev) of a fully transparent pixel, the ring the
 * fill could tint; interior art is never touched, and neither is alpha.
 *
 * - A magenta fill: a pixel darker than luminance 90 loses its magenta
 *   excess from red and blue, as always. With `bright`, so does a brighter
 *   pixel that is mostly magenta (see mostlyMagenta); `bright` is for callers
 *   that know the character had no mostly-magenta colours of its own
 *   (characterColours). Either way, a mostly-magenta pixel (a violet, a deep
 *   pink) is left alone when the same kind of colour continues into the art:
 *   an interior pixel (more than 2 px from the transparency) within
 *   INTERIOR_REACH that is mostly magenta, since a cast fades inward and art
 *   colour does not. A feature thinner than about 5 px has no interior to
 *   tell by, so a thin dark violet stroke on the rim is still despilled, as
 *   it always was.
 * - A green fill: a pixel darker than luminance 90 loses its green excess.
 * - Any other fill: nothing to remove.
 *
 * Returns how many pixels changed.
 */
export function despillRim(
  px: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  fillHex: string,
  opts: { bright: boolean } = { bright: false }
): number {
  const m = /^#([0-9a-f]{6})$/i.exec(fillHex.trim());
  if (!m || W === 0 || H === 0) return 0;
  const fillR = parseInt(m[1].slice(0, 2), 16);
  const fillG = parseInt(m[1].slice(2, 4), 16);
  const fillB = parseInt(m[1].slice(4, 6), 16);
  const magenta = fillR >= fillG + 60 && fillB >= fillG + 60;
  const green = fillG >= Math.max(fillR, fillB) + 60;
  if (!magenta && !green) return 0;

  // Each pixel's ring answer, worked out at most once (0 not yet, 1 yes,
  // 2 no). The despill never changes alpha, so an answer stays right as the
  // loop goes.
  const ring = new Uint8Array(W * H);
  // Within 2 px (Chebyshev) of a fully transparent pixel: the ring the fill
  // could tint.
  const nearTransparent = (x: number, y: number): boolean => {
    const p = y * W + x;
    if (ring[p] === 0) {
      let near = false;
      for (let ny = Math.max(0, y - 2); ny <= Math.min(H - 1, y + 2) && !near; ny++) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(W - 1, x + 2); nx++) {
          if (px[(ny * W + nx) * 4 + 3] === 0) {
            near = true;
            break;
          }
        }
      }
      ring[p] = near ? 1 : 2;
    }
    return ring[p] === 1;
  };
  // An interior pixel (more than 2 px from the transparency) that is mostly
  // magenta. The despill changes only ring pixels, which are never
  // interior, so reading the sheet as the loop changes it gives the answer
  // the sheet before the loop gives.
  const interiorMagenta = (x: number, y: number): boolean => {
    const k = (y * W + x) * 4;
    return px[k + 3] !== 0 && mostlyMagenta(px[k], px[k + 1], px[k + 2]) && !nearTransparent(x, y);
  };
  // Whether one lies within INTERIOR_REACH. A sheet with only a few mostly
  // magenta rim pixels (most sheets) looks around each one. A sheet with
  // many (art that is mostly magenta near its rim) builds a count table of
  // those interior pixels once, so each look is a box sum and the whole
  // pass stays bounded (Second 118).
  const LOOKS_BEFORE_TABLE = Math.max(256, (W * H) >> 8);
  let looks = 0;
  let table: Int32Array | null = null;
  const buildTable = (): Int32Array => {
    const t = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        if (interiorMagenta(x, y)) row++;
        t[(y + 1) * (W + 1) + x + 1] = t[y * (W + 1) + x + 1] + row;
      }
    }
    return t;
  };
  const magentaInside = (x: number, y: number): boolean => {
    const x0 = Math.max(0, x - INTERIOR_REACH);
    const x1 = Math.min(W - 1, x + INTERIOR_REACH);
    const y0 = Math.max(0, y - INTERIOR_REACH);
    const y1 = Math.min(H - 1, y + INTERIOR_REACH);
    if (!table && ++looks > LOOKS_BEFORE_TABLE) table = buildTable();
    if (table) {
      const w = W + 1;
      return table[(y1 + 1) * w + x1 + 1] - table[y0 * w + x1 + 1] - table[(y1 + 1) * w + x0] + table[y0 * w + x0] > 0;
    }
    for (let ny = y0; ny <= y1; ny++) {
      for (let nx = x0; nx <= x1; nx++) {
        if (interiorMagenta(nx, ny)) return true;
      }
    }
    return false;
  };

  let changed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (px[i + 3] === 0) continue;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const excess = magenta ? magentaExcess(r, g, b) : g - Math.max(r, b);
      if (excess <= 0) continue;
      const dark = 0.299 * r + 0.587 * g + 0.114 * b <= 90;
      const mostly = magenta && mostlyMagenta(r, g, b);
      if (!dark && !(opts.bright && mostly)) continue;
      if (!nearTransparent(x, y)) continue;
      if (mostly && magentaInside(x, y)) continue;
      if (magenta) {
        px[i] = r - excess;
        px[i + 2] = b - excess;
      } else {
        px[i + 1] = g - excess;
      }
      changed++;
    }
  }
  return changed;
}

/**
 * The whole cleanup of an animation sheet that came back with transparency:
 * the key first (a magenta fill, and only when `key`), so the rim around a
 * keyed pocket is despilled too, then the rim despill (its bright rule only
 * when `bright`). `key` is false when the character sent had fill-coloured
 * pixels of its own; `bright` only when it is known to have had no mostly
 * magenta ones (characterColours). Returns the counts, so a caller can keep
 * an untouched sheet as it was.
 */
export function cleanAnimation(
  px: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  fillHex: string,
  opts: { key: boolean; bright: boolean }
): { keyed: number; despilled: number } {
  const keyed = opts.key && isMagentaFill(fillHex) ? keyFill(px) : 0;
  const despilled = despillRim(px, W, H, fillHex, { bright: opts.bright });
  return { keyed, despilled };
}

/** Whether all four corners are opaque: a sheet RD returned without its
 *  background removed, which the cleanup leaves as it is. */
export function cornersOpaque(px: Uint8ClampedArray | Uint8Array, W: number, H: number): boolean {
  if (W === 0 || H === 0) return true;
  const a = (x: number, y: number) => px[(y * W + x) * 4 + 3];
  return a(0, 0) === 255 && a(W - 1, 0) === 255 && a(0, H - 1) === 255 && a(W - 1, H - 1) === 255;
}
