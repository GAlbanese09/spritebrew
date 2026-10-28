// scripts/replay-first-test.mjs
//
// Offline tests for replay-first 001: a repeated generate request (the same
// idempotency key, so the same job id) is answered with 202 `replayed: true`
// before the admission, the free-tier count and the debit. The late check still
// guards two identical requests at once: the second credits back its own debit,
// writes an alarm row if that credit fails, and never writes job:<jobId>. Run
// from the repo root: `node scripts/replay-first-test.mjs`.
//
// Built the way s0-test.mjs builds the route: LEDGER_DB and EVENTS_DB are real
// SQLite databases (node:sqlite, in memory) from the consumer repo's migrations;
// KV, R2 and the queue are in-memory stubs. The harness writes only its bundle,
// to local/.replay-first-test (gitignored), and prints only case names and pass
// or fail.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

const subtle = webcrypto.subtle;
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.replay-first-test');
const CONSUMER = process.env.S0_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MIGRATIONS = [
  path.join(CONSUMER, 'migrations-ledger', '0001_control.sql'),
  path.join(CONSUMER, 'migrations-ledger', '0002_stripe_refusals.sql'),
];
const EVENTS_MIGRATION = path.join(CONSUMER, 'migrations', '0001_events.sql');
for (const f of [...MIGRATIONS, EVENTS_MIGRATION]) {
  if (!existsSync(f)) { console.log(`[replay-first-test] missing ${f}: check out the consumer's n1-s0 branch`); process.exit(1); }
}

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

// ── D1 over node:sqlite, KV, R2 and queue stubs ──

function d1(db) {
  return {
    prepare(sql) {
      const make = (args) => ({
        run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
        first: async () => { const row = db.prepare(sql).get(...args); return row ? { ...row } : null; },
        all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
      });
      const stmt = make([]);
      stmt.bind = (...a) => make(a);
      return stmt;
    },
  };
}
// `kvGetHook(k)` runs before each get: it may throw (a failed read) or change
// kvMap (another request's write landing between two reads).
let ledger, events, kvMap, kvGetHook, calls, sends, logs;
function reset() {
  ledger = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) ledger.exec(readFileSync(f, 'utf8'));
  events = new DatabaseSync(':memory:');
  events.exec(readFileSync(EVENTS_MIGRATION, 'utf8'));
  kvMap = new Map(); kvGetHook = () => {}; calls = []; sends = []; logs = [];
  process.env = { ...process.env };
  delete process.env.ADMIN_USER_IDS;
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid', QUEUE_KICKOFF_ENABLED: 'true',
    LEDGER_DB: d1(ledger), EVENTS_DB: d1(events),
    SPRITEBREW_KV: {
      get: async (k) => { calls.push(`kv.get ${k}`); kvGetHook(k); return kvMap.has(k) ? kvMap.get(k) : null; },
      getWithMetadata: async (k) => ({ value: kvMap.get(k) ?? null, metadata: null }),
      put: async (k, v) => { calls.push(`kv.put ${k}`); kvMap.set(k, v); },
      delete: async (k) => { kvMap.delete(k); },
      list: async ({ prefix } = {}) => ({ keys: [...kvMap.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true }),
    },
    GALLERY_BUCKET: { get: async () => null, head: async () => null, put: async () => ({}), delete: async () => {} },
    RD_QUEUE: { send: async (m) => { sends.push(m); } },
  });
}
const setFault = (value) => ledger.prepare(
  "INSERT INTO control (key, value, updated_at_ms, updated_by) VALUES ('dev_fault', ?, 0, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(value);
console.warn = () => {};
console.error = (...a) => { logs.push(a.map(String).join(' ')); };
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[replay-first-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[replay-first-test] ', '') : x));
  else logs.push(a.map(String).join(' '));
})(console.log);
const say = (...a) => console.log('[replay-first-test]', ...a);
const replayLines = () => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((l) => l.source === 'generate' && l.event === 'replay_before_admission');
const endLines = () => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((l) => l.source === 'money-admission' && l.event === 'end');

// ── Bundle ──

await build({
  entryPoints: {
    generate: path.join(ROOT, 'src/app/api/generate/route.ts'),
    jobIdHelper: path.join(ROOT, 'src/lib/jobIdHelper.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const G = await import(pathToFileURL(path.join(OUT, 'generate.mjs')).href);
const ids = await import(pathToFileURL(path.join(OUT, 'jobIdHelper.mjs')).href);

// ── Helpers ──

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const USER = 'user_REPLAYFIRSTTESTREPLAYFIR1';
const tok = await tokenFor(USER);
const IDEM = 'idem-replay-first-0001';
const JOB = await ids.deriveJobId(USER, IDEM);
const JOB_KEY = `job:${JOB}`;
const START = 100;
const seedBalance = (n) => kvMap.set(`token_balance:${USER}`, JSON.stringify({ balance: n, created_at: 'x', last_updated: 'x' }));
const balance = () => JSON.parse(kvMap.get(`token_balance:${USER}`)).balance;
const freeCount = () => Number(kvMap.get(`lifetime_free_fast:${USER}`) ?? 0);
const admissions = () => ledger.prepare('SELECT * FROM money_admissions').all().map((r) => ({ ...r }));
const alarms = () => events.prepare("SELECT COUNT(*) AS n FROM events WHERE event_name = 'generation.unrefunded'").get().n;
const debits = () => [...kvMap.keys()].filter((k) => k.startsWith('token_idempotency:gen:')).length;
const jobPuts = () => calls.filter((c) => c === `kv.put ${JOB_KEY}`).length;
const genReq = (idem = IDEM) => new Request('https://dev.spritebrew.pages.dev/api/generate', {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'a knight', style: 'rd_fast__no_style', width: 64, height: 64, idempotencyKey: idem }),
});
async function post(idem) {
  const res = await G.POST(genReq(idem));
  let body = null; try { body = await res.clone().json(); } catch { /* not JSON */ }
  return { res, body };
}
const FIRST = JSON.stringify({ status: 'pending', userId: USER, mode: 'create', enqueuedAt: 1, tokenCost: 5, requestId: 'gen:first' });

// ── 1. A first request, then the same key again ──

reset(); seedBalance(START);
let r = await post();
const cost = START - balance();
check('the first request: 202 with the job id, admitted, debited, counted, enqueued',
  r.res.status === 202 && r.body?.jobId === JOB && !r.body?.replayed && admissions().length === 1 && cost > 0
  && debits() === 1 && freeCount() === 1 && sends.length === 1 && JSON.parse(kvMap.get(JOB_KEY))?.status === 'pending');
const recordAfterFirst = kvMap.get(JOB_KEY);
calls = []; logs = [];
r = await post();
check('the same key again: 202 replayed true with the same job id',
  r.res.status === 202 && r.body?.jobId === JOB && r.body?.replayed === true);
check('the same key again: no second admission, debit, free-tier count or send; the balance down once',
  admissions().length === 1 && debits() === 1 && freeCount() === 1 && sends.length === 1 && balance() === START - cost);
check('the same key again: job:<jobId> untouched; its only KV reads are the account lock and the early check, and no write',
  kvMap.get(JOB_KEY) === recordAfterFirst
  && JSON.stringify(calls) === JSON.stringify([`kv.get account_status:${USER}`, `kv.get ${JOB_KEY}`]));
check('the same key again: no money-admission end line (nothing was admitted)', endLines().length === 0);
check('the same key again: one replay_before_admission line, holding only its source, event and job id',
  replayLines().length === 1 && JSON.stringify(replayLines()[0]) === JSON.stringify({ source: 'generate', event: 'replay_before_admission', jobId: JOB }));

// ── 2. The early read fails: carry on as today ──

reset(); seedBalance(START);
{
  let jobReads = 0;
  kvGetHook = (k) => { if (k === JOB_KEY && ++jobReads === 1) throw new Error('stub: KV get failed'); };
  r = await post();
  check('a failed early read: an ordinary job (202, admitted, debited once, enqueued), the late check read the key',
    r.res.status === 202 && r.body?.jobId === JOB && !r.body?.replayed && admissions().length === 1
    && balance() === START - cost && sends.length === 1 && jobReads === 2 && endLines()[0]?.outcome === 'enqueued (202)'
    && replayLines().length === 0);
}
reset(); seedBalance(START);
{
  let jobReads = 0;
  kvGetHook = (k) => { if (k === JOB_KEY && ++jobReads === 1) throw new Error('stub: KV get failed'); };
  kvMap.set(JOB_KEY, FIRST);
  r = await post();
  check('a failed early read with the job already there: the late check answers 202 replayed and refunds',
    r.res.status === 202 && r.body?.replayed === true && balance() === START && kvMap.get(JOB_KEY) === FIRST
    && sends.length === 0 && endLines()[0]?.outcome === 'replay after debit (202, refunded)');
}

// ── 3. Two identical requests at once: the late check sees the first's job ──

reset(); seedBalance(START);
{
  // The early read finds nothing; the first request's record lands before the late read.
  let jobReads = 0;
  kvGetHook = (k) => { if (k === JOB_KEY && ++jobReads === 2) kvMap.set(JOB_KEY, FIRST); };
  r = await post();
  check('concurrent: 202 replayed true with the same job id', r.res.status === 202 && r.body?.jobId === JOB && r.body?.replayed === true);
  check('concurrent: admitted and debited once, then refunded, so the balance is back',
    admissions().length === 1 && debits() === 1 && balance() === START && kvMap.has(`token_idempotency:refund:${admissions()[0] && JSON.parse(admissions()[0].meta_json).requestId}`));
  check('concurrent: job:<jobId> unchanged and never written; nothing sent; no alarm',
    kvMap.get(JOB_KEY) === FIRST && jobPuts() === 0 && sends.length === 0 && alarms() === 0);
  check('concurrent: the admission is completed, outcome "replay after debit (202, refunded)", no replay_before_admission line',
    admissions()[0]?.completed_at_ms !== null && endLines()[0]?.outcome === 'replay after debit (202, refunded)' && replayLines().length === 0);
}

// ── 4. The same, with the refund credit failing ──

reset(); seedBalance(START); setFault('credit_throw_before_balance');
{
  let jobReads = 0;
  kvGetHook = (k) => { if (k === JOB_KEY && ++jobReads === 2) kvMap.set(JOB_KEY, FIRST); };
  r = await post();
  check('concurrent, the refund fails: 202 replayed true', r.res.status === 202 && r.body?.replayed === true);
  check('concurrent, the refund fails: one alarm row, job:<jobId> unchanged and never written, nothing sent',
    alarms() === 1 && kvMap.get(JOB_KEY) === FIRST && jobPuts() === 0 && sends.length === 0 && balance() === START - cost);
  check('concurrent, the refund fails: outcome "replay after debit (202, refund owed)"',
    admissions()[0]?.completed_at_ms !== null && endLines()[0]?.outcome === 'replay after debit (202, refund owed)');
  check('concurrent, the refund fails: no last-resort line (the alarm was written)',
    !logs.some((l) => l.includes('unrefunded_alarm_not_written')));
}
reset(); seedBalance(START); setFault('credit_throw_before_balance');
{
  let jobReads = 0;
  kvGetHook = (k) => { if (k === JOB_KEY && ++jobReads === 2) kvMap.set(JOB_KEY, FIRST); };
  events.exec('DROP TABLE events');
  r = await post();
  check('concurrent, the refund and the alarm fail: 202 replayed, the last-resort line, job:<jobId> unchanged',
    r.res.status === 202 && r.body?.replayed === true && logs.some((l) => l.includes('unrefunded_alarm_not_written'))
    && kvMap.get(JOB_KEY) === FIRST && jobPuts() === 0);
}

// ── 5. A new idempotency key: an ordinary job ──

reset(); seedBalance(START);
await post();
check('an ordinary first job: no replay_before_admission line', replayLines().length === 0);
const firstJobRecord = kvMap.get(JOB_KEY);
calls = []; logs = [];
const IDEM2 = 'idem-replay-first-0002';
const JOB2 = await ids.deriveJobId(USER, IDEM2);
r = await post(IDEM2);
check('a new key: 202 with its own job id, admitted, debited, counted and enqueued, as today',
  r.res.status === 202 && r.body?.jobId === JOB2 && JOB2 !== JOB && !r.body?.replayed && admissions().length === 2
  && debits() === 2 && freeCount() === 2 && sends.length === 2 && balance() === START - 2 * cost
  && JSON.parse(kvMap.get(`job:${JOB2}`))?.status === 'pending' && kvMap.get(JOB_KEY) === firstJobRecord
  && endLines()[0]?.outcome === 'enqueued (202)' && replayLines().length === 0);

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
