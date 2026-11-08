// scripts/stage-zoom-test.mjs
//
// Offline tests for src/lib/stageZoom.ts and src/hooks/useStagePinch.ts, the
// pinch and fit-on-open zoom of the /preview stages (HQ 2026-11-08-011, -018;
// PILOT sweep 1 items 1 to 4): where a pinch lands, one wheel notch, the
// scale each stage opens at, and which events the stage takes from the page.
// The hook's listeners run against fake events. Also pins what the Demo Area,
// the Animation Player and the two pages must keep, which have no browser
// test here.
// Run from the repo root: `node scripts/stage-zoom-test.mjs`. Bundles with
// esbuild into local/.stage-zoom-test/ (gitignored). Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.stage-zoom-test');

await build({
  entryPoints: { stageZoom: path.join(ROOT, 'src/lib/stageZoom.ts'), useStagePinch: path.join(ROOT, 'src/hooks/useStagePinch.ts') },
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const { snapZoom, stepZoom, fitScale, fitZoomToBox } = await import(pathToFileURL(path.join(OUT_DIR, 'stageZoom.mjs')).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

const WORLD = [1, 2, 3, 4, 5, 6, 7, 8];
const ZOOM = [1, 2, 4, 8, 16];

// ── snapZoom ──

check('snapZoom: no change stays put', snapZoom(2, 1, WORLD) === 2 && snapZoom(8, 1, ZOOM) === 8);
check('snapZoom: fingers apart from 2x land on 4x, together on 1x', snapZoom(2, 2.1, WORLD) === 4 && snapZoom(2, 0.55, WORLD) === 1);
check('snapZoom: 3.2 lands on 3, not 4', snapZoom(2, 1.6, WORLD) === 3, snapZoom(2, 1.6, WORLD));
// 3 and 6 are equally far from 4.24 in log space; the linear middle is 4.5.
check('snapZoom: nearest in log space: 4.2 lands on 3, 4.3 on 6', snapZoom(1, 4.2, [3, 6]) === 3 && snapZoom(1, 4.3, [3, 6]) === 6, [snapZoom(1, 4.2, [3, 6]), snapZoom(1, 4.3, [3, 6])]);
check('snapZoom: on the player, 11.6 lands on 16 (log), not 8 (linear)', snapZoom(8, 1.45, ZOOM) === 16, snapZoom(8, 1.45, ZOOM));
check('snapZoom: clamped at the top', snapZoom(2, 100, WORLD) === 8 && snapZoom(8, 10, ZOOM) === 16);
check('snapZoom: clamped at the bottom', snapZoom(2, 0.01, WORLD) === 1 && snapZoom(1, 0.1, ZOOM) === 1);
check('snapZoom: a bad gesture scale returns the start', [NaN, Infinity, -Infinity, 0, -1].every((g) => snapZoom(4, g, WORLD) === 4));
check('snapZoom: a bad start returns the start', snapZoom(0, 2, WORLD) === 0 && snapZoom(-2, 2, WORLD) === -2 && Number.isNaN(snapZoom(NaN, 2, WORLD)));
check('snapZoom: an empty list returns the start', snapZoom(3, 2, []) === 3);

// ── stepZoom ──

check('stepZoom: up and down on the Demo Area scales', stepZoom(2, 1, WORLD) === 3 && stepZoom(2, -1, WORLD) === 1 && stepZoom(5, 1, WORLD) === 6);
check('stepZoom: up and down on the player zooms', stepZoom(4, 1, ZOOM) === 8 && stepZoom(4, -1, ZOOM) === 2);
check('stepZoom: stays at the ends', stepZoom(8, 1, WORLD) === 8 && stepZoom(1, -1, WORLD) === 1 && stepZoom(16, 1, ZOOM) === 16 && stepZoom(1, -1, ZOOM) === 1);
check('stepZoom: from between two options goes to the next one', stepZoom(3, 1, ZOOM) === 4 && stepZoom(3, -1, ZOOM) === 2);

// ── fitScale (720 px stage, sprite at about 35% of it, never past half) ──

const FIT_720 = { 16: 8, 32: 8, 64: 4, 128: 2, 256: 1 };
for (const [h, want] of Object.entries(FIT_720)) {
  const got = fitScale(Number(h), 720, WORLD);
  check(`fitScale: a ${h} px sprite opens at ${want}x on a 720 stage`, got === want, got);
}
check('fitScale: a sprite taller than half the stage gets the smallest scale', fitScale(512, 720, WORLD) === 1 && fitScale(361, 720, WORLD) === 1);
{
  const over = [];
  for (let h = 1; h <= 360; h++) {
    const s = fitScale(h, 720, WORLD);
    if (h * s > 360) over.push([h, s]);
  }
  check('fitScale: never more than half the stage, for every height 1 to 360', over.length === 0, over.slice(0, 5));
}
check('fitScale: bad input gets the smallest scale', fitScale(0, 720, WORLD) === 1 && fitScale(NaN, 720, WORLD) === 1 && fitScale(64, 0, WORLD) === 1);
check('fitScale: share moves the target', fitScale(64, 720, WORLD, 0.1) === 1 && fitScale(64, 720, WORLD, 0.5) === 5);

// ── fitZoomToBox (box width, 60% of a 1000 px viewport = 600) ──

const BOX = [
  [64, 64, 300, 600, 4], [64, 64, 820, 600, 8], [64, 64, 1200, 600, 8], [64, 64, 1200, 1100, 16],
  [128, 128, 300, 600, 2], [128, 128, 820, 600, 4], [128, 128, 1200, 600, 4],
];
for (const [fw, fh, bw, bh, want] of BOX) {
  const got = fitZoomToBox(fw, fh, bw, bh, ZOOM);
  check(`fitZoomToBox: a ${fw} px frame in a ${bw} by ${bh} box opens at ${want}x`, got === want, got);
}
check('fitZoomToBox: a tall frame is held by the box height', fitZoomToBox(64, 128, 820, 600, ZOOM) === 4);
check('fitZoomToBox: nothing fits, the smallest', fitZoomToBox(512, 512, 300, 600, ZOOM) === 1);

// ── The hook's listeners, against fake events ──

{
  globalThis.window ??= new EventTarget();
  const { attachStagePinch } = await import(pathToFileURL(path.join(OUT_DIR, 'useStagePinch.mjs')).href);

  const inside = { id: 'stage child' };
  const outside = { id: 'page' };
  const el = new EventTarget();
  el.contains = (node) => node === inside;
  const log = [];
  const handlers = { current: {
    onPinchStart: () => log.push(['start']),
    onPinch: (s) => log.push(['pinch', Math.round(s * 100) / 100]),
    onPinchEnd: () => log.push(['end']),
    onWheelStep: (d) => log.push(['step', d]),
  } };
  const detach = attachStagePinch(el, handlers);

  let clock = 1000;
  const realNow = performance.now.bind(performance);
  performance.now = () => clock;
  const fire = (type, props) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, props);
    el.dispatchEvent(e);
    return e;
  };
  const touch = (target, x, y) => ({ target, clientX: x, clientY: y });

  // One finger: nothing taken from the page.
  log.length = 0;
  fire('touchstart', { touches: [touch(inside, 0, 0)] });
  const oneMove = fire('touchmove', { touches: [touch(inside, 0, 40)] });
  fire('touchend', { touches: [] });
  check('hook: one finger is left to scroll the page', !oneMove.defaultPrevented && log.length === 0, log);

  // Two fingers: a pinch, live, with the page's zoom cancelled.
  log.length = 0;
  fire('touchstart', { touches: [touch(inside, 0, 0), touch(inside, 100, 0)] });
  const twoMove = fire('touchmove', { touches: [touch(inside, 0, 0), touch(inside, 200, 0)] });
  const twoMove2 = fire('touchmove', { touches: [touch(inside, 0, 0), touch(inside, 50, 0)] });
  // iPhone sends gesture events beside the touches: cancelled, not reported twice.
  const iosGesture = fire('gesturechange', { scale: 3 });
  fire('touchend', { touches: [touch(inside, 0, 0)] });
  fire('touchend', { touches: [] });
  check('hook: two-finger touchmove is cancelled and reported as the distance ratio', twoMove.defaultPrevented && twoMove2.defaultPrevented
    && JSON.stringify(log) === JSON.stringify([['start'], ['pinch', 2], ['pinch', 0.5], ['end']]), log);
  check('hook: a gesture event during a touch pinch is cancelled and not reported', iosGesture.defaultPrevented && !log.some((l) => l[1] === 3));

  // Two fingers, one of them off the stage: not the stage's pinch.
  log.length = 0;
  fire('touchstart', { touches: [touch(inside, 0, 0), touch(outside, 100, 0)] });
  const split = fire('touchmove', { touches: [touch(inside, 0, 0), touch(outside, 200, 0)] });
  fire('touchend', { touches: [] });
  check('hook: a finger off the stage does not make a stage pinch', !split.defaultPrevented && log.length === 0, log);

  // Safari trackpad pinch.
  log.length = 0;
  const gStart = fire('gesturestart', { scale: 1 });
  const gChange = fire('gesturechange', { scale: 1.5 });
  const gBad = fire('gesturechange', { scale: NaN });
  clock += 100;
  const wheelDuring = fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  const gEnd = fire('gestureend', { scale: 1.5 });
  check('hook: gesturestart, gesturechange and gestureend are cancelled', gStart.defaultPrevented && gChange.defaultPrevented && gBad.defaultPrevented && gEnd.defaultPrevented);
  check('hook: a Safari pinch reports its scale, and a bad scale is dropped', JSON.stringify(log) === JSON.stringify([['start'], ['pinch', 1.5], ['end']]), log);
  check('hook: a ctrl wheel during a Safari pinch is cancelled but not zoomed twice', wheelDuring.defaultPrevented && !log.some((l) => l[0] === 'step'));
  log.length = 0;
  clock += 200;
  fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  clock += 400;
  fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  check('hook: the wheel guard lasts 500 ms after the last gesture event', JSON.stringify(log) === JSON.stringify([['step', 1]]), log);

  // Wheel.
  clock += 1000;
  log.length = 0;
  const plain = fire('wheel', { deltaY: -100, deltaMode: 0 });
  check('hook: a plain wheel is not touched', !plain.defaultPrevented && log.length === 0, log);
  const ctrlUp = fire('wheel', { ctrlKey: true, deltaY: -100, deltaMode: 0 });
  clock += 1000;
  const metaDown = fire('wheel', { metaKey: true, deltaY: 3, deltaMode: 1 });
  check('hook: a ctrl or cmd wheel is cancelled and steps in, then out', ctrlUp.defaultPrevented && metaDown.defaultPrevented
    && JSON.stringify(log) === JSON.stringify([['step', 1], ['step', -1]]), log);
  clock += 1000;
  log.length = 0;
  for (let i = 0; i < 12; i++) { clock += 10; fire('wheel', { ctrlKey: true, deltaY: -5, deltaMode: 0 }); }
  check('hook: a trackpad pinch\'s small deltas add up to one step, not twelve', JSON.stringify(log) === JSON.stringify([['step', 1]]), log);

  detach();
  log.length = 0;
  const after = fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  fire('gesturestart', { scale: 1 });
  check('hook: the listeners are removed on detach', !after.defaultPrevented && log.length === 0, log);
  performance.now = realNow;
}

// ── Source pins ──

{
  const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const demo = read('src/components/sprites/DemoArea.tsx');
  const player = read('src/components/sprites/AnimationPlayer.tsx');
  const hook = read('src/hooks/useStagePinch.ts');
  const lib = read('src/lib/stageZoom.ts');
  const preview = read('src/app/preview/page.tsx');
  const exportPage = read('src/app/export/page.tsx');
  const between = (text, from, to) => {
    const a = text.indexOf(from);
    const b = text.indexOf(to, a + from.length);
    return a < 0 || b < 0 ? '' : text.slice(a, b);
  };
  const noAnimations = 'Your sheet is loaded, but it has no animations yet. Group frames into an animation on Upload, then come back.';

  check('pin: the Demo Area stage uses useStagePinch', /import \{ useStagePinch \} from '@\/hooks\/useStagePinch';/.test(demo) && /useStagePinch\(stageRef, \{/.test(demo) && /<div\s+ref=\{stageRef\}\s+className=\{`relative rounded-lg border-2/.test(demo));
  check('pin: the Animation Player canvas box uses useStagePinch', /import \{ useStagePinch \} from '@\/hooks\/useStagePinch';/.test(player) && /useStagePinch\(boxRef, \{/.test(player) && /<div\s+ref=\{boxRef\}[\s\S]{0,200}?<canvas/.test(player));
  check('pin: the hook cancels gesturestart and gesturechange', /const onGestureStart = \(e: Event\) => \{\s*e\.preventDefault\(\);/.test(hook) && /const onGestureChange = \(e: Event\) => \{\s*e\.preventDefault\(\);/.test(hook)
    && /addEventListener\('gesturestart', onGestureStart, active\);/.test(hook) && /addEventListener\('gesturechange', onGestureChange, active\);/.test(hook));
  check('pin: two-touch touchmove is cancelled, with passive false', /const active = \{ passive: false \} as const;/.test(hook) && /addEventListener\('touchmove', onTouchMove, active\);/.test(hook)
    && /if \(touches\.length < 2 \|\| touchStartDistance === 0\) return;\s*if \(e\.cancelable\) e\.preventDefault\(\);/.test(hook));
  check('pin: a ctrl or meta wheel is handled and a plain wheel is not', /const onWheel = \(e: WheelEvent\) => \{\s*if \(!e\.ctrlKey && !e\.metaKey\) return;[^\n]*\n\s*e\.preventDefault\(\);/.test(hook) && /addEventListener\('wheel', onWheel, active\);/.test(hook));
  check('pin: the Stats readout starts hidden', /const \[showOverlay, setShowOverlay\] = useState\(false\);/.test(demo) && /\{showOverlay && !showcaseMode && \(/.test(demo));
  check('pin: Keyboard Controls carries pointer-coarse:hidden', /<div className="[^"]*\bpointer-coarse:hidden\b[^"]*">\s*<button\s+onClick=\{\(\) => setShowControls\(\(v\) => !v\)\}[\s\S]{0,400}?Keyboard Controls/.test(demo));
  check('pin: both pages have the loaded-but-no-animations line', [preview, exportPage].every((page) =>
    page.includes(`? '${noAnimations}'`) && page.includes(": 'No sprite data loaded.'") && /const hasSheet = useSpriteStore\(\(s\) => s\.spriteSheet !== null\);/.test(page) && /\{hasSheet\s*\?/.test(page)));
  check('pin: Stats is a real toggle with aria-pressed and its H titles', /aria-pressed=\{showOverlay\}/.test(demo) && /title=\{showOverlay \? 'Hide stats \(H\)' : 'Show stats \(H\)'\}/.test(demo) && /\n\s*Stats\n\s*<\/button>/.test(demo) && !/Eye/.test(demo));
  check('pin: the Demo Area fits on open from the tallest frame, and a pick is kept', /fitScale\(tallest, CANVAS_H, WORLD_SCALES\)/.test(demo) && /const worldScale = pickedScale \?\? fittedScale;/.test(demo) && !/setWorldScale/.test(demo));
  check('pin: the player fits the box with a ResizeObserver, at 60% of the viewport height', /fitZoomToBox\(frameW, frameH, boxWidth, window\.innerHeight \* 0\.6, ZOOM_OPTIONS\)/.test(player) && /new ResizeObserver\(measure\)/.test(player) && /const zoom = pickedZoom \?\? fittedZoom;/.test(player));
  check('pin: the player box scrolls instead of shrinking the canvas', /p-3 max-w-full overflow-auto/.test(player) && !/maxWidth: '100%'/.test(player));
  check('pin: touch size on a coarse pointer, both stages', [demo, player].every((text) => /const TOUCH_CHIP = '[^']*pointer-coarse:min-h-11[^']*pointer-coarse:text-xs'/.test(text)) && (demo.match(/\$\{TOUCH_CHIP\}/g) ?? []).length === 5 && (player.match(/\$\{TOUCH_CHIP\}/g) ?? []).length === 3);
  check('pin: the phone hint says pinch zooms', /Use the buttons below to move\. Pinch or use the buttons to zoom\./.test(demo));
  check('pin: the /preview lead line', /Test your sprite animations in a live sandbox, or step through frames\s+in the animation player\./.test(preview));
  check('the library has no React and no DOM calls', !/from 'react'|document\.|window\.|addEventListener/.test(lib));
  check('no em dashes in the new files', ![hook, lib, fs.readFileSync(new URL(import.meta.url), 'utf8')].some((text) => text.includes('\u2014')));
  check('no em dashes in the empty-state lines', !between(preview, '{/* Empty state */}', '{/* Tabs').includes('\u2014') && !between(exportPage, '{/* Empty state */}', '{/* Export configuration').includes('\u2014'));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
