// scripts/money-pause-test.mjs
//
// Offline tests for release 1 of n1-ledger (005 section 4, 007 section 4,
// 008 rulings A and G), Pages side. Run from the repo root:
// `node scripts/money-pause-test.mjs`.
//
// The pause helper, tokenBalance and five routes are bundled with esbuild
// into local/.money-pause-test/ (gitignored) and called with an in-memory KV,
// a stub `control` table and counting stubs for the queue, R2, D1 and fetch.
// Keys are generated in memory for this run only; nothing is written or
// printed but case names and pass or fail.

import { build } from 'esbuild';
import { createHmac, webcrypto } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const subtle = webcrypto.subtle;
// src/lib/stripe.ts builds its client at module load; a placeholder, not a secret.
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_secret';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.money-pause-test');
const WHSEC = 'whsec_placeholder_not_a_secret';

// ── Session token (in memory only) ──

const pair = await subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
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

let calls = [];
let kvMap = new Map();
let kvFailPut = () => false;
let kvTtl = new Map();
function kvStub() {
  return {
    get: async (k) => { calls.push(`kv.get ${k}`); return kvMap.has(k) ? kvMap.get(k) : null; },
    getWithMetadata: async (k) => { calls.push(`kv.getWithMetadata ${k}`); return { value: kvMap.get(k) ?? null, metadata: null }; },
    put: async (k, v, opts) => {
      calls.push(`kv.put ${k}`);
      if (kvFailPut(k)) throw new Error('stub: KV put failed');
      kvMap.set(k, v); kvTtl.set(k, opts?.expirationTtl);
    },
    delete: async (k) => { calls.push(`kv.delete ${k}`); kvMap.delete(k); },
    list: async ({ prefix } = {}) => {
      calls.push(`kv.list ${prefix}`);
      return { keys: [...kvMap.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true };
    },
  };
}
// The ledger's control table: { money_pause, dev_fault }, or `throws`.
let control = { money_pause: '0' };
let controlThrows = false;
let pauseReads = 0;
// Sequenced answers for money_pause, consumed one per read, then `control`.
let pauseSequence = [];
function ledgerStub() {
  return {
    prepare: (sql) => ({
      first: async () => {
        calls.push('ledger.first');
        if (controlThrows) throw new Error('stub: D1 unavailable');
        const key = /'(money_pause|dev_fault)'/.exec(sql)?.[1];
        if (key === 'money_pause') {
          pauseReads++;
          if (pauseSequence.length) return { value: pauseSequence.shift() };
        }
        return key && control[key] !== undefined ? { value: control[key] } : null;
      },
    }),
  };
}
let eventsRows = [];
let eventsThrow = false;
function eventsStub() {
  return {
    prepare: (sql) => {
      const stmt = {
        args: [],
        bind: (...a) => { stmt.args = a; return stmt; },
        run: async () => {
          calls.push('events.run');
          if (eventsThrow) throw new Error('stub: D1 insert failed');
          eventsRows.push({ sql, args: stmt.args });
          return { meta: { changes: 1 } };
        },
        first: async () => {
          calls.push('events.first');
          if (/WHERE dedupe_key = \?1/.test(sql)) return eventsRows.some((r) => r.args[1] === stmt.args[0]) ? { ok: 1 } : null;
          return null;
        },
        all: async () => ({ results: [] }),
      };
      return stmt;
    },
  };
}
function r2Stub() {
  return {
    get: async () => { calls.push('r2.get'); return null; },
    head: async () => { calls.push('r2.head'); return null; },
    put: async (k) => { calls.push(`r2.put ${k}`); return {}; },
  };
}
let queueThrows = false;
function env({ ledger = true, kv = true, kickoff = 'true', events = true } = {}) {
  // A plain object: Node's own process.env turns every value into a string.
  process.env = { ...process.env };
  for (const k of ['LEDGER_DB', 'SPRITEBREW_KV']) delete process.env[k];
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid',
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret', STRIPE_WEBHOOK_SECRET: WHSEC,
    QUEUE_KICKOFF_ENABLED: kickoff, RESEND_API_KEY: 'placeholder', RESEND_AUDIENCE_ID: 'placeholder',
    CLERK_SECRET_KEY: 'placeholder', GALLERY_BUCKET: r2Stub(), EVENTS_DB: eventsStub(),
    RD_QUEUE: { send: async () => { calls.push('queue.send'); if (queueThrows) throw new Error('stub: send failed'); } },
  });
  if (ledger) process.env.LEDGER_DB = ledgerStub();
  if (kv) process.env.SPRITEBREW_KV = kvStub();
  if (!events) delete process.env.EVENTS_DB;
}
function reset(over = {}) {
  calls = []; kvMap = new Map(); kvTtl = new Map(); kvFailPut = () => false; eventsRows = []; eventsThrow = false;
  control = { money_pause: '0' }; controlThrows = false; pauseSequence = []; pauseReads = 0; queueThrows = false;
  env(over);
}
globalThis.fetch = async () => { calls.push('fetch'); return new Response('{}', { status: 503 }); };
let logs = [];
console.warn = () => {};
console.error = (...a) => { logs.push(a.map(String).join(' ')); };
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[money-pause-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[money-pause-test] ', '') : x));
  else logs.push(a.map(String).join(' '));
})(console.log);
const say = (...a) => console.log('[money-pause-test]', ...a);

// ── Bundle ──

const ROUTES = ['generate', 'token-balance', 'account/daily-reward', 'account/email-list', 'stripe/webhook'];
const entryPoints = {
  moneyPause: path.join(ROOT, 'src/lib/moneyPause.ts'),
  tokenBalance: path.join(ROOT, 'src/lib/tokenBalance.ts'),
};
for (const r of ROUTES) entryPoints[r.replace(/\//g, '_')] = path.join(ROOT, 'src/app/api', r, 'route.ts');
await build({
  entryPoints, bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const load = async (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const mp = await load('moneyPause');
const tb = await load('tokenBalance');
const R = {};
for (const r of ROUTES) R[r] = await load(r.replace(/\//g, '_'));

// ── Helpers ──

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const USER = 'user_MONEYPAUSETESTMONEYPAUSE1';
const NEWUSER = 'user_MONEYPAUSENEWUSERNOBAL2';
const tok = await tokenFor(USER);
const tokNew = await tokenFor(NEWUSER);
const seedBalance = (u, n) => kvMap.set(`token_balance:${u}`, JSON.stringify({ balance: n, created_at: 'x', last_updated: 'x' }));
const balanceOf = (u) => { const r = kvMap.get(`token_balance:${u}`); return r ? JSON.parse(r).balance : null; };
const puts = () => calls.filter((c) => c.startsWith('kv.put'));
const moneyPuts = () => calls.filter((c) => /^kv\.put (token_balance|token_tx|token_idempotency|bonus_|daily_|streak)/.test(c));
const genReq = (t, over = {}) => new Request('https://dev.spritebrew.pages.dev/api/generate', {
  method: 'POST', headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'a knight', style: 'rd_fast__default', width: 64, height: 64, idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`, ...over }),
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
const checkoutEvent = (id, tokens = 100) => ({
  id, object: 'event', type: 'checkout.session.completed', api_version: '2026-03-25.dahlia', created: 1,
  data: { object: { id: `cs_${id}`, object: 'checkout.session', payment_intent: null, amount_total: 499,
    metadata: { userId: USER, packId: 'starter', tokens: String(tokens) } } },
});
const json = async (res) => { try { return await res.clone().json(); } catch { return null; } };
const alarmJson = (row) => (row ? JSON.parse(row.args.find((a) => typeof a === 'string' && a.startsWith('{'))) : null);
const hasEmDash = (s) => typeof s === 'string' && s.includes('\u2014');

// ── 1. isMoneyPaused fails closed ──

for (const [label, setup, expect] of [
  ["value '0' -> open", () => {}, false],
  ["value '1' -> paused", () => { control.money_pause = '1'; }, 'quiet'],
  ['unexpected value -> paused', () => { control.money_pause = 'no'; }, true],
  ['row missing -> paused', () => { delete control.money_pause; }, true],
  ['read throws -> paused', () => { controlThrows = true; }, true],
  ['binding missing -> paused', () => { env({ ledger: false }); }, true],
]) {
  reset(); setup(); logs = [];
  const got = await mp.isMoneyPaused();
  check(`isMoneyPaused: ${label}`, got === (expect === 'quiet' ? true : expect));
  // Every paused answer but an explicit '1' is a fault and is logged.
  check(`isMoneyPaused: ${label} ${expect === true ? 'logs' : 'does not log'} pause_read_failed`,
    logs.some((l) => l.includes('pause_read_failed')) === (expect === true));
}
reset(); process.env.LEDGER_DB = { prepare: () => ({ first: () => new Promise(() => {}) }) }; logs = [];
const t0 = Date.now();
const hung = await mp.isMoneyPaused();
check('isMoneyPaused: read that never answers -> paused after the 2 s timeout',
  hung === true && Date.now() - t0 < 3000 && logs.some((l) => l.includes('pause read timed out')));
reset(); logs = [];
await mp.isMoneyPaused();
check('isMoneyPaused: dev logs pause_read with ms (T11d)', logs.some((l) => /"event":"pause_read","ms":\d+/.test(l)));

// ── 2. creditTokens: no KV answers success false (ruling F) ──

reset({ kv: false });
const noKv = await tb.creditTokens(USER, 10, 'test', 'idem-nokv');
check('creditTokens without KV -> success false', noKv.success === false);

// ── 3. Generate ──

reset(); control.money_pause = '1'; seedBalance(USER, 100);
let res = await R.generate.POST(genReq(tok));
let body = await json(res);
check('generate paused -> 503 money_paused', res.status === 503 && body?.error === 'money_paused');
check('generate paused -> the pause copy, no em dash', body?.message === mp.PAUSED_MESSAGE && !hasEmDash(body?.message));
check('generate paused -> no KV write, no enqueue, no fetch', puts().length === 0 && !calls.includes('queue.send') && !calls.includes('fetch'));
check('generate paused -> balance unchanged', balanceOf(USER) === 100);

reset(); controlThrows = true; seedBalance(USER, 100);
res = await R.generate.POST(genReq(tok));
check('generate, pause read failing (T11c) -> 503, nothing written', res.status === 503 && puts().length === 0 && !calls.includes('queue.send'));

reset(); control.money_pause = '1'; seedBalance(USER, 100);
res = await R.generate.POST(genReq(tok, { idempotencyKey: 'x' }));
check('generate paused with a bad idempotencyKey -> 400 first (pre-debit guards unchanged)', res.status === 400);

reset({ kickoff: 'false' }); seedBalance(USER, 100);
res = await R.generate.POST(genReq(tok));
body = await json(res);
check('generate SSE path -> 503 path_retired before any debit', res.status === 503 && body?.error === 'path_retired' && puts().length === 0 && balanceOf(USER) === 100);

// A first-ever balance meeting a pause that began after the gate.
reset(); pauseSequence = ['0'];
control.money_pause = '1';
res = await R.generate.POST(genReq(tokNew));
body = await json(res);
check('generate, pause begins between gate and opening -> 503 money_paused, nothing written',
  res.status === 503 && body?.error === 'money_paused' && moneyPuts().length === 0 && balanceOf(NEWUSER) === null);

reset(); seedBalance(USER, 100);
res = await R.generate.POST(genReq(tok));
const cost = 100 - balanceOf(USER);
check('generate open -> 202, one enqueue, one debit of a positive cost',
  res.status === 202 && calls.filter((c) => c === 'queue.send').length === 1 && cost > 0 && moneyPuts().filter((c) => c.startsWith('kv.put token_balance')).length === 1);

// Ruling G: enqueue fails, refund succeeds.
reset(); seedBalance(USER, 100); control.dev_fault = 'enqueue_throw';
res = await R.generate.POST(genReq(tok));
body = await json(res);
let rec = [...kvMap.entries()].find(([k]) => k.startsWith('job:'));
let recState = rec ? JSON.parse(rec[1]) : null;
check('G: enqueue fails, refund lands -> 503 submission_failed', res.status === 503 && body?.error === 'submission_failed');
check('G: refund lands -> balance restored', balanceOf(USER) === 100);
check('G: refund lands -> record refunded true', recState?.status === 'error' && recState?.refunded === true);
check('G: refund lands -> copy says refunded, no em dash', /refunded/.test(body?.message) && !hasEmDash(body?.message));
check('G: refund lands -> no alarm row', eventsRows.length === 0);

// Ruling G: enqueue fails and the refund credit fails.
reset(); seedBalance(USER, 100); control.dev_fault = 'enqueue_throw,credit_throw_before_balance';
res = await R.generate.POST(genReq(tok));
body = await json(res);
rec = [...kvMap.entries()].find(([k]) => k.startsWith('job:'));
recState = rec ? JSON.parse(rec[1]) : null;
const alarmRow = eventsRows.find((r) => r.sql.includes('generation.unrefunded'));
check('G: refund fails -> 503 submission_failed', res.status === 503 && body?.error === 'submission_failed');
check('G: refund fails -> balance stays debited', balanceOf(USER) === 100 - cost);
check('G: refund fails -> record refunded false', recState?.status === 'error' && recState?.refunded === false);
check('G: refund fails -> copy claims no refund, says it will be returned, no em dash',
  body?.message === 'Could not start your generation. We could not confirm your refund yet; your tokens will be returned. Please try again later.'
  && !hasEmDash(body?.message));
check('G: refund fails -> one generation.unrefunded row, reason refund_credit_failed',
  alarmRow && alarmRow.args.includes('refund_credit_failed') && alarmJson(alarmRow).extra.reason === 'refund_credit_failed'
  && eventsRows.filter((r) => r.sql.includes('generation.unrefunded')).length === 1);
check('G: alarm row carries the job id and token cost',
  alarmRow && rec && alarmRow.args[6] === rec[0].slice('job:'.length) && alarmJson(alarmRow).extra.tokenCost === cost);

// n1-ledger-02.md 002 rulings B and C on the same failure.
const owed = recState?.refundOwed;
check('B.1 refund fails -> record carries refundOwed with the evidence fields',
  owed && Object.keys(owed).sort().join() === 'balanceWritten,idempotencyKey,reason,requestId,tokenCost'
  && owed.tokenCost === cost && owed.reason === 'refund_credit_failed' && owed.requestId.startsWith(`gen:${USER}:`)
  && owed.idempotencyKey === `refund:${owed.requestId}` && owed.balanceWritten === false);
check('B.1 refund fails -> record kept 24 h in KV and mirrored to R2',
  kvTtl.get(rec?.[0]) === 86400 && calls.includes(`r2.put jobs/${rec?.[0].slice('job:'.length)}.json`));
check('C.1 the alarm row carries the refund key, the request id and balanceWritten',
  alarmJson(alarmRow)?.extra?.idempotencyKey === owed?.idempotencyKey && alarmRow?.args[7] === owed?.requestId
  && alarmJson(alarmRow)?.extra?.balanceWritten === false);

// B.4: the alarm cannot be written; the record still carries the debt and one error line names it.
for (const [label, over, setup] of [
  ['EVENTS_DB absent', { events: false }, () => {}],
  ['the alarm insert throws', {}, () => { eventsThrow = true; }],
]) {
  reset(over); seedBalance(USER, 100); control.dev_fault = 'enqueue_throw,credit_throw_before_balance'; setup(); logs = [];
  res = await R.generate.POST(genReq(tok));
  body = await json(res);
  const r = [...kvMap.entries()].find(([k]) => k.startsWith('job:'));
  const st = r ? JSON.parse(r[1]) : null;
  const line = logs.find((l) => l.includes('unrefunded_alarm_not_written'));
  check(`B.4 ${label} -> 503 with the unconfirmed-refund copy`, res.status === 503 && /could not confirm your refund yet/.test(body?.message));
  check(`B.4 ${label} -> no alarm row`, !eventsRows.some((x) => x.sql.includes('generation.unrefunded')));
  check(`B.4 ${label} -> the record still carries refundOwed (24 h)`, st?.refunded === false && st?.refundOwed?.tokenCost === cost && kvTtl.get(r?.[0]) === 86400);
  check(`B.4 ${label} -> one error line with job, user, cost and request id, no email`,
    !!line && line.includes(r?.[0].slice('job:'.length)) && line.includes(USER) && line.includes(`"tokenCost":${cost}`)
    && line.includes(st?.refundOwed?.requestId) && !line.includes('@'));
}

// C.4: the refund's balance write lands, then the credit fails before its idempotency key.
reset(); seedBalance(USER, 100); control.dev_fault = 'enqueue_throw,credit_throw_after_balance';
res = await R.generate.POST(genReq(tok));
body = await json(res);
rec = [...kvMap.entries()].find(([k]) => k.startsWith('job:'));
recState = rec ? JSON.parse(rec[1]) : null;
const cRows = eventsRows.filter((x) => x.sql.includes('generation.unrefunded'));
check('C.4 after-balance fault -> the balance is restored', balanceOf(USER) === 100);
check('C.4 -> the customer is told the tokens were refunded (they were), no em dash',
  body?.message === 'Could not start your generation. Your tokens were refunded. Please try again.' && !hasEmDash(body?.message));
check('C.4 -> record refunded false with refundOwed.balanceWritten true', recState?.refunded === false && recState?.refundOwed?.balanceWritten === true);
check('C.4 -> one alarm row, saying balanceWritten true', cRows.length === 1 && alarmJson(cRows[0]).extra.balanceWritten === true);
check('C.4 -> no refund key and no tx row for the refund (why the evidence must travel with the record)',
  !kvMap.has(`token_idempotency:${recState?.refundOwed?.idempotencyKey}`)
  && ![...kvMap.entries()].some(([k, v]) => k.startsWith(`token_tx:${USER}:`) && JSON.parse(v).reason === 'generation_failed_refund'));

// ── 4. token-balance ──

reset(); control.money_pause = '1'; seedBalance(USER, 42);
res = await R['token-balance'].GET(authReq('/api/token-balance', tok));
body = await json(res);
check('token-balance paused, existing balance -> 200 with the balance', res.status === 200 && body?.balance === 42);
reset(); control.money_pause = '1';
res = await R['token-balance'].GET(authReq('/api/token-balance', tokNew));
check('token-balance paused, no balance (an opening) -> 503, nothing written', res.status === 503 && puts().length === 0);
reset(); controlThrows = true;
res = await R['token-balance'].GET(authReq('/api/token-balance', tokNew));
check('token-balance, pause read failing, no balance -> 503', res.status === 503 && puts().length === 0);
reset();
res = await R['token-balance'].GET(authReq('/api/token-balance', tokNew));
body = await json(res);
check('token-balance open, no balance -> opened (200, signup bonus written)', res.status === 200 && body?.balance > 0 && balanceOf(NEWUSER) === body.balance);

// ── 5. daily-reward ──

reset(); control.money_pause = '1'; seedBalance(USER, 42);
kvMap.set(`signup_grant:${USER}`, JSON.stringify({ amount: 50, source: 'signup', granted_at: 'x' }));
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
body = await json(res);
check('daily-reward paused -> 200 rewards [] paused true', res.status === 200 && Array.isArray(body?.rewards) && body.rewards.length === 0 && body.paused === true);
check('daily-reward paused -> no KV write at all', puts().length === 0 && balanceOf(USER) === 42);
reset(); control.money_pause = '1';
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tokNew, 'POST'));
check('daily-reward paused, new user -> 503, no signup modal marked', res.status === 503 && puts().length === 0);
reset(); seedBalance(USER, 42);
res = await R['account/daily-reward'].POST(authReq('/api/account/daily-reward', tok, 'POST'));
body = await json(res);
check('daily-reward open -> a daily reward credited', res.status === 200 && body?.rewards?.some((r) => r.type === 'daily_login' || r.type === 'streak_bonus') && balanceOf(USER) > 42 && !body.paused);

// ── 6. email-list ──

reset(); control.money_pause = '1'; seedBalance(USER, 42);
res = await R['account/email-list'].POST(authReq('/api/account/email-list', tok, 'POST'));
body = await json(res);
check('email-list paused -> 503 before Resend (no fetch), nothing written', res.status === 503 && !calls.includes('fetch') && puts().length === 0);
check('email-list paused -> the updating copy', body?.error === mp.UPDATING_MESSAGE);
reset(); control.money_pause = '1'; seedBalance(USER, 42); kvMap.set(`bonus_email_list:${USER}`, '1');
res = await R['account/email-list'].POST(authReq('/api/account/email-list', tok, 'POST'));
body = await json(res);
check('email-list paused, already claimed -> 200 alreadyClaimed (no money)', res.status === 200 && body?.alreadyClaimed === true && puts().length === 0);

// ── 7. Stripe webhook ──

reset(); control.money_pause = '1'; seedBalance(USER, 10);
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_paused')));
check('webhook paused -> 503', res.status === 503);
check('webhook paused -> no dedupe read, no write, not marked', !calls.some((c) => c.includes('webhook:stripe:')) && puts().length === 0 && balanceOf(USER) === 10);

reset(); controlThrows = true; seedBalance(USER, 10);
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_readfail')));
check('webhook, pause read failing (T11c) -> 503, unmarked', res.status === 503 && puts().length === 0);

reset(); seedBalance(USER, 10);
res = await R['stripe/webhook'].POST(new Request('https://dev.spritebrew.pages.dev/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=00' }, body: '{}' }));
check('webhook bad signature -> 400 before the pause read', res.status === 400 && pauseReads === 0);

reset(); seedBalance(USER, 10);
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_ok')));
check('webhook open -> 200, credited once, marked', res.status === 200 && balanceOf(USER) === 110 && kvMap.has('webhook:stripe:evt_ok'));
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_ok')));
check('webhook replay -> deduplicated, balance unchanged', res.status === 200 && balanceOf(USER) === 110);

// No KV: creditTokens answers success false, so 500 unmarked (ruling F).
reset({ kv: false });
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_nokv')));
check('webhook without KV -> 500', res.status === 500);

// T10c offline: a fault before the balance put, then the retry.
reset(); seedBalance(USER, 10); control.dev_fault = 'credit_throw_before_balance';
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_before')));
check('T10c before-put fault -> 500, unmarked, nothing credited', res.status === 500 && !kvMap.has('webhook:stripe:evt_before') && balanceOf(USER) === 10);
delete control.dev_fault;
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_before')));
check('T10c before-put fault, retry -> 200, credited once', res.status === 200 && balanceOf(USER) === 110 && kvMap.has('webhook:stripe:evt_before'));

// T10c offline: a fault after the balance put, then the retry: the documented double credit.
reset(); seedBalance(USER, 10); control.dev_fault = 'credit_throw_after_balance';
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_after')));
check('T10c after-put fault -> 500, unmarked, balance already up', res.status === 500 && !kvMap.has('webhook:stripe:evt_after') && balanceOf(USER) === 110);
delete control.dev_fault;
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_after')));
check('T10c after-put fault, retry -> 200, credited twice (the ruling F window)', res.status === 200 && balanceOf(USER) === 210);

// A KV failure on the balance write (not a dev fault) takes the same path.
reset(); seedBalance(USER, 10); kvFailPut = (k) => k.startsWith('token_balance:');
res = await R['stripe/webhook'].POST(stripeReq(checkoutEvent('evt_kvfail')));
check('webhook, credit write fails -> 500, unmarked', res.status === 500 && !kvMap.has('webhook:stripe:evt_kvfail'));

// Production never reads dev_fault.
reset(); seedBalance(USER, 10); control.dev_fault = 'credit_throw_before_balance'; process.env.APP_ENV = 'production';
const prodCredit = await tb.creditTokens(USER, 5, 'test', 'idem-prod-fault');
check('dev_fault ignored when APP_ENV is production', prodCredit.success === true && balanceOf(USER) === 15);

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
