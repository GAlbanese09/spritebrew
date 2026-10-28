// scripts/replay-first-test.mjs
//
// Offline tests for replay-first 001: a repeated generate request (the same
// idempotency key, so the same job id) is answered with 202 `replayed: true`
// before the admission, the free-tier count and the debit. The late check still
// guards two identical requests at once: the second credits back its own debit,
// writes an alarm row if that credit fails, and never writes job:<jobId>. Run
// from the repo root: `node scripts/replay-first-test.mjs`.
//
// replay-first 007 (Second 101): the late branch acts on what `debitTokens`
// says it did to the balance (`debited`), not on its `success`, and each refund
// debt keeps its own alarm row (`obligationKey`). The helpers are bundled too,
// for their own answers.
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
// `kvGetHook(k)` runs before each get: it may throw (a failed read), change
// kvMap (another request's write landing between two reads), or return MISS (a
// stale read that does not see a record already there). `kvPutHook(k, v)` runs
// before each put: it may throw before applying, or return THROW_AFTER to apply
// and then throw.
const MISS = Symbol('miss');
const THROW_AFTER = Symbol('throw after');
let ledger, events, kvMap, kvGetHook, kvPutHook, calls, sends, logs;
function reset() {
  ledger = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) ledger.exec(readFileSync(f, 'utf8'));
  events = new DatabaseSync(':memory:');
  events.exec(readFileSync(EVENTS_MIGRATION, 'utf8'));
  kvMap = new Map(); kvGetHook = () => {}; kvPutHook = () => {}; calls = []; sends = []; logs = [];
  process.env = { ...process.env };
  delete process.env.ADMIN_USER_IDS;
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid', QUEUE_KICKOFF_ENABLED: 'true',
    LEDGER_DB: d1(ledger), EVENTS_DB: d1(events),
    SPRITEBREW_KV: {
      get: async (k) => {
        calls.push(`kv.get ${k}`);
        if (kvGetHook(k) === MISS) return null;
        return kvMap.has(k) ? kvMap.get(k) : null;
      },
      getWithMetadata: async (k) => ({ value: kvMap.get(k) ?? null, metadata: null }),
      put: async (k, v) => {
        calls.push(`kv.put ${k}`);
        const after = kvPutHook(k, v);
        kvMap.set(k, v);
        if (after === THROW_AFTER) throw new Error('stub: KV put failed after applying');
      },
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
    tokenBalance: path.join(ROOT, 'src/lib/tokenBalance.ts'),
    unrefundedAlarm: path.join(ROOT, 'src/lib/unrefundedAlarm.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const G = await import(pathToFileURL(path.join(OUT, 'generate.mjs')).href);
const ids = await import(pathToFileURL(path.join(OUT, 'jobIdHelper.mjs')).href);
const TB = await import(pathToFileURL(path.join(OUT, 'tokenBalance.mjs')).href);
const UA = await import(pathToFileURL(path.join(OUT, 'unrefundedAlarm.mjs')).href);

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

// ── 6. replay-first 007, P2-A: the late branch acts on the debit evidence ──
//
// In every route case the early read misses (MISS) while the first request's
// record is already in KV, so the late read sees it. Each case also asserts that
// job:<jobId> is byte-identical to that record and never written, that nothing
// was sent, and the admission's outcome.

const txRows = (type) => [...kvMap.entries()].filter(([k]) => k.startsWith(`token_tx:${USER}:`))
  .map(([, v]) => JSON.parse(v)).filter((t) => t.type === type);
const alarmRows = () => events.prepare(
  "SELECT dedupe_key, job_id, request_id, error_code, event_json FROM events WHERE event_name = 'generation.unrefunded' ORDER BY occurred_at_ms, dedupe_key")
  .all().map((r) => ({ ...r, extra: JSON.parse(r.event_json).extra }));
const requestIds = () => admissions().map((a) => JSON.parse(a.meta_json).requestId);
const lastResort = () => logs.filter((l) => l.includes('unrefunded_alarm_not_written'));
// The early read misses on each request's first read of the job; the late read sees it.
function lateSeesFirst() {
  kvMap.set(JOB_KEY, FIRST);
  let jobReads = 0;
  return (k) => { if (k === JOB_KEY && ++jobReads % 2 === 1) return MISS; };
}
const untouched = (n = 1) => kvMap.get(JOB_KEY) === FIRST && jobPuts() === 0 && sends.length === 0
  && admissions().length === n && admissions().every((a) => a.completed_at_ms !== null);
const isGenIdem = (k) => k.startsWith('token_idempotency:gen:');

// 6.1 Second 101's reproduction: the debit's idempotency read throws before any write.
reset(); seedBalance(START);
{
  const late = lateSeesFirst();
  kvGetHook = (k) => { if (isGenIdem(k)) throw new Error('stub: KV get failed'); return late(k); };
  r = await post();
  check('P2-A 1, the debit read fails before any write: 202 replayed, balance 100, outcome "replay (202, nothing debited)"',
    r.res.status === 202 && r.body?.replayed === true && balance() === START
    && endLines()[0]?.outcome === 'replay (202, nothing debited)');
  check('P2-A 1: no debit row, no credit row, no alarm; job:<jobId> untouched, nothing sent',
    txRows('debit').length === 0 && txRows('credit').length === 0 && alarms() === 0 && untouched());
}

// 6.2 A real debit that leaves the balance at zero: nothing keys on balance === 0.
reset(); seedBalance(cost);
{
  kvGetHook = lateSeesFirst();
  r = await post();
  check('P2-A 2, a real debit to zero: refunded, the balance back to the cost, outcome refunded',
    r.res.status === 202 && r.body?.replayed === true && balance() === cost
    && endLines()[0]?.outcome === 'replay after debit (202, refunded)');
  check('P2-A 2: one debit row, one credit row, no alarm; job:<jobId> untouched, nothing sent',
    txRows('debit').length === 1 && txRows('credit').length === 1 && alarms() === 0 && untouched());
}

// 6.3 The balance write landed, the debit's idempotency put then threw.
reset(); seedBalance(START);
{
  kvGetHook = lateSeesFirst();
  kvPutHook = (k) => { if (isGenIdem(k)) throw new Error('stub: KV put failed'); };
  r = await post();
  check('P2-A 3, the debit landed but its records did not: refunded, balance 100, no alarm, outcome refunded',
    r.res.status === 202 && r.body?.replayed === true && balance() === START && alarms() === 0
    && txRows('credit').length === 1 && endLines()[0]?.outcome === 'replay after debit (202, refunded)' && untouched());
}

// 6.4 and 6.5 The balance put itself throws: after applying, and before.
for (const [label, hook, want] of [
  ['applies, then throws', THROW_AFTER, START - cost],
  ['throws without applying', 'throw', START],
]) {
  reset(); seedBalance(START);
  kvGetHook = lateSeesFirst();
  let debitPut = true;
  kvPutHook = (k) => {
    if (k === `token_balance:${USER}` && debitPut) {
      debitPut = false;
      if (hook === 'throw') throw new Error('stub: KV put failed');
      return THROW_AFTER;
    }
  };
  r = await post();
  const rows = alarmRows();
  const refundKey = `refund:${requestIds()[0]}`;
  check(`P2-A ${hook === 'throw' ? 5 : 4}, the balance put ${label}: no credit, balance ${want}, outcome "replay after debit (202, debit uncertain)"`,
    r.res.status === 202 && r.body?.replayed === true && txRows('credit').length === 0 && balance() === want
    && endLines()[0]?.outcome === 'replay after debit (202, debit uncertain)' && untouched());
  check(`P2-A ${hook === 'throw' ? 5 : 4}: one alarm, reason debit_uncertain, this request's refund key, no balanceWritten, its own dedupe key`,
    rows.length === 1 && rows[0].error_code === 'debit_uncertain' && rows[0].extra.reason === 'debit_uncertain'
    && rows[0].extra.idempotencyKey === refundKey && !('balanceWritten' in rows[0].extra)
    && rows[0].extra.detail === 'debit balance write threw; it may have landed'
    && rows[0].job_id === JOB && rows[0].request_id === requestIds()[0]
    && rows[0].dedupe_key === `${JOB}:${refundKey}:generation.unrefunded` && lastResort().length === 0);
}

// 6.6 debitTokens' own answers. `success`, `balance` and `required` are checked
// apart from `debited`, against the values 894f3ed answered on each path.
{
  const shape = (x) => JSON.stringify({ success: x.success, balance: x.balance, required: x.required });
  const cases = [
    ['no KV', () => { delete process.env.SPRITEBREW_KV; }, 5, { success: true, balance: 0 }, 'no'],
    ['not enough tokens', () => seedBalance(2), 5, { success: false, balance: 2, required: 5 }, 'no'],
    ['the key already present', () => { seedBalance(START); kvMap.set('token_idempotency:gen:direct', '1'); }, 5, { success: true, balance: START }, 'yes'],
    ['success', () => seedBalance(START), 5, { success: true, balance: START - 5 }, 'yes'],
    ['a throw before the balance put', () => { seedBalance(START); kvGetHook = (k) => { if (isGenIdem(k)) throw new Error('x'); }; }, 5, { success: true, balance: 0 }, 'no'],
    ['a throw from the balance put', () => { seedBalance(START); kvPutHook = (k) => { if (k.startsWith('token_balance:')) throw new Error('x'); }; }, 5, { success: true, balance: 0 }, 'unknown'],
    ['a throw after the balance put', () => { seedBalance(START); kvPutHook = (k) => { if (isGenIdem(k)) throw new Error('x'); }; }, 5, { success: true, balance: 0 }, 'yes'],
  ];
  for (const [label, setup, amount, want, debited] of cases) {
    reset(); setup();
    const got = await TB.debitTokens(USER, amount, 'gen:direct');
    check(`debitTokens, ${label}: success and balance as at 894f3ed`, shape(got) === shape(want));
    check(`debitTokens, ${label}: debited '${debited}'`, got.debited === debited);
  }
}

// ── 7. replay-first 007, P2-B: one alarm per obligation ──

// 7.1 and 7.2 Two late replays for one job, each debited, each refund failing.
for (const [n, fault, want, balanceWritten] of [
  [7, 'credit_throw_before_balance', START - 2 * cost, false],
  [8, 'credit_throw_after_balance', START, true],
]) {
  reset(); seedBalance(START); setFault(fault);
  kvGetHook = lateSeesFirst();
  const r1 = await post();
  const r2 = await post();
  const rows = alarmRows();
  const rids = requestIds();
  const keys = rids.map((id) => `refund:${id}`);
  check(`P2-B ${n}, two failed late refunds (${fault}): both 202 replayed, both outcomes refund owed, balance ${want}`,
    r1.res.status === 202 && r2.res.status === 202 && r1.body?.replayed === true && r2.body?.replayed === true
    && endLines().length === 2 && endLines().every((e) => e.outcome === 'replay after debit (202, refund owed)')
    && balance() === want && untouched(2));
  check(`P2-B ${n}: two rows for the job, each with its own request id, refund key and dedupe key, balanceWritten ${balanceWritten}`,
    rows.length === 2 && rids.length === 2 && rids[0] !== rids[1] && rows.every((x) => x.job_id === JOB)
    && JSON.stringify(rows.map((x) => x.request_id).sort()) === JSON.stringify([...rids].sort())
    && JSON.stringify(rows.map((x) => x.extra.idempotencyKey).sort()) === JSON.stringify([...keys].sort())
    && JSON.stringify(rows.map((x) => x.dedupe_key).sort()) === JSON.stringify(keys.map((k) => `${JOB}:${k}:generation.unrefunded`).sort())
    && rows.every((x) => x.extra.balanceWritten === balanceWritten && x.extra.reason === 'refund_credit_failed'));
  check(`P2-B ${n}: no last-resort line`, lastResort().length === 0);
}

// 7.3 A job-level row for the job already there (the consumer's key, the first request's debt).
reset(); seedBalance(START); setFault('credit_throw_before_balance');
{
  const first = await UA.recordUnrefundedAlarm({ userId: USER, jobId: JOB, tokenCost: cost, reason: 'dead_letter' });
  kvGetHook = lateSeesFirst();
  r = await post();
  const rows = alarmRows();
  check('P2-B 9, a job-level row already there: the late replay still writes its own row (two rows), no last-resort line',
    first === true && r.res.status === 202 && rows.length === 2
    && rows.some((x) => x.dedupe_key === `${JOB}:generation.unrefunded`)
    && rows.some((x) => x.dedupe_key === `${JOB}:refund:${requestIds()[0]}:generation.unrefunded`)
    && lastResort().length === 0 && endLines()[0]?.outcome === 'replay after debit (202, refund owed)' && untouched());
}

// 7.4 The same obligation twice dedupes.
reset();
{
  const args = { userId: USER, jobId: JOB, tokenCost: cost, reason: 'refund_credit_failed', obligationKey: 'refund:gen:one' };
  const a = await UA.recordUnrefundedAlarm(args);
  const b = await UA.recordUnrefundedAlarm(args);
  const rows = alarmRows();
  check('P2-B 10, the same obligation twice: one row, keyed <jobId>:<obligationKey>, and both calls answer true',
    a === true && b === true && rows.length === 1 && rows[0].dedupe_key === `${JOB}:refund:gen:one:generation.unrefunded`);
}

// 7.5 No obligation key: the job-level key, byte for byte.
reset();
{
  const args = { userId: USER, jobId: JOB, tokenCost: cost, reason: 'refund_credit_failed' };
  const a = await UA.recordUnrefundedAlarm(args);
  const b = await UA.recordUnrefundedAlarm(args);
  const rows = alarmRows();
  check('P2-B 11, no obligation key: the dedupe key is exactly <jobId>:generation.unrefunded, one row for two calls, both true',
    a === true && b === true && rows.length === 1 && rows[0].dedupe_key === `${JOB}:generation.unrefunded`);
}

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
