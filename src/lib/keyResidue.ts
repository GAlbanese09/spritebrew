/**
 * Leftover background on sliced frames (George, Nov 11, 2026: "could we get
 * a way to ... clear all the residue cleaned up at a click of a button? To
 * avoid having the user edit each individual frame?"; HQ 2026-11-11-046).
 *
 * A sheet that reaches /upload with its background already removed can still
 * carry bits of the key color the background was: thin runs along the cut
 * edge that a fill from the outside did not cross, and closed pockets the
 * art surrounds (between an arm and the body, inside a cup's steam). On
 * George's sheet that was 407 pixels of #FF00FF over 12 frames.
 *
 * Nothing here knows the character the frames show, so there is no palette
 * to protect (residueCleanup's characterPalette). Three tests stand in for
 * it, and all three must hold before a pixel is offered for cleaning by
 * default:
 *
 * - Color. Only a loud key color counts. Green, blue and cyan must be
 *   near-pure (strong channels at KEY_HIGH or more, weak ones at KEY_LOW or
 *   less): vivid greens and blues are everyday art colors. Magenta, the key
 *   this app and most sprite tools use, may be a little off (MAGENTA_HIGH,
 *   MAGENTA_LOW, red and blue close), because real sheets carry it blended:
 *   George's skeleton sheet (Oct 20) has 237 pixels of #D125CA, #C629BB,
 *   #E118DA and #BE3AA7 between the bones. Near-pure magenta and blended
 *   magenta are listed as two rows, so a fill and an art purple are never
 *   one tick. The dull purples (a loincloth's #854285, dark outline residue)
 *   stay out; the frame editor's "Clean residue" is the tool for those. A
 *   pixel under KEY_ALPHA_SURE counts only when it joins a surer pixel of
 *   the same key: at alpha 1 a browser rounds any color toward a key.
 * - Shape, as residueCleanup judges it: a connected run (8-way) of one key
 *   color is leftover only when every pixel in it is within RESIDUE_REACH
 *   art pixels of a visible pixel of another color. Sheets are often drawn
 *   larger than one image pixel per art pixel (a 256 px character saved at
 *   1024), so the reach is counted in the sheet's art pixels (artPixelRead,
 *   sheetArtPixel): at 4 image pixels per art pixel a one-pixel fringe is 4
 *   px thick, and a 3 px reach would call all of it art. A thicker run (a
 *   magenta cape, a green slime), or one that strays from the art (a spark,
 *   a loose speck), is left whole, whatever else is ticked.
 * - Evidence across the sheet. A row is ticked by default only on what art
 *   does not give: in at least KEY_EVIDENCE_SHARE of the frames that hold
 *   it, it sits both on the cut edge (KEY_PLACES_EDGE runs that touch a
 *   transparent pixel or the frame's edge) and closed in by the art
 *   (KEY_PLACES_INSIDE runs), or all along the edge (KEY_PLACES_MANY runs),
 *   as a background a fill left behind does. It
 *   must also be mostly leftover-shaped (the runs left whole are under
 *   KEY_THICK_SHARE of its pixels) and a small share of every frame's
 *   visible pixels (KEY_SHARE_MAX). A thin accent on the outline (a
 *   headband, a bow, a blade, a gem on a staff) sits in one place, so it is
 *   listed but starts unticked (AUDIT clean-frames r1 H1).
 * - What the page knows. Shape cannot tell a background left behind from an
 *   accent the art repeats (gloves, crown spikes, leaf tufts: AUDIT
 *   clean-frames r2 H1). So a row is ticked by default only when the page
 *   also knows its key was the background: a SpriteBrew sheet brought by
 *   Send to Slicer (its #FF00FF fill), or the color the page's Remove
 *   background took this visit (HQ 2026-11-24-109, choice C). Every other
 *   row is listed, unticked, for the person to check.
 *
 * The numbers come from the project's real sheets (Nov 11 and 24, 2026): the
 * sheet George's ask came with (407 px of #FF00FF in 12 frames; edge and
 * pocket together in 7 of them), his four characters on a green key (4,145
 * px of faint #00FF00, a halo of 8 to 16 runs in each frame), the skeleton
 * sheet above (16 of 16), two of
 * our own walks (one frame each), and five sheets with no leftover at all,
 * where nothing may be found.
 *
 * Pure, on RGBA data, so it is tested offline (scripts/key-residue-test.mjs).
 */

import { RESIDUE_CLEAR, RESIDUE_DESPILL, RESIDUE_HUE_SPREAD, RESIDUE_REACH, type Rgb } from './residueCleanup';

export type KeyName = 'magenta' | 'green' | 'blue' | 'cyan';

/** The key colors. */
export const KEY_NAMES: readonly KeyName[] = ['magenta', 'green', 'blue', 'cyan'];

/** A row of the strip: one key color, magenta split into near-pure and
 *  blended. */
export type RowId = 'magenta' | 'magenta-blend' | 'green' | 'blue' | 'cyan';

/** The rows, in the order they are listed. */
export const ROW_IDS: readonly RowId[] = ['magenta', 'magenta-blend', 'green', 'blue', 'cyan'];

/** Each row's key, as an index into KEY_NAMES. */
export const ROW_KEY: readonly number[] = [0, 0, 1, 2, 3];

/** A near-pure key color's strong channels are at least this. */
export const KEY_HIGH = 224;
/** A near-pure key color's weak channels are at most this. */
export const KEY_LOW = 48;
/** Magenta may be blended a little: red and blue at least this... */
export const MAGENTA_HIGH = 164;
/** ...green at most this, and red and blue within RESIDUE_HUE_SPREAD of
 *  each other (as residueCleanup's isResidueColour asks). */
export const MAGENTA_LOW = 64;
/** A pixel this opaque or more is judged by its color alone; a fainter one
 *  counts only when it joins a surer pixel of the same key. George's green
 *  sheet: 2,921 of its leftover pixels are fainter; all but 6 stray specks
 *  join (AUDIT clean-frames r1 L2). */
export const KEY_ALPHA_SURE = 16;
/** A row is something the art uses when the runs left whole (too thick, or
 *  straying from the art) hold at least this share of all its pixels on the
 *  sheet. George's green sheet: 1.7%. A cape with a gem: 96%. */
export const KEY_THICK_SHARE = 0.25;
/** A row that is more than this share of one frame's visible pixels is
 *  something the art uses (an outline drawn in it, say), not leftover.
 *  George's worst frame holds 0.9%; a 2 px fringe down one side of a 64 px
 *  sprite is about 6%; a 1 px outline all round one is about 11%. */
export const KEY_SHARE_MAX = 0.1;
/** A frame shows the row as a background would leave it with at least this
 *  many runs on the cut edge... */
export const KEY_PLACES_EDGE = 2;
/** ...and at least this many closed in by the art... */
export const KEY_PLACES_INSIDE = 1;
/** ...or with at least this many runs along the cut edge alone: a halo.
 *  George's green sheet has 8 to 16 in each frame; a headband, a trim or a
 *  blade has 1 or 2. */
export const KEY_PLACES_MANY = 4;
/** The share of the frames holding a row that must show it so. */
export const KEY_EVIDENCE_SHARE = 0.5;

/** Which key color a pixel is, as an index into KEY_NAMES, or -1. */
export function keyIndexOf(r: number, g: number, b: number): number {
  const hi = (v: number) => v >= KEY_HIGH;
  const lo = (v: number) => v <= KEY_LOW;
  if (r >= MAGENTA_HIGH && b >= MAGENTA_HIGH && g <= MAGENTA_LOW && Math.abs(r - b) <= RESIDUE_HUE_SPREAD * Math.max(r, b)) return 0;
  if (lo(r) && hi(g) && lo(b)) return 1;
  if (lo(r) && lo(g) && hi(b)) return 2;
  if (lo(r) && hi(g) && hi(b)) return 3;
  return -1;
}

/** Which row a pixel of a key color is, as an index into ROW_IDS, or -1. */
export function rowIndexOf(r: number, g: number, b: number): number {
  const k = keyIndexOf(r, g, b);
  if (k < 0) return -1;
  if (k === 0) return r >= KEY_HIGH && g <= KEY_LOW && b >= KEY_HIGH ? 0 : 1;
  return k + 1;
}

/** What one row does in one frame. */
export interface KeyCount {
  /** Leftover pixels in runs that touch a transparent pixel or the frame's
   *  edge. */
  edge: number;
  /** Leftover pixels in runs the art closes in (pockets). */
  inside: number;
  /** Pixels in runs left whole: too thick to be leftover, or straying more
   *  than RESIDUE_REACH art pixels from the art. Never cleaned. */
  thick: number;
  /** Leftover runs holding this row's pixels on the cut edge... */
  edgeRuns: number;
  /** ...and closed in. */
  insideRuns: number;
}

export interface FrameKeyScan {
  width: number;
  height: number;
  /** Visible pixels (alpha above 0) in the frame. */
  visible: number;
  /** Image pixels per art pixel the reach was counted in; 1 for most
   *  sheets. */
  artPixel: number;
  /** One entry per pixel: 0, or 1 + the row's index for a leftover pixel (a
   *  clean of that row clears it). Thick runs are not marked. */
  marks: Uint8Array;
  /** One entry per row, in ROW_IDS order. */
  counts: KeyCount[];
  /** For each row, how often each exact color (0xRRGGBB) occurs among its
   *  leftover pixels. */
  exact: Map<number, number>[];
}

/** The largest art pixel looked for, in image pixels. */
export const ART_PIXEL_MAX = 8;
/** The share of a frame's color changes that must fall on one grid. Under
 *  1, so a few single pixels drawn on a scaled-up sheet do not hide its
 *  size. */
export const ART_PIXEL_FIT = 0.97;
/** Fewer color changes than this along the rows, or down the columns, say
 *  nothing about the size. */
export const ART_PIXEL_MIN_EDGES = 24;
/** The changes must also fall at this many different places across, and
 *  down: a few flat boxes fit many grids and say nothing either. */
export const ART_PIXEL_MIN_LINES = 6;

/**
 * How many image pixels one art pixel takes in a W x H RGBA frame: the
 * largest size from 2 to ART_PIXEL_MAX for which nearly every change of
 * color, along the rows and down the columns, falls on one grid of that
 * size; 1 when none does. Null when the frame has too little detail to say
 * (a plain box). The grid may start anywhere, so a frame cut or shifted off
 * the sheet's own grid reads the same. Transparent pixels are one color.
 */
export function artPixelRead(px: Uint8ClampedArray | Uint8Array, W: number, H: number): number | null {
  if (W < 2 || H < 2) return null;
  const colorAt = (p: number): number => {
    const i = p * 4;
    return px[i + 3] === 0 ? -1 : ((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0;
  };
  // at[axis][s * ART_PIXEL_MAX + phase]: color changes at a position that is
  // `phase` past a multiple of s.
  const at = [new Int32Array((ART_PIXEL_MAX + 1) * ART_PIXEL_MAX), new Int32Array((ART_PIXEL_MAX + 1) * ART_PIXEL_MAX)];
  const total = [0, 0];
  const lines = [new Uint8Array(W), new Uint8Array(H)];
  const lineCount = [0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = colorAt(y * W + x);
      if (x > 0 && c !== colorAt(y * W + x - 1)) {
        total[0]++;
        if (lines[0][x] === 0) {
          lines[0][x] = 1;
          lineCount[0]++;
        }
        for (let s = 2; s <= ART_PIXEL_MAX; s++) at[0][s * ART_PIXEL_MAX + (x % s)]++;
      }
      if (y > 0 && c !== colorAt((y - 1) * W + x)) {
        total[1]++;
        if (lines[1][y] === 0) {
          lines[1][y] = 1;
          lineCount[1]++;
        }
        for (let s = 2; s <= ART_PIXEL_MAX; s++) at[1][s * ART_PIXEL_MAX + (y % s)]++;
      }
    }
  }
  if (total[0] < ART_PIXEL_MIN_EDGES || total[1] < ART_PIXEL_MIN_EDGES) return null;
  if (lineCount[0] < ART_PIXEL_MIN_LINES || lineCount[1] < ART_PIXEL_MIN_LINES) return null;
  const onOneGrid = (axis: number, s: number): boolean => {
    let most = 0;
    for (let phase = 0; phase < s; phase++) most = Math.max(most, at[axis][s * ART_PIXEL_MAX + phase]);
    return most >= ART_PIXEL_FIT * total[axis];
  };
  for (let s = ART_PIXEL_MAX; s >= 2; s--) {
    if (onOneGrid(0, s) && onOneGrid(1, s)) return s;
  }
  return 1;
}

/** artPixelRead for one frame on its own: 1 when it cannot say. */
export function artPixelSize(px: Uint8ClampedArray | Uint8Array, W: number, H: number): number {
  return artPixelRead(px, W, H) ?? 1;
}

/** The sheet's art pixel, from its frames' reads: the size most of the
 *  frames that can say agree on (the smaller on a tie), so a plain frame
 *  does not shorten the reach on a scaled sheet (AUDIT clean-frames r1 M5).
 *  1 when no frame can say. */
export function sheetArtPixel(reads: Iterable<number | null>): number {
  const votes = new Map<number, number>();
  for (const r of reads) if (r !== null) votes.set(r, (votes.get(r) ?? 0) + 1);
  let best = 1;
  let bestVotes = 0;
  for (const [size, n] of votes) {
    if (n > bestVotes || (n === bestVotes && size < best)) {
      best = size;
      bestVotes = n;
    }
  }
  return best;
}

/** Whether a frame is fully opaque: its background was never removed. */
const isOpaque = (px: Uint8ClampedArray | Uint8Array, N: number): boolean => {
  for (let i = 3; i < N * 4; i += 4) if (px[i] !== 255) return false;
  return true;
};

/**
 * Finds the leftover key color in one W x H RGBA frame without changing it.
 * `artPixel` is the sheet's (sheetArtPixel); without it the frame's own
 * read is used. A fully opaque frame is the page banner's (its background
 * was never removed): it is counted as visible and not looked into.
 */
export function scanKeyFrame(px: Uint8ClampedArray | Uint8Array, W: number, H: number, artPixel?: number): FrameKeyScan {
  const N = W * H;
  const marks = new Uint8Array(N);
  const counts: KeyCount[] = ROW_IDS.map(() => ({ edge: 0, inside: 0, thick: 0, edgeRuns: 0, insideRuns: 0 }));
  const exact: Map<number, number>[] = ROW_IDS.map(() => new Map());
  const scan: FrameKeyScan = { width: W, height: H, visible: 0, artPixel: 1, marks, counts, exact };
  if (N === 0) return scan;
  if (isOpaque(px, N)) {
    scan.visible = N;
    return scan;
  }

  // Each visible pixel's key (1 + index), or 0. A faint pixel of a key color
  // is held apart until it joins a sure one.
  const key = new Uint8Array(N);
  const faint = new Uint8Array(N);
  const present = new Set<number>();
  const sure: number[] = [];
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    if (px[i + 3] === 0) continue;
    scan.visible++;
    const k = keyIndexOf(px[i], px[i + 1], px[i + 2]);
    if (k < 0) continue;
    if (px[i + 3] >= KEY_ALPHA_SURE) {
      key[p] = k + 1;
      present.add(k);
      sure.push(p);
    } else faint[p] = k + 1;
  }
  if (present.size === 0) return scan;
  while (sure.length > 0) {
    const p = sure.pop()!;
    const x = p % W;
    const y = (p - x) / W;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
        const q = ny * W + nx;
        if (faint[q] !== 0 && faint[q] === key[p]) {
          key[q] = faint[q];
          faint[q] = 0;
          sure.push(q);
        }
      }
    }
  }
  scan.artPixel = artPixel ?? artPixelSize(px, W, H);
  // The reach in image pixels: RESIDUE_REACH art pixels.
  const reach = RESIDUE_REACH * scan.artPixel;

  const dist = new Uint8Array(N);
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const run: number[] = [];
  const rowOf = (p: number) => rowIndexOf(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);

  for (const k of [...present].sort((a, b) => a - b)) {
    const mine = k + 1;
    // Distance from each pixel of this key to the nearest visible pixel of
    // another color, in 8-way steps through this key's pixels, out to
    // reach + 1 (255: farther, or none). As residueCleanup measures, in
    // art pixels.
    dist.fill(255);
    let frontier: number[] = [];
    for (let p = 0; p < N; p++) {
      if (key[p] !== mine) continue;
      const x = p % W;
      const y = (p - x) / W;
      let art = false;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1) && !art; ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
          const q = ny * W + nx;
          if (key[q] !== mine && px[q * 4 + 3] !== 0) {
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
    for (let d = 2; d <= reach + 1 && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const p of frontier) {
        const x = p % W;
        const y = (p - x) / W;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
            const q = ny * W + nx;
            if (key[q] === mine && dist[q] === 255) {
              dist[q] = d;
              next.push(q);
            }
          }
        }
      }
      frontier = next;
    }

    // Each run of this key, judged whole; its pixels counted by row.
    const inRun = new Uint8Array(ROW_IDS.length);
    for (let start = 0; start < N; start++) {
      if (key[start] !== mine || seen[start]) continue;
      run.length = 0;
      let top = 0;
      stack[top++] = start;
      seen[start] = 1;
      let outside = false;
      let far = false;
      while (top > 0) {
        const p = stack[--top];
        run.push(p);
        if (dist[p] > reach) far = true;
        const x = p % W;
        const y = (p - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) outside = true;
        for (let ny = Math.max(0, y - 1); ny <= Math.min(H - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(W - 1, x + 1); nx++) {
            const q = ny * W + nx;
            if (px[q * 4 + 3] === 0) outside = true;
            else if (key[q] === mine && !seen[q]) {
              seen[q] = 1;
              stack[top++] = q;
            }
          }
        }
      }
      inRun.fill(0);
      for (const p of run) {
        const r = rowOf(p);
        inRun[r] = 1;
        if (far) {
          counts[r].thick++;
          continue;
        }
        if (outside) counts[r].edge++;
        else counts[r].inside++;
        marks[p] = r + 1;
        const i = p * 4;
        const c = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
        exact[r].set(c, (exact[r].get(c) ?? 0) + 1);
      }
      if (far) continue;
      for (let r = 0; r < ROW_IDS.length; r++) {
        if (!inRun[r]) continue;
        if (outside) counts[r].edgeRuns++;
        else counts[r].insideRuns++;
      }
    }
  }
  return scan;
}

/**
 * Every frame of a sheet scanned at the sheet's art pixel (sheetArtPixel
 * over the reads of the frames that hold a key color), keyed as given.
 */
export function scanKeySheet(frames: ReadonlyMap<string, { data: Uint8ClampedArray | Uint8Array; width: number; height: number }>): Map<string, FrameKeyScan> {
  const reads: (number | null)[] = [];
  for (const f of frames.values()) {
    const N = f.width * f.height;
    if (N === 0 || isOpaque(f.data, N)) continue;
    let any = false;
    for (let i = 0; i < N * 4 && !any; i += 4) if (f.data[i + 3] !== 0 && keyIndexOf(f.data[i], f.data[i + 1], f.data[i + 2]) >= 0) any = true;
    reads.push(any ? artPixelRead(f.data, f.width, f.height) : null);
  }
  const size = sheetArtPixel(reads);
  const scans = new Map<string, FrameKeyScan>();
  for (const [id, f] of frames) scans.set(id, scanKeyFrame(f.data, f.width, f.height, size));
  return scans;
}

/** Why a row starts unticked: it is only ever inside the art, a good part
 *  of it is in thick or stray shapes, it is a large share of a frame, it
 *  does not sit as a background would (on the edge and closed in, in enough
 *  places), or it sits as leftover but the page does not know its key was
 *  the background. */
export type ArtReason = 'inside' | 'thick' | 'share' | 'few' | 'unknown';

/** One row of the strip: a key color found on the sheet. */
export interface KeyFinding {
  row: RowId;
  key: KeyName;
  /** Its most common exact color among the leftover pixels in scope. */
  rgb: Rgb;
  /** That color as "#RRGGBB", capitals. */
  hex: string;
  /** Leftover pixels of this row in the frames in scope. */
  pixels: number;
  /** How many frames in scope hold any. */
  frames: number;
  /** Null when a clean should take it by default; otherwise why it looks
   *  like part of the art and starts unticked. */
  art: ArtReason | null;
}

const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');

/** A color as "#RRGGBB", capitals. */
export function hexOf(rgb: Rgb): string {
  return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
}

/**
 * The rows found, one finding each, in ROW_IDS order. The evidence (edge and
 * pocket together, thick shapes, share of a frame) is read from every frame
 * of the sheet; the counts cover only the frames in `scope` (all of them
 * when it is omitted). A row with no leftover pixel in scope is not listed.
 * `known` holds the keys the page knows were the background; a row of any
 * other key is never ticked by default (none, when it is omitted).
 */
export function keyFindings(scans: ReadonlyMap<string, FrameKeyScan>, scope?: ReadonlySet<string>, known?: ReadonlySet<KeyName>): KeyFinding[] {
  const findings: KeyFinding[] = [];
  for (let r = 0; r < ROW_IDS.length; r++) {
    let edge = 0;
    let thick = 0;
    let all = 0;
    let large = false;
    let holding = 0;
    let placed = 0;
    let pixels = 0;
    let frames = 0;
    const colors = new Map<number, number>();
    for (const [id, scan] of scans) {
      const count = scan.counts[r];
      const leftover = count.edge + count.inside;
      edge += count.edge;
      thick += count.thick;
      all += leftover + count.thick;
      if (scan.visible > 0 && leftover > KEY_SHARE_MAX * scan.visible) large = true;
      if (leftover > 0) {
        holding++;
        if ((count.edgeRuns >= KEY_PLACES_EDGE && count.insideRuns >= KEY_PLACES_INSIDE) || count.edgeRuns >= KEY_PLACES_MANY) placed++;
      }
      if (leftover === 0 || (scope && !scope.has(id))) continue;
      pixels += leftover;
      frames++;
      for (const [c, n] of scan.exact[r]) colors.set(c, (colors.get(c) ?? 0) + n);
    }
    if (pixels === 0) continue;
    let best = 0;
    let bestCount = -1;
    for (const [c, n] of colors) {
      if (n > bestCount || (n === bestCount && c < best)) {
        best = c;
        bestCount = n;
      }
    }
    const rgb: Rgb = [(best >> 16) & 255, (best >> 8) & 255, best & 255];
    const art: ArtReason | null =
      thick >= KEY_THICK_SHARE * all ? 'thick'
      : large ? 'share'
      : edge === 0 ? 'inside'
      : placed === 0 || placed < KEY_EVIDENCE_SHARE * holding ? 'few'
      : !known?.has(KEY_NAMES[ROW_KEY[r]]) ? 'unknown'
      : null;
    findings.push({ row: ROW_IDS[r], key: KEY_NAMES[ROW_KEY[r]], rgb, hex: hexOf(rgb), pixels, frames, art });
  }
  return findings;
}

/** How many frames in scope (all when omitted) hold leftover of any of the
 *  given rows, and how many pixels. Thick runs are never counted. */
export function keyTotals(
  scans: ReadonlyMap<string, FrameKeyScan>,
  rows: ReadonlySet<RowId>,
  scope?: ReadonlySet<string>
): { pixels: number; frames: number } {
  let pixels = 0;
  let frames = 0;
  for (const [id, scan] of scans) {
    if (scope && !scope.has(id)) continue;
    let here = 0;
    for (let r = 0; r < ROW_IDS.length; r++) {
      if (rows.has(ROW_IDS[r])) here += scan.counts[r].edge + scan.counts[r].inside;
    }
    if (here > 0) {
      pixels += here;
      frames++;
    }
  }
  return { pixels, frames };
}

/**
 * Clears a frame's leftover pixels of the given rows to transparent, color
 * too, so no key color hides under the transparency. Returns a new array and
 * how many pixels it cleared; `px` is not changed. A second scan of the
 * result finds none of those rows' leftover.
 */
export function cleanKeyFrame(
  px: Uint8ClampedArray | Uint8Array,
  scan: FrameKeyScan,
  rows: ReadonlySet<RowId>
): { data: Uint8ClampedArray<ArrayBuffer>; cleared: number } {
  const data = new Uint8ClampedArray(px.length);
  data.set(px);
  let cleared = 0;
  for (let p = 0, i = 0; p < scan.marks.length; p++, i += 4) {
    const m = scan.marks[p];
    if (m === 0 || !rows.has(ROW_IDS[m - 1])) continue;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 0;
    cleared++;
  }
  return { data, cleared };
}

/**
 * The "Show where" kinds for residueOverlay: a mark on every pixel a clean
 * of the given rows would clear, grown by `grow` pixels (8-way) so a single
 * pixel still shows on a thumbnail drawn smaller than the frame. The marks
 * are RESIDUE_CLEAR (cyan), except on a cyan row, where cyan would not show:
 * there they are RESIDUE_DESPILL (yellow) (AUDIT clean-frames r1 L11).
 */
export function keyMarkKinds(scan: FrameKeyScan, rows: ReadonlySet<RowId>, grow = 0): Uint8Array {
  const { width: W, height: H, marks } = scan;
  const kinds = new Uint8Array(W * H);
  for (let p = 0; p < marks.length; p++) {
    const m = marks[p];
    if (m === 0 || !rows.has(ROW_IDS[m - 1])) continue;
    const kind = ROW_IDS[m - 1] === 'cyan' ? RESIDUE_DESPILL : RESIDUE_CLEAR;
    if (grow <= 0) {
      kinds[p] = kind;
      continue;
    }
    const x = p % W;
    const y = (p - x) / W;
    for (let ny = Math.max(0, y - grow); ny <= Math.min(H - 1, y + grow); ny++) {
      for (let nx = Math.max(0, x - grow); nx <= Math.min(W - 1, x + grow); nx++) {
        kinds[ny * W + nx] = kind;
      }
    }
  }
  return kinds;
}

/** Whether every frame is fully opaque: a sheet whose background was never
 *  removed. That is the page banner's job ("Remove background"; HQ
 *  2026-11-11-051, ruling 2); the strip is for what is left after it, so it
 *  stays out of the way. */
export function sheetIsOpaque(scans: ReadonlyMap<string, FrameKeyScan>): boolean {
  if (scans.size === 0) return false;
  for (const scan of scans.values()) {
    if (scan.visible < scan.width * scan.height) return false;
  }
  return true;
}

/** The rows a clean takes: each row's default (the one remembered for the
 *  sheet, when there is one, else what the scan says), with the person's
 *  own ticks and unticks on top. */
export function tickedRows(
  findings: readonly KeyFinding[],
  toggled: ReadonlyMap<RowId, boolean>,
  remembered?: ReadonlyMap<RowId, boolean>
): Set<RowId> {
  const ticked = new Set<RowId>();
  for (const f of findings) {
    if (toggled.get(f.row) ?? remembered?.get(f.row) ?? f.art === null) ticked.add(f.row);
  }
  return ticked;
}

// ---- The strip's words (DESIGN ticket upload-residue-clean) ----

const fmt = (n: number) => n.toLocaleString('en-US');
/** "1 pixel", "1,204 pixels". */
export const pixelsWord = (n: number) => `${fmt(n)} ${n === 1 ? 'pixel' : 'pixels'}`;
/** "1 frame", "12 frames". */
export const framesWord = (n: number) => `${fmt(n)} ${n === 1 ? 'frame' : 'frames'}`;

/** One color found: what follows the swatch and the hex. */
export function foundOneTail(f: KeyFinding, total: number): string {
  return `${pixelsWord(f.pixels)} in ${fmt(f.frames)} of ${framesWord(total)}.`;
}
/** Several colors found: the line above the rows. */
export function foundManyLine(frames: number, total: number): string {
  return `Leftover background found in ${fmt(frames)} of ${framesWord(total)}:`;
}
/** One row's count: "407 pixels · 12 frames". */
export function rowCount(f: KeyFinding): string {
  return `${pixelsWord(f.pixels)} · ${framesWord(f.frames)}`;
}
/** Every color found looks like art: the one line a quieter strip says. */
export function possibleLine(frames: number, total: number): string {
  return `Possible leftover background in ${fmt(frames)} of ${framesWord(total)}. It looks like part of your art, so it is left alone.`;
}
/** Said once when that quieter strip first appears after a slice. */
export const possibleAnnouncement = (frames: number) => `Possible leftover background in ${framesWord(frames)}.`;
export const ART_LINE = 'Looks like part of your art, so it is left alone. Check it to clean it too.';
/** A row that sits as leftover, of a key the page does not know was the
 *  background. Shown only in the found strip, beside a ticked row. */
export const UNSURE_LINE = 'Could be leftover background or part of your art. Check it to clean it too.';
/** Every row found starts unticked, and the page cannot place at least one of
 *  them: true of rows that look like art too (DESIGN -114). */
export function unsureLine(frames: number, total: number, rows: number): string {
  return `Possible leftover background in ${fmt(frames)} of ${framesWord(total)}. ${rows === 1 ? 'Check it to clean it.' : 'Check a color to clean it.'}`;
}
/** Which line a quiet strip says (DESIGN -114): its own when any row is one
 *  the page cannot place, the art line when every row looks like art. */
export type QuietKind = 'unsure' | 'art';
export function quietKind(findings: readonly KeyFinding[]): QuietKind {
  return findings.some((f) => f.art === 'unknown') ? 'unsure' : 'art';
}
/** The line under one row, or null (DESIGN -114): the strip's line says it
 *  once, and a row carries a line only when the strip's line does not cover
 *  it. A quiet strip: only a row that looks like art, beside one the page
 *  cannot place. The found strip: every row left alone carries its own. */
export function rowLine(f: KeyFinding, quiet: boolean, kind: QuietKind, leftAlone: boolean): string | null {
  if (!leftAlone) return null;
  if (quiet) return kind === 'unsure' && f.art !== 'unknown' ? ART_LINE : null;
  return f.art === 'unknown' ? UNSURE_LINE : ART_LINE;
}
export const NONE_TICKED = 'Check a color to clean.';
/** Said once when the strip first appears after a slice. */
export const foundAnnouncement = (frames: number) => `Leftover background found in ${framesWord(frames)}.`;
export const cleanedLine = (pixels: number, frames: number) => `Cleaned ${pixelsWord(pixels)} in ${framesWord(frames)}.`;
export const undoneLine = (frames: number) => `Undone. ${framesWord(frames)} restored.`;
/** The strip's refusals and failures (DESIGN 2026-11-11-014, gap-fill 5). */
export const CLEAN_STALE = 'The sheet changed, so nothing was cleaned. Press Clean again.';
export const UNDO_STALE = 'The sheet changed, so nothing was undone.';
export const CLEAN_FAILED = 'Could not clean these frames. Please try again.';
export const UNDO_FAILED = 'Could not undo. Please try again.';
export const EMPTY_SCOPE = 'No leftover background in the selected frames.';
