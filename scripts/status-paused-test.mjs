// scripts/status-paused-test.mjs
//
// Offline tests for status-paused 006 (Second 087): while money is paused, the
// status route gives every pending or running job older than 60 s the paused
// copy, and the copy is true for each of them: a job waiting to start, a held
// retry, a failure awaiting its refund, and a job still at RD. The consumer holds
// running records without a taskId while paused, and the route cannot see which,
// so the predicate is main's (93adb4d) and only the copy changed. Run from the
// repo root: `node scripts/status-paused-test.mjs`.
//
// The route is bundled with esbuild the way s0-test.mjs bundles it. KV and the R2
// mirror (GALLERY_BUCKET, key jobs/<id>.json) hold the job records, and LEDGER_DB
// is a one-row stub that answers the pause read and counts it. The harness writes
// only its bundle, to local/.status-paused-test (gitignored), and prints only case
// names and pass or fail.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const subtle = webcrypto.subtle;
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.status-paused-test');

// ── Session token (in memory only) ──

const pair = await subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64');
const PEM = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const enc = (obj) => b64u(Buffer.from(JSON.stringify(obj)));
async function tokenFor(sub) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'test_kid' })}.${enc({
    iss: 'https://needed-blowfish-74.clerk.accounts.dev', sub, sid: 'sess_test',
    azp: 'https://dev.spritebrew.pages.dev', iat: now - 10, nbf: now - 10, exp: now + 300,
  })}`;
  return `${input}.${b64u(await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, Buffer.from(input)))}`;
}

// ── Stubs ──

let kvMap = new Map(), r2Map = new Map();
let pauseValue = '0', pauseFails = false, pauseReads = 0;
function ledgerStub() {
  return {
    prepare(sql) {
      const stmt = {
        first: async () => {
          if (/money_pause/.test(sql)) pauseReads++;
          if (pauseFails) throw new Error('stub: pause read failed');
          return /money_pause/.test(sql) ? { value: pauseValue } : null;
        },
        run: async () => ({ meta: { changes: 0 } }),
        all: async () => ({ results: [] }),
      };
      stmt.bind = () => stmt;
      return stmt;
    },
  };
}
function reset({ paused = false, fails = false } = {}) {
  kvMap = new Map(); r2Map = new Map(); pauseValue = paused ? '1' : '0'; pauseFails = fails; pauseReads = 0;
  process.env = { ...process.env };
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid',
    LEDGER_DB: ledgerStub(),
    SPRITEBREW_KV: { get: async (k) => (kvMap.has(k) ? kvMap.get(k) : null) },
    GALLERY_BUCKET: {
      get: async (k) => (r2Map.has(k) ? { text: async () => r2Map.get(k) } : null),
      put: async () => ({}),
    },
  });
}
console.warn = () => {};
console.error = () => {};
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[status-paused-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[status-paused-test] ', '') : x));
})(console.log);
const say = (...a) => console.log('[status-paused-test]', ...a);

// ── Bundle ──

await build({
  entryPoints: { status: path.join(ROOT, 'src/app/api/generation-status/[jobId]/route.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const R = await import(pathToFileURL(path.join(OUT, 'status.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const USER = 'user_STATUSPAUSEDTESTSTATUSPA1';
const tok = await tokenFor(USER);
const JOB = 'job-status-paused-test-0001';
const KV_KEY = `job:${JOB}`, R2_KEY = `jobs/${JOB}.json`;
const COPY = "SpriteBrew is finishing some maintenance, so this may take longer than usual. If your generation can't finish, its tokens will be returned.";
async function get({ kv, r2 } = {}, opts) {
  reset(opts);
  if (kv) kvMap.set(KV_KEY, JSON.stringify({ userId: USER, ...kv }));
  if (r2) r2Map.set(R2_KEY, JSON.stringify({ userId: USER, ...r2 }));
  const res = await R.GET(new Request(`https://dev.spritebrew.pages.dev/api/generation-status/${JOB}`, {
    headers: { Authorization: `Bearer ${tok}` },
  }), { params: Promise.resolve({ jobId: JOB }) });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { res, text, body, source: res.headers.get('x-sb-status-source') };
}
const hasCopy = (b) => b?.paused === true && b?.message === COPY;
const noCopy = (b) => b && !('paused' in b) && !('message' in b);
const OLD = () => Date.now() - 120_000;
const DUE = { errorCode: 'rd_error', at: 1, error: 'generation failed while money writes were paused' };

// ── Paused: every pending or running job over 60 s gets the copy (KV and R2) ──
const JOBS = () => [
  ['pending', { status: 'pending', enqueuedAt: OLD() }],
  ['running with taskId (still at RD)', { status: 'running', enqueuedAt: OLD(), startedAt: OLD(), taskId: 'task-1' }],
  ['running with releasedAt (a released Create retry)', { status: 'running', enqueuedAt: OLD(), startedAt: OLD(), releasedAt: OLD() }],
  ['running with submitAttemptedAt and no taskId (an orphaned submit)', { status: 'running', enqueuedAt: OLD(), startedAt: OLD(), submitAttemptedAt: OLD() }],
  ['running with no markers', { status: 'running', startedAt: OLD() }],
  ['running with a refundDue object', { status: 'running', enqueuedAt: OLD(), startedAt: OLD(), refundDue: DUE }],
];
for (const [label, rec] of JOBS()) {
  let r = await get({ kv: rec }, { paused: true });
  check(`paused, KV, ${label}, over 60 s: the copy`, r.res.status === 200 && hasCopy(r.body) && r.body.status === rec.status && pauseReads === 1);
  r = await get({ r2: rec }, { paused: true });
  check(`paused, R2 only, ${label}, over 60 s: the copy, served from R2`, hasCopy(r.body) && r.source === 'r2');
  r = await get({ kv: rec }, { paused: false });
  check(`open, ${label}, over 60 s: no copy`, r.res.status === 200 && noCopy(r.body));
}
{
  const startedAt = OLD();
  const r = await get({ kv: { status: 'running', startedAt, taskId: 't' } }, { paused: true });
  check('paused, running: startedAt still returned beside the copy', hasCopy(r.body) && r.body.startedAt === startedAt);
}

// Second's split store: a stale nonterminal R2 record, a newer KV record with refundDue.
{
  const stale = { status: 'running', enqueuedAt: OLD(), startedAt: OLD() };
  const newer = { status: 'running', enqueuedAt: OLD(), startedAt: OLD(), refundDue: DUE };
  let r = await get({ r2: stale, kv: newer }, { paused: true });
  check('paused, stale nonterminal R2 plus newer KV with refundDue: the copy (R2 served, as the read rule says)',
    r.res.status === 200 && hasCopy(r.body) && r.source === 'r2');
  r = await get({ r2: stale, kv: newer }, { paused: false });
  check('open, the same split store: no copy', noCopy(r.body));
  r = await get({ r2: { ...stale, status: 'pending' }, kv: newer }, { paused: true });
  check('paused, stale pending R2 plus newer running KV with refundDue: the copy', hasCopy(r.body));
}

// ── Controls ──
for (const [label, rec] of [
  ['pending', { status: 'pending', enqueuedAt: Date.now() - 10_000 }],
  ['running with refundDue', { status: 'running', startedAt: Date.now() - 10_000, refundDue: DUE }],
  ['running with taskId', { status: 'running', startedAt: Date.now() - 10_000, taskId: 't' }],
]) {
  const r = await get({ kv: rec }, { paused: true });
  check(`paused, ${label} under 60 s: no copy and no pause read`, noCopy(r.body) && pauseReads === 0);
}
for (const [label, rec] of [['pending', { status: 'pending', enqueuedAt: OLD() }], ['running', { status: 'running', startedAt: OLD(), taskId: 't' }]]) {
  const r = await get({ kv: rec }, { fails: true });
  check(`the pause read fails, ${label} over 60 s: the copy (fail closed)`, hasCopy(r.body) && pauseReads === 1);
}

// success and error answers: byte-equal to 93adb4d's for the same records (its
// jsonResponse is JSON.stringify of these fields in this order; undefined drops).
const TERMINAL = [
  ['success, plain', { status: 'success', resultBase64: 'AAAA', completedAt: 7 },
    '{"status":"success","resultBase64":"AAAA","completedAt":7}'],
  ['success, rescued', { status: 'success', resultBase64: 'BBBB', completedAt: 8, rescued: true, requestedWidth: 128,
    requestedHeight: 128, deliveredCellSize: 64, deliveredFrames: 4 },
    '{"status":"success","resultBase64":"BBBB","completedAt":8,"rescued":true,"requestedWidth":128,"requestedHeight":128,"deliveredCellSize":64,"deliveredFrames":4}'],
  ['error, refunded', { status: 'error', error: 'RD failed', errorCode: 'rd_error', refunded: true },
    '{"status":"error","error":"RD failed","errorCode":"rd_error","refunded":true}'],
  ['error, no refunded field', { status: 'error', error: 'RD failed', errorCode: 'rd_error' },
    '{"status":"error","error":"RD failed","errorCode":"rd_error","refunded":false}'],
];
for (const [label, rec, want] of TERMINAL) {
  for (const paused of [true, false]) {
    let r = await get({ kv: { ...rec, enqueuedAt: OLD() } }, { paused });
    check(`${label}, KV, ${paused ? 'paused' : 'open'}: 200, the same bytes as 93adb4d, no pause read`,
      r.res.status === 200 && r.text === want && r.source === 'kv' && pauseReads === 0);
    r = await get({ r2: { ...rec, enqueuedAt: OLD() } }, { paused });
    check(`${label}, R2, ${paused ? 'paused' : 'open'}: 200, the same bytes as 93adb4d, served from R2`,
      r.res.status === 200 && r.text === want && r.source === 'r2');
  }
}

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
