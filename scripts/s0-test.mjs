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
// queue are in-memory stubs. Nothing is written or printed but case names and
// pass or fail.

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
let calls = [];
function kvStub() {
  return {
    get: async (k) => { calls.push(`kv.get ${k}`); if (kvGetThrows(k)) throw new Error('stub: KV get failed'); return kvMap.has(k) ? kvMap.get(k) : null; },
    getWithMetadata: async (k) => ({ value: kvMap.get(k) ?? null, metadata: null }),
    put: async (k, v) => { calls.push(`kv.put ${k}`); kvMap.set(k, v); },
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
  freshDbs(); kvMap = new Map(); kvGetThrows = () => false; calls = []; queueThrows = false; lastMessage = null; logs = [];
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
check('daily-reward open -> admission route daily_reward, subject the user, completed; lines name the reward key',
  res.status === 200 && row?.route === 'daily_reward' && row?.subject_kind === 'user' && row?.subject_id === USER && row?.completed_at_ms !== null
  && only(lines('admission'))?.reward_key?.startsWith(`daily_login:${USER}:`));
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
const COPY = 'SpriteBrew is updating. Your generation will start in a few minutes, or its tokens will be returned.';
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

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
