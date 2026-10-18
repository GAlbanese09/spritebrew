// scripts/grid-detect-test.mjs
//
// Offline tests for detectCleanGrid in src/lib/gridDetect.ts and its call in
// detectFrameGrid (src/lib/spriteUtils.ts): /upload Auto-detect on sheets
// with large cells. Run from the repo root:
// `node scripts/grid-detect-test.mjs`.
//
// Sheets are synthetic RGBA buffers built in memory: a transparent
// background with one opaque rectangle (a "blob") per filled cell, inset by
// a few transparent pixels of margin unless the case says otherwise. The
// fall-through cases expect the result detectFrameGrid gave on the base
// commit (3b02be2) for the same buffer.
//
// The harness writes only its esbuild bundle, to local/.grid-detect-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.grid-detect-test');

await build({
  entryPoints: {
    gridDetect: path.join(ROOT, 'src/lib/gridDetect.ts'),
    spriteUtils: path.join(ROOT, 'src/lib/spriteUtils.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const { detectCleanGrid } = await import(
  pathToFileURL(path.join(OUT, 'gridDetect.mjs')).href
);
const { detectFrameGrid } = await import(
  pathToFileURL(path.join(OUT, 'spriteUtils.mjs')).href
);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const grid = (s, columns, rows) => ({ width: s, height: s, columns, rows });
const same = (g, want) =>
  want === null
    ? g === null
    : g !== null && Object.keys(want).every((k) => g[k] === want[k]);

// ── sheet builders ──

function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}
// Opaque rectangle [x0, x1) x [y0, y1).
function rect(img, x0, y0, x1, y1) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = 200; img.data[i + 1] = 80; img.data[i + 2] = 40; img.data[i + 3] = 255;
    }
  }
}
// A grid of square cells; cells listed by `filled(c, r)` get one blob inset
// by `margin` px on every side.
function sheet(width, height, cell, { margin = 4, filled = () => true } = {}) {
  const img = blank(width, height);
  for (let r = 0; r < height / cell; r++) {
    for (let c = 0; c < width / cell; c++) {
      if (!filled(c, r)) continue;
      rect(img, c * cell + margin, r * cell + margin, (c + 1) * cell - margin, (r + 1) * cell - margin);
    }
  }
  return img;
}
// One blob of `size` px per cell at offset `off` inside the cell.
function smallBlobs(width, height, cell, size, off) {
  const img = blank(width, height);
  for (let r = 0; r < height / cell; r++) {
    for (let c = 0; c < width / cell; c++) {
      rect(img, c * cell + off, r * cell + off, c * cell + off + size, r * cell + off + size);
    }
  }
  return img;
}

// ── 1 to 6: clean grids with a blob in every cell ──

{
  const img = sheet(512, 512, 256, { margin: 8 });
  check('1. 512x512, 2x2 of 256: detectCleanGrid 256', same(detectCleanGrid(img), grid(256, 2, 2)));
  check('1. 512x512, 2x2 of 256: detectFrameGrid 256', same(detectFrameGrid(img), grid(256, 2, 2)));
}
{
  const img = sheet(256, 256, 64);
  check('2. 256x256, 4x4 of 64: detectCleanGrid 64', same(detectCleanGrid(img), grid(64, 4, 4)));
  check('2. 256x256, 4x4 of 64: detectFrameGrid 64 (KNOWN_LAYOUTS)', same(detectFrameGrid(img), grid(64, 4, 4)));
}
{
  const img = sheet(64, 64, 32);
  check('3. 64x64, 2x2 of 32: detectCleanGrid 32', same(detectCleanGrid(img), grid(32, 2, 2)));
  check('3. 64x64, 2x2 of 32: detectFrameGrid 32', same(detectFrameGrid(img), grid(32, 2, 2)));
}
{
  const img = sheet(192, 192, 48);
  check('4. 192x192, 4x4 of 48: detectCleanGrid 48', same(detectCleanGrid(img), grid(48, 4, 4)));
  check('4. 192x192, 4x4 of 48: detectFrameGrid 48 (KNOWN_LAYOUTS)', same(detectFrameGrid(img), grid(48, 4, 4)));
}
{
  const img = sheet(384, 64, 64);
  check('5. 384x64, 6x1 of 64: detectCleanGrid 64', same(detectCleanGrid(img), grid(64, 6, 1)));
  check('5. 384x64, 6x1 of 64: detectFrameGrid 64', same(detectFrameGrid(img), grid(64, 6, 1)));
}
{
  const img = sheet(1024, 512, 256, { margin: 8 });
  check('6. 1024x512, 4x2 of 256: detectCleanGrid 256', same(detectCleanGrid(img), grid(256, 4, 2)));
  check('6. 1024x512, 4x2 of 256: detectFrameGrid 256', same(detectFrameGrid(img), grid(256, 4, 2)));
}

// ── 7: documented limitation, a sheet less than half full ──

{
  // 4x4 of 128, blobs in the first 7 cells (row 0 and the first three of row 1).
  const img = sheet(512, 512, 128, { margin: 6, filled: (c, r) => r * 4 + c < 7 });
  check('7. limitation: 512x512 4x4 of 128 with 7 of 16 filled reads at the next clean size: detectCleanGrid 256',
    same(detectCleanGrid(img), grid(256, 2, 2)));
  check('7. limitation: 512x512 4x4 of 128 with 7 of 16 filled reads at the next clean size: detectFrameGrid 256',
    same(detectFrameGrid(img), grid(256, 2, 2)));
}

// ── 8 to 10: no eligible grid, fall through to the base result ──

{
  const img = blank(512, 512);
  rect(img, 8, 8, 48, 48);
  check('8. single sprite top left of 512x512: detectCleanGrid null', same(detectCleanGrid(img), null));
  check('8. single sprite top left of 512x512: detectFrameGrid unchanged from base (16)',
    same(detectFrameGrid(img), grid(16, 32, 32)));
}
{
  const img = blank(512, 512);
  rect(img, 0, 0, 512, 512);
  check('9. fully opaque 512x512: detectCleanGrid null', same(detectCleanGrid(img), null));
  check('9. fully opaque 512x512: detectFrameGrid unchanged from base (16)',
    same(detectFrameGrid(img), grid(16, 32, 32)));
}
{
  // 2x2 of 256; each blob reaches the interior cell edges, so opaque pairs
  // straddle x = 256 and y = 256. Every candidate dividing 512 has a line
  // at 256, so none is clean.
  const img = blank(512, 512);
  rect(img, 8, 8, 256, 256);
  rect(img, 256, 8, 504, 256);
  rect(img, 8, 256, 256, 504);
  rect(img, 256, 256, 504, 504);
  const g = detectCleanGrid(img);
  check('10. 512x512 2x2 of 256 with sprites straddling the 256 line: detectCleanGrid null or larger',
    g === null || g.width > 256);
  check('10. 512x512 2x2 of 256 with sprites straddling the 256 line: detectFrameGrid unchanged from base (16)',
    same(detectFrameGrid(img), grid(16, 32, 32)));
}

// ── 11: KNOWN_LAYOUTS regression ──

{
  // Copy of KNOWN_LAYOUTS in src/lib/spriteUtils.ts.
  const KNOWN = [
    [192, 192, 48], [192, 96, 48], [288, 192, 48], [192, 288, 48],
    [128, 128, 32], [128, 64, 32], [192, 128, 32],
    [256, 256, 64], [256, 64, 64], [384, 64, 64],
    [640, 80, 80], [320, 160, 80],
  ];
  for (const [w, h, f] of KNOWN) {
    const img = sheet(w, h, f);
    check(`11. KNOWN_LAYOUTS ${w}x${h} -> ${f}: detectFrameGrid returns the table layout`,
      same(detectFrameGrid(img), grid(f, w / f, h / f)));
  }
}

// ── 12: small blobs, 16 and 32 fail the content rule ──

{
  // 6x6 blob at 26..31 in each 64 cell: as near the centre as keeps the 16
  // and 32 lines clean, so those sizes are rejected by the content rule.
  const img = smallBlobs(256, 256, 64, 6, 26);
  check('12. 256x256 4x4 of 64, 6x6 blobs (16 and 32 clean, too empty): detectCleanGrid 64',
    same(detectCleanGrid(img), grid(64, 4, 4)));
  check('12. 256x256 4x4 of 64, 6x6 blobs (16 and 32 clean, too empty): detectFrameGrid 64',
    same(detectFrameGrid(img), grid(64, 4, 4)));
}
{
  // Exactly centred (29..34): the blob straddles the 32 line, still 64.
  const img = smallBlobs(256, 256, 64, 6, 29);
  check('12b. 256x256 4x4 of 64, 6x6 blobs exactly centred: detectCleanGrid 64',
    same(detectCleanGrid(img), grid(64, 4, 4)));
  check('12b. 256x256 4x4 of 64, 6x6 blobs exactly centred: detectFrameGrid 64',
    same(detectFrameGrid(img), grid(64, 4, 4)));
}

// ── 13: the gutter step wins over the clean grid (audit r1) ──

{
  // Frames of fw x fh with a blob inset by `margin`. The clean grid alone
  // would read each of these at a larger square size; the gutter step finds
  // the true frame first, as on base.
  const sheetWH = (width, height, fw, fh, margin) => {
    const img = blank(width, height);
    for (let y = 0; y < height; y += fh) {
      for (let x = 0; x < width; x += fw) rect(img, x + margin, y + margin, x + fw - margin, y + fh - margin);
    }
    return img;
  };
  const cases = [
    [384, 192, 32, 48, 4],
    [320, 256, 32, 64, 4],
    [320, 256, 16, 32, 2],
    [480, 192, 24, 48, 2],
    [160, 160, 8, 8, 1],
    [320, 320, 40, 40, 4],
  ];
  for (const [w, h, fw, fh, m] of cases) {
    check(`13. ${w}x${h} of ${fw}x${fh}: detectFrameGrid keeps the gutter result`,
      same(detectFrameGrid(sheetWH(w, h, fw, fh, m)), { width: fw, height: fh, columns: w / fw, rows: h / fh }));
  }
}

// ── 14: a grid line crossed, or only touched, by one pixel ──

{
  // 2x2 of 256 with blobs inset 8, except the top left blob, which reaches
  // one pixel past x = 256 (pixels 255 and 256 opaque). Every candidate
  // dividing 512 has a line at 256, so none is clean.
  const img = blank(512, 512);
  rect(img, 8, 8, 257, 248);
  rect(img, 264, 8, 504, 248);
  rect(img, 8, 264, 248, 504);
  rect(img, 264, 264, 504, 504);
  check('14a. a blob one pixel past x = 256: detectCleanGrid null', same(detectCleanGrid(img), null));
}
{
  // The same, one pixel past y = 256.
  const img = blank(512, 512);
  rect(img, 8, 8, 248, 257);
  rect(img, 264, 8, 504, 248);
  rect(img, 8, 264, 248, 504);
  rect(img, 264, 264, 504, 504);
  check('14b. a blob one pixel past y = 256: detectCleanGrid null', same(detectCleanGrid(img), null));
}
{
  // Blobs reach the 256 lines from both sides with one transparent pixel
  // (x or y = 256) between them: clean at 256.
  const img = blank(512, 512);
  rect(img, 8, 8, 256, 256);
  rect(img, 257, 8, 504, 256);
  rect(img, 8, 257, 256, 504);
  rect(img, 257, 257, 504, 504);
  check('14c. blobs touching the 256 lines without crossing: detectCleanGrid 256',
    same(detectCleanGrid(img), grid(256, 2, 2)));
}

// ── 15: the whole image is never a candidate ──

{
  // 256x256 with one sprite crossing every interior line of 16 to 128:
  // 256 itself would be one cell, which the two-cell minimum excludes.
  const img = blank(256, 256);
  rect(img, 8, 8, 248, 248);
  check('15. one sprite on a 256x256 image: detectCleanGrid null', same(detectCleanGrid(img), null));
}

// ── timing ──

{
  const img = sheet(2048, 2048, 256, { margin: 8 });
  const t0 = performance.now();
  const g = detectCleanGrid(img);
  const ms = performance.now() - t0;
  console.log(`time  2048x2048 detectCleanGrid ${ms.toFixed(1)} ms (result ${g ? g.width : 'null'})`);
}

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
