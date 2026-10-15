// scripts/a1-loop-sequence-test.mjs
//
// Offline tests for src/lib/loopSequence.ts (Wave 1 addendum A1: edit the
// frames of the playing loop). Run from the repo root:
// `node scripts/a1-loop-sequence-test.mjs`.
//
// The harness writes only its esbuild bundle, to local/.a1-loop-sequence-test
// (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.a1-loop-sequence-test');

await build({
  entryPoints: { loopSequence: path.join(ROOT, 'src/lib/loopSequence.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const { createSequence, move, remove, duplicate, setFps, togglePingPong, playback } = await import(
  pathToFileURL(path.join(OUT, 'loopSequence.mjs')).href
);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const seqOf = (order, fps = 8, pingPong = false) => ({ order, fps, pingPong });
// True when fn returned a new object and a new order array, and left the
// input exactly as it was.
function fresh(fn, input) {
  const before = JSON.stringify(input);
  const out = fn(input);
  return out !== input && out.order !== input.order && JSON.stringify(input) === before;
}

// ── createSequence ──

check('createSequence(4) -> order 0..3, 8 fps, ping-pong off',
  eq(createSequence(4), seqOf([0, 1, 2, 3])));
check('createSequence(1) -> order [0]', eq(createSequence(1).order, [0]));
check('createSequence(16) -> 16 frames in order',
  eq(createSequence(16).order, Array.from({ length: 16 }, (_, i) => i)));
check('createSequence(0) -> empty order', eq(createSequence(0).order, []));
check('createSequence returns a new object each call', createSequence(4) !== createSequence(4));

// ── move ──

const base = seqOf([0, 1, 2, 3]);
check('move(pos 1, +1) swaps with the next frame', eq(move(base, 1, 1).order, [0, 2, 1, 3]));
check('move(pos 2, -1) swaps with the previous frame', eq(move(base, 2, -1).order, [0, 2, 1, 3]));
check('move(first, -1) is a no-op', eq(move(base, 0, -1).order, [0, 1, 2, 3]));
check('move(last, +1) is a no-op', eq(move(base, 3, 1).order, [0, 1, 2, 3]));
check('move with delta 0 is a no-op', eq(move(base, 1, 0).order, [0, 1, 2, 3]));
check('move with a bad position is a no-op', eq(move(base, 7, -1).order, [0, 1, 2, 3]));
check('move keeps fps and ping-pong', eq(move(seqOf([0, 1], 12, true), 0, 1), seqOf([1, 0], 12, true)));
check('move returns a new object and leaves the input alone', fresh((s) => move(s, 1, 1), base));
check('move no-op still returns a new object', fresh((s) => move(s, 0, -1), base));

// ── remove ──

check('remove(pos 1) drops that frame', eq(remove(base, 1).order, [0, 2, 3]));
check('remove(last) drops the last frame', eq(remove(base, 3).order, [0, 1, 2]));
check('remove never leaves fewer than one frame', eq(remove(seqOf([2]), 0).order, [2]));
check('remove down to the floor: four removes leave one frame',
  eq(remove(remove(remove(remove(base, 0), 0), 0), 0).order, [3]));
check('remove with a bad position is a no-op', eq(remove(base, -1).order, [0, 1, 2, 3]));
check('remove returns a new object and leaves the input alone', fresh((s) => remove(s, 0), base));
check('remove at the floor still returns a new object', fresh((s) => remove(s, 0), seqOf([0])));

// ── duplicate ──

check('duplicate(pos 1) inserts a copy right after it', eq(duplicate(base, 1).order, [0, 1, 1, 2, 3]));
check('duplicate(last) appends a copy', eq(duplicate(base, 3).order, [0, 1, 2, 3, 3]));
check('duplicate of a single frame -> two frames', eq(duplicate(seqOf([0]), 0).order, [0, 0]));
check('duplicate with a bad position is a no-op', eq(duplicate(base, 4).order, [0, 1, 2, 3]));
check('duplicate returns a new object and leaves the input alone', fresh((s) => duplicate(s, 0), base));

// ── setFps ──

check('setFps(12) -> 12', setFps(base, 12).fps === 12);
check('setFps rounds 11.6 -> 12', setFps(base, 11.6).fps === 12);
check('setFps rounds 11.4 -> 11', setFps(base, 11.4).fps === 11);
check('setFps clamps 2 -> 4', setFps(base, 2).fps === 4);
check('setFps clamps 60 -> 24', setFps(base, 60).fps === 24);
check('setFps keeps the ends 4 and 24', setFps(base, 4).fps === 4 && setFps(base, 24).fps === 24);
check('setFps(NaN) keeps the current speed', setFps(seqOf([0], 10), NaN).fps === 10);
check('setFps keeps order and ping-pong', eq(setFps(seqOf([3, 1], 8, true), 16), seqOf([3, 1], 16, true)));
check('setFps returns a new object and leaves the input alone', fresh((s) => setFps(s, 20), base));

// ── togglePingPong ──

check('togglePingPong turns it on', togglePingPong(base).pingPong === true);
check('togglePingPong twice turns it off', togglePingPong(togglePingPong(base)).pingPong === false);
check('togglePingPong keeps order and fps', eq(togglePingPong(seqOf([1, 0], 6)), seqOf([1, 0], 6, true)));
check('togglePingPong returns a new object and leaves the input alone', fresh(togglePingPong, base));

// ── playback ──

check('playback with ping-pong off plays the order', eq(playback(base), [0, 1, 2, 3]));
check('playback ping-pong [0,1,2,3] -> [0,1,2,3,2,1]', eq(playback(seqOf([0, 1, 2, 3], 8, true)), [0, 1, 2, 3, 2, 1]));
check('playback ping-pong [0,1,2] -> [0,1,2,1]', eq(playback(seqOf([0, 1, 2], 8, true)), [0, 1, 2, 1]));
check('playback ping-pong with one frame plays the order', eq(playback(seqOf([2], 8, true)), [2]));
check('playback ping-pong with two frames plays the order', eq(playback(seqOf([0, 1], 8, true)), [0, 1]));
check('playback ping-pong on an edited order [3,1,1,0] -> [3,1,1,0,1,1]',
  eq(playback(seqOf([3, 1, 1, 0], 8, true)), [3, 1, 1, 0, 1, 1]));
check('playback returns a new array', playback(base) !== base.order);

// ── acceptance walk-through: 4-frame Walk ──

{
  let s = createSequence(4);
  s = move(s, 0, 1);        // [1,0,2,3]
  s = remove(s, 3);         // [1,0,2]
  s = duplicate(s, 1);      // [1,0,0,2]
  s = setFps(s, 12);
  s = togglePingPong(s);
  check('walk: reorder, remove, duplicate, 12 fps, ping-pong -> [1,0,0,2,0,0] at 12',
    eq(playback(s), [1, 0, 0, 2, 0, 0]) && s.fps === 12);
  check('walk: reset restores 4 frames at 8 fps', eq(createSequence(4), seqOf([0, 1, 2, 3])));
}

console.log(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
