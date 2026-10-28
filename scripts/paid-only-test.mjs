// scripts/paid-only-test.mjs
//
// Offline tests for paid-only 001: the Stripe webhook credits a
// checkout.session.completed only when its session's payment_status is 'paid'.
// Anything else (unpaid, no_payment_required, or no status at all) answers 200,
// credits nothing, sets no paid flag, stores no purchase record, and is still
// marked processed, with the outcome "processed (not paid, no credit)". A paid
// replay is deduplicated, and charge.refunded and charge.dispute.created are
// handled as before. Run from the repo root: `node scripts/paid-only-test.mjs`.
//
// Built the way s0-test.mjs builds the route: LEDGER_DB and EVENTS_DB are real
// SQLite databases (node:sqlite, in memory) from the consumer repo's migrations,
// so the webhook's admission runs as written; KV is an in-memory stub. Stripe is
// never reached: src/lib/stripe.ts builds its client at module load with the
// global fetch, so a stub is installed before the bundle is imported, and it
// records every call. The harness writes only its bundle, to
// local/.paid-only-test (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

// src/lib/stripe.ts builds its client at module load; placeholders, not secrets.
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_secret';
const WHSEC = 'whsec_placeholder_not_a_secret';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.paid-only-test');
const CONSUMER = process.env.S0_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MIGRATIONS = [
  path.join(CONSUMER, 'migrations-ledger', '0001_control.sql'),
  path.join(CONSUMER, 'migrations-ledger', '0002_stripe_refusals.sql'),
];
const EVENTS_MIGRATION = path.join(CONSUMER, 'migrations', '0001_events.sql');
for (const f of [...MIGRATIONS, EVENTS_MIGRATION]) {
  if (!existsSync(f)) { console.log(`[paid-only-test] missing ${f}: check out the consumer's n1-s0 branch`); process.exit(1); }
}

// ── Stripe, stubbed at the global fetch (installed before the bundle loads) ──

let stripeCalls = [];
const stripeJson = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  stripeCalls.push(`${init?.method ?? 'GET'} ${u.pathname}`);
  const pi = u.pathname.match(/^\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)$/);
  if (pi) return stripeJson(200, { id: pi[1], object: 'payment_intent', latest_charge: pi[1].replace(/^pi_/, 'ch_') });
  const ch = u.pathname.match(/^\/v1\/charges\/(ch_[A-Za-z0-9_]+)$/);
  if (ch) return stripeJson(200, { id: ch[1], object: 'charge', billing_details: { email: null }, payment_method_details: null, metadata: {} });
  return stripeJson(404, { error: { type: 'invalid_request_error', message: 'stub: no such route' } });
};

// ── D1 over node:sqlite, KV stub ──

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
let ledger, events, kvMap, logs;
function reset() {
  ledger = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) ledger.exec(readFileSync(f, 'utf8'));
  events = new DatabaseSync(':memory:');
  events.exec(readFileSync(EVENTS_MIGRATION, 'utf8'));
  kvMap = new Map(); logs = []; stripeCalls = [];
  process.env = { ...process.env };
  Object.assign(process.env, {
    APP_ENV: 'dev', STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret', STRIPE_WEBHOOK_SECRET: WHSEC,
    LEDGER_DB: d1(ledger), EVENTS_DB: d1(events),
    SPRITEBREW_KV: {
      get: async (k) => (kvMap.has(k) ? kvMap.get(k) : null),
      getWithMetadata: async (k) => ({ value: kvMap.get(k) ?? null, metadata: null }),
      put: async (k, v) => { kvMap.set(k, v); },
      delete: async (k) => { kvMap.delete(k); },
      list: async ({ prefix } = {}) => ({ keys: [...kvMap.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true }),
    },
  });
}
console.warn = (...a) => { logs.push(a.map(String).join(' ')); };
console.error = (...a) => { logs.push(a.map(String).join(' ')); };
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[paid-only-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[paid-only-test] ', '') : x));
  else logs.push(a.map(String).join(' '));
})(console.log);
const say = (...a) => console.log('[paid-only-test]', ...a);

// ── Bundle ──

await build({
  entryPoints: { webhook: path.join(ROOT, 'src/app/api/stripe/webhook/route.ts') },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const W = await import(pathToFileURL(path.join(OUT, 'webhook.mjs')).href);

// ── Helpers ──

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const USER = 'user_PAIDONLYTESTPAIDONLYTEST01';
const START = 10;
const seedBalance = (n) => kvMap.set(`token_balance:${USER}`, JSON.stringify({ balance: n, created_at: 'x', last_updated: 'x' }));
const balance = () => JSON.parse(kvMap.get(`token_balance:${USER}`)).balance;
const txRows = (type) => [...kvMap.entries()].filter(([k]) => k.startsWith(`token_tx:${USER}:`))
  .map(([, v]) => JSON.parse(v)).filter((t) => t.type === type);
const flagSet = () => kvMap.get(`purchase:${USER}:has_paid`) === 'true';
const purchaseRecords = () => [...kvMap.keys()].filter((k) => /^purchase:ch_/.test(k));
const marked = (id) => kvMap.has(`webhook:stripe:${id}`);
const endLines = () => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((l) => l.source === 'money-admission' && l.event === 'end');
const outcomesFor = (id) => endLines().filter((l) => l.event_id === id).map((l) => l.outcome);
const admissionsDone = () => ledger.prepare('SELECT completed_at_ms FROM money_admissions').all().every((r) => r.completed_at_ms !== null);
const notPaidLines = () => logs.filter((l) => l.startsWith('[Stripe Webhook] Checkout not paid; no credit'));
const NOT_PAID = 'processed (not paid, no credit)';

function stripeReq(evt) {
  const payload = JSON.stringify(evt);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WHSEC).update(`${t}.${payload}`).digest('hex');
  return new Request('https://dev.spritebrew.pages.dev/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}`, 'content-type': 'application/json' }, body: payload,
  });
}
async function post(evt) {
  const res = await W.POST(stripeReq(evt));
  let body = null; try { body = await res.clone().json(); } catch { /* not JSON */ }
  return { res, body };
}
// A Checkout for 100 tokens; `status` undefined leaves payment_status out.
const checkoutEvent = (id, status, pi = 'pi_paid_1') => {
  const session = { id: `cs_${id}`, object: 'checkout.session', payment_intent: pi, amount_total: 499,
    metadata: { userId: USER, packId: 'starter', tokens: '100' } };
  if (status !== undefined) session.payment_status = status;
  return { id, object: 'event', type: 'checkout.session.completed', api_version: '2026-03-25.dahlia', created: 1, data: { object: session } };
};
const refundEvent = (id, chargeId, refunded = 499) => ({
  id, object: 'event', type: 'charge.refunded', api_version: '2026-03-25.dahlia', created: 1,
  data: { object: { id: chargeId, object: 'charge', amount: 499, amount_refunded: refunded, refunded: true, metadata: {} } },
});
const disputeEvent = (id, chargeId) => ({
  id, object: 'event', type: 'charge.dispute.created', api_version: '2026-03-25.dahlia', created: 1,
  data: { object: { id: 'dp_test_1', object: 'dispute', charge: chargeId, amount: 499, reason: 'fraudulent' } },
});

// ── 1. paid: credited once, flag set, record stored ──

reset(); seedBalance(START);
let r = await post(checkoutEvent('evt_paid', 'paid'));
check('paid: 200 received, credited once (10 to 110), one credit row for the pack',
  r.res.status === 200 && JSON.stringify(r.body) === '{"received":true}' && balance() === START + 100
  && txRows('credit').length === 1 && txRows('credit')[0].reason === 'token_pack_purchase:starter' && kvMap.has('token_idempotency:evt_paid'));
{
  const rec = JSON.parse(kvMap.get('purchase:ch_paid_1') ?? 'null');
  check('paid: the paid flag set, and the purchase record stored for its charge (one PaymentIntent read)',
    flagSet() && rec?.userId === USER && rec?.tokens === 100 && rec?.packId === 'starter' && rec?.sessionId === 'cs_evt_paid'
    && rec?.chargeId === 'ch_paid_1' && rec?.amount === 499
    && JSON.stringify(stripeCalls) === JSON.stringify(['GET /v1/payment_intents/pi_paid_1']));
}
check('paid: the event marked, the admission completed, outcome "processed", no not-paid line',
  marked('evt_paid') && admissionsDone() && JSON.stringify(outcomesFor('evt_paid')) === '["processed"]' && notPaidLines().length === 0);

// ── 2. Not paid: unpaid, no_payment_required, and no status at all ──

for (const [label, status, id] of [
  ['unpaid', 'unpaid', 'evt_unpaid'],
  ['no_payment_required', 'no_payment_required', 'evt_npr'],
  ['a missing payment_status', undefined, 'evt_nostatus'],
]) {
  reset(); seedBalance(START);
  r = await post(checkoutEvent(id, status));
  check(`${label}: 200 received, no credit (balance 10, no credit row, no credit key)`,
    r.res.status === 200 && JSON.stringify(r.body) === '{"received":true}' && balance() === START
    && txRows('credit').length === 0 && !kvMap.has(`token_idempotency:${id}`));
  check(`${label}: no paid flag, no purchase record, no Stripe call`,
    !flagSet() && purchaseRecords().length === 0 && stripeCalls.length === 0);
  check(`${label}: the event marked, the admission completed, outcome "${NOT_PAID}"`,
    marked(id) && admissionsDone() && JSON.stringify(outcomesFor(id)) === JSON.stringify([NOT_PAID]));
  const lines = notPaidLines();
  check(`${label}: one not-paid line, with the status and the session id and no user id`,
    lines.length === 1 && lines[0] === `[Stripe Webhook] Checkout not paid; no credit (status: ${status ?? 'missing'}, session: cs_${id})`
    && !lines[0].includes(USER));
}

// ── 3. Replays ──

reset(); seedBalance(START);
{
  const first = await post(checkoutEvent('evt_twice', 'paid'));
  const second = await post(checkoutEvent('evt_twice', 'paid'));
  check('a replay of a paid event: deduplicated; credited once (110), one credit row, one PaymentIntent read, one record',
    first.res.status === 200 && second.res.status === 200 && JSON.stringify(second.body) === '{"received":true,"deduplicated":true}'
    && balance() === START + 100 && txRows('credit').length === 1 && stripeCalls.length === 1 && purchaseRecords().length === 1
    && JSON.stringify(outcomesFor('evt_twice')) === '["processed","deduplicated"]');
}
reset(); seedBalance(START);
{
  await post(checkoutEvent('evt_unpaid_twice', 'unpaid'));
  const second = await post(checkoutEvent('evt_unpaid_twice', 'unpaid'));
  check('a replay of an unpaid event: deduplicated, still no credit, no flag, no record',
    JSON.stringify(second.body) === '{"received":true,"deduplicated":true}' && balance() === START && txRows('credit').length === 0
    && !flagSet() && purchaseRecords().length === 0 && JSON.stringify(outcomesFor('evt_unpaid_twice')) === JSON.stringify([NOT_PAID, 'deduplicated']));
}

// ── 4. charge.refunded and charge.dispute.created, as before ──

reset(); seedBalance(START);
{
  await post(checkoutEvent('evt_buy_r', 'paid'));
  stripeCalls = [];
  r = await post(refundEvent('evt_refund', 'ch_paid_1'));
  check('charge.refunded for a paid purchase: 200, 100 tokens debited (110 to 10), refund count 1, evidence recorded, outcome "processed"',
    r.res.status === 200 && balance() === START && kvMap.get(`refund_count:${USER}`) === '1' && kvMap.has(`last_refund_at:${USER}`)
    && [...kvMap.keys()].some((k) => k.startsWith('evidence:ch_paid_1:')) && !kvMap.has(`account_status:${USER}`)
    && marked('evt_refund') && JSON.stringify(outcomesFor('evt_refund')) === '["processed"]' && stripeCalls.length === 0);
}
reset(); seedBalance(START);
{
  await post(checkoutEvent('evt_buy_neg', 'paid'));
  seedBalance(30);
  r = await post(refundEvent('evt_refund_neg', 'ch_paid_1'));
  const status = JSON.parse(kvMap.get(`account_status:${USER}`) ?? 'null');
  check('charge.refunded after the tokens were spent: the balance goes negative (30 to -70) and the account is refund_locked',
    r.res.status === 200 && balance() === -70 && status?.status === 'refund_locked' && status?.stripe_charge_id === 'ch_paid_1');
}
reset(); seedBalance(START);
{
  r = await post(refundEvent('evt_refund_other', 'ch_not_ours'));
  check('charge.refunded for a charge with no purchase record: 200, nothing debited, no refund count, outcome "processed"',
    r.res.status === 200 && balance() === START && !kvMap.has(`refund_count:${USER}`)
    && marked('evt_refund_other') && JSON.stringify(outcomesFor('evt_refund_other')) === '["processed"]');
}
reset(); seedBalance(START);
{
  await post(checkoutEvent('evt_buy_d', 'paid'));
  stripeCalls = [];
  r = await post(disputeEvent('evt_dispute', 'ch_paid_1'));
  const status = JSON.parse(kvMap.get(`account_status:${USER}`) ?? 'null');
  const disputed = JSON.parse(kvMap.get(`disputed:${USER}`) ?? 'null');
  check('charge.dispute.created for a paid purchase: 200, all 100 tokens debited, account disputed, dispute record, one charge read, outcome "processed"',
    r.res.status === 200 && balance() === START && status?.status === 'disputed' && status?.stripe_dispute_id === 'dp_test_1'
    && disputed?.charge_id === 'ch_paid_1' && disputed?.dispute_id === 'dp_test_1'
    && [...kvMap.keys()].some((k) => k.startsWith('evidence:ch_paid_1:'))
    && JSON.stringify(stripeCalls) === JSON.stringify(['GET /v1/charges/ch_paid_1'])
    && marked('evt_dispute') && JSON.stringify(outcomesFor('evt_dispute')) === '["processed"]');
}

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
