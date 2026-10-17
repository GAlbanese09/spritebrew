// scripts/daily-reward-claim-test.mjs
//
// Offline tests for the shared daily-reward claimer (src/lib/dailyRewardClaim.ts):
// one POST per signed-in user per page load, shared by every caller and every
// remount, no retry after a refusal, and a stale answer never applied. Run from
// the repo root: `node scripts/daily-reward-claim-test.mjs`. Bundles the module
// with esbuild into local/.daily-reward-claim-test/ (gitignored). Prints only
// case names and pass or fail. No network.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.daily-reward-claim-test', 'dailyRewardClaim.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/dailyRewardClaim.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'silent',
});
const { createDailyRewardClaimer } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const OK_BODY = { success: true, streak: { count: 2, lifetimeMax: 5 }, balance: 33, emailListClaimed: false, rewards: [{ type: 'daily_login', amount: 3, streakDay: 2 }] };

/** A claimer whose POST answers when the test says so. */
function harness() {
  const posts = [];
  const applied = [];
  const claimer = createDailyRewardClaimer({
    post: (token) =>
      new Promise((resolve, reject) => {
        posts.push({ token, resolve, reject });
      }),
    apply: (data) => applied.push(data),
  });
  const answer = (i, status, body) =>
    posts[i].resolve({ ok: status >= 200 && status < 300, json: async () => body });
  return { claimer, posts, applied, answer };
}
const token = (t) => async () => t;
const tick = () => new Promise((r) => setTimeout(r, 0));

{
  const h = harness();
  const a = h.claimer.claimOnce('u1', token('t'));
  const b = h.claimer.claimOnce('u1', token('t'));
  await tick();
  check('two callers on one page load send one POST', h.posts.length === 1);
  check('both callers share the same promise', a === b);
  h.answer(0, 200, OK_BODY);
  await a;
  check('the answer is applied once', h.applied.length === 1 && h.applied[0].balance === 33);
  for (let i = 0; i < 18; i++) h.claimer.claimOnce('u1', token('t'));
  await tick();
  check('18 remounts after it settles send no new POST', h.posts.length === 1 && h.applied.length === 1);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('u1', token('t'));
  await tick();
  h.answer(0, 401, { success: false, error: 'unauthorized' });
  await p;
  for (let i = 0; i < 18; i++) h.claimer.claimOnce('u1', token('t'));
  await tick();
  check('a 401 is not retried this page load', h.posts.length === 1);
  check('a 401 applies nothing', h.applied.length === 0);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('u1', token('t'));
  await tick();
  h.answer(0, 200, { success: false, error: 'paused' });
  await p;
  check('success false on a 200 applies nothing', h.applied.length === 0);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('u1', token('t'));
  await tick();
  h.posts[0].reject(new Error('network'));
  let rejected = false;
  await p.catch(() => { rejected = true; });
  h.claimer.claimOnce('u1', token('t'));
  await tick();
  check('a network error never rejects the shared promise', !rejected);
  check('a network error is not retried this page load', h.posts.length === 1 && h.applied.length === 0);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('u1', token(null));
  await p;
  h.claimer.claimOnce('u1', token('t'));
  await tick();
  check('no token: no POST, and none later this page load', h.posts.length === 0);
}

{
  const h = harness();
  const p1 = h.claimer.claimOnce('u1', token('t1'));
  await tick();
  const p2 = h.claimer.claimOnce('u2', token('t2'));
  await tick();
  check('a different user gets its own POST', h.posts.length === 2 && h.posts[1].token === 't2');
  h.answer(0, 200, { ...OK_BODY, balance: 1 });
  await p1;
  check("the first user's late answer is dropped", h.applied.length === 0);
  h.answer(1, 200, { ...OK_BODY, balance: 2 });
  await p2;
  check("the current user's answer is applied", h.applied.length === 1 && h.applied[0].balance === 2);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('u1', token('t'));
  await tick();
  h.claimer.reset();
  h.answer(0, 200, OK_BODY);
  await p;
  check('an answer landing after sign-out (reset) is dropped', h.applied.length === 0);
  h.claimer.claimOnce('u1', token('t'));
  await tick();
  check('after reset, signing in again claims again', h.posts.length === 2);
}

process.exit(failed ? 1 : 0);
