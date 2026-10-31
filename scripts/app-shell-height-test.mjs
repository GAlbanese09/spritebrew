// scripts/app-shell-height-test.mjs
//
// Offline tests for src/lib/appShellHeight.ts (fix note 15, BUILD
// 2026-10-31): AppShell's height ignores zoom, does not shrink for the
// on-screen keyboard while a text field has focus on a touch screen (and for a
// moment after focus leaves it), and takes the new layout's height after a
// rotation. The tracker runs whole event sequences against a stand-in window,
// document and clock, through installShellHeight, the object ViewportVars
// uses. Run from the repo root: `node scripts/app-shell-height-test.mjs`.
// Bundles the module with esbuild into local/.app-shell-height-test/
// (gitignored) and prints only case names and pass or fail.

import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.app-shell-height-test', 'appShellHeight.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/lib/appShellHeight.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'error',
});
const S = await import(pathToFileURL(OUT).href);
const { isTextEntry, visibleHeight, installShellHeight, BLUR_HOLD_MS } = S;

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
};

// A stand-in page: an iPhone in portrait (430 x 739 CSS px) unless changed.
const el = (tagName, type, isContentEditable) => ({ tagName, type, isContentEditable });
const BODY = el('BODY');
const TEXTAREA = el('TEXTAREA');
const BUTTON = el('BUTTON', 'submit');
function page({ touch = true, w = 430, h = 739 } = {}) {
  const vars = {};
  const listeners = { focusin: new Set(), focusout: new Set() };
  const p = {
    t: 0,
    resyncs: 0,
    win: {
      visualViewport: { height: h, scale: 1 },
      innerHeight: h,
      matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? p.touch : false }),
    },
    doc: {
      documentElement: { clientWidth: w, clientHeight: h, style: { setProperty: (n, v) => { vars[n] = v; } } },
      activeElement: BODY,
      addEventListener: (type, fn) => { listeners[type].add(fn); },
      removeEventListener: (type, fn) => { listeners[type].delete(fn); },
    },
    touch,
    vars,
    listeners,
  };
  p.shellObj = installShellHeight(p.win, p.doc, () => p.t, () => { p.resyncs++; });
  // One ViewportVars re-read: measure, then publish.
  p.read = () => { p.shellObj.publish(p.shellObj.measure()); return p.shell(); };
  p.shell = () => (vars['--app-shell-h'] === undefined ? null : Number(vars['--app-shell-h'].replace('px', '')));
  p.vv = (height, scale = 1) => { p.win.visualViewport = { height, scale }; };
  const fire = (type, target) => { for (const fn of [...listeners[type]]) fn({ target }); };
  p.focus = (e) => { p.doc.activeElement = e; fire('focusin', e); };
  // Focus leaves the active element for `to`, with a focusout.
  p.blur = (to = BODY) => { const from = p.doc.activeElement; p.doc.activeElement = to; fire('focusout', from); if (to !== BODY) fire('focusin', to); };
  p.layout = (w2, h2) => { p.doc.documentElement.clientWidth = w2; p.doc.documentElement.clientHeight = h2; };
  p.resize = (w2, h2) => { p.layout(w2, h2); p.win.innerHeight = h2; p.vv(h2); };
  return p;
}
const KB = 336; // keyboard and its bar
const ZOOM = 4 / 3; // iOS zooming 12 px text to 16 px

// isTextEntry.
check('textarea', isTextEntry(el('TEXTAREA')));
check('lowercase tag names count (XHTML)', isTextEntry(el('textarea')));
check('select (iOS picker)', isTextEntry(el('SELECT')));
for (const t of ['text', 'email', 'number', 'search', 'tel', 'url', 'password', 'date', 'NUMBER', '']) {
  check(`input type "${t}"`, isTextEntry(el('INPUT', t)));
}
check('input with no type', isTextEntry(el('INPUT', undefined)));
for (const t of ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit', 'CHECKBOX']) {
  check(`input type "${t}" is not a text field`, !isTextEntry(el('INPUT', t)));
}
check('contenteditable', isTextEntry(el('DIV', undefined, true)));
check('a button is not', !isTextEntry(BUTTON));
check('a div is not', !isTextEntry(el('DIV', undefined, false)));
check('body, null and undefined are not', !isTextEntry(BODY) && !isTextEntry(null) && !isTextEntry(undefined));

// visibleHeight.
check('height x scale', visibleHeight(369.5, 2) === 739);
check('keeps fractions, to 0.01 px', visibleHeight(653.8, 1) === 653.8 && visibleHeight(403.123, 1) === 403.12);
check('a product just under a whole pixel still counts it', visibleHeight(492.66666, 1.5) === 739);
for (const s of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
  check(`a scale of ${String(s)} counts as 1`, visibleHeight(800, s) === 800);
}
check('no height gives null', visibleHeight(Number.NaN, 1) === null && visibleHeight(0, 1) === null);

// Sequences. p.vv changes only the visual viewport (keyboard, zoom, toolbars);
// p.resize changes the layout and the visual viewport together (a rotation or a
// window resize that has settled); p.layout changes only the layout (a read
// taken before the visual viewport caught up).
{
  const p = page();
  check('at rest the shell is the layout height', p.read() === 739);
  p.vv((739 - KB) / ZOOM, ZOOM); p.t = 10;
  check('the floor alone: keyboard and zoom with no field focused leave the shell at the layout height', p.read() === 739);
  p.vv(739 - 24); p.t = 20;
  check('a visual viewport left 24 px short after the keyboard closes (iOS 26.0) cannot cut the shell', p.read() === 739);
  p.vv(738.6); p.t = 30;
  check('a visual viewport within 1 px of the layout: its exact height (no hairline)', p.read() === 738.6);
  p.vv(738); p.t = 35;
  check('a visual viewport 1 px or more under the layout: the layout height', p.read() === 739);
}
{
  // The hold's own job: the toolbars were collapsed at the last free read, so
  // the shell was taller than the layout. iOS then keeps it while typing.
  const p = page();
  p.vv(780); p.read();
  check('toolbars collapsed at rest: the visible height, over the layout', p.read() === 780);
  p.focus(TEXTAREA); p.read();
  p.vv(739 - KB); p.t = 100;
  check('keyboard up while a field has focus: the shell keeps its height', p.read() === 780);
  p.vv((739 - KB) / ZOOM, ZOOM); p.t = 200;
  check('keyboard up and zoomed: still held', p.read() === 780);
  p.focus(el('INPUT', 'text')); p.t = 300;
  check('focus moving to another field (the keyboard arrows): still held', p.read() === 780);
  p.t = 1000; p.blur(BODY); p.read();
  p.vv((739 - KB / 2) / ZOOM, ZOOM); p.t = 1150;
  check('keyboard closing after Done: held', p.read() === 780);
  p.t = 1000 + BLUR_HOLD_MS - 1;
  check('held until BLUR_HOLD_MS after the focusout', p.read() === 780);
  p.t = 1000 + BLUR_HOLD_MS;
  check('released at BLUR_HOLD_MS: the layout height again', p.read() === 739);
}
{
  // The hold runs from the focusout itself, not from the next read.
  const p = page();
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 50; p.read();
  p.t = 1000; p.blur(BODY);
  p.t = 1000 + BLUR_HOLD_MS - 1;
  check('first read after a focusout, just inside the hold: held', p.read() === 780);
  const q = page();
  q.vv(780); q.read(); q.focus(TEXTAREA); q.read(); q.vv(739 - KB); q.t = 50; q.read();
  q.t = 1000; q.blur(BODY);
  q.t = 1000 + BLUR_HOLD_MS;
  check('first read after a focusout, at the end of the hold: released (the hold did not restart at the read)', q.read() === 739);
}
{
  const p = page();
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 50; p.read();
  p.t = 500; p.blur(BUTTON); p.vv(739 - KB / 2); p.t = 520;
  check('a tap on a button with the keyboard up: held while the keyboard closes', p.read() === 780);
}
{
  const p = page();
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 50; p.read();
  p.doc.activeElement = BODY; p.t = 900; // the field is removed: no focusout
  check('a focused field removed with no focusout: held from the first read that sees it', p.read() === 780);
  p.t = 900 + BLUR_HOLD_MS - 1;
  check('that hold lasts BLUR_HOLD_MS', p.read() === 780);
  p.t = 900 + BLUR_HOLD_MS;
  check('then the shell follows', p.read() === 739);
}
{
  const p = page();
  p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 50; p.read();
  p.layout(739, 390); p.t = 100; // rotated; the visual viewport still says portrait
  check('a read taken mid-rotation (stale visual viewport) may run tall', p.read() === 739 - KB);
  p.vv(390 - 200); p.t = 150;
  check('but does not stick: the landscape layout height', p.read() === 390);
  p.vv(390 - 210); p.t = 200;
  check('then the landscape height, still typing', p.read() === 390);
  p.layout(430, 739); p.vv(739 - KB); p.t = 300;
  check('rotated back to portrait while typing: the portrait height', p.read() === 739);
}
{
  const p = page({ w: 739, h: 390 });
  p.read(); p.focus(TEXTAREA); p.read(); p.vv(390 - 200); p.t = 50;
  check('landscape, keyboard up: the landscape height', p.read() === 390);
  p.layout(430, 739); p.vv(739 - KB); p.t = 100;
  check('landscape to portrait while typing: the portrait layout height, so no blank band', p.read() === 739);
}
{
  const p = page();
  p.read(); p.resize(739, 390); p.t = 10;
  check('rotated at rest: the landscape height', p.read() === 390);
  p.focus(TEXTAREA); p.read(); p.vv(390 - 200); p.t = 20;
  check('typing in landscape: the landscape height', p.read() === 390);
  p.layout(430, 739); p.vv(739 - KB); p.t = 30;
  check('rotated back to portrait while typing: the portrait height, against the width of the last free read', p.read() === 739);
}
{
  // The hold is measured against the layout of the last free read, not the first.
  const p = page();
  p.read(); p.resize(739, 390); p.vv(420); p.t = 10;
  check('landscape at rest, toolbars collapsed: 420', p.read() === 420);
  p.focus(TEXTAREA); p.read(); p.vv(190); p.t = 20;
  check('then typing in landscape: held at 420', p.read() === 420);
}
{
  const p = page();
  p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 10; p.read();
  p.vv(780); p.t = 20; p.read();
  p.vv(739 - KB); p.t = 30;
  check('held, grown to 780 by the toolbars, then the keyboard again: still 780', p.read() === 780);
}
{
  const p = page({ w: 1024, h: 768 });
  p.read(); p.focus(TEXTAREA); p.read();
  p.layout(768, 1024); p.t = 100;
  check('a rotation with a field focused and no on-screen keyboard (iPad keyboard): the new layout height', p.read() === 1024);
  p.vv(1024); p.t = 120;
  check('and the new visible height once it catches up', p.read() === 1024);
}
{
  const p = page();
  p.read(); p.focus(TEXTAREA); p.read();
  p.resize(430, 403); p.t = 10;
  check('a keyboard that resizes the page (layout and visible both 403): the shell follows, no overflow', p.read() === 403);
  p.resize(430, 739); p.t = 20;
  check('and grows back when it closes', p.read() === 739);
}
{
  // A touch screen with classic scrollbars: the window gets shorter while
  // typing, an overlay keyboard covers part of it, and a root scrollbar of
  // 40 px then comes and goes.
  const p = page({ w: 800, h: 700 });
  p.read(); p.focus(TEXTAREA); p.read();
  p.layout(800, 450); p.vv(300); p.t = 10;
  const a = p.read();
  p.layout(760, 450); p.t = 20;
  const b = p.read();
  p.layout(800, 450); p.t = 30;
  const c = p.read();
  check('a shorter window while typing, then a 40 px scrollbar coming and going: 450 every time (no loop)', a === 450 && b === 450 && c === 450, [a, b, c]);
}
for (const dw of [6, 40, 200]) {
  // A width-only change while typing (a scrollbar, an iPad split view): the
  // layout height is the same, so the hold stands.
  const p = page();
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 10; p.read();
  p.layout(430 - dw, 739); p.t = 20;
  check(`a width-only change of ${dw} px while typing keeps the hold (780)`, p.read() === 780);
}
{
  // A layout height the browser does not report (0) never counts as a shorter layout.
  const p = page();
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 10; p.read();
  p.layout(430, 0); p.t = 20;
  check('a layout height of 0 while typing: held', p.read() === 780);
  const q = page(); q.layout(430, 0); q.vv(700);
  check('a layout height of 0 at rest: the visible height', q.read() === 700);
}
{
  // Desktop, or any fine pointer: no hold. A synthetic visible height over the
  // layout makes the hold observable.
  const p = page({ touch: false, w: 1280, h: 720 });
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read();
  p.vv(400); p.t = 100;
  check('fine pointer: a focused field does not hold', p.read() === 720);
  p.resize(1280, 500); p.t = 120;
  check('fine pointer: a window resize while focused is followed', p.read() === 500);
  p.vv(250, 2); p.t = 130;
  check('desktop pinch zoom: the screen height', p.read() === 500);
}
{
  // A focusout on a fine pointer starts no hold, even if the pointer turns
  // coarse within BLUR_HOLD_MS.
  const p = page({ touch: false });
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read();
  p.t = 10; p.blur(BODY);
  p.touch = true; p.vv(403); p.t = 20;
  check('a focusout on a fine pointer, then a coarse pointer within the hold time: no hold', p.read() === 739);
}
{
  const p = page();
  p.vv(390, 2); p.t = 5;
  check('pinch zoom to 2x with the toolbars collapsed: height x scale (780), over the layout', p.read() === 780);
}
{
  const p = page();
  p.read(); p.vv(369.5, 2); p.t = 10;
  check('phone pinch zoom to 2x, no field: the screen height', p.read() === 739);
  p.vv(780); p.read(); p.touch = false; p.focus(TEXTAREA); p.vv(400); p.t = 20;
  check('the pointer is read on every read (a coarse pointer turning fine stops the hold)', p.read() === 739);
}
{
  const p = page();
  p.read(); p.vv(Number.NaN); p.t = 10;
  check('a NaN visual height: the layout height', p.read() === 739);
  p.resize(430, 600); p.vv(Number.NaN); p.t = 12;
  check('a NaN visual height after a resize: the new layout height', p.read() === 600);
  const q = page(); q.vv(0); q.layout(430, 0);
  check('no height and no earlier value writes nothing', q.read() === null);
  const r = page(); r.win.visualViewport = null; r.win.innerHeight = 700; r.doc.documentElement.clientHeight = 650;
  check('no visual viewport: innerHeight at scale 1, over the layout', r.read() === 700);
}
{
  // The reading takes the layout from clientHeight, never innerHeight.
  const p = page(); p.win.innerHeight = 900;
  const r = S.shellReading(p.win, p.doc);
  check('shellReading: layoutHeight is clientHeight and vvHeight the visual viewport', r.layoutHeight === 739 && r.vvHeight === 739);
  p.win.visualViewport = null;
  check('shellReading without a visual viewport: vvHeight is innerHeight', S.shellReading(p.win, p.doc).vvHeight === 900);
}
{
  // Desktop at a fractional zoom or display scale: clientHeight rounds 801.6 up
  // to 802. The shell takes 801.6, so it never overflows by the fraction.
  const p = page({ touch: false, w: 1280, h: 802 });
  p.vv(801.6);
  check('a layout that is the visual height rounded up (802 for 801.6): the exact 801.6, no overflow', p.read() === 801.6);
  p.layout(1280, 801); p.vv(801.4); p.t = 10;
  check('rounded down (801 for 801.4): the exact 801.4, no hairline', p.read() === 801.4);
}
{
  // iPad with a hardware keyboard: rotate while a field has focus, then back.
  const p = page({ w: 1194, h: 834 });
  p.read(); p.focus(TEXTAREA); p.read();
  p.resize(834, 1194); p.t = 10;
  check('iPad, typing, rotated to portrait: 1194', p.read() === 1194);
  p.resize(1194, 834); p.t = 20;
  check('and back to landscape while still typing: 834, not the held 1194', p.read() === 834);
}
{
  // A window made taller, then shorter again, while a field has focus.
  const p = page({ w: 800, h: 700 });
  p.read(); p.focus(TEXTAREA); p.read();
  p.resize(800, 1000); p.t = 10;
  check('typing, the window made taller: 1000', p.read() === 1000);
  p.resize(800, 800); p.t = 20;
  check('then shorter again: 800, not the held 1000', p.read() === 800);
}
{
  // The toolbar-grown hold survives a rotation round trip while typing: a
  // followed shorter layout is never stored.
  const p = page();
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 10; p.read();
  p.resize(739, 390); p.vv(190); p.t = 20;
  check('rotated to landscape while typing: 390', p.read() === 390);
  p.resize(430, 739); p.vv(739 - KB); p.t = 30;
  check('back to portrait, still typing: the held 780 again', p.read() === 780);
}
{
  // Field A's focusout starts a hold; field B then gets focus and is removed
  // with no focusout while A's hold runs: the hold runs on from B's removal.
  const p = page();
  p.vv(780); p.read(); p.focus(TEXTAREA); p.read(); p.vv(739 - KB); p.t = 50; p.read();
  p.t = 1000; p.blur(BODY); p.read();
  const B = el('INPUT', 'number');
  p.t = 1100; p.focus(B); p.read();
  p.t = 1200; p.doc.activeElement = BODY; p.read();
  p.t = 1000 + BLUR_HOLD_MS + 50;
  check('a field removed during an earlier hold extends it from the removal', p.read() === 780);
  p.t = 1200 + BLUR_HOLD_MS;
  check('and it ends BLUR_HOLD_MS after the removal', p.read() === 739);
}
{
  // The window got shorter between the last free read and the first read
  // while typing: followed (the stored layout is the free read's).
  const p = page();
  p.read();
  p.resize(430, 600); p.focus(TEXTAREA); p.t = 10;
  check('a shorter layout at the first read while typing: followed (600)', p.read() === 600);
}
// installShellHeight's listeners.
{
  const p = page();
  check('installShellHeight adds one focusin and one focusout listener', p.listeners.focusin.size === 1 && p.listeners.focusout.size === 1);
  p.vv(780); p.read(); p.focus(TEXTAREA);
  check('a focusin re-reads', p.resyncs === 1);
  p.read(); p.vv(739 - KB); p.t = 50; p.read();
  p.t = 400; p.blur(BODY);
  check('a focusout re-reads', p.resyncs === 2);
  p.vv(739 - 100); p.t = 450;
  check('and starts the hold from the focusout', p.read() === 780);
  p.shellObj.dispose();
  check('dispose removes both listeners', p.listeners.focusin.size === 0 && p.listeners.focusout.size === 0);
}
check('BLUR_HOLD_MS covers a keyboard animation (500 ms or more)', BLUR_HOLD_MS >= 500);

// The recorded case, from George's screenshots (Oct 30, iPhone 17 Pro Max,
// 440 x 956 CSS px, iOS 26): about 448 px of the screen showed the page
// above the keyboard at a 4/3 zoom (336 layout px), and Safari had panned
// about 231 layout px down to the box. The blank band is the part of the
// visible area below the shell's bottom.
{
  const p = page({ w: 440, h: 956 });
  p.read(); p.focus(TEXTAREA); p.read();
  const vv = 448 / ZOOM;
  p.vv(vv, ZOOM); p.t = 100;
  const shell = p.read();
  const pan = 231;
  const blank = (s) => Math.max(0, pan + vv - s);
  check('recorded case: the old shell (visual viewport height) leaves a blank band', blank(Math.floor(vv)) > 200, { blank: blank(Math.floor(vv)) });
  check('recorded case: the new shell leaves none', shell === 956 && blank(shell) === 0, { shell });
}

check('BLUR_HOLD_MS is positive and under the last resync delay', (() => {
  const src = readFileSync(path.join(ROOT, 'src/components/sprites/ViewportVars.tsx'), 'utf8');
  const delays = (src.match(/RESYNC_DELAYS = \[([^\]]+)\]/)?.[1] ?? '').split(',').map(Number);
  return BLUR_HOLD_MS > 0 && BLUR_HOLD_MS < Math.max(...delays);
})());

// Wiring, with comments removed first so a commented-out line never passes.
const code = (f) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const vvSrc = code('src/components/sprites/ViewportVars.tsx');
check('ViewportVars installs one shell height per mount, re-reading through resync',
  /const shell = installShellHeight\(window, document, \(\) => performance\.now\(\), \(\) => resync\(\)\);/.test(vvSrc));
{
  const setVar = vvSrc.slice(vvSrc.indexOf('const setVar = () => {'), vvSrc.indexOf('const schedule = () => {'));
  const m = setVar.indexOf('const shellH = shell.measure();');
  const w = setVar.indexOf('setProperty(');
  check('setVar measures the shell before its first write, then publishes it', m >= 0 && w > m && /shell\.publish\(shellH\);/.test(setVar));
}
check('ViewportVars removes the focus listeners on unmount', /shell\.dispose\(\);/.test(vvSrc));
check('ViewportVars still writes --app-vh and --app-top', /setProperty\('--app-vh'/.test(vvSrc) && /setProperty\('--app-top'/.test(vvSrc));
const shellSrc = code('src/components/layout/AppShell.tsx');
check('AppShell: /editor keeps h-app-vh, every other route takes h-app-shell',
  shellSrc.includes("className={`flex ${isEditor ? 'h-app-vh' : 'h-app-shell'} overflow-hidden`}"));
const css = code('src/app/globals.css');
check('globals.css defines h-app-shell with the --app-vh fallback', /@utility h-app-shell \{\s*height: var\(--app-shell-h, var\(--app-vh, 100dvh\)\);\s*\}/.test(css));
check('globals.css keeps h-app-vh', /@utility h-app-vh \{\s*height: var\(--app-vh, 100dvh\);\s*\}/.test(css));

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('all pass');
