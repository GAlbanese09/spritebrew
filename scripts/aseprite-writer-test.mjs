// scripts/aseprite-writer-test.mjs
//
// Offline tests for src/lib/asepriteWriter.ts, the .aseprite writer (BUILD-2,
// W2; HQ 2026-11-03-007, -021). A separate reader written here from
// Aseprite's spec (docs/ase-file-specs.md) parses what the writer produces,
// and Node's own zlib inflates the cels, so the writer is not graded by its
// own code. Checks the header, frames and durations, the colour profile,
// palette, layer, tags and their user data, trimmed cels, linked cels,
// empty frames, exact pixels back, both zlib paths, and the durations rule
// (HQ -021: 1000 / fps, not the stored 125 ms). Run from the repo root:
// `node scripts/aseprite-writer-test.mjs`. Bundles the module with esbuild
// into local/.aseprite-writer-test/ (gitignored). Prints case names and
// pass or fail. Writes local/.aseprite-writer-test/sample.aseprite for a
// manual open in Aseprite.

import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.aseprite-writer-test');
const OUT = path.join(DIR, 'asepriteWriter.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/asepriteWriter.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  encodeAseprite, zlibStored, zlibCompress, adler32, frameDurationFromFps, opaqueBounds, collectPalette, asepriteDocumentFrom, planCels,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// --- An independent reader, from the spec ---
function readAse(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const u8 = () => dv.getUint8(o++);
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const i16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const str = () => { const n = u16(); const s = new TextDecoder().decode(bytes.subarray(o, o + n)); o += n; return s; };
  const h = {
    fileSize: u32(), magic: u16(), frames: u16(), width: u16(), height: u16(), depth: u16(), flags: u32(),
    speed: u16(), z1: u32(), z2: u32(), transparent: u8(),
  };
  o += 3;
  h.colors = u16(); h.pxW = u8(); h.pxH = u8(); h.gridX = i16(); h.gridY = i16(); h.gridW = u16(); h.gridH = u16();
  const reservedStart = o;
  o += 84;
  h.headerBytes = o;
  h.reservedZero = bytes.subarray(reservedStart, o).every((b) => b === 0);
  const frames = [];
  for (let f = 0; f < h.frames; f++) {
    const start = o;
    const fr = { bytes: u32(), magic: u16(), oldChunks: u16(), duration: u16() };
    o += 2;
    fr.newChunks = u32();
    fr.chunks = [];
    const n = fr.newChunks || fr.oldChunks;
    for (let c = 0; c < n; c++) {
      const cs = o;
      const size = u32();
      const type = u16();
      const ch = { size, type };
      if (type === 0x2007) { ch.ptype = u16(); ch.pflags = u16(); ch.gamma = u32(); }
      else if (type === 0x2019) {
        ch.newSize = u32(); ch.first = u32(); ch.last = u32(); o += 8;
        ch.entries = [];
        for (let k = ch.first; k <= ch.last; k++) { const fl = u16(); const e = [u8(), u8(), u8(), u8()]; if (fl & 1) e.name = str(); ch.entries.push(e); }
      } else if (type === 0x2004) {
        ch.flags = u16(); ch.ltype = u16(); ch.child = u16(); u16(); u16(); ch.blend = u16(); ch.opacity = u8(); o += 3; ch.name = str();
      } else if (type === 0x2018) {
        ch.count = u16(); o += 8; ch.tags = [];
        for (let k = 0; k < ch.count; k++) {
          const t = { from: u16(), to: u16(), dir: u8(), repeat: u16() }; o += 6; t.rgb = [u8(), u8(), u8()]; o += 1; t.name = str(); ch.tags.push(t);
        }
      } else if (type === 0x2020) {
        ch.flags = u32(); if (ch.flags & 2) ch.color = [u8(), u8(), u8(), u8()];
      } else if (type === 0x2005) {
        ch.layer = u16(); ch.x = i16(); ch.y = i16(); ch.opacity = u8(); ch.ctype = u16(); ch.z = i16(); o += 5;
        if (ch.ctype === 2) { ch.w = u16(); ch.h = u16(); ch.zlib = bytes.subarray(o, cs + size); ch.raw = inflateSync(Buffer.from(ch.zlib)); }
        else if (ch.ctype === 1) ch.link = u16();
      }
      ch.endOk = true;
      o = cs + size;
      fr.chunks.push(ch);
    }
    fr.consumedOk = o - start === fr.bytes;
    o = start + fr.bytes;
    frames.push(fr);
  }
  return { header: h, frames, end: o };
}

// Rebuilds frame f's full W x H RGBA from its cel (following a link).
function frameImage(ase, f) {
  const { width: W, height: H } = ase.header;
  const out = new Uint8Array(W * H * 4);
  const own = ase.frames[f].chunks.find((c) => c.type === 0x2005);
  if (!own) return out;
  // A linked cel takes the linked image, but Aseprite places it at the
  // link's OWN x and y (aseprite_decoder.cpp), so read them from the link.
  const img = own.ctype === 1 ? ase.frames[own.link].chunks.find((c) => c.type === 0x2005) : own;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const s = (y * img.w + x) * 4, d = ((own.y + y) * W + own.x + x) * 4;
    for (let k = 0; k < 4; k++) out[d + k] = img.raw[s + k];
  }
  return out;
}

function img(W, H, f) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = f(x, y); if (c) px.set(c, (y * W + x) * 4); }
  return px;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// --- Fixtures: two animations, 32 x 24 ---
const W = 32, H = 24;
const RED = [200, 30, 30, 255], GREEN = [40, 160, 60, 255], BLUE = [30, 60, 200, 128];
const walk0 = img(W, H, (x, y) => (x >= 4 && x < 12 && y >= 6 && y < 18 ? RED : null));
const walk1 = img(W, H, (x, y) => (x >= 6 && x < 14 && y >= 6 && y < 18 ? RED : x === 20 && y === 3 ? BLUE : null));
const walk2 = new Uint8ClampedArray(walk0); // an exact repeat of frame 0: a linked cel
const empty = new Uint8ClampedArray(W * H * 4); // fully transparent: no cel
const idle0 = img(W, H, (x, y) => (x === 0 && y === 0 ? GREEN : x === W - 1 && y === H - 1 ? GREEN : null)); // corners: full bounds
// A non-ASCII tag name, built in code so this file stays ASCII.
const IDLE_NAME = `IDLE ${String.fromCharCode(0xe9)}t${String.fromCharCode(0xe9)}`;
const durWalk = frameDurationFromFps(8);  // 125
const durIdle = frameDurationFromFps(6);  // 167
const doc = {
  width: W, height: H, layerName: 'Layer 1',
  frames: [
    { pixels: walk0, durationMs: durWalk }, { pixels: walk1, durationMs: durWalk }, { pixels: walk2, durationMs: durWalk },
    { pixels: empty, durationMs: durIdle }, { pixels: idle0, durationMs: durIdle },
  ],
  tags: [
    { name: 'WALK', from: 0, to: 2, direction: 'forward', repeat: 0, color: [255, 0, 0] },
    { name: IDLE_NAME, from: 3, to: 4, direction: 'pingpong', repeat: 1 },
  ],
};

// 1. Durations rule (HQ -021).
check('durations: 8 fps is 125 ms', durWalk === 125);
check('durations: 6 fps is 167 ms (not the stored 125)', durIdle === 167);
check('durations: 12 fps is 83 ms', frameDurationFromFps(12) === 83);
check('durations: bad fps falls back to 100 ms', frameDurationFromFps(0) === 100 && frameDurationFromFps(Number.NaN) === 100);
check('durations: very high fps is at least 1 ms', frameDurationFromFps(5000) === 1);

// 2. zlib: stored blocks and the CompressionStream path both inflate exactly.
{
  const raw = new Uint8Array(200000);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + (i >> 5)) & 0xff;
  const st = zlibStored(raw);
  check('zlib stored: inflates to the input (multi-block)', same(inflateSync(Buffer.from(st)), raw));
  check('zlib stored: header 78 01 is a valid zlib header', st[0] === 0x78 && st[1] === 0x01 && ((st[0] << 8) | st[1]) % 31 === 0);
  const tiny = zlibStored(new Uint8Array(0));
  check('zlib stored: empty input inflates to empty', inflateSync(Buffer.from(tiny)).length === 0);
  check('adler32: known value for "Wikipedia"', adler32(new TextEncoder().encode('Wikipedia')) === 0x11e60398);
  check('zlib: CompressionStream exists in this Node', typeof CompressionStream === 'function');
  const cs = await zlibCompress(raw);
  check('zlib CompressionStream: inflates to the input', same(inflateSync(Buffer.from(cs)), raw));
  check('zlib CompressionStream: smaller than stored for repetitive data', cs.length < st.length, { cs: cs.length, st: st.length });
}

// 3. The file, compressed with CompressionStream (the browser path).
const bytes = await encodeAseprite(doc);
writeFileSync(path.join(DIR, 'sample.aseprite'), bytes);
const ase = readAse(bytes);
const hd = ase.header;
check('header: magic A5E0', hd.magic === 0xa5e0);
check('header: file size matches the bytes', hd.fileSize === bytes.length, { fileSize: hd.fileSize, len: bytes.length });
check('header: 128 bytes, reserved zero', hd.headerBytes === 128 && hd.reservedZero);
check('header: 5 frames, 32 x 24, RGBA', hd.frames === 5 && hd.width === W && hd.height === H && hd.depth === 32);
check('header: flag 1 (layer opacity valid)', hd.flags === 1);
check('header: speed is the first frame duration', hd.speed === 125);
check('header: pixel ratio 1:1, grid 16', hd.pxW === 1 && hd.pxH === 1 && hd.gridW === 16 && hd.gridH === 16);
check('frames: every frame magic F1FA and sizes consumed exactly', ase.frames.every((f) => f.magic === 0xf1fa && f.consumedOk));
check('frames: old and new chunk counts agree', ase.frames.every((f) => f.oldChunks === f.newChunks));
check('frames: the file ends where the header says', ase.end === bytes.length);
check('frames: per-frame durations 125,125,125,167,167', ase.frames.map((f) => f.duration).join() === '125,125,125,167,167');

const f0 = ase.frames[0].chunks;
const types0 = f0.map((c) => c.type.toString(16)).join(',');
check('frame 0: profile, palette, layer, tags, 2 user data, cel', types0 === '2007,2019,2004,2018,2020,2020,2005', types0);
const prof = f0.find((c) => c.type === 0x2007);
check('colour profile: sRGB', prof.ptype === 1 && prof.pflags === 0);
const pal = f0.find((c) => c.type === 0x2019);
const expectPal = [RED, BLUE, GREEN].map((c) => c.join());
check('palette: the distinct colours in first-seen order', pal.entries.map((e) => e.join()).join('|') === expectPal.join('|'), pal.entries);
check('palette: size and header count agree', pal.newSize === 3 && pal.first === 0 && pal.last === 2 && hd.colors === 3);
const lay = f0.find((c) => c.type === 0x2004);
check('layer: visible and editable, normal, opaque, named', lay.flags === 3 && lay.ltype === 0 && lay.blend === 0 && lay.opacity === 255 && lay.name === 'Layer 1');
const tg = f0.find((c) => c.type === 0x2018);
check('tags: two, names (UTF-8) and ranges', tg.count === 2 && tg.tags[0].name === 'WALK' && tg.tags[0].from === 0 && tg.tags[0].to === 2 && tg.tags[1].name === IDLE_NAME && tg.tags[1].from === 3 && tg.tags[1].to === 4);
check('tags: directions forward and ping-pong, repeat 0 and 1', tg.tags[0].dir === 0 && tg.tags[1].dir === 2 && tg.tags[0].repeat === 0 && tg.tags[1].repeat === 1);
check('tags: deprecated RGB carries the colour', tg.tags[0].rgb.join() === '255,0,0');
const uds = f0.filter((c) => c.type === 0x2020);
check('tags: user data colour for the first, none for the second', uds[0].flags === 2 && uds[0].color.join() === '255,0,0,255' && uds[1].flags === 0);

const cels = ase.frames.map((f) => f.chunks.find((c) => c.type === 0x2005));
check('cel 0: compressed image trimmed to the red box', cels[0].ctype === 2 && cels[0].x === 4 && cels[0].y === 6 && cels[0].w === 8 && cels[0].h === 12);
check('cel 1: trimmed to red box plus the blue pixel', cels[1].ctype === 2 && cels[1].x === 6 && cels[1].y === 3 && cels[1].w === 15 && cels[1].h === 15, cels[1]);
check('cel 2: an exact repeat of frame 0 is a link to frame 0', cels[2].ctype === 1 && cels[2].link === 0);
check('cel 2: the link sits where its twin does (Aseprite places links at their own x, y)', cels[2].x === cels[0].x && cels[2].y === cels[0].y && cels[2].x === 4 && cels[2].y === 6);
check('cel 3: a fully transparent frame has no cel', cels[3] === undefined && ase.frames[3].chunks.length === 0);
check('cel 4: corners give full bounds', cels[4].ctype === 2 && cels[4].x === 0 && cels[4].y === 0 && cels[4].w === W && cels[4].h === H);
check('cels: layer 0, opaque, z 0', cels.filter(Boolean).every((c) => c.layer === 0 && c.opacity === 255 && c.z === 0));
const inputs = [walk0, walk1, walk2, empty, idle0];
check('pixels: every frame reads back byte for byte (alpha 128 kept)', inputs.every((p, i) => same(frameImage(ase, i), p)));

// 4. The same document through the stored-zlib fallback reads back the same.
{
  const b2 = await encodeAseprite(doc, async (raw) => zlibStored(raw));
  const a2 = readAse(b2);
  check('fallback: same frames and pixels with stored zlib', a2.header.frames === 5 && inputs.every((p, i) => same(frameImage(a2, i), p)));
  check('fallback: file size matches', a2.header.fileSize === b2.length);
}

// 5. Edges: one frame without tags; more than 256 colours; bad input.
{
  const one = await encodeAseprite({ width: 2, height: 1, frames: [{ pixels: new Uint8ClampedArray(8), durationMs: 100 }], tags: [] });
  const a = readAse(one);
  check('edge: one empty frame, no tags: profile, palette, layer only', a.frames[0].chunks.map((c) => c.type.toString(16)).join() === '2007,2019,2004');
  check('edge: an empty sprite still writes one palette colour', a.frames[0].chunks[1].entries.length === 1 && a.header.colors === 1);
  const many = img(20, 20, (x, y) => [x * 12, y * 12, (x + y) * 6, 255]);
  const palMany = collectPalette([{ pixels: many, durationMs: 1 }]);
  check('palette: capped at 256 colours', palMany.length === 256);
  const am = readAse(await encodeAseprite({ width: 20, height: 20, frames: [{ pixels: many, durationMs: 50 }], tags: [] }));
  check('palette: 256 colours written, header count 0 (means 256)', am.frames[0].chunks[1].entries.length === 256 && am.header.colors === 0);
  check('pixels: 400 colours still read back exactly', same(frameImage(am, 0), many));
  let threw = false;
  try { await encodeAseprite({ width: 4, height: 4, frames: [{ pixels: new Uint8ClampedArray(10), durationMs: 1 }], tags: [] }); } catch { threw = true; }
  check('input: wrong pixel length throws', threw);
  threw = false;
  try { await encodeAseprite({ width: 4, height: 4, frames: [], tags: [] }); } catch { threw = true; }
  check('input: no frames throws', threw);
  const badTags = readAse(await encodeAseprite({ width: 1, height: 1, frames: [{ pixels: new Uint8ClampedArray(4), durationMs: 1 }], tags: [{ name: 'x', from: 0, to: 5 }] }));
  check('input: a tag past the last frame is dropped', !badTags.frames[0].chunks.some((c) => c.type === 0x2018));
  const long = readAse(await encodeAseprite({ width: 1, height: 1, frames: [{ pixels: new Uint8ClampedArray(4), durationMs: 999999 }], tags: [] }));
  check('input: a duration above 65535 ms is clamped', long.frames[0].duration === 65535);
  check('opaqueBounds: null for transparent, exact otherwise', opaqueBounds(new Uint8Array(16), 2, 2) === null && JSON.stringify(opaqueBounds(walk0, W, H)) === JSON.stringify({ x: 4, y: 6, w: 8, h: 12 }));
}

// 6. A 256 x 256, 64-frame sheet (the research's worst case per layer) encodes, reads back, and stays small.
{
  const S = 256, N = 64;
  const frames = [];
  for (let f = 0; f < N; f++) frames.push({ pixels: img(S, S, (x, y) => ((x - 128 - (f % 8)) ** 2 + (y - 128) ** 2 < 3600 ? [f * 4, 100, 200, 255] : null)), durationMs: 83 });
  const t0 = Date.now();
  const big = await encodeAseprite({ width: S, height: S, frames, tags: [{ name: 'spin', from: 0, to: N - 1 }] });
  const ms = Date.now() - t0;
  const ab = readAse(big);
  check('large: 64 frames read back', ab.header.frames === N && ab.frames.every((f) => f.consumedOk));
  check('large: frame 63 pixels exact', same(frameImage(ab, 63), frames[63].pixels));
  check('large: repeats became links (64 frames, 8 distinct poses x 8 colours keeps all as images)', ab.frames.filter((f) => f.chunks.some((c) => c.type === 0x2005 && c.ctype === 2)).length === N);
  console.log(`info  large: ${N} frames 256x256 in ${ms} ms, ${big.length} bytes`);
}

// 7. From the export's animations: durations from fps (not the stored
//    125 ms), tag ranges that skip empty animations, loop to repeat.
{
  const px = () => new Uint8ClampedArray(4 * 4 * 4);
  const d = asepriteDocumentFrom([
    { name: 'WALK', fps: 8, loop: true, color: [255, 0, 0], frames: [px(), px(), px()] },
    { name: 'EMPTY', fps: 10, loop: true, frames: [] },
    { name: 'IDLE', fps: 6, loop: false, frames: [px(), px()] },
  ], 4, 4);
  check('document: 5 frames in animation order', d.frames.length === 5 && d.width === 4 && d.height === 4);
  check('document: durations 125 x3 then 167 x2', d.frames.map((f) => f.durationMs).join() === '125,125,125,167,167');
  check('document: an empty animation gets no tag and shifts nothing', d.tags.length === 2 && d.tags[1].name === 'IDLE' && d.tags[1].from === 3 && d.tags[1].to === 4);
  check('document: loop plays forever, no loop plays once', d.tags[0].repeat === 0 && d.tags[1].repeat === 1);
  check('document: tag colour carried', d.tags[0].color.join() === '255,0,0' && d.tags[1].color === undefined);
  const a = readAse(await encodeAseprite(d));
  check('document: encodes and reads back with both tags', a.frames[0].chunks.find((c) => c.type === 0x2018).count === 2 && a.frames.map((f) => f.duration).join() === '125,125,125,167,167');
}

// 8. Audit r1 (BUILD-2, W2): links in a long sheet, the bucketed twin
//    search, names cut on a character boundary, NaN durations.
{
  // Two poses at the same non-zero offset, alternating over 40 frames: 2
  // images, 38 links, every link at its twin's x and y.
  const S = 24;
  const poseA = img(S, S, (x, y) => (x >= 5 && x < 15 && y >= 7 && y < 20 ? RED : null));
  const poseB = img(S, S, (x, y) => (x >= 5 && x < 15 && y >= 7 && y < 20 ? (y === 19 ? GREEN : RED) : null));
  const alt = Array.from({ length: 40 }, (_, i) => ({ pixels: i % 2 ? poseB : poseA, durationMs: 100 }));
  const a = readAse(await encodeAseprite({ width: S, height: S, frames: alt, tags: [] }));
  const cs = a.frames.map((f) => f.chunks.find((c) => c.type === 0x2005));
  check('links: alternating poses give 2 images and 38 links', cs.filter((c) => c.ctype === 2).length === 2 && cs.filter((c) => c.ctype === 1).length === 38);
  check('links: each link points at the first frame of its pose', cs.every((c, i) => c.ctype === 2 || c.link === i % 2));
  check('links: each link sits at its twin\'s x and y', cs.every((c) => c.ctype === 2 || (c.x === 5 && c.y === 7)));
  check('links: every frame reads back exactly at its place', alt.every((f, i) => same(frameImage(a, i), f.pixels)));
  check('links: 38 byte comparisons, one per repeat', planCels(alt, S, S).compares === 38, planCels(alt, S, S).compares);
  // 200 frames with the same bounds that differ only in their last row (the
  // auditor's worst case: 300 frames of 256 x 256 took 20 s before the
  // search was bucketed): no links, and no byte comparisons at all, where
  // comparing every earlier frame would make 19,900.
  const T = 128;
  const near = Array.from({ length: 200 }, (_, i) => ({ pixels: img(T, T, (x, y) => (x >= 10 && x < 118 && y >= 10 && y < 118 ? (y === 117 && x === 10 + (i % 100) ? [i, i, i, 255] : RED) : null)), durationMs: 50 }));
  const nb = readAse(await encodeAseprite({ width: T, height: T, frames: near, tags: [] }));
  check('twins: 200 near-identical frames make 200 images, no wrong links', nb.frames.every((f) => f.chunks.find((c) => c.type === 0x2005).ctype === 2));
  check('twins: no byte comparisons between frames with different checksums', planCels(near, T, T).compares === 0, planCels(near, T, T).compares);
  // A 70,000-byte name of 3-byte characters is cut on a character boundary.
  const longName = String.fromCharCode(0x20ac).repeat(70000 / 3 + 1);
  const ln = readAse(await encodeAseprite({ width: 1, height: 1, layerName: longName, frames: [{ pixels: new Uint8ClampedArray(4), durationMs: 1 }], tags: [] }));
  const layerName = ln.frames[0].chunks.find((c) => c.type === 0x2004).name;
  check('names: a long UTF-8 name is cut on a character boundary', layerName.length > 0 && !layerName.includes(String.fromCharCode(0xfffd)) && new TextEncoder().encode(layerName).length <= 0xffff && new TextEncoder().encode(layerName).length % 3 === 0);
  const nan = readAse(await encodeAseprite({ width: 1, height: 1, frames: [{ pixels: new Uint8ClampedArray(4), durationMs: Number.NaN }], tags: [] }));
  check('durations: NaN is written as 1 ms, never 0', nan.frames[0].duration === 1 && nan.header.speed === 1, { d: nan.frames[0].duration, s: nan.header.speed });
}

console.log(failed ? `${failed} failed` : 'all pass');
process.exit(failed ? 1 : 0);
