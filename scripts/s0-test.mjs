// scripts/s0-test.mjs
//
// Offline tests for S0, release 1 code before the switch (n1-release-2-spec.md
// revision 9: section 11's S0 row, 6.2, 4.13, 7.5, 8, 10.3; T30 and T10b's S0
// part offline). Run from the repo root: `node scripts/s0-test.mjs`.
//
// Unlike money-pause-test.mjs, LEDGER_DB and EVENTS_DB here are real SQLite
// databases (node:sqlite, in memory) built from the consumer repo's own
// migrations, so S0's SQL runs as written against 0001 and 0002:
//   ../spritebrew-rd-consumer/migrations-ledger/0001_control.sql, 0002_stripe_refusals.sql
//   ../spritebrew-rd-consumer/migrations/0001_events.sql
// The consumer checkout must hold 0002 (its n1-s0 branch). KV, R2 and the
// queue are in-memory stubs. The harness writes only its esbuild bundles, to
// local/.s0-test (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import { createHmac, webcrypto } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

const subtle = webcrypto.subtle;
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_secret';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.s0-test');
const CONSUMER = process.env.S0_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const WHSEC = 'whsec_placeholder_not_a_secret';
const MIGRATIONS = [
  path.join(CONSUMER, 'migrations-ledger', '0001_control.sql'),
  path.join(CONSUMER, 'migrations-ledger', '0002_stripe_refusals.sql'),
];
const EVENTS_MIGRATION = path.join(CONSUMER, 'migrations', '0001_events.sql');
for (const f of [...MIGRATIONS, EVENTS_MIGRATION]) {
  if (!existsSync(f)) { console.log(`[s0-test] missing ${f}: check out the consumer's n1-s0 branch`); process.exit(1); }
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

// ── D1 over node:sqlite ──

// `fail(sql)` returning true makes that statement throw, as a D1 error would;
// `delay(sql)` holds it that many ms first (Infinity: it never answers).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function d1(db, fail = () => false, delay = () => 0) {
  return {
    prepare(sql) {
      const make = (args) => ({
        run: async () => {
          const wait = delay(sql);
          if (wait === Infinity) return new Promise(() => {});
          if (wait) await sleep(wait);
          if (fail(sql)) throw new Error('stub: D1 statement failed');
          if (/UPDATE money_admissions SET completed_at_ms/.test(sql)) calls.push('ledger.complete');
          const r = db.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
        first: async () => {
          if (fail(sql)) throw new Error('stub: D1 statement failed');
          const row = db.prepare(sql).get(...args);
          return row ? { ...row } : null;
        },
        all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
      });
      const stmt = make([]);
      stmt.bind = (...a) => make(a);
      return stmt;
    },
  };
}
let ledger, events, ledgerFail, eventsFail, ledgerDelay = () => 0;
function freshDbs() {
  ledger = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) ledger.exec(readFileSync(f, 'utf8'));
  events = new DatabaseSync(':memory:');
  events.exec(readFileSync(EVENTS_MIGRATION, 'utf8'));
  ledgerFail = () => false; eventsFail = () => false; ledgerDelay = () => 0;
}
const setPause = (value, at) => ledger.prepare(
  "UPDATE control SET value = ?, updated_at_ms = ?, updated_by = 'test' WHERE key = 'money_pause'").run(value, at ?? Date.now());
const setFault = (value) => ledger.prepare(
  "INSERT INTO control (key, value, updated_at_ms, updated_by) VALUES ('dev_fault', ?, 0, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(value);
const admissionRows = () => ledger.prepare('SELECT * FROM money_admissions ORDER BY admitted_at_ms, admission_id').all().map((r) => ({ ...r }));
const heldRows = () => ledger.prepare('SELECT * FROM stripe_held').all().map((r) => ({ ...r }));
const lateAlarms = () => events.prepare("SELECT * FROM events WHERE event_name = 'admission.late_completion'").all().map((r) => ({ ...r }));

// ── KV, R2, queue stubs ──

let kvMap = new Map();
let kvGetThrows = () => false;
let kvPutThrows = () => false;
let calls = [];
function kvStub() {
  return {
    get: async (k) => { calls.push(`kv.get ${k}`); if (kvGetThrows(k)) throw new Error('stub: KV get failed'); return kvMap.has(k) ? kvMap.get(k) : null; },
    getWithMetadata: async (k) => ({ value: kvMap.get(k) ?? null, metadata: null }),
    put: async (k, v) => { calls.push(`kv.put ${k}`); if (kvPutThrows(k)) throw new Error('stub: KV put failed'); kvMap.set(k, v); },
    delete: async (k) => { kvMap.delete(k); },
    list: async ({ prefix } = {}) => ({ keys: [...kvMap.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true }),
  };
}
let queueThrows = false;
function env({ kv = true, ledgerBound = true } = {}) {
  process.env = { ...process.env };
  for (const k of ['LEDGER_DB', 'SPRITEBREW_KV', 'EVENTS_DB']) delete process.env[k];
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid',
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret', STRIPE_WEBHOOK_SECRET: WHSEC,
    QUEUE_KICKOFF_ENABLED: 'true', RESEND_API_KEY: 'placeholder', RESEND_AUDIENCE_ID: 'placeholder',
    CLERK_SECRET_KEY: 'placeholder',
    GALLERY_BUCKET: { get: async () => null, head: async () => null, put: async (k) => { calls.push(`r2.put ${k}`); return {}; } },
    RD_QUEUE: { send: async (m) => { calls.push('queue.send'); lastMessage = m; if (queueThrows) throw new Error('stub: send failed'); } },
    EVENTS_DB: d1(events, (sql) => eventsFail(sql)),
  });
  if (ledgerBound) process.env.LEDGER_DB = d1(ledger, (sql) => ledgerFail(sql), (sql) => ledgerDelay(sql));
  if (kv) process.env.SPRITEBREW_KV = kvStub();
}
let lastMessage = null;
function reset(over = {}) {
  freshDbs(); kvMap = new Map(); kvGetThrows = () => false; kvPutThrows = () => false; calls = []; queueThrows = false; lastMessage = null; logs = [];
  env(over);
}
globalThis.fetch = async () => new Response('{}', { status: 503 });
let logs = [];
console.warn = () => {};
console.error = (...a) => { logs.push(a.map(String).join(' ')); };
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[s0-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[s0-test] ', '') : x));
  else logs.push(a.map(String).join(' '));
})(console.log);
const say = (...a) => console.log('[s0-test]', ...a);
const lines = (event) => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((l) => l.source === 'money-admission' && (!event || l.event === event));

// ── Bundle ──

const ROUTES = ['generate', 'token-balance', 'account/daily-reward', 'account/email-list', 'stripe/webhook', 'generation-status/[jobId]'];
const entryPoints = {
  moneyAdmission: path.join(ROOT, 'src/lib/moneyAdmission.ts'),
  moneyPause: path.join(ROOT, 'src/lib/moneyPause.ts'),
  tokenBalance: path.join(ROOT, 'src/lib/tokenBalance.ts'),
  jobIdHelper: path.join(ROOT, 'src/lib/jobIdHelper.ts'),
};
const slug = (r) => r.replace(/[/[\]]/g, '_');
for (const r of ROUTES) entryPoints[slug(r)] = path.join(ROOT, 'src/app/api', r, 'route.ts');
await build({
  entryPoints, bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const load = async (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const adm = await load('moneyAdmission');
const mp = await load('moneyPause');
const tb = await load('tokenBalance');
const ids = await load('jobIdHelper');
const R = {};
for (const r of ROUTES) R[r] = await load(slug(r));

// ── Helpers ──

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const USER = 'user_S0TESTS0TESTS0TESTS0TEST1';
const NEWUSER = 'user_S0TESTNEWUSERNOBALANCE02';
const tok = await tokenFor(USER);
const tokNew = await tokenFor(NEWUSER);
const seedBalance = (u, n) => kvMap.set(`token_balance:${u}`, JSON.stringify({ balance: n, created_at: 'x', last_updated: 'x' }));
const balanceOf = (u) => { const r = kvMap.get(`token_balance:${u}`); return r ? JSON.parse(r).balance : null; };
const json = async (res) => { try { return await res.clone().json(); } catch { return null; } };
const IDEM = 'idem-s0-test-0001';
const genReq = (t, over = {}) => new Request('https://dev.spritebrew.pages.dev/api/generate', {
  method: 'POST', headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'a knight', style: 'rd_fast__default', width: 64, height: 64, idempotencyKey: IDEM, ...over }),
});
const authReq = (url, t, method = 'GET') => new Request(`https://dev.spritebrew.pages.dev${url}`, {
  method, headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json' },
  body: method === 'GET' ? undefined : JSON.stringify({ subscribe: true }),
});
function stripeReq(evt) {
  const payload = JSON.stringify(evt);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WHSEC).update(`${t}.${payload}`).digest('hex');
  return new Request('https://dev.spritebrew.pages.dev/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}`, 'content-type': 'application/json' }, body: payload,
  });
}
const CREATED_S = 1790000000;
const checkoutEvent = (id, userId = USER, tokens = 100) => ({
  id, object: 'event', type: 'checkout.session.completed', api_version: '2026-03-25.dahlia', created: CREATED_S,
  data: { object: { id: `cs_${id}`, object: 'checkout.session', payment_intent: null, amount_total: 499,
    metadata: { userId, packId: 'starter', tokens: String(tokens) } } },
});
const refundEvent = (id) => ({
  id, object: 'event', type: 'charge.refunded', api_version: '2026-03-25.dahlia', created: CREATED_S,
  data: { object: { id: `ch_${id}`, object: 'charge', amount_refunded: 499, refunded: true } },
});
const statusReq = (jobId, t) => [authReq(`/api/generation-status/${jobId}`, t), { params: Promise.resolve({ jobId }) }];
const only = (rows) => rows.length === 1 ? rows[0] : null;

// ── 1. 0002 is applied as written ──

reset();
const objects = ledger.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all().map((r) => `${r.type}:${r.name}`).join(',');
check('0002 creates stripe_held, money_admissions and both indexes beside control',
  objects === 'index:money_admissions_open,index:money_admissions_subject,table:control,table:money_admissions,table:stripe_held');

// ── 2. Generate: the admission, its meta, and the completion on every path ──

reset(); seedBalance(USER, 100);
const expectJob = await ids.deriveJobId(USER, IDEM);
let res = await R.generate.POST(genReq(tok));
let row = only(admissionRows());
let meta = row ? JSON.parse(row.meta_json) : null;
check('generate open -> 202, one admission, route generate, subject the derived job, the user', res.status === 202
  && row?.route === 'generate' && row?.subject_kind === 'job' && row?.subject_id === expectJob && row?.user_id === USER);
check('generate -> meta_json holds the mode, the cost and the request id', meta?.mode === 'create' && meta?.tokenCost > 0
  && typeof meta?.requestId === 'string' && meta.requestId.startsWith(`gen:${USER}:`));
check('generate -> completed after the last money write (the send comes first)', row?.completed_at_ms >= row?.admitted_at_ms
  && calls.indexOf('queue.send') !== -1 && calls.indexOf('queue.send') < calls.indexOf('ledger.complete'));
const pending = JSON.parse(kvMap.get(`job:${expectJob}`) ?? 'null');
check('generate -> the pending record carries tokenCost and requestId, equal to the admission meta',
  pending?.status === 'pending' && pending?.tokenCost === meta?.tokenCost && pending?.requestId === meta?.requestId);
check('generate -> the debit is keyed on the request id the admission names', kvMap.has(`token_idempotency:${meta?.requestId}`));
let a = only(lines('admission')); let e = only(lines('end'));
check('generate -> one admission line and one end line, each naming the admission id, request id and job id',
  a?.outcome === 'admitted' && e?.admission_id === row?.admission_id && a?.admission_id === row?.admission_id
  && a?.request_id === meta?.requestId && a?.job_id === expectJob && e?.request_id === meta?.requestId && e?.job_id === expectJob);
check('generate -> the end line names its outcome', e?.outcome === 'enqueued (202)');

reset(); setPause('1'); seedBalance(USER, 100);
res = await R.generate.POST(genReq(tok));
let body = await json(res);
check('generate paused -> 503 money_paused, no admission row, nothing debited', res.status === 503 && body?.error === 'money_paused'
  && admissionRows().length === 0 && balanceOf(USER) === 100 && !calls.includes('queue.send'));
check('generate paused -> admission and end lines with outcome paused', only(lines('admission'))?.outcome === 'paused' && only(lines('end'))?.outcome === 'paused');

reset(); seedBalance(USER, 100); kvMap.set(`job:${expectJob}`, JSON.stringify({ status: 'pending', userId: USER }));
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('generate replay branch -> 202 replayed, admission completed, end outcome replay', res.status === 202 && (await json(res))?.replayed === true
  && row?.completed_at_ms !== null && only(lines('end'))?.outcome === 'replay (202, no new job)');

reset(); seedBalance(USER, 0);
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('generate insufficient tokens -> 402, admission completed', res.status === 402 && row?.completed_at_ms !== null && only(lines('end'))?.outcome === 'insufficient_tokens (402)');

reset(); seedBalance(USER, 100); kvMap.set(`lifetime_free_fast:${USER}`, '999999'); kvMap.set(`lifetime_free_pro:${USER}`, '999999');
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('generate free-tier cap -> 402, admission completed', res.status === 402 && row?.completed_at_ms !== null && only(lines('end'))?.outcome === 'free_tier_cap (402)');

reset(); seedBalance(USER, 100); setFault('enqueue_throw');
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('generate catch (enqueue fails, refund lands) -> 503, admission completed after the refund and the error record',
  res.status === 503 && balanceOf(USER) === 100 && row?.completed_at_ms !== null && only(lines('end'))?.outcome === 'refunded (503)'
  && calls.lastIndexOf(`kv.put job:${expectJob}`) < calls.indexOf('ledger.complete')
  && calls.lastIndexOf(`kv.put token_balance:${USER}`) < calls.indexOf('ledger.complete'));

reset(); seedBalance(USER, 100); setFault('enqueue_throw,credit_throw_before_balance');
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('generate catch with the refund owed -> 503, admission completed after the owed record and alarm',
  res.status === 503 && row?.completed_at_ms !== null && only(lines('end'))?.outcome === 'refund_owed (503)'
  && events.prepare("SELECT COUNT(*) AS n FROM events WHERE event_name = 'generation.unrefunded'").get().n === 1);

// A first-ever balance: the generate admission and the opening's own admission.
reset();
res = await R.generate.POST(genReq(tokNew));
const rows = admissionRows();
check('generate for a new user -> two admissions, generate and opening (its own record), both completed',
  [202, 402].includes(res.status) && rows.length === 2 && rows.some((r) => r.route === 'opening' && r.subject_kind === 'user' && r.subject_id === NEWUSER)
  && rows.every((r) => r.completed_at_ms !== null));

// ── 3. Fail closed: a missing binding, a failed insert, an uncertain read-back ──

reset({ ledgerBound: false }); seedBalance(USER, 100);
res = await R.generate.POST(genReq(tok));
check('LEDGER_DB unbound -> generate 503 paused, an error admission line', res.status === 503 && balanceOf(USER) === 100
  && logs.some((l) => l.includes('"event":"admission"') && l.includes('LEDGER_DB binding missing')));

reset(); seedBalance(USER, 100); ledgerFail = (sql) => /INSERT INTO money_admissions/.test(sql);
res = await R.generate.POST(genReq(tok));
check('a failed admission insert -> 503 paused, nothing debited, outcome uncertain', res.status === 503 && balanceOf(USER) === 100
  && only(lines('admission'))?.outcome === 'uncertain');

// The insert lands, the read-back fails: answered paused, and the completion still completes the landed record.
reset(); seedBalance(USER, 100); ledgerFail = (sql) => /SELECT admission_id FROM money_admissions/.test(sql);
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('an uncertain admission (read-back fails) -> 503 paused, nothing debited', res.status === 503 && balanceOf(USER) === 100);
check('an uncertain admission -> its landed record is completed (keyed on the fresh id)', row?.completed_at_ms !== null);

// A hung admission insert: answered paused within the 2 s bound; nothing to complete.
reset(); seedBalance(USER, 100); ledgerDelay = (sql) => (/INSERT INTO money_admissions/.test(sql) ? Infinity : 0);
let t2 = Date.now();
const hung = R.generate.POST(genReq(tok));
res = await Promise.race([hung, sleep(10_000).then(() => null)]);
check('a hung admission insert -> 503 paused, outcome uncertain, nothing debited', res?.status === 503 && balanceOf(USER) === 100
  && only(lines('admission'))?.outcome === 'uncertain' && /timed out/.test(only(lines('admission'))?.error ?? ''));
check('...answered within the bound plus the wait for the insert (under 8 s), with a completion_no_row line',
  Date.now() - t2 < 8_000 && logs.some((l) => l.includes('"event":"completion_no_row"')));

// A slow admission insert that lands after its 2 s bound: paused, and its landed record still completed.
reset(); seedBalance(USER, 100); ledgerDelay = (sql) => (/INSERT INTO money_admissions/.test(sql) ? 2_500 : 0);
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('a slow admission insert (lands at 2.5 s) -> 503 paused, nothing debited', res.status === 503 && balanceOf(USER) === 100);
check('...and the completion waits for it, so the landed record is completed', row?.completed_at_ms !== null && row?.completed_at_ms !== undefined);

// ── 4. The completion: its failure, the dev faults, a closure before it ──

// An exception after the admission: the finally still completes, with outcome 'exception'.
reset();
const thrown = await adm.admitMoney({ route: 'daily_reward', kind: 'user', subject: USER, userId: USER, ids: { user_id: USER } });
let outcomeX = 'exception';
try { await (async () => { throw new Error('a route failure'); })(); outcomeX = 'never'; } catch { /* the route's error */ } finally { await thrown.complete(outcomeX); }
check('an exception after the admission -> the record completed, the end line outcome exception',
  only(admissionRows())?.completed_at_ms !== null && only(lines('end'))?.outcome === 'exception');

reset(); seedBalance(USER, 100); ledgerFail = (sql) => /UPDATE money_admissions SET completed_at_ms/.test(sql);
res = await R.generate.POST(genReq(tok));
row = only(admissionRows());
check('a failed completion write -> the answer unchanged (202), the record left open, a completion_failed line',
  res.status === 202 && row?.completed_at_ms === null && logs.some((l) => l.includes('"event":"completion_failed"')));

reset(); seedBalance(USER, 100); setFault('admission_complete_skip');
res = await R.generate.POST(genReq(tok));
check('dev fault admission_complete_skip -> 202, the record left open, as a killed request would',
  res.status === 202 && only(admissionRows())?.completed_at_ms === null && logs.some((l) => l.includes('"event":"completion_skipped"')));

reset(); seedBalance(USER, 100); setFault('admission_complete_fail:daily_reward');
res = await R.generate.POST(genReq(tok));
check('a fault scoped to another route (admission_complete_fail:daily_reward) leaves generate completed',
  res.status === 202 && only(admissionRows())?.completed_at_ms !== null);
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
const dr = admissionRows().find((r) => r.route === 'daily_reward');
check('...and fails the daily-reward completion, its answer unchanged (200), the record open',
  res.status === 200 && dr && dr.completed_at_ms === null);

// A completion after George's closing statement: kept beside it, the alarm row, a rerun changes nothing.
reset();
const late = await adm.admitMoney({ route: 'stripe_webhook', kind: 'event', subject: 'evt_late', userId: null, ids: { event_id: 'evt_late' } });
// A real admission precedes its end and both reads: move this one back first.
ledger.prepare('UPDATE money_admissions SET admitted_at_ms = ? WHERE admission_id = ?').run(Date.now() - 4 * 86400000, late.id);
const closedAt = Date.now();
ledger.prepare("UPDATE money_admissions SET closed_by = 'george', closed_at_ms = ?, close_note = 'test', close_evidence_json = ? WHERE admission_id = ?").run(
  closedAt, JSON.stringify({
    rows: [{ ref: 'token_tx:x', at_ms: 1 }], log_lines: [], other_tx: [],
    end: { kind: 'last_write', ref: 'webhook:stripe:evt_late', at_ms: Date.now() - 3 * 86400000 },
    reads: [{ at_ms: Date.now() - 2 * 86400000, balance: 5 }, { at_ms: Date.now() - 86400000, balance: 5 }],
    nothing_new: true, balance_explained: true,
  }), late.id);
check('a closure on the open record is accepted by 0002 (the test setup)', only(admissionRows())?.closed_at_ms === closedAt);
await late.complete('processed');
row = only(admissionRows());
let alarms = lateAlarms();
check('a completion after a closure -> kept beside it (both times set, nothing erased)', row?.completed_at_ms !== null && row?.closed_at_ms === closedAt && row?.close_note === 'test');
check('...the admission.late_completion row, keyed on the admission, level error, no user, no cost',
  alarms.length === 1 && alarms[0].dedupe_key === `${late.id}:admission.late_completion` && alarms[0].level === 'error'
  && alarms[0].user_id === null && !JSON.parse(alarms[0].event_json).extra.tokenCost);
check('...and a late_completion line', logs.some((l) => l.includes('"event":"late_completion"') && l.includes(late.id)));
const before = row.completed_at_ms;
await late.complete('processed');
check('a rerun after a lost reply changes nothing (one alarm row, the first completion kept)',
  only(admissionRows())?.completed_at_ms === before && lateAlarms().length === 1);
check('0002 refuses a closure without its evidence (the spec CHECK, as written)', (() => {
  try {
    ledger.prepare("INSERT INTO money_admissions (admission_id, route, subject_kind, subject_id, admitted_at_ms) VALUES ('x', 'opening', 'user', 'u', 1)").run();
    ledger.prepare("UPDATE money_admissions SET closed_by = 'g', closed_at_ms = 2, close_note = 'n', close_evidence_json = '{}' WHERE admission_id = 'x'").run();
    return false;
  } catch { return true; }
})());

// ── 5. Stripe webhook: the admission's user, the refusal row and r1_keys ──

reset(); seedBalance(USER, 10);
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_ok')));
row = only(admissionRows());
check('webhook open -> 200, admission route stripe_webhook, subject the event, user from the checkout metadata, completed',
  res.status === 200 && row?.route === 'stripe_webhook' && row?.subject_kind === 'event' && row?.subject_id === 'evt_ok'
  && row?.user_id === USER && row?.completed_at_ms !== null && balanceOf(USER) === 110);
check('webhook lines name the event id and type, outcome processed',
  only(lines('admission'))?.event_id === 'evt_ok' && only(lines('end'))?.event_type === 'checkout.session.completed' && only(lines('end'))?.outcome === 'processed');

reset();
res = await R['stripe/webhook'].POST(stripeReq(refundEvent('evt_refund')));
check('a refund event -> its admission has no user (found later from the mapping)', only(admissionRows())?.user_id === null);

const EPOCH = 1_790_000_000_000;
for (const [label, setup, expect] of [
  ["neither key -> 'absent'", () => {}, 'absent'],
  ["the mark present -> 'present'", () => kvMap.set('webhook:stripe:evt_p', '1'), 'present'],
  ["the credit key present -> 'present'", () => kvMap.set('token_idempotency:evt_p', '1'), 'present'],
  ["a read fails -> 'unknown'", () => { kvGetThrows = (k) => k.startsWith('token_idempotency:'); }, 'unknown'],
  ["one present, one failing -> 'present'", () => { kvMap.set('webhook:stripe:evt_p', '1'); kvGetThrows = (k) => k.startsWith('token_idempotency:'); }, 'present'],
]) {
  reset(); setPause('1', EPOCH); setup();
  res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_p')));
  const held = only(heldRows());
  check(`paused refusal, ${label}: 503, one row with this pause's epoch, the event's created time in ms, no admission`,
    res.status === 503 && held?.r1_keys === expect && held?.pause_epoch_ms === EPOCH && held?.event_created_ms === CREATED_S * 1000
    && held?.event_type === 'checkout.session.completed' && admissionRows().length === 0 && !kvMap.has('token_balance:' + USER));
}
reset({ kv: false }); setPause('1', EPOCH);
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_nokv')));
check("paused refusal with KV unbound -> 503, r1_keys 'unknown'", res.status === 503 && only(heldRows())?.r1_keys === 'unknown');

reset(); setPause('1', EPOCH);
await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_twice')));
await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_twice')));
check('the same refusal twice in one pause -> one row', heldRows().length === 1);
setPause('1', EPOCH + 1);
await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_twice')));
check('the same event refused in a later pause -> a second row, its own epoch', heldRows().length === 2 && heldRows().some((h) => h.pause_epoch_ms === EPOCH + 1));

reset(); ledgerFail = (sql) => /INSERT INTO money_admissions/.test(sql);
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_open_fail')));
check("a failed admission while money is open -> 503 paused, but no refusal row (the pause row reads '0')", res.status === 503 && heldRows().length === 0);

reset(); ledger.prepare("DELETE FROM control WHERE key = 'money_pause'").run();
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_absent')));
check('the pause row absent -> 503 paused (fail closed), no refusal row', res.status === 503 && heldRows().length === 0 && admissionRows().length === 0);

reset(); setPause('1', EPOCH); ledgerFail = (sql) => /INSERT INTO stripe_held/.test(sql);
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_heldfail')));
check('a failed refusal write -> still 503, a write_failed line', res.status === 503 && heldRows().length === 0
  && logs.some((l) => l.includes('"source":"stripe-held"') && l.includes('write_failed')));

// ── 6. Daily reward, email list, an opening ──

reset(); seedBalance(USER, 42);
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
row = only(admissionRows());
check('daily-reward open -> admission route daily_reward, subject the user, completed; the admission line names the candidate key',
  res.status === 200 && row?.route === 'daily_reward' && row?.subject_kind === 'user' && row?.subject_id === USER && row?.completed_at_ms !== null
  && only(lines('admission'))?.reward_key_candidate?.startsWith(`daily_login:${USER}:`) && !('reward_key' in only(lines('admission'))));
reset(); setPause('1'); seedBalance(USER, 42);
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
check('daily-reward paused -> 200 paused true, no admission row, no money write', res.status === 200 && (await json(res))?.paused === true
  && admissionRows().length === 0 && balanceOf(USER) === 42);

reset(); seedBalance(USER, 42);
res = await R['account/email-list'].POST(authReq('/api/account/email-list', tok, 'POST'));
row = only(admissionRows());
check('email-list open -> admission route email_list, completed even on its 400 (no email from Clerk)',
  res.status === 400 && row?.route === 'email_list' && row?.completed_at_ms !== null && only(lines('end'))?.outcome === 'no_email (400)');
reset(); setPause('1'); seedBalance(USER, 42);
res = await R['account/email-list'].POST(authReq('/api/account/email-list', tok, 'POST'));
check('email-list paused -> 503, no admission row', res.status === 503 && admissionRows().length === 0);

reset();
res = await R['token-balance'].GET(authReq('/api/token-balance', tokNew));
row = only(admissionRows());
check('an opening (GET /api/token-balance) -> admission route opening, subject the user, completed; end outcome opened',
  res.status === 200 && row?.route === 'opening' && row?.subject_id === NEWUSER && row?.completed_at_ms !== null
  && /^opened \(\d+\)$/.test(only(lines('end'))?.outcome ?? ''));
reset(); setPause('1');
res = await R['token-balance'].GET(authReq('/api/token-balance', tokNew));
check('an opening while paused -> 503 as today, no admission row, nothing written', res.status === 503 && admissionRows().length === 0 && balanceOf(NEWUSER) === null);

// ── 7. The status route's paused copy (O2, HQ-1's unapproved copy) ──

const JOB = 'job_s0_status_test';
const COPY = "SpriteBrew is finishing some maintenance. Your generation will start when it's done, or its tokens will be returned.";
for (const [label, ageMs, setup, expectCopy] of [
  ['a fresh job, paused', 5_000, () => setPause('1'), false],
  ['a held job older than 60 s, paused', 120_000, () => setPause('1'), true],
  ['a held job older than 60 s, open', 120_000, () => {}, false],
  ['a held job older than 60 s, the pause read failing', 120_000, () => { ledgerFail = (sql) => /money_pause/.test(sql); }, true],
]) {
  reset(); setup();
  kvMap.set(`job:${JOB}`, JSON.stringify({ status: 'pending', userId: USER, mode: 'create', enqueuedAt: Date.now() - ageMs }));
  res = await R['generation-status/[jobId]'].GET(...statusReq(JOB, tok));
  body = await json(res);
  check(`status route, ${label} -> ${expectCopy ? 'the paused copy' : 'no copy'}`, res.status === 200 && body?.status === 'pending'
    && (expectCopy ? body?.paused === true && body?.message === COPY : body?.paused === undefined && body?.message === undefined));
}
check('the paused copy has no em dash', !COPY.includes('\u2014'));

// ── 8. The hold faults (10.3) ──

reset(); seedBalance(USER, 100); setFault('delay_before_send:0.002');
const t0 = Date.now();
res = await R.generate.POST(genReq(tok));
check('delay_before_send:<minutes> holds the request about that long, then sends', res.status === 202 && Date.now() - t0 >= 100
  && logs.some((l) => l.includes('"fault":"delay_before_send"')));
reset(); seedBalance(USER, 100); setFault('delay_before_debit:abc');
res = await R.generate.POST(genReq(tok));
check('a hold fault without a usable minutes value holds nothing', res.status === 202 && !logs.some((l) => l.includes('"source":"dev-fault"')));
reset(); setFault('delay_before_debit:5'); process.env.APP_ENV = 'production';
const t1 = Date.now();
await mp.devDelay('delay_before_debit');
check('production never reads the faults (no hold)', Date.now() - t1 < 1_000 && (await mp.devFaultScope('delay_before_debit')) === undefined);
process.env.APP_ENV = 'dev';

// ── 9. The loader (n1-ledger-03 012, ruling 1): the forwarding and the swap ──

const CLIENT_OUT = path.join(OUT, 'client');
await build({
  entryPoints: {
    pollClient: path.join(ROOT, 'src/lib/pollClient.ts'),
    spriteStore: path.join(ROOT, 'src/stores/spriteStore.ts'),
    BrewingLoader: path.join(ROOT, 'src/components/sprites/BrewingLoader.tsx'),
    purchaseBanner: path.join(ROOT, 'src/lib/purchaseBanner.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: CLIENT_OUT, logLevel: 'error', jsx: 'automatic',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
});
const loadClient = async (name) => import(pathToFileURL(path.join(CLIENT_OUT, `${name}.mjs`)).href);
const pc = await loadClient('pollClient');
const store = (await loadClient('spriteStore')).useSpriteStore;
const BrewingLoader = (await loadClient('BrewingLoader')).default;
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

// The forwarding, from the real status route to pollClient's onUpdate:
// pollClient's fetch is served by the route, then a canned terminal error
// ends the loop. The hook, the forms' mirror and GenerationResult's prop are
// not loaded here (no React runner in this repo); the dev page check covers them.
const realFetch = globalThis.fetch;
const pollThrough = async (bodies) => {
  const states = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    const next = bodies[n++];
    if (typeof next === 'function') {
      await next();
      return R['generation-status/[jobId]'].GET(
        new Request(`https://dev.spritebrew.pages.dev${url}`, init), { params: Promise.resolve({ jobId: JOB }) });
    }
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const terminal = await pc.pollJobStatus(JOB, async () => tok, {
      initialIntervalMs: 1, longIntervalMs: 1, onUpdate: (s) => states.push(s),
    });
    return { states, terminal };
  } finally {
    globalThis.fetch = realFetch;
  }
};
const END = { status: 'error', error: 'end of test', refunded: true };
reset();
kvMap.set(`job:${JOB}`, JSON.stringify({ status: 'pending', userId: USER, mode: 'create', enqueuedAt: Date.now() - 120_000 }));
let polled = await pollThrough([() => setPause('1'), () => setPause('1'), () => setPause('0'), END]);
check('pollClient forwards paused and message from the status route while paused, then drops them once open',
  polled.states.length === 3 && polled.terminal.status === 'error'
  && polled.states.slice(0, 2).every((s) => s.status === 'pending' && s.paused === true && s.message === COPY)
  && polled.states[2].status === 'pending' && !('paused' in polled.states[2]) && !('message' in polled.states[2]));
polled = await pollThrough([
  { status: 'running', startedAt: 5, paused: true },
  { status: 'running', startedAt: 5, message: 'stray' },
  { status: 'running', startedAt: 5, paused: true, message: '' },
  END,
]);
check('pollClient forwards no copy without both paused: true and a message, and keeps startedAt',
  polled.states.length === 3 && polled.states.every((s) => s.status === 'running' && s.startedAt === 5 && !('paused' in s) && !('message' in s)));

// The store carries the copy from the poll to the loader.
store.getState().setGenerationProgress(1, 'pending', 'create', COPY);
const withCopy = store.getState().generationPausedMessage;
store.getState().setGenerationProgress(1, 'pending', 'create', null);
check('setGenerationProgress stores the paused copy and replaces it with null', withCopy === COPY && store.getState().generationPausedMessage === null);

// The swap: the copy replaces the expectation line while present; the usual line once absent.
const USUAL = 'Sprites usually take about 30 seconds, sometimes up to a minute and a half';
const ANIM_USUAL = 'Animations usually take about 2 minutes, sometimes up to 4';
// React's static render escapes the copy's apostrophe; compare against the escaped form.
const COPY_HTML = COPY.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const render = (props) => renderToStaticMarkup(createElement(BrewingLoader, { startedAt: Date.now(), serverStatus: 'pending', ...props }));
const swapped = render({ mode: 'create', pausedMessage: COPY });
const usual = render({ mode: 'create', pausedMessage: null });
const animSwapped = render({ mode: 'animate', action: 'walking', pausedMessage: COPY });
check('BrewingLoader shows the paused copy in place of its usual line while present',
  swapped.includes(COPY_HTML) && !swapped.includes(USUAL) && animSwapped.includes(COPY_HTML) && !animSwapped.includes(ANIM_USUAL));
check('BrewingLoader shows its usual line once the copy is absent', usual.includes(USUAL) && !usual.includes(COPY_HTML));
check('the swap changes only that line (headline and stage unchanged)',
  swapped.replace(COPY_HTML, USUAL) === usual && swapped.includes('Brewing your sprites...') && swapped.includes('Queued'));
// Past the long threshold (create 92,378 ms, animate 225,994 ms), where a held
// job usually is by the time the copy arrives: the copy replaces the long line too.
const LONG = 'Taking longer than usual. Still brewing, hang on.';
for (const [mode, action, afterMs] of [['create', null, 92_378], ['animate', 'walking', 225_994]]) {
  const late = (pausedMessage) => render({ mode, action, pausedMessage, startedAt: Date.now() - afterMs - 5_000 });
  const lateCopy = late(COPY);
  const lateUsual = late(null);
  check(`BrewingLoader past the ${mode} long threshold: the copy in place of the long line, and the long line once absent`,
    lateCopy.includes(COPY_HTML) && !lateCopy.includes(LONG) && lateUsual.includes(LONG) && !lateUsual.includes(COPY_HTML));
}

// ── 10. Daily-reward's key (Second's 040, n1-ledger-03 016) ──
//
// The admission line names today's key as a candidate; the end line names the
// key the credit used, from the helper, or null when nothing moved.

const keyOf = (u, day) => `daily_login:${u}:${day}`;
const today = () => new Date().toISOString().split('T')[0];
reset(); seedBalance(USER, 42);
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
let adLine = only(lines('admission')), endLine = only(lines('end'));
check('a granted reward: the end line names the key the credit used, the same day as the candidate',
  res.status === 200 && balanceOf(USER) === 45 && endLine?.outcome === 'rewarded (daily_login)'
  && endLine?.reward_key === keyOf(USER, today()) && endLine?.reward_key_candidate === keyOf(USER, today())
  && adLine?.reward_key_candidate === keyOf(USER, today()) && kvMap.has(`token_idempotency:${keyOf(USER, today())}`));
logs = [];
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
endLine = only(lines('end'));
check('no reward due: the end line names no key (null), the candidate kept', res.status === 200 && balanceOf(USER) === 45
  && endLine?.outcome === 'no reward due' && endLine?.reward_key === null && endLine?.reward_key_candidate === keyOf(USER, today()));
reset(); setPause('1'); seedBalance(USER, 42);
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
endLine = only(lines('end'));
check('paused: the end line names no key (null)', endLine?.outcome === 'paused' && endLine?.reward_key === null && balanceOf(USER) === 42);

// Second's trace: started at 23:59:59.999Z, the helper runs after midnight.
// The clock moves past midnight as the admission's insert runs, so the route's
// candidate is Oct 3 and the helper's own day is Oct 4.
const RealDate = Date;
let clockMs = 0;
class ClockDate extends RealDate {
  constructor(...a) { super(...(a.length ? a : [clockMs])); }
  static now() { return clockMs; }
}
const BEFORE = RealDate.UTC(2026, 9, 3, 23, 59, 59, 999);
const AFTER = RealDate.UTC(2026, 9, 4, 0, 0, 0, 20);
reset(); seedBalance(USER, 42);
kvMap.set(`streak:${USER}:last_reward_date`, '2026-10-03');
kvMap.set(`streak:${USER}:count`, '1');
globalThis.Date = ClockDate;
clockMs = BEFORE;
try {
  const tokMid = await tokenFor(USER);
  ledgerDelay = (sql) => { if (/INSERT INTO money_admissions/.test(sql)) clockMs = AFTER; return 0; };
  res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tokMid, 'POST'));
} finally {
  globalThis.Date = RealDate;
}
adLine = only(lines('admission')); endLine = only(lines('end'));
check('the midnight trace: the admission line names the Oct 3 candidate only',
  adLine?.reward_key_candidate === keyOf(USER, '2026-10-03') && !('reward_key' in (adLine ?? { reward_key: 1 })));
check('the midnight trace: the end line names the Oct 4 key the credit used, beside the Oct 3 candidate',
  endLine?.reward_key === keyOf(USER, '2026-10-04') && endLine?.reward_key_candidate === keyOf(USER, '2026-10-03'));
check('the midnight trace: credited once, under the Oct 4 key only; the helper picked its own day',
  res.status === 200 && balanceOf(USER) === 45 && kvMap.has(`token_idempotency:${keyOf(USER, '2026-10-04')}`)
  && !kvMap.has(`token_idempotency:${keyOf(USER, '2026-10-03')}`) && kvMap.get(`streak:${USER}:last_reward_date`) === '2026-10-04');

// The mirror: the helper fixes its day (Oct 3) before the clock crosses
// midnight, inside its own KV reads. A key recomputed from the clock at the
// end would say Oct 4; the helper's key says Oct 3.
reset(); seedBalance(USER, 42);
kvMap.set(`streak:${USER}:last_reward_date`, '2026-10-02');
kvMap.set(`streak:${USER}:count`, '1');
globalThis.Date = ClockDate;
clockMs = BEFORE;
try {
  const tokMid = await tokenFor(USER);
  kvGetThrows = (k) => { if (k === `streak:${USER}:count`) clockMs = AFTER; return false; };
  res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tokMid, 'POST'));
} finally {
  globalThis.Date = RealDate;
  kvGetThrows = () => false;
}
endLine = only(lines('end'));
check('the mirror trace: the end line names the helper\'s Oct 3 key, not a key recomputed after midnight',
  res.status === 200 && endLine?.reward_key === keyOf(USER, '2026-10-03') && endLine?.reward_key_candidate === keyOf(USER, '2026-10-03')
  && balanceOf(USER) === 45 && kvMap.has(`token_idempotency:${keyOf(USER, '2026-10-03')}`) && !kvMap.has(`token_idempotency:${keyOf(USER, '2026-10-04')}`));

// The helper's partial answers (KE-1): it answers null, yet a credit was tried.
reset(); seedBalance(USER, 42); setFault('credit_throw_after_balance');
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
endLine = only(lines('end'));
check('a credit whose balance write finished before it failed: the end line names its key, outcome incomplete',
  res.status === 200 && balanceOf(USER) === 45 && endLine?.reward_key === keyOf(USER, today())
  && endLine?.outcome === 'reward incomplete (balance written)' && !('reward_key_tried' in endLine));
reset(); seedBalance(USER, 42); kvPutThrows = (k) => k === `streak:${USER}:last_reward_date`;
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
endLine = only(lines('end'));
check('a full credit whose streak write then failed: the end line names its key, outcome incomplete',
  res.status === 200 && balanceOf(USER) === 45 && endLine?.reward_key === keyOf(USER, today())
  && endLine?.outcome === 'reward incomplete (balance written)');
reset(); seedBalance(USER, 42); setFault('credit_throw_before_balance');
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
endLine = only(lines('end'));
check('a credit that wrote nothing: reward_key null, the key named as tried, outcome failed',
  res.status === 200 && balanceOf(USER) === 42 && endLine?.reward_key === null && endLine?.reward_key_tried === keyOf(USER, today())
  && endLine?.outcome === 'reward failed (nothing written)');
reset(); seedBalance(USER, 42); setFault('credit_throw_after_balance');
kvMap.set(`signup_grant:${USER}`, JSON.stringify({ amount: 5, source: 'signup' }));
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
endLine = only(lines('end'));
check('a signup celebration in the same request keeps the daily credit\'s own status beside it',
  res.status === 200 && balanceOf(USER) === 45 && endLine?.reward_key === keyOf(USER, today())
  && endLine?.outcome === 'rewarded (signup); reward incomplete (balance written)');

// ── 11. The purchase banner by state (HQ-14, n1-ledger-03 016) ──

const pb = await loadClient('purchaseBanner');
const store11 = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const BASE = { userId: USER, balance: 100, tokens: 500, atMs: Date.now() };
const S = pb.bannerStateFor;
check('the four banner strings verbatim (HQ-14; state 3 and the late line as HQ 2026-10-03-008 worded them)',
  pb.PURCHASE_BANNER_COPY.added === 'Payment received. Your tokens have been added.'
  && pb.PURCHASE_BANNER_COPY.pending === 'Payment received. Your tokens will appear in a moment.'
  && pb.PURCHASE_BANNER_COPY.late === "Payment received. Your tokens are taking longer than usual to appear. You don't need to pay again."
  && pb.PURCHASE_BANNER_COPY.paused === "Payment received. We're finishing some maintenance, so your tokens may take a little while to appear. You don't need to do anything."
  && Object.keys(pb.PURCHASE_BANNER_COPY).length === 4);
check('the paused answers verbatim (HQ-1, HQ 2026-10-03-008), with no em dash',
  mp.PAUSED_MESSAGE === 'SpriteBrew is finishing some maintenance. Please try again in a little while. You were not charged.'
  && mp.UPDATING_MESSAGE === 'SpriteBrew is finishing some maintenance. Please try again in a little while.'
  && ![mp.PAUSED_MESSAGE, mp.UPDATING_MESSAGE, COPY, ...Object.values(pb.PURCHASE_BANNER_COPY)].some((t) => t.includes('\u2014')));
check('state 1 only on evidence: the balance up by the pack above the baseline', S({ ok: true, balance: 600, moneyPaused: false }, BASE) === 'added'
  && S({ ok: true, balance: 650, moneyPaused: false }, BASE) === 'added');
check('no state 1 on a smaller rise (a daily reward, a refund) or none', S({ ok: true, balance: 599, moneyPaused: false }, BASE) === 'pending'
  && S({ ok: true, balance: 103, moneyPaused: false }, BASE) === 'pending' && S({ ok: true, balance: 100, moneyPaused: false }, BASE) === 'pending');
check('no state 1 without a baseline, however high the balance', S({ ok: true, balance: 99_999, moneyPaused: false }, null) === 'pending'
  && S({ ok: true, balance: 99_999, moneyPaused: true }, null) === 'paused');
check('state 3 while paused, and when the pause is unknown or the read failed (fail closed)', S({ ok: true, balance: 100, moneyPaused: true }, BASE) === 'paused'
  && S({ ok: true, balance: 100 }, BASE) === 'paused' && S({ ok: false }, BASE) === 'paused' && S({ ok: false }, null) === 'paused');
check('evidence wins: a balance already up by the pack is state 1 even while paused', S({ ok: true, balance: 600, moneyPaused: true }, BASE) === 'added');

let st = store11();
pb.saveBaseline(BASE, st);
const took = pb.takeBaseline(USER, Date.now(), st);
check('the baseline is taken once: read, then removed', took?.balance === 100 && took?.tokens === 500 && pb.takeBaseline(USER, Date.now(), st) === null);
st = store11(); pb.saveBaseline(BASE, st);
check('another user\'s baseline is no baseline', pb.takeBaseline(NEWUSER, Date.now(), st) === null);
st = store11(); pb.saveBaseline({ ...BASE, atMs: Date.now() - pb.BASELINE_MAX_AGE_MS - 1 }, st);
const stale = pb.takeBaseline(USER, Date.now(), st);
st = store11(); st.setItem('spritebrew:purchaseBaseline', '{not json');
const bad = pb.takeBaseline(USER, Date.now(), st);
st = store11(); pb.saveBaseline({ ...BASE, tokens: 0 }, st);
check('a stale, malformed or zero-token baseline is no baseline; storage that throws is none', stale === null && bad === null
  && pb.takeBaseline(USER, Date.now(), st) === null
  && pb.takeBaseline(USER, Date.now(), { getItem: () => { throw new Error('denied'); }, setItem() {}, removeItem() {} }) === null);

const runWatch = async (reads, baseline, { windowMs = 60_000, intervalMs = 3_000 } = {}) => {
  let t = 0, n = 0;
  const states = [], balances = [];
  // A guard for a watcher that never stops: abort after 200 reads.
  const guard = new AbortController();
  const last = await pb.watchPurchase({
    read: async () => { if (n >= 200) guard.abort(); return reads[Math.min(n++, reads.length - 1)]; }, baseline, signal: guard.signal,
    onState: (s) => states.push(s), onBalance: (b) => balances.push(b),
    intervalMs, windowMs, now: () => t, sleep: async (ms) => { t += ms; },
  });
  return { last, states, balances, reads: n };
};
let w = await runWatch([{ ok: true, balance: 100, moneyPaused: false }, { ok: true, balance: 100, moneyPaused: false }, { ok: true, balance: 600, moneyPaused: false }], BASE);
check('state 2, re-checked, then state 1 when the credit lands; the re-check stops there',
  w.last === 'added' && w.states.join() === 'pending,pending,added' && w.reads === 3 && w.balances.join() === '100,100,600');
w = await runWatch([{ ok: true, balance: 100, moneyPaused: false }], BASE);
check('the re-check is bounded: a minute at 3 s (21 reads), state 2 throughout, then the late line once at the window\'s end',
  w.last === 'late' && w.reads === 21 && w.states.length === 22 && w.states.slice(0, 21).every((s) => s === 'pending') && w.states[21] === 'late');
w = await runWatch([{ ok: true, balance: 100, moneyPaused: true }, { ok: true, balance: 100, moneyPaused: true }, { ok: true, balance: 100, moneyPaused: false }, { ok: true, balance: 600, moneyPaused: false }], BASE);
check('the latch: state 3 while paused, held through the unpause (never state 2), state 1 when credited',
  w.states.join() === 'paused,paused,paused,added' && w.last === 'added');
w = await runWatch([{ ok: true, balance: 100, moneyPaused: false }, { ok: true, balance: 600, moneyPaused: false }], null);
check('without a baseline a credit never shows as state 1', w.last === 'late' && !w.states.includes('added'));

// The late line (HQ 2026-10-03-008): a text swap from state 2 only, at the window's end, with no read after it.
const OPEN_R = { ok: true, balance: 100, moneyPaused: false };
let tLate = 0;
let lateReads = 0;
const lateOrder = [];
const lateLast = await pb.watchPurchase({
  read: async () => { lateReads++; lateOrder.push('read'); return OPEN_R; }, baseline: BASE,
  onState: (s) => lateOrder.push(s), intervalMs: 3_000, windowMs: 9_000, now: () => tLate, sleep: async (ms) => { tLate += ms; },
});
check('the late line comes once, after the last read, and no read follows it',
  lateLast === 'late' && lateReads === 4 && lateOrder.at(-1) === 'late' && lateOrder.filter((x) => x === 'late').length === 1
  && lateOrder.lastIndexOf('read') < lateOrder.indexOf('late'));
w = await runWatch([{ ok: true, balance: 100, moneyPaused: true }], BASE, { windowMs: 9_000 });
check('no late line from state 3: the window ends on state 3', w.last === 'paused' && !w.states.includes('late'));
w = await runWatch([{ ok: true, balance: 100, moneyPaused: true }, { ok: true, balance: 100, moneyPaused: false }], BASE, { windowMs: 9_000 });
check('no late line from a latched state 3, even when the last reads were open', w.last === 'paused' && !w.states.includes('late'));
w = await runWatch([{ ok: true, balance: 100, moneyPaused: false }, { ok: true, balance: 600, moneyPaused: false }], BASE, { windowMs: 9_000 });
check('no late line from state 1', w.last === 'added' && !w.states.includes('late'));
const abortLate = new AbortController();
const abortStates = [];
let tAb = 0, nAb = 0;
await pb.watchPurchase({
  read: async () => { if (++nAb === 2) abortLate.abort(); return OPEN_R; }, baseline: BASE, onState: (s) => abortStates.push(s),
  signal: abortLate.signal, intervalMs: 3_000, windowMs: 9_000, now: () => tAb, sleep: async (ms) => { tAb += ms; },
});
check('no late line when the watcher is stopped (dismissed, or another user)', !abortStates.includes('late'));

// The window's other exit: a wait that ends past the window (a late timer).
// Reads of 900 ms, each wait 400 ms late: the last read ends at 56.8 s, its
// wait at 60.2 s, and the late line follows at once with no read after it.
const lateExit = async ({ abortInLastWait = false } = {}) => {
  let t = 0;
  const order = [];
  const ac = new AbortController();
  const last = await pb.watchPurchase({
    read: async () => { order.push(['read', t]); t += 900; return OPEN_R; }, baseline: BASE, signal: ac.signal,
    onState: (s) => order.push([s, t]), intervalMs: 3_000, windowMs: 60_000, now: () => t,
    sleep: async (ms) => { t += ms + 400; if (abortInLastWait && t > 60_000) ac.abort(); },
  });
  return { last, order };
};
const lx = await lateExit();
const lxLate = lx.order.filter(([s]) => s === 'late');
const lxReads = lx.order.filter(([s]) => s === 'read');
check('the late line after a late wait: once, at the wait\'s end (60.2 s), with no read after it',
  lx.last === 'late' && lxLate.length === 1 && lxLate[0][1] === 60_200 && lx.order.at(-1)[0] === 'late'
  && Math.max(...lxReads.map(([, at]) => at)) <= 60_000);
const lxAbort = await lateExit({ abortInLastWait: true });
check('no late line when the watcher is stopped during its last wait', !lxAbort.order.some(([s]) => s === 'late'));
// No timer beyond the window: the swap comes at the clock of the last read's end.
let tNt = 0;
const ntOrder = [];
await pb.watchPurchase({
  read: async () => { ntOrder.push(['read', tNt]); tNt += 500; return OPEN_R; }, baseline: BASE,
  onState: (s) => ntOrder.push([s, tNt]), intervalMs: 3_000, windowMs: 60_000, now: () => tNt, sleep: async (ms) => { tNt += ms; },
});
const ntLastRead = Math.max(...ntOrder.filter(([s]) => s === 'read').map(([, at]) => at));
check('no timer before the late line: it shows as the last read ends, with no wait between',
  ntOrder.at(-1)[0] === 'late' && ntOrder.at(-1)[1] === ntLastRead + 500 && ntOrder.at(-2)[0] === 'pending' && ntOrder.at(-2)[1] === ntLastRead + 500);

// A restart keeps the return's window (Second's 044): reads only in the time
// left, and none once it is spent, keeping the shown state.
const restart = async ({ previous, startedAt, at, read = OPEN_R, abort = false }) => {
  let t = at;
  const starts = [], states = [];
  const ac = new AbortController();
  if (abort) ac.abort();
  const last = await pb.watchPurchase({
    read: async () => { starts.push(t); return read; }, baseline: BASE, previous, startedAt, signal: ac.signal,
    onState: (s) => states.push(s), intervalMs: 3_000, windowMs: 60_000, now: () => t, sleep: async (ms) => { t += ms; },
  });
  return { last, starts, states };
};
let rs = await restart({ previous: 'pending', startedAt: 0, at: 30_000 });
check('a restart from state 2 before expiry reads only in the time left (30 s to 60 s), then the late line',
  rs.starts.length === 11 && rs.starts[0] === 30_000 && Math.max(...rs.starts) <= 60_000 && rs.last === 'late' && rs.states.at(-1) === 'late');
rs = await restart({ previous: 'pending', startedAt: 0, at: 61_000 });
check('a restart from state 2 after expiry starts no read and shows the late line', rs.starts.length === 0 && rs.last === 'late'
  && rs.states.join() === 'late');
rs = await restart({ previous: 'paused', startedAt: 0, at: 45_000 });
check('a restart from a latched state 3 before expiry: reads in the time left, still state 3', rs.starts.length > 0
  && Math.max(...rs.starts) <= 60_000 && rs.last === 'paused' && rs.states.every((x) => x === 'paused'));
rs = await restart({ previous: 'paused', startedAt: 0, at: 61_000 });
check('a restart from a latched state 3 after expiry starts no read and keeps state 3', rs.starts.length === 0
  && rs.last === 'paused' && rs.states.length === 0);
rs = await restart({ previous: 'added', startedAt: 0, at: 30_000 });
check('a restart from state 1 before expiry keeps state 1 and stops after one read', rs.starts.length === 1 && rs.last === 'added');
rs = await restart({ previous: 'added', startedAt: 0, at: 61_000 });
check('a restart from state 1 after expiry starts no read and keeps state 1', rs.starts.length === 0 && rs.last === 'added'
  && rs.states.length === 0);
rs = await restart({ previous: 'pending', startedAt: 0, at: 61_000, abort: true });
check('a stopped restart after expiry shows no late line', rs.starts.length === 0 && !rs.states.includes('late'));
rs = await restart({ previous: 'late', startedAt: 0, at: 61_000 });
check('a restart after the late line starts no read and keeps it', rs.starts.length === 0 && rs.last === 'late' && rs.states.length === 0);

// The latch (HQ 2026-10-03-005 decision 1, n1-ledger-03 020).
w = await runWatch([{ ok: false }, { ok: true, balance: 100, moneyPaused: false }, { ok: true, balance: 100, moneyPaused: false }], BASE, { windowMs: 6_000 });
check('the latch holds after a failed read too: state 3 to the window\'s end, never state 2',
  w.states.join() === 'paused,paused,paused' && w.last === 'paused');
w = await runWatch([{ ok: true, balance: 100, moneyPaused: true }, { ok: true, balance: 100, moneyPaused: false }], null, { windowMs: 3_000 });
check('the latch without a baseline: state 3 stays (state 1 is unreachable without evidence)', w.states.join() === 'paused,paused');
const NB = pb.nextBannerState;
const OPEN = { ok: true, balance: 100, moneyPaused: false };
check('nextBannerState: paused holds over open and failed reads; added holds; evidence moves paused to added; no latch from pending',
  NB('paused', OPEN, BASE) === 'paused'
  && NB('paused', { ok: false }, BASE) === 'paused' && NB('paused', { ok: true, balance: 600, moneyPaused: true }, BASE) === 'added'
  && NB('added', { ok: true, balance: 100, moneyPaused: true }, BASE) === 'added' && NB('added', { ok: false }, null) === 'added'
  && NB('pending', { ok: true, balance: 100, moneyPaused: true }, BASE) === 'paused' && NB('pending', OPEN, BASE) === 'pending'
  && NB(null, OPEN, BASE) === 'pending');
let tR = 0;
const restarted = [];
const lastR = await pb.watchPurchase({
  read: async () => OPEN, baseline: BASE, previous: 'paused', onState: (s) => restarted.push(s),
  windowMs: 3_000, intervalMs: 3_000, now: () => tR, sleep: async (ms) => { tR += ms; },
});
check('a restarted watcher keeps the latch it is given (the page passes the state already shown)',
  lastR === 'paused' && restarted.length > 0 && restarted.every((s) => s === 'paused'));

// The strict window (Second's 042): no read starts after the window, read time counted.
const windowStarts = async (readMs, lateMs = 0, intervalMs = 3_000, windowMs = 60_000) => {
  let t = 0;
  const starts = [];
  await pb.watchPurchase({
    read: async () => { starts.push(t); t += readMs; return OPEN; }, baseline: BASE, onState: () => {},
    intervalMs, windowMs, now: () => t, sleep: async (ms) => { t += ms + lateMs; },
  });
  return starts;
};
const ws0 = await windowStarts(0), ws1 = await windowStarts(1_000), ws25 = await windowStarts(2_500), ws7 = await windowStarts(7_000);
check('the strict window: no read starts more than 60 s after the first, read time counted',
  [ws0, ws1, ws25, ws7].every((s) => s.length > 1 && Math.max(...s) <= 60_000)
  && ws0.length === 21 && ws1.length === 16 && ws25.length === 11 && ws7.length === 7);
// Each wait 2.5 s late: after the read at 55 s the next would start at 60.5 s.
const wsLate = await windowStarts(0, 2_500);
check('the strict window holds when a timer fires late (each wait 2.5 s long): the read due at 60.5 s never starts',
  wsLate.length === 11 && Math.max(...wsLate) === 55_000);

// One user's state is never shown to another (Second's 042).
check('shownFor: the state only for the user it was shown to', pb.shownFor({ userId: USER, state: 'added' }, USER) === 'added'
  && pb.shownFor({ userId: USER, state: 'added' }, NEWUSER) === null && pb.shownFor({ userId: USER, state: 'paused' }, null) === null
  && pb.shownFor(null, USER) === null);

// The return read, through the real /api/token-balance.
let pauseReads = 0;
const tbFetch = (hang = false) => async (url, init) => {
  if (hang) return new Promise(() => {});
  return R['token-balance'].GET(new Request(`https://dev.spritebrew.pages.dev${url}`, init));
};
const spyPause = (failIt = false) => { pauseReads = 0; ledgerFail = (sql) => { if (/money_pause/.test(sql)) { pauseReads++; return failIt; } return false; }; };
const withFetch = async (f, fn) => { const saved = globalThis.fetch; globalThis.fetch = f; try { return await fn(); } finally { globalThis.fetch = saved; } };
reset(); seedBalance(USER, 100); spyPause();
let rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => tok));
check('the return read, open: the balance and moneyPaused false, one pause read', rd.ok && rd.balance === 100 && rd.moneyPaused === false && pauseReads === 1);
reset(); seedBalance(USER, 100); setPause('1'); spyPause();
rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => tok));
check('the return read, paused: moneyPaused true, so state 3', rd.ok && rd.moneyPaused === true && S(rd, BASE) === 'paused');
reset(); seedBalance(USER, 100); spyPause(true);
rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => tok));
check('the return read, the pause read failing: moneyPaused true (fail closed)', rd.ok && rd.moneyPaused === true && S(rd, BASE) === 'paused');
reset(); setPause('1'); spyPause();
rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => tokNew));
check('the return read for a user with no balance record: no opening, no balance, the pause still read (state 3 while paused)',
  rd.ok && rd.balance === undefined && rd.moneyPaused === true && S(rd, null) === 'paused'
  && admissionRows().length === 0 && balanceOf(NEWUSER) === null);
reset(); spyPause();
rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => tokNew));
const baseNew = await withFetch(tbFetch(), () => pb.readBaselineBalance(async () => tokNew));
check('the flagged reads for a user with no balance record, money open: no opening, no admission, no balance written',
  rd.ok && rd.balance === undefined && rd.moneyPaused === false && baseNew === null && pauseReads === 1
  && admissionRows().length === 0 && balanceOf(NEWUSER) === null && !calls.some((c) => c.startsWith('kv.put')));
rd = await withFetch(async () => { throw new TypeError('network'); }, () => pb.readPurchaseStatus(async () => tok));
const tHang = Date.now();
const rdHang = await Promise.race([
  withFetch(tbFetch(true), () => pb.readPurchaseStatus(async () => tok, undefined, 50)),
  new Promise((r) => setTimeout(() => r({ ok: 'still waiting' }), 3_000)),
]);
check('the return read, failed or unanswered (bounded): no answer, so state 3', !rd.ok && S(rd, BASE) === 'paused'
  && rdHang.ok === false && Date.now() - tHang < 2_000);
const tTok = Date.now();
const rdTok = await Promise.race([
  pb.readPurchaseStatus(() => new Promise(() => {}), undefined, 50),
  new Promise((r) => setTimeout(() => r('still waiting'), 3_000)),
]);
check('the bound covers a token that never comes', rdTok !== 'still waiting' && rdTok.ok === false && Date.now() - tTok < 2_000);
let seenSignal = null;
const abortable = new AbortController();
const rdAbort = withFetch(async (url, init) => {
  seenSignal = init.signal;
  return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
}, () => pb.readPurchaseStatus(async () => tok, abortable.signal, 5_000));
await sleep(20);
abortable.abort();
const rdAborted = await rdAbort;
check('the caller\'s abort reaches the request, and the read ends with no answer', seenSignal?.aborted === true && rdAborted.ok === false);
reset(); seedBalance(USER, 100); spyPause();
const plain = await withFetch(tbFetch(), async () => {
  const r = await R['token-balance'].GET(authReq('/api/token-balance', tok));
  return json(r);
});
const baseBal = await withFetch(tbFetch(), () => pb.readBaselineBalance(async () => tok));
check('an ordinary balance load is unchanged, and neither it nor the baseline read reads the pause',
  plain?.success === true && plain?.balance === 100 && 'tokenCosts' in plain && !('moneyPaused' in plain) && baseBal === 100 && pauseReads === 0);

// BA-1: a balance read that fails must never become evidence. getTokenBalance
// answers a guessed 5 on a KV error; the banner's reads are strict.
reset(); seedBalance(USER, 1000); kvGetThrows = (k) => k === `token_balance:${USER}`;
const guessed = await R['token-balance'].GET(authReq('/api/token-balance', tok)).then(json);
st = store11();
pb.saveBaseline({ ...BASE, balance: 1 }, st);
const prepFailed = await withFetch(tbFetch(), () => pb.prepareBaseline({ userId: USER, tokens: 500, getToken: async () => tok, storage: st }));
check('a failed KV read before checkout: no baseline (and an older one cleared), where the plain route guesses 5',
  guessed?.balance === 5 && prepFailed === null && st.getItem('spritebrew:purchaseBaseline') === null);
rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => tok));
check('a failed KV read on return: no balance, so never state 1, even against a low baseline',
  rd.ok && rd.balance === undefined && S(rd, { ...BASE, balance: 0, tokens: 1 }) !== 'added');
kvGetThrows = () => false;
st = store11();
spyPause();
const prepared = await withFetch(tbFetch(), () => pb.prepareBaseline({ userId: USER, tokens: 500, getToken: async () => tok, storage: st, nowMs: 1_000 }));
check('prepareBaseline saves the route\'s strict balance with the pack\'s tokens', prepared?.balance === 1000 && prepared?.tokens === 500
  && JSON.parse(st.getItem('spritebrew:purchaseBaseline') ?? '{}').balance === 1000 && pauseReads === 0);

// The shipped timings, as the page uses them (it passes neither option).
let tDef = 0, nDef = 0;
const sleeps = [];
const lastDef = await pb.watchPurchase({
  read: async () => { nDef++; return { ok: true, balance: 100, moneyPaused: false }; }, baseline: BASE, onState: () => {},
  now: () => tDef, sleep: async (ms) => { sleeps.push(ms); tDef += ms; },
});
check('the shipped re-check: every 3 s for a minute (21 reads), each read bounded at 8 s',
  lastDef === 'late' && nDef === 21 && sleeps.length === 20 && sleeps.every((ms) => ms === 3_000) && pb.RECHECK_INTERVAL_MS === 3_000
  && pb.RECHECK_WINDOW_MS === 60_000 && pb.READ_TIMEOUT_MS === 8_000);
const abortWatch = new AbortController();
const afterAbort = [];
await pb.watchPurchase({
  read: async () => { abortWatch.abort(); return { ok: true, balance: 600, moneyPaused: false }; }, baseline: BASE,
  onState: (s) => afterAbort.push(s), onBalance: (b) => afterAbort.push(b), signal: abortWatch.signal,
  now: () => 0, sleep: async () => {},
});
check('an abort during a read shows nothing from that read', afterAbort.length === 0);

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
