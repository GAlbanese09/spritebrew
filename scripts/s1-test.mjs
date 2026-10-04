// scripts/s1-test.mjs
//
// Offline tests for S1 on the Pages side (n1-release-2-spec.md revision 9:
// section 11's S1 row, 6.2, 10.1). Run from the repo root:
// `node scripts/s1-test.mjs`.
//
// - The library copy: src/lib/ledger.ts equals the consumer's src/ledger.ts
//   below the header, and the Pages bundle runs on the consumer's migrations
//   (0001 to 0003) in an in-memory SQLite through a D1-shaped adapter.
// - The dev harness route (src/app/api/admin/ledger-harness/route.ts),
//   bundled with esbuild into local/.s1-test (gitignored) and called with a
//   session token signed in memory by a key made for this run: the host, auth
//   and synthetic-user guards, with every D1 call counted; and T27's offline
//   part, that it binds no queue and never sends.
// - T1: release 1's KV balance code (src/lib/tokenBalance.ts) raced on an
//   in-memory KV with latency, 5 runs: expected 10,500, actual recorded.
//   S4 retires that code, so T1 bundles it from release 1's commit
//   (R1_COMMIT, read with `git archive` into local/.s1-r1, gitignored).
//
// S1_MUTATION='{"from":"...","to":"..."}' mutates the route source at bundle
// time (exit 1 caught, 0 survived, 3 target not found once). The consumer
// checkout must hold S1 (its n1-s1 branch). Output: counts and case names.

import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');
const subtle = webcrypto.subtle;
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.s1-test');
const CONSUMER = process.env.S1_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MUT = process.env.S1_MUTATION ? JSON.parse(process.env.S1_MUTATION) : null;
const MIG = ['0001_control.sql', '0002_stripe_refusals.sql', '0003_ledger.sql'].map((f) => path.join(CONSUMER, 'migrations-ledger', f));
for (const f of [...MIG, path.join(CONSUMER, 'src', 'ledger.ts')]) {
  if (!existsSync(f)) { console.log(`[s1-test] missing ${f}: check out the consumer's n1-s1 branch`); process.exit(1); }
}

const counts = new Map();
let failed = 0;
function check(tag, name, ok) {
  const c = counts.get(tag) ?? { pass: 0, fail: 0 };
  if (ok) c.pass++; else { c.fail++; failed++; console.log(`[s1-test] FAIL ${tag}: ${name}`); }
  counts.set(tag, c);
}

// ── Bundles ──

const mutation = {
  name: 'mutation',
  setup(b) {
    if (!MUT) return;
    b.onLoad({ filter: /ledger-harness[\\/]route\.ts$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const n = src.split(MUT.from).length - 1;
      if (n !== 1) { console.log(`[s1-test] mutation target found ${n} times`); process.exit(3); }
      return { contents: src.replace(MUT.from, MUT.to), loader: 'ts' };
    });
  },
};
// T1's release 1 code: S1's commit, before S4 moved the balances to D1.
const R1_COMMIT = '4ad2b7f';
const R1 = path.join(ROOT, 'local', '.s1-r1');
rmSync(R1, { recursive: true, force: true });
mkdirSync(R1, { recursive: true });
execSync(`git archive ${R1_COMMIT} src/lib | tar -x -C "${R1}"`, { cwd: ROOT });
const releaseOne = {
  name: 'release-1-lib',
  setup(b) {
    b.onResolve({ filter: /^@\/lib\// }, (a) => (a.importer.startsWith(R1)
      ? { path: path.join(R1, 'src', 'lib', `${a.path.slice('@/lib/'.length)}.ts`) }
      : undefined));
  },
};
await build({
  entryPoints: { tokenBalance: path.join(R1, 'src/lib/tokenBalance.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' }, plugins: [releaseOne],
});
await build({
  entryPoints: {
    route: path.join(ROOT, 'src/app/api/admin/ledger-harness/route.ts'),
    ledger: path.join(ROOT, 'src/lib/ledger.ts'),
    limits: path.join(ROOT, 'src/lib/generationLimits.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' }, plugins: [mutation],
});
const load = async (n) => import(pathToFileURL(path.join(OUT, `${n}.mjs`)).href + `?v=${Date.now()}`);
const route = await load('route');
const L = await load('ledger');
const { ADMIN_USER_IDS } = await load('limits');

// ── SQLite as D1 ──

function fresh() {
  const db = new DatabaseSync(':memory:');
  for (const f of MIG) db.exec(readFileSync(f, 'utf8'));
  return db;
}
const toBind = (v) => (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : v ?? null);
const isRead = (sql) => /^\s*(?:--[^\n]*\n\s*)*(SELECT|WITH)\b/i.test(sql);
let d1Calls = 0;
function d1(db) {
  return {
    prepare(sql) {
      d1Calls++;
      const stmt = { sql, values: [] };
      stmt.bind = (...v) => { stmt.values = v; return stmt; };
      return stmt;
    },
    async batch(stmts) {
      d1Calls++;
      await new Promise((r) => setImmediate(r));
      db.exec('BEGIN');
      try {
        const res = stmts.map((s) => {
          const p = db.prepare(s.sql);
          const vals = s.values.map(toBind);
          if (isRead(s.sql)) return { results: p.all(...vals).map((r) => ({ ...r })), meta: { changes: 0 } };
          const r = p.run(...vals);
          return { results: [], meta: { changes: Number(r.changes) } };
        });
        db.exec('COMMIT');
        return res;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
const ctl = (db) => db.prepare('SELECT key, value, updated_at_ms FROM control ORDER BY key').all().map((r) => `${r.key}=${r.value}@${r.updated_at_ms}`).join(',');

// ── The library copy ──

{
  const pages = readFileSync(path.join(ROOT, 'src/lib/ledger.ts'), 'utf8');
  const consumer = readFileSync(path.join(CONSUMER, 'src/ledger.ts'), 'utf8');
  const body = (s) => s.slice(s.indexOf('// BEGIN SHARED'));
  check('lib', 'src/lib/ledger.ts equals the consumer copy below its header', pages.includes('// BEGIN SHARED') && body(pages) === body(consumer));
  check('lib', 'the Pages header names the consumer copy', pages.slice(0, pages.indexOf('// BEGIN SHARED')).includes('spritebrew-rd-consumer/src/ledger.ts'));
  const db = fresh(); const c = { db: d1(db) };
  const o = await L.openBalance(c, { uid: 'ledgertest_1', amount: 100, reason: 'signup_bonus', source: 'signup', via: 'signup' });
  const d = await L.generationDebit(c, { uid: 'ledgertest_1', job: 'ledgertest_j1', cost: 16, mode: 'create', ckey: 'k', hash: 'h' });
  const r = await L.refundAndFinish(c, { job: 'ledgertest_j1', fence: 'recovery', code: 'x' });
  const m = await L.movement(c, { uid: 'ledgertest_1', type: 'credit', amount: 500, reason: 'token_pack_purchase', source: 'token_pack_purchase', idem: 'stripe:ledgertest_e1', event: 'ledgertest_e1' });
  check('lib', "the Pages bundle on 0001 to 0003: opened, charged, refunded, credited", o.outcome === 'opened' && d.outcome === 'charged'
    && r.outcome === 'refunded' && r.amount === 16 && m.outcome === 'applied' && m.balance === 600);
}

// ── Session tokens (in memory only) ──

const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64');
const PEM = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const enc = (obj) => b64u(Buffer.from(JSON.stringify(obj)));
async function token(sub, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://needed-blowfish-74.clerk.accounts.dev', sub, sid: 'sess_test', azp: 'https://dev.spritebrew.pages.dev', iat: now - 10, nbf: now - 10, exp: now + 60, ...over };
  const input = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'test_kid_dev' })}.${enc(payload)}`;
  return `${input}.${b64u(await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, Buffer.from(input)))}`;
}
const ADMIN = ADMIN_USER_IDS[ADMIN_USER_IDS.length - 1];
const adminTok = await token(ADMIN);
const userTok = await token('user_TESTTESTTESTTESTTESTTESTTEST');

let sends = 0;
let fetches = 0;
globalThis.fetch = async () => { fetches++; return new Response('{}', { status: 503 }); };
console.error = () => {};
console.warn = () => {};
function setEnv(appEnv, db) {
  process.env = { ...process.env };
  delete process.env.APP_ENV;
  Object.assign(process.env, {
    ...(appEnv ? { APP_ENV: appEnv } : {}), CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid_dev',
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret',
    LEDGER_DB: db ? d1(db) : undefined,
    RD_QUEUE: { send: async () => { sends++; }, sendBatch: async () => { sends++; } },
  });
}
const HOST = 'https://dev.spritebrew.pages.dev/api/admin/ledger-harness';
const call = (body, { url = HOST, tok = adminTok, method } = {}) => route.POST(new Request(url, {
  method: method ?? 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
  body: JSON.stringify(body),
}));
const res = async (r) => ({ status: r.status, body: r.status === 404 ? null : await r.json().catch(() => null) });

// ── The route's guards ──

{
  const db = fresh();
  const before = ctl(db);
  const op = { op: 'opening', args: { uid: 'ledgertest_1', amount: 30 } };
  const guard = async (name, env, opts, want) => {
    setEnv(env, db); d1Calls = 0;
    const r = await res(await call(op, opts));
    check('route', `${name}: ${want}, no D1 call`, r.status === want && d1Calls === 0 && (want !== 404 || r.body === null));
  };
  await guard('the production host', 'dev', { url: 'https://spritebrew.com/api/admin/ledger-harness' }, 404);
  await guard('www', 'dev', { url: 'https://www.spritebrew.com/api/admin/ledger-harness' }, 404);
  await guard('a preview hash host', 'dev', { url: 'https://1a2b3c4d.spritebrew.pages.dev/api/admin/ledger-harness' }, 404);
  await guard('a look-alike host', 'dev', { url: 'https://dev.spritebrew.pages.dev.example.com/api/admin/ledger-harness' }, 404);
  await guard('localhost', 'dev', { url: 'http://localhost:3000/api/admin/ledger-harness' }, 404);
  await guard("the dev host with APP_ENV 'production'", 'production', {}, 404);
  await guard('the dev host with APP_ENV unset', undefined, {}, 404);
  await guard('the production host, even with an admin token and APP_ENV production', 'production', { url: 'https://spritebrew.com/api/admin/ledger-harness' }, 404);
  await guard('no session token', 'dev', { tok: null }, 401);
  await guard('a forged token (wrong key)', 'dev', { tok: adminTok.slice(0, -4) + 'AAAA' }, 401);
  await guard('an expired token', 'dev', { tok: await token(ADMIN, { exp: Math.floor(Date.now() / 1000) - 100 }) }, 401);
  await guard("a token for production's origin", 'dev', { tok: await token(ADMIN, { azp: 'https://spritebrew.com' }) }, 401);
  await guard('a verified non-admin', 'dev', { tok: userTok }, 403);
  const bad = [
    ['a real-shaped user id', { op: 'opening', args: { uid: 'user_2abcdef', amount: 30 } }],
    ['ledgertest_ without a number', { op: 'opening', args: { uid: 'ledgertest_abc', amount: 30 } }],
    ['a job id without the prefix', { op: 'debit', args: { uid: 'ledgertest_1', job: 'job_x', cost: 5 } }],
    ['an idempotency key naming no synthetic subject', { op: 'movement', args: { uid: 'ledgertest_1', amount: 5, idem: 'support:2026-10-04:1' } }],
    ['a legacy key naming no synthetic subject', { op: 'movement', args: { uid: 'ledgertest_1', amount: 5, idem: 'stripe:ledgertest_e', legacy1: 'token_idempotency:evt_real' } }],
    ['an event id without the prefix', { op: 'pending', args: { event: 'evt_1Abc' } }],
    ['a seed of a real-shaped row', { op: 'seed', args: { table: 'jobs', row: { job_id: 'ledgertest_j', user_id: 'user_x', mode: 'create', provenance: 'd1', state: 'debited', created_at_ms: 1 } } }],
    ['a seed of the control table', { op: 'seed', args: { table: 'control', row: { key: 'money_pause', value: '1' } } }],
    ['a seed column outside the list', { op: 'seed', args: { table: 'jobs', row: { job_id: 'ledgertest_j', user_id: 'ledgertest_1', 'mode) VALUES (1); --': 1 } } }],
    ['a row read of a real user', { op: 'rows', args: { table: 'balances', id: 'user_x' } }],
    ['a race with one real user among synthetic ones', { op: 'race', args: { calls: [{ op: 'opening', args: { uid: 'ledgertest_2', amount: 1 } }, { op: 'opening', args: { uid: 'user_y', amount: 1 } }] } }],
    ['a race over the limit', { op: 'race', args: { calls: Array.from({ length: 51 }, (_, i) => ({ op: 'opening', args: { uid: `ledgertest_${i}`, amount: 1 } })) } }],
    ['a nested race', { op: 'race', args: { calls: [{ op: 'race', args: { calls: [{ op: 'opening', args: { uid: 'ledgertest_3', amount: 1 } }] } }] } }],
    ['the unpause (4.15)', { op: 'unpause', args: {} }],
    ['the kill switch (4.16)', { op: 'kill_pause', args: {} }],
    ["a Stripe refusal row", { op: 'refusal', args: { event: 'ledgertest_e' } }],
    ['an unknown op', { op: 'drop', args: {} }],
  ];
  for (const [name, body] of bad) {
    setEnv('dev', db); d1Calls = 0;
    const r = await res(await call(body));
    check('route', `refused before any statement: ${name} (400, no D1 call)`, r.status === 400 && d1Calls === 0);
  }
  check('route', 'no refused request changed a control row or wrote a row', ctl(db) === before
    && db.prepare("SELECT (SELECT COUNT(*) FROM ledger) + (SELECT COUNT(*) FROM jobs) + (SELECT COUNT(*) FROM balances) AS n").get().n === 0);
  setEnv('dev', db);
  check('route', 'GET is not served (POST only)', typeof route.GET === 'undefined');
}

// ── The route on synthetic data, and T27 (never sends) ──

{
  const db = fresh();
  setEnv('dev', db); sends = 0; fetches = 0;
  const before = ctl(db);
  const go = async (op, args) => res(await call({ op, args }));
  let r = await go('race', { calls: Array.from({ length: 5 }, () => ({ op: 'opening', args: { uid: 'ledgertest_7', amount: 30, reason: 'signup_bonus', source: 'signup' } })) });
  check('route', 'a race of five first touches through the route: one opening', r.status === 200 && r.body.result.filter((x) => x.outcome === 'opened').length === 1);
  r = await go('debit', { uid: 'ledgertest_7', job: 'ledgertest_j7', cost: 10 });
  check('route', 'a debit through the route: charged (and nothing enqueued)', r.status === 200 && r.body.result.outcome === 'charged');
  r = await go('enqueued', { job: 'ledgertest_j7' });
  check('route', "4.4's mark is only a row update", r.status === 200 && r.body.result === true);
  r = await go('seed', { table: 'jobs', row: { job_id: 'ledgertest_kv1', user_id: 'ledgertest_7', mode: 'create', provenance: 'kv', state: 'claimed', token_cost: 5, created_at_ms: 1 } });
  check('route', 'a synthetic seed (an imported row)', r.status === 200 && r.body.result.changes === 1);
  r = await go('refund', { job: 'ledgertest_kv1', fence: 'canceller', code: 'x' });
  check('route', "a canceller refund of it: refunded its token_cost", r.status === 200 && r.body.result.outcome === 'refunded' && r.body.result.amount === 5);
  r = await go('rows', { table: 'ledger', id: 'ledgertest_7' });
  check('route', 'a synthetic row read', r.status === 200 && r.body.result.length === 3);
  r = await go('sweep_list', {});
  check('route', 'the sweep list through the route (synthetic rows only)', r.status === 200 && Array.isArray(r.body.result));
  db.prepare("INSERT INTO jobs (job_id, user_id, mode, token_cost, provenance, state, created_at_ms) VALUES ('job_real', 'user_real', 'create', 5, 'kv', 'enqueued', 1)").run();
  db.prepare("UPDATE control SET value = '1700000000000' WHERE key = 'switch_at_ms'").run();
  r = await go('sweep_list', {});
  check('route', 'a non-synthetic row on the list is never answered', r.status === 200 && !JSON.stringify(r.body).includes('job_real'));
  db.prepare("UPDATE control SET value = '99999999999999' WHERE key = 'switch_at_ms'").run();
  r = await go('clear', {});
  const left = db.prepare("SELECT (SELECT COUNT(*) FROM ledger) + (SELECT COUNT(*) FROM balances) AS n").get().n;
  check('route', "clear: every synthetic row gone, the non-synthetic row kept, the control rows answered ('0', '0', the sentinel)",
    r.status === 200 && r.body.result.left.synthetic_left === 0 && left === 0 && !!db.prepare("SELECT 1 AS x FROM jobs WHERE job_id = 'job_real'").get()
    && r.body.result.controls.map((c) => `${c.key}=${c.value}`).join() === 'migration_open=0,money_pause=0,switch_at_ms=99999999999999');
  check('route', 'no op wrote a control row', ctl(db) === before);
  check('T27', 'the harness never sends: zero queue sends and zero fetches across every op', sends === 0 && fetches === 0);
  const src = readFileSync(path.join(ROOT, 'src/app/api/admin/ledger-harness/route.ts'), 'utf8');
  check('T27', 'the route names no queue binding and no send', !/RD_QUEUE|\.send\(|sendBatch|Queue\b/.test(src));
  setEnv('dev', undefined);
  const nb = await res(await call({ op: 'controls', args: {} }));
  check('route', 'no LEDGER_DB binding: 503', nb.status === 503);
}

// ── T1: the KV race on release 1's code ──

{
  const tb = await load('tokenBalance');
  const actual = [];
  for (let run = 1; run <= 5; run++) {
    const store = new Map();
    const lag = () => new Promise((r) => setTimeout(r, Math.random() * 3));
    const kv = {
      get: async (k) => { await lag(); return store.get(k) ?? null; },
      put: async (k, v) => { await lag(); store.set(k, v); },
      delete: async (k) => { store.delete(k); },
      list: async ({ prefix } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true }),
      getWithMetadata: async (k) => ({ value: store.get(k) ?? null, metadata: null }),
    };
    process.env = { ...process.env, APP_ENV: 'production', SPRITEBREW_KV: kv, LEDGER_DB: undefined };
    const now = new Date().toISOString();
    store.set('token_balance:ledgertest_t1', JSON.stringify({ balance: 1000, created_at: now, last_updated: now }));
    const work = [];
    for (let i = 0; i < 20; i++) {
      work.push(tb.creditTokens('ledgertest_t1', 500, 'token_pack_purchase', `t1:${run}:c${i}`, { source: 'token_pack_purchase' }));
      work.push(tb.debitTokens('ledgertest_t1', 25, `t1:${run}:d${i}`));
    }
    await Promise.all(work);
    actual.push(JSON.parse(store.get('token_balance:ledgertest_t1')).balance);
  }
  console.log(`[s1-test] T1: expected 10500 each run; actual ${actual.join(', ')}`);
  check('T1', 'the KV race, 5 runs: each run finished and its actual balance recorded', actual.length === 5 && actual.every((x) => Number.isInteger(x)));
}

// ── Summary ──
let total = 0;
for (const t of ['lib', 'route', 'T27', 'T1']) {
  const c = counts.get(t) ?? { pass: 0, fail: 0 };
  total += c.pass + c.fail;
  console.log(`[s1-test] ${t}: ${c.pass}/${c.pass + c.fail}`);
}
console.log(`[s1-test] ${failed === 0 ? 'PASS' : 'FAIL'}: ${total - failed}/${total}`);
process.exit(failed === 0 ? 0 : 1);
