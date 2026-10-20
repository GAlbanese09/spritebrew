// scripts/grid-detect-test.mjs
//
// Offline tests for detectCleanGrid in src/lib/gridDetect.ts, its call in
// detectFrameGrid (src/lib/spriteUtils.ts) and the resizer's grid detection
// (src/lib/resizerGrid.ts): /upload Auto-detect on sheets with large cells. Run from the repo root:
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
    resizerGrid: path.join(ROOT, 'src/lib/resizerGrid.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const { cellHoldsTwoQuadrants, countGridCuts, crossesOnlyThinly, detectCleanGrid } = await import(
  pathToFileURL(path.join(OUT, 'gridDetect.mjs')).href
);
const { detectFrameGrid, detectFrameGridFromPixels } = await import(
  pathToFileURL(path.join(OUT, 'spriteUtils.mjs')).href
);
const { detectGridSmart } = await import(
  pathToFileURL(path.join(OUT, 'resizerGrid.mjs')).href
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
  // one pixel past x = 256 (pixels 255 and 256 opaque). Columns 257 to 263
  // are clear, a gap within the line tolerance, so 256 still counts.
  const img = blank(512, 512);
  rect(img, 8, 8, 257, 248);
  rect(img, 264, 8, 504, 248);
  rect(img, 8, 264, 248, 504);
  rect(img, 264, 264, 504, 504);
  check('14a. a blob one pixel past x = 256 with a gap after it: detectCleanGrid 256', same(detectCleanGrid(img), grid(256, 2, 2)));
}
{
  // The same, one pixel past y = 256.
  const img = blank(512, 512);
  rect(img, 8, 8, 248, 257);
  rect(img, 264, 8, 504, 248);
  rect(img, 8, 264, 248, 504);
  rect(img, 264, 264, 504, 504);
  check('14b. a blob one pixel past y = 256 with a gap after it: detectCleanGrid 256', same(detectCleanGrid(img), grid(256, 2, 2)));
}
{
  // One pixel past x = 256 with the next blob flush against it (no clear
  // column anywhere near the line): a real cut, so no size is clean.
  const img = blank(512, 512);
  rect(img, 8, 8, 257, 248);
  rect(img, 257, 8, 504, 248);
  rect(img, 8, 264, 248, 504);
  rect(img, 264, 264, 504, 504);
  check('14d. one pixel past x = 256 with no gap near the line: detectCleanGrid null', same(detectCleanGrid(img), null));
  const imgY = blank(512, 512);
  rect(imgY, 8, 8, 248, 257);
  rect(imgY, 8, 257, 248, 504);
  rect(imgY, 264, 8, 504, 248);
  rect(imgY, 264, 264, 504, 504);
  check('14d. one pixel past y = 256 with no gap near the line: detectCleanGrid null', same(detectCleanGrid(imgY), null));
}
{
  // 8 px past x = 256, then a gap: farther than the tolerance (4 px at
  // 256), so it is a real cut, not a spill.
  const img = blank(512, 512);
  rect(img, 8, 8, 264, 248);
  rect(img, 272, 8, 504, 248);
  rect(img, 8, 264, 248, 504);
  rect(img, 264, 264, 504, 504);
  check('14e. a blob 8 px past x = 256 with a gap after it: detectCleanGrid null', same(detectCleanGrid(img), null));
}
{
  // The tolerance on each side of the line: a bar reaching d px past
  // x = 256 from the left cell's sprite, or from the right cell's sprite,
  // with a gap beyond. 4 px (the tolerance at 256) is forgiven, 5 px is not.
  const reach = (d, fromLeft) => {
    const img = blank(512, 512);
    for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]]) rect(img, x + 40, y + 40, x + 216, y + 216);
    if (fromLeft) rect(img, 200, 100, 256 + d, 120);
    else rect(img, 256 - d, 100, 300, 120);
    return img;
  };
  check('14f. 4 px past x = 256 from the left: detectCleanGrid 256', same(detectCleanGrid(reach(4, true)), grid(256, 2, 2)));
  check('14f. 5 px past x = 256 from the left: detectCleanGrid null', same(detectCleanGrid(reach(5, true)), null));
  check('14f. 4 px past x = 256 from the right: detectCleanGrid 256', same(detectCleanGrid(reach(4, false)), grid(256, 2, 2)));
  check('14f. 5 px past x = 256 from the right: detectCleanGrid null', same(detectCleanGrid(reach(5, false)), null));
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

// ── 16 to 19: a gutter grid that cuts sprites (audits r2 and r3) ──

// Cells of fw x fh; margins(c, r) gives the blob's [left, top, right, bottom]
// margins inside cell (c, r).
function cells(width, height, fw, fh, margins) {
  const img = blank(width, height);
  for (let r = 0; r < height / fh; r++) {
    for (let c = 0; c < width / fw; c++) {
      const [l, t, rr, b] = margins(c, r);
      rect(img, c * fw + l, r * fh + t, (c + 1) * fw - rr, (r + 1) * fh - b);
    }
  }
  return img;
}
{
  // A walk cycle whose pose widths alternate: right margins 4, 10, 4, 10.
  // The gutter spacing measures 122; its grid cuts the sprites and 128 is a
  // clean grid of nearly the same size, so 128 wins.
  const img = cells(512, 512, 128, 128, (c) => [4, 4, c % 2 ? 10 : 4, 4]);
  check('16. 512x512 4x4 of 128, pose widths alternate: detectFrameGrid 128 (gutter read 122)',
    same(detectFrameGrid(img), grid(128, 4, 4)));
}
{
  const img = cells(512, 512, 128, 128, (c, r) => [4, 4, c % 2 ? 10 : 4, r % 2 ? 10 : 4]);
  check('16b. the same with heights alternating too: detectFrameGrid 128 (gutter read 122x122)',
    same(detectFrameGrid(img), grid(128, 4, 4)));
}
{
  // 128x64 frames with alternating widths: the gutter reads 122x64 and its
  // grid cuts the sprites, but the clean grid (128x128) is near in width
  // only, so it must not replace the result and halve the rows. The width
  // stays mis-measured, as on base.
  const g = detectFrameGrid(cells(512, 256, 128, 64, (c) => [4, 4, c % 2 ? 10 : 4, 4]));
  check('16c. 512x256 of 128x64, widths alternate: keeps 64 px rows (clean 128x128 is near in width only)',
    g !== null && g.height === 64 && g.rows === 4);
}
{
  const g = detectFrameGrid(cells(256, 512, 64, 128, (c, r) => [4, 4, 4, r % 2 ? 10 : 4]));
  check('16d. 256x512 of 64x128, heights alternate: keeps 64 px columns (clean 128x128 is near in height only)',
    g !== null && g.width === 64 && g.columns === 4);
}
{
  // One effect reaches across x = 32 into the next frame. The 32x48 gutter
  // result cuts it, but the only clean grid is a multiple (96), so the
  // gutter result stands.
  const img = cells(384, 192, 32, 48, () => [4, 4, 4, 4]);
  rect(img, 28, 10, 36, 12);
  check('17. 384x192 of 32x48 with one effect across a frame line: detectFrameGrid keeps 32x48',
    same(detectFrameGrid(img), { width: 32, height: 48, columns: 12, rows: 4 }));
}
{
  const img = cells(320, 320, 40, 40, () => [4, 4, 4, 4]);
  rect(img, 36, 10, 44, 12);
  check('17b. 320x320 of 40 with one effect across a frame line: detectFrameGrid keeps 40',
    same(detectFrameGrid(img), grid(40, 8, 8)));
}
{
  // A 512x512 texture holding 4x4 of 120 px cells with 60 px sprites
  // centred: 128 is clean too, but the 120 gutter grid cuts nothing, so 120
  // stands.
  const img = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) rect(img, c * 120 + 30, r * 120 + 30, c * 120 + 90, r * 120 + 90);
  }
  check('18. 512x512 texture of 4x4 120 px cells: detectFrameGrid 120',
    same(detectFrameGrid(img), { width: 120, height: 120, columns: 4, rows: 4 }));
}
{
  // Test 18's texture plus one effect on the first sprite reaching 2 px past
  // x = 120. The 120 grid cuts it in 4 pixel pairs, far fewer than one cell
  // is long, so the near clean grid (128) does not replace 120 (audit r3).
  const img = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) rect(img, c * 120 + 30, r * 120 + 30, c * 120 + 90, r * 120 + 90);
  }
  rect(img, 90, 50, 122, 54);
  check('18c. the same texture with one effect 2 px past x = 120: detectFrameGrid keeps 120',
    same(detectFrameGrid(img), { width: 120, height: 120, columns: 4, rows: 4 }));
}
{
  // A 512x512 texture holding 5x5 of 100 px cells, 20 px sprites near each
  // cell's start, and one effect across x = 100. The 100 gutter grid cuts
  // the effect and 128 is clean, but 128 is not near 100 (more than an
  // eighth off), so 100 stands.
  const img = blank(512, 512);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) rect(img, c * 100 + 4, r * 100 + 4, c * 100 + 24, r * 100 + 24);
  }
  rect(img, 96, 10, 104, 12);
  check('18b. 100 px cells with one effect across a line: detectFrameGrid keeps 100',
    same(detectFrameGrid(img), { width: 100, height: 100, columns: 5, rows: 5 }));
}
{
  const img = sheet(512, 512, 256, { margin: 8 });
  check('19. countGridCuts: 2x2 of 256 at 256 is 0', countGridCuts(img, 256, 256) === 0);
  check('19. countGridCuts: 2x2 of 256 at 128 is 1920 (240 rows or columns on each of 8 line halves)', countGridCuts(img, 128, 128) === 1920);
  const touch = blank(512, 512);
  rect(touch, 8, 8, 256, 256);
  rect(touch, 257, 8, 504, 256);
  rect(touch, 8, 257, 256, 504);
  rect(touch, 257, 257, 504, 504);
  check('19. countGridCuts: lines touched without crossing is 0', countGridCuts(touch, 256, 256) === 0);
  const crossX = blank(512, 512);
  rect(crossX, 8, 8, 257, 248);
  check('19. countGridCuts: one pixel past x = 256 over 240 rows is 240', countGridCuts(crossX, 256, 256) === 240);
  const crossY = blank(512, 512);
  rect(crossY, 8, 8, 248, 257);
  check('19. countGridCuts: one pixel past y = 256 over 240 columns is 240', countGridCuts(crossY, 256, 256) === 240);
  // Blobs that start exactly on a line, with nothing on the other side.
  const startX = blank(512, 512);
  rect(startX, 8, 8, 248, 248);
  rect(startX, 256, 8, 504, 248);
  check('19. countGridCuts: a blob starting on x = 256 is 0', countGridCuts(startX, 256, 256) === 0);
  const startY = blank(512, 512);
  rect(startY, 8, 8, 248, 248);
  rect(startY, 8, 256, 248, 504);
  check('19. countGridCuts: a blob starting on y = 256 is 0', countGridCuts(startY, 256, 256) === 0);
}

// ── 20: the resizer's grid detection (src/lib/resizerGrid.ts) ──
//
// Uploads over 128 px open the Resize Sprite Sheet step before the slicer,
// and its grid detection used to go by the image's shape alone (a square
// image read as 4x4 whatever its pixels). It now asks the slicer's
// pixel-reading steps first.

const rz = (img) => {
  const g = detectGridSmart(img);
  return `${g.cols}x${g.rows}`;
};
{
  check('20. resizer: 512x512, 2x2 of 256 reads 2x2 (was 4x4)', rz(sheet(512, 512, 256, { margin: 8 })) === '2x2');
  check('20. resizer: 1024x512, 4x2 of 256 reads 4x2 (was 4x4)', rz(sheet(1024, 512, 256, { margin: 8 })) === '4x2');
  check('20. resizer: 768x256, 3x1 of 256 reads 3x1 (was 8x4)', rz(sheet(768, 256, 256, { margin: 8 })) === '3x1');
  check('20. resizer: 640x640, 5x5 of 128 reads 5x5 (was 4x4)', rz(sheet(640, 640, 128)) === '5x5');
  check('20. resizer: 2048x128, 16x1 of 128 reads 16x1 (was 8x1)', rz(sheet(2048, 128, 128)) === '16x1');
  check('20. resizer: 512x512, 4x4 of 128 still reads 4x4', rz(sheet(512, 512, 128)) === '4x4');
  check('20. resizer: 384x192 of 32x48 reads 12x4 (was 4x4)',
    rz(cells(384, 192, 32, 48, () => [4, 4, 4, 4])) === '12x4');
  // Only a pixel-based answer is taken: with nothing to read, the shape
  // steps answer as before.
  const solid = blank(512, 512);
  rect(solid, 0, 0, 512, 512);
  check('20. resizer: a fully opaque 512x512 still reads 4x4', rz(solid) === '4x4');
  check('20. detectFrameGridFromPixels: fully opaque is null', detectFrameGridFromPixels(solid) === null);
  const one = blank(512, 512);
  rect(one, 8, 8, 48, 48);
  check('20. resizer: one sprite on 512x512 still reads 4x4', rz(one) === '4x4');
  check('20. detectFrameGridFromPixels: one sprite is null', detectFrameGridFromPixels(one) === null);
  // A pixel answer the resizer cannot show (more than 16 columns) is
  // skipped, and the shape steps answer as before.
  check('20. resizer: 160x160 of 8 px icons (20 columns) still reads 4x4', rz(sheet(160, 160, 8, { margin: 1 })) === '4x4');
  // detectFrameGrid is the pixel steps, then the shape steps: unchanged.
  check('20. detectFrameGrid on the fully opaque sheet is still the base result (16)',
    same(detectFrameGrid(solid), grid(16, 32, 32)));
}

// ── 21: the resizer on sparse templates and charsets (audit r5) ──

{
  // A 4x4 template of 128 px frames with the first k frames drawn.
  const template = (k) => {
    const img = blank(512, 512);
    for (let i = 0; i < k; i++) {
      const c = i % 4;
      const r = Math.floor(i / 4);
      rect(img, c * 128 + 6, r * 128 + 6, c * 128 + 122, r * 128 + 124);
    }
    return img;
  };
  const g6 = detectGridSmart(template(6));
  check('21. resizer: 4x4 template of 128 with 6 frames reads 4x4 (was 2x2 of 256)', `${g6.cols}x${g6.rows}` === '4x4');
  check("21. resizer: that answer is labelled 'medium' (a grid the pixels allow)", g6.confidence === 'medium');
  check('21. resizer: 4x4 template of 128 with 3 frames reads 4x4', rz(template(3)) === '4x4');
  check('21. resizer: 4x4 template of 128 with 7 frames reads 4x4', rz(template(7)) === '4x4');
  check("21. resizer: a full 4x4 of 128 stays 'high'", detectGridSmart(template(16)).confidence === 'high');
  // 3x3 of 128 with 5 of 9 drawn: the 6x6 grid would cut the sprites, so 3x3 stands.
  const nine = blank(384, 384);
  for (let i = 0; i < 5; i++) rect(nine, (i % 3) * 128 + 4, Math.floor(i / 3) * 128 + 4, (i % 3) * 128 + 124, Math.floor(i / 3) * 128 + 124);
  check('21. resizer: 3x3 of 128 with 5 of 9 drawn reads 3x3', rz(nine) === '3x3');
  // A real 2x2 of 256 with one small sprite in a corner of each of two cells:
  // the 4x4 grid cuts nothing, but no cell holds two sprites, so 2x2 stands.
  const corner = blank(512, 512);
  rect(corner, 8, 8, 108, 108);
  rect(corner, 264, 8, 364, 108);
  rect(corner, 8, 264, 108, 364);
  check('21. resizer: 2x2 of 256 with one corner sprite per cell keeps 2x2', rz(corner) === '2x2');
  check('21. cellHoldsTwoQuadrants: one sprite per 256 cell is false', cellHoldsTwoQuadrants(corner, 256, 256) === false);
  check('21. cellHoldsTwoQuadrants: the 6-frame template at 256 is true', cellHoldsTwoQuadrants(template(6), 256, 256) === true);
  // An RPG Maker XP charset (128x192, 4x4 of 32x48) whose gutter spacing
  // measures 49 rows high: the slicer's pixel answer would make the resizer
  // show 3 rows of 64, so the shape steps answer 4x4 as before.
  const T = [1, 1, 2, 1], B = [2, 1, 0, 0], L = [1, 2, 1, 1], R = [1, 1, 1, 4];
  const xp = blank(128, 192);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) rect(xp, c * 32 + L[c], r * 48 + T[r], (c + 1) * 32 - R[c], (r + 1) * 48 - B[r]);
  }
  check('21. resizer: an XP charset with rows measured 49 for 48 reads 4x4', rz(xp) === '4x4');
  // A padded texture: 8x8 of 120 px cells in a 1024 texture, frames shown
  // as 128 (within an eighth of 120), so the pixel grid stands.
  const padded = blank(1024, 1024);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) rect(padded, c * 120 + 4, r * 120 + 4, c * 120 + 116, r * 120 + 116);
  }
  check('21. resizer: 8x8 of 120 in a 1024 texture reads 8x8', rz(padded) === '8x8');
}

// ── 22: characters that fill their cells and spill past the line ──

{
  // A 512x512 sheet of four 256 px characters, as George's Oct 20 upload:
  // each sprite runs the full cell height, the top row's feet reach 2 px
  // past y = 256 (rows 256 and 257), rows 258 and 259 are clear, and the
  // bottom row starts at 260. Every grid line used to count as cut, so the
  // resizer and the slicer fell back to their shape guesses (4x4 and 16).
  const img = blank(512, 512);
  rect(img, 90, 0, 167, 256);
  rect(img, 100, 250, 140, 258);
  rect(img, 346, 0, 427, 256);
  rect(img, 360, 250, 400, 258);
  rect(img, 85, 260, 183, 512);
  rect(img, 330, 260, 447, 512);
  check('22. full-height characters spilling 2 px: detectCleanGrid 256', same(detectCleanGrid(img), grid(256, 2, 2)));
  check('22. full-height characters spilling 2 px: detectFrameGrid 256', same(detectFrameGrid(img), grid(256, 2, 2)));
  check('22. full-height characters spilling 2 px: resizer reads 2x2', rz(img) === '2x2');
  // The same characters four across (1024x512, 4x2 of 256).
  const wide = blank(1024, 512);
  for (const ox of [0, 512]) {
    rect(wide, ox + 90, 0, ox + 167, 256);
    rect(wide, ox + 100, 250, ox + 140, 258);
    rect(wide, ox + 346, 0, ox + 427, 256);
    rect(wide, ox + 360, 250, ox + 400, 258);
    rect(wide, ox + 85, 260, ox + 183, 512);
    rect(wide, ox + 330, 260, ox + 447, 512);
  }
  check('22. the same four across: resizer reads 4x2', rz(wide) === '4x2');
  check('22. the same four across: detectFrameGrid 256', same(detectFrameGrid(wide), grid(256, 4, 2)));
  // A 4x4 of 128 whose feet spill 2 px past every row line, and whose first
  // two frames touch across x = 128 for 40 rows. 256 is clean only by
  // forgiving the spills, and the 4x4 grid is blocked by that one contact
  // alone, so 256 is not taken and the resizer reads 4x4.
  const touch = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      rect(touch, c * 128 + 30, r * 128 + 8, c * 128 + 98, r * 128 + 128);
      if (r < 3) rect(touch, c * 128 + 40, (r + 1) * 128, c * 128 + 60, (r + 1) * 128 + 2);
    }
  }
  rect(touch, 98, 40, 158, 80);
  check('22. frames touching across x = 128, feet spilling past every row: detectCleanGrid does not take 256', same(detectCleanGrid(touch), null));
  check('22. frames touching across x = 128, feet spilling past every row: resizer reads 4x4', rz(touch) === '4x4');
}

// ── 23: an effect that crosses into the next frame ──

{
  // A 4x4 of 128 with one body per frame, and in every row an effect h px
  // tall that reaches 8 px past x = 128 and x = 384. The x = 256 line stays
  // clear, so the clean grid answers 256, and the resizer must see that the
  // 4x4 grid is crossed only by those effects.
  const fx = (h) => {
    const img = blank(512, 512);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) rect(img, c * 128 + 30, r * 128 + 10, c * 128 + 98, r * 128 + 120);
      for (const c of [0, 2]) rect(img, c * 128 + 98, r * 128 + 50, (c + 1) * 128 + 8, r * 128 + 50 + h);
    }
    return img;
  };
  check('23. effects 6 px tall across x = 128 and 384: detectCleanGrid 256', same(detectCleanGrid(fx(6)), grid(256, 2, 2)));
  const g = detectGridSmart(fx(6));
  check('23. effects 6 px tall: resizer reads 4x4, not 2x2 of 256', `${g.cols}x${g.rows}` === '4x4');
  check("23. effects 6 px tall: labelled 'medium'", g.confidence === 'medium');
  // The limit is an eighth of the edge: 16 rows on a 128 px edge.
  check('23. crossesOnlyThinly: 16 rows on a 128 px edge is thin, 17 is not',
    crossesOnlyThinly(fx(16), 128, 128) === true && crossesOnlyThinly(fx(17), 128, 128) === false);
  check('23. effects 16 px tall: resizer reads 4x4', rz(fx(16)) === '4x4');
  check('23. effects 17 px tall: resizer reads 2x2', rz(fx(17)) === '2x2');
}

// ── 24: a sprite that reaches a few pixels across the middle of its cell ──

{
  // A 2x2 of 256 with a 60 px sprite across the middle of each cell: the
  // 4x4 grid would cut every sprite in two, so 2x2 stands.
  const mid = blank(512, 512);
  for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]]) rect(mid, x + 98, y + 98, x + 158, y + 158);
  check('24. a 60 px sprite across the middle of each 256 cell: resizer keeps 2x2', rz(mid) === '2x2');
  // A 2x2 of 256 with a 100 px sprite in the top-left quadrant of each
  // cell; the first one reaches k px across the cell's middle (x = 128).
  const reach = (k) => {
    const img = blank(512, 512);
    rect(img, 28 + k, 20, 128 + k, 120);
    rect(img, 276, 20, 376, 120);
    rect(img, 20, 276, 120, 376);
    rect(img, 276, 276, 376, 376);
    return img;
  };
  check('24. a sprite 3 px across its cell\'s middle: resizer keeps 2x2', rz(reach(3)) === '2x2');
  check('24. cellHoldsTwoQuadrants: 4 px across the middle is a spill, 5 px is content',
    cellHoldsTwoQuadrants(reach(4), 256, 256) === false && cellHoldsTwoQuadrants(reach(5), 256, 256) === true);
  check('24. a sprite 5 px across: the 4x4 grid cuts it, so the resizer keeps 2x2', rz(reach(5)) === '2x2');
  // A 4x4 of 128 whose 56 px sprites sit in one quadrant of their cells
  // (left or right by column, top or bottom by row, so the gutters are
  // uneven and the clean grid answers) and reach 4 px across both middle
  // lines. The 64 px grid is clean only by forgiving those spills, and the
  // cells they reach hold nothing else, so they are not filled and 128
  // stands.
  const q = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * 128 + (c % 2 === 0 ? 12 : 60);
      const y = r * 128 + (r % 2 === 0 ? 12 : 60);
      rect(q, x, y, x + 56, y + 56);
    }
  }
  check('24. sprites 4 px across the middle of 128 px cells: detectCleanGrid 128', same(detectCleanGrid(q), grid(128, 4, 4)));
  check('24. sprites 4 px across the middle of 128 px cells: resizer reads 4x4', rz(q) === '4x4');
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
