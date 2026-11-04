// scripts/export-engine-test.mjs
//
// Behaviour tests for src/lib/exportEngine.ts's TexturePacker and Godot
// exporters (W3; audit r1 on PR #45): the files they write, run on the real
// module under a stand-in DOM. Canvases truncate fractional sizes as real
// ones do; downloads and zips are captured instead of saved. Covers the tag
// ranges when a frame has no image, whole-pixel rects for a fractional frame
// size, and the .tres's speed, loop and name literals. Run from the repo
// root: `node scripts/export-engine-test.mjs`. Bundles with esbuild into
// local/.export-engine-test/ (gitignored). Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.export-engine-test');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Stand-ins for the two browser-bound modules exportEngine imports.
const STUB_DOWNLOADS = `
const captured = (globalThis.__exportCaptured ??= []);
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function sanitizeFilename(s) { return String(s).replace(/[^a-z0-9_-]+/gi, '_') || 'sheet'; }
export function resizeFrame(_c, w, h) { return canvas(w, h); }
export function assembleGridSheet(frames, cols, padding) {
  const fw = frames[0].width, fh = frames[0].height, rows = Math.ceil(frames.length / cols);
  return canvas(cols * fw + (cols - 1) * padding, rows * fh + (rows - 1) * padding);
}
export function assembleStripSheet(frames) { return canvas(frames.reduce((a, f) => a + f.width, 0), frames[0].height); }
export async function canvasToBlob(c) { return { png: true, w: c.width, h: c.height }; }
export function downloadFile(data, name) { captured.push({ name, data }); }
export async function downloadAsZip(files, name) { captured.push({ zip: name, files }); }
`;
const STUB_SPRITE_UTILS = `
// A frame's data URL is "img:<w>x<h>"; the image has that natural size.
export async function loadImage(url) {
  const m = /^img:(\\d+)x(\\d+)$/.exec(url);
  if (!m) throw new Error('bad url ' + url);
  return { naturalWidth: Number(m[1]), naturalHeight: Number(m[2]) };
}
`;
fs.writeFileSync(path.join(OUT_DIR, 'downloadUtils.stub.mjs'), STUB_DOWNLOADS);
fs.writeFileSync(path.join(OUT_DIR, 'spriteUtils.stub.mjs'), STUB_SPRITE_UTILS);

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/downloadUtils$/ }, () => ({ path: path.join(OUT_DIR, 'downloadUtils.stub.mjs') }));
    b.onResolve({ filter: /^@\/lib\/spriteUtils$/ }, () => ({ path: path.join(OUT_DIR, 'spriteUtils.stub.mjs') }));
  },
};

// A canvas whose width and height truncate, like a real one.
class FakeCanvas {
  constructor() { this._w = 300; this._h = 150; }
  get width() { return this._w; }
  set width(v) { this._w = Math.max(0, Math.trunc(Number(v)) || 0); }
  get height() { return this._h; }
  set height(v) { this._h = Math.max(0, Math.trunc(Number(v)) || 0); }
  getContext() {
    const w = () => this._w;
    const h = () => this._h;
    return {
      imageSmoothingEnabled: true,
      drawImage() {},
      getImageData() { return { width: w(), height: h(), data: new Uint8ClampedArray(w() * h() * 4) }; },
      putImageData() {},
      fillRect() {},
      clearRect() {},
    };
  }
}
globalThis.document = { createElement: (tag) => { if (tag !== 'canvas') throw new Error(tag); return new FakeCanvas(); } };

const outfile = path.join(OUT_DIR, 'exportEngine.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/lib/exportEngine.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
  plugins: [stubs],
});
const engine = await import(pathToFileURL(outfile).href);
const captured = (globalThis.__exportCaptured ??= []);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

function anim(id, name, n, { fps = 8, loop = true, missing = [], size = '32x32' } = {}) {
  return { id, name, type: 'walk', fps, loop, frames: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, missing: missing.includes(i), size })) };
}
function urls(...anims) {
  const m = new Map();
  for (const a of anims) for (const f of a.frames) if (!f.missing) m.set(f.id, `img:${f.size}`);
  return m;
}
function opts(anims, extra = {}) {
  return { animations: anims, frameDataUrls: urls(...anims), frameWidth: 32, frameHeight: 32, padding: 0, powerOfTwo: false, includeMetadata: true, sheetName: 'sheet', ...extra };
}
function lastZipText(suffix) {
  const z = captured[captured.length - 1];
  const f = z.files.find((x) => x.name.endsWith(suffix));
  return f ? f.data : null;
}

// 1. TexturePacker tags follow the frames written.
{
  const walk = anim('w', 'Walk', 3, { missing: [1] });
  const idle = anim('i', 'Idle', 2);
  await engine.exportTexturePacker(opts([walk, idle]));
  const json = JSON.parse(lastZipText('.json'));
  const tags = json.meta.frameTags.map((t) => [t.name, t.from, t.to]);
  check('TexturePacker: a frame with no image shortens only its own tag', JSON.stringify(tags) === JSON.stringify([['Walk', 0, 1], ['Idle', 2, 3]]), tags);
  check('TexturePacker: as many frames as written (4)', Object.keys(json.frames).length === 4, Object.keys(json.frames).length);
}

// 2. A fractional frame size: rects in whole pixels, on the canvases.
{
  const walk = anim('w', 'Walk', 4);
  await engine.exportTexturePacker(opts([walk], { frameWidth: 32.5, frameHeight: 32.5, padding: 1 }));
  const json = JSON.parse(lastZipText('.json'));
  const rects = Object.values(json.frames).map((f) => f.frame);
  check('TexturePacker: a 32.5 frame size writes 32 px rects', rects.every((r) => r.w === 32 && r.h === 32), rects[0]);
  check('TexturePacker: every rect is in whole pixels', rects.every((r) => Object.values(r).every(Number.isInteger)), rects);
  check('TexturePacker: the second column starts at 33 (32 + padding 1)', rects[1].x === 33, rects[1]);
}

// 3. Godot .tres literals.
{
  const walk = anim('w', 'Walk "fast" \\ run', 2, { fps: 12.5, loop: false });
  const idle = anim('i', 'Idle', 2, { fps: 8 });
  await engine.exportGodot(opts([walk, idle], { frameWidth: 32.5 }));
  const tres = lastZipText('.tres');
  check('Godot: a fractional fps is a valid float (12.5, never 12.5.0)', /"speed": 12\.5\n/.test(tres) && !/12\.5\.0/.test(tres));
  check('Godot: a whole fps keeps the .0 (8.0)', /"speed": 8\.0\n/.test(tres));
  check('Godot: the loop flag is the animation\'s own', /"loop": false,\n\s*"name": "Walk/.test(tres) && /"loop": true,\n\s*"name": "Idle"/.test(tres));
  check('Godot: quotes and backslashes in a name are escaped', tres.includes('"name": "Walk \\"fast\\" \\\\ run"'));
  check('Godot: regions in whole pixels for a 32.5 frame size', /region = Rect2\(32, 0, 32, 32\)/.test(tres) && !/Rect2\([^)]*\.5/.test(tres));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
