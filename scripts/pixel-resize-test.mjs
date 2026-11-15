// scripts/pixel-resize-test.mjs
//
// Offline tests for src/lib/pixelResize.ts, the pixel-art resize engine
// (DESIGN design/tickets/editor-tools-batch.md v4.1, B2 to B5): the one
// mapping, whole factors down and up, sheets frame by frame, the size
// choices and their words, the caps, Other size, Canvas size and its trim
// warning, the rows and columns picker, and that the library stays pure.
// Run from the repo root: `node scripts/pixel-resize-test.mjs`. Bundles with
// esbuild into local/.pixel-resize-test/ (gitignored). Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.pixel-resize-test');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/pixelResize.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
});
const R = await import(pathToFileURL(path.join(OUT_DIR, 'pixelResize.mjs')).href);
const {
  sourceIndex, resizeImage, resizeSheet, passesCap, sizeChoices, wholeFactor, classifySize, hasCleanSmaller,
  nearestCleanSizes, sizeText, sizeChoiceLabel, canvasShare, resizeCanvas, resizeCanvasSheet, trimCuts, wholeGrids,
  EDITOR_SIDE_CAP, DOWNLOAD_SIDE_CAP, isWholeSize, axisChange, sizeChange, anchorSides, ANCHORS,
} = R;

let failed = 0;
const names = new Set();
function check(name, ok, detail) {
  const id = name.slice(0, name.indexOf(':'));
  if (names.has(id)) { console.log(`FAIL  two checks are named ${id}`); failed++; }
  names.add(id);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof RangeError; } };
const runs = (fn) => { try { fn(); return true; } catch { return false; } };

// A test image: every pixel tells where it came from. R = x, G = y, B = a
// mark, A = 255 unless the cell is chosen to be see-through.
function marked(width, height, { clearIf = () => false, mark = 7 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4;
    data[o] = x % 256; data[o + 1] = y % 256; data[o + 2] = mark; data[o + 3] = clearIf(x, y) ? 0 : 255;
  }
  return { width, height, data };
}
// An image whose every pixel holds its own index, all 32 bits (RGBA,
// little-endian), so a pixel taken from anywhere else shows, at any size.
function indexed(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = i & 255; data[i * 4 + 1] = (i >>> 8) & 255; data[i * 4 + 2] = (i >>> 16) & 255; data[i * 4 + 3] = (i >>> 24) & 255; }
  return { width, height, data };
}
const indexAt = (img, x, y) => { const o = (y * img.width + x) * 4; return img.data[o] | (img.data[o + 1] << 8) | (img.data[o + 2] << 16) | (img.data[o + 3] << 24); };
// Every output pixel must be the source pixel the one mapping names.
function exactCopy(src, out) {
  const wrong = [];
  for (let y = 0; y < out.height && wrong.length < 3; y++) for (let x = 0; x < out.width && wrong.length < 3; x++) {
    const want = sourceIndex(y, out.height, src.height) * src.width + sourceIndex(x, out.width, src.width);
    if (indexAt(out, x, y) !== want) wrong.push({ x, y, got: indexAt(out, x, y), want });
  }
  return wrong;
}
const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const freeze = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const equalImages = (a, b) => a.width === b.width && a.height === b.height && a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);

// ---- A. the one mapping ----
{
  // The formula in floating point, for small sizes where it is exact enough to compare.
  const bad = [];
  for (let src = 1; src <= 48; src++) for (let dest = 1; dest <= 48; dest++) for (let i = 0; i < dest; i++) {
    const want = Math.min(src - 1, Math.max(0, Math.ceil(((i + 0.5) * src) / dest) - 1));
    if (sourceIndex(i, dest, src) !== want) bad.push({ i, dest, src, got: sourceIndex(i, dest, src), want });
  }
  check('A1: sourceIndex is ceil((i + 0.5) * src / dest) - 1, clamped, for every size up to 48 both ways', bad.length === 0, bad.slice(0, 3));
  const centre = [];
  for (const k of [2, 3, 4, 5, 6, 7, 8, 9, 16]) for (const n of [1, 3, 8, 64]) for (let i = 0; i < n; i++) {
    if (sourceIndex(i, n, n * k) !== i * k + Math.floor((k - 1) / 2)) centre.push({ k, n, i });
  }
  check('A2: at a whole factor k down each pixel is its block\'s centre, index floor((k - 1) / 2) (the upper-left of the middle four for an even k)', centre.length === 0, centre.slice(0, 3));
  const blocks = [];
  for (const k of [2, 3, 4, 8]) for (const n of [1, 5, 33]) for (let i = 0; i < n * k; i++) if (sourceIndex(i, n * k, n) !== Math.floor(i / k)) blocks.push({ k, n, i });
  check('A3: at a whole factor k up each source pixel makes a k by k block', blocks.length === 0, blocks.slice(0, 3));
  let monotone = true, inRange = true;
  for (const [src, dest] of [[396, 150], [97, 64], [4096, 4095], [4095, 4096], [7, 1], [1, 7], [1000, 3]]) {
    let last = -1;
    for (let i = 0; i < dest; i++) { const s = sourceIndex(i, dest, src); if (s < last) monotone = false; if (s < 0 || s > src - 1) inRange = false; last = s; }
  }
  check('A4: on uneven sizes the mapping never goes backwards and never leaves the source', monotone && inRange);
  check('A6: an index outside the destination is clamped to the source, as the formula says', sourceIndex(-1, 4, 8) === 0 && sourceIndex(-5, 4, 8) === 0 && sourceIndex(4, 4, 8) === 7 && sourceIndex(9, 4, 8) === 7);
  check('A5: whole-number maths holds at the largest sizes (4096 to 4095, and 4096 by 8 to 3)', sourceIndex(4094, 4095, 4096) === 4095 && sourceIndex(0, 4095, 4096) === 0 && sourceIndex(2, 3, 32768) === 27306);
}

// ---- B. resizing an image ----
{
  const img = marked(12, 8, { clearIf: (x, y) => (x + y) % 5 === 0 });
  const before = freeze(img);
  const half = resizeImage(img, 6, 4);
  check('B1: half size takes each 2 by 2 block\'s upper-left of the middle four, which for k = 2 is the block\'s first pixel', px(half, 0, 0).slice(0, 2).join() === '0,0' && px(half, 1, 0).slice(0, 2).join() === '2,0' && px(half, 5, 3).slice(0, 2).join() === '10,6');
  const third = resizeImage(marked(9, 9), 3, 3);
  check('B2: a third takes each 3 by 3 block\'s centre', px(third, 0, 0).slice(0, 2).join() === '1,1' && px(third, 2, 1).slice(0, 2).join() === '7,4');
  const up = resizeImage(img, 36, 24);
  let blockOk = true;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 36; x++) if (px(up, x, y).join() !== px(img, Math.floor(x / 3), Math.floor(y / 3)).join()) blockOk = false;
  check('B3: three times bigger is 3 by 3 blocks, alpha and all', blockOk);
  const odd = resizeImage(img, 7, 5);
  let copies = true;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) if (px(odd, x, y).join() !== px(img, sourceIndex(x, 7, 12), sourceIndex(y, 5, 8)).join()) copies = false;
  check('B4: an uneven size is the same mapping on each axis: every pixel a copy of one source pixel, nothing mixed', copies);
  const clearKept = (() => { const t = marked(4, 4, { clearIf: () => true, mark: 99 }); const o = resizeImage(t, 8, 8); return o.data.every((v, i) => (i % 4 === 3 ? v === 0 : true)) && px(o, 7, 7).join() === '3,3,99,0'; })();
  check('B5: a fully transparent pixel stays fully transparent, its colour under alpha 0 copied as it is', clearKept);
  check('B6: the same size gives the same pixels, in a new array', (() => { const o = resizeImage(img, 12, 8); return equalImages(o, img) && o.data !== img.data; })());
  check('B7: the image given is never changed', equalImages(img, before));
  check('B8: a 1 px image grows and a big one shrinks to 1 px', px(resizeImage(marked(1, 1), 5, 3), 4, 2).join() === '0,0,7,255' && px(resizeImage(marked(9, 9), 1, 1), 0, 0).slice(0, 2).join() === '4,4');
  check('B9: it refuses a size under 1 or not whole, and an image whose data is the wrong length, with a RangeError', throws(() => resizeImage(img, 0, 4)) && throws(() => resizeImage(img, 4, 2.5)) && throws(() => resizeImage(img, -1, 4)) && throws(() => resizeImage({ width: 2, height: 2, data: new Uint8ClampedArray(15) }, 4, 4)) && throws(() => resizeImage({ width: 0, height: 2, data: new Uint8ClampedArray(0) }, 4, 4)));
  check('B10: it checks no cap: 5000 px a side is made when asked (the caller checks the cap)', resizeImage(marked(2, 2), 5000, 1).width === 5000);
  // REV-L1: the image check, through every function that takes an image.
  const one = { frameWidth: 2, frameHeight: 2, columns: 1, rows: 1 };
  const everyDoor = (image) => [
    () => resizeImage(image, 4, 4), () => resizeSheet(image, one, 4, 4), () => resizeCanvas(image, 4, 4, 'center'),
    () => resizeCanvasSheet(image, one, 4, 4, 'center'), () => trimCuts(image, 1, 1, 'center'),
  ];
  const tooLong = [17, 19, 20, 32].map((n) => ({ width: 2, height: 2, data: new Uint8ClampedArray(n) }));
  check('B13: data longer than the image needs (one byte more, three bytes more, one pixel more, and twice as long) is refused with a RangeError, by every function that takes an image', tooLong.every((image) => everyDoor(image).every(throws)));
  const wrongKind = [new Uint8Array(16), Buffer.alloc(16), new Int8Array(16), new Uint16Array(16), new Float32Array(16), new Array(16).fill(0), new ArrayBuffer(16), { length: 16 }];
  check('B14: data of the right length that is not a Uint8ClampedArray (a Uint8Array, a Buffer, another typed array, a plain array, an ArrayBuffer, an object with a length) is refused with a RangeError, by every function that takes an image; a Uint8ClampedArray passes them all', wrongKind.every((data) => everyDoor({ width: 2, height: 2, data }).every(throws)) && everyDoor({ width: 2, height: 2, data: new Uint8ClampedArray(16) }).every(runs));
  // AUDIT pixel-resize-l1 r1, L6: what each function hands back is what new ImageData takes.
  const sheet84 = { frameWidth: 4, frameHeight: 4, columns: 2, rows: 1 };
  const made = [resizeImage(marked(4, 4), 3, 5), resizeSheet(marked(8, 4), sheet84, 3, 5), resizeCanvas(marked(4, 4), 6, 3, 'center'), resizeCanvasSheet(marked(8, 4), sheet84, 6, 3, 'bottom')];
  check('B15: every function that makes an image returns its data as a Uint8ClampedArray (what new ImageData needs), of exactly width by height by 4 bytes', made.every((o) => o.data instanceof Uint8ClampedArray && o.data.length === o.width * o.height * 4));
  const t0 = performance.now(); resizeImage(marked(1024, 1024), 4096, 4096); resizeImage(marked(4096, 1024), 512, 128);
  const ms = performance.now() - t0;
  const big = [];
  for (const [w, h, nw, nh] of [[512, 512, 300, 300], [300, 257, 1000, 999], [4096, 8, 4095, 5], [257, 3, 900, 2], [1024, 1024, 4096, 1], [3000, 2, 4096, 3]]) {
    const src = indexed(w, h); const wrong = exactCopy(src, resizeImage(src, nw, nh)); if (wrong.length) big.push({ w, h, nw, nh, wrong });
  }
  check('B12: every pixel is the one source pixel the mapping names, at sizes far over 256 px (each pixel carries its own 32-bit index)', big.length === 0, big.slice(0, 2));
  check('B11: 1024 px to 4096 px and a 4096 px sheet down, in under 3 seconds together', ms < 3000, Math.round(ms));
}

// ---- C. a sheet, frame by frame ----
{
  // Frames of 5 by 5 px; a frame's pixels carry the frame's number in B.
  const cols = 3, rows = 2, fw = 5, fh = 5;
  const sheet = marked(fw * cols, fh * rows);
  for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) sheet.data[(y * sheet.width + x) * 4 + 2] = Math.floor(y / fh) * cols + Math.floor(x / fw);
  const grid = { frameWidth: fw, frameHeight: fh, columns: cols, rows };
  const small = resizeSheet(sheet, grid, 3, 2);
  let own = true;
  for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) if (px(small, x, y)[2] !== Math.floor(y / 2) * cols + Math.floor(x / 3)) own = false;
  check('C1: an uneven frame size takes no pixel from a neighbouring frame', own && small.width === 9 && small.height === 4);
  // The one mapping is the same frame by frame as on the whole image at the
  // sheet's total size: ceil(f * S + x) is f * S + ceil(x). So no frame
  // takes a neighbour's pixel whichever way a door resizes a sheet.
  const mismatch = [];
  for (const [c, r, w, h] of [[3, 2, 5, 5], [4, 1, 99, 99], [2, 3, 7, 11], [5, 5, 16, 16], [1, 4, 30, 42]]) {
    const s = marked(w * c, h * r);
    for (const [nw, nh] of [[1, 1], [3, 2], [w - 1, h + 1], [w * 2, h * 3], [Math.max(1, Math.floor(w / 3)), 13], [37, 5]]) {
      if (!equalImages(resizeSheet(s, { frameWidth: w, frameHeight: h, columns: c, rows: r }, nw, nh), resizeImage(s, nw * c, nh * r))) mismatch.push([c, r, w, h, nw, nh]);
    }
  }
  check('C2: frame by frame is the same as the whole image at the sheet\'s total size, for every frame size tried', mismatch.length === 0, mismatch.slice(0, 3));
  check('C3: a grid of one frame is resizeImage', equalImages(resizeSheet(sheet, { frameWidth: 15, frameHeight: 10, columns: 1, rows: 1 }, 7, 3), resizeImage(sheet, 7, 3)));
  const up2 = resizeSheet(sheet, grid, 10, 10);
  check('C4: a whole factor up on a sheet is the same as on the whole image', equalImages(up2, resizeImage(sheet, 30, 20)));
  const wide = indexed(600, 300); const wideGrid = { frameWidth: 300, frameHeight: 300, columns: 2, rows: 1 };
  const wideOut = resizeSheet(wide, wideGrid, 299, 301);
  let wideOwn = true;
  for (let y = 0; y < wideOut.height; y++) for (let x = 0; x < wideOut.width; x++) { const i = indexAt(wideOut, x, y); if (Math.floor((i % 600) / 300) !== Math.floor(x / 299)) wideOwn = false; }
  check('C6: frames over 256 px: every pixel the mapped one, and none from the neighbouring frame', exactCopy(wide, wideOut).length === 0 && wideOwn);
  const sheetBefore = freeze(sheet);
  const sameSheet = resizeSheet(sheet, grid, fw, fh);
  check('C7: at the same frame size a sheet comes back as a new image with the same pixels, and the sheet given is never changed', equalImages(sameSheet, sheet) && sameSheet !== sheet && sameSheet.data !== sheet.data && equalImages(sheet, sheetBefore));
  check('C8: it refuses a new frame size under 1 or not whole', throws(() => resizeSheet(sheet, grid, 0, 2)) && throws(() => resizeSheet(sheet, grid, 2, 1.5)) && throws(() => resizeSheet(sheet, grid, -3, 2)));
  check('C5: it refuses a grid that does not fill the image exactly', throws(() => resizeSheet(sheet, { frameWidth: 4, frameHeight: 5, columns: 3, rows: 2 }, 2, 2)) && throws(() => resizeSheet(sheet, { frameWidth: 5, frameHeight: 5, columns: 3, rows: 1 }, 2, 2)));
}

// ---- D. the choices, their words, the caps ----
{
  const c396 = sizeChoices(396, 396, EDITOR_SIDE_CAP);
  check('D1: 396 px offers as is, half, a third, a quarter, a sixth, then 2x, 4x, 8x (the dialog drawn in mockups-v4)', same(c396.map((c) => sizeChoiceLabel(c)), ['396 px, as is', '198 px, half', '132 px, a third', '99 px, a quarter', '66 px, a sixth', '2x', '4x', '8x']));
  check('D2: under the editor\'s 1024 px cap, 4x and 8x of 396 px are over it and 2x is not', same(c396.filter((c) => c.overCap).map((c) => c.factor), [4, 8]) && EDITOR_SIDE_CAP === 1024 && DOWNLOAD_SIDE_CAP === 4096);
  const c128 = sizeChoices(128, 128, DOWNLOAD_SIDE_CAP);
  check('D3: a download of 128 px frames reads "As made (128 px)", "64 px, half", "32 px, a quarter", "16 px, an eighth", 2x, 4x, 8x (the result card drawn in mockups-v4)', same(c128.map((c) => sizeChoiceLabel(c, 'download')), ['As made (128 px)', '64 px, half', '32 px, a quarter', '16 px, an eighth', '2x', '4x', '8x']));
  check('D4: a divisor is offered only if it leaves at least 8 px: 24 by 32 offers half only', same(sizeChoices(24, 32, 4096).filter((c) => c.direction === 'down').map((c) => sizeChoiceLabel(c)), ['12 by 16 px, half']));
  check('D5: 97 px has no clean smaller size; 16 px offers half (8 px) only; 7 px none', !hasCleanSmaller(97, 97) && same(sizeChoices(16, 16, 4096).filter((c) => c.direction === 'down').map((c) => c.width), [8]) && !hasCleanSmaller(7, 7) && hasCleanSmaller(396, 396));
  check('D6: a frame that is not square: only factors that divide both sides', same(sizeChoices(30, 42, 4096).filter((c) => c.direction === 'down').map((c) => c.factor), [2, 3]));
  check('D7: the cap counts the whole image: a 4 by 1 sheet of 256 px frames cannot go 8x under 4096, can go 4x (4096 exactly is allowed)', (() => { const c = sizeChoices(256, 256, 4096, 4, 1); return c.find((x) => x.factor === 4 && x.direction === 'up').overCap === false && c.find((x) => x.factor === 8 && x.direction === 'up').overCap === true && c.find((x) => x.factor === 8 && x.direction === 'down').overCap === false; })());
  check('D14: rows count toward the cap as columns do: a 1 by 4 sheet of 256 px frames cannot go 8x under 4096, can go 4x; a 2 by 3 sheet of 500 px frames can go 2x only (4x is 4000 wide but 6000 tall; AUDIT pixel-resize-l1 r2, R2-L2)', same(sizeChoices(256, 256, 4096, 1, 4).filter((c) => c.direction === 'up').map((c) => [c.factor, c.overCap]), [[2, false], [4, false], [8, true]]) && same(sizeChoices(500, 500, 4096, 2, 3).filter((c) => c.direction === 'up').map((c) => [c.factor, c.overCap]), [[2, false], [4, true], [8, true]]));
  check('D8: passesCap: a side equal to the cap fits, one pixel more does not; columns and rows multiply', passesCap(4096, 4096, 4096) && !passesCap(4097, 1, 4096) && passesCap(1024, 512, 4096, 4, 8) && !passesCap(1024, 513, 4096, 4, 8));
  check('D9: every fraction has its word, a fifth to an eighth', same([5, 6, 7, 8].map((k) => sizeChoiceLabel({ width: 10, height: 10, direction: 'down', factor: k, overCap: false })), ['10 px, a fifth', '10 px, a sixth', '10 px, a seventh', '10 px, an eighth']));
  check('D10: sizeText: "64 px" when square, "24 by 32 px" when not', sizeText(64, 64) === '64 px' && sizeText(24, 32) === '24 by 32 px' && sizeChoiceLabel(sizeChoices(24, 32, 4096)[0], 'download') === 'As made (24 by 32 px)');
  check('D13: 56 px offers half, a quarter and a seventh (an eighth would leave 7 px)', same(sizeChoices(56, 56, 4096).filter((c) => c.direction === 'down').map((c) => sizeChoiceLabel(c)), ['28 px, half', '14 px, a quarter', '8 px, a seventh']));
  check('D11: the choices refuse a start under 1 px', throws(() => sizeChoices(0, 4, 4096)) && throws(() => sizeChoices(4, 1.5, 4096)));
  const dash = String.fromCharCode(0x2014);
  check('D12: no em dash in any label', !c396.concat(c128).some((c) => sizeChoiceLabel(c).includes(dash) || sizeChoiceLabel(c, 'download').includes(dash)));
}

// ---- E. Other size ----
{
  check('E1: wholeFactor: the same factor on both sides, down or up, any whole number; otherwise null (two factors up, one side unchanged)', wholeFactor(64, 64, 128, 256) === null && wholeFactor(64, 64, 64, 32) === null && wholeFactor(64, 64, 128, 64) === null && same(wholeFactor(396, 396, 99, 99), { direction: 'down', factor: 4 }) && same(wholeFactor(30, 42, 10, 14), { direction: 'down', factor: 3 }) && same(wholeFactor(64, 64, 576, 576), { direction: 'up', factor: 9 }) && same(wholeFactor(64, 64, 64, 64), { direction: 'same', factor: 1 }) && wholeFactor(64, 64, 32, 16) === null && wholeFactor(64, 64, 32, 128) === null && wholeFactor(396, 396, 150, 150) === null);
  check('E2: classifySize: clean, uneven down, uneven up, and one side each way', classifySize(396, 396, 132, 132) === 'clean' && classifySize(396, 396, 150, 150) === 'uneven-down' && classifySize(64, 64, 100, 100) === 'uneven-up' && classifySize(64, 64, 32, 20) === 'uneven-down' && classifySize(64, 64, 64, 80) === 'uneven-up' && classifySize(64, 64, 64, 50) === 'uneven-down' && classifySize(64, 64, 50, 64) === 'uneven-down' && classifySize(64, 64, 30, 100) === 'uneven-mixed' && classifySize(64, 64, 64, 64) === 'clean');
  check('E10: both sides by a whole factor but not the same one is "stretched" (DESIGN -249): half the width and the same height, 2x one way and half the other; checked before the uneven kinds', classifySize(64, 64, 32, 64) === 'stretched' && classifySize(64, 64, 64, 32) === 'stretched' && classifySize(64, 64, 128, 64) === 'stretched' && classifySize(64, 64, 32, 128) === 'stretched' && classifySize(64, 64, 32, 16) === 'stretched' && classifySize(24, 32, 12, 8) === 'stretched' && classifySize(64, 64, 32, 32) === 'clean' && classifySize(64, 64, 32, 100) === 'uneven-mixed' && classifySize(64, 64, 32, 33) === 'uneven-down');
  check('E8: sizeChange gives each axis\'s truth: 64 by 64 to 64 by 32 is the same width and an exact half height; 128 by 64 an exact 2x width', same(sizeChange(64, 64, 64, 32), { width: { direction: 'same', exact: true, factor: 1 }, height: { direction: 'down', exact: true, factor: 2 } }) && same(sizeChange(64, 64, 128, 64).width, { direction: 'up', exact: true, factor: 2 }) && same(axisChange(396, 150), { direction: 'down', exact: false, factor: null }) && same(axisChange(64, 100), { direction: 'up', exact: false, factor: null }) && same(axisChange(14, 7), { direction: 'down', exact: true, factor: 2 }));
  const bad = [1.5, 0, -32, NaN, Infinity, '64', null, undefined];
  const loose = [];
  for (const v of bad) {
    for (const [name, fn] of [['passesCap', () => passesCap(v, 8, 4096)], ['passesCap cap', () => passesCap(8, 8, v)], ['passesCap rows', () => passesCap(8, 8, 4096, 1, v)], ['wholeFactor', () => wholeFactor(64, 64, v, v)], ['classifySize', () => classifySize(64, 64, v, 32)], ['classifySize start', () => classifySize(v, 64, 32, 32)], ['nearestCleanSizes', () => nearestCleanSizes(64, 64, v, v, 4096)], ['hasCleanSmaller', () => hasCleanSmaller(v, 8)], ['sizeChoices cap', () => sizeChoices(64, 64, v)], ['sizeChange', () => sizeChange(64, 64, 32, v)], ['canvasShare', () => canvasShare(10, v, 'center')]]) {
      if (v === undefined && name === 'passesCap rows') continue; // left out, rows is 1 by default
      if (!throws(fn)) loose.push(`${name}(${String(v)})`);
    }
  }
  check('E9: every helper refuses what the resize refuses (a fraction, 0, a negative, NaN, Infinity, a string, null) with a RangeError, and isWholeSize says so first', loose.length === 0 && bad.every((v) => !isWholeSize(v)) && isWholeSize(1) && isWholeSize(4096), loose);
  check('E3: 150 px of 396 px: the nearest clean sizes are 132 and 198 (the Other size dialog drawn in mockups-v4)', (() => { const n = nearestCleanSizes(396, 396, 150, 150, 1024); return n.smaller.width === 132 && n.larger.width === 198; })());
  check('E4: above the largest choice under the cap there is no larger; below the smallest, no smaller', (() => { const a = nearestCleanSizes(396, 396, 1000, 1000, 1024); const b = nearestCleanSizes(396, 396, 50, 50, 1024); return a.smaller.width === 792 && a.larger === null && b.smaller === null && b.larger.width === 66; })());
  check('E5: between the start and 2x, the start itself is the nearest smaller', nearestCleanSizes(64, 64, 100, 100, 4096).smaller.direction === 'same' && nearestCleanSizes(64, 64, 100, 100, 4096).larger.width === 128);
  check('E6: one side each way: the largest choice that fits inside it and the smallest that covers it', (() => { const n = nearestCleanSizes(64, 64, 32, 128, 4096); return n.smaller.width === 32 && n.larger.width === 128; })() && same(nearestCleanSizes(64, 64, 4, 9000, 4096), { smaller: null, larger: null }));
  check('E7: a choice over the cap is never offered as the nearest', nearestCleanSizes(396, 396, 900, 900, 1024).larger === null);
  // REV-L1: "inside" and "covers" hold on both sides, for a size of another shape than the start.
  check('E11: a choice that fits on one side only is not inside: 64 px to 40 by 20 and to 20 by 40 gives 16 px smaller (32 px is too tall, then too wide) and 64 px as is larger; 30 by 42 to 16 by 12 has no smaller (15 by 21 fits the width only)', (() => { const a = nearestCleanSizes(64, 64, 40, 20, 4096); const t = nearestCleanSizes(64, 64, 20, 40, 4096); const b = nearestCleanSizes(30, 42, 16, 12, 4096); return [a, t].every((n) => n.smaller !== null && n.smaller.width === 16 && n.smaller.height === 16 && n.larger !== null && n.larger.direction === 'same') && b.smaller === null && b.larger !== null && b.larger.direction === 'same'; })());
  // The comment read plainly: of the offered choices under the cap, other than the size itself, the widest that fits inside on both sides and the narrowest that covers it on both sides.
  const plainNearest = (sw, sh, w, h, cap, columns, rows) => {
    const offered = sizeChoices(sw, sh, cap, columns, rows).filter((c) => !c.overCap && !(c.width === w && c.height === h));
    const inside = offered.filter((c) => c.width <= w && c.height <= h).sort((p, q) => q.width - p.width);
    const covers = offered.filter((c) => c.width >= w && c.height >= h).sort((p, q) => p.width - q.width);
    return { smaller: inside[0] ?? null, larger: covers[0] ?? null };
  };
  const nearWrong = [];
  const sides = [1, 5, 8, 12, 16, 20, 31, 40, 48, 64, 100, 130, 200, 400, 800, 1600];
  for (const [sw, sh] of [[64, 64], [30, 42], [24, 32], [96, 48], [48, 96], [396, 396], [128, 64], [13, 13], [56, 56]]) for (const cap of [1024, 4096]) for (const [columns, rows] of [[1, 1], [4, 1], [1, 4], [2, 3]]) for (const w of sides) for (const h of sides) {
    const got = nearestCleanSizes(sw, sh, w, h, cap, columns, rows); const want = plainNearest(sw, sh, w, h, cap, columns, rows);
    if (!same(got, want)) nearWrong.push({ sw, sh, w, h, cap, columns, rows, got, want });
  }
  check('E12: nearestCleanSizes is the comment read plainly, for 9 starts, square and not, 2 caps, 4 sheet shapes (one image, 4 by 1, 1 by 4, 2 by 3) and 256 sizes of every shape each (18,432 cases)', nearWrong.length === 0, nearWrong.slice(0, 2));
  check('E13: on a sheet the cap counts the whole sheet: 4 columns of 256 px frames, Other size 1500, cap 4096: 1024 px smaller and no larger (2048 px frames would make an 8192 px sheet); one image of 256 px gets 2048 px larger', (() => { const s4 = nearestCleanSizes(256, 256, 1500, 1500, 4096, 4, 1); const one = nearestCleanSizes(256, 256, 1500, 1500, 4096); return s4.smaller !== null && s4.smaller.width === 1024 && s4.larger === null && one.larger !== null && one.larger.width === 2048; })());
}

// ---- F. Canvas size ----
{
  check('F1: 99 to 128 at the centre adds 14 on the left and 15 on the right (the dialog drawn in mockups-v4); an odd pixel goes after', same(canvasShare(99, 128, 'center'), { before: 14, after: 15 }) && same(canvasShare(10, 5, 'center'), { before: -2, after: -3 }) && same(canvasShare(10, 10, 'center'), { before: 0, after: 0 }));
  check('F2: at the start it all goes after; at the end, before', same(canvasShare(10, 16, 'start'), { before: 0, after: 6 }) && same(canvasShare(10, 4, 'end'), { before: -6, after: 0 }));
  const img = marked(4, 3);
  const bigger = resizeCanvas(img, 7, 5, 'center');
  check('F3: added space is transparent and the art keeps its pixels, at the anchor', bigger.width === 7 && bigger.height === 5 && px(bigger, 0, 0).join() === '0,0,0,0' && px(bigger, 1, 1).join() === '0,0,7,255' && px(bigger, 4, 3).join() === '3,2,7,255' && px(bigger, 5, 3).join() === '0,0,0,0');
  const tl = resizeCanvas(img, 6, 6, 'top-left'), br = resizeCanvas(img, 6, 6, 'bottom-right');
  check('F4: top-left keeps the art at the top left; bottom-right at the bottom right', px(tl, 0, 0).join() === '0,0,7,255' && px(tl, 4, 0)[3] === 0 && px(br, 2, 3).join() === '0,0,7,255' && px(br, 5, 5).join() === '3,2,7,255' && px(br, 1, 3)[3] === 0);
  const trimmed = resizeCanvas(img, 2, 1, 'center');
  check('F5: a trim at the centre keeps the middle', px(trimmed, 0, 0).join() === '1,1,7,255' && px(trimmed, 1, 0).join() === '2,1,7,255');
  const mixed = resizeCanvas(img, 6, 1, 'center');
  check('F6: one axis added and the other trimmed in one go', mixed.width === 6 && px(mixed, 0, 0)[3] === 0 && px(mixed, 1, 0).join() === '0,1,7,255' && px(mixed, 5, 0)[3] === 0);
  const sheet = marked(8, 4); const grid = { frameWidth: 4, frameHeight: 4, columns: 2, rows: 1 };
  const cs = resizeCanvasSheet(sheet, grid, 6, 4, 'left');
  check('F7: on a sheet every frame gets the same space, columns and rows kept', cs.width === 12 && cs.height === 4 && px(cs, 0, 0).join() === '0,0,7,255' && px(cs, 4, 0)[3] === 0 && px(cs, 6, 0).join() === '4,0,7,255' && px(cs, 11, 0)[3] === 0);
  // Art in columns 2 to 6 and rows 3 to 8 of a 10 by 10 image.
  const art = marked(10, 10, { clearIf: (x, y) => x < 2 || x > 6 || y < 3 || y > 8 });
  check('F8: trimCuts names the sides where a trim would cut art, and none when it cuts only clear pixels', same(trimCuts(art, 8, 10, 'center'), []) && same(trimCuts(art, 6, 10, 'center'), []) && same(trimCuts(art, 6, 10, 'left'), ['right']) && same(trimCuts(art, 6, 10, 'right'), ['left']) && same(trimCuts(art, 10, 6, 'top'), ['bottom']) && same(trimCuts(art, 10, 6, 'bottom'), ['top']) && same(trimCuts(art, 4, 4, 'center'), ['left', 'bottom']) && same(trimCuts(art, 1, 1, 'center'), ['left', 'right', 'top', 'bottom']) && same(trimCuts(art, 12, 12, 'center'), []));
  const sheet2 = marked(20, 10, { clearIf: (x) => x % 10 !== 9 });
  check('F9: on a sheet any frame counts: art at the right edge of each frame is cut by a trim on the right', same(trimCuts(sheet2, 8, 10, 'left', { frameWidth: 10, frameHeight: 10, columns: 2, rows: 1 }), ['right']) && same(trimCuts(sheet2, 8, 10, 'right', { frameWidth: 10, frameHeight: 10, columns: 2, rows: 1 }), []));
  const faint = marked(10, 10, { clearIf: () => true }); faint.data[(5 * 10 + 0) * 4 + 3] = 1;
  check('F11: a pixel that is only a little visible (alpha 1) still counts as art, at the very edge', same(trimCuts(faint, 9, 10, 'right'), ['left']) && same(trimCuts(faint, 9, 10, 'left'), []));
  const lastFrame = marked(30, 10, { clearIf: (x) => x !== 29 });
  check('F12: art in the last frame only is still found', same(trimCuts(lastFrame, 8, 10, 'left', { frameWidth: 10, frameHeight: 10, columns: 3, rows: 1 }), ['right']));
  const anchorsBad = ['Top-Left', 'centre', 'upper-left', '', 'middle', null];
  check('F13: the nine anchors, and nothing else: a misspelt one is refused, never read as the centre', same([...ANCHORS], ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']) && anchorsBad.every((a) => throws(() => anchorSides(a)) && throws(() => resizeCanvas(img, 5, 5, a)) && throws(() => trimCuts(img, 2, 2, a)) && throws(() => resizeCanvasSheet(sheet, grid, 5, 5, a))) && throws(() => canvasShare(4, 6, 'middle')));
  check('F14: anchorSides is the one mapping from an anchor to each axis, for a door wording B5\'s lines with canvasShare', same(ANCHORS.map((a) => { const s = anchorSides(a); return `${s.x}/${s.y}`; }), ['start/start', 'center/start', 'end/start', 'start/center', 'center/center', 'end/center', 'start/end', 'center/end', 'end/end']));
  const sheetB = freeze(sheet);
  const canvasSame = resizeCanvasSheet(sheet, grid, 4, 4, 'center');
  check('F15: Canvas size on a sheet at the same size gives a new image with the same pixels, and the sheet given is never changed', equalImages(canvasSame, sheet) && canvasSame.data !== sheet.data && equalImages(sheet, sheetB) && (() => { resizeCanvasSheet(sheet, grid, 7, 2, 'bottom-right'); return equalImages(sheet, sheetB); })());
  check('F16: Canvas size and trimCuts refuse a size under 1 or not whole, on an image and on a sheet', throws(() => resizeCanvas(img, 0, 3, 'center')) && throws(() => resizeCanvas(img, 3, 2.5, 'center')) && throws(() => resizeCanvasSheet(sheet, grid, 0, 4, 'center')) && throws(() => resizeCanvasSheet(sheet, grid, 4, 1.5, 'center')) && throws(() => trimCuts(img, 0, 2, 'center')) && throws(() => trimCuts(img, 2, -1, 'center')) && throws(() => trimCuts(sheet, 2, 2.5, 'center', grid)));
  check('F10: the image given is never changed, and a bad grid is refused', (() => { const b = freeze(img); resizeCanvas(img, 9, 9, 'center'); trimCuts(img, 2, 2, 'center'); return equalImages(b, img) && throws(() => resizeCanvasSheet(sheet, { frameWidth: 3, frameHeight: 4, columns: 2, rows: 1 }, 5, 5, 'center')); })());

  // REV-L1: sheets of two rows and more, every anchor, against a plain placement written here
  // (its own anchor table and its own rule for the odd pixel, not the library's helpers).
  const AXES = { 'top-left': ['s', 's'], top: ['c', 's'], 'top-right': ['e', 's'], left: ['s', 'c'], center: ['c', 'c'], right: ['e', 'c'], 'bottom-left': ['s', 'e'], bottom: ['c', 'e'], 'bottom-right': ['e', 'e'] };
  const offsetOf = (oldSize, newSize, at) => { const d = newSize - oldSize; return at === 's' ? 0 : at === 'e' ? d : Math.sign(d) * Math.floor(Math.abs(d) / 2); };
  // Every pixel opaque and its own (index + 1 in red, green and blue), so a clear pixel is never mistaken for art.
  // With `varied`, alpha runs through every value, 0 included, so Canvas size is seen to copy alpha and the colour under alpha 0 (AUDIT pixel-resize-l1 r1 L6, r2 R2-L3). Red, green and blue are never all 0, so no source pixel looks like added space.
  const tagged = (w, h, varied = false) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const v = i + 1; d[i * 4] = v & 255; d[i * 4 + 1] = (v >>> 8) & 255; d[i * 4 + 2] = (v >>> 16) & 255; d[i * 4 + 3] = varied ? (i * 37) % 256 : 255; } return { width: w, height: h, data: d }; };
  function plainCanvasSheet(image, g, fw, fh, anchor) {
    const [ax, ay] = AXES[anchor]; const ox = offsetOf(g.frameWidth, fw, ax), oy = offsetOf(g.frameHeight, fh, ay);
    const out = { width: fw * g.columns, height: fh * g.rows, data: new Uint8ClampedArray(fw * g.columns * fh * g.rows * 4) };
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.columns; c++) for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const sx = x - ox, sy = y - oy;
      if (sx < 0 || sy < 0 || sx >= g.frameWidth || sy >= g.frameHeight) continue;
      const s = ((r * g.frameHeight + sy) * image.width + c * g.frameWidth + sx) * 4, o = ((r * fh + y) * out.width + c * fw + x) * 4;
      for (let k = 0; k < 4; k++) out.data[o + k] = image.data[s + k];
    }
    return out;
  }
  const placeWrong = []; let placed = 0;
  for (const [frameWidth, frameHeight] of [[5, 4], [4, 7]]) for (let columns = 1; columns <= 3; columns++) for (let rows = 1; rows <= 4; rows++) {
    const g = { frameWidth, frameHeight, columns, rows }; const src = tagged(frameWidth * columns, frameHeight * rows, true);
    for (const anchor of ANCHORS) for (let dw = -3; dw <= 3; dw++) for (let dh = -3; dh <= 3; dh++) {
      placed++;
      if (!equalImages(resizeCanvasSheet(src, g, frameWidth + dw, frameHeight + dh, anchor), plainCanvasSheet(src, g, frameWidth + dw, frameHeight + dh, anchor))) placeWrong.push({ g, anchor, fw: frameWidth + dw, fh: frameHeight + dh });
    }
  }
  check(`F17: Canvas size on sheets of 1 to 4 rows and 1 to 3 columns (a strip and a single frame included), at all nine anchors, each side grown or trimmed by up to 3 px (${placed} sheets): every frame is placed by its own anchor and takes nothing from the frame below or beside, as a plain placement does it`, placeWrong.length === 0, placeWrong.slice(0, 2));
  const tall = resizeCanvasSheet(tagged(2, 4), { frameWidth: 2, frameHeight: 2, columns: 1, rows: 2 }, 2, 4, 'top');
  const low = resizeCanvasSheet(tagged(2, 4), { frameWidth: 2, frameHeight: 2, columns: 1, rows: 2 }, 3, 3, 'bottom-right');
  check('F18: a frame made taller at the top gets clear space below it, not the frame under it; at the bottom right the art sits at the bottom right of each frame', [2, 3, 6, 7].every((y) => px(tall, 0, y)[3] === 0 && px(tall, 1, y)[3] === 0) && px(tall, 0, 4).join() === '5,0,0,255' && px(low, 0, 0)[3] === 0 && px(low, 1, 1).join() === '1,0,0,255' && px(low, 2, 2).join() === '4,0,0,255' && px(low, 1, 4).join() === '5,0,0,255' && px(low, 0, 3)[3] === 0);
  // trimCuts read plainly: a pixel that is not fully clear is cut on a side if it lands past that side of the new frame.
  function plainCuts(image, w, h, anchor, g) {
    const [ax, ay] = AXES[anchor]; const ox = offsetOf(g.frameWidth, w, ax), oy = offsetOf(g.frameHeight, h, ay); const cut = new Set();
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.columns; c++) for (let y = 0; y < g.frameHeight; y++) for (let x = 0; x < g.frameWidth; x++) {
      if (image.data[((r * g.frameHeight + y) * image.width + c * g.frameWidth + x) * 4 + 3] === 0) continue;
      if (x + ox < 0) cut.add('left'); if (x + ox >= w) cut.add('right'); if (y + oy < 0) cut.add('top'); if (y + oy >= h) cut.add('bottom');
    }
    return ['left', 'right', 'top', 'bottom'].filter((s) => cut.has(s));
  }
  // A 32-bit generator (Math.imul keeps every bit; AUDIT pixel-resize-l1 r1, L3), the high bits taken for the pick.
  let seed = 20261115; const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const cutWrong = []; let cutCases = 0;
  for (let columns = 1; columns <= 3; columns++) for (let rows = 1; rows <= 4; rows++) for (let fill = 0; fill < 10; fill++) {
    const g = { frameWidth: 6, frameHeight: 5, columns, rows }; const sparse = marked(6 * columns, 5 * rows, { clearIf: () => true });
    // One to three marks, each in a frame picked at random, at any alpha above 0.
    for (let n = 1 + rnd(3); n > 0; n--) sparse.data[(rnd(5 * rows) * sparse.width + rnd(6 * columns)) * 4 + 3] = 1 + rnd(255);
    for (const anchor of ANCHORS) for (let w = 3; w <= 7; w++) for (let h = 2; h <= 6; h++) {
      cutCases++;
      if (!same(trimCuts(sparse, w, h, anchor, g), plainCuts(sparse, w, h, anchor, g))) cutWrong.push({ g, anchor, w, h, got: trimCuts(sparse, w, h, anchor, g), want: plainCuts(sparse, w, h, anchor, g) });
    }
  }
  check(`F19: trimCuts on sparse sheets of 1 to 4 rows and 1 to 3 columns, at all nine anchors, trimming and growing (${cutCases} cases): the sides named are exactly those where art would be cut, in any frame of any row`, cutWrong.length === 0, cutWrong.slice(0, 2));
  const lastRow = marked(20, 30, { clearIf: (x, y) => !(x === 13 && y === 29) });
  check('F20: art in a frame of the last row only, at its bottom edge, is still found; trimmed from the top instead, nothing is cut', same(trimCuts(lastRow, 10, 8, 'top', { frameWidth: 10, frameHeight: 10, columns: 2, rows: 3 }), ['bottom']) && same(trimCuts(lastRow, 10, 8, 'bottom', { frameWidth: 10, frameHeight: 10, columns: 2, rows: 3 }), []));
  // AUDIT pixel-resize-l1 r1, M1: one image through resizeCanvas, at every anchor, against the same plain placement.
  const oneWrong = []; let oneCases = 0;
  for (const [w, h] of [[5, 4], [4, 7], [1, 1], [6, 6], [3, 2]]) {
    const src = tagged(w, h, true); const g = { frameWidth: w, frameHeight: h, columns: 1, rows: 1 };
    for (const anchor of ANCHORS) for (let dw = -3; dw <= 3; dw++) for (let dh = -3; dh <= 3; dh++) {
      if (w + dw < 1 || h + dh < 1) continue;
      oneCases++;
      if (!equalImages(resizeCanvas(src, w + dw, h + dh, anchor), plainCanvasSheet(src, g, w + dw, h + dh, anchor))) oneWrong.push({ w, h, anchor, nw: w + dw, nh: h + dh });
    }
  }
  check(`F21: Canvas size on one image, at all nine anchors, each side grown or trimmed by up to 3 px (${oneCases} cases): placed as a plain placement does it, alpha and all`, oneWrong.length === 0, oneWrong.slice(0, 2));
}

// ---- G. the rows and columns picker ----
{
  const g = wholeGrids(12, 8);
  check('G1: wholeGrids gives every pair of counts that divides both sides, 1 by 1 left out', g.length === 6 * 4 - 1 && !g.some((x) => x.columns === 1 && x.rows === 1) && g.every((x) => 12 % x.columns === 0 && 8 % x.rows === 0) && same(g[0], { columns: 1, rows: 2 }));
  check('G2: a prime side has columns 1 and itself only', wholeGrids(97, 1).length === 1 && same(wholeGrids(97, 1)[0], { columns: 97, rows: 1 }));
}

// ---- H. the library stays pure ----
{
  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/pixelResize.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const named = lib.match(/\b(?:import|require|window|document|globalThis|self|localStorage|sessionStorage|fetch|XMLHttpRequest|navigator|process|eval|Function|setTimeout|setInterval|console|prototype|addEventListener|drawImage|getContext|OffscreenCanvas|imageSmoothingEnabled|Math\.random|Date)\b/g) ?? [];
  check('H1: the library imports nothing, names nothing outside itself, never draws on a canvas', named.length === 0, [...new Set(named)]);
  const topLevel = lib.split('\n').filter((l) => /^(?:export )?(?:let|var|class) /.test(l));
  const consts = lib.split('\n').filter((l) => /^(?:export )?const /.test(l)).filter((l) => !/= (?:\d+;|Object\.freeze\(|\([^)]*\)(?:: [\w<>|' ]+)? =>)/.test(l));
  check('H2: it keeps no state between calls: no top-level let, var or class, and every top-level const is a number, a frozen table or a function', topLevel.length === 0 && consts.length === 0, [...topLevel, ...consts]);
  check('H3: its patterns have no look-behind and it uses no floating-point rounding in the mapping', !/\(\?<[=!]/.test(lib) && /Math\.floor\(\(a \+ b - 1\) \/ b\) - 1/.test(lib));
  const message = (fn) => { try { fn(); return null; } catch (e) { return `${e.constructor.name}: ${e.message}`; } };
  // The keys in another order, so this bad grid does not share H7's object shape (shared, it slows H7's copy several times over; AUDIT pixel-resize-l1 r1, L4).
  const mCount = message(() => resizeSheet(marked(4, 4), { columns: 1.5, rows: 1, frameWidth: 4, frameHeight: 4 }, 2, 2));
  const mString = message(() => resizeImage(marked(2, 2), '64', 4));
  const mNull = message(() => resizeImage(null, 4, 4));
  const mNoData = message(() => resizeImage({ width: 2, height: 2 }, 4, 4));
  check('H6: the errors say what is wrong: a count is "a whole number", not pixels; a string is shown quoted; a missing image or data is a RangeError, as the doc says', /columns must be a whole number, at least 1/.test(mCount) && !/columns[^)]*pixels/.test(mCount) && /\(got "64"\)/.test(mString) && /^RangeError/.test(mNull ?? '') && /^RangeError/.test(mNoData ?? ''), [mCount, mString, mNull, mNoData]);
  // Both paths warmed, then sheet and image in turn, best of five each, so load and the JIT slow both alike.
  const bigSheet = marked(2048, 2048);
  const sheetRun = () => resizeSheet(bigSheet, { frameWidth: 1, frameHeight: 1, columns: 2048, rows: 2048 }, 1, 1);
  const imageRun = () => resizeImage(bigSheet, 2048, 2048);
  sheetRun(); imageRun();
  let sheetMs = Infinity, imageMs = Infinity;
  for (let k = 0; k < 5; k++) {
    let t = performance.now(); sheetRun(); sheetMs = Math.min(sheetMs, performance.now() - t);
    t = performance.now(); imageRun(); imageMs = Math.min(imageMs, performance.now() - t);
  }
  check('H7: a sheet of 1 px frames is as quick as one image: 2048 by 2048 frames, warmed, best of five taken in turn, within 3 times one 2048 px image plus 40 ms, and under a second', sheetMs < 3 * imageMs + 40 && sheetMs < 1000, [Math.round(sheetMs), Math.round(imageMs)]);
  check('H4: no em dash in the library', !fs.readFileSync(path.join(ROOT, 'src/lib/pixelResize.ts'), 'utf8').includes(String.fromCharCode(0x2014)));
  check('H5: every export is a function, a number or a frozen list', Object.entries(R).every(([, v]) => typeof v === 'function' || typeof v === 'number' || (Array.isArray(v) && Object.isFrozen(v))));
}

console.log(failed === 0 ? '\nall pass' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
