// scripts/a5a-flip-test.mjs
//
// Offline tests for flipPixelsHorizontal in
// src/components/sprites/editorStore.ts (Wave 1 addendum A5a). Run from the
// repo root: `node scripts/a5a-flip-test.mjs`.
//
// The harness writes only its esbuild bundle, to local/.a5a-flip-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.a5a-flip-test');

await build({
  entryPoints: { editorStore: path.join(ROOT, 'src/components/sprites/editorStore.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const { flipPixelsHorizontal } = await import(
  pathToFileURL(path.join(OUT, 'editorStore.mjs')).href
);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// 3x2 buffer: pixel n has RGBA (n*10+1 .. n*10+4), n = 0..5 row-major.
const px = (n) => [n * 10 + 1, n * 10 + 2, n * 10 + 3, n * 10 + 4];
const src = new Uint8ClampedArray([0, 1, 2, 3, 4, 5].flatMap(px));
const want = new Uint8ClampedArray([2, 1, 0, 5, 4, 3].flatMap(px));

check('known 3x2 buffer is mirrored per row', eq(flipPixelsHorizontal(src, 3, 2), want));
check('input buffer is not mutated', eq(src, new Uint8ClampedArray([0, 1, 2, 3, 4, 5].flatMap(px))));
check('flipping twice gives the original', eq(flipPixelsHorizontal(flipPixelsHorizontal(src, 3, 2), 3, 2), src));
const narrow = new Uint8ClampedArray([9, 8, 7, 6, 5, 4, 3, 2]);
check('1-pixel-wide image is unchanged', eq(flipPixelsHorizontal(narrow, 1, 2), narrow));

process.exit(failed ? 1 : 0);
