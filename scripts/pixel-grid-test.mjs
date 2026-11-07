// scripts/pixel-grid-test.mjs
//
// Offline tests for "Fix pixel grid" (W3): src/lib/pixelGrid.ts (the guard, the
// outcome of a run, the cap, the byte helpers, the copy), the store's edits
// that end a kept result, the notices, and the built
// public/wasm/pixel-grid.wasm, run in node on synthetic images made here. Run
// from the repo root:
// `node scripts/pixel-grid-test.mjs`. Bundles the module with esbuild into
// local/.pixel-grid-test/ (gitignored). Prints only case names and pass or fail.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mock } from 'node:test';
import { pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.pixel-grid-test', 'pixelGrid.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/lib/pixelGrid.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  cellCenterScore, gridStepsAgree, gridFixPasses, sameImage, fixGridOutcome,
  pixelGridCap, pixelGridCapSide, dataUrlToBytes, pngBytesToDataUrl,
  CELL_CENTER_MIN, CELL_CENTER_TOLERANCE, GRID_STEP_MAX_DIFFERENCE, MIN_SIDE, PIXEL_GRID_MAX_PIXELS, PIXEL_GRID_LOW_MEMORY_PIXELS,
  fixGridTooBig, fixGridSizes, fixGridBanner, fixGridDividerValue,
  FIX_GRID_RUNNING, FIX_GRID_TOO_SMALL, FIX_GRID_NOT_FOUND, FIX_GRID_SHOW_ANYWAY, FIX_GRID_MAY_BE_WRONG, FIX_GRID_DISMISS,
  FIX_GRID_CHANGED, FIX_GRID_FAILED, FIX_GRID_TOOLTIP, FIX_GRID_DESCRIPTION,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

async function assertRejects(promise, name, message) {
  try {
    await promise;
    check(name, false, 'resolved');
  } catch (err) {
    check(name, message === undefined || err.message === message, err.message);
  }
}

// Synthetic images.

/** A little repeatable generator, so the images are the same on every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A w x h opaque sprite: blocks of a small palette, no two neighbours alike
 *  more often than chance, so every pixel is a real pixel. */
function sprite(w, h, seed = 7) {
  const palette = [[24, 20, 37], [190, 74, 47], [234, 212, 170], [58, 68, 102], [99, 199, 77], [254, 174, 52], [38, 92, 66], [255, 255, 255]];
  const next = rng(seed);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = palette[Math.floor(next() * palette.length)];
      px.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  }
  return px;
}

function upscale(px, w, h, k) {
  const out = new Uint8ClampedArray(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) {
    for (let x = 0; x < w * k; x++) {
      const i = (Math.floor(y / k) * w + Math.floor(x / k)) * 4;
      out.set(px.subarray(i, i + 4), (y * w * k + x) * 4);
    }
  }
  return out;
}

/** A sheet the way the fixer's real input looks: rounded sprites of flat color
 *  with a dark outline and a few loose pixels, on a transparent background. */
function sheet(size, seed) {
  const palette = [[24, 20, 37], [190, 74, 47], [234, 212, 170], [58, 68, 102], [99, 199, 77], [254, 174, 52], [38, 92, 66], [255, 255, 255], [0, 0, 0], [140, 60, 120]];
  const next = rng(seed);
  const px = new Uint8ClampedArray(size * size * 4);
  const put = (x, y, c) => {
    if (x >= 0 && y >= 0 && x < size && y < size) px.set([c[0], c[1], c[2], 255], (y * size + x) * 4);
  };
  const cell = size / Math.round(size / 32);
  for (let oy = 0; oy < size; oy += cell) {
    for (let ox = 0; ox < size; ox += cell) {
      const body = palette[1 + Math.floor(next() * 6)];
      const shade = palette[1 + Math.floor(next() * 6)];
      const rx = cell * (0.25 + next() * 0.15);
      const ry = cell * (0.25 + next() * 0.15);
      const mx = ox + cell / 2;
      const my = oy + cell / 2 + cell * 0.05;
      const inside = (x, y) => (x + 0.5 - mx) ** 2 / (rx * rx) + (y + 0.5 - my) ** 2 / (ry * ry) <= 1;
      for (let y = oy; y < oy + cell; y++) {
        for (let x = ox; x < ox + cell; x++) {
          if (!inside(x, y)) continue;
          const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
          put(x, y, edge ? palette[0] : y < my ? body : shade);
        }
      }
      put(Math.round(mx - rx / 2), Math.round(my - ry / 3), palette[7]);
      put(Math.round(mx + rx / 2), Math.round(my - ry / 3), palette[7]);
      for (let k = 0; k < cell / 4; k++) put(Math.floor(ox + next() * cell), Math.floor(oy + next() * cell), palette[Math.floor(next() * 8)]);
    }
  }
  return px;
}

/** A separable Gaussian blur of a w x h image, on premultiplied color as a
 *  browser blurs. The damage AI art and rescaling leave. */
function blur(px, w, h, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  const premultiplied = new Float64Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    premultiplied.set([px[i] * a, px[i + 1] * a, px[i + 2] * a, px[i + 3]], i);
  }
  const pass = (from, step, count, lines, lineStep) => {
    const to = new Float64Array(from.length);
    for (let line = 0; line < lines; line++) {
      for (let at = 0; at < count; at++) {
        for (let k = 0; k < kernel.length; k++) {
          const i = Math.max(0, Math.min(count - 1, at + k - radius));
          for (let c = 0; c < 4; c++) to[(line * lineStep + at * step) * 4 + c] += (from[(line * lineStep + i * step) * 4 + c] * kernel[k]) / total;
        }
      }
    }
    return to;
  };
  const both = pass(pass(premultiplied, 1, w, h, w), w, h, w, 1);
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const a = both[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = a > 0 ? both[i + c] / a : 0;
    out[i + 3] = both[i + 3];
  }
  return out;
}

/** Each output cell takes the colour at its centre: the wrong-grid reduction
 *  the fixer does to clean art. */
function reduce(px, w, h, outW, outH) {
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = Math.floor(((x + 0.5) * w) / outW);
      const sy = Math.floor(((y + 0.5) * h) / outH);
      const i = (sy * w + sx) * 4;
      out.set(px.subarray(i, i + 4), (y * outW + x) * 4);
    }
  }
  return out;
}

// A small PNG writer and reader, RGBA 8 bit only on the way out; the reader
// takes what the fixer writes.

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function decodePng(buf) {
  let at = 8;
  let w = 0, h = 0, colour = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colour = data[9]; if (data[8] !== 8) throw new Error('bit depth'); }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const channels = { 6: 4, 2: 3 }[colour];
  if (!channels) throw new Error(`colour type ${colour}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const rows = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[y * stride + x - channels] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[y * stride + x] = (raw[line + x] + predicted) & 0xff;
    }
  }
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < channels; c++) px[i * 4 + c] = rows[i * channels + c];
    if (channels === 3) px[i * 4 + 3] = 255;
  }
  return { px, w, h };
}

// The fixer, as the worker calls it.

const wasmPath = path.join(ROOT, 'public/wasm/pixel-grid.wasm');
const wasmBytes = readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
function runFix(png) {
  const { exports: e } = new WebAssembly.Instance(wasmModule, {});
  const ptr = e.alloc(png.length);
  new Uint8Array(e.memory.buffer, ptr, png.length).set(png);
  const result = e.fix(ptr, png.length);
  if (result === 0) return { error: Buffer.from(e.memory.buffer, e.error_ptr(), e.error_len()).toString() };
  const length = new DataView(e.memory.buffer).getUint32(result, true);
  return { png: Buffer.from(e.memory.buffer.slice(result + 4, result + 4 + length)) };
}

// 1. The guard: the score, then the steps.
{
  const s = sprite(32, 32);
  check('score: an exact nearest upscale x4 scores 1', cellCenterScore(upscale(s, 32, 32, 4), 128, 128, s, 32, 32) === 1);
  const coarse = reduce(s, 32, 32, 11, 11);
  const low = cellCenterScore(s, 32, 32, coarse, 11, 11);
  check('score: a native sprite on a coarser wrong grid scores low', low < 0.4, low);
  check('score: and the guard refuses it', !gridFixPasses(s, 32, 32, coarse, 11, 11));

  const one = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);
  const a = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
  check('score: a transparent input pixel does not count', cellCenterScore(a, 2, 1, one(10, 20, 30), 1, 1) === 1);
  check('score: nor does one under alpha 128', cellCenterScore(new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 127]), 2, 1, one(10, 20, 30), 1, 1) === 1);
  check('score: alpha 128 counts', cellCenterScore(new Uint8ClampedArray([10, 20, 30, 255, 200, 200, 200, 128]), 2, 1, one(10, 20, 30), 1, 1) === 0.5);
  check('score: nothing counted scores 0', cellCenterScore(new Uint8ClampedArray(8), 2, 1, new Uint8ClampedArray(4), 1, 1) === 0);

  check('score: an opaque input against a transparent output cell is a miss', cellCenterScore(one(0, 0, 0), 1, 1, one(0, 0, 0, 0), 1, 1) === 0);
  check('score: and against output alpha 127', cellCenterScore(one(9, 9, 9), 1, 1, one(9, 9, 9, 127), 1, 1) === 0);
  check('score: output alpha 128 can match', cellCenterScore(one(9, 9, 9), 1, 1, one(9, 9, 9, 128), 1, 1) === 1);

  check('score: the tolerance is 24', CELL_CENTER_TOLERANCE === 24);
  check('score: 24 away on one channel matches', cellCenterScore(one(100, 100, 100), 1, 1, one(124, 100, 100), 1, 1) === 1);
  check('score: 25 away on one channel does not', cellCenterScore(one(100, 100, 100), 1, 1, one(100, 100, 75), 1, 1) === 0);

  // The rule on one row: a pixel counts when it is at least floor(step / 3)
  // px from both edges of its cell. Marks are pixels wrong for the output.
  const row = (w, outW, marks) => {
    const input = new Uint8ClampedArray(w * 4).fill(255);
    for (const x of marks) input.set([0, 0, 0, 255], x * 4);
    return cellCenterScore(input, w, 1, new Uint8ClampedArray(outW * 4).fill(255), outW, 1);
  };
  check('cells: x3, only the middle pixel of each cell counts', row(6, 2, [0, 2, 3, 5]) === 1 && row(6, 2, [1]) === 0.5);
  check('cells: x6, the two middle pixels count', row(6, 1, [0, 1, 4, 5]) === 1 && row(6, 1, [2]) === 0.5);
  check('cells: x2 has no margin, so every pixel counts', row(4, 2, [0]) === 0.75);
  check('cells: x2.5, cells of 3 and 2 px take a margin of 0', row(5, 2, [0, 3]) === 0.6);
  check('cells: x3.5, cells of 4 and 3 px take a margin of 1', row(7, 2, [0, 3, 4, 6]) === 1 && row(7, 2, [1]) < 1 && row(7, 2, [5]) < 1);
  const three = new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255, 200, 200, 200, 255]);
  const two = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
  check('cells: a 3 x 1 input on 2 x 1 maps x 0, 1 to cell 0 and x 2 to cell 1', cellCenterScore(three, 3, 1, two, 2, 1) === 1);
  check('cells: and the same for y', cellCenterScore(three, 1, 3, two, 1, 2) === 1);

  check('threshold: 0.98, two decimals (a change shows up here)', CELL_CENTER_MIN === 0.98);
  const flat = new Uint8ClampedArray(100 * 100 * 4).fill(200);
  check('steps: 10%, as a share of the larger', GRID_STEP_MAX_DIFFERENCE === 0.1);
  check('steps: equal steps agree', gridStepsAgree(100, 100, 10, 10));
  check('steps: 10.0 and 9.0 (exactly 10%) agree', gridStepsAgree(90, 90, 9, 10));
  check('steps: 10.0 and 8.9 do not', !gridStepsAgree(1000, 890, 100, 100));
  check('steps: a true result 6.55% apart agrees', gridStepsAgree(794, 742, 128, 128));
  const wrong = new Uint8ClampedArray(10 * 50 * 4).fill(200);
  check('steps: a wrong-size result that matches every cell scores 1', cellCenterScore(flat, 100, 100, wrong, 10, 50) === 1);
  check('steps: but with unequal steps it is refused', !gridFixPasses(flat, 100, 100, wrong, 10, 50));
}

// 1b. What a finished run leads to, and with it the "Show anyway" action,
// which exists only on 'refused'.
{
  const px = sprite(32, 32);
  const fake = upscale(px, 32, 32, 4);
  const start = { pixels: fake, width: 128, height: 128 };
  const right = { pixels: px, width: 32, height: 32 };
  const wrong = { pixels: reduce(px, 32, 32, 11, 11), width: 11, height: 11 };
  const edited = new Uint8ClampedArray(fake);
  edited[3 * 4] ^= 1;

  check('same image: the same bytes in another array', sameImage(start, { ...start, pixels: new Uint8ClampedArray(fake) }));
  check('same image: one byte off is not', !sameImage(start, { ...start, pixels: edited }));
  check('same image: another size is not', !sameImage(start, { pixels: fake, width: 64, height: 256 }));
  check('same image: an image gone is not', !sameImage(start, { pixels: null, width: 0, height: 0 }));

  check('outcome: a passing result is offered', fixGridOutcome(start, start, right) === 'offered');
  check('outcome: a refused result is refused', fixGridOutcome(start, start, wrong) === 'refused');
  check('outcome: an edit during the run drops a passing result', fixGridOutcome(start, { ...start, pixels: edited }, right) === 'changed');
  check('outcome: and a refused one, which then gets no action', fixGridOutcome(start, { ...start, pixels: edited }, wrong) === 'changed');
  check('outcome: a resized image is dropped too', fixGridOutcome(start, { pixels: px, width: 32, height: 32 }, right) === 'changed');
}

// 2. The cap and the limits.
{
  check('cap: 4,000,000 with no deviceMemory', pixelGridCap() === 4_000_000 && pixelGridCap(undefined) === 4_000_000);
  check('cap: 4,000,000 at 8 GB', pixelGridCap(8) === 4_000_000);
  check('cap: 2,000,000 at 4 GB', pixelGridCap(4) === 2_000_000);
  check('cap: 2,000,000 under 4 GB', pixelGridCap(0.5) === 2_000_000);
  check('cap: a value that is not a number is ignored', pixelGridCap('2') === 4_000_000 && pixelGridCap(null) === 4_000_000);
  check('cap: the sides are 2000 and 1414', pixelGridCapSide(PIXEL_GRID_MAX_PIXELS) === 2000 && pixelGridCapSide(PIXEL_GRID_LOW_MEMORY_PIXELS) === 1414);
  check('limits: the smallest side is 16', MIN_SIDE === 16);
}

// 3. The copy (George's at the go report; a change shows up here).
{
  check('copy: too big, full cap', fixGridTooBig(4_000_000) === 'This image is too big to fix here. Try one up to 2000 x 2000.');
  check('copy: too big, low memory', fixGridTooBig(2_000_000) === 'This image is too big to fix here. Try one up to 1414 x 1414.');
  check('copy: too small', FIX_GRID_TOO_SMALL === 'This image is too small to need fixing.');
  check('copy: the guard', FIX_GRID_NOT_FOUND === "Couldn't find a pixel grid to fix in this image. Nothing changed.");
  check('copy: the action on a refusal', FIX_GRID_SHOW_ANYWAY === 'Show anyway');
  check('copy: the line in the dialog', FIX_GRID_MAY_BE_WRONG === 'This may not be right. Compare before you use it.');
  check('copy: the dismiss button', FIX_GRID_DISMISS === 'Dismiss');
  check('copy: an edit during a run', FIX_GRID_CHANGED === 'The image changed while fixing, so nothing changed. Press Fix pixel grid again.');
  check('copy: the failure', FIX_GRID_FAILED === 'Fix pixel grid could not load. Try again in a moment. The rest of the editor still works.');
  check('copy: running', FIX_GRID_RUNNING === 'Fixing the pixel grid...');
  check('copy: the tooltip', FIX_GRID_TOOLTIP === 'Fix pixel grid: turns blurry or upscaled pixel art into clean pixels');
  check('copy: the description is not the name again', FIX_GRID_DESCRIPTION === 'Turns blurry or upscaled pixel art into clean pixels');
  check('copy: the divider\'s value', fixGridDividerValue(30) === '30% before, 70% after' && fixGridDividerValue(100) === '100% before, 0% after');
  check('copy: the size line', fixGridSizes(160, 120, 32, 24) === '160 x 120 to 32 x 24');
  check('copy: the banner', fixGridBanner(160, 120, 32, 24) === 'Pixel grid fixed: 160 x 120 to 32 x 24.');
}

// 4. Bytes to data URLs and back.
{
  const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) & 0xff);
  const url = pngBytesToDataUrl(bytes);
  check('bytes: a data URL says PNG', url.startsWith('data:image/png;base64,'));
  check('bytes: a large image comes back the same', Buffer.from(dataUrlToBytes(url)).equals(Buffer.from(bytes)));
}

// 5. The built fixer.
{
  const native = sprite(32, 32);
  const fake = upscale(native, 32, 32, 5);
  const fixed = runFix(encodePng(fake, 160, 160));
  check('wasm: x5 runs', !!fixed.png, fixed.error);
  if (fixed.png) {
    const out = decodePng(fixed.png);
    check('wasm: x5 gives back 32 x 32', out.w === 32 && out.h === 32, [out.w, out.h]);
    const same = out.px.length === native.length && out.px.every((v, i) => v === native[i]);
    check('wasm: x5 gives back the sprite exactly', same);
    check('wasm: the guard passes it', gridFixPasses(fake, 160, 160, out.px, out.w, out.h));
  }

  // The case that decided the score: blur smears only the borders between
  // cells, so a true fix of a blurred x3 sheet passes at the right size.
  const blurred = blur(upscale(sheet(128, 901), 128, 128, 3), 384, 384, 0.8);
  const unblurred = runFix(encodePng(blurred, 384, 384));
  check('wasm: a blurred x3 sheet runs', !!unblurred.png, unblurred.error);
  if (unblurred.png) {
    const out = decodePng(unblurred.png);
    check('wasm: a blurred x3 sheet comes back at the right size', out.w === 128 && out.h === 128, [out.w, out.h]);
    const score = cellCenterScore(blurred, 384, 384, out.px, out.w, out.h);
    check('wasm: the guard passes it', gridFixPasses(blurred, 384, 384, out.px, out.w, out.h), score);
  }

  const clean = runFix(encodePng(native, 32, 32));
  check('wasm: the sprite as it is runs', !!clean.png, clean.error);
  if (clean.png) {
    const out = decodePng(clean.png);
    const score = cellCenterScore(native, 32, 32, out.px, out.w, out.h);
    check('wasm: the guard refuses what it returns for a busy clean sprite', !gridFixPasses(native, 32, 32, out.px, out.w, out.h), { score, size: [out.w, out.h] });
  }

  const small = runFix(encodePng(sprite(15, 15), 15, 15));
  check('wasm: 15 px is refused with readable text', small.error === 'image too small (min side 16px)', small.error);
  const ok16 = runFix(encodePng(sprite(16, 16), 16, 16));
  check('wasm: 16 px is taken', !!ok16.png, ok16.error);
  const big = runFix(encodePng(new Uint8ClampedArray(2001 * 2000 * 4).fill(255), 2001, 2000));
  check('wasm: over 4 MP is refused with readable text', big.error === 'image too large (4.0MP > 4MP limit)', big.error);
  check('wasm: rubbish is refused with readable text', runFix(Buffer.from('not an image')).error?.startsWith('cannot open image:'));
}

// 6. The checked-in build.
{
  const line = readFileSync(`${wasmPath}.sha256`, 'utf8');
  const digest = createHash('sha256').update(wasmBytes).digest('hex');
  check('build: the sha256 file matches the .wasm', line.split(/\s+/)[0] === digest);
  const license = readFileSync(path.join(ROOT, 'public/wasm/pixel-art-fixer-LICENSE.txt'), 'utf8');
  check('build: the license ships with it', license.startsWith('MIT License') && license.includes('Astropulse, LLC'));
  check('build: the .wasm holds no local path', !wasmBytes.includes('/Users/'));

  const notices = readFileSync(path.join(ROOT, 'public/wasm/THIRD-PARTY-NOTICES.txt'), 'utf8');
  const credits = JSON.parse(readFileSync(path.join(ROOT, 'src/lib/pixelGridCredits.json'), 'utf8'));
  check('notices: every package has a row', credits.length > 0 && credits.every((c) => c.name && c.version && c.license && c.repository));
  check('notices: sorted', credits.every((c, i) => i === 0 || credits[i - 1].name < c.name));
  check('notices: every package has a block', credits.every((c) => notices.includes(`${c.version}\nLicense: ${c.license}\n`)));
  check('notices: the fixer and its owner', notices.includes('pixel-art-fixer (pixelfixer)') && notices.includes('Astropulse, LLC'));
  check('notices: the Rust standard library', /Rust standard library [\d.]+\nLicense: MIT\n/.test(notices) && notices.includes('The Rust Project Developers'));
  check('notices: the MIT text, once', notices.split('Permission is hereby granted').length === 2);
  check('notices: the BSD-3-Clause text, once', notices.split('Redistribution and use').length === 2);
  check('notices: no date or local path', !/\/Users\/|\d{4}-\d{2}-\d{2}/.test(notices));
  check('notices: only MIT and BSD-3-Clause', credits.every((c) => c.license === 'MIT' || c.license === 'BSD-3-Clause'));
}

// 7. The client: the worker starts on the first call, one request runs at a
// time, and every failure ends in a rejection the editor can answer.
{
  const CLIENT = path.join(ROOT, 'local', '.pixel-grid-test', 'pixelGridClient.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src/lib/pixelGridClient.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: CLIENT, logLevel: 'silent',
    alias: { '@': path.join(ROOT, 'src') },
  });
  const workers = [];
  globalThis.Worker = class {
    constructor(url) { this.url = String(url); this.posted = []; this.terminated = false; workers.push(this); }
    postMessage(message, transfer) { this.posted.push({ message, transfer }); }
    terminate() { this.terminated = true; }
  };
  const { fixPixelGrid, cancelPixelGrid, terminatePixelGrid } = await import(pathToFileURL(CLIENT).href);
  check('client: importing it starts no worker', workers.length === 0);

  const input = new ArrayBuffer(4);
  const first = fixPixelGrid(input);
  check('client: the first call starts the worker', workers.length === 1);
  check('client: it runs the pixel grid worker', workers[0].url.includes('pixelGrid.worker'));
  check('client: the image is handed over, not copied', workers[0].posted[0].transfer[0] === input);
  await assertRejects(fixPixelGrid(new ArrayBuffer(4)), 'client: a second call while one runs is refused');
  check('client: and posts nothing', workers[0].posted.length === 1);
  const { id } = workers[0].posted[0].message;
  const output = new ArrayBuffer(8);
  workers[0].onmessage({ data: { id: id + 100, ok: true, png: new ArrayBuffer(1) } });
  workers[0].onmessage({ data: { id, ok: true, png: output } });
  check('client: the answer to this request resolves it', (await first) === output);

  const second = fixPixelGrid(new ArrayBuffer(4));
  check('client: the worker is kept for the next image', workers.length === 1);
  workers[0].onmessage({ data: { id: workers[0].posted[1].message.id, ok: false, error: 'image too small (min side 16px)' } });
  await assertRejects(second, 'client: a refusal from the fixer rejects', 'image too small (min side 16px)');

  const dead = fixPixelGrid(new ArrayBuffer(4));
  workers[0].onerror({ preventDefault() {} });
  await assertRejects(dead, 'client: a worker that fails to load rejects');
  check('client: and is ended', workers[0].terminated);
  const retry = fixPixelGrid(new ArrayBuffer(4));
  check('client: the next call starts a new worker', workers.length === 2);
  workers[1].onmessage({ data: { id: workers[1].posted[0].message.id, ok: true, png: output } });
  check('client: and it works', (await retry) === output);

  mock.timers.enable({ apis: ['setTimeout'] });
  const stuck = fixPixelGrid(new ArrayBuffer(4));
  mock.timers.tick(59_999);
  check('client: no timeout before 60 s', !workers[1].terminated);
  mock.timers.tick(1);
  await assertRejects(stuck, 'client: a worker that never answers rejects at 60 s');
  check('client: and is ended', workers[1].terminated);
  mock.timers.reset();

  const cancelled = fixPixelGrid(new ArrayBuffer(4));
  const runningCount = workers.length;
  cancelPixelGrid();
  await assertRejects(cancelled, 'client: cancel fails the request under way');
  check('client: and keeps the worker', !workers.at(-1).terminated && workers.length === runningCount);
  const stale = workers.at(-1).posted.at(-1).message.id;
  const next = fixPixelGrid(new ArrayBuffer(4));
  check('client: the next image uses the same worker', workers.length === runningCount);
  workers.at(-1).onmessage({ data: { id: stale, ok: true, png: new ArrayBuffer(1) } });
  workers.at(-1).onmessage({ data: { id: workers.at(-1).posted.at(-1).message.id, ok: true, png: output } });
  check('client: a late answer to the cancelled run is ignored', (await next) === output);
  cancelPixelGrid();
  check('client: cancel with nothing running is safe', !workers.at(-1).terminated);

  const left = fixPixelGrid(new ArrayBuffer(4));
  terminatePixelGrid();
  await assertRejects(left, 'client: terminate() fails the request under way');
  check('client: terminate() ends the worker', workers.at(-1).terminated);
  terminatePixelGrid();
  check('client: terminate() with nothing running is safe', true);
}

// 8. "Show anyway" goes on an edit: the body drops the kept result when the
// store's pixels change, so every edit must change them, and nothing else may.
{
  const STORE = path.join(ROOT, 'local', '.pixel-grid-test', 'editorStore.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src/components/sprites/editorStore.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: STORE, logLevel: 'silent',
    tsconfig: path.join(ROOT, 'tsconfig.json'), external: ['zustand', 'zustand/*'],
  });
  globalThis.ImageData ??= class {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
  };
  const { useEditorStore } = await import(pathToFileURL(STORE).href);
  const store = () => useEditorStore.getState();
  const W = 16;
  const load = () => store().loadFrame('current', sprite(W, W), W, W);
  const dropsOn = (name, edit, prepare = () => {}) => {
    load();
    prepare();
    const start = { pixels: new Uint8ClampedArray(store().pixels), width: W, height: W };
    let dropped = 0;
    const stop = useEditorStore.subscribe((s) => s.pixels, () => { dropped++; });
    edit();
    stop();
    check(`action: goes on ${name}`, dropped > 0);
    check(`action: and the image is no longer the one fixed, ${name}`, !sameImage(start, store()));
  };
  const stroke = () => { store().beginStroke(); store().paintPixel(1, 1, '#123456'); store().endStroke(); };
  dropsOn('a stroke', stroke);
  dropsOn('a stroke held down, before it ends', () => { store().beginStroke(); store().paintPixel(1, 1, '#123456'); });
  dropsOn('an eraser stroke', () => { store().beginStroke(); store().erasePixel(1, 1); store().endStroke(); });
  dropsOn('undo', () => store().undo(), stroke);
  dropsOn('redo', () => store().redo(), () => { stroke(); store().undo(); });
  dropsOn('flip', () => store().flipHorizontal());
  dropsOn('revert', () => store().revertToOriginal(), stroke);
  load();
  let moved = 0;
  const stop = useEditorStore.subscribe((s) => s.pixels, () => { moved++; });
  store().setActiveTool('eraser');
  store().setBrushSize(4);
  store().setForegroundColor('#123456');
  store().eyedrop(1, 1);
  stop();
  check('action: stays through a tool, brush or color change', moved === 0);
}

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exitCode = failed ? 1 : 0;
