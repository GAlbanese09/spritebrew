// scripts/pixel-grid-test.mjs
//
// Offline tests for "Fix pixel grid" (W3): src/lib/pixelGrid.ts (the guard, the
// cap, the byte helpers, the copy) and the built public/wasm/pixel-grid.wasm,
// run in node on synthetic images made here. Run from the repo root:
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
  roundTripScore, pixelGridCap, pixelGridCapSide, dataUrlToBytes, pngBytesToDataUrl,
  ROUND_TRIP_MIN, ROUND_TRIP_TOLERANCE, MIN_SIDE, PIXEL_GRID_MAX_PIXELS, PIXEL_GRID_LOW_MEMORY_PIXELS,
  fixGridTooBig, fixGridSizes, fixGridBanner,
  FIX_GRID_RUNNING, FIX_GRID_TOO_SMALL, FIX_GRID_ALREADY_CLEAN, FIX_GRID_FAILED, FIX_GRID_TOOLTIP,
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

// 1. The guard's score.
{
  const s = sprite(32, 32);
  check('score: an exact nearest upscale x4 scores 1', roundTripScore(upscale(s, 32, 32, 4), 128, 128, s, 32, 32) === 1);
  const coarse = reduce(s, 32, 32, 11, 11);
  const low = roundTripScore(s, 32, 32, coarse, 11, 11);
  check('score: a native sprite on a coarser wrong grid scores low', low < 0.4, low);
  check('score: and the guard refuses it', low < ROUND_TRIP_MIN);

  const a = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
  check('score: a transparent input pixel does not count', roundTripScore(a, 2, 1, new Uint8ClampedArray([10, 20, 30, 255]), 1, 1) === 1);
  check('score: no visible pixel scores 0', roundTripScore(new Uint8ClampedArray(8), 2, 1, new Uint8ClampedArray(4), 1, 1) === 0);

  const one = (r, g, b) => new Uint8ClampedArray([r, g, b, 255]);
  check('score: the tolerance is 24', ROUND_TRIP_TOLERANCE === 24);
  check('score: 24 away on one channel matches', roundTripScore(one(100, 100, 100), 1, 1, one(124, 100, 100), 1, 1) === 1);
  check('score: 25 away on one channel does not', roundTripScore(one(100, 100, 100), 1, 1, one(100, 100, 75), 1, 1) === 0);

  // Cells: a 3 x 1 input on a 2 x 1 output maps x 0, 1 to cell 0 and x 2 to 1.
  const three = new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255, 200, 200, 200, 255]);
  const two = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
  check('score: cell x = floor(x * outW / inW)', roundTripScore(three, 3, 1, two, 2, 1) === 1);
  check('score: and the same for y', roundTripScore(three, 1, 3, two, 1, 2) === 1);
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
  check('copy: the guard', FIX_GRID_ALREADY_CLEAN === 'This already looks like clean pixel art. Nothing changed.');
  check('copy: the failure', FIX_GRID_FAILED === 'Fix pixel grid could not load. Try again in a moment. The rest of the editor still works.');
  check('copy: running', FIX_GRID_RUNNING === 'Fixing the pixel grid...');
  check('copy: the tooltip', FIX_GRID_TOOLTIP === 'Fix pixel grid: turns blurry or upscaled pixel art into clean pixels');
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
    check('wasm: the guard passes it', roundTripScore(fake, 160, 160, out.px, out.w, out.h) >= ROUND_TRIP_MIN);
  }

  const clean = runFix(encodePng(native, 32, 32));
  check('wasm: the sprite as it is runs', !!clean.png, clean.error);
  if (clean.png) {
    const out = decodePng(clean.png);
    const score = roundTripScore(native, 32, 32, out.px, out.w, out.h);
    check('wasm: the guard rejects what it returns for clean art', score < ROUND_TRIP_MIN, { score, size: [out.w, out.h] });
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
  const { fixPixelGrid, terminatePixelGrid } = await import(pathToFileURL(CLIENT).href);
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

  const left = fixPixelGrid(new ArrayBuffer(4));
  terminatePixelGrid();
  await assertRejects(left, 'client: terminate() fails the request under way');
  check('client: terminate() ends the worker', workers[2].terminated);
  terminatePixelGrid();
  check('client: terminate() with nothing running is safe', true);
}

console.log(failed ? `${failed} FAILED` : 'all passed');
process.exitCode = failed ? 1 : 0;
