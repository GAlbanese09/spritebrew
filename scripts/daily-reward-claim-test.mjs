// scripts/daily-reward-claim-test.mjs
//
// Offline tests for the shared daily-reward claimer (src/lib/dailyRewardClaim.ts):
// at most one POST per signed-in user per page load, shared by every caller
// and every remount, never a second one (after a refusal, another user or a
// sign-out), no POST from an attempt invalidated while its token was pending,
// and a stale answer never applied. Counts POSTs, not only applies. Run from
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

/** A claimer whose POSTs answer when the test says so. */
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
  const tokens = () => posts.map((p) => p.token).join(',');
  return { claimer, posts, applied, answer, tokens };
}
const token = (t) => async () => t;
/** A token the test hands over later. */
function heldToken(t) {
  let release;
  const promise = new Promise((r) => { release = () => r(t); });
  return { get: () => promise, release };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// Shared attempt, remounts, refusals

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

// Other users: one attempt each, never a second for the same user

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
  const a1 = h.claimer.claimOnce('A', token('a'));
  await tick();
  h.claimer.claimOnce('B', token('b'));
  await tick();
  const a2 = h.claimer.claimOnce('A', token('a'));
  await tick();
  check('A, B, A with A pending: POSTs A, B only', h.tokens() === 'a,b');
  check('A, B, A returns A\'s first attempt', a1 === a2);
  h.answer(0, 200, { ...OK_BODY, balance: 7 });
  await a1;
  check('A\'s answer applies once A is current again', h.applied.length === 1 && h.applied[0].balance === 7);
}

{
  const h = harness();
  const a = h.claimer.claimOnce('A', token('a'));
  await tick();
  h.answer(0, 200, OK_BODY);
  await a;
  h.claimer.claimOnce('B', token('b'));
  await tick();
  h.claimer.claimOnce('A', token('a'));
  await tick();
  check('A, B, A with A settled: POSTs A, B only', h.tokens() === 'a,b');
}

{
  const h = harness();
  const a = h.claimer.claimOnce('A', token('a'));
  await tick();
  h.answer(0, 401, { success: false });
  await a;
  h.claimer.claimOnce('B', token('b'));
  await tick();
  for (let i = 0; i < 5; i++) h.claimer.claimOnce('A', token('a'));
  await tick();
  check('A refused, then B, then A again: A is never retried', h.tokens() === 'a,b');
}

// Sign-out (reset): no new POST for the same user, no late apply

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
  check('after reset, the same user does not claim again this page load', h.posts.length === 1);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('A', token('a'));
  await tick();
  h.claimer.reset();
  for (let i = 0; i < 5; i++) h.claimer.claimOnce('A', token('a'));
  await tick();
  check('remounts during a pending sign-out send no new POST', h.posts.length === 1);
  h.answer(0, 200, OK_BODY);
  await p;
  check('the answer after that sign-out started is not applied', h.applied.length === 0);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('A', token('a'));
  await tick();
  h.answer(0, 401, { success: false });
  await p;
  h.claimer.reset();
  // signOut() fails: the user is still A, and the sidebar remounts.
  for (let i = 0; i < 5; i++) h.claimer.claimOnce('A', token('a'));
  await tick();
  check('after a refusal and a failed sign-out, remounts send no new POST', h.posts.length === 1);
}

{
  const h = harness();
  const p = h.claimer.claimOnce('A', token('a'));
  await tick();
  h.claimer.reset();
  h.claimer.claimOnce('B', token('b'));
  await tick();
  check('after a sign-out, a different user gets its own POST', h.tokens() === 'a,b');
  h.answer(0, 200, { ...OK_BODY, balance: 1 });
  await p;
  check('the signed-out user\'s late answer is not applied', h.applied.length === 0);
}

// Invalidated while the token was pending: the obsolete attempt never POSTs

{
  const h = harness();
  const held = heldToken('a-old');
  const p = h.claimer.claimOnce('A', held.get);
  await tick();
  h.claimer.reset();
  const again = h.claimer.claimOnce('A', token('a-new'));
  await tick();
  held.release();
  await p;
  await tick();
  check('reset while A waits for its token: A never POSTs', h.posts.length === 0);
  check('a call for A after that reset gets the same attempt', again === p);
}

{
  const h = harness();
  const held = heldToken('a');
  const p = h.claimer.claimOnce('A', held.get);
  await tick();
  h.claimer.claimOnce('B', token('b'));
  await tick();
  held.release();
  await p;
  await tick();
  check('B replaces A while A waits for its token: only B POSTs', h.tokens() === 'b');
}

{
  const h = harness();
  const held = heldToken('a');
  const p = h.claimer.claimOnce('A', held.get);
  await tick();
  h.claimer.claimOnce('B', token('b'));
  await tick();
  h.claimer.claimOnce('A', token('a'));
  held.release();
  await tick();
  await tick();
  check('A, B, A while A\'s token is pending: A posts once, when current again', h.tokens() === 'b,a');
  h.answer(1, 200, { ...OK_BODY, balance: 9 });
  await p;
  check('that A answer applies, since A is current', h.applied.length === 1 && h.applied[0].balance === 9);
}

process.exit(failed ? 1 : 0);
