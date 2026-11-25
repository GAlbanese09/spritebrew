// scripts/playback-test.mjs
//
// The Animation Player's frame order (external product audit r2, SB-09):
// with Ping-pong on, four frames play 0,1,2,3,2,1,0,1,... and the direction
// is kept across ordinary frame changes; it is reset only when playback
// restarts (Stop), another animation is chosen, or Ping-pong is turned on.
// Runs src/lib/playback.ts, and checks by text that the player steps with it
// and that its animation loop no longer resets the direction on every frame.
// The browser check is in BUILD's harness (build/harness/ext-mediums/).
// Run from the repo root: `node scripts/playback-test.mjs`. Bundles with
// esbuild into local/.playback-test/ (gitignored). Prints only case names and
// pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
}

let P = null;
try {
  const OUT_DIR = path.join(ROOT, 'local', '.playback-test');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outfile = path.join(OUT_DIR, 'playback.mjs');
  await build({ entryPoints: [path.join(ROOT, 'src/lib/playback.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
  P = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
} catch {
  P = null;
}

// Play `ticks` steps from frame 0, forward, and list the frames shown.
function play(total, ticks, pingPong, loop) {
  let s = { frame: 0, dir: 1 };
  const seq = [s.frame];
  for (let i = 0; i < ticks; i++) { s = P.stepPlayback(s.frame, s.dir, total, pingPong, loop); seq.push(s.frame); }
  return seq;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. The step ──
check('1a: src/lib/playback.ts exports stepPlayback', !!P && typeof P.stepPlayback === 'function');
if (P && typeof P.stepPlayback === 'function') {
  const four = play(4, 9, true, true);
  check('1b: Ping-pong and Loop on four frames: 0,1,2,3,2,1,0,1,2,3', same(four, [0, 1, 2, 3, 2, 1, 0, 1, 2, 3]), four);
  const two = play(2, 5, true, true);
  check('1c: two frames: 0,1,0,1,0,1', same(two, [0, 1, 0, 1, 0, 1]), two);
  const one = play(1, 3, true, true);
  check('1d: one frame stays on 0', same(one, [0, 0, 0, 0]), one);
  const once = play(4, 8, true, false);
  check('1e: Ping-pong without Loop plays there and back once, then holds the first frame', same(once, [0, 1, 2, 3, 2, 1, 0, 0, 0]), once);
  const fwd = play(4, 5, false, true);
  check('1f: forward with Loop: 0,1,2,3,0,1', same(fwd, [0, 1, 2, 3, 0, 1]), fwd);
  const end = play(4, 5, false, false);
  check('1g: forward without Loop holds the last frame', same(end, [0, 1, 2, 3, 3, 3]), end);
  const doneAt = (total, pingPong) => { let s = { frame: 0, dir: 1 }; for (let i = 0; i < 20; i++) { s = P.stepPlayback(s.frame, s.dir, total, pingPong, false); if (s.done) return [i + 1, s.frame]; } return null; };
  check('1j: without Loop a pass says when it ends: forward on the last frame, Ping-pong back on the first (L8)',
    JSON.stringify(doneAt(4, false)) === '[3,3]' && JSON.stringify(doneAt(4, true)) === '[6,0]' && !P.stepPlayback(1, 1, 4, false, true).done && !P.stepPlayback(3, 1, 4, true, true).done,
    [doneAt(4, false), doneAt(4, true)]);
  const back = P.stepPlayback(2, -1, 4, true, true);
  check('1h: the direction is carried in and out: from frame 2 going back, the next is 1, still going back', back.frame === 1 && back.dir === -1, back);
  const far = P.stepPlayback(9, 1, 4, true, true);
  check('1i: a frame past the end (a shorter animation) comes back in range', far.frame >= 0 && far.frame < 4, far);
}

// ── 2. The player uses it ──
{
  const src = fs.readFileSync(path.join(ROOT, 'src/components/sprites/AnimationPlayer.tsx'), 'utf8');
  const start = src.indexOf('// Animation loop');
  const loopSrc = start >= 0 ? src.slice(start, src.indexOf('}, [', start) + 200) : '';
  check('2a: the player steps with stepPlayback', /stepPlayback\(/.test(src) && /from '@\/lib\/playback'/.test(src));
  check('2b: the animation loop does not reset the direction', loopSrc.length > 0 && !/pingPongDirRef\.current = 1/.test(loopSrc));
  check('2c: the animation loop does not restart on every frame change', loopSrc.length > 0 && !/\[[^\]]*\bcurrentFrame\b[^\]]*\]\);/.test(loopSrc));
  const stopStart = src.indexOf('const handleStop = () => {');
  const stopSrc = src.slice(stopStart, src.indexOf('\n  };', stopStart));
  check('2d: Stop and choosing another animation reset the direction',
    /pingPongDirRef\.current = 1;/.test(stopSrc) && /setSelectedAnimId\(e\.target\.value\);\s*setCurrentFrame\(0\);\s*pingPongDirRef\.current = 1;/.test(src));
  check('2d2: the animation shown changing, by any route, starts it forward (AUDIT ext-mediums r1 L7)',
    /useEffect\(\(\) => \{\s*pingPongDirRef\.current = 1;\s*\}, \[animId\]\);/.test(src));
  check('2f: without Loop, the end of a pass stops playing, so the button shows Play; Play from there starts again (L8)',
    /if \(step\.done\) \{\s*endedRef\.current = true;\s*setPlaying\(false\);/.test(src)
    && /const togglePlay = \(\) => \{[\s\S]{0,300}if \(!playing && endedRef\.current\) \{[\s\S]{0,200}setCurrentFrame\(0\);[\s\S]{0,100}pingPongDirRef\.current = 1;/.test(src)
    && /onClick=\{togglePlay\}/.test(src));
  check('2e: turning Ping-pong on starts it forward',
    /const togglePingPong = \(\) => \{[^}]*pingPongDirRef\.current = 1;[^}]*setPingPong\(/.test(src) && /onClick=\{togglePingPong\}/.test(src));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
