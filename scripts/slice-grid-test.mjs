// scripts/slice-grid-test.mjs
//
// The slicer's frame count (external product audit r2, SB-01): a sheet with
// N frames and P px between neighbours, as SpriteBrew's own exporter lays it
// out (downloadUtils.assembleGridSheet: N frames, N - 1 gaps), must slice
// back into N frames. Runs src/lib/sliceGrid.ts, and checks by text that the
// slicer counts with it and that the slice reads cells where it counts them.
// Run from the repo root: `node scripts/slice-grid-test.mjs`. Bundles with
// esbuild into local/.slice-grid-test/ (gitignored). Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.slice-grid-test');
fs.mkdirSync(OUT_DIR, { recursive: true });
const outfile = path.join(OUT_DIR, 'sliceGrid.mjs');
await build({ entryPoints: [path.join(ROOT, 'src/lib/sliceGrid.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
const { framesAlong } = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
}
const frames = (w, h, fw, fh, p, ox = 0, oy = 0) => framesAlong(w, fw, p, ox) * framesAlong(h, fh, p, oy);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── 1. The audit's acceptance check ──

check('1a: 32 px frames, 1 px padding: 65x32 is 2 frames (2 columns, 1 row)',
  framesAlong(65, 32, 1, 0) === 2 && framesAlong(32, 32, 1, 0) === 1, [framesAlong(65, 32, 1, 0), framesAlong(32, 32, 1, 0)]);
check('1b: 32 px frames, 1 px padding: 65x65 is 4 frames', frames(65, 65, 32, 32, 1) === 4, frames(65, 65, 32, 32, 1));
check('1c: 0 padding: 64x32 is still 2 frames', frames(64, 32, 32, 32, 0) === 2, frames(64, 32, 32, 32, 0));
check('1d: a leading offset: 3 px in, 32 px frames, 1 px padding: 68 wide is 2, 67 wide is 1',
  framesAlong(68, 32, 1, 3) === 2 && framesAlong(67, 32, 1, 3) === 1, [framesAlong(68, 32, 1, 3), framesAlong(67, 32, 1, 3)]);

// ── 2. Every sheet SpriteBrew's exporter can write slices back whole ──

{
  const bad = [];
  for (const fw of [1, 16, 24, 32, 48, 64, 128]) {
    for (let p = 0; p <= 4; p++) {
      for (let n = 1; n <= 12; n++) {
        const side = n * fw + (n - 1) * p;
        if (framesAlong(side, fw, p, 0) !== n) bad.push(['whole', fw, p, n]);
        if (framesAlong(side - 1, fw, p, 0) !== n - 1) bad.push(['one short', fw, p, n]);
        if (framesAlong(side + p, fw, p, 0) !== n) bad.push(['trailing gap', fw, p, n]);
        if (framesAlong(side + 5, fw, p, 5) !== n) bad.push(['offset 5', fw, p, n]);
      }
    }
  }
  check('2a: N frames with P px between them (as the exporter writes them) count as N; one pixel short as N - 1; a trailing gap or a leading offset changes nothing', bad.length === 0, bad.slice(0, 6));
}

// ── 3. Edges ──

check('3a: a frame size of 0 or less counts no frames (Slice stays off)', framesAlong(64, 0, 0, 0) === 0 && framesAlong(64, -8, 1, 0) === 0);
check('3b: an offset past the sheet counts no frames', framesAlong(64, 32, 0, 65) === 0 && framesAlong(64, 32, 1, 64) === 0);
check('3c: a frame larger than the sheet counts none', framesAlong(31, 32, 1, 0) === 0);
check('3d: a fractional frame size, as typed on /upload, counts whole frames', framesAlong(100, 33.3, 0, 0) === 3 && framesAlong(66.6, 33.3, 0, 0) === 2);

// ── 4. The slicer counts with it; the slice reads where it counts ──

{
  const slicer = read('src/components/sprites/SlicerConfig.tsx');
  const upload = read('src/app/upload/page.tsx');
  check('4a: the slicer\'s columns and rows come from framesAlong, with no formula of its own',
    /const columns = framesAlong\(imageWidth, frameWidth, padding, offsetX\);/.test(slicer)
    && /const rows = framesAlong\(imageHeight, frameHeight, padding, offsetY\);/.test(slicer)
    && !/safeStep/.test(slicer));
  check('4b: the size presets count with framesAlong too',
    /return framesAlong\(imageWidth, presetW, padding, offsetX\) \* framesAlong\(imageHeight, presetH, padding, offsetY\);/.test(slicer));
  check('4c: the overlay and the slice place cell c at offset + c * (frame + padding), the exporter\'s layout',
    /const x = \(offsetX \+ c \* \(frameWidth \+ padding\)\) \* scale;/.test(slicer)
    && /const x = config\.offsetX \+ c \* \(config\.frameWidth \+ config\.padding\);/.test(upload)
    && /const x = col \* \(fw \+ padding\);/.test(read('src/lib/downloadUtils.ts')));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
