// scripts/latest-run-test.mjs
//
// Offline tests for the latest-run tracker (src/lib/latestRun.ts) that
// SpriteDetector's runDetection uses so overlapping detection runs cannot
// mix one image's canvas with another's regions, or let an older run that
// finishes last overwrite a newer one. Run from the repo root:
// `node scripts/latest-run-test.mjs`. Bundles the module with esbuild into
// local/.latest-run-test/ (gitignored). Prints only case names and pass or
// fail.
//
// Each case replays a detection run the way runDetection does: a run starts,
// awaits (loadImage, then the paint yield), checks isLatest after each await,
// and writes its results only when still the latest. The "writes" here are a
// plain record of which run wrote the canvas and the regions, and which run
// cleared `detecting`.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.latest-run-test', 'latestRun.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/latestRun.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { createLatestRun } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

/**
 * A detection run as a step machine: `run.load()` is the first await
 * (loadImage) returning, `run.paint()` the second (the paint yield), and
 * `run.finish()` the body after it. Each step returns whether the run went
 * on; a stale run returns without writing. `state` is what React state and
 * the refs would hold.
 */
function makeRun(tracker, state, image) {
  const isLatest = tracker.start();
  const run = {
    image,
    stale: false,
    load() {
      if (!isLatest()) { run.stale = true; run.finally(); return false; }
      return true;
    },
    paint() {
      if (!isLatest()) { run.stale = true; run.finally(); return false; }
      return true;
    },
    finish() {
      if (!isLatest()) { run.stale = true; run.finally(); return false; }
      state.canvas = image;
      state.regions = `regions of ${image}`;
      state.detectedUrl = image;
      run.finally();
      return true;
    },
    finally() {
      if (isLatest()) state.detecting = false;
    },
  };
  state.detecting = true;
  return run;
}

/** Drive a run to its end in one go. */
function complete(run) {
  return run.load() && run.paint() && run.finish();
}

const fresh = () => ({ canvas: null, regions: null, detectedUrl: null, detecting: false });

// ── Order 1: one run, no overlap ──
{
  const tracker = createLatestRun();
  const state = fresh();
  const a = makeRun(tracker, state, 'A');
  check('single run: starts detecting, writes canvas and regions from A, clears detecting',
    complete(a) === true && state.canvas === 'A' && state.regions === 'regions of A' &&
    state.detectedUrl === 'A' && state.detecting === false);
}

// ── Order 2: A starts, B starts before A's image loads, A finishes first, then B ──
{
  const tracker = createLatestRun();
  const state = fresh();
  const a = makeRun(tracker, state, 'A');
  const b = makeRun(tracker, state, 'B');
  const aWent = a.load();
  check('A then B, A loads after B started: A is stale at its first await and writes nothing',
    aWent === false && a.stale && state.canvas === null && state.regions === null);
  check('A stale: detecting stays true (only the latest run clears it)', state.detecting === true);
  check('B completes: canvas and regions both from B, detecting cleared',
    complete(b) === true && state.canvas === 'B' && state.regions === 'regions of B' && state.detecting === false);
}

// ── Order 3: A loads its image, B starts during A's paint yield, B finishes, then A ──
{
  const tracker = createLatestRun();
  const state = fresh();
  const a = makeRun(tracker, state, 'A');
  check('A passes its first await while still the latest', a.load() === true);
  const b = makeRun(tracker, state, 'B');
  check('B completes first: state is from B', complete(b) === true && state.canvas === 'B' && state.detectedUrl === 'B');
  const aWent = a.paint();
  check('A resumes after B finished: stale at the paint yield, nothing overwritten',
    aWent === false && state.canvas === 'B' && state.regions === 'regions of B' && state.detectedUrl === 'B');
  check('detecting stays false after the stale run returns', state.detecting === false);
}

// ── Order 4: the old bug's exact shape: A set the canvas at its first await, B set regions ──
// With the tracker, A never reaches the write at all, so the mixed state
// (canvas A, regions B) cannot happen.
{
  const tracker = createLatestRun();
  const state = fresh();
  const a = makeRun(tracker, state, 'A');
  a.load();
  a.paint();
  const b = makeRun(tracker, state, 'B');
  const aFinish = a.finish();
  const bDone = complete(b);
  check('A past both awaits when B starts: A still cannot write; B writes canvas and regions together',
    aFinish === false && bDone === true && state.canvas === 'B' && state.regions === 'regions of B');
}

// ── Order 5: three runs, the middle one finishes last ──
{
  const tracker = createLatestRun();
  const state = fresh();
  const a = makeRun(tracker, state, 'A');
  const b = makeRun(tracker, state, 'B');
  const c = makeRun(tracker, state, 'C');
  const rA = complete(a);
  const rC = complete(c);
  const rB = complete(b);
  check('A, B, C started; A then C then B finish: only C writes',
    rA === false && rC === true && rB === false && state.canvas === 'C' && state.regions === 'regions of C');
  check('detecting cleared by C, not re-set by the stale B', state.detecting === false);
  check('tracker counted three runs', tracker.count() === 3);
}

// ── Order 6: Re-detect on the same image during a run ──
{
  const tracker = createLatestRun();
  const state = fresh();
  const a = makeRun(tracker, state, 'A');
  a.load();
  const again = makeRun(tracker, state, 'A');
  const rA = a.paint();
  const rAgain = complete(again);
  check('Re-detect during a run: the first run is stale, the second writes A and clears detecting',
    rA === false && rAgain === true && state.detectedUrl === 'A' && state.detecting === false);
}

// ── Results are current only for the prop's image ──
{
  const tracker = createLatestRun();
  const state = fresh();
  complete(makeRun(tracker, state, 'A'));
  const currentFor = (prop) => state.detectedUrl === prop;
  check('results for A are current while the prop is A', currentFor('A') === true);
  check('once the prop is B and before B is detected, the A results are not current', currentFor('B') === false);
  complete(makeRun(tracker, state, 'B'));
  check('after B is detected its results are current', currentFor('B') === true);
}

process.exit(failed ? 1 : 0);
