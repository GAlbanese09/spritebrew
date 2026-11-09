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
// The player, for its pure fitRoomWidth; packages stay external and nothing
// renders.
await build({
  entryPoints: { player: path.join(ROOT, 'src/components/sprites/AnimationPlayer.tsx') },
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') }, packages: 'external', jsx: 'automatic',
});
const { fitRoomWidth } = await import(pathToFileURL(path.join(OUT_DIR, 'player.mjs')).href);

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
  const log = [];
  const handlers = { current: {
    onPinchStart: () => log.push(['start']),
    onPinch: (s) => log.push(['pinch', Math.round(s * 100) / 100]),
    onPinchEnd: () => log.push(['end']),
    onWheelStep: (d) => log.push(['step', d]),
  } };

  // A stage that records what is added and removed, on it and on window.
  const listeners = { added: [], removed: [] };
  const record = (target, where) => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, fn, opts) => { listeners.added.push([where, type, opts]); add(type, fn, opts); };
    target.removeEventListener = (type, fn, opts) => { listeners.removed.push([where, type]); remove(type, fn, opts); };
  };
  const el = new EventTarget();
  el.contains = (node) => node === inside;
  record(el, 'stage');
  record(window, 'window');
  let detach = attachStagePinch(el, handlers);

  let clock = 1000;
  const realNow = performance.now.bind(performance);
  performance.now = () => clock;
  const fire = (type, props, cancelable = true) => {
    const e = new Event(type, { cancelable });
    Object.assign(e, props);
    el.dispatchEvent(e);
    return e;
  };
  const touch = (identifier, target, x, y) => ({ identifier, target, clientX: x, clientY: y });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Lifts every finger, so each case starts clean.
  const liftAll = () => fire('touchend', { touches: [], changedTouches: [] });

  // Listener options: only touchmove, the gesture events and the wheel are active.
  {
    const opts = Object.fromEntries(listeners.added.filter(([w]) => w === 'stage').map(([, t, o]) => [t, o?.passive]));
    check('hook: touchstart, touchend and touchcancel are passive; touchmove, gestures and wheel are not',
      same(opts, { touchstart: true, touchmove: false, touchend: true, touchcancel: true, gesturestart: false, gesturechange: false, gestureend: false, wheel: false }), opts);
  }

  // One finger: nothing taken from the page.
  log.length = 0;
  fire('touchstart', { touches: [touch(1, inside, 0, 0)], changedTouches: [touch(1, inside, 0, 0)] });
  const oneMove = fire('touchmove', { touches: [touch(1, inside, 0, 40)] });
  fire('touchend', { touches: [], changedTouches: [touch(1, inside, 0, 40)] });
  check('hook: one finger is left to scroll the page', !oneMove.defaultPrevented && log.length === 0, log);

  // Two fingers: a pinch, live, with the page's zoom cancelled.
  log.length = 0;
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)] });
  const twoMove = fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 200, 0)] });
  const twoMove2 = fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 50, 0)] });
  // iPhone sends gesture events beside the touches: cancelled, not reported twice.
  const iosGesture = fire('gesturechange', { scale: 3 });
  fire('touchend', { touches: [touch(1, inside, 0, 0)], changedTouches: [touch(2, inside, 50, 0)] });
  // After a pinch, the finger left on the stage does not scroll the page.
  const heldMove = fire('touchmove', { touches: [touch(1, inside, 0, 30)] });
  fire('touchend', { touches: [], changedTouches: [touch(1, inside, 0, 30)] });
  check('hook: two-finger touchmove is cancelled and reported as the distance ratio', twoMove.defaultPrevented && twoMove2.defaultPrevented
    && same(log, [['start'], ['pinch', 2], ['pinch', 0.5], ['end']]), log);
  check('hook: a gesture event during a touch pinch is cancelled and not reported', iosGesture.defaultPrevented && !log.some((l) => l[1] === 3));
  check('hook: after a pinch, the last finger\'s move stays cancelled until it lifts', heldMove.defaultPrevented);
  fire('touchstart', { touches: [touch(3, inside, 0, 0)], changedTouches: [touch(3, inside, 0, 0)] });
  const freeMove = fire('touchmove', { touches: [touch(3, inside, 0, 40)] });
  liftAll();
  check('hook: once every finger lifted, one finger scrolls again', !freeMove.defaultPrevented);

  // Two fingers, one of them off the stage: not the stage's pinch.
  log.length = 0;
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, outside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, outside, 100, 0)] });
  const split = fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, outside, 200, 0)] });
  liftAll();
  check('hook: a finger off the stage does not make a stage pinch', !split.defaultPrevented && log.length === 0, log);

  // Apple's documented iOS order: touchstart (one finger), gesturestart,
  // touchstart (two fingers), gesturechange, touchmoves, gestureend, touchend, touchend.
  log.length = 0;
  {
    const a0 = touch(11, inside, 0, 0);
    const b0 = touch(12, inside, 100, 0);
    fire('touchstart', { touches: [a0], changedTouches: [a0] });
    const gs = fire('gesturestart', { scale: 1 });
    fire('touchstart', { touches: [a0, b0], changedTouches: [b0] });
    const gc = fire('gesturechange', { scale: 1.4 });
    const m1 = fire('touchmove', { touches: [a0, touch(12, inside, 150, 0)], changedTouches: [touch(12, inside, 150, 0)] });
    const m2 = fire('touchmove', { touches: [a0, touch(12, inside, 300, 0)], changedTouches: [touch(12, inside, 300, 0)] });
    const ge = fire('gestureend', { scale: 3 });
    fire('touchend', { touches: [touch(11, inside, 0, 0)], changedTouches: [touch(12, inside, 300, 0)] });
    fire('touchend', { touches: [], changedTouches: [a0] });
    check('hook: Apple\'s iOS order gives one start, the touch ratios, one end, and no gesture scale',
      same(log, [['start'], ['pinch', 1.5], ['pinch', 3], ['end']]) && gs.defaultPrevented && gc.defaultPrevented && ge.defaultPrevented
      && m1.defaultPrevented && m2.defaultPrevented, log);
  }

  // A lost touchend: the next touch is a new gesture, the old pinch ends, and
  // the finger count is right again (a reused identifier, as Chrome does).
  log.length = 0;
  fire('touchstart', { touches: [touch(0, inside, 0, 0), touch(1, inside, 100, 0)], changedTouches: [touch(0, inside, 0, 0), touch(1, inside, 100, 0)] });
  fire('touchmove', { touches: [touch(0, inside, 0, 0), touch(1, inside, 200, 0)] });
  // Both touchends are lost. A new finger lands, reusing identifier 0.
  fire('touchstart', { touches: [touch(0, inside, 50, 50)], changedTouches: [touch(0, inside, 50, 50)] });
  const afterLost = fire('touchmove', { touches: [touch(0, inside, 50, 90)] });
  fire('touchend', { touches: [], changedTouches: [touch(0, inside, 50, 90)] });
  const gAfterLost = log.length;
  fire('gesturestart', { scale: 1 });
  fire('gestureend', { scale: 1 });
  check('hook: a lost touchend ends the stale pinch and the next finger scrolls',
    same(log.slice(0, gAfterLost), [['start'], ['pinch', 2], ['end']]) && !afterLost.defaultPrevented, log);
  check('hook: after a lost touchend the finger count is not stuck (a gesture is reported again)',
    same(log.slice(gAfterLost), [['start'], ['end']]), log.slice(gAfterLost));

  // A lost touchend with a new identifier.
  log.length = 0;
  fire('touchstart', { touches: [touch(21, inside, 0, 0), touch(22, inside, 100, 0)], changedTouches: [touch(21, inside, 0, 0), touch(22, inside, 100, 0)] });
  fire('touchmove', { touches: [touch(21, inside, 0, 0), touch(22, inside, 120, 0)] });
  fire('touchmove', { touches: [touch(23, inside, 0, 0)] });
  liftAll();
  check('hook: a touch list with none of the tracked fingers ends the pinch', same(log, [['start'], ['pinch', 1.2], ['end']]), log);

  // A third finger lands, then the first lifts: a new baseline each time, no jump.
  log.length = 0;
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)] });
  fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 200, 0)] });
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 200, 0), touch(3, inside, 200, 300)], changedTouches: [touch(3, inside, 200, 300)] });
  fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 200, 0), touch(3, inside, 200, 300)] });
  fire('touchend', { touches: [touch(2, inside, 200, 0), touch(3, inside, 200, 300)], changedTouches: [touch(1, inside, 0, 0)] });
  const thirdMove = fire('touchmove', { touches: [touch(2, inside, 200, 0), touch(3, inside, 200, 300)] });
  fire('touchmove', { touches: [touch(2, inside, 200, 0), touch(3, inside, 200, 600)] });
  liftAll();
  check('hook: a third finger, then the first lifting, start new baselines with no jump',
    same(log, [['start'], ['pinch', 2], ['end'], ['start'], ['pinch', 1], ['end'], ['start'], ['pinch', 1], ['pinch', 2], ['end']]) && thirdMove.defaultPrevented, log);

  // Blur mid-pinch: the pinch ends and the finger count resets.
  log.length = 0;
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)] });
  fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 150, 0)] });
  window.dispatchEvent(new Event('blur'));
  fire('gesturestart', { scale: 1 });
  fire('gestureend', { scale: 1 });
  check('hook: a blur mid-pinch ends it and resets the finger count', same(log, [['start'], ['pinch', 1.5], ['end'], ['start'], ['end']]), log);
  liftAll();

  // touchcancel mid-pinch.
  log.length = 0;
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)] });
  fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 50, 0)] });
  fire('touchcancel', { touches: [], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 50, 0)] });
  fire('touchstart', { touches: [touch(5, inside, 0, 0)], changedTouches: [touch(5, inside, 0, 0)] });
  const afterCancel = fire('touchmove', { touches: [touch(5, inside, 0, 40)] });
  liftAll();
  check('hook: touchcancel ends the pinch and the next finger scrolls', same(log, [['start'], ['pinch', 0.5], ['end']]) && !afterCancel.defaultPrevented, log);

  // The browser already scrolls: the first two-finger move is not cancelable.
  log.length = 0;
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)] });
  fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 150, 0)] }, false);
  const laterMove = fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 300, 0)] });
  liftAll();
  const droppedLog = [...log];
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)] });
  fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 200, 0)] });
  liftAll();
  check('hook: a non-cancelable first two-finger move leaves the gesture to the browser until every finger lifts',
    droppedLog.length === 0 && !laterMove.defaultPrevented, droppedLog);
  check('hook: the next pinch after a dropped one zooms', same(log, [['start'], ['pinch', 2], ['end']]), log);

  // Safari trackpad pinch.
  log.length = 0;
  const gStart = fire('gesturestart', { scale: 1 });
  const gChange = fire('gesturechange', { scale: 1.5 });
  const gBad = fire('gesturechange', { scale: NaN });
  clock += 100;
  const wheelDuring = fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  const gEnd = fire('gestureend', { scale: 1.5 });
  check('hook: gesturestart, gesturechange and gestureend are cancelled', gStart.defaultPrevented && gChange.defaultPrevented && gBad.defaultPrevented && gEnd.defaultPrevented);
  check('hook: a Safari pinch reports its scale, and a bad scale is dropped', same(log, [['start'], ['pinch', 1.5], ['end']]), log);
  check('hook: a ctrl wheel during a Safari pinch is cancelled but not zoomed twice', wheelDuring.defaultPrevented && !log.some((l) => l[0] === 'step'));
  log.length = 0;
  clock += 200;
  fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  clock += 400;
  fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  check('hook: the wheel guard lasts 500 ms after the last gesture event', same(log, [['step', 1]]), log);

  // Wheel.
  clock += 1000;
  log.length = 0;
  const plain = fire('wheel', { deltaY: -100, deltaMode: 0 });
  check('hook: a plain wheel is not touched', !plain.defaultPrevented && log.length === 0, log);
  const ctrlUp = fire('wheel', { ctrlKey: true, deltaY: -100, deltaMode: 0 });
  clock += 1000;
  const metaDown = fire('wheel', { metaKey: true, deltaY: 3, deltaMode: 1 });
  check('hook: a ctrl or cmd wheel is cancelled and steps in, then out', ctrlUp.defaultPrevented && metaDown.defaultPrevented
    && same(log, [['step', 1], ['step', -1]]), log);
  clock += 1000;
  log.length = 0;
  for (let i = 0; i < 12; i++) { clock += 10; fire('wheel', { ctrlKey: true, deltaY: -5, deltaMode: 0 }); }
  check('hook: a trackpad pinch\'s small deltas add up to one step, not twelve', same(log, [['step', 1]]), log);

  const wheelRun = (deltas) => {
    clock += 1000;
    log.length = 0;
    const events = deltas.map((d) => {
      if (d === 'idle') { clock += 400; return null; }
      clock += 10;
      return fire('wheel', { ctrlKey: true, deltaY: d, deltaMode: 0 });
    }).filter(Boolean);
    return { steps: log.filter((l) => l[0] === 'step').map((l) => l[1]), allCancelled: events.every((e) => e.defaultPrevented) };
  };
  {
    const r = wheelRun([-30, 0, 0.4, -30]);
    check('hook: a zero or sub-pixel wheel delta is cancelled and does not reset the count', same(r.steps, [1]) && r.allCancelled, r);
  }
  {
    const r = wheelRun([-30, 3, -30]);
    check('hook: a tiny opposite wheel delta (under 10 px) does not reset the count', same(r.steps, [1]), r);
  }
  {
    const r = wheelRun([-30, 15, -30]);
    check('hook: an opposite wheel delta of 10 px or more resets the count', same(r.steps, []), r);
  }
  {
    const r = wheelRun([-30, 'idle', -30]);
    check('hook: a wheel pause over 300 ms starts a new count', same(r.steps, []), r);
  }
  {
    // Two notches in one tick, before any render: two steps, and a stage that
    // reads and writes its scale through a ref (as both stages do) moves two.
    clock += 1000;
    log.length = 0;
    const scaleRef = { current: 2 };
    const saved = handlers.current.onWheelStep;
    handlers.current.onWheelStep = (d) => { log.push(['step', d]); scaleRef.current = stepZoom(scaleRef.current, d, WORLD); };
    fire('wheel', { ctrlKey: true, deltaY: -100, deltaMode: 0 });
    fire('wheel', { ctrlKey: true, deltaY: -100, deltaMode: 0 });
    handlers.current.onWheelStep = saved;
    check('hook: two wheel notches in one tick are two steps', same(log, [['step', 1], ['step', 1]]) && scaleRef.current === 4, [log, scaleRef.current]);
  }

  detach();
  detach = null;
  log.length = 0;
  const after = fire('wheel', { ctrlKey: true, deltaY: -200, deltaMode: 0 });
  fire('gesturestart', { scale: 1 });
  fire('touchstart', { touches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)], changedTouches: [touch(1, inside, 0, 0), touch(2, inside, 100, 0)] });
  const afterMove = fire('touchmove', { touches: [touch(1, inside, 0, 0), touch(2, inside, 200, 0)] });
  window.dispatchEvent(new Event('blur'));
  check('hook: the listeners are removed on detach', !after.defaultPrevented && !afterMove.defaultPrevented && log.length === 0, log);
  {
    const key = (l) => `${l[0]}:${l[1]}`;
    const added = listeners.added.map(key).sort();
    const removed = listeners.removed.map(key).sort();
    check('hook: detach removes every listener it added (8 on the stage, blur on window)', added.length === 9 && same(added, removed), { added, removed });
  }
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
  check('pin: the Animation Player canvas box uses useStagePinch', /import \{ useStagePinch \} from '@\/hooks\/useStagePinch';/.test(player) && /useStagePinch\(boxRef, \{/.test(player) && /<div\s+ref=\{boxRef\}[\s\S]{0,500}?<canvas/.test(player));
  check('pin: the hook cancels gesturestart and gesturechange', /const onGestureStart = \(e: Event\) => \{\s*e\.preventDefault\(\);/.test(hook) && /const onGestureChange = \(e: Event\) => \{\s*e\.preventDefault\(\);/.test(hook)
    && /addEventListener\('gesturestart', onGestureStart, active\);/.test(hook) && /addEventListener\('gesturechange', onGestureChange, active\);/.test(hook));
  check('pin: two-touch touchmove is cancelled, with passive false', /const active = \{ passive: false \} as const;/.test(hook) && /addEventListener\('touchmove', onTouchMove, active\);/.test(hook)
    && /if \(e\.cancelable\) e\.preventDefault\(\);\s*handlers\.current\.onPinch\?\.\(d \/ baseline\);/.test(hook));
  check('pin: touchstart, touchend and touchcancel are passive', /const passive = \{ passive: true \} as const;/.test(hook)
    && ['touchstart\', onTouchStart', 'touchend\', onTouchEnd', 'touchcancel\', onTouchEnd'].every((l) => hook.includes(`addEventListener('${l}, passive);`)));
  check('pin: the hook tracks fingers by identifier from e.touches', /const ids = touches\.map\(\(t\) => t\.identifier\);/.test(hook) && /const touches = stageTouches\(e\.touches\);/.test(hook));
  check('pin: a ctrl or meta wheel is handled and a plain wheel is not', /const onWheel = \(e: WheelEvent\) => \{\s*if \(!e\.ctrlKey && !e\.metaKey\) return;[^\n]*\n\s*e\.preventDefault\(\);/.test(hook) && /addEventListener\('wheel', onWheel, active\);/.test(hook));
  check('pin: the Stats readout starts hidden', /const \[showOverlay, setShowOverlay\] = useState\(false\);/.test(demo) && /\{showOverlay && !showcaseMode && \(/.test(demo));
  check('pin: Keyboard Controls carries pointer-coarse:hidden', /<div className="[^"]*\bpointer-coarse:hidden\b[^"]*">\s*<button\s+onClick=\{\(\) => setShowControls\(\(v\) => !v\)\}[\s\S]{0,400}?Keyboard Controls/.test(demo));
  check('pin: both pages have the loaded-but-no-animations line', [preview, exportPage].every((page) =>
    page.includes(`? '${noAnimations}'`) && page.includes(": 'No sprite data loaded.'") && /const hasSheet = useSpriteStore\(\(s\) => s\.spriteSheet !== null\);/.test(page) && /\{hasSheet\s*\?/.test(page)));
  check('pin: Stats is a real toggle with aria-pressed and its H titles', /aria-pressed=\{showOverlay\}/.test(demo) && /title=\{showOverlay \? 'Hide stats \(H\)' : 'Show stats \(H\)'\}/.test(demo) && /\n\s*Stats\n\s*<\/button>/.test(demo) && !/Eye/.test(demo));
  check('pin: the Demo Area fits on open from the tallest frame, and a pick is kept', /fitScale\(tallest, CANVAS_H, WORLD_SCALES\)/.test(demo) && /const worldScale = pickedScale \?\? fittedScale;/.test(demo) && !/setWorldScale/.test(demo));
  check('pin: the player fits the box with a ResizeObserver, at 60% of the viewport height', /fitZoomToBox\(frameW, frameH, room - BOX_INSET, window\.innerHeight \* 0\.6, ZOOM_OPTIONS\)/.test(player) && /new ResizeObserver\(/.test(player) && /const zoom = pickedZoom \?\? fittedZoom;/.test(player));
  check('pin: the player box scrolls instead of shrinking the canvas', /p-3 max-w-full overflow-auto/.test(player) && !/maxWidth: '100%'/.test(player));
  check('pin: touch size on a coarse pointer, both stages', [demo, player].every((text) => /const TOUCH_CHIP = '[^']*pointer-coarse:min-h-11[^']*pointer-coarse:text-xs'/.test(text)) && (demo.match(/\$\{TOUCH_CHIP\}/g) ?? []).length === 5 && (player.match(/\$\{TOUCH_CHIP\}/g) ?? []).length === 3);
  check('pin: the phone hint says pinch zooms', /Use the buttons below to move\. Pinch or use the buttons to zoom\./.test(demo));
  check('pin: the /preview lead line', /Test your sprite animations in a live sandbox, or step through frames\s+in the animation player\./.test(preview));
  // Audit r1 fixes (build/preview-audit.md).
  const fitEffect = between(player, 'useLayoutEffect(() => {\n    const row = rowRef.current;', '}, [frameW, frameH, hasFrames]);');
  check('pin F1: the player fits in a layout effect, once on measure, and refits only past 24 px of width', /const REFIT_PX = 24;/.test(player)
    && /fit\(row\.clientWidth\);/.test(fitEffect) && /if \(Math\.abs\(width - fitWidthRef\.current\) > REFIT_PX\) fit\(width\);/.test(fitEffect) && !/clientHeight/.test(fitEffect));
  check('pin F1: the canvas is hidden until the first fit and drawn before paint', /visibility: zoom === null \? 'hidden' : undefined/.test(player)
    && /useLayoutEffect\(\(\) => \{\s*drawFrame\(currentFrame\);\s*\}, \[currentFrame, drawFrame\]\);/.test(player));
  check('pin F2: the six transport buttons are 44 px on a coarse pointer', /const TOUCH_BUTTON = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';/.test(player)
    && (player.match(/className=\{TOUCH_BUTTON\}/g) ?? []).length === 6);
  check('pin F2: the /preview tabs and both Go to Upload buttons are 44 px on a coarse pointer',
    (between(preview, '{/* Tab bar */}', '{/* Tab content */}').match(/pointer-coarse:min-h-11 pointer-coarse:min-w-11/g) ?? []).length === 2
    && [preview, exportPage].every((page) => /<Button variant="secondary" size="md" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11">\s*Go to Upload/.test(page))
    && /const TOUCH_CHIP = '[^']*pointer-coarse:min-w-11[^']*'/.test(demo));
  check('pin F3: the player box is a focusable, labeled region with a focus ring', /<div\s+ref=\{boxRef\}\s+tabIndex=\{0\}\s+role="region"\s+aria-label="Animation preview \(scroll when zoomed in\)"\s+className="[^"]*focus-visible:outline-accent-amber/.test(player));
  check('pin F5: both stages set their scale ref before the state', /worldScaleRef\.current = next;\s*setPickedScale\(next\);/.test(demo) && /zoomRef\.current = next;\s*setPickedZoom\(next\);/.test(player)
    && /WHEEL_MIN_PX = 1;/.test(hook) && /WHEEL_FLIP_PX = 10;/.test(hook));
  check('pin F6: the clamp does not divide the sprite size by the scale', /const halfW = activeSprite \? activeSprite\.width \/ 2 : 0;/.test(demo) && /const halfH = activeSprite \? activeSprite\.height \/ 2 : 0;/.test(demo)
    && !/const half[WH] = [^\n]*\/ ws/.test(demo));
  check('pin F7: Stats rounds Pos', /Pos: \{Math\.round\(overlayInfo\.x\)\}, \{Math\.round\(overlayInfo\.y\)\}/.test(demo));
  check('pin F8: a zoom change keeps the middle in view', /centerRef\.current = \{/.test(player)
    && /useLayoutEffect\(\(\) => \{[\s\S]{0,300}?box\.scrollLeft = center\.x \* canvas\.width[\s\S]{0,200}?\}, \[zoom\]\);/.test(player));
  check('pin F9: Loop and Ping-pong are pressed toggles, and the transport buttons have names', /aria-pressed=\{loop\}/.test(player) && /aria-pressed=\{pingPong\}/.test(player)
    && ['Step back', 'Stop', 'Step forward', 'Loop', 'Ping-pong'].every((n) => player.includes(`title="${n}" aria-label="${n}"`) || new RegExp(`title="${n}"\\s+aria-label="${n}"`).test(player))
    && /title=\{playing \? 'Pause' : 'Play'\}\s*aria-label=\{playing \? 'Pause' : 'Play'\}/.test(player));
  check('pin F9: the Background chips have names in words', ['Checkerboard', 'Black', 'White', 'Green'].every((c) => player.includes(`name: '${c} background'`))
    && /title=\{name\}\s*aria-label=\{name\}/.test(player));
  check('pin F10: the scale row has fixed chips, the value in the label, and a polite status line', /\{VALID_WORLD_SCALES\.map\(\(s\) => \(/.test(demo) && !/scaleChips|\.sort\(\(a, b\) => a - b\)/.test(demo)
    && /\{betweenChips \? `Scale \$\{worldScale\}×` : 'Scale'\}/.test(demo) && /<span role="status" className="sr-only">\s*\{spokenScale === null \? '' : `Scale \$\{spokenScale\}×`\}/.test(demo)
    && !/onPinch: \([^)]*\) => \{[^}]*setSpokenScale/.test(demo));
  check('pin F11: empty animations are skipped in the player and the Demo Area', /const playable = useMemo\(\(\) => animations\.filter\(\(a\) => a\.frames\.length > 0\), \[animations\]\);/.test(player)
    && /\{playable\.length > 1 && \(/.test(player) && /\{playable\.map\(\(a\) => \(/.test(player) && !/animations\[0\]/.test(player)
    && /function buildAnimMaps\(allAnimations: SpriteAnimation\[\]\) \{[\s\S]{0,200}?const animations = allAnimations\.filter\(\(a\) => a\.frames\.length > 0\);/.test(demo));
  // Harness r1 fixes (build/harness/polish-preview).
  check('pin G1: the Animation select is 44 px on a coarse pointer', /<select\s+value=\{anim\.id\}[\s\S]{0,300}?className="[^"]*\bpointer-coarse:min-h-11\b[^"]*"/.test(player));
  check('pin G2: the fit subtracts the probed thickness only when main shows no scrollbar',
    /const main = row\.closest\('main'\);/.test(fitEffect) && /const mainBarPx = main \? main\.offsetWidth - main\.clientWidth : 0;/.test(fitEffect)
    && /const room = fitRoomWidth\(width, scrollbarThickness\(\), mainBarPx\);/.test(fitEffect) && /fitZoomToBox\(frameW, frameH, room - BOX_INSET,/.test(fitEffect) && /fitWidthRef\.current = width;/.test(fitEffect)
    && /export function fitRoomWidth\(rowWidth: number, thickness: number, mainBarPx: number\): number \{\s*return mainBarPx > 0 \? rowWidth : rowWidth - thickness;\s*\}/.test(player)
    && /if \(scrollbarPx === null\) \{[\s\S]{0,400}?overflow:scroll[\s\S]{0,200}?scrollbarPx = probe\.offsetWidth - probe\.clientWidth;\s*probe\.remove\(\);/.test(player));
  check('G2: overlay scrollbars (thickness 0) leave the width alone', fitRoomWidth(660, 0, 0) === 660, fitRoomWidth(660, 0, 0));
  check('G2: thickness 15 with no bar on main leaves 15 px for it', fitRoomWidth(660, 15, 0) === 645, fitRoomWidth(660, 15, 0));
  check('G2: thickness 15 with the bar already showing subtracts nothing', fitRoomWidth(645, 15, 15) === 645, fitRoomWidth(645, 15, 15));
  {
    // The harness's case: a 64 px frame in a 545 px row (a 660 px window).
    const at = (thickness, bar) => fitZoomToBox(64, 64, fitRoomWidth(545, thickness, bar) - 26, 600, ZOOM);
    check('G2: a 64 px frame in a 545 px row fits 4x with room for a 15 px bar, 8x with overlay bars', at(15, 0) === 4 && at(0, 0) === 8, [at(15, 0), at(0, 0)]);
  }
  {
    const hint = between(demo, '{/* Click-to-focus hint', 'Click to focus &middot;');
    check('pin G3: the focus hint sits at the bottom of the stage, dimmed, untouchable, hidden on touch',
      /className="absolute inset-0 flex pointer-coarse:hidden items-end justify-center pb-3 bg-black\/30 pointer-events-none"/.test(hint) && !/items-center/.test(hint)
      && demo.includes('Click to focus &middot; Use keyboard to control'));
  }
  check('pin: a 48 px sprite opens at 5x on the Demo Area (the share stays 0.35)', fitScale(48, 720, WORLD) === 5, fitScale(48, 720, WORLD));
  check('the library has no React and no DOM calls', !/from 'react'|document\.|window\.|addEventListener/.test(lib));
  check('no em dashes in the new files', ![hook, lib, fs.readFileSync(new URL(import.meta.url), 'utf8')].some((text) => text.includes('\u2014')));
  check('no em dashes in the empty-state lines', !between(preview, '{/* Empty state */}', '{/* Tabs').includes('\u2014') && !between(exportPage, '{/* Empty state */}', '{/* Export configuration').includes('\u2014'));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
