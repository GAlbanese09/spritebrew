/**
 * Writes Aseprite files (.aseprite) in the browser (W2, competitive push;
 * HQ 2026-11-03-007 and -021). No maintained, licence-clean JS writer
 * exists (research/editor-export-build-refs.md Q2), so this follows
 * Aseprite's own spec (aseprite/aseprite docs/ase-file-specs.md):
 *
 * - RGBA (32 bpp), header flag 1 (layer opacity valid), one layer.
 * - Frame 0 carries a Color Profile chunk (sRGB), a Palette chunk (the
 *   distinct colours found, at most 256), the Layer chunk and the Tags
 *   chunk, with one User Data chunk per tag for its colour.
 * - Every frame has its own duration and one cel: a zlib-compressed image
 *   trimmed to the frame's opaque bounds (type 2), or a link to an earlier
 *   frame with identical pixels (type 1). A fully transparent frame has no
 *   cel. Frames are never dropped, so tag ranges stay right.
 *
 * zlib comes from the browser's CompressionStream('deflate'), which writes
 * exactly the zlib format a cel needs; where it is missing, a stored
 * (uncompressed) zlib stream is written instead, which every inflater
 * reads. No dependency.
 *
 * Pure apart from the compressor, which callers may pass in; tested
 * offline by scripts/aseprite-writer-test.mjs with its own reader.
 */

/** One frame: W x H RGBA bytes and its duration in ms. */
export interface AseFrame {
  pixels: Uint8ClampedArray | Uint8Array;
  durationMs: number;
}

export type AseTagDirection = 'forward' | 'reverse' | 'pingpong' | 'pingpong_reverse';

/** A tag: an animation's frame range (inclusive), as Aseprite names it. */
export interface AseTag {
  name: string;
  from: number;
  to: number;
  direction?: AseTagDirection;
  /** 0 plays forever (Aseprite's default); 1 plays once. */
  repeat?: number;
  /** Tag colour as [r, g, b]. */
  color?: readonly [number, number, number];
}

export interface AseDocument {
  width: number;
  height: number;
  frames: AseFrame[];
  tags: AseTag[];
  layerName?: string;
}

/** Compresses bytes to a zlib stream. */
export type ZlibCompress = (raw: Uint8Array) => Promise<Uint8Array>;

const TAG_DIRECTION: Record<AseTagDirection, number> = { forward: 0, reverse: 1, pingpong: 2, pingpong_reverse: 3 };
const MAX_PALETTE = 256;

export const ASE_MAGIC = 0xa5e0;
export const ASE_FRAME_MAGIC = 0xf1fa;
export const CHUNK_LAYER = 0x2004;
export const CHUNK_CEL = 0x2005;
export const CHUNK_COLOR_PROFILE = 0x2007;
export const CHUNK_TAGS = 0x2018;
export const CHUNK_PALETTE = 0x2019;
export const CHUNK_USER_DATA = 0x2020;

/** A frame's duration as playback shows it: 1000 / fps, rounded, at least 1 ms
 *  (HQ 2026-11-03-021, ruling 1: the stored per-frame duration is not yet
 *  real; the timeline will make it so). */
export function frameDurationFromFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 100;
  return clampWord(Math.round(1000 / fps), 1);
}

function clampWord(v: number, min = 0): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(0xffff, Math.round(v)));
}

/** Adler-32 of `data` (zlib's trailer). */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  // 5552 is the largest block that cannot overflow 32 bits before the mod.
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream of stored (uncompressed) deflate blocks: the fallback when
 *  CompressionStream is missing. */
export function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 0xffff));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; // CMF: deflate, 32K window
  out[o++] = 0x01; // FLG: no dictionary, fastest; (0x78 << 8 | 0x01) % 31 === 0
  for (let b = 0; b < blocks; b++) {
    const start = b * 0xffff;
    const len = Math.min(0xffff, raw.length - start);
    out[o++] = b === blocks - 1 ? 1 : 0; // BFINAL, BTYPE 00 (stored)
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  out[o++] = ad >>> 24;
  out[o++] = (ad >>> 16) & 0xff;
  out[o++] = (ad >>> 8) & 0xff;
  out[o++] = ad & 0xff;
  return out;
}

/** zlib through the browser's CompressionStream, else stored blocks. */
export const zlibCompress: ZlibCompress = async (raw) => {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Fall through to stored blocks.
    }
  }
  return zlibStored(raw);
};

/** A growable little-endian byte writer. */
class ByteWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  byte(v: number): void { this.ensure(1); this.view.setUint8(this.length, v & 0xff); this.length += 1; }
  word(v: number): void { this.ensure(2); this.view.setUint16(this.length, v & 0xffff, true); this.length += 2; }
  short(v: number): void { this.ensure(2); this.view.setInt16(this.length, v, true); this.length += 2; }
  dword(v: number): void { this.ensure(4); this.view.setUint32(this.length, v >>> 0, true); this.length += 4; }
  zeros(n: number): void { this.ensure(n); this.buf.fill(0, this.length, this.length + n); this.length += n; }
  bytes(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; }
  string(s: string): void {
    const b = new TextEncoder().encode(s);
    let n = Math.min(b.length, 0xffff);
    // Cut a long string on a character boundary: never inside a UTF-8 sequence.
    if (n < b.length) while (n > 0 && (b[n] & 0xc0) === 0x80) n--;
    this.word(n);
    this.bytes(b.subarray(0, n));
  }
  /** Writes a DWORD at an earlier offset (sizes known only at the end). */
  patchDword(at: number, v: number): void { this.view.setUint32(at, v >>> 0, true); }
  patchWord(at: number, v: number): void { this.view.setUint16(at, v & 0xffff, true); }
  result(): Uint8Array { return this.buf.slice(0, this.length); }
}

/** Opaque bounds of a W x H RGBA image, or null when fully transparent. */
export function opaqueBounds(px: Uint8ClampedArray | Uint8Array, W: number, H: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(px: Uint8ClampedArray | Uint8Array, W: number, r: { x: number; y: number; w: number; h: number }): Uint8Array {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let row = 0; row < r.h; row++) {
    const s = ((r.y + row) * W + r.x) * 4;
    out.set(px.subarray(s, s + r.w * 4), row * r.w * 4);
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The distinct visible colours (RGBA), in the order first seen, at most 256. */
export function collectPalette(frames: readonly AseFrame[]): [number, number, number, number][] {
  const seen = new Set<number>();
  const out: [number, number, number, number][] = [];
  for (const f of frames) {
    const px = f.pixels;
    for (let i = 0; i + 3 < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const key = ((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([px[i], px[i + 1], px[i + 2], px[i + 3]]);
      if (out.length === MAX_PALETTE) return out;
    }
  }
  return out;
}

export type CelPlan =
  | { kind: 'none' }
  | { kind: 'image'; x: number; y: number; w: number; h: number; raw: Uint8Array }
  // A link carries its twin's position: Aseprite treats a linked cel whose
  // x, y or opacity differ from the cel it links to as a copy placed at the
  // link's own x, y (aseprite_decoder.cpp, readCelChunk).
  | { kind: 'link'; frame: number; x: number; y: number };

/**
 * Plans each frame's cel: trimmed to its opaque bounds, or a link to the
 * first earlier frame with identical pixels (a link always points at a real
 * image cel), or none for a fully transparent frame. Candidates are bucketed
 * by bounds and checksum, so bytes are compared only between likely twins;
 * `compares` counts those byte comparisons (a long sheet of near-identical
 * frames needs none), so a test can pin the work without timing it.
 */
export function planCels(frames: readonly AseFrame[], W: number, H: number): { plans: CelPlan[]; compares: number } {
  const plans: CelPlan[] = [];
  const buckets = new Map<string, number[]>();
  let compares = 0;
  for (const [fi, f] of frames.entries()) {
    const r = opaqueBounds(f.pixels, W, H);
    if (!r) { plans.push({ kind: 'none' }); continue; }
    const raw = crop(f.pixels, W, r);
    const key = `${r.x},${r.y},${r.w},${r.h},${adler32(raw)}`;
    const same = buckets.get(key) ?? [];
    const twin = same.find((i) => {
      const p = plans[i];
      if (p.kind !== 'image') return false;
      compares++;
      return sameBytes(p.raw, raw);
    });
    if (twin !== undefined) {
      plans.push({ kind: 'link', frame: twin, x: r.x, y: r.y });
    } else {
      plans.push({ kind: 'image', ...r, raw });
      same.push(fi);
      buckets.set(key, same);
    }
  }
  return { plans, compares };
}

/** Encodes a document as .aseprite bytes. Throws on a size Aseprite cannot
 *  hold or on pixel data of the wrong length. */
export async function encodeAseprite(doc: AseDocument, compress: ZlibCompress = zlibCompress): Promise<Uint8Array> {
  const { width: W, height: H, frames } = doc;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 1 || H < 1 || W > 0xffff || H > 0xffff) {
    throw new Error(`asepriteWriter: bad size ${W}x${H}`);
  }
  if (frames.length < 1 || frames.length > 0xffff) throw new Error(`asepriteWriter: bad frame count ${frames.length}`);
  for (const [i, f] of frames.entries()) {
    if (f.pixels.length !== W * H * 4) throw new Error(`asepriteWriter: frame ${i} has ${f.pixels.length} bytes, expected ${W * H * 4}`);
  }

  const { plans } = planCels(frames, W, H);
  const zipped = await Promise.all(plans.map((p) => (p.kind === 'image' ? compress(p.raw) : Promise.resolve(null))));

  const palette = collectPalette(frames);
  if (palette.length === 0) palette.push([0, 0, 0, 255]);
  const tags = doc.tags.filter((t) => t.from >= 0 && t.to >= t.from && t.to < frames.length);

  const w = new ByteWriter();
  // Header, 128 bytes.
  w.dword(0); // file size, patched at the end
  w.word(ASE_MAGIC);
  w.word(frames.length);
  w.word(W);
  w.word(H);
  w.word(32); // RGBA
  w.dword(1); // flags: layer opacity valid
  w.word(clampWord(frames[0].durationMs, 1)); // speed (deprecated): the first frame's
  w.dword(0);
  w.dword(0);
  w.byte(0); // transparent index (indexed sprites only)
  w.zeros(3);
  w.word(palette.length === MAX_PALETTE ? 0 : palette.length); // number of colours (0 means 256)
  w.byte(1); // pixel width
  w.byte(1); // pixel height
  w.short(0); // grid x
  w.short(0); // grid y
  w.word(16); // grid width
  w.word(16); // grid height
  w.zeros(84);

  for (let fi = 0; fi < frames.length; fi++) {
    const frameStart = w.length;
    w.dword(0); // bytes in this frame, patched
    w.word(ASE_FRAME_MAGIC);
    const oldCountAt = w.length;
    w.word(0); // old chunk count, patched
    w.word(clampWord(frames[fi].durationMs, 1));
    w.zeros(2);
    const newCountAt = w.length;
    w.dword(0); // chunk count, patched
    let chunks = 0;
    const chunk = (type: number, body: (cw: ByteWriter) => void) => {
      const start = w.length;
      w.dword(0);
      w.word(type);
      body(w);
      w.patchDword(start, w.length - start);
      chunks++;
    };

    if (fi === 0) {
      chunk(CHUNK_COLOR_PROFILE, (c) => {
        c.word(1); // sRGB
        c.word(0); // flags
        c.dword(0); // fixed gamma (unused without flag 1)
        c.zeros(8);
      });
      chunk(CHUNK_PALETTE, (c) => {
        c.dword(palette.length);
        c.dword(0);
        c.dword(palette.length - 1);
        c.zeros(8);
        for (const [r, g, b, a] of palette) {
          c.word(0); // no name
          c.byte(r); c.byte(g); c.byte(b); c.byte(a);
        }
      });
      chunk(CHUNK_LAYER, (c) => {
        c.word(3); // visible, editable
        c.word(0); // normal layer
        c.word(0); // child level
        c.word(0); // default width (ignored)
        c.word(0); // default height (ignored)
        c.word(0); // blend: normal
        c.byte(255); // opacity
        c.zeros(3);
        c.string(doc.layerName || 'Layer 1');
      });
      if (tags.length > 0) {
        chunk(CHUNK_TAGS, (c) => {
          c.word(tags.length);
          c.zeros(8);
          for (const t of tags) {
            const [r, g, b] = t.color ?? [0, 0, 0];
            c.word(t.from);
            c.word(t.to);
            c.byte(TAG_DIRECTION[t.direction ?? 'forward']);
            c.word(clampWord(t.repeat ?? 0));
            c.zeros(6);
            c.byte(r); c.byte(g); c.byte(b); // deprecated colour, kept for 1.2 readers
            c.byte(0);
            c.string(t.name);
          }
        });
        // One User Data chunk per tag, in order: the tag's colour (1.3).
        for (const t of tags) {
          chunk(CHUNK_USER_DATA, (c) => {
            if (t.color) {
              c.dword(2); // has colour
              c.byte(t.color[0]); c.byte(t.color[1]); c.byte(t.color[2]); c.byte(255);
            } else {
              c.dword(0);
            }
          });
        }
      }
    }

    const plan = plans[fi];
    if (plan.kind !== 'none') {
      chunk(CHUNK_CEL, (c) => {
        c.word(0); // layer index
        c.short(plan.x);
        c.short(plan.y);
        c.byte(255); // opacity
        c.word(plan.kind === 'image' ? 2 : 1); // compressed image, or linked
        c.short(0); // z-index
        c.zeros(5);
        if (plan.kind === 'image') {
          c.word(plan.w);
          c.word(plan.h);
          c.bytes(zipped[fi]!);
        } else {
          c.word(plan.frame);
        }
      });
    }

    w.patchWord(oldCountAt, Math.min(chunks, 0xffff));
    w.patchDword(newCountAt, chunks);
    w.patchDword(frameStart, w.length - frameStart);
  }

  w.patchDword(0, w.length);
  return w.result();
}

/** One animation as the export knows it: its frames in order (each W x H
 *  RGBA), its fps and loop flag, its tag name and colour. */
export interface AseAnimationInput {
  name: string;
  fps: number;
  loop: boolean;
  color?: readonly [number, number, number];
  frames: (Uint8ClampedArray | Uint8Array)[];
}

/**
 * The document for a sheet's animations: frames in animation order, each
 * with the duration playback uses (frameDurationFromFps), and one tag per
 * animation that has frames (forward; plays once when the animation does
 * not loop). An animation with no frames gets no tag and shifts nothing.
 */
export function asepriteDocumentFrom(animations: readonly AseAnimationInput[], W: number, H: number, layerName = 'Layer 1'): AseDocument {
  const frames: AseFrame[] = [];
  const tags: AseTag[] = [];
  for (const a of animations) {
    if (a.frames.length === 0) continue;
    const from = frames.length;
    const durationMs = frameDurationFromFps(a.fps);
    for (const pixels of a.frames) frames.push({ pixels, durationMs });
    tags.push({ name: a.name, from, to: frames.length - 1, direction: 'forward', repeat: a.loop ? 0 : 1, color: a.color });
  }
  return { width: W, height: H, frames, tags, layerName };
}
