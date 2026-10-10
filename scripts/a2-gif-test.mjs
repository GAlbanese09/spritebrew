// scripts/a2-gif-test.mjs
//
// Offline tests for src/lib/gifExport.ts (Wave 1 addendum A2: Download GIF).
// Run from the repo root: `node scripts/a2-gif-test.mjs`.
//
// gifenc runs in node, so the encode cases build tiny ImageData-shaped
// frames, encode them, and read the GIF back with the small parser below
// (blocks, delays, transparency, color tables and LZW pixel indexes).
//
// The harness writes only its esbuild bundle, to local/.a2-gif-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.a2-gif-test');

await build({
  entryPoints: { gifExport: path.join(ROOT, 'src/lib/gifExport.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const { gifDelaysCs, scaledSize, encodeGif } = await import(
  pathToFileURL(path.join(OUT, 'gifExport.mjs')).href
);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ── gifDelaysCs ──

const d8 = gifDelaysCs(8, 8);
check('8 fps x 8 -> 13, 12, 13, 12, 13, 12, 13, 12', eq(d8, [13, 12, 13, 12, 13, 12, 13, 12]));
check('8 fps x 8 totals 100 cs', sum(d8) === 100);
check('8 fps x 4 -> 13, 12, 13, 12 (alternates 12 and 13)', eq(gifDelaysCs(8, 4), [13, 12, 13, 12]));
check('8 fps x 5 totals round(5 * 100 / 8) = 63', sum(gifDelaysCs(8, 5)) === 63);
const d12 = gifDelaysCs(12, 12);
check('12 fps x 12 totals 100 cs', sum(d12) === 100);
check('12 fps steps are 8 or 9 cs', d12.every((d) => d === 8 || d === 9));
check('12 fps x 3 -> 8, 9, 8', eq(gifDelaysCs(12, 3), [8, 9, 8]));
const d24 = gifDelaysCs(24, 24);
check('24 fps x 24 totals 100 cs', sum(d24) === 100);
check('24 fps steps are 4 or 5 cs', d24.every((d) => d === 4 || d === 5));
check('every running total within 0.5 cs of n * 100 / fps (4..24 fps)', (() => {
  for (let fps = 4; fps <= 24; fps++) {
    const d = gifDelaysCs(fps, 40);
    let t = 0;
    for (let i = 0; i < d.length; i++) {
      t += d[i];
      if (Math.abs(t - ((i + 1) * 100) / fps) > 0.5) return false;
    }
  }
  return true;
})());
check('never below 2 cs (100 fps)', gifDelaysCs(100, 10).every((d) => d >= 2));
check('count 0 -> empty', eq(gifDelaysCs(8, 0), []));
check('bad fps falls back to 8', eq(gifDelaysCs(0, 2), [13, 12]) && eq(gifDelaysCs(NaN, 2), [13, 12]));

// ── scaledSize ──

check('scaledSize 128x128 @1 -> 128x128', eq(scaledSize(128, 128, 1), { w: 128, h: 128 }));
check('scaledSize 128x128 @4 -> 512x512', eq(scaledSize(128, 128, 4), { w: 512, h: 512 }));
check('scaledSize 64x32 @2 -> 128x64', eq(scaledSize(64, 32, 2), { w: 128, h: 64 }));
check('scaledSize 64x64 @8 -> 512x512', eq(scaledSize(64, 64, 8), { w: 512, h: 512 }));
check('scaledSize rejects 3, 0, 16 and 1.5',
  [3, 0, 16, 1.5].every((s) => throws(() => scaledSize(8, 8, s))));

// ── GIF reader ──

function lzwDecode(minCodeSize, data, pixelCount) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = [];
  let size = minCodeSize + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCodeSize + 1;
  };
  reset();
  let prev = null;
  let bitPos = 0;
  const totalBits = data.length * 8;
  while (bitPos + size <= totalBits && out.length < pixelCount) {
    let code = 0;
    for (let b = 0; b < size; b++, bitPos++) {
      if (data[bitPos >> 3] & (1 << (bitPos & 7))) code |= 1 << b;
    }
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else return null;
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  return out;
}

function readGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const subBlocks = () => {
    const parts = [];
    for (let n = u8(); n !== 0; n = u8()) { parts.push(...bytes.slice(p, p + n)); p += n; }
    return parts;
  };
  const header = String.fromCharCode(...bytes.slice(0, 6));
  p = 6;
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2;
  const gctSize = packed & 0x80 ? 1 << ((packed & 7) + 1) : 0;
  const gct = [];
  for (let i = 0; i < gctSize; i++) gct.push([u8(), u8(), u8()]);
  const gif = { header, width, height, gct, loop: null, frames: [] };
  let gce = null;
  for (;;) {
    const b = u8();
    if (b === 0x3b || b === undefined) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8();
        const fields = u8();
        const delay = u16();
        const tIndex = u8();
        u8();
        gce = { transparent: (fields & 1) === 1, dispose: (fields >> 2) & 7, delay, tIndex };
      } else if (label === 0xff) {
        const n = u8();
        const app = String.fromCharCode(...bytes.slice(p, p + n));
        p += n;
        const data = subBlocks();
        if (app === 'NETSCAPE2.0' && data[0] === 1) gif.loop = data[1] | (data[2] << 8);
      } else {
        subBlocks();
      }
    } else if (b === 0x2c) {
      p += 4;
      const w = u16();
      const h = u16();
      const f = u8();
      const local = (f & 0x80) !== 0;
      if (local) p += 3 * (1 << ((f & 7) + 1));
      const minCode = u8();
      const pixels = lzwDecode(minCode, subBlocks(), w * h);
      gif.frames.push({ w, h, local, gce, pixels });
      gce = null;
    } else {
      throw new Error(`bad block 0x${b.toString(16)}`);
    }
  }
  return gif;
}

const frame = (w, h, fill) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
};

// ── encodeGif: a tiny 2-frame sprite, 2x2 at 4x ──

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];
const HALF = [0, 255, 0, 127];
const SOLIDISH = [0, 255, 0, 128];
// Frame A: red, clear / alpha 127, alpha 128. Frame B: blue, red / clear, blue.
const fA = frame(2, 2, (x, y) => [[RED, CLEAR], [HALF, SOLIDISH]][y][x]);
const fB = frame(2, 2, (x, y) => [[BLUE, RED], [CLEAR, BLUE]][y][x]);
const blob = encodeGif([fA, fB, fA], { scale: 4, fps: 8 });
const bytes = new Uint8Array(await blob.arrayBuffer());
const gif = readGif(bytes);
const ascii = String.fromCharCode(...bytes);

check('encode returns an image/gif Blob', blob.type === 'image/gif');
check('starts with GIF89a', gif.header === 'GIF89a');
check('contains the NETSCAPE2.0 block', ascii.includes('NETSCAPE2.0'));
check('loops forever (loop count 0)', gif.loop === 0);
check('2x2 at 4x -> 8x8 screen', gif.width === 8 && gif.height === 8);
check('3 frames (duplicate kept)', gif.frames.length === 3);
check('every frame has the transparent flag set, index 0',
  gif.frames.every((f) => f.gce && f.gce.transparent && f.gce.tIndex === 0));
check('every frame disposes to background (2)', gif.frames.every((f) => f.gce.dispose === 2));
check('delays read back as 13, 12, 13 cs', eq(gif.frames.map((f) => f.gce.delay), [13, 12, 13]));
check('one global color table, no local tables', gif.gct.length > 0 && gif.frames.every((f) => !f.local));
const color = (f, x, y) => gif.gct[gif.frames[f].pixels[y * 8 + x]];
const index = (f, x, y) => gif.frames[f].pixels[y * 8 + x];
check('alpha 0 and 127 -> transparent index; alpha 128 -> opaque',
  index(0, 4, 0) === 0 && index(0, 0, 4) === 0 && index(0, 4, 4) !== 0 && eq(color(0, 4, 4), [0, 255, 0]));
check('opaque colors exact (red, blue)', eq(color(0, 0, 0), [255, 0, 0]) && eq(color(1, 0, 0), [0, 0, 255]));
check('nearest-neighbor 4x blocks are uniform', (() => {
  for (let f = 0; f < 3; f++) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (index(f, x, y) !== index(f, x - (x % 4), y - (y % 4))) return false;
      }
    }
  }
  return true;
})());
check('no opaque pixel uses the transparent slot',
  index(1, 0, 0) !== 0 && index(1, 4, 0) !== 0 && index(1, 4, 4) !== 0);
check('frame 3 equals frame 1 (duplicate)', eq(gif.frames[2].pixels, gif.frames[0].pixels));

// ── encodeGif: over 255 colors is quantized to one shared palette ──

const many = [0, 1].map((k) =>
  frame(20, 20, (x, y) => {
    const i = y * 20 + x; // 400 colors per frame, different per frame
    return i === 0 ? CLEAR : [(i * 7 + k * 50) & 255, (i * 13) & 255, (i * 3 + k) & 255, 255];
  })
);
const gifMany = readGif(new Uint8Array(await encodeGif(many, { scale: 1, fps: 12 }).arrayBuffer()));
check('over 256 colors still encodes, 2 frames', gifMany.frames.length === 2);
check('quantized: global table of 256, no local tables (no palette flicker)',
  gifMany.gct.length === 256 && gifMany.frames.every((f) => !f.local));
check('quantized: transparent pixel kept, opaque pixels never index 0',
  gifMany.frames.every((f) => f.pixels[0] === 0 && f.pixels.slice(1).every((v) => v !== 0)));
check('quantized: decoded pixel count matches', gifMany.frames.every((f) => f.pixels.length === 400));

// ── encodeGif input checks ──

check('no frames throws', throws(() => encodeGif([], { scale: 1, fps: 8 })));
check('scale 3 throws', throws(() => encodeGif([fA], { scale: 3, fps: 8 })));
check('mixed frame sizes throw', throws(() => encodeGif([fA, frame(3, 2, () => RED)], { scale: 1, fps: 8 })));
check('all-transparent frame encodes', readGif(new Uint8Array(
  await encodeGif([frame(2, 2, () => CLEAR)], { scale: 1, fps: 8 }).arrayBuffer()
)).frames[0].pixels.every((v) => v === 0));

// ── 4-frame 128 px Walk at 4x -> 512x512 ──

const walk = [0, 1, 2, 3].map((k) =>
  frame(128, 128, (x, y) => ((x - 64) ** 2 + (y - 64 - k * 4) ** 2 < 900 ? [200, 120 + k * 20, 40, 255] : CLEAR))
);
const gifWalk = readGif(new Uint8Array(
  await encodeGif([walk[0], walk[2], walk[1], walk[3], walk[1]], { scale: 4, fps: 8 }).arrayBuffer()
));
check('128 px frames at 4x -> 512x512, 5 frames in the given order',
  gifWalk.width === 512 && gifWalk.height === 512 && gifWalk.frames.length === 5
  && gifWalk.frames.every((f) => f.w === 512 && f.h === 512 && f.pixels.length === 512 * 512)
  && eq(gifWalk.frames[2].pixels, gifWalk.frames[4].pixels)
  && !eq(gifWalk.frames[1].pixels, gifWalk.frames[2].pixels));
check('Walk delays 13, 12, 13, 12, 13', eq(gifWalk.frames.map((f) => f.gce.delay), [13, 12, 13, 12, 13]));

console.log(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
