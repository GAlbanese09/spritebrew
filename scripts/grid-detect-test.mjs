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
const { cellHoldsTwoQuadrants, countGridCuts, countUnresolvedCuts, detectCleanGrid } = await import(
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

// ── 23: a sparse template whose feet spill into the next row ──

{
  // A 4x4 template of 128 with the first 6 frames drawn, each standing on
  // its cell's floor; the top row's feet reach 2 px into the row below
  // (clear beyond). The clean grid answers 256 (128 is under half filled);
  // the 4x4 grid cuts nothing the slicer would not forgive, so the resizer
  // still reads 4x4.
  const img = blank(512, 512);
  for (let i = 0; i < 6; i++) {
    const c = i % 4;
    const r = Math.floor(i / 4);
    rect(img, c * 128 + 20, r * 128 + 10, c * 128 + 108, r * 128 + 128);
    if (r === 0) rect(img, c * 128 + 40, 128, c * 128 + 60, 130);
  }
  check('23. a 6-frame template of 128 whose feet spill 2 px: detectCleanGrid 256', same(detectCleanGrid(img), grid(256, 2, 2)));
  const g = detectGridSmart(img);
  check('23. a 6-frame template of 128 whose feet spill 2 px: resizer reads 4x4', `${g.cols}x${g.rows}` === '4x4');
  check("23. a 6-frame template of 128 whose feet spill 2 px: labelled 'medium'", g.confidence === 'medium');
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

// ── 25: small sprites, thin arms and touching frames (audit r7) ──

{
  // A 4x4 of 128: 48x50 sprites standing on the floor of the right half of
  // each cell, feet 2 px into the row below. The feet land in the top band
  // of the quadrant below, which is a spill, not a second sprite.
  const floor = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      rect(floor, c * 128 + 70, r * 128 + 78, c * 128 + 118, r * 128 + 128);
      if (r < 3) rect(floor, c * 128 + 80, (r + 1) * 128, c * 128 + 100, (r + 1) * 128 + 2);
    }
  }
  check('25. floor sprites with feet 2 px into the next row: resizer reads 4x4, not 8x8', rz(floor) === '4x4');
  check('25. floor sprites: cellHoldsTwoQuadrants does not count the feet', cellHoldsTwoQuadrants(floor, 128, 128) === false);
  // The same at 80 px cells (320x320).
  const floor80 = blank(320, 320);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      rect(floor80, c * 80 + 40, r * 80 + 42, c * 80 + 78, r * 80 + 80);
      if (r < 3) rect(floor80, c * 80 + 46, (r + 1) * 80, c * 80 + 60, (r + 1) * 80 + 2);
    }
  }
  check('25. 4x4 of 80 floor sprites with feet 2 px: resizer reads 4x4', rz(floor80) === '4x4');
  // A 4x4 of 128 with 40 px sprites at the top left of each cell; in cell
  // (1, 1) a 6 px arm reaches 16 px past the cell's middle.
  const arm = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) rect(arm, c * 128 + 8, r * 128 + 8, c * 128 + 48, r * 128 + 48);
  }
  rect(arm, 176, 148, 208, 154);
  check('25. a 6 px arm across a cell\'s middle: resizer reads 4x4, not 8x8', rz(arm) === '4x4');
  // A 2x2 of 256: a 100 px body in the top-left quadrant of each cell and a
  // 6 px weapon from it to 40 px past the middle.
  const weapon = blank(512, 512);
  for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]]) {
    rect(weapon, x + 14, y + 14, x + 114, y + 114);
    rect(weapon, x + 112, y + 60, x + 168, y + 66);
  }
  check('25. a body in one quadrant with a weapon across the middle: resizer keeps 2x2', rz(weapon) === '2x2');
  // A 4x4 of 128 whose frames touch across x = 128 and x = 384 for their
  // full height, with a gap at x = 256, feet 4 px past y = 128 and y = 384
  // (the tolerance) and 2 px past y = 256. 256 is clean only by forgiving
  // the feet, and every 256 cell is split in two by its horizontal middle,
  // clean once the feet are forgiven, so 256 is not taken.
  const touch = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const l = c % 2 === 1 ? 0 : 8;
      const rr = c % 2 === 0 ? 0 : 8;
      rect(touch, c * 128 + l, r * 128 + 6, (c + 1) * 128 - rr, (r + 1) * 128 - 6);
    }
  }
  for (let c = 0; c < 4; c++) {
    rect(touch, c * 128 + 30, 118, c * 128 + 60, 132);
    rect(touch, c * 128 + 30, 250, c * 128 + 60, 258);
    rect(touch, c * 128 + 30, 374, c * 128 + 60, 388);
  }
  check('25. frames touching across x = 128 and 384, feet past y = 256: detectCleanGrid does not take 256', same(detectCleanGrid(touch), null));
  check('25. frames touching across x = 128 and 384, feet past y = 256: resizer reads 4x4', rz(touch) === '4x4');
  // One cell split by a clean middle is not enough: George's four
  // characters, with the top-left one narrow and a prop beside it.
  const prop = blank(512, 512);
  rect(prop, 20, 0, 80, 256);
  rect(prop, 30, 250, 60, 258);
  rect(prop, 180, 100, 220, 140);
  rect(prop, 346, 0, 427, 256);
  rect(prop, 360, 250, 400, 258);
  rect(prop, 85, 260, 183, 512);
  rect(prop, 330, 260, 447, 512);
  check('25. one cell split by a clean middle, the others not: detectCleanGrid keeps 256', same(detectCleanGrid(prop), grid(256, 2, 2)));
  // A 4x4 of 128 whose feet spill past every row line, and whose first
  // frame touches both its neighbours (across x = 128 and across y = 128):
  // that 256 cell is not split by either middle, but the 4x4 grid is cut
  // only by those two contacts, so 256 is still not taken.
  const both = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      rect(both, c * 128 + 30, r * 128 + 8, c * 128 + 98, r * 128 + 128);
      if (r < 3) rect(both, c * 128 + 40, (r + 1) * 128, c * 128 + 60, (r + 1) * 128 + 2);
    }
  }
  rect(both, 98, 40, 158, 80);
  rect(both, 70, 120, 90, 140);
  check('25. one frame touching both neighbours, feet spilling past every row: detectCleanGrid does not take 256', same(detectCleanGrid(both), null));
  // A 4x2 of 256 with full-height characters in the left half of each cell
  // whose right edge reaches 4 px past the cell's middle (a spill), feet
  // 2 px past y = 256. Only that spill lies right of the middle, so no cell
  // is split in two, and 256 stands.
  const left = blank(1024, 512);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      rect(left, c * 256 + 28, r * 256 + (r ? 4 : 0), c * 256 + 132, (r + 1) * 256);
      if (r === 0) rect(left, c * 256 + 40, 256, c * 256 + 60, 258);
    }
  }
  check('25. characters spilling 4 px across their cell\'s middle: detectCleanGrid keeps 256', same(detectCleanGrid(left), grid(256, 4, 2)));
  // A rescued 80 is taken even though the 40 px grid is nearly clean: 40 is
  // not a size the slicer answers.
  const e80 = blank(320, 320);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      rect(e80, c * 80 + 6, r * 80 + 44, c * 80 + 34, r * 80 + 80);
      if (r < 3) rect(e80, c * 80 + 10, (r + 1) * 80, c * 80 + 20, (r + 1) * 80 + 2);
    }
  }
  check('25. a rescued 80 whose 40 px grid is nearly clean: detectCleanGrid 80', same(detectCleanGrid(e80), grid(80, 4, 4)));
}

// ── 26: frames that are not square, and the shape answer (audit r8) ──

{
  // A 4x4 of 48x64 (192x256): characters 19 px wide and 50 tall on their
  // cell's floor, feet 1 px into the row below, swaying so the gutter step
  // finds no column spacing. 64 px squares are clean once their lines are
  // forgiven a few pixels into the sprites, but the shape steps' 4x4 cuts
  // nothing and every cell holds a character, so the resizer keeps 4x4.
  const offA = [[0, 0, 0, 3], [-2, -2, -2, -3], [0, 0, 0, 3], [-2, -2, -2, -3]];
  const tall = blank(192, 256);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * 48 + 14 + offA[r][c];
      rect(tall, x, (r + 1) * 64 - 50, x + 19, (r + 1) * 64);
      if (r < 3) rect(tall, x + 4, (r + 1) * 64, x + 12, (r + 1) * 64 + 1);
    }
  }
  const gt = detectGridSmart(tall);
  check('26. a 4x4 of 48x64 with narrow characters: resizer reads 4x4, not 3x4 of 64', `${gt.cols}x${gt.rows}` === '4x4');
  check("26. a 4x4 of 48x64 with narrow characters: labelled 'medium'", gt.confidence === 'medium');
  // A 4x4 of 128x64 (512x256): 90x48 sprites on their cell's floor, feet
  // 2 px, swaying. Squares of 128 are clean; the shape steps' 4x4 is too.
  const offB = [[-3, -3, -3, 0], [-1, -1, -1, 2], [-1, -1, -1, -2], [-2, -2, -2, 1]];
  const wide = blank(512, 256);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * 128 + 19 + offB[r][c];
      rect(wide, x, (r + 1) * 64 - 48, x + 90, (r + 1) * 64);
      if (r < 3) rect(wide, x + 20, (r + 1) * 64, x + 40, (r + 1) * 64 + 2);
    }
  }
  check('26. a 4x4 of 128x64 frames: resizer reads 4x4, not 4x2 of 128', rz(wide) === '4x4');
  // A 4x2 of 256 (1024x512) with 80x110 characters on the floor of each
  // cell, the top row's feet 2 px into the row below. The shape steps' 4x4
  // of 256x128 cuts nothing, but only half its cells hold a character (the
  // feet do not count), so the pixel answer 4x2 stands.
  const short = blank(1024, 512);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * 256 + 88;
      rect(short, x, (r + 1) * 256 - 110, x + 80, (r + 1) * 256);
      if (r === 0) rect(short, x + 20, 256, x + 40, 258);
    }
  }
  check('26. short characters on the floor of a 4x2 of 256: resizer keeps 4x2', rz(short) === '4x2');
  // A 512x512 of 64 px frames reads 8x8: a finer pixel answer is never
  // replaced by the coarser shape answer.
  check('26. 8x8 of 64 still reads 8x8', rz(sheet(512, 512, 64, { margin: 6 })) === '8x8');
  // A padded texture: 512x512 holding a 4x4 of 120 px cells, 66x94
  // characters on the floor, feet 2 px; the last row's tops reach 2 px past
  // y = 384, so 128 is clean only by forgiveness and does not replace the
  // measured 120.
  const pad = blank(512, 512);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = c * 120 + 27;
      if (r < 3) {
        rect(pad, x, (r + 1) * 120 - 94, x + 66, (r + 1) * 120);
        rect(pad, x + 10, (r + 1) * 120, x + 24, (r + 1) * 120 + 2);
      } else {
        rect(pad, x, 382, x + 66, 476);
      }
    }
  }
  check('26. a padded texture of 120 with spilling feet: detectFrameGrid keeps 120', same(detectFrameGrid(pad), { width: 120, height: 120, columns: 4, rows: 4 }));
  // A 4x4 of 24 (96x96, from BUILD's random small sheets) whose gutters
  // measure 25 across. The 25 px grid cuts sprites, and some of those cuts
  // lie within the tolerance of a clear column; they still count here, or
  // the mis-measured 25 would stand.
  const small24 = blank(96, 96);
  for (const [x0, y0, x1, y1] of [
    [1, 1, 21, 21], [28, 5, 44, 20], [51, 5, 68, 24], [73, 6, 89, 20],
    [5, 27, 18, 47], [26, 29, 46, 45], [54, 31, 70, 46], [75, 29, 95, 45],
    [1, 54, 17, 72], [28, 50, 41, 70], [53, 55, 70, 72], [74, 49, 91, 69],
    [4, 79, 19, 96], [29, 78, 46, 92], [49, 77, 71, 93], [74, 76, 90, 93],
  ]) rect(small24, x0, y0, x1, y1);
  check('26. a 4x4 of 24 whose gutters measure 25: detectFrameGrid 24', same(detectFrameGrid(small24), grid(24, 4, 4)));
}

// ── 27: a size-only table answer, and diagonal pixels (Second 058) ──

{
  // The known layouts table answers from the image size alone. Sheets of
  // that size with other frames (every cell drawn, 4 px insets) keep the
  // grid that cuts nothing; genuine table layouts keep the table's answer.
  const cellsSheet = (w, h, cols, rows) => {
    const img = blank(w, h);
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) rect(img, c * cw + 4, r * ch + 4, (c + 1) * cw - 4, (r + 1) * ch - 4);
    }
    return img;
  };
  const g48x32 = detectGridSmart(cellsSheet(192, 128, 4, 4));
  check('27. 192x128 of 48x32 frames: resizer reads 4x4, not the table\'s 6x4', `${g48x32.cols}x${g48x32.rows}` === '4x4');
  check("27. 192x128 of 48x32 frames: labelled 'medium'", g48x32.confidence === 'medium');
  check('27. 288x192 of 72x48 frames: resizer reads 4x4', rz(cellsSheet(288, 192, 4, 4)) === '4x4');
  check('27. 192x288 of 48x72 frames: resizer reads 4x4', rz(cellsSheet(192, 288, 4, 4)) === '4x4');
  check('27. control: 192x128 of 32 px frames keeps the table\'s 6x4', rz(cellsSheet(192, 128, 6, 4)) === '6x4');
  check('27. control: 288x192 of 48 px frames keeps 6x4', rz(cellsSheet(288, 192, 6, 4)) === '6x4');
  check('27. control: 192x288 of 48 px frames keeps 4x6', rz(cellsSheet(192, 288, 4, 6)) === '4x6');
  // A pixel answer is replaced only when its grid cuts whole sprites, not
  // for one effect: an 8x4 of 64 (512x256) whose first frame's effect
  // reaches 6 px into the next keeps 8x4, although the shape steps' 4x4 of
  // 128x64 cuts nothing.
  const fx8 = cellsSheet(512, 256, 8, 4);
  rect(fx8, 52, 30, 70, 33);
  check('27. control: an 8x4 of 64 with one effect into the next frame keeps 8x4', rz(fx8) === '8x4');
  // A 4x4 of 128 whose sprites hold a one-pixel diagonal weapon reaching
  // across the middle of their cell: the 8x8 grid cuts every weapon, even
  // though no two opaque pixels face each other straight across a line.
  const weapon = (path) => {
    const img = blank(512, 512);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        rect(img, c * 128 + 8, r * 128 + 8, c * 128 + 48, r * 128 + 48);
        for (let n = 47; n <= 95; n++) {
          const [x, y] = path(n);
          rect(img, c * 128 + x, r * 128 + y, c * 128 + x + 1, r * 128 + y + 1);
        }
      }
    }
    return img;
  };
  const down = weapon((n) => [n, n - 20]);
  check('27. a diagonal weapon across the cell middles: resizer reads 4x4, not 8x8', rz(down) === '4x4');
  check('27. a diagonal weapon: the 64 px grid has unforgiven cuts', countUnresolvedCuts(down, 64, 64) > 0);
  check('27. a diagonal weapon: detectCleanGrid 128, not 64', same(detectCleanGrid(down), grid(128, 4, 4)));
  check('27. a mirrored diagonal weapon: resizer reads 4x4', rz(weapon((n) => [n, 102 - n])) === '4x4');
  check('27. a transposed diagonal weapon: resizer reads 4x4', rz(weapon((n) => [n - 20, n])) === '4x4');
  check('27. control: the same weapon drawn straight across reads 4x4', rz(weapon((n) => [n, 30])) === '4x4');
  // Feet that spill 2 px past y = 256 as a diagonal stair, with clear rows
  // beyond, are still a forgiven spill: George's four characters stay 2x2.
  const stair = blank(512, 512);
  rect(stair, 90, 0, 167, 256);
  rect(stair, 346, 0, 427, 256);
  for (let k = 0; k < 2; k++) {
    rect(stair, 100 + k, 256 + k, 101 + k, 257 + k);
    rect(stair, 360 + k, 256 + k, 361 + k, 257 + k);
  }
  rect(stair, 85, 260, 183, 512);
  rect(stair, 330, 260, 447, 512);
  check('27. feet spilling past y = 256 as a diagonal stair: resizer reads 2x2', rz(stair) === '2x2');
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
