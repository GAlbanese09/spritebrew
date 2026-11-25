// scripts/editor-batch2-test.mjs
//
// Offline tests for three of the outside audit's editor findings
// (audit/external/product-audit-r2-2026-11-24.xlsx; HQ 2026-11-25-019 item
// 3), each acceptance check written as a case:
// - SB-27: a cancelled stroke, or one that changes nothing (erasing an
//   empty pixel), keeps Redo; a stroke that changes pixels starts a new
//   branch, as before;
// - SB-29: the phone's Colors sheet, closed, is out of the tab order, and
//   opening and closing it moves the focus in and back to the Colors button;
//   open, it keeps the keyboard: Escape closes it alone and Tab stays in it
//   (AUDIT editor batch 2 r1, L1 and L2);
// - SB-03: the Slicer grid's frame pencil can be reached from the keyboard
//   and says which frame it edits, and the focus comes back to it;
// - SB-28: the eyedropper keeps a pixel's opacity and paint writes it, with
//   "Opacity 38%" and "Make opaque" under the swatch (DESIGN 2026-11-25-034).
// The store cases run the real editor store (bundled with esbuild into
// local/.editor-batch2-test/, gitignored); the others read the components.
// Run from the repo root: `node scripts/editor-batch2-test.mjs`.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.editor-batch2-test');
fs.mkdirSync(DIR, { recursive: true });
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
const OUT = path.join(DIR, 'store.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/components/sprites/editorStore.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
});
const { useEditorStore, selectCanRedo, selectCanUndo } = await import(pathToFileURL(OUT).href);
const WORDS = path.join(DIR, 'words.mjs');
fs.writeFileSync(path.join(DIR, 'words-entry.mjs'),
  `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/editorCopy.ts'))};\n` +
  `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/colorUtils.ts'))};\n` +
  (fs.existsSync(path.join(ROOT, 'src/lib/focusTrap.ts')) ? `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/focusTrap.ts'))};\n` : ''));
await build({
  entryPoints: [path.join(DIR, 'words-entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: WORDS, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
});
const W = await import(pathToFileURL(WORDS).href);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const S = () => useEditorStore.getState();
const pix = () => Array.from(S().pixels);

// A 32 by 32 picture, all see-through, as a blank canvas.
function fresh() {
  S().reset();
  S().loadFrame('f1', new Uint8ClampedArray(32 * 32 * 4), 32, 32, { kind: 'blank' });
}
// One stroke of amber pixels, as the canvas makes one.
function draw(points) {
  S().beginStroke();
  for (const [x, y] of points) S().paintPixel(x, y, '#d4871c');
  S().endStroke();
}

// ---- SB-27: Redo survives a cancelled or empty gesture ----
{
  fresh();
  draw([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  draw([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]);
  draw([[0, 2], [1, 2], [2, 2], [3, 2]]);
  const all = pix();
  S().undo();
  const redoBefore = selectCanRedo(S());
  // A cancelled stroke (a gesture the browser took over, a second finger).
  S().beginStroke();
  S().paintPixel(10, 10, '#ff0000');
  S().cancelStroke();
  check('SB-27 Undo one, then a cancelled stroke: Redo is still on', redoBefore && selectCanRedo(S()), { redoBefore, after: selectCanRedo(S()) });
  S().redo();
  check('SB-27 and Redo brings back the undone edit exactly', same(pix(), all));
}
{
  fresh();
  draw([[0, 0], [1, 0]]);
  draw([[0, 1], [1, 1]]);
  draw([[0, 2], [1, 2]]);
  const all = pix();
  S().undo(); S().undo();
  const index = S().historyIndex;
  const stack = S().historyStack.length;
  const rev = S().revision;
  // Erasing a pixel that is already clear changes nothing.
  S().beginStroke();
  S().erasePixel(20, 20);
  S().endStroke();
  check('SB-27 Undo two, then erasing an empty pixel: Redo is still on, and no step is added',
    selectCanRedo(S()) && S().historyIndex === index && S().historyStack.length === stack && S().revision === rev,
    { canRedo: selectCanRedo(S()), index: S().historyIndex, stack: S().historyStack.length });
  S().redo(); S().redo();
  check('SB-27 and two Redos bring back both edits exactly', same(pix(), all));
}
{
  fresh();
  draw([[0, 0]]);
  draw([[1, 0]]);
  S().undo();
  // Painting a pixel the colour it already is changes nothing either.
  S().beginStroke();
  S().paintPixel(0, 0, '#d4871c');
  S().endStroke();
  check('SB-27 a stroke that paints a pixel its own colour keeps Redo and adds no step', selectCanRedo(S()) && S().historyIndex === 1 && S().historyStack.length === 3);
}
{
  fresh();
  draw([[0, 0]]);
  draw([[1, 0]]);
  S().undo();
  draw([[5, 5]]);
  check('SB-27 a stroke that changes pixels still starts a new branch: Redo off, one step added',
    !selectCanRedo(S()) && S().historyIndex === 2 && S().historyStack.length === 3 && selectCanUndo(S()));
  S().undo();
  check('SB-27 and Undo from there goes back past the new stroke only', S().pixels[5 * 32 * 4 + 5 * 4 + 3] === 0 && S().pixels[3] === 255 && S().pixels[7] === 0);
}
{
  // At the cap: 50 steps kept; an empty stroke there adds none.
  fresh();
  for (let i = 0; i < 60; i++) draw([[i % 32, Math.floor(i / 32)]]);
  const len = S().historyStack.length;
  S().undo();
  S().beginStroke(); S().erasePixel(31, 31); S().endStroke();
  check('SB-27 at the 50-step cap, an empty stroke after Undo keeps Redo', len === 50 && selectCanRedo(S()) && S().historyStack.length === 50);
}

{
  // A cancelled stroke is still an attempted edit (the unsaved-changes
  // question must not be skipped), and a stroke that changes only the very
  // last byte of the picture is a real edit.
  fresh();
  S().beginStroke(); S().paintPixel(3, 3, '#ff0000'); S().cancelStroke();
  const attempted = S().hasAttemptedEdit;
  S().beginStroke(); S().paintPixel(31, 31, '#00000001'); S().endStroke();
  check('SB-27 a cancelled stroke still counts as an attempted edit; a change to the last byte alone adds a step',
    attempted === true && S().historyIndex === 1 && S().pixels[32 * 32 * 4 - 1] === 1, { attempted, index: S().historyIndex });
}

// ---- SB-29: the closed Colors sheet is out of the tab order ----
const body = fs.readFileSync(path.join(ROOT, 'src/components/sprites/PixelEditorBody.tsx'), 'utf8');
const sheetAt = body.indexOf('aria-label="Colors"\n      aria-hidden={!sheetOpen}');
const sheet = sheetAt >= 0 ? body.slice(sheetAt - 200, sheetAt + 400) : '';
check('SB-29 the Colors sheet is inert while closed, so nothing in it takes the focus', /inert=\{!sheetOpen\}/.test(sheet), sheet.length);
check('SB-29 opening the sheet moves the focus into it', /if \(sheetOpen\) \{[\s\S]{0,120}colorsSheetRef\.current\?\.focus\(\);/.test(body) && /ref=\{colorsSheetRef\}/.test(body));
check('SB-29 closing it (Done, Escape, the backdrop) gives the focus back to the Colors button', /colorsTriggerRef/.test(body) && /colorsTriggerRef\.current\?\.focus\(/.test(body));

// ---- AUDIT editor batch 2 r1, L1 and L2: the open sheet keeps the keyboard ----
check('L2 the sheet has a Tab order of its own (tabbableIn, nextTrapIndex)', typeof W.nextTrapIndex === 'function' && typeof W.tabbableIn === 'function');
if (typeof W.nextTrapIndex === 'function') {
  const n = W.nextTrapIndex;
  check('L2 Tab from the last control goes to the first, Shift+Tab from the first to the last', n(5, 4, false) === 0 && n(5, 0, true) === 4);
  check('L2 from the sheet itself (or from outside it) Tab goes to the first control and Shift+Tab to the last', n(5, -1, false) === 0 && n(5, -1, true) === 4);
  check('L2 in between, one step each way; one control keeps it; nothing to focus, nowhere',
    n(5, 2, false) === 3 && n(5, 2, true) === 1 && n(1, 0, false) === 0 && n(1, 0, true) === 0 && n(0, -1, false) === -1);
}
const keysAt = body.indexOf('keeps the keyboard');
const keys = keysAt >= 0 ? body.slice(keysAt, keysAt + 1600) : '';
check('L1 while the sheet is open its keys are caught first (on the window, in capture), and only keys aimed at the sheet or the page',
  /addEventListener\('keydown', onKey, true\)/.test(keys) && /sheet\.contains\(/.test(keys) && /document\.body/.test(keys), keys.length);
check('L1 Escape closes the sheet alone: the frame editor\'s Dialog never sees it',
  /e\.key === 'Escape'\) \{[\s\S]{0,40}e\.preventDefault\(\);[\s\S]{0,40}e\.stopPropagation\(\);[\s\S]{0,40}setSheetOpen\(false\)/.test(keys));
check('L2 Tab and Shift+Tab move within the sheet, and the browser does not move the focus as well',
  /tabbableIn\(sheet\)/.test(keys) && /nextTrapIndex\(/.test(keys) && /e\.shiftKey/.test(keys) && /e\.preventDefault\(\);\s*if \(next >= 0\) items\[next\]\.focus\(\);/.test(keys));
check('L1 the old listener, which let the frame editor close as well, is gone', !/if \(e\.key === 'Escape'\) setSheetOpen\(false\);/.test(body));

// ---- SB-03: the frame pencil from the keyboard ----
const grid = fs.readFileSync(path.join(ROOT, 'src/components/sprites/FrameGrid.tsx'), 'utf8');
const pencilAt = grid.indexOf('setEditingFrameId(frame.id);');
const pencil = pencilAt >= 0 ? grid.slice(pencilAt - 300, pencilAt + 900) : '';
check('SB-03 the pencil is never display:none on a fine pointer (Tab reaches it)', pencil.length > 0 && !/pointer-fine:hidden/.test(pencil), pencil.length);
check('SB-03 it shows when its frame has the keyboard focus, as on hover', /group-focus-within/.test(pencil));
check('SB-03 its name says which frame (Edit frame N)', /aria-label=\{`Edit frame \$\{idx \+ 1\}`\}/.test(pencil));
check('SB-03 closing the editor gives the focus back to that pencil', /pencilRefs/.test(grid) && /\.focus\(/.test(grid));

// ---- SB-28: the eyedropper keeps opacity ----
{
  // The audit's swatches: (32,128,200,96) and an opaque control.
  const px = new Uint8ClampedArray(32 * 32 * 4);
  px.set([32, 128, 200, 96], 0);
  px.set([10, 20, 30, 255], 4);
  S().reset();
  S().loadFrame('f1', px, 32, 32, { kind: 'upload' });
  const soft = S().eyedrop(0, 0);
  const hard = S().eyedrop(1, 0);
  const none = S().eyedrop(5, 5);
  check('SB-28 the eyedropper keeps a see-through pixel\'s opacity (#2080c860) and gives an opaque one as before (#0a141e)', soft === '#2080c860' && hard === '#0a141e', { soft, hard });
  check('SB-28 an empty pixel (opacity 0) picks nothing, so the paint stays as it was (DESIGN -034, rule 1)', none === null);
  S().beginStroke(); S().paintPixel(2, 0, soft); S().paintPixel(3, 0, hard); S().endStroke();
  const p = S().pixels;
  check('SB-28 painting with them writes all four channels as picked', same(Array.from(p.slice(8, 12)), [32, 128, 200, 96]) && same(Array.from(p.slice(12, 16)), [10, 20, 30, 255]), Array.from(p.slice(8, 16)));
  S().beginStroke(); S().paintPixel(2, 0, soft); S().endStroke();
  check('SB-28 see-through paint replaces, it does not blend: the same pixel painted twice is the same (DESIGN -034, rule 2)', same(Array.from(S().pixels.slice(8, 12)), [32, 128, 200, 96]));
  const one = S().eyedrop(0, 0);
  S().loadFrame('f1', Object.assign(new Uint8ClampedArray(32 * 32 * 4), {}).fill(0).map((v, i) => (i === 3 ? 1 : v)), 32, 32, { kind: 'upload' });
  check('SB-28 a pixel at opacity 1 of 255 is picked too (only 0 is empty)', S().eyedrop(0, 0) === '#00000001' && one === '#2080c860');
}
check('SB-28 the words: hexAlpha, opaqueHex, opacityLine, MAKE_OPAQUE_LABEL, colorControlName', ['hexAlpha', 'opaqueHex', 'opacityLine', 'colorControlName'].every((n) => typeof W[n] === 'function') && typeof W.MAKE_OPAQUE_LABEL === 'string');
if (typeof W.opacityLine === 'function' && typeof W.colorControlName === 'function') {
  check('SB-28 the alpha and the opaque colour of a paint', W.hexAlpha('#2080c860') === 96 && W.hexAlpha('#2080c8') === 255 && W.opaqueHex('#2080c860') === '#2080c8' && W.opaqueHex('#2080c8') === '#2080c8');
  check('SB-28 "Opacity 38%" for the audit\'s pixel, never 0% or 100% while see-through', W.opacityLine(96) === 'Opacity 38%' && W.opacityLine(1) === 'Opacity 1%' && W.opacityLine(254) === 'Opacity 99%');
  check('SB-28 "Make opaque", and the swatch\'s name adds the opacity only while see-through',
    W.MAKE_OPAQUE_LABEL === 'Make opaque' && W.colorControlName('Foreground color', 96) === 'Foreground color, opacity 38%' && W.colorControlName('Foreground color', 255) === 'Foreground color');
}
check('SB-28 both colour pickers show the opaque colour (a picker cannot hold opacity) and both places offer Make opaque',
  (body.match(/value=\{opaqueHex\(color\)\}/g) || []).length === 2 && (body.match(/\{MAKE_OPAQUE_LABEL\}/g) || []).length === 2 && (body.match(/onClick=\{\(\) => setColor\(opaqueHex\(color\)\)\}/g) || []).length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
