// scripts/w1-geometry-test.mjs
//
// Offline tests for src/lib/animationGeometry.ts (Wave 1 PR 1: slicer
// geometry from the generation). Run from the repo root:
// `node scripts/w1-geometry-test.mjs`.
//
// Grid assumption for the 16-frame cases: a 4x4 grid of square cells, so
// 512x512 at 128 px and 256x256 at 64 px. sheetGeometry reads the grid from
// the image and the frame size, so any other grid with the same cell size
// slices the same way. The 10-frame case is a 4x3 grid at 64 px (256x192)
// whose last two cells are empty.
//
// The harness writes only its esbuild bundle, to local/.w1-geometry-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.w1-geometry-test');

await build({
  entryPoints: { animationGeometry: path.join(ROOT, 'src/lib/animationGeometry.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const { sheetGeometry, galleryFrameSizeGuess, generatedFrameSize } = await import(
  pathToFileURL(path.join(OUT, 'animationGeometry.mjs')).href
);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const same = (g, want) =>
  want === null
    ? g === null
    : g !== null && Object.keys(want).every((k) => g[k] === want[k]);

// ── sheetGeometry with frameSize ──

check('256x256 @128 n=4 -> 2x2, 4 frames',
  same(sheetGeometry({ imageW: 256, imageH: 256, frameSize: 128, frameCount: 4 }),
    { frameW: 128, frameH: 128, cols: 2, rows: 2, frames: 4 }));
check('128x128 @64 n=4 -> 2x2, 4 frames',
  same(sheetGeometry({ imageW: 128, imageH: 128, frameSize: 64, frameCount: 4 }),
    { frameW: 64, frameH: 64, cols: 2, rows: 2, frames: 4 }));
check('16 frames @128 (4x4, 512x512) -> 4x4, 16 frames',
  same(sheetGeometry({ imageW: 512, imageH: 512, frameSize: 128, frameCount: 16 }),
    { frameW: 128, frameH: 128, cols: 4, rows: 4, frames: 16 }));
check('16 frames @64 (4x4, 256x256) -> 4x4, 16 frames',
  same(sheetGeometry({ imageW: 256, imageH: 256, frameSize: 64, frameCount: 16 }),
    { frameW: 64, frameH: 64, cols: 4, rows: 4, frames: 16 }));
check('10 frames in a 4x3 grid @64 (256x192) -> 4x3, 10 frames',
  same(sheetGeometry({ imageW: 256, imageH: 192, frameSize: 64, frameCount: 10 }),
    { frameW: 64, frameH: 64, cols: 4, rows: 3, frames: 10 }));
check('frameSize without frameCount keeps every cell',
  same(sheetGeometry({ imageW: 256, imageH: 192, frameSize: 64 }),
    { cols: 4, rows: 3, frames: 12 }));
check('frameCount above the cell count is capped',
  same(sheetGeometry({ imageW: 128, imageH: 128, frameSize: 64, frameCount: 8 }),
    { cols: 2, rows: 2, frames: 4 }));
check('non-dividing size -> null (200x200 @64)',
  same(sheetGeometry({ imageW: 200, imageH: 200, frameSize: 64, frameCount: 4 }), null));
check('non-dividing on one side -> null (256x200 @64)',
  same(sheetGeometry({ imageW: 256, imageH: 200, frameSize: 64 }), null));

// ── sheetGeometry with only frameCount ──

check('frameCount only: 256x256 n=4 -> 128',
  same(sheetGeometry({ imageW: 256, imageH: 256, frameCount: 4 }),
    { frameW: 128, cols: 2, rows: 2, frames: 4 }));
check('frameCount only: 256x256 n=16 -> 64',
  same(sheetGeometry({ imageW: 256, imageH: 256, frameCount: 16 }),
    { frameW: 64, cols: 4, rows: 4, frames: 16 }));
check('frameCount only, no integer size -> null (256x192 n=10)',
  same(sheetGeometry({ imageW: 256, imageH: 192, frameCount: 10 }), null));
check('neither frameSize nor frameCount -> null',
  same(sheetGeometry({ imageW: 256, imageH: 256 }), null));

// ── galleryFrameSizeGuess ──

check('128x128 guess -> 64', galleryFrameSizeGuess(128, 128) === 64);
check('256x256 guess -> 128', galleryFrameSizeGuess(256, 256) === 128);
check('512x128 guess -> 128', galleryFrameSizeGuess(512, 128) === 128);
check('192x128 guess -> 64', galleryFrameSizeGuess(192, 128) === 64);
check('64x64 guess -> null (one cell)', galleryFrameSizeGuess(64, 64) === null);
check('non-dividing guess -> null (200x200)', galleryFrameSizeGuess(200, 200) === null);

// ── generatedFrameSize ──

check('not rescued -> requested size', generatedFrameSize(128, null) === 128);
check('rescued with deliveredCellSize -> that size', generatedFrameSize(128, { deliveredCellSize: 64 }) === 64);
check('rescued without deliveredCellSize -> 64', generatedFrameSize(128, {}) === 64);

console.log(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
