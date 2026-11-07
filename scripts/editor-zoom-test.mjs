// scripts/editor-zoom-test.mjs
//
// Offline tests for src/lib/editorZoom.ts, the editor's fit zoom (W2; George,
// Nov 4, 2026; HQ 2026-11-04-018, -023): the fitted zoom, the smallest zoom
// allowed, the zoom an image opens at, the zoom control's steps, label and
// menu height, the zoom shortcuts and the bare keys. Run from the
// repo root: `node scripts/editor-zoom-test.mjs`. Bundles the module with
// esbuild into local/.editor-zoom-test/ (gitignored). Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.editor-zoom-test', 'editorZoom.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/editorZoom.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  FIT_PAD_X, FIT_PAD_TOP, FIT_PAD_BOTTOM, MIN_ZOOM_FLOOR, ZOOM_STEPS, ZOOM_MENU_LEVELS,
  MENU_GAP, MENU_MARGIN, MENU_MIN_PX,
  fitZoom, fitPanY, minZoomFor, openingZoom, formatZoomPercent, nextZoomStep, zoomShortcut,
  isBrushKey, zoomAllowed, zoomMenuMaxHeight, ZOOM_NUMBER_KEYS, zoomNumberKey, layerRendering,
} = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 1. The fitted zoom.
{
  // Literal numbers (W2 audit F7): the image must clear the zoom control at
  // the bottom; a padding change shows up here, not only in derived values.
  check('pads: 16 at the sides and top, 60 at the bottom', FIT_PAD_X === 16 && FIT_PAD_TOP === 16 && FIT_PAD_BOTTOM === 60);
  check('fit: 1024 in 718 x 565 is exactly 489 / 1024', fitZoom(718, 565, 1024, 1024) === 489 / 1024);
  check('fit: the offset is 22 px up', fitPanY() === -22);
  check('fit: held room above the image moves it down by half', fitPanY(40) === -2 && fitPanY(44) === 0);
  // George's laptop: a 718 x 565 canvas area, a 1024 x 1024 sheet.
  const f = fitZoom(718, 565, 1024, 1024);
  check('fit: a 1024 sheet in 718 x 565 is the height-limited zoom', near(f, (565 - FIT_PAD_TOP - FIT_PAD_BOTTOM) / 1024), f);
  check('fit: the fitted sheet fits inside the padded area', 1024 * f <= 718 - 2 * FIT_PAD_X && 1024 * f <= 565 - FIT_PAD_TOP - FIT_PAD_BOTTOM);
  check('fit: the offset centres it above the zoom control (moves it up)', fitPanY() === -(FIT_PAD_BOTTOM - FIT_PAD_TOP) / 2 && fitPanY() < 0);
  const wide = fitZoom(1000, 1000, 400, 100);
  check('fit: a wide image is limited by width', near(wide, (1000 - 2 * FIT_PAD_X) / 400), wide);
  check('fit: a small frame fits at a large zoom', near(fitZoom(718, 565, 64, 64), (565 - FIT_PAD_TOP - FIT_PAD_BOTTOM) / 64));
  check('fit: unknown sizes give 0', [fitZoom(0, 565, 64, 64), fitZoom(718, 0, 64, 64), fitZoom(718, 565, 0, 64), fitZoom(718, 565, 64, 0), fitZoom(NaN, 565, 64, 64)].every((v) => v === 0));
  check('fit: an area smaller than the padding gives 0, never negative', fitZoom(20, 60, 64, 64) === 0);
}

// 2. The smallest zoom allowed.
{
  check('min: 1x when the image fits at 1x or more', minZoomFor(4.2) === 1 && minZoomFor(1) === 1);
  check('min: the fit when the image is too big for 1x', near(minZoomFor(0.458), 0.458));
  check('min: never below the floor', minZoomFor(0.001) === MIN_ZOOM_FLOOR);
  check('min: 1x when the fit is unknown', minZoomFor(0) === 1 && minZoomFor(NaN) === 1 && minZoomFor(-3) === 1);
}

// 3. The zoom an image opens at.
{
  check('open: the usual pick stays when the image fits at it', openingZoom(8, 8.5) === 8);
  check('open: a frame a little too big for the usual pick opens at the whole zoom below the fit', openingZoom(8, 7.3) === 7);
  check('open: the whole zoom is never under 4x on that path', openingZoom(16, 4.2) === 4);
  // W2 audit r2, finding 7: cases that separate the floor from rounding (a
  // rounded zoom would not fit: 8 > 7.6, 5 > 4.6).
  check('open: the whole zoom is the floor of the fit, never rounded up past it', openingZoom(8, 7.6) === 7 && openingZoom(16, 4.6) === 4 && openingZoom(12, 9.99) === 9);
  check('open: the usual pick stays when it fits exactly', openingZoom(4, 4) === 4);
  check('open: a sheet too big for the usual pick opens fitted', near(openingZoom(4, 0.458), 0.458));
  check('open: a 256 sheet on a laptop opens fitted, not at 4x', near(openingZoom(4, 1.82), 1.82));
  check('open: the usual pick when the fit is unknown', openingZoom(6, 0) === 6 && openingZoom(6, NaN) === 6);
  check('open: never below the floor', openingZoom(4, 0.0001) === MIN_ZOOM_FLOOR);
}

// 4. The control's label.
{
  check('label: a whole percentage', formatZoomPercent(4) === '400%' && formatZoomPercent(0.458) === '46%' && formatZoomPercent(1) === '100%' && formatZoomPercent(11.24) === '1124%');
}

// 5. The control's steps.
{
  check('steps: powers of two from 25% to 3,200%', ZOOM_STEPS.join() === '0.25,0.5,1,2,4,8,16,32');
  check('steps: the menu lists 50% to 1,600%', ZOOM_MENU_LEVELS.join() === '0.5,1,2,4,8,16');
  check('steps: plus from 400% is 800%', nextZoomStep(4, 1, 0.46, 0.46, 32) === 8);
  check('steps: minus from 400% is 200%', nextZoomStep(4, -1, 0.46, 0.46, 32) === 2);
  check('steps: plus from the fit is the next power of two', nextZoomStep(0.46, 1, 0.46, 0.46, 32) === 0.5);
  check('steps: minus from 50% stops at the fit, not below', nextZoomStep(0.5, -1, 0.46, 0.46, 32) === 0.46);
  check('steps: minus at the fit stays', nextZoomStep(0.46, -1, 0.46, 0.46, 32) === 0.46);
  check('steps: plus at the top stays', nextZoomStep(32, 1, 0.46, 0.46, 32) === 32);
  check('steps: from a pinched 7.3x, plus is 800% and minus 400%', nextZoomStep(7.3, 1, 0.46, 0.46, 32) === 8 && nextZoomStep(7.3, -1, 0.46, 0.46, 32) === 4);
  check('steps: a zoom a hair off a step counts as on it', nextZoomStep(3.99, 1, 0.46, 0.46, 32) === 8 && nextZoomStep(4.01, -1, 0.46, 0.46, 32) === 2);
  check('steps: a small frame (fit 9.2, min 1) passes the fit between 8 and 16', nextZoomStep(8, 1, 9.2, 1, 32) === 9.2 && nextZoomStep(9.2, 1, 9.2, 1, 32) === 16);
  check('steps: with no fit known, the powers of two', nextZoomStep(1, 1, 0, 1, 32) === 2 && nextZoomStep(1, -1, 0, 1, 32) === 1);
  // W2 audit r2, finding 11: the menu offers only levels the zoom can reach.
  check('allowed: a level below the fit is not offered (50% with the fit at 70%)', zoomAllowed(0.5, 0.7, 32) === false && zoomAllowed(1, 0.7, 32) === true);
  check('allowed: the ends count, with a hair of tolerance', zoomAllowed(0.7, 0.7, 32) && zoomAllowed(32, 0.7, 32) && zoomAllowed(0.7 - 1e-12, 0.7, 32) && !zoomAllowed(32.01, 0.7, 32));
  check('allowed: every menu level is offered when the fit is 50% or less', ZOOM_MENU_LEVELS.every((l) => zoomAllowed(l, minZoomFor(0.46), 32)));
}

// 5b. The menu's height (W2 audit r2, finding 3).
{
  check('menu: the gap, the margin and the least height are 8, 8 and 44 px', MENU_GAP === 8 && MENU_MARGIN === 8 && MENU_MIN_PX === 44);
  // A phone in landscape: the canvas area starts at y 80, the control's top
  // is at y 234 (the audit's 212 px area); the menu gets 234 - 80 - 16 = 138.
  check('menu: capped to the room above the control', zoomMenuMaxHeight(80, 234) === 138);
  check('menu: whole pixels, rounded down', zoomMenuMaxHeight(80.4, 234.9) === 138);
  check('menu: never less than one 44 px row', zoomMenuMaxHeight(100, 150) === 44 && zoomMenuMaxHeight(0, 0) === 44);
  // An iPhone 13 in landscape on /editor: 91 px between the area's top and
  // the control's; the menu gets 75 px and scrolls, inside the area.
  check('menu: less than two rows of room is used as it is', zoomMenuMaxHeight(133, 224) === 75);
  check('menu: an unknown size gives the least height', zoomMenuMaxHeight(NaN, 200) === 44);
  check('menu: a laptop has room for the whole menu (about 245 px tall)', zoomMenuMaxHeight(60, 740) >= 245);
}

// 6. The shortcuts.
{
  const k = (key, o = {}) => zoomShortcut({ key, metaKey: false, ctrlKey: false, altKey: false, ...o });
  check('keys: Cmd or Ctrl with = or + zooms in', k('=', { metaKey: true }) === 'in' && k('+', { ctrlKey: true }) === 'in');
  check('keys: with - or _ zooms out', k('-', { ctrlKey: true }) === 'out' && k('_', { metaKey: true }) === 'out');
  check('keys: Cmd or Ctrl with 0 fits', k('0', { metaKey: true }) === 'fit' && k('0', { ctrlKey: true }) === 'fit');
  // George, Nov 4: Chrome keeps Cmd+1 (its first tab), so a number with Cmd
  // or Ctrl is left to the browser; the number keys alone zoom, as in
  // Aseprite (HQ 2026-11-04-050).
  check('keys: Cmd or Ctrl with a number is left to the browser', ['1', '2', '3', '4', '5', '6', '9'].every((n) => k(n, { metaKey: true }) === null && k(n, { ctrlKey: true }) === null));
  check('keys: the number keys alone are Aseprite\'s levels, 1 to 6 for 100% to 3200%', k('1') === 1 && k('2') === 2 && k('3') === 4 && k('4') === 8 && k('5') === 16 && k('6') === 32);
  check('keys: 0, 7, 8 and 9 alone do nothing', ['0', '7', '8', '9'].every((n) => k(n) === null));
  check('keys: Shift+0 is 100% on any layout (by the key\'s place), other Shift+numbers nothing', k(')', { shiftKey: true, code: 'Digit0' }) === 1 && k('0', { shiftKey: true, code: 'Digit0' }) === 1 && k('!', { shiftKey: true, code: 'Digit1' }) === null);
  check('keys: the number table and the menu agree', Object.keys(ZOOM_NUMBER_KEYS).join() === '1,2,3,4,5,6' && zoomNumberKey(1) === '1' && zoomNumberKey(16) === '5' && zoomNumberKey(0.5) === null && ZOOM_MENU_LEVELS.filter((l) => zoomNumberKey(l)).length === 5);
  check('keys: without Cmd or Ctrl the brush keys are not zoom keys', ['=', '+', '-', '_', '[', ']'].every((key) => k(key) === null));
  check('keys: Alt combinations are left alone', k('0', { metaKey: true, altKey: true }) === null && k('2', { altKey: true }) === null);
  check('keys: other keys nothing', k('z', { ctrlKey: true }) === null && k('o') === null);
  // W2 audit r2, finding 1, and REV on #46, P2 a and P3 a: a press that is a
  // zoom shortcut never also changes the brush size, on any layout.
  const e = (key, o = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
  check('brush: bare [ ] - = and + (Shift with = on a US layout) change the brush', ['[', ']', '-', '='].every((key) => isBrushKey(e(key))) && isBrushKey(e('+', { shiftKey: true, code: 'Equal' })) && isBrushKey(e('+', { code: 'BracketRight' })));
  check('brush: Cmd or Ctrl with = + - is a zoom key, not a brush key', ['=', '+', '-', '_'].every((key) => ['metaKey', 'ctrlKey'].every((mod) => k(key, { [mod]: true }) !== null && !isBrushKey(e(key, { [mod]: true })))));
  check('brush: Shift+0 where it types "=" (German and others) is 100%, not a brush key', k('=', { shiftKey: true, code: 'Digit0' }) === 1 && !isBrushKey(e('=', { shiftKey: true, code: 'Digit0' })));
  check('brush: [ and ] with Option, or with AltGr (Ctrl and Alt), still change the brush', isBrushKey(e('[', { altKey: true })) && isBrushKey(e(']', { altKey: true, ctrlKey: true })));
  check('brush: Cmd+[ and a plain Ctrl+[ do not', !isBrushKey(e('[', { metaKey: true })) && !isBrushKey(e('[', { ctrlKey: true })));
  check('brush: no number key is a brush key, and no brush key a zoom key', ['1', '2', '3', '4', '5', '6'].every((n) => !isBrushKey(e(n))) && ['[', ']', '-', '='].every((key) => k(key) === null));
}

// A layer's smoothing, the editor's rule, which the compare view shares.
{
  check('rendering: pixelated at 1 device pixel per image pixel and up', layerRendering(1, 1) === 'pixelated' && layerRendering(0.5, 2) === 'pixelated' && layerRendering(8, 1) === 'pixelated');
  check('rendering: smoothed below that', layerRendering(0.62, 1) === 'auto' && layerRendering(0.4, 2) === 'auto');
}

console.log(failed ? `${failed} failed` : 'all pass');
process.exit(failed ? 1 : 0);
