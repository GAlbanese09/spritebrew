// scripts/poll-resume-test.mjs
//
// Offline tests for src/lib/pollResume.ts: resumeDecision, when the
// generation poll (src/hooks/useGenerationPoll.ts) resumes a saved job on
// mount; parseJobContext, the click-time context saved with the job; and
// finishedJob, what a finished job writes from it, whichever form finishes
// it. Run from the repo root: `node scripts/poll-resume-test.mjs`.
// Bundles the module with esbuild into local/.poll-resume-test/ (gitignored).
// Prints only case names and pass or fail.
//
// The hook's lifecycle (aborting on unmount, keeping the saved job, a form
// that unmounted handing its job to the one on screen) needs a browser; it
// was checked in Chromium against main's hook, five scenarios.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.poll-resume-test', 'pollResume.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/pollResume.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { resumeDecision, STALE_THRESHOLD_MS, parseJobContext, isAnimateContext, finishedJob } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const LOADED = 1_800_000_000_000;
const MIN = 60 * 1_000;

check('the stale limit is 10 minutes', STALE_THRESHOLD_MS === 10 * MIN);
check('nothing saved: none', resumeDecision(null, LOADED + MIN, LOADED) === 'none');
check('a job started in this page session, back after 1 minute: resume',
  resumeDecision({ startedAt: LOADED + MIN }, LOADED + 2 * MIN, LOADED) === 'resume');
check('a job started in this page session, back after 11 minutes: resume (was dropped, leaving "Brewing...")',
  resumeDecision({ startedAt: LOADED + MIN }, LOADED + 12 * MIN, LOADED) === 'resume');
check('a job started in this page session, back after 2 hours: resume (the poll reports what it finds)',
  resumeDecision({ startedAt: LOADED + MIN }, LOADED + 121 * MIN, LOADED) === 'resume');
check('a job from an earlier visit, 5 minutes old: resume (a reload mid-generation)',
  resumeDecision({ startedAt: LOADED - 4 * MIN }, LOADED + MIN, LOADED) === 'resume');
check('a job from an earlier visit, 11 minutes old: drop',
  resumeDecision({ startedAt: LOADED - 10 * MIN }, LOADED + MIN, LOADED) === 'drop');
check('a job from an earlier visit, exactly at the limit: resume',
  resumeDecision({ startedAt: LOADED - 9 * MIN }, LOADED + MIN, LOADED) === 'resume');
check('a job saved the moment the page loaded counts as this session',
  resumeDecision({ startedAt: LOADED }, LOADED + 30 * MIN, LOADED) === 'resume');

// The click-time context saved with a job (history gap, HQ 2026-10-27-017):
// kept when it fits the job's mode, copied field by field, else none.
const CREATE = { prompt: 'knight with sword', styleId: 'plus-classic' };
const ANIMATE = { action: 'attack', motionPrompt: '', bgColor: '#FF00FF', frameCount: 6, frameSize: 128 };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('context: a Create context on a Create job is kept', same(parseJobContext('create', CREATE), CREATE));
check('context: an Animate context on an Animate job is kept', same(parseJobContext('animate', ANIMATE), ANIMATE));
check('context: fields it does not know are dropped', same(parseJobContext('create', { ...CREATE, extra: 1 }), CREATE));
check('context: none saved (a job saved before contexts were): none',
  parseJobContext('create', undefined) === undefined && parseJobContext('animate', null) === undefined);
check('context: a Create context on an Animate job: none', parseJobContext('animate', CREATE) === undefined);
check('context: an Animate context on a Create job: none', parseJobContext('create', ANIMATE) === undefined);
check('context: an Animate context without its frame size: none',
  parseJobContext('animate', { ...ANIMATE, frameSize: undefined }) === undefined);
check('context: a frame count of 0, or not a whole number: none',
  parseJobContext('animate', { ...ANIMATE, frameCount: 0 }) === undefined &&
  parseJobContext('animate', { ...ANIMATE, frameCount: 2.5 }) === undefined);
check('context: a prompt that is not text: none', parseJobContext('create', { prompt: 3, styleId: 'plus-classic' }) === undefined);
check('context: text is not a context', parseJobContext('create', 'knight') === undefined);
check('context: isAnimateContext tells the two apart',
  isAnimateContext(ANIMATE) && !isAnimateContext(CREATE) && !isAnimateContext(null));

// What a finished job writes (the Recent entry's prompt and style, and an
// animation's hints), the same whichever form finishes it.
const RESCUE = { rescued: true, deliveredCellSize: 64, deliveredFrames: 4 };
check('finish: no context (a job saved before contexts were) writes nothing',
  finishedJob(null, null) === null && finishedJob(undefined, RESCUE) === null);
check('finish: a Create job writes its prompt and style',
  same(finishedJob(CREATE, null), { prompt: 'knight with sword', style: 'plus-classic' }));
check('finish: a Create job ignores rescue fields', same(finishedJob(CREATE, RESCUE), { prompt: 'knight with sword', style: 'plus-classic' }));
check('finish: an Animate job writes its action (no motion prompt), its style, and the requested frames and cell size',
  same(finishedJob(ANIMATE, null), { prompt: 'attack', style: 'any_animation_attack', animate: { frameCount: 6, frameSize: 128 } }));
check('finish: an Animate job with a motion prompt writes it', finishedJob({ ...ANIMATE, motionPrompt: 'two quick swings' }, null)?.prompt === 'two quick swings');
check('finish: a rescued animation takes the delivered cell size and keeps the rescue',
  same(finishedJob(ANIMATE, RESCUE), { prompt: 'attack', style: 'any_animation_attack', animate: { frameCount: 6, frameSize: 64, rescueInfo: RESCUE } }));
check('finish: a rescue that reports no cell size takes 64', finishedJob(ANIMATE, { rescued: true })?.animate?.frameSize === 64);

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
