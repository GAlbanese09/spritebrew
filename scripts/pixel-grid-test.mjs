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
  cellCenterScore, cellScoreAt, gridStepsAgree, gridFixPasses, sameImage, fixGridOutcome,
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

/** A nearest upscale by a whole k, then cx px cut from the left and cy from
 *  the top: art whose grid starts partway into a cell, as an AI image or a
 *  crop has it. */
function offsetUpscale(px, w, h, k, cx, cy) {
  const W = w * k - cx;
  const H = h * k - cy;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (Math.floor((y + cy) / k) * w + Math.floor((x + cx) / k)) * 4;
      out.set(px.subarray(i, i + 4), (y * W + x) * 4);
    }
  }
  return { px: out, w: W, h: H };
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
  check('score: a native sprite on a coarser wrong grid scores low', low < 0.5, low);
  check('score: and the guard refuses it', !gridFixPasses(s, 32, 32, coarse, 11, 11));

  // Steps of 1 px cannot shift, so these test what counts and what matches.
  const one = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);
  const pair = (...rgba) => new Uint8ClampedArray(rgba);
  const ink = pair(10, 20, 30, 255, 10, 20, 30, 255);
  check('score: a transparent input pixel does not count', cellCenterScore(pair(10, 20, 30, 255, 0, 0, 0, 0), 2, 1, ink, 2, 1) === 1);
  check('score: nor does one under alpha 128', cellCenterScore(pair(10, 20, 30, 255, 200, 200, 200, 127), 2, 1, ink, 2, 1) === 1);
  check('score: alpha 128 counts', cellCenterScore(pair(10, 20, 30, 255, 200, 200, 200, 128), 2, 1, ink, 2, 1) === 0.5);
  check('score: nothing counted scores 0', cellCenterScore(new Uint8ClampedArray(8), 2, 1, new Uint8ClampedArray(4), 1, 1) === 0);

  check('score: an opaque input against a transparent output cell is a miss', cellCenterScore(one(0, 0, 0), 1, 1, one(0, 0, 0, 0), 1, 1) === 0);
  check('score: a miss, not a pixel left out: one transparent output cell of two scores 0.5',
    cellCenterScore(ink, 2, 1, pair(10, 20, 30, 0, 10, 20, 30, 255), 2, 1) === 0.5);
  check('score: and against output alpha 127', cellCenterScore(one(9, 9, 9), 1, 1, one(9, 9, 9, 127), 1, 1) === 0);
  check('score: output alpha 128 can match', cellCenterScore(one(9, 9, 9), 1, 1, one(9, 9, 9, 128), 1, 1) === 1);

  check('score: the tolerance is 24', CELL_CENTER_TOLERANCE === 24);
  check('score: 24 away on one channel matches', cellCenterScore(one(100, 100, 100), 1, 1, one(124, 100, 100), 1, 1) === 1);
  check('score: 25 away on one channel does not', cellCenterScore(one(100, 100, 100), 1, 1, one(100, 100, 75), 1, 1) === 0);

  // The rule on one row, at a given shift of the cell edges: a pixel counts
  // when it is at least floor(width / 3) px from both edges of its own cell.
  // Marks are pixels wrong for the output.
  const row = (w, outW, marks, shift = 0) => {
    const input = new Uint8ClampedArray(w * 4).fill(255);
    for (const x of marks) input.set([0, 0, 0, 255], x * 4);
    return cellScoreAt(input, w, 1, new Uint8ClampedArray(outW * 4).fill(255), outW, 1, shift, 0);
  };
  check('cells: x3, only the middle pixel of each cell counts', row(6, 2, [0, 2, 3, 5]) === 1 && row(6, 2, [1]) === 0.5);
  check('cells: x6, the two middle pixels count', row(6, 1, [0, 1, 4, 5]) === 1 && row(6, 1, [2]) === 0.5);
  check('cells: x2 has no margin, so every pixel counts', row(4, 2, [0]) === 0.75);
  check('cells: x2.5, a 3 px cell counts its middle pixel and a 2 px cell both', row(5, 2, [0, 2]) === 1 && row(5, 2, [0, 3]) === 2 / 3 && row(5, 2, [1]) === 2 / 3);
  check('cells: x3.5, cells of 4 and 3 px take a margin of 1', row(7, 2, [0, 3, 4, 6]) === 1 && row(7, 2, [1]) === 2 / 3 && row(7, 2, [5]) === 2 / 3);
  check('cells: a shift moves the cells: x3 moved 1 px counts x 2 and 5', row(6, 2, [0, 1, 3, 4], 1) === 1 && row(6, 2, [2], 1) === 0.5);
  check('cells: a pixel a shift leaves outside every cell does not count', row(6, 2, [5], -1) === 1 && row(6, 2, [0], -1) === 0.5);
  const three = new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255, 200, 200, 200, 255]);
  const two = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
  check('cells: a 3 x 1 input on 2 x 1 maps x 0, 1 to cell 0 and x 2 to cell 1', cellScoreAt(three, 3, 1, two, 2, 1, 0, 0) === 1);
  check('cells: and the same for y', cellScoreAt(three, 1, 3, two, 1, 2, 0, 0) === 1);

  // The search: the fixer cuts even cells from the corner, so art whose grid
  // starts partway into a cell is scored against its own cells. A perfect
  // fix, the native art itself, passes (audit r2, finding 1).
  const art = sprite(32, 32, 31);
  for (const [k, cx, cy] of [[3, 1, 0], [4, 2, 0], [4, 2, 2], [6, 3, 0]]) {
    const off = offsetUpscale(art, 32, 32, k, cx, cy);
    const score = cellCenterScore(off.px, off.w, off.h, art, 32, 32);
    check(`search: a perfect fix of x${k} shifted ${cy ? `${cx},${cy}` : cx} px passes`, score === 1 && gridFixPasses(off.px, off.w, off.h, art, 32, 32), score);
  }
  // A crop that leaves a sliver of the first cell: the fixer may keep it or
  // drop it, and a fix that drops it, the art less that cell, is right
  // (BUILD-2's ruling on the r2 stop). The same size with the far edge
  // dropped is a wrong fix.
  const less = (px, w, h, left, top, right, bottom) => {
    const W = w - left - right;
    const H = h - top - bottom;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) out.set(px.subarray(((y + top) * w + left) * 4, ((y + top) * w + left + W) * 4), y * W * 4);
    return { px: out, w: W, h: H };
  };
  for (const [k, cx, cy] of [[3, 2, 0], [3, 2, 2], [4, 3, 0]]) {
    const off = offsetUpscale(art, 32, 32, k, cx, cy);
    const dropped = less(art, 32, 32, cx ? 1 : 0, cy ? 1 : 0, 0, 0);
    const farEnd = less(art, 32, 32, 0, 0, cx ? 1 : 0, cy ? 1 : 0);
    const name = `x${k} cut ${cy ? `${cx},${cy}` : cx} px`;
    check(`search: ${name}, the art less the cell the crop cut passes`, gridFixPasses(off.px, off.w, off.h, dropped.px, dropped.w, dropped.h), cellCenterScore(off.px, off.w, off.h, dropped.px, dropped.w, dropped.h));
    check(`search: ${name}, the art less its far edge is refused`, !gridFixPasses(off.px, off.w, off.h, farEnd.px, farEnd.w, farEnd.h), cellCenterScore(off.px, off.w, off.h, farEnd.px, farEnd.w, farEnd.h));
  }
  const corner = offsetUpscale(art, 32, 32, 4, 2, 0);
  check('search: without it, cells from the corner score x4 shifted 2 px under 0.9', cellScoreAt(corner.px, corner.w, corner.h, art, 32, 32, 0, 0) < 0.9);
  // On random pairs (right results, wrong sizes, wrong content) the search
  // gives the rule's own score at some pair of shifts within half a cell, no
  // less than at no shift and no more than the best of every pair.
  const next = rng(4242);
  const odd = [];
  for (let t = 0; t < 60; t++) {
    const n = 6 + Math.floor(next() * 10);
    const k = [2, 3, 4, 5][Math.floor(next() * 4)];
    const src = sprite(n, n, 100 + t);
    const off = offsetUpscale(src, n, n, k, Math.floor(next() * k), Math.floor(next() * k));
    const ow = t % 3 === 0 ? n + 1 : n;
    const oh = t % 4 === 0 ? n - 1 : n;
    const out = t % 3 === 0 || t % 4 === 0 ? reduce(off.px, off.w, off.h, ow, oh) : t % 5 === 0 ? sprite(n, n, 900 + t) : src;
    const hx = Math.floor(off.w / (2 * ow));
    const hy = Math.floor(off.h / (2 * oh));
    const scores = [];
    for (let dy = -hy; dy <= hy; dy++) for (let dx = -hx; dx <= hx; dx++) scores.push(cellScoreAt(off.px, off.w, off.h, out, ow, oh, dx, dy));
    const found = cellCenterScore(off.px, off.w, off.h, out, ow, oh);
    const atZero = cellScoreAt(off.px, off.w, off.h, out, ow, oh, 0, 0);
    if (!scores.includes(found) || found < atZero || found > Math.max(...scores)) odd.push({ t, found, atZero, best: Math.max(...scores) });
  }
  check('search: the rule\'s score at some shifts, never under no shift, never over the best', odd.length === 0, odd.slice(0, 3));

  check('threshold: 0.985, on a 0.005 grid (a change shows up here)', CELL_CENTER_MIN === 0.985);
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
  const lastOff = new Uint8ClampedArray(fake);
  lastOff[lastOff.length - 1] ^= 1;
  check('same image: nor is the last byte off, so the whole buffer is compared', !sameImage(start, { ...start, pixels: lastOff }));
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
  check('copy: an edit after the fix started', FIX_GRID_CHANGED === 'The image changed, so the fix was dropped. Press Fix pixel grid again.');
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
  const rows = JSON.parse(readFileSync(path.join(ROOT, 'src/lib/pixelGridCredits.json'), 'utf8'));
  // The crates, then the standard library's row (audit r2, finding 6).
  const credits = rows.slice(0, -1);
  const std = rows.at(-1);
  check('notices: every row has a name, version, license and repository', rows.length > 1 && rows.every((c) => c.name && c.version && c.license && c.repository));
  check('notices: the crates sorted', credits.every((c, i) => i === 0 || credits[i - 1].name < c.name));
  check('notices: every crate has a block', credits.every((c) => notices.includes(`${c.version}\nLicense: ${c.license}\n`)));
  check('notices: the fixer and its owner', notices.includes('pixel-art-fixer (pixelfixer)') && notices.includes('Astropulse, LLC'));
  const stdBlock = /Rust standard library ([\d.]+)\nLicense: MIT\nCopyright \(c\) The Rust Project Developers\n/.exec(notices);
  check('notices: the Rust standard library', !!stdBlock);
  check('credits: the standard library\'s row, last', std.name === 'Rust standard library' && std.version === stdBlock?.[1]
    && std.license === 'MIT OR Apache-2.0' && std.repository === 'https://github.com/rust-lang/rust');
  // Its own notices, from the toolchain, follow its entry and come before the
  // license texts; the rest of the file is this script's own.
  const stdStart = notices.indexOf(`Notices of the Rust standard library ${stdBlock?.[1]}, from COPYRIGHT-library.html in its toolchain:`);
  const stdEnd = notices.indexOf('End of the notices of the Rust standard library.');
  const mitStart = notices.indexOf('MIT License\n\nApplies to every entry marked MIT');
  const own = notices.slice(0, stdStart) + notices.slice(stdEnd);
  const stdText = notices.slice(stdStart, stdEnd);
  check('notices: the standard library\'s own notices, after its entry, before the license texts', stdBlock && stdBlock.index < stdStart && stdStart < stdEnd && stdEnd < mitStart);
  check('notices: they cover the crates it is built with, hashbrown and dlmalloc among them', /hashbrown-0\.17\.1/.test(stdText) && /dlmalloc-0\.2\.14/.test(stdText) && stdText.includes('Amanieu d\'Antras'));
  check('notices: and as text, no tags left', !/<\/?(p|b|a|div|pre|code|details|summary|h[1-6]|ul|li|body|html)(\s[^>]*)?\/?>/i.test(stdText) && !/&#\d+;|&quot;|&amp;/.test(stdText));
  check('notices: the MIT text, once', own.split('Permission is hereby granted').length === 2);
  check('notices: the BSD-3-Clause text, once', own.split('Redistribution and use').length === 2);
  check('notices: no date or local path of their own', !/\/Users\/|\d{4}-\d{2}-\d{2}/.test(own) && !notices.includes('/Users/'));
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

  // A new image: a run under way ends with its worker, which would finish
  // that run before the next image's (audit r2, finding 10); an idle worker
  // stays.
  const idle = fixPixelGrid(new ArrayBuffer(4));
  workers.at(-1).onmessage({ data: { id: workers.at(-1).posted.at(-1).message.id, ok: true, png: output } });
  await idle;
  const idleCount = workers.length;
  cancelPixelGrid();
  check('client: cancel with nothing running keeps the idle worker', !workers.at(-1).terminated && workers.length === idleCount);
  const cancelled = fixPixelGrid(new ArrayBuffer(4));
  check('client: the next image uses the idle worker', workers.length === idleCount);
  const busy = workers.at(-1);
  const stale = busy.posted.at(-1).message.id;
  cancelPixelGrid();
  await assertRejects(cancelled, 'client: cancel fails the request under way');
  check('client: and ends the worker that was running it', busy.terminated);
  const next = fixPixelGrid(new ArrayBuffer(4));
  check('client: the next image gets a new worker, so it does not wait for the old run', workers.length === idleCount + 1 && workers.at(-1) !== busy);
  busy.onmessage?.({ data: { id: stale, ok: true, png: new ArrayBuffer(1) } });
  workers.at(-1).onmessage({ data: { id: workers.at(-1).posted.at(-1).message.id, ok: true, png: output } });
  check('client: a late answer to the cancelled run is ignored', (await next) === output);

  // Each request has its own minute: a cancelled run's time does not end
  // the next one, and the next one gets a whole minute of its own.
  mock.timers.enable({ apis: ['setTimeout'] });
  const before = workers.at(-1);
  const early = fixPixelGrid(new ArrayBuffer(4));
  mock.timers.tick(30_000);
  cancelPixelGrid();
  await assertRejects(early, 'client: a run cancelled after 30 s fails');
  const late = fixPixelGrid(new ArrayBuffer(4));
  const own = workers.at(-1);
  mock.timers.tick(30_000);
  check('client: the cancelled run\'s minute ends nothing', before.terminated && !own.terminated);
  mock.timers.tick(29_999);
  check('client: the next run\'s own minute is not over at 59.999 s', !own.terminated);
  mock.timers.tick(1);
  await assertRejects(late, 'client: and it ends at its own 60 s');
  check('client: with its worker', own.terminated);
  mock.timers.reset();

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
  // A stroke cancelled by a second finger puts back the last history entry,
  // in a new array (audit r2, finding 8).
  dropsOn('a cancelled stroke', () => store().cancelStroke(), () => { store().beginStroke(); store().paintPixel(1, 1, '#123456'); });
  // Clean residue: a magenta pixel at the edge, beside the art, is residue.
  let cleaned = null;
  dropsOn('Clean residue', () => { cleaned = store().cleanResidue(); }, () => {
    const px = new Uint8ClampedArray(store().pixels);
    px.set([200, 0, 200, 255], 0);
    store().loadFrame('current', px, W, W);
  });
  check('action: and Clean residue did change a pixel there', cleaned !== null && cleaned.cleared + cleaned.despilled > 0, cleaned);
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
