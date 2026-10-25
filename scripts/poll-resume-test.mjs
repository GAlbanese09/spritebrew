// scripts/poll-resume-test.mjs
//
// Offline tests for resumeDecision (src/lib/pollResume.ts): when the
// generation poll (src/hooks/useGenerationPoll.ts) resumes a saved job on
// mount. Run from the repo root: `node scripts/poll-resume-test.mjs`.
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
const { resumeDecision, STALE_THRESHOLD_MS } = await import(pathToFileURL(OUT).href);

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

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
