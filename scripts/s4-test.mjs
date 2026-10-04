// scripts/s4-test.mjs
//
// S4's offline harness: Pages on the D1 ledger (n1-release-2-spec.md revision
// 9: section 11's S4 row; 5.1, 4.13, 4.14, 6.2; 10.1's T4, T5, T6, T7, T10,
// T10b, T11, T11c and T35's debit dimensions; R9-8's purchase banner). Run
// from the repo root: `node scripts/s4-test.mjs`.
//
// The money routes and their libraries are bundled with esbuild into
// local/.s4-test (gitignored) and called as the runtime would. LEDGER_DB is
// node:sqlite in memory, built from the consumer repo's migrations-ledger
// 0001 to 0003, so the library's SQL (the spec's, as written) runs against
// the real schema; EVENTS_DB likewise from migrations/0001 and 0002. KV, R2,
// the queue, Stripe's API, Clerk and Resend are in-memory stubs, and session
// tokens and the webhook secret are made in memory for this run only. The
// consumer checkout must hold 0003 (its n1-s1 branch or later).
//
// It also carries the paused-answer rows of release 1's Pages harnesses
// (money-pause-test.mjs and s0-test.mjs, retired with their code in S4),
// ported to release 2 as T11 and T11c.
//
// S4_MUTATION='{"file":"src/lib/money.ts","from":"...","to":"..."}' mutates
// one source file at bundle time (exit 1 caught, 0 survived, 3 not found
// once). Output: counts and case names only.

import { build } from 'esbuild';
import { createHmac, webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');
const subtle = webcrypto.subtle;
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_secret';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.s4-test');
const CONSUMER = process.env.S4_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MUT = process.env.S4_MUTATION ? JSON.parse(process.env.S4_MUTATION) : null;
const WHSEC = 'whsec_placeholder_not_a_secret';
const LEDGER_MIG = ['0001_control.sql', '0002_stripe_refusals.sql', '0003_ledger.sql'].map((f) => path.join(CONSUMER, 'migrations-ledger', f));
const EVENTS_MIG = ['0001_events.sql', '0002_digest_runs_attempts.sql'].map((f) => path.join(CONSUMER, 'migrations', f));
for (const f of [...LEDGER_MIG, ...EVENTS_MIG]) {
  if (!existsSync(f)) { console.log(`[s4-test] missing ${f}`); process.exit(1); }
}

const counts = new Map();
let failed = 0;
function check(tag, name, ok) {
  const c = counts.get(tag) ?? { pass: 0, fail: 0 };
  if (ok) c.pass++; else { c.fail++; failed++; say(`FAIL ${tag}: ${name}`); }
  counts.set(tag, c);
}

// ── Logs: captured, never printed ──

const realLog = console.log;
const say = (...a) => realLog('[s4-test]', ...a);
let logs = [];
for (const lvl of ['log', 'info', 'warn', 'error']) console[lvl] = (...a) => { logs.push(a.map(String).join(' ')); };
const lines = (source) => logs.filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((l) => !source || l.source === source);

// ── Session token (in memory only) ──

const pair = await subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64');
const PEM = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const enc = (obj) => b64u(Buffer.from(JSON.stringify(obj)));
async function tokenFor(sub, prod = false) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'test_kid' })}.${enc({
    iss: prod ? 'https://clerk.spritebrew.com' : 'https://needed-blowfish-74.clerk.accounts.dev', sub, sid: 'sess_test',
    azp: prod ? 'https://spritebrew.com' : 'https://dev.spritebrew.pages.dev', iat: now - 10, nbf: now - 10, exp: now + 3000,
  })}`;
  return `${input}.${b64u(await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, Buffer.from(input)))}`;
}

// ── SQLite as D1 ──
// hooks.before(sqls) runs before any statement or batch and may throw (the
// call fails, nothing runs); hooks.after(sqls) runs after a batch commits and
// may throw (a lost response).

const toBind = (x) => (typeof x === 'number' && Number.isInteger(x) ? BigInt(x) : typeof x === 'boolean' ? (x ? 1n : 0n) : x ?? null);
const isRead = (sql) => /^\s*(?:--[^\n]*\n\s*)*(SELECT|WITH)\b/i.test(sql);
const tick = () => new Promise((r) => setImmediate(r));
function sqlite(files) {
  const db = new DatabaseSync(':memory:');
  for (const f of files) db.exec(readFileSync(f, 'utf8'));
  return db;
}
function d1(db, hooks) {
  const exec = (s) => {
    const p = db.prepare(s.sql);
    const vals = s.values.map(toBind);
    if (isRead(s.sql)) return { results: p.all(...vals).map((r) => ({ ...r })), meta: { changes: 0 }, success: true };
    const r = p.run(...vals);
    return { results: [], meta: { changes: Number(r.changes) }, success: true };
  };
  return {
    prepare(sql) {
      const st = { sql, values: [] };
      st.bind = (...a) => { st.values = a; return st; };
      st.first = async (col) => { await tick(); if (hooks.hang?.(sql)) return new Promise(() => {}); hooks.before?.([sql]); const r = exec(st).results[0] ?? null; return col && r ? r[col] : r; };
      st.run = async () => { await tick(); hooks.before?.([sql]); return exec(st); };
      st.all = async () => { await tick(); hooks.before?.([sql]); return exec(st); };
      return st;
    },
    async batch(stmts) {
      await tick();
      const sqls = stmts.map((s) => s.sql);
      hooks.before?.(sqls);
      db.exec('BEGIN');
      let r;
      try { r = stmts.map(exec); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      hooks.after?.(sqls);
      return r;
    },
  };
}
const q = (db, sql, ...a) => db.prepare(sql).all(...a.map(toBind)).map((r) => ({ ...r }));
const one = (db, sql, ...a) => q(db, sql, ...a)[0];

// ── KV, R2, the queue ──

function kvStub() {
  const m = new Map();
  const kv = {
    m, failGet: null, failPut: null, failList: null, puts: [],
    async get(k) { await tick(); if (kv.failGet?.(k)) throw new Error('stub: KV get failed'); return m.has(k) ? m.get(k).value : null; },
    async put(k, v, opts = {}) { await tick(); if (kv.failPut?.(k)) throw new Error('stub: KV put failed'); kv.puts.push(k); m.set(k, { value: String(v), metadata: opts.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      await tick();
      if (kv.failList?.(prefix)) throw new Error('stub: KV list failed');
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit);
      return { keys: names.map((name) => ({ name, metadata: m.get(name).metadata })), list_complete: true };
    },
  };
  return kv;
}
function r2Stub() {
  const m = new Map();
  const r2 = {
    m, failPut: null, puts: [],
    async get(k) { const e = m.get(k); return e ? { text: async () => e } : null; },
    async head(k) { return m.has(k) ? {} : null; },
    async put(k, body) { if (r2.failPut?.(k)) throw new Error('stub: R2 put failed'); r2.puts.push(k); m.set(k, typeof body === 'string' ? body : ''); return {}; },
    async delete(k) { m.delete(k); },
  };
  return r2;
}

// ── Stripe's API, Clerk, Resend (fetch stubs) ──

let W = null;
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  W?.fetches.push(`${init.method ?? 'GET'} ${u.replace(/^https:\/\/[^/]+/, '')}`);
  if (u.startsWith('https://api.stripe.com/v1/payment_intents/')) {
    const id = u.split('/').pop().split('?')[0];
    if (W.stripe.failPi) return jsonRes({ error: { message: 'stub: failed' } }, 500);
    return jsonRes({ id, object: 'payment_intent', latest_charge: W.stripe.charges[id] ?? null });
  }
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions/')) {
    const id = u.split('/').pop().split('?')[0];
    const s = W.stripe.sessions[id];
    if (!s) return jsonRes({ error: { message: 'No such checkout session' } }, 404);
    return jsonRes({ id, object: 'checkout.session', ...s });
  }
  if (u.startsWith('https://api.stripe.com/v1/charges/')) return jsonRes({ id: u.split('/').pop(), object: 'charge', billing_details: {}, metadata: {} });
  if (u.startsWith('https://api.stripe.com/v1/radar/')) return jsonRes({ id: 'rsli_test', object: 'radar.value_list_item' });
  if (u.startsWith('https://api.clerk.com/v1/users/')) {
    return jsonRes({ primary_email_address_id: 'e1', email_addresses: [{ id: 'e1', email_address: 'ledgertest@example.invalid' }] });
  }
  if (u.startsWith('https://api.resend.com/')) { W.resendCalls++; return jsonRes({ id: 'contact_test', object: 'contact' }); }
  return new Response('{}', { status: 404 });
};

// ── The world ──

function world({ ledgerBound = true, kvBound = true } = {}) {
  const ledger = sqlite(LEDGER_MIG);
  const events = sqlite(EVENTS_MIG);
  const hooks = {};
  const kv = kvStub();
  const r2 = r2Stub();
  const w = {
    ledger, events, hooks, kv, r2, sends: [], sendHook: null, sendThrows: false, fetches: [], resendCalls: 0,
    stripe: { charges: {}, sessions: {}, failPi: false },
  };
  process.env = { ...process.env };
  for (const k of ['LEDGER_DB', 'SPRITEBREW_KV', 'EVENTS_DB', 'GALLERY_BUCKET', 'RD_QUEUE']) delete process.env[k];
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid',
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret', STRIPE_WEBHOOK_SECRET: WHSEC,
    QUEUE_KICKOFF_ENABLED: 'true', RESEND_API_KEY: 'placeholder', RESEND_AUDIENCE_ID: 'placeholder',
    CLERK_SECRET_KEY: 'placeholder', ADMIN_TOKEN: 'admin_placeholder_not_a_secret',
    GALLERY_BUCKET: r2,
    RD_QUEUE: { send: async (m) => { await tick(); await w.sendHook?.(m); w.sends.push(m); if (w.sendThrows) throw new Error('stub: send failed'); } },
    EVENTS_DB: d1(events, {}),
  });
  if (ledgerBound) process.env.LEDGER_DB = d1(ledger, hooks);
  if (kvBound) process.env.SPRITEBREW_KV = kv;
  logs = [];
  W = w;
  return w;
}
const setCtl = (w, key, value, at = Date.now()) => {
  if (value === undefined) { w.ledger.prepare('DELETE FROM control WHERE key = ?').run(key); return; }
  w.ledger.prepare("INSERT INTO control (key, value, updated_at_ms, updated_by) VALUES (?, ?, ?, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms").run(key, value, toBind(at));
};
const balanceOf = (w, uid) => one(w.ledger, 'SELECT balance FROM balances WHERE user_id = ?', uid)?.balance ?? null;
const rows = (w, sql, ...a) => q(w.ledger, sql, ...a);
const jobRow = (w, id) => one(w.ledger, 'SELECT * FROM jobs WHERE job_id = ?', id);
const ledgerBy = (w, idem) => rows(w, 'SELECT * FROM ledger WHERE idem_key = ?', idem);
const alarms = (w, kind) => q(w.events, "SELECT * FROM events WHERE event_name = 'ledger.alarm' AND error_code = ?", kind);
const pending = (w, ev) => one(w.ledger, 'SELECT * FROM stripe_pending WHERE event_id = ?', ev);
const held = (w, ev) => rows(w, 'SELECT * FROM stripe_held WHERE event_id = ? ORDER BY refused_ms', ev);
const marked = (w, ev) => w.kv.m.has(`webhook:stripe:${ev}`);
/** Seed a balance through the library's own opening (4.2). */
async function seed(w, uid, amount, { paid = true } = {}) {
  const r = await L.openBalance(ctxOf(w), { uid, amount, reason: 'test_seed', source: 'signup', via: 'signup' });
  if (r.outcome !== 'opened') throw new Error(`seed: ${r.outcome}`);
  if (paid) w.kv.m.set(`purchase:${uid}:has_paid`, { value: 'true' });
}
const ctxOf = (w) => ({ db: d1(w.ledger, {}), appEnv: 'dev' });
const legacy = (w, key, kind, keepMs = Date.now() + 40 * 86_400_000) =>
  w.ledger.prepare('INSERT INTO legacy_idem (key, kind, kv_expires_ms, copied_at_ms, keep_until_ms) VALUES (?, ?, NULL, ?, ?)').run(key, kind, toBind(Date.now()), toBind(keepMs));

// ── Bundles ──

const mutation = {
  name: 'mutation',
  setup(b) {
    if (!MUT) return;
    b.onLoad({ filter: /\.tsx?$/ }, (args) => {
      if (!args.path.endsWith(MUT.file)) return undefined;
      const src = readFileSync(args.path, 'utf8');
      const n = src.split(MUT.from).length - 1;
      if (n !== 1) { say(`mutation target found ${n} times`); process.exit(3); }
      return { contents: src.replace(MUT.from, MUT.to), loader: 'ts' };
    });
  },
};
const ROUTES = ['generate', 'token-balance', 'account/daily-reward', 'account/email-list', 'stripe/webhook', 'admin/events', 'admin/failure-rate'];
const slug = (r) => r.replace(/[/[\]]/g, '_');
const entryPoints = {
  ledger: path.join(ROOT, 'src/lib/ledger.ts'),
  dailyReward: path.join(ROOT, 'src/lib/dailyReward.ts'),
  purchaseBanner: path.join(ROOT, 'src/lib/purchaseBanner.ts'),
  jobIdHelper: path.join(ROOT, 'src/lib/jobIdHelper.ts'),
};
for (const r of ROUTES) entryPoints[slug(r)] = path.join(ROOT, 'src/app/api', r, 'route.ts');
await build({
  entryPoints, bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [mutation, { name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const v = `?v=${Date.now()}`;
const load = async (n) => import(pathToFileURL(path.join(OUT, `${n}.mjs`)).href + v);
const L = await load('ledger');
const DR = await load('dailyReward');
const PB = await load('purchaseBanner');
const IDS = await load('jobIdHelper');
const R = {};
for (const r of ROUTES) R[r] = await load(slug(r));

// ── Requests ──

const ORIGIN = 'https://dev.spritebrew.pages.dev';
const U1 = 'user_S4TESTS4TESTS4TESTS4TEST01';
const U2 = 'user_S4TESTS4TESTS4TESTS4TEST02';
const TOK = { [U1]: await tokenFor(U1), [U2]: await tokenFor(U2) };
const tok = async (u) => { if (!TOK[u]) TOK[u] = await tokenFor(u); return TOK[u]; };
const body = async (res) => { try { return await res.clone().json(); } catch { return null; } };
let keySeq = 0;
const newKey = () => `idem-s4-test-${String(++keySeq).padStart(6, '0')}`;
async function gen(u, over = {}) {
  const payload = { prompt: 'a knight', style: 'rd_fast__default', width: 64, height: 64, idempotencyKey: newKey(), ...over };
  const res = await R.generate.POST(new Request(`${ORIGIN}/api/generate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok(u)}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
  return { res, b: await body(res), key: payload.idempotencyKey, jobId: await IDS.deriveJobId(u, payload.idempotencyKey) };
}
const authed = async (u, url, method = 'GET') => new Request(`${ORIGIN}${url}`, {
  method, headers: { Authorization: `Bearer ${await tok(u)}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}',
});
const daily = async (u) => { const res = await R['account/daily-reward'].POST(await authed(u, '/api/account/daily-reward', 'POST')); return { res, b: await body(res) }; };
const emailList = async (u) => { const res = await R['account/email-list'].POST(await authed(u, '/api/account/email-list', 'POST')); return { res, b: await body(res) }; };
const balanceGet = async (u, qs = '') => { const res = await R['token-balance'].GET(await authed(u, `/api/token-balance${qs}`)); return { res, b: await body(res) }; };

function stripeReq(evt, { badSig = false } = {}) {
  const payload = JSON.stringify(evt);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', badSig ? 'whsec_wrong' : WHSEC).update(`${t}.${payload}`).digest('hex');
  return new Request(`${ORIGIN}/api/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}`, 'content-type': 'application/json' }, body: payload });
}
const hook = async (evt, opts) => { const res = await R['stripe/webhook'].POST(stripeReq(evt, opts)); return { status: res.status, b: await body(res) }; };
let evSeq = 0;
const evId = () => `evt_s4test${String(++evSeq).padStart(5, '0')}`;
const nowS = () => Math.floor(Date.now() / 1000);
function checkout({ id = evId(), user = U1, tokens = 100, pi = `pi_${id}`, created = nowS(), meta } = {}) {
  return { id, object: 'event', type: 'checkout.session.completed', api_version: '2026-03-25.dahlia', created,
    data: { object: { id: `cs_${id}`, object: 'checkout.session', payment_intent: pi, amount_total: 1000,
      metadata: meta ?? { userId: user, packId: 'starter', tokens: String(tokens) } } } };
}
function refund({ id = evId(), charge, pi = null, amount = 1000, refunded = 1000, created = nowS() } = {}) {
  return { id, object: 'event', type: 'charge.refunded', api_version: '2026-03-25.dahlia', created,
    data: { object: { id: charge, object: 'charge', amount, amount_refunded: refunded, payment_intent: pi, refunded: true, billing_details: {}, metadata: {} } } };
}
function dispute({ id = evId(), charge, pi = null, created = nowS() } = {}) {
  return { id, object: 'event', type: 'charge.dispute.created', api_version: '2026-03-25.dahlia', created,
    data: { object: { id: `dp_${id}`, object: 'dispute', charge, payment_intent: pi, amount: 1000, reason: 'fraudulent' } } };
}
/** Money open after a switch: the sentinel replaced by a past switch time. */
const postSwitch = (w, at = Date.now() - 86_400_000) => setCtl(w, 'switch_at_ms', String(at));

// ════════════════════════════════════════════════════════════════════════
// base: the normal path, and nothing of release 1 written
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  await seed(w, U1, 100);
  const g = await gen(U1, { width: 128, height: 64 });
  const j = jobRow(w, g.jobId);
  const d = ledgerBy(w, `debit:${g.jobId}`)[0];
  check('base', 'a create: 202 { jobId }, one debit of its cost, one send, the row enqueued',
    g.res.status === 202 && g.b?.jobId === g.jobId && d?.amount === 16 && balanceOf(w, U1) === 84 && w.sends.length === 1 && j?.state === 'enqueued' && j?.provenance === 'd1');
  check('base', 'the message carries the RD body, the job id, the user and the cost', w.sends[0]?.jobId === g.jobId && w.sends[0]?.userId === U1
    && w.sends[0]?.tokenCost === 16 && w.sends[0]?.body?.prompt === 'a knight');
  const pend = JSON.parse(w.kv.m.get(`job:${g.jobId}`)?.value ?? 'null');
  check('base', 'the pending record carries tokenCost and requestId', pend?.status === 'pending' && pend?.tokenCost === 16 && String(pend?.requestId).startsWith(`gen:${U1}:`));
  check('base', 'the row keeps the client key and the request hash', j?.client_key === g.key && /^[0-9a-f]{64}$/.test(j?.request_hash ?? ''));
  check('base', "release 2 writes no token_balance:, token_idempotency: or token_tx: key, and no admission record",
    ![...w.kv.m.keys()].some((k) => /^(token_balance|token_idempotency|token_tx):/.test(k)) && rows(w, 'SELECT 1 FROM money_admissions').length === 0);
  const line = lines('generate').find((l) => l.job_id === g.jobId);
  check('base', "generate's line names the request id, the job id and its outcome", line?.outcome === 'enqueued (202)' && String(line?.request_id).startsWith('gen:'));
}

// ════════════════════════════════════════════════════════════════════════
// T35: the debit records the requested width and height (4.3, R8-2)
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  await seed(w, U1, 500);
  const rect = await gen(U1, { width: 128, height: 64 });
  const anim = await gen(U1, { mode: 'animate', action: 'walking', inputImage: 'AAAA', width: 96, height: 96 });
  const bare = await gen(U1, { width: undefined, height: undefined });
  const dr = (g) => ledgerBy(w, `debit:${g.jobId}`)[0];
  check('T35', "a rectangular create: meta_json {width 128, height 64}, ledger.size the width", dr(rect)?.meta_json === '{"width":128,"height":64}' && dr(rect)?.size === 128 && dr(rect)?.style === 'rd_fast__default');
  check('T35', 'an animate: its square from width, both dimensions', anim.res.status === 202 && dr(anim)?.meta_json === '{"width":96,"height":96}' && dr(anim)?.size === 96 && dr(anim)?.mode === 'animate');
  check('T35', 'a create sent without width or height: no meta (size unknown), no size', bare.res.status === 202 && dr(bare)?.meta_json === null && dr(bare)?.size === null);
}

// ════════════════════════════════════════════════════════════════════════
// T4: replays and identity (A5)
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  await seed(w, U1, 100);
  const key = newKey();
  const a = await gen(U1, { idempotencyKey: key });
  const b = await gen(U1, { idempotencyKey: key });
  check('T4', 'one key twice: one debit, one send; the second 202 replayed', a.res.status === 202 && b.res.status === 202 && b.b?.replayed === true
    && rows(w, "SELECT 1 FROM ledger WHERE type = 'debit'").length === 1 && w.sends.length === 1 && balanceOf(w, U1) === 84);
  const c = await gen(U1, { idempotencyKey: key, prompt: 'a different knight' });
  check('T4', 'the same key with a changed prompt: 409 with HQ-7\'s approved copy, never charged or sent', c.res.status === 409 && c.b?.error === 'idempotency_conflict'
    && c.b?.message === 'This request was already used for a different generation. Please refresh and try again.' && balanceOf(w, U1) === 84 && w.sends.length === 1);
}
{
  // two different payloads with one key at once, one uncertain
  const w = world();
  await seed(w, U1, 100);
  setCtl(w, 'dev_fault', 'batch_response_lost:generation');
  const key = newKey();
  const [x, y] = await Promise.all([gen(U1, { idempotencyKey: key }), gen(U1, { idempotencyKey: key, prompt: 'another' })]);
  const st = [x.res.status, y.res.status].sort().join(',');
  check('T4', 'two payloads, one key, at once, one answer lost: one charged and sent (202), the other 409 and never sent', st === '202,409'
    && w.sends.length === 1 && rows(w, "SELECT 1 FROM ledger WHERE type = 'debit'").length === 1 && balanceOf(w, U1) === 84);
}
for (const [label, extra] of [
  ['an imported success (identity row)', { provenance: 'kv', state: 'finished', outcome: 'succeeded', finished_at_ms: Date.now(), artifact: 'published' }],
  ['an imported refunded_legacy row', { provenance: 'kv', state: 'finished', outcome: 'refunded_legacy', finished_at_ms: Date.now() }],
  ['an imported pending job', { provenance: 'kv', state: 'enqueued', token_cost: 16, enqueued_at_ms: Date.now() }],
  ['a held row', { provenance: 'kv', state: 'claimed', hold_reason: 'contradictory' }],
  ['a tombstone', { provenance: 'tombstone', state: 'finished', outcome: 'no_record', finished_at_ms: Date.now(), token_cost: 16 }],
]) {
  const w = world();
  await seed(w, U1, 100);
  const key = newKey();
  const jobId = await IDS.deriveJobId(U1, key);
  const r = { job_id: jobId, user_id: U1, mode: 'create', created_at_ms: Date.now() - 60_000, ...extra };
  const cols = Object.keys(r);
  w.ledger.prepare(`INSERT INTO jobs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((k) => toBind(r[k])));
  const g = await gen(U1, { idempotencyKey: key });
  check('T4', `a replay of ${label}: 202 replayed, answered from its row, never charged, never sent`, g.res.status === 202 && g.b?.replayed === true
    && balanceOf(w, U1) === 100 && ledgerBy(w, `debit:${jobId}`).length === 0 && w.sends.length === 0);
}
{
  const w = world();
  await seed(w, U1, 100);
  const key = newKey();
  const jobId = await IDS.deriveJobId(U1, key);
  w.ledger.prepare("INSERT INTO jobs (job_id, user_id, mode, provenance, state, hold_reason, created_at_ms) VALUES (?, ?, 'create', 'kv', 'claimed', 'contradictory', ?)").run(jobId, U2, toBind(Date.now()));
  const g = await gen(U1, { idempotencyKey: key });
  check('T4', "an imported row of another user under this job id: 409, never charged", g.res.status === 409 && balanceOf(w, U1) === 100);
}

// ════════════════════════════════════════════════════════════════════════
// T7: fail closed and uncertain (4.3; `L 004` ruling 3)
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  await seed(w, U1, 100);
  setCtl(w, 'dev_fault', 'batch_throw_before:generation');
  let g = await gen(U1);
  check('T7', "a D1 error before the batch: 503 'You were not charged.', nothing moved or sent", g.res.status === 503 && g.b?.message === 'You were not charged.'
    && balanceOf(w, U1) === 100 && w.sends.length === 0 && !jobRow(w, g.jobId));
  setCtl(w, 'dev_fault', 'batch_response_lost:generation');
  g = await gen(U1);
  check('T7', 'commit then the response lost: resolved by identity, charged once, sent once', g.res.status === 202 && balanceOf(w, U1) === 84 && w.sends.length === 1
    && jobRow(w, g.jobId)?.state === 'enqueued');
  setCtl(w, 'dev_fault', 'send_skip');
  g = await gen(U1);
  check('T7', 'Pages dies before the send (send_skip): charged, never sent, the row left debited for candidate (1)', g.res.status === 202 && w.sends.length === 1
    && jobRow(w, g.jobId)?.state === 'debited' && balanceOf(w, U1) === 68);
  setCtl(w, 'dev_fault', 'catch_refund_fail');
  w.sendThrows = true;
  g = await gen(U1);
  check('T7', 'the send fails and the compensating refund fails: 503 with the unconfirmed copy, the row the debt', g.res.status === 503
    && g.b?.message === 'We could not confirm what happened to this generation. Check your gallery and your balance in a few minutes.'
    && jobRow(w, g.jobId)?.finished_at_ms === null && balanceOf(w, U1) === 52);
  w.sendThrows = false;
}
{
  // T7's two identity cases, planted with the request's own hash
  for (const sameHash of [true, false]) {
    const w = world();
    await seed(w, U1, 100);
    const key = newKey();
    const jobId = await IDS.deriveJobId(U1, key);
    // learn the request's hash from a dry world first
    const dry = world();
    await seed(dry, U1, 100);
    await gen(U1, { idempotencyKey: key });
    const realHash = jobRow(dry, jobId)?.request_hash;
    W = w;
    process.env.LEDGER_DB = d1(w.ledger, w.hooks);
    process.env.SPRITEBREW_KV = w.kv;
    process.env.GALLERY_BUCKET = w.r2;
    process.env.EVENTS_DB = d1(w.events, {});
    process.env.RD_QUEUE = { send: async (m) => { w.sends.push(m); } };
    setCtl(w, 'dev_fault', 'batch_throw_before:generation');
    let reads = 0;
    w.hooks.before = (sqls) => {
      if (sqls.some((s) => s.startsWith('SELECT j.user_id, j.request_hash'))) reads++;
      // after the pre-debit identity read, at the dev-fault read that precedes the debit batch
      if (reads === 1 && sqls.some((s) => s.includes("key = 'dev_fault'"))) {
        reads++;
        w.ledger.prepare("INSERT INTO ledger (id, user_id, type, amount, reason, source, job_id, mode, balance_after, idem_key, created_at_ms) VALUES ('other_exec', ?, 'debit', 16, 'generation', 'generation', ?, 'create', 84, 'debit:' || ?, ?)").run(U1, jobId, jobId, toBind(Date.now()));
        w.ledger.prepare('UPDATE balances SET balance = balance - 16 WHERE user_id = ?').run(U1);
        w.ledger.prepare("INSERT INTO jobs (job_id, user_id, mode, token_cost, client_key, request_hash, provenance, state, created_at_ms) VALUES (?, ?, 'create', 16, ?, ?, 'd1', 'debited', ?)").run(jobId, U1, key, sameHash ? realHash : 'f'.repeat(64), toBind(Date.now()));
      }
    };
    const g = await gen(U1, { idempotencyKey: key });
    if (sameHash) {
      check('T7', "an uncertain debit whose identity read finds another execution's row, same hash: 202 replayed, never sent here, one debit",
        g.res.status === 202 && g.b?.replayed === true && w.sends.length === 0 && balanceOf(w, U1) === 84);
    } else {
      check('T7', "the same with a different hash: 409, never sent, one debit (the other's)", g.res.status === 409 && w.sends.length === 0 && balanceOf(w, U1) === 84);
    }
  }
}
{
  // an uncertain batch that committed, then a failed identity read
  const w = world();
  await seed(w, U1, 100);
  setCtl(w, 'dev_fault', 'batch_response_lost:generation');
  let debitRan = false;
  w.hooks.before = (sqls) => {
    if (sqls.some((s) => s.startsWith('INSERT INTO ledger') && s.includes("'debit:' ||"))) debitRan = true;
    else if (debitRan && sqls.some((s) => s.startsWith('SELECT j.user_id, j.request_hash'))) throw new Error('stub: identity read failed');
  };
  const key = newKey();
  let g = await gen(U1, { idempotencyKey: key });
  check('T7', "an uncertain batch that committed, then a failed identity read: 503 saying a charge, if it happened, is returned; nothing sent",
    g.res.status === 503 && g.b?.error === 'charge_unconfirmed' && /If you were, your tokens will be returned automatically/.test(g.b?.message ?? '')
    && w.sends.length === 0 && jobRow(w, g.jobId)?.state === 'debited');
  w.hooks.before = undefined;
  setCtl(w, 'dev_fault', '');
  g = await gen(U1, { idempotencyKey: key });
  check('T7', 'a retry of that request: answered from the row (202 replayed), never charged again or sent', g.res.status === 202 && g.b?.replayed === true
    && w.sends.length === 0 && balanceOf(w, U1) === 84);
}

{
  // T6 through generate: a first generation opens the balance by policy, then charges
  const w = world();
  const EA = 'user_S4TESTS4TESTGENOPENS00001';
  w.kv.m.set(`gen_count:${EA}:2026-01-01`, { value: '1' });
  w.kv.m.set(`purchase:${EA}:has_paid`, { value: 'true' });
  const g = await gen(EA);
  check('T6', "a first generation with no balance row: opened by policy (early_adopter, 200), then charged once (184)", g.res.status === 202
    && balanceOf(w, EA) === 184 && one(w.ledger, 'SELECT opened_via FROM balances WHERE user_id = ?', EA)?.opened_via === 'early_adopter' && w.sends.length === 1);
  // T7: the identity read before the debit fails
  await seed(w, U1, 100);
  w.hooks.before = (sqls) => { if (sqls.some((s) => s.startsWith('SELECT j.user_id, j.request_hash'))) throw new Error('stub: read failed'); };
  const f = await gen(U1);
  w.hooks.before = undefined;
  check('T7', "the identity read before the debit fails: 503 'You were not charged.', no debit, nothing sent", f.res.status === 503
    && f.b?.message === 'You were not charged.' && balanceOf(w, U1) === 100 && !jobRow(w, f.jobId));
}

// ════════════════════════════════════════════════════════════════════════
// 5.1: the enqueue catch's r5 branch
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  await seed(w, U1, 100);
  w.sendThrows = true;
  let g = await gen(U1);
  const st = JSON.parse(w.r2.m.get(`jobs/${g.jobId}.json`) ?? 'null');
  const j = jobRow(w, g.jobId);
  check('5.1', "the send fails: refunded now (one 'refund:' row), 503 with HQ-2's refunded copy", g.res.status === 503
    && g.b?.message === 'Could not start your generation. Your tokens were refunded. Please try again.' && ledgerBy(w, `refund:${g.jobId}`).length === 1 && balanceOf(w, U1) === 100);
  check('5.1', "its row finished refunded 'submission_failed', the strict error record (R2 and KV) refunded true, then the marker", j?.outcome === 'refunded'
    && j?.error_code === 'submission_failed' && st?.status === 'error' && st?.refunded === true && st?.refundedAmount === 16
    && JSON.parse(w.kv.m.get(`job:${g.jobId}`)?.value ?? '{}').refunded === true && j?.status_written_at_ms !== null);
  check('5.1', 'no refundOwed, no generation.unrefunded row, no release 1 shape', !JSON.stringify(st).includes('refundOwed')
    && q(w.events, "SELECT 1 FROM events WHERE event_name = 'generation.unrefunded'").length === 0);
  w.r2.failPut = (k) => k.startsWith('jobs/') && w.failStatus;
  w.failStatus = true;
  g = await gen(U1);
  check('5.1', 'the refund lands and its status write fails: 503 refunded, the marker NULL for the repair pass', g.res.status === 503
    && jobRow(w, g.jobId)?.outcome === 'refunded' && jobRow(w, g.jobId)?.status_written_at_ms === null);
  w.failStatus = false;
  w.sendThrows = false;
  // claimed by a consumer: the send delivered, the consumer claimed, then the send threw
  setCtl(w, 'dev_fault', 'send_throw_after');
  w.sendHook = async (m) => { await L.claimJob(ctxOf(w), 'submit', { job: m.jobId, claim: 'consumer', attempt: 1 }); };
  g = await gen(U1);
  check('5.1', 'the send delivers, a consumer claims, then the send throws: 202 { jobId, uncertain }, no refund, no error record', g.res.status === 202
    && g.b?.uncertain === true && ledgerBy(w, `refund:${g.jobId}`).length === 0 && JSON.parse(w.r2.m.get(`jobs/${g.jobId}.json`) ?? '{}').status === 'pending');
  // finished first: the consumer already succeeded
  w.sendHook = async (m) => {
    w.ledger.prepare("UPDATE jobs SET state = 'finished', outcome = 'succeeded', finished_at_ms = ? WHERE job_id = ?").run(toBind(Date.now()), m.jobId);
  };
  g = await gen(U1);
  check('5.1', 'finished (succeeded) before the catch: 202 { jobId } from its outcome, no refund', g.res.status === 202 && g.b?.jobId === g.jobId && !g.b?.uncertain
    && ledgerBy(w, `refund:${g.jobId}`).length === 0);
  w.sendHook = null;
  setCtl(w, 'dev_fault', '');
  // fenced by the migrator's phase
  w.sendThrows = true;
  setCtl(w, 'migration_open', '1');
  g = await gen(U1);
  check('5.1', "the 'pages' fence while the migrator's phase is open: 503 unconfirmed, the row a debited debt", g.res.status === 503
    && g.b?.message?.startsWith('We could not confirm') && jobRow(w, g.jobId)?.finished_at_ms === null && ledgerBy(w, `refund:${g.jobId}`).length === 0);
  setCtl(w, 'migration_open', '0');
  w.sendThrows = false;
}

// ════════════════════════════════════════════════════════════════════════
// T6: openings (4.2)
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  const NEW = 'user_S4TESTS4TESTNEWUSER00001';
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => balanceGet(NEW)));
  check('T6', 'five parallel first touches: one opening (signup, 5), every answer 5', all.every((x) => x.res.status === 200 && x.b?.balance === 5)
    && rows(w, "SELECT 1 FROM ledger WHERE type = 'opening' AND user_id = ?", NEW).length === 1 && one(w.ledger, 'SELECT opened_via FROM balances WHERE user_id = ?', NEW)?.opened_via === 'signup');
  check('T6', "the celebration's grant record written once, on 'opened'", JSON.parse(w.kv.m.get(`signup_grant:${NEW}`)?.value ?? 'null')?.amount === 5);
  const IMP = 'user_S4TESTS4TESTIMPORTED00001';
  w.ledger.prepare("INSERT INTO balances VALUES (?, -10, 1, 1, 'snapshot', NULL)").run(IMP);
  const imp = await balanceGet(IMP);
  check('T6', 'an imported -10 balance reads -10, never reopened', imp.b?.balance === -10 && rows(w, 'SELECT 1 FROM ledger WHERE user_id = ?', IMP).length === 0);
  const LEG = 'user_S4TESTS4TESTLEGACYSIGNUP1';
  legacy(w, `token_idempotency:signup:${LEG}`, 'signup');
  const leg = await balanceGet(LEG);
  check('T6', 'signup evidence without a balance: opened at 0 (zero_alarm), with its alarm', leg.b?.balance === 0
    && one(w.ledger, 'SELECT opened_via FROM balances WHERE user_id = ?', LEG)?.opened_via === 'zero_alarm' && alarms(w, 'zero_alarm').length === 1
    && !w.kv.m.has(`signup_grant:${LEG}`));
  const OLD = 'user_S4TESTS4TESTLEGACYEXPIRED';
  legacy(w, `token_idempotency:signup:${OLD}`, 'signup', Date.now() - 1);
  const old = await balanceGet(OLD);
  check('T6', 'a legacy signup key past its keep time is not evidence: an ordinary signup opening', old.b?.balance === 5
    && one(w.ledger, 'SELECT opened_via FROM balances WHERE user_id = ?', OLD)?.opened_via === 'signup');
  const DIS = 'user_S4TESTS4TESTDISPOSABLE001';
  w.kv.m.set(`disposable_blocked:${DIS}`, { value: 'true' });
  const EA = 'user_S4TESTS4TESTEARLYADOPTER1';
  w.kv.m.set(`gen_count:${EA}:2026-01-01`, { value: '3' });
  const dis = await balanceGet(DIS);
  const ea = await balanceGet(EA);
  check('T6', "disposable_blocked opens at 0 ('disposable'); a gen_count key opens at 200 ('early_adopter')", dis.b?.balance === 0 && ea.b?.balance === 200
    && one(w.ledger, 'SELECT opened_via FROM balances WHERE user_id = ?', DIS)?.opened_via === 'disposable'
    && one(w.ledger, 'SELECT opened_via FROM balances WHERE user_id = ?', EA)?.opened_via === 'early_adopter');
  const FAIL = 'user_S4TESTS4TESTKVLISTFAILS01';
  w.kv.failList = (p) => p.startsWith(`gen_count:${FAIL}`);
  const f = await balanceGet(FAIL);
  check('T6', 'the opening policy read fails: 500, no balance opened, never a guessed number', f.res.status === 500 && f.b?.balance === undefined && balanceOf(w, FAIL) === null);
  w.kv.failList = null;
  w.hooks.before = (sqls) => { if (sqls.some((s) => s.startsWith('SELECT balance FROM balances'))) throw new Error('stub: read failed'); };
  const rf = await balanceGet(IMP);
  check('T6', 'the balance read fails: 500, never SIGNUP_BONUS_TOKENS as a guess', rf.res.status === 500 && rf.b?.success === false);
  w.hooks.before = undefined;
}

// ════════════════════════════════════════════════════════════════════════
// T5: the daily reward (4.1, `daily_login:{userId}:{UTC day}`)
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  await seed(w, U1, 10);
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => daily(U1)));
  const today = new Date().toISOString().slice(0, 10);
  const shown = all.flatMap((x) => x.b?.rewards ?? []).filter((r) => r.type === 'daily_login' || r.type === 'streak_bonus');
  check('T5', 'five in parallel: one ledger row, one reward shown, the balance up once', ledgerBy(w, `daily_login:${U1}:${today}`).length === 1
    && shown.length === 1 && balanceOf(w, U1) === 13 && all.every((x) => x.res.status === 200));
  check('T5', 'the streak markers written (after applied)', w.kv.m.get(`streak:${U1}:last_reward_date`)?.value === today && w.kv.m.get(`streak:${U1}:count`)?.value === '1');
  // replayed (the credit applied but its markers failed): no reward, no markers
  const w2 = world();
  await seed(w2, U1, 10);
  w2.kv.failPut = (k) => k.startsWith('streak:');
  const first = await daily(U1);
  w2.kv.failPut = null;
  const second = await daily(U1);
  check('T5', "a credit whose streak write failed: shown once; the next call replays, shows nothing, writes no markers", first.b?.rewards?.length === 1
    && second.res.status === 200 && second.b?.rewards?.length === 0 && !w2.kv.m.has(`streak:${U1}:last_reward_date`) && balanceOf(w2, U1) === 13);
  // release 1's key in legacy_idem: replayed, no credit
  const w3 = world();
  await seed(w3, U1, 10);
  legacy(w3, `token_idempotency:daily_login:${U1}:${today}`, 'daily_login');
  const l = await daily(U1);
  check('T5', "release 1's key for today in legacy_idem: replayed, no reward, no credit", l.b?.rewards?.length === 0 && balanceOf(w3, U1) === 10
    && ledgerBy(w3, `daily_login:${U1}:${today}`).length === 0);
  // an error surfaces
  const w4 = world();
  await seed(w4, U1, 10);
  setCtl(w4, 'dev_fault', `batch_throw_before:daily_login:${today}:day=1`);
  const e = await daily(U1);
  check('T5', 'a reward that cannot be confirmed: 500, no reward shown, no markers', e.res.status === 500 && e.b?.success === false && !w4.kv.m.has(`streak:${U1}:last_reward_date`));
  // FX-4: today and yesterday from one clock read: a streak across midnight continues
  const w5 = world();
  await seed(w5, U1, 10);
  const midnight = Date.UTC(2026, 9, 5, 0, 0, 0, 0);
  w5.kv.m.set(`streak:${U1}:last_reward_date`, { value: '2026-10-04' });
  w5.kv.m.set(`streak:${U1}:count`, { value: '6' });
  const cross = await DR.checkAndGrantDailyReward(U1, midnight);
  check('T5', 'FX-4: at 00:00:00.000 UTC, yesterday from the same read: the streak continues (day 7, the weekly bonus)', cross.kind === 'applied'
    && cross.reward.streakDay === 7 && cross.reward.isStreakBonus === true && cross.rewardKey === `daily_login:${U1}:2026-10-05`);
}

// ════════════════════════════════════════════════════════════════════════
// email list (4.1, `email_list:{userId}`; the flag only after applied or replayed)
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  await seed(w, U1, 10);
  let r = await emailList(U1);
  check('6.2', 'email list: credited once, the flag set after applied', r.res.status === 200 && r.b?.granted === 5 && balanceOf(w, U1) === 15
    && w.kv.m.get(`bonus_email_list:${U1}`)?.value === '1' && ledgerBy(w, `email_list:${U1}`).length === 1);
  r = await emailList(U1);
  check('6.2', 'a second call: alreadyClaimed, no Resend call, no second credit', r.b?.alreadyClaimed === true && w.resendCalls === 1 && balanceOf(w, U1) === 15);
  const w2 = world();
  await seed(w2, U1, 10);
  legacy(w2, `token_idempotency:email_list:${U1}`, 'email_list');
  r = await emailList(U1);
  check('6.2', "release 1 credited it and its flag write failed: replayed, the flag set now, no second credit", r.res.status === 200 && r.b?.alreadyClaimed === true
    && w2.kv.m.get(`bonus_email_list:${U1}`)?.value === '1' && balanceOf(w2, U1) === 10);
  const w3 = world();
  await seed(w3, U1, 10);
  setCtl(w3, 'dev_fault', 'batch_throw_before:earn_back_email_list');
  r = await emailList(U1);
  check('6.2', 'the credit fails: 500, the flag unset so the user can retry', r.res.status === 500 && !w3.kv.m.has(`bonus_email_list:${U1}`) && balanceOf(w3, U1) === 10);
}

// ════════════════════════════════════════════════════════════════════════
// T11 and T11c: each writer's paused answer (ported from release 1's Pages
// harnesses), and the pause read failing closed
// ════════════════════════════════════════════════════════════════════════
for (const [label, value] of [["'1'", '1'], ['absent', undefined], ["'x'", 'x'], ["''", '']]) {
  const tag = value === '1' ? 'T11' : 'T11c';
  const w = world();
  await seed(w, U1, 100);
  const replayKey = newKey();
  await gen(U1, { idempotencyKey: replayKey });
  w.kv.m.set(`signup_grant:${U1}`, { value: JSON.stringify({ amount: 5, source: 'signup' }) });
  postSwitch(w);
  setCtl(w, 'money_pause', value);
  const sends = w.sends.length;
  const g = await gen(U1);
  check(tag, `money_pause ${label}: generate 503 with the paused copy, nothing debited, nothing sent`, g.res.status === 503 && g.b?.error === 'money_paused'
    && g.b?.message === 'SpriteBrew is finishing some maintenance. Please try again in a little while. You were not charged.' && balanceOf(w, U1) === 84 && w.sends.length === sends);
  const rp = await gen(U1, { idempotencyKey: replayKey });
  check(tag, `money_pause ${label}: a replay is still answered from its row (the identity read precedes the pause)`, rp.res.status === 202 && rp.b?.replayed === true);
  const impKey = newKey();
  const impJob = await IDS.deriveJobId(U1, impKey);
  w.ledger.prepare("INSERT INTO jobs (job_id, user_id, mode, provenance, state, outcome, finished_at_ms, artifact, created_at_ms) VALUES (?, ?, 'create', 'kv', 'finished', 'succeeded', ?, 'published', ?)")
    .run(impJob, U1, toBind(Date.now()), toBind(Date.now()));
  const ri = await gen(U1, { idempotencyKey: impKey });
  check(tag, `money_pause ${label}: a replay of an imported row (no debit row) is answered from it, before the pause`, ri.res.status === 202 && ri.b?.replayed === true);
  const cf = await gen(U1, { idempotencyKey: replayKey, prompt: 'changed' });
  check(tag, `money_pause ${label}: a changed payload under a used key is still 409`, cf.res.status === 409);
  const d = await daily(U1);
  check(tag, `money_pause ${label}: daily reward paused, no reward, no credit, the celebration not consumed`, d.res.status === 200 && d.b?.paused === true
    && d.b?.rewards?.length === 0 && balanceOf(w, U1) === 84 && !w.kv.m.has(`signup_bonus_modal_shown:${U1}`));
  const el = await emailList(U1);
  check(tag, `money_pause ${label}: email list 503, no Resend call, the flag unset`, el.res.status === 503 && el.b?.paused === true && w.resendCalls === 0 && !w.kv.m.has(`bonus_email_list:${U1}`));
  const NEW = `user_S4TESTS4TESTPAUSEDOPEN${String(keySeq).padStart(3, '0')}`;
  const nb = await balanceGet(NEW);
  check(tag, `money_pause ${label}: a first balance (an opening) 503 paused, nothing opened; an existing one still reads`, nb.res.status === 503 && nb.b?.paused === true
    && balanceOf(w, NEW) === null && (await balanceGet(U1)).b?.balance === 84);
  const ev = checkout();
  const h = await hook(ev);
  const hr = held(w, ev.id);
  const wantRow = value === undefined ? hr.length === 0 : hr.length === 1 && hr[0].r1_keys === 'absent';
  check(tag, `money_pause ${label}: the webhook 503 unmarked, nothing credited, the refusal row ${value === undefined ? 'not written (no pause row)' : "with r1_keys 'absent'"}`,
    h.status === 503 && !marked(w, ev.id) && ledgerBy(w, `stripe:${ev.id}`).length === 0 && wantRow);
}
{
  // T11c: the pause read itself fails (D1 down for that read): every writer fails closed
  const w = world();
  await seed(w, U1, 100);
  w.hooks.before = (sqls) => { if (sqls.some((s) => s.includes("key = 'money_pause'") && s.startsWith('SELECT value FROM control'))) throw new Error('stub: pause read failed'); };
  const d = await daily(U1);
  const el = await emailList(U1);
  const ev = checkout();
  const h = await hook(ev);
  check('T11c', 'the pause read fails: daily reward paused (no credit), email list 503, the webhook 503 unmarked', d.b?.paused === true && el.res.status === 503
    && h.status === 503 && !marked(w, ev.id) && balanceOf(w, U1) === 100);
  check('T11c', 'the pause read fails: logged', logs.some((l) => l.includes('pause_read_failed')));
  w.hooks.before = undefined;
  // LEDGER_DB unbound: generate and the webhook answer errors, never a charge
  const w2 = world({ ledgerBound: false });
  const g = await gen(U1);
  const h2 = await hook(checkout());
  const nb = await balanceGet(U1);
  check('T11c', 'LEDGER_DB unbound: generate 503 not charged, the webhook 503, the balance 500 (never a guess)', g.res.status === 503 && h2.status === 503
    && nb.res.status === 500 && w2.sends.length === 0);
}
{
  // T11: a pause that begins after the gate (inside the request)
  const w = world();
  await seed(w, U1, 100);
  w.hooks.before = (sqls) => { if (sqls.some((s) => s.startsWith('INSERT INTO ledger') && s.includes("'debit:' ||"))) setCtl(w, 'money_pause', '1'); };
  const g = await gen(U1);
  check('T11', 'a pause between the identity read and the debit: the debit answers paused, 503, nothing moved or sent', g.res.status === 503 && g.b?.error === 'money_paused'
    && balanceOf(w, U1) === 100 && w.sends.length === 0 && !jobRow(w, g.jobId));
  w.hooks.before = undefined;
  setCtl(w, 'money_pause', '0');
  w.hooks.before = (sqls) => { if (sqls.some((s) => s.startsWith('INSERT INTO ledger') && !s.includes("'debit:' ||") && !s.includes("'opening'"))) setCtl(w, 'money_pause', '1'); };
  const el = await emailList(U1);
  check('T11', 'a pause after the email list\'s pause read: the credit answers paused, 503, the flag unset', el.res.status === 503 && !w.kv.m.has(`bonus_email_list:${U1}`)
    && balanceOf(w, U1) === 100);
  w.hooks.before = undefined;
}

// ════════════════════════════════════════════════════════════════════════
// T10: the webhook (4.13, 4.14), each outcome with its code and marking
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  postSwitch(w);
  await seed(w, U1, 0, { paid: false });
  const ev = checkout();
  w.stripe.charges[`pi_${ev.id}`] = `ch_${ev.id}`;
  let h = await hook(ev);
  const credit = ledgerBy(w, `stripe:${ev.id}`)[0];
  const meta = JSON.parse(credit?.meta_json ?? '{}');
  check('T10', 'a purchase: credited once by stripe:{event.id}, 200, marked', h.status === 200 && balanceOf(w, U1) === 100 && credit?.type === 'credit' && marked(w, ev.id));
  check('T10', "its meta_json: payment_intent, charge, pack_id, session_id, amount_cents (4.14); source 'token_pack_purchase'", meta.payment_intent === `pi_${ev.id}`
    && meta.charge === `ch_${ev.id}` && meta.pack_id === 'starter' && meta.session_id === `cs_${ev.id}` && meta.amount_cents === 1000 && credit?.source === 'token_pack_purchase');
  check('T10', 'its side effects: has_paid, and the purchase:{charge} record', w.kv.m.get(`purchase:${U1}:has_paid`)?.value === 'true'
    && JSON.parse(w.kv.m.get(`purchase:ch_${ev.id}`)?.value ?? 'null')?.tokens === 100);
  h = await hook(ev);
  check('T10', 'the same event resent: 200, nothing moved', h.status === 200 && ledgerBy(w, `stripe:${ev.id}`).length === 1 && balanceOf(w, U1) === 100);
  // committed credit with its response lost
  setCtl(w, 'dev_fault', 'batch_response_lost:token_pack_purchase');
  const ev2 = checkout();
  h = await hook(ev2);
  setCtl(w, 'dev_fault', '');
  check('T10', 'a committed credit with its response lost: read back, credited once, 200, marked', h.status === 200 && ledgerBy(w, `stripe:${ev2.id}`).length === 1
    && balanceOf(w, U1) === 200 && marked(w, ev2.id));
  // one refund event twice
  const rf = refund({ charge: `ch_${ev.id}`, pi: `pi_${ev.id}`, amount: 1000, refunded: 500 });
  h = await hook(rf);
  const h2 = await hook(rf);
  check('T10', 'one refund event twice: one debit (ceil of the refunded share), 200 both, marked', h.status === 200 && h2.status === 200
    && ledgerBy(w, `stripe:${rf.id}`).length === 1 && ledgerBy(w, `stripe:${rf.id}`)[0].amount === 50 && balanceOf(w, U1) === 150 && marked(w, rf.id));
  check('T10', "its side effects once (the mark gates them): refund_count 1, the account not locked at a positive balance",
    w.kv.m.get(`refund_count:${U1}`)?.value === '1' && !w.kv.m.has(`account_status:${U1}`));
  w.kv.m.delete(`purchase:ch_${ev.id}`);
  w.ledger.prepare("UPDATE ledger SET meta_json = json_set(meta_json, '$.payment_intent', 'pi_gone') WHERE idem_key = ?").run(`stripe:${ev.id}`);
  const h3 = await hook(rf);
  check('T10', 'a refund already applied whose mapping is gone since: replayed by its evidence, 200, never pending', h3.status === 200 && !pending(w, rf.id)
    && ledgerBy(w, `stripe:${rf.id}`).length === 1);
  // one dispute twice
  const dp = dispute({ charge: `ch_${ev2.id}`, pi: `pi_${ev2.id}` });
  w.kv.m.set(`purchase:ch_${ev2.id}`, { value: JSON.stringify({ userId: U1, tokens: 100, packId: 'starter', sessionId: `cs_${ev2.id}`, chargeId: `ch_${ev2.id}`, amount: 1000 }) });
  h = await hook(dp);
  await hook(dp);
  check('T10', 'one dispute twice: one debit of the whole pack, the account disputed', h.status === 200 && ledgerBy(w, `stripe:${dp.id}`).length === 1
    && ledgerBy(w, `stripe:${dp.id}`)[0].amount === 100 && JSON.parse(w.kv.m.get(`account_status:${U1}`)?.value ?? '{}').status === 'disputed');
}
{
  // a refund with its purchase: mapping deleted: found by payment intent
  const w = world();
  postSwitch(w);
  await seed(w, U1, 0);
  const ev = checkout();
  await hook(ev);
  const rf = refund({ charge: 'ch_unknown_to_kv', pi: `pi_${ev.id}` });
  const h = await hook(rf);
  check('T10', 'a refund whose purchase:{charge} mapping is gone: found by ledger_purchase_pi, one debit', h.status === 200 && ledgerBy(w, `stripe:${rf.id}`)[0]?.amount === 100
    && balanceOf(w, U1) === 0);
  // a paid purchase on a balance of -500
  const w2 = world();
  postSwitch(w2);
  w2.ledger.prepare("INSERT INTO balances VALUES (?, -500, 1, 1, 'snapshot', NULL)").run(U1);
  const e2 = checkout();
  await hook(e2);
  check('T10', 'a paid purchase on a balance of -500: credited to -400 (A6, no floor)', balanceOf(w2, U1) === -400);
  // no balance row: a purchase opens by policy; a refund at 0 with its alarm
  const w3 = world();
  postSwitch(w3);
  const NEW = 'user_S4TESTS4TESTSTRIPENEW0001';
  const e3 = checkout({ user: NEW });
  await hook(e3);
  check('T10', 'a purchase with no balance row: opened by policy (signup, 5), then credited (105)', balanceOf(w3, NEW) === 105
    && one(w3.ledger, 'SELECT opened_via FROM balances WHERE user_id = ?', NEW)?.opened_via === 'signup');
  const NB = 'user_S4TESTS4TESTREFUNDNOBAL01';
  w3.kv.m.set('purchase:ch_nobal', { value: JSON.stringify({ userId: NB, tokens: 40, packId: 'starter', sessionId: 'cs_x', chargeId: 'ch_nobal', amount: 1000 }) });
  const r3 = refund({ charge: 'ch_nobal' });
  const h3 = await hook(r3);
  check('T10', 'a refund with no balance row: opened at 0 (zero_alarm) with its alarm, then debited to -40, the account locked', h3.status === 200
    && balanceOf(w3, NB) === -40 && alarms(w3, 'zero_alarm').length === 1 && JSON.parse(w3.kv.m.get(`account_status:${NB}`)?.value ?? '{}').status === 'refund_locked');
}
{
  // a refund whose mapping read fails; the account status inside the keyed path
  const w = world();
  postSwitch(w);
  await seed(w, U1, 10);
  w.kv.m.set('purchase:ch_map', { value: JSON.stringify({ userId: U1, tokens: 100, packId: 'starter', sessionId: 'cs_y', chargeId: 'ch_map', amount: 1000 }) });
  const rf = refund({ charge: 'ch_map' });
  w.kv.failGet = (k) => k === 'purchase:ch_map';
  let h = await hook(rf);
  check('T10', 'a refund whose mapping read fails: 500, unmarked, nothing debited', h.status === 500 && !marked(w, rf.id) && balanceOf(w, U1) === 10);
  w.kv.failGet = null;
  w.kv.m.set('purchase:ch_bad', { value: JSON.stringify({ userId: U1 }) });
  const bad = refund({ charge: 'ch_bad' });
  const hb = await hook(bad);
  check('T10', 'a purchase record that cannot be read (no tokens): 500, unmarked, never taken as absent (no pending row)', hb.status === 500 && !pending(w, bad.id) && !marked(w, bad.id));
  w.kv.failPut = (k) => k === `account_status:${U1}`;
  h = await hook(rf);
  check('T10', 'debited to -90, then the account status write fails: 500, unmarked, one debit', h.status === 500 && !marked(w, rf.id)
    && ledgerBy(w, `stripe:${rf.id}`).length === 1 && balanceOf(w, U1) === -90);
  w.kv.failPut = null;
  h = await hook(rf);
  check('T10', "Stripe's retry: the debit replayed (still one), the account locked, 200, marked", h.status === 200 && marked(w, rf.id)
    && ledgerBy(w, `stripe:${rf.id}`).length === 1 && balanceOf(w, U1) === -90 && JSON.parse(w.kv.m.get(`account_status:${U1}`)?.value ?? '{}').status === 'refund_locked');
}
{
  // the outcome table's other rows
  const w = world();
  postSwitch(w);
  await seed(w, U1, 0);
  let h = await hook(checkout(), { badSig: true });
  check('T10', 'a bad signature: 400', h.status === 400);
  const un = { id: evId(), object: 'event', type: 'customer.created', created: nowS(), data: { object: {} } };
  h = await hook(un);
  check('T10', 'an unhandled event type: 200, marked', h.status === 200 && marked(w, un.id));
  const bad = checkout({ meta: { userId: U1, packId: 'starter', tokens: 'lots' } });
  h = await hook(bad);
  check('T10', 'a checkout with invalid metadata: 200, marked, nothing moved', h.status === 200 && marked(w, bad.id) && balanceOf(w, U1) === 0);
  // a ledger error: the batch fails and its read-back fails too
  const er = checkout();
  setCtl(w, 'dev_fault', 'batch_throw_before:token_pack_purchase');
  w.hooks.before = (sqls) => { if (sqls.length === 1 && /applied_identity/.test(sqls[0])) throw new Error('stub: read failed'); };
  h = await hook(er);
  check('T10', 'a ledger error, uncertain and unresolved: 500, unmarked, nothing moved', h.status === 500 && !marked(w, er.id) && ledgerBy(w, `stripe:${er.id}`).length === 0);
  w.hooks.before = undefined;
  setCtl(w, 'dev_fault', '');
  h = await hook(er);
  check('T10', '...then its retry applies it once', h.status === 200 && ledgerBy(w, `stripe:${er.id}`).length === 1);
  // unique_mismatch: a stripe:{event} row with another identity
  const mm = checkout({ tokens: 100 });
  await L.movement(ctxOf(w), { uid: U1, type: 'credit', amount: 7, reason: 'support', source: null, idem: `stripe:${mm.id}`, event: mm.id });
  h = await hook(mm);
  check('T10', 'a stripe:{event.id} row with another identity: 500, unmarked, alarm unique_mismatch', h.status === 500 && !marked(w, mm.id) && alarms(w, 'unique_mismatch').length === 1);
}
{
  // a pre-switch event never refused, no evidence: pending, alarm, 500; then 'apply'; separately 'none'
  const w = world();
  await seed(w, U1, 0);
  const switchAt = Date.now() - 3_600_000;
  setCtl(w, 'switch_at_ms', String(switchAt));
  w.ledger.prepare("INSERT INTO switch_marks VALUES ('pause_start_ms', ?, ?)").run(toBind(switchAt - 7_200_000), toBind(switchAt - 7_200_000));
  legacy(w, 'token_idempotency:unrelated', 'other');
  const pre = Math.floor((switchAt - 10 * 3_600_000) / 1000);
  const a = checkout({ created: pre });
  let h = await hook(a);
  check('T10', "a pre-switch event never refused, no evidence: 500 unmarked, the pending row ('no_evidence'), alarm stripe_no_evidence", h.status === 500 && !marked(w, a.id)
    && pending(w, a.id)?.reason === 'no_evidence' && alarms(w, 'stripe_no_evidence').length === 1 && balanceOf(w, U1) === 0);
  h = await hook(a);
  check('T10', '...a retry before any disposition: still 500, one alarm (deduped)', h.status === 500 && alarms(w, 'stripe_no_evidence').length === 1);
  await L.recordDisposition(ctxOf(w), { event: a.id, disposition: 'apply', note: null, who: 'george' });
  h = await hook(a);
  check('T10', "...George's 'apply': one movement, 200, marked, the pending row resolved", h.status === 200 && marked(w, a.id) && balanceOf(w, U1) === 100
    && pending(w, a.id)?.resolved_at_ms !== null);
  const n = checkout({ created: pre });
  await hook(n);
  await L.recordDisposition(ctxOf(w), { event: n.id, disposition: 'none', note: 'no payment in Stripe', who: 'george' });
  h = await hook(n);
  check('T10', "...separately 'none': no movement, 200, marked, resolved", h.status === 200 && marked(w, n.id) && ledgerBy(w, `stripe:${n.id}`).length === 0
    && pending(w, n.id)?.resolved_at_ms !== null && balanceOf(w, U1) === 100);
  // R6: a 'none' that commits between the admission read and the movement
  const r6 = checkout({ created: pre });
  await hook(r6);
  await L.recordDisposition(ctxOf(w), { event: r6.id, disposition: 'apply', note: null, who: 'george' });
  w.hooks.before = (sqls) => {
    if (sqls.some((s) => s.startsWith('INSERT INTO ledger') && s.includes('stripe_pending'))) {
      w.ledger.prepare("UPDATE stripe_pending SET disposition = 'none', evidence_note = 'revised', revised_from = 'apply', decided_at_ms = ? WHERE event_id = ?").run(toBind(Date.now()), r6.id);
      w.hooks.before = undefined;
    }
  };
  h = await hook(r6);
  check('T10', "R6: George's 'none' committed after the admission read: refused by decision, no movement, 200, marked, resolved", h.status === 200
    && marked(w, r6.id) && ledgerBy(w, `stripe:${r6.id}`).length === 0 && pending(w, r6.id)?.resolved_at_ms !== null);
  w.hooks.before = undefined;
}
{
  // S-1's five cases, with a switch pause recorded
  const w = world();
  await seed(w, U1, 0);
  const epoch = Date.now() - 2 * 3_600_000;
  setCtl(w, 'money_pause', '1', epoch);
  w.ledger.prepare("INSERT INTO switch_marks VALUES ('pause_start_ms', ?, ?)").run(toBind(epoch), toBind(epoch));
  legacy(w, 'token_idempotency:unrelated', 'other');
  const beforePause = Math.floor((epoch - 3_600_000) / 1000);
  // (1) a refusal whose write failed, then succeeded on a retry
  const one1 = checkout({ created: beforePause });
  w.hooks.before = (sqls) => { if (sqls.some((s) => s.startsWith('INSERT INTO stripe_held'))) throw new Error('stub: write failed'); };
  let h = await hook(one1);
  w.hooks.before = undefined;
  const firstHeld = held(w, one1.id).length;
  h = await hook(one1);
  check('T10', 'S-1 (1): the refusal write fails (503), then a retry writes it, r1_keys absent', h.status === 503 && firstHeld === 0 && held(w, one1.id)[0]?.r1_keys === 'absent');
  // (2) a refusal never recorded
  const two = checkout({ created: beforePause });
  // (3) an event created after the pause start, with no refusal
  const three = checkout({ created: Math.floor((epoch + 60_000) / 1000) });
  // (4) a resend by hand, during the pause, of an event 4 days old
  const four = checkout({ created: Math.floor((Date.now() - 4 * 86_400_000) / 1000) });
  h = await hook(four);
  // the unpause (4.15): money open, switch_at_ms the time
  setCtl(w, 'money_pause', '0');
  setCtl(w, 'switch_at_ms', String(Date.now()));
  h = await hook(one1);
  check('T10', 'S-1 (1) after the unpause: admitted by (a), credited once, 200, no alarm', h.status === 200 && ledgerBy(w, `stripe:${one1.id}`).length === 1 && alarms(w, 'stripe_no_evidence').length === 0);
  h = await hook(two);
  check('T10', 'S-1 (2) a refusal never recorded: 500 until George\'s disposition, alarmed', h.status === 500 && pending(w, two.id)?.reason === 'no_evidence' && ledgerBy(w, `stripe:${two.id}`).length === 0);
  h = await hook(three);
  check('T10', 'S-1 (3) created after the pause start: admitted by (b), credited once', h.status === 200 && ledgerBy(w, `stripe:${three.id}`).length === 1);
  h = await hook(four);
  check('T10', 'S-1 (4) the 4-day-old resend: refused absent but over 3 days, so 500 until George\'s disposition', h.status === 500 && ledgerBy(w, `stripe:${four.id}`).length === 0
    && held(w, four.id).length === 1);
  check('T10', 'S-1: the unsettled refusals listed for the pause epoch (4.13) include the 4-day resend, not the credited one',
    (await L.unsettledRefusals(ctxOf(w), epoch)).map((r) => r.event_id).filter((e) => [one1.id, four.id].includes(e)).join() === '');
  // (5) the reversed order, a refund before its purchase
  const pur = checkout({ created: nowS() + 5 });
  w.stripe.charges[`pi_${pur.id}`] = `ch_${pur.id}`;
  const rf = refund({ charge: `ch_${pur.id}`, pi: `pi_${pur.id}`, created: nowS() + 6 });
  h = await hook(rf);
  check('T10', "S-1 (5) a refund before its purchase: 500, unmarked, pending 'mapping_missing', no alarm on the first attempt", h.status === 500
    && pending(w, rf.id)?.reason === 'mapping_missing' && alarms(w, 'stripe_mapping_missing').length === 0);
  h = await hook(rf);
  check('T10', '...its second attempt: the stripe_mapping_missing alarm', h.status === 500 && alarms(w, 'stripe_mapping_missing').length === 1);
  await hook(pur);
  h = await hook(rf);
  check('T10', '...the purchase credited, then its retry: one debit, 200, the pending row resolved', h.status === 200 && ledgerBy(w, `stripe:${rf.id}`).length === 1
    && pending(w, rf.id)?.resolved_at_ms !== null);
}
{
  // R4: N14, charge_recovered, a hand settlement, legacy evidence, a lost resolution
  const w = world();
  postSwitch(w);
  await seed(w, U1, 0);
  const rf = refund({ charge: 'ch_not_ours' });
  await hook(rf);
  await L.recordNoneN14(ctxOf(w), { event: rf.id, note: 'not a SpriteBrew charge', who: 'george' });
  let h = await hook(rf);
  check('T10', "R4 N14: George's evidenced 'none' on a mapping_missing refund: 200, marked, resolved, no debit", h.status === 200 && marked(w, rf.id)
    && pending(w, rf.id)?.resolved_at_ms !== null && ledgerBy(w, `stripe:${rf.id}`).length === 0);
  // a release 2 purchase credited with charge NULL (the lookup failed), refunded with no payment intent: charge_recovered maps it
  const pur = checkout();
  w.stripe.failPi = true;
  await hook(pur);
  w.stripe.failPi = false;
  const credited = JSON.parse(ledgerBy(w, `stripe:${pur.id}`)[0]?.meta_json ?? '{}');
  const rr = refund({ charge: 'ch_recovered', pi: null });
  h = await hook(rr);
  const before = h.status;
  w.ledger.prepare("INSERT INTO charge_recovered VALUES (?, 'ch_recovered', 'george', ?)").run(pur.id, toBind(Date.now()));
  h = await hook(rr);
  check('T10', "R4: a purchase credited with charge NULL; its refund 500 until George's charge_recovered row, then one debit", credited.charge === null
    && before === 500 && h.status === 200 && ledgerBy(w, `stripe:${rr.id}`).length === 1 && balanceOf(w, U1) === 0);
  // a hand settlement past 30 days, then a late delivery
  const hs = checkout();
  await L.movement(ctxOf(w), { uid: U1, type: 'credit', amount: 100, reason: 'token_pack_purchase', source: 'token_pack_purchase', idem: `stripe:${hs.id}`, event: hs.id,
    meta: JSON.stringify({ provenance: 'hand_settlement', decided_by: 'george' }) });
  h = await hook(hs);
  check('T10', 'R4: a hand settlement on stripe:{event.id}, then a late delivery: replayed, 200, one credit', h.status === 200 && ledgerBy(w, `stripe:${hs.id}`).length === 1
    && balanceOf(w, U1) === 100);
  // signs of a release 1 credit: its key in legacy_idem
  const r1 = checkout();
  legacy(w, `token_idempotency:${r1.id}`, 'stripe_credit');
  h = await hook(r1);
  check('T10', "R4: a purchase release 1 credited (its key in legacy_idem): replayed, 200, no credit", h.status === 200 && ledgerBy(w, `stripe:${r1.id}`).length === 0
    && balanceOf(w, U1) === 100);
  // a pending row whose movement applied and whose resolution was lost
  const pre = checkout({ created: Math.floor((Date.now() - 3 * 86_400_000) / 1000) });
  setCtl(w, 'switch_at_ms', String(Date.now() - 3_600_000));
  await hook(pre);
  await L.recordDisposition(ctxOf(w), { event: pre.id, disposition: 'apply', note: null, who: 'george' });
  setCtl(w, 'dev_fault', 'batch_throw_before:resolution');
  h = await hook(pre);
  setCtl(w, 'dev_fault', '');
  const after1 = ledgerBy(w, `stripe:${pre.id}`).length;
  h = await hook(pre);
  check('T10', 'R4: a movement applied with its resolution lost: 500 first; the retry replays and resolves; one credit', after1 === 1 && h.status === 200
    && pending(w, pre.id)?.resolved_at_ms !== null && ledgerBy(w, `stripe:${pre.id}`).length === 1);
}
{
  // R5: the pause after admission; a movement reply lost with its identity read failing, committed and not
  const w = world();
  postSwitch(w);
  await seed(w, U1, 0);
  const p = checkout();
  w.hooks.before = (sqls) => { if (sqls.some((s) => s.startsWith('INSERT INTO ledger') && s.includes('stripe_pending'))) { setCtl(w, 'money_pause', '1'); w.hooks.before = undefined; } };
  let h = await hook(p);
  check('T10', 'R5: the pause begins after the admission read, before the movement: 503, the refusal row, nothing moved', h.status === 503 && held(w, p.id).length === 1
    && ledgerBy(w, `stripe:${p.id}`).length === 0 && !marked(w, p.id));
  setCtl(w, 'money_pause', '0');
  for (const [label, fault] of [['committed', 'batch_response_lost:token_pack_purchase'], ['not committed', 'batch_throw_before:token_pack_purchase']]) {
    const e = checkout();
    setCtl(w, 'dev_fault', fault);
    w.hooks.before = (sqls) => { if (sqls.length === 1 && /applied_identity/.test(sqls[0])) throw new Error('stub: read failed'); };
    h = await hook(e);
    w.hooks.before = undefined;
    setCtl(w, 'dev_fault', '');
    const first = h.status;
    h = await hook(e);
    check('T10', `R5: a movement reply lost with its read-back failing (${label}): 500, then the retry: one movement in all, 200`, first === 500 && h.status === 200
      && ledgerBy(w, `stripe:${e.id}`).length === 1);
  }
}

// ════════════════════════════════════════════════════════════════════════
// T10b: 4.13's admission, case by case
// ════════════════════════════════════════════════════════════════════════
{
  const mk = () => {
    const w = world();
    const epoch = Date.now() - 2 * 3_600_000;
    w.ledger.prepare("INSERT INTO switch_marks VALUES ('pause_start_ms', ?, ?)").run(toBind(epoch), toBind(epoch));
    setCtl(w, 'switch_at_ms', String(Date.now() - 60_000));
    w.epoch = epoch;
    return w;
  };
  const refusal = (w, ev, keys, refusedMs = w.epoch + 1000, epoch = w.epoch) =>
    w.ledger.prepare('INSERT INTO stripe_held (event_id, pause_epoch_ms, r1_keys, event_type, event_created_ms, refused_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ev.id, toBind(epoch), keys, ev.type, toBind(ev.created * 1000), toBind(refusedMs));
  let w = mk(); await seed(w, U1, 0); legacy(w, 'token_idempotency:unrelated', 'other');
  let ev = checkout({ created: Math.floor((w.epoch - 3_600_000) / 1000) });
  legacy(w, `token_idempotency:${ev.id}`, 'stripe_credit', Date.now() - 1000);
  refusal(w, ev, 'present');
  let h = await hook(ev);
  check('T10b', "pre-switch evidence that expired, a refusal 'present': not admitted (the veto), 500, George's disposition", h.status === 500 && balanceOf(w, U1) === 0);
  ev = checkout({ created: Math.floor((w.epoch - 4 * 86_400_000) / 1000) });
  refusal(w, ev, 'absent');
  h = await hook(ev);
  check('T10b', 'created more than 3 days before its refusal: not admitted', h.status === 500 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
  ev = checkout({ created: Math.floor((w.epoch - 3_600_000) / 1000) });
  refusal(w, ev, 'absent', w.epoch - 86_400_000, w.epoch - 86_400_000);
  h = await hook(ev);
  check('T10b', 'a refusal from another epoch: not admitted', h.status === 500 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
  // HQ-8 condition 2, three ways
  ev = checkout({ created: Math.floor((w.epoch - 3_600_000) / 1000) });
  refusal(w, ev, 'present');
  h = await hook(ev);
  check('T10b', "HQ-8: keys present at refusal ('present'): no movement", h.status === 500 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
  ev = checkout({ created: Math.floor((w.epoch - 3_600_000) / 1000) });
  refusal(w, ev, 'absent');
  legacy(w, `webhook:stripe:${ev.id}`, 'stripe_event');
  h = await hook(ev);
  check('T10b', "HQ-8: a stale 'absent' with the key in legacy_idem: replayed, no movement, 200", h.status === 200 && ledgerBy(w, `stripe:${ev.id}`).length === 0 && balanceOf(w, U1) === 0);
  ev = checkout({ created: Math.floor((w.epoch - 3_600_000) / 1000) });
  refusal(w, ev, 'unknown');
  h = await hook(ev);
  check('T10b', "HQ-8: 'unknown' with no legacy evidence: George's disposition (500)", h.status === 500 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
  ev = checkout({ created: Math.floor((w.epoch - 3_600_000) / 1000) });
  refusal(w, ev, 'unknown');
  legacy(w, `token_idempotency:${ev.id}`, 'stripe_credit');
  h = await hook(ev);
  check('T10b', "HQ-8: 'unknown' with its key in legacy_idem: replayed", h.status === 200 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
  // R5: (b) admits, but a refusal also recorded 'present'
  ev = checkout({ created: Math.floor((w.epoch + 60_000) / 1000) });
  refusal(w, ev, 'present');
  h = await hook(ev);
  check('T10b', "R5: (b) admits but a refusal recorded 'present': vetoed, 500", h.status === 500 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
  // the bound: before and after MIN(keep_until_ms), and with legacy_idem empty
  w = mk(); await seed(w, U1, 0);
  legacy(w, 'token_idempotency:bound', 'other', Date.now() + 3_600_000);
  ev = checkout({ created: Math.floor((w.epoch + 60_000) / 1000) });
  h = await hook(ev);
  check('T10b', 'the bound: before MIN(keep_until_ms), (b) admits', h.status === 200 && ledgerBy(w, `stripe:${ev.id}`).length === 1);
  w = mk(); await seed(w, U1, 0);
  legacy(w, 'token_idempotency:bound', 'other', Date.now() - 1);
  ev = checkout({ created: Math.floor((w.epoch + 60_000) / 1000) });
  h = await hook(ev);
  check('T10b', 'the bound: after MIN(keep_until_ms), nothing is admitted (N13)', h.status === 500 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
  w = mk(); await seed(w, U1, 0);
  ev = checkout({ created: Math.floor((w.epoch + 60_000) / 1000) });
  h = await hook(ev);
  check('T10b', 'legacy_idem empty: the fallback bound (switch_at_ms + 45 days) admits', h.status === 200 && ledgerBy(w, `stripe:${ev.id}`).length === 1);
  w = mk(); await seed(w, U1, 0);
  w.ledger.prepare("DELETE FROM switch_marks").run();
  ev = checkout({ created: Math.floor((w.epoch + 60_000) / 1000) });
  h = await hook(ev);
  check('T10b', 'no pause start recorded: nothing admitted', h.status === 500 && ledgerBy(w, `stripe:${ev.id}`).length === 0);
}

// ════════════════════════════════════════════════════════════════════════
// R9-8: the purchase banner tied to the checkout's own credit
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  postSwitch(w);
  await seed(w, U1, 0);
  const ev = checkout();
  const sid = `cs_${ev.id}`;
  w.stripe.sessions[sid] = { payment_intent: `pi_${ev.id}`, metadata: { userId: U1 } };
  let r = await balanceGet(U1, `?purchase=1&session=${sid}`);
  check('R9-8', 'before the credit: credited false, money open', r.b?.credited === false && r.b?.moneyPaused === false && r.b?.balance === 0);
  check('R9-8', "...so the banner shows 'pending', never 'added'", PB.bannerStateFor({ ok: true, balance: 0, moneyPaused: false }) === 'pending');
  await hook(ev);
  r = await balanceGet(U1, `?purchase=1&session=${sid}`);
  check('R9-8', 'after the credit: credited true (the session\'s payment intent finds this user\'s purchase row naming this session)', r.b?.credited === true && r.b?.balance === 100);
  check('R9-8', "...the banner shows 'added' on that evidence alone, even while paused", PB.bannerStateFor({ ok: true, credited: true, moneyPaused: true }) === 'added');
  r = await balanceGet(U2, `?purchase=1&session=${sid}`);
  check('R9-8', "another user's session: no evidence (null)", r.b?.credited === null);
  r = await balanceGet(U1, '?purchase=1&session=not-a-session');
  check('R9-8', 'a malformed session id: null, and no Stripe call', r.b?.credited === null && !w.fetches.some((f) => f.includes('not-a-session')));
  r = await balanceGet(U1, '?purchase=1&session=cs_unknown_session');
  check('R9-8', 'a session Stripe does not know: null', r.b?.credited === null);
  // a balance rise from another credit is not evidence any more
  const other = checkout();
  const sid2 = `cs_${other.id}`;
  w.stripe.sessions[sid2] = { payment_intent: `pi_${other.id}`, metadata: { userId: U1 } };
  await L.movement(ctxOf(w), { uid: U1, type: 'credit', amount: 500, reason: 'support', source: null, idem: 'support:2026-10-04:1' });
  r = await balanceGet(U1, `?purchase=1&session=${sid2}`);
  check('R9-8', 'another credit landing during checkout (the balance rises by more than the pack): still credited false', r.b?.credited === false);
  const sid3 = 'cs_another_session_same_pi';
  w.stripe.sessions[sid3] = { payment_intent: `pi_${ev.id}`, metadata: { userId: U1 } };
  r = await balanceGet(U1, `?purchase=1&session=${sid3}`);
  check('R9-8', "a session whose payment intent finds a purchase row naming another session: false", r.b?.credited === false);
  check('R9-8', "the latch: 'paused' holds until 'added'; 'added' holds", PB.nextBannerState('paused', { ok: true, moneyPaused: false }) === 'paused'
    && PB.nextBannerState('paused', { ok: true, credited: true }) === 'added' && PB.nextBannerState('added', { ok: false }) === 'added');
  const src = readFileSync(path.join(ROOT, 'src/app/api/stripe/checkout/route.ts'), 'utf8');
  check('R9-8', "the checkout's success_url carries the session id", src.includes('purchase=success&session_id={CHECKOUT_SESSION_ID}'));
}

// ════════════════════════════════════════════════════════════════════════
// The admin routes: failure-rate's scope, the events route's event-name query
// ════════════════════════════════════════════════════════════════════════
{
  const w = world();
  const admin = (url) => new Request(`${ORIGIN}${url}`, { headers: { 'x-admin-token': 'admin_placeholder_not_a_secret' } });
  const fr = await body(await R['admin/failure-rate'].GET(admin('/api/admin/failure-rate')));
  check('admin', "failure-rate says its scope: 'pre-switch token_tx rows only'", fr?.scope === 'pre-switch token_tx rows only');
  const ins = (name, id) => w.events.prepare(`INSERT INTO events (event_id, dedupe_key, schema_version, event_name, level, occurred_at_ms, reporting_day, ingested_at_ms,
    environment, source_service, event_json, event_sha256) VALUES (?, ?, 1, ?, 'error', ?, '2026-10-04', ?, 'dev', 'spritebrew-pages', '{}', 'x')`).run(id, id, name, toBind(Date.now()), toBind(Date.now()));
  ins('admission.late_completion', 'e1'); ins('admission.late_completion', 'e2'); ins('generation.failed', 'e3');
  const ok = await R['admin/events'].GET(admin('/api/admin/events?eventName=admission.late_completion'));
  const okb = await body(ok);
  check('admin', 'events ?eventName=admission.late_completion: those rows only, every day', ok.status === 200 && okb?.count === 2 && okb.rows.every((r) => r.event_name === 'admission.late_completion'));
  const bad = await R['admin/events'].GET(admin('/api/admin/events?eventName=generation.failed'));
  const both = await R['admin/events'].GET(admin('/api/admin/events?eventName=admission.late_completion&jobId=x'));
  check('admin', 'a name outside the list, or two selectors: 400', bad.status === 400 && both.status === 400);
}

// ════════════════════════════════════════════════════════════════════════
// The sources: copy markers, retired code
// ════════════════════════════════════════════════════════════════════════
{
  const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
  const s0 = ['src/lib/moneyPause.ts', 'src/lib/purchaseBanner.ts', 'src/app/api/generation-status/[jobId]/route.ts'].map(read).join('\n');
  check('copy', "S0's seven approved strings carry no 'UNAPPROVED COPY' marker (HQ `2026-10-04-002`)", !s0.includes('UNAPPROVED COPY') && (s0.match(/approved with S0's production go/g) ?? []).length === 7);
  const gen = read('src/app/api/generate/route.ts');
  check('copy', "generate's five strings carry HQ's approval (`2026-10-04-004`), none marked unapproved", !gen.includes('UNAPPROVED COPY') && (gen.match(/Approved by HQ, `2026-10-04-004`/g) ?? []).length === 5);
  const { existsSync: ex } = await import('node:fs');
  check('retired', 'release 1 money modules are gone (admission records, the KV refund debit, the unrefunded alarm, the refusal writer)',
    ['moneyAdmission', 'lateCompletionAlarm', 'tokenDebit', 'unrefundedAlarm', 'stripeHeld'].every((m) => !ex(path.join(ROOT, 'src/lib', `${m}.ts`))));
}

{
  // Ported from release 1's money-pause-test (retired in S4): the rows whose
  // behavior release 2 keeps
  const w = world();
  await seed(w, U1, 100);
  setCtl(w, 'money_pause', '1');
  let g = await gen(U1, { idempotencyKey: 'short' });
  check('T11', 'paused, with a bad idempotencyKey: 400 first (the pre-debit guards unchanged)', g.res.status === 400 && balanceOf(w, U1) === 100);
  const NEWD = 'user_S4TESTS4TESTDAILYPAUSED01';
  const d = await daily(NEWD);
  check('T11', 'daily reward paused, a new user: 503 (no opening), the celebration not marked', d.res.status === 503 && d.b?.paused === true
    && balanceOf(w, NEWD) === null && !w.kv.m.has(`signup_bonus_modal_shown:${NEWD}`));
  w.kv.m.set(`bonus_email_list:${U1}`, { value: '1' });
  const el = await emailList(U1);
  check('T11', 'email list paused, already claimed: 200 alreadyClaimed (no money moves)', el.res.status === 200 && el.b?.alreadyClaimed === true && el.b?.balance === 100);
  setCtl(w, 'money_pause', '0');
  process.env.QUEUE_KICKOFF_ENABLED = 'false';
  g = await gen(U1);
  check('base', 'the SSE path: 503 path_retired before any debit', g.res.status === 503 && g.b?.error === 'path_retired' && balanceOf(w, U1) === 100);
  process.env.QUEUE_KICKOFF_ENABLED = 'true';
  process.env.APP_ENV = 'production';
  setCtl(w, 'dev_fault', 'batch_throw_before:generation,send_skip');
  const devTok = TOK[U1];
  TOK[U1] = await tokenFor(U1, true);
  g = await gen(U1);
  TOK[U1] = devTok;
  check('T7', 'the dev faults are ignored when APP_ENV is production: charged and sent', g.res.status === 202 && w.sends.length === 1 && balanceOf(w, U1) === 84);
  process.env.APP_ENV = 'dev';
  setCtl(w, 'dev_fault', '');
  // the pause read never answers: the 2 s bound, then paused (fail closed)
  w.hooks.hang = (sql) => sql.includes("key = 'money_pause'") && sql.startsWith('SELECT value FROM control');
  const t0 = Date.now();
  const ev = checkout();
  const h = await hook(ev);
  check('T11c', 'the pause read never answers: paused after its 2 s bound, the webhook 503, unmarked', h.status === 503 && Date.now() - t0 >= 1_900 && !marked(w, ev.id));
  w.hooks.hang = undefined;
  // the webhook without KV: a refund cannot read its mapping
  const w2 = world({ kvBound: false });
  postSwitch(w2);
  const rf = refund({ charge: 'ch_nokv' });
  const h2 = await hook(rf);
  check('T10', 'the webhook without KV: a refund cannot read its purchase mapping, 500, nothing moved', h2.status === 500 && ledgerBy(w2, `stripe:${rf.id}`).length === 0);
}

// ════════════════════════════════════════════════════════════════════════
// Ported from s0-test.mjs (retired in S4): 5.5's paused copy, the loader,
// and HQ-14's banner, its 'added' now on the checkout's own credit (R9-8)
// ════════════════════════════════════════════════════════════════════════
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const statusRoute = await (async () => {
  const OUT2 = path.join(OUT, 'port');
  await build({
    entryPoints: {
      status: path.join(ROOT, 'src/app/api/generation-status/[jobId]/route.ts'),
      pollClient: path.join(ROOT, 'src/lib/pollClient.ts'),
      spriteStore: path.join(ROOT, 'src/stores/spriteStore.ts'),
      BrewingLoader: path.join(ROOT, 'src/components/sprites/BrewingLoader.tsx'),
      moneyPause: path.join(ROOT, 'src/lib/moneyPause.ts'),
    },
    bundle: true, platform: 'node', format: 'esm', outdir: OUT2, logLevel: 'error', jsx: 'automatic',
    tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
    plugins: [mutation],
  });
  const ld = async (n) => import(pathToFileURL(path.join(OUT2, `${n}.mjs`)).href + v);
  return { route: await ld('status'), pc: await ld('pollClient'), store: (await ld('spriteStore')).useSpriteStore,
    BrewingLoader: (await ld('BrewingLoader')).default, mp: await ld('moneyPause') };
})();
const COPY = "SpriteBrew is finishing some maintenance. Your generation will start when it's done, or its tokens will be returned.";
const SJOB = 'job_s4_status_test';
const statusGet = async (u) => statusRoute.route.GET(await authed(u, `/api/generation-status/${SJOB}`), { params: Promise.resolve({ jobId: SJOB }) });
for (const [label, ageMs, setup, expectCopy] of [
  ['a fresh job, paused', 5_000, (w) => setCtl(w, 'money_pause', '1'), false],
  ['a held job older than 60 s, paused', 120_000, (w) => setCtl(w, 'money_pause', '1'), true],
  ['a held job older than 60 s, open', 120_000, () => {}, false],
  ['a held job older than 60 s, the pause read failing', 120_000, (w) => { w.hooks.before = (sqls) => { if (sqls.some((s) => s.includes("key = 'money_pause'"))) throw new Error('x'); }; }, true],
]) {
  const w = world();
  setup(w);
  w.kv.m.set(`job:${SJOB}`, { value: JSON.stringify({ status: 'pending', userId: U1, mode: 'create', enqueuedAt: Date.now() - ageMs }) });
  const res = await statusGet(U1);
  const b = await body(res);
  check('5.5', `status route, ${label}: ${expectCopy ? 'the paused copy' : 'no copy'}`, res.status === 200 && b?.status === 'pending'
    && (expectCopy ? b?.paused === true && b?.message === COPY : b?.paused === undefined && b?.message === undefined));
}
{
  // the forwarding, from the real status route to pollClient's onUpdate
  const w = world();
  w.kv.m.set(`job:${SJOB}`, { value: JSON.stringify({ status: 'pending', userId: U1, mode: 'create', enqueuedAt: Date.now() - 120_000 }) });
  const saved = globalThis.fetch;
  const pollThrough = async (bodies) => {
    const states = [];
    let n = 0;
    globalThis.fetch = async (url, init) => {
      const next = bodies[n++];
      if (typeof next === 'function') {
        await next();
        return statusRoute.route.GET(new Request(`${ORIGIN}${url}`, init), { params: Promise.resolve({ jobId: SJOB }) });
      }
      return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const terminal = await statusRoute.pc.pollJobStatus(SJOB, async () => TOK[U1], { initialIntervalMs: 1, longIntervalMs: 1, onUpdate: (s) => states.push(s) });
      return { states, terminal };
    } finally {
      globalThis.fetch = saved;
    }
  };
  const END = { status: 'error', error: 'end of test', refunded: true };
  let polled = await pollThrough([() => setCtl(w, 'money_pause', '1'), () => setCtl(w, 'money_pause', '1'), () => setCtl(w, 'money_pause', '0'), END]);
  check('5.5', 'pollClient forwards paused and message from the status route while paused, then drops them once open',
    polled.states.length === 3 && polled.terminal.status === 'error'
    && polled.states.slice(0, 2).every((s) => s.status === 'pending' && s.paused === true && s.message === COPY)
    && polled.states[2].status === 'pending' && !('paused' in polled.states[2]) && !('message' in polled.states[2]));
  polled = await pollThrough([
    { status: 'running', startedAt: 5, paused: true }, { status: 'running', startedAt: 5, message: 'stray' },
    { status: 'running', startedAt: 5, paused: true, message: '' }, END,
  ]);
  check('5.5', 'pollClient forwards no copy without both paused: true and a message, and keeps startedAt',
    polled.states.length === 3 && polled.states.every((s) => s.status === 'running' && s.startedAt === 5 && !('paused' in s) && !('message' in s)));
  const store = statusRoute.store;
  store.getState().setGenerationProgress(1, 'pending', 'create', COPY);
  const withCopy = store.getState().generationPausedMessage;
  store.getState().setGenerationProgress(1, 'pending', 'create', null);
  check('5.5', 'setGenerationProgress stores the paused copy and replaces it with null', withCopy === COPY && store.getState().generationPausedMessage === null);
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const USUAL = 'Sprites usually take about 30 seconds, sometimes up to a minute and a half';
  const ANIM_USUAL = 'Animations usually take about 2 minutes, sometimes up to 4';
  const COPY_HTML = COPY.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
  const render = (props) => renderToStaticMarkup(createElement(statusRoute.BrewingLoader, { startedAt: Date.now(), serverStatus: 'pending', ...props }));
  const swapped = render({ mode: 'create', pausedMessage: COPY });
  const usual = render({ mode: 'create', pausedMessage: null });
  const animSwapped = render({ mode: 'animate', action: 'walking', pausedMessage: COPY });
  check('5.5', 'BrewingLoader shows the paused copy in place of its usual line while present',
    swapped.includes(COPY_HTML) && !swapped.includes(USUAL) && animSwapped.includes(COPY_HTML) && !animSwapped.includes(ANIM_USUAL));
  check('5.5', 'BrewingLoader shows its usual line once the copy is absent', usual.includes(USUAL) && !usual.includes(COPY_HTML));
  check('5.5', 'the swap changes only that line (headline and stage unchanged)',
    swapped.replace(COPY_HTML, USUAL) === usual && swapped.includes('Brewing your sprites...') && swapped.includes('Queued'));
  const LONG = 'Taking longer than usual. Still brewing, hang on.';
  for (const [mode, action, afterMs] of [['create', null, 92_378], ['animate', 'walking', 225_994]]) {
    const late = (pausedMessage) => render({ mode, action, pausedMessage, startedAt: Date.now() - afterMs - 5_000 });
    check('5.5', `BrewingLoader past the ${mode} long threshold: the copy in place of the long line, and the long line once absent`,
      late(COPY).includes(COPY_HTML) && !late(COPY).includes(LONG) && late(null).includes(LONG) && !late(null).includes(COPY_HTML));
  }
}
{
  const pb = PB;
  const mp = statusRoute.mp;
  const S = pb.bannerStateFor;
  check('HQ-14', 'the four banner strings verbatim (HQ-14; state 3 and the late line as HQ 2026-10-03-008 worded them)',
    pb.PURCHASE_BANNER_COPY.added === 'Payment received. Your tokens have been added.'
    && pb.PURCHASE_BANNER_COPY.pending === 'Payment received. Your tokens will appear in a moment.'
    && pb.PURCHASE_BANNER_COPY.late === "Payment received. Your tokens are taking longer than usual to appear. You don't need to pay again."
    && pb.PURCHASE_BANNER_COPY.paused === "Payment received. We're finishing some maintenance, so your tokens may take a little while to appear. You don't need to do anything."
    && Object.keys(pb.PURCHASE_BANNER_COPY).length === 4);
  check('HQ-14', 'the paused answers verbatim (HQ-1, HQ 2026-10-03-008), with no em dash',
    mp.PAUSED_MESSAGE === 'SpriteBrew is finishing some maintenance. Please try again in a little while. You were not charged.'
    && mp.UPDATING_MESSAGE === 'SpriteBrew is finishing some maintenance. Please try again in a little while.'
    && ![mp.PAUSED_MESSAGE, mp.UPDATING_MESSAGE, COPY, ...Object.values(pb.PURCHASE_BANNER_COPY)].some((t) => t.includes('\u2014')));
  const OPEN = { ok: true, balance: 100, moneyPaused: false };
  const ADDED = { ok: true, balance: 600, moneyPaused: false, credited: true };
  check('HQ-14', 'state 1 only on evidence: this checkout\'s own credit (R9-8); a balance rise alone is none', S(ADDED) === 'added'
    && S({ ok: true, balance: 99_999, moneyPaused: false }) === 'pending' && S({ ok: true, balance: 99_999, moneyPaused: true }) === 'paused');
  check('HQ-14', 'state 3 while paused, and when the pause is unknown or the read failed (fail closed)', S({ ok: true, balance: 100, moneyPaused: true }) === 'paused'
    && S({ ok: true, balance: 100 }) === 'paused' && S({ ok: false }) === 'paused');
  check('HQ-14', 'evidence wins: a proven credit is state 1 even while paused', S({ ok: true, moneyPaused: true, credited: true }) === 'added');
  const runWatch = async (reads, { windowMs = 60_000, intervalMs = 3_000 } = {}) => {
    let t = 0, n = 0;
    const states = [], balances = [];
    const guard = new AbortController();
    const last = await pb.watchPurchase({
      read: async () => { if (n >= 200) guard.abort(); return reads[Math.min(n++, reads.length - 1)]; }, signal: guard.signal,
      onState: (s) => states.push(s), onBalance: (b) => balances.push(b),
      intervalMs, windowMs, now: () => t, sleep: async (ms) => { t += ms; },
    });
    return { last, states, balances, reads: n };
  };
  let w = await runWatch([OPEN, OPEN, ADDED]);
  check('HQ-14', 'state 2, re-checked, then state 1 when the credit lands; the re-check stops there',
    w.last === 'added' && w.states.join() === 'pending,pending,added' && w.reads === 3 && w.balances.join() === '100,100,600');
  w = await runWatch([OPEN]);
  check('HQ-14', "the re-check is bounded: a minute at 3 s (21 reads), state 2 throughout, then the late line once at the window's end",
    w.last === 'late' && w.reads === 21 && w.states.length === 22 && w.states.slice(0, 21).every((s) => s === 'pending') && w.states[21] === 'late');
  w = await runWatch([{ ok: true, balance: 100, moneyPaused: true }, { ok: true, balance: 100, moneyPaused: true }, OPEN, ADDED]);
  check('HQ-14', 'the latch: state 3 while paused, held through the unpause (never state 2), state 1 when credited',
    w.states.join() === 'paused,paused,paused,added' && w.last === 'added');
  let tLate = 0, lateReads = 0;
  const lateOrder = [];
  const lateLast = await pb.watchPurchase({
    read: async () => { lateReads++; lateOrder.push('read'); return OPEN; },
    onState: (s) => lateOrder.push(s), intervalMs: 3_000, windowMs: 9_000, now: () => tLate, sleep: async (ms) => { tLate += ms; },
  });
  check('HQ-14', 'the late line comes once, after the last read, and no read follows it',
    lateLast === 'late' && lateReads === 4 && lateOrder.at(-1) === 'late' && lateOrder.filter((x) => x === 'late').length === 1
    && lateOrder.lastIndexOf('read') < lateOrder.indexOf('late'));
  w = await runWatch([{ ok: true, balance: 100, moneyPaused: true }], { windowMs: 9_000 });
  check('HQ-14', 'no late line from state 3: the window ends on state 3', w.last === 'paused' && !w.states.includes('late'));
  w = await runWatch([{ ok: true, balance: 100, moneyPaused: true }, OPEN], { windowMs: 9_000 });
  check('HQ-14', 'no late line from a latched state 3, even when the last reads were open', w.last === 'paused' && !w.states.includes('late'));
  w = await runWatch([OPEN, ADDED], { windowMs: 9_000 });
  check('HQ-14', 'no late line from state 1', w.last === 'added' && !w.states.includes('late'));
  const abortLate = new AbortController();
  const abortStates = [];
  let tAb = 0, nAb = 0;
  await pb.watchPurchase({
    read: async () => { if (++nAb === 2) abortLate.abort(); return OPEN; }, onState: (s) => abortStates.push(s),
    signal: abortLate.signal, intervalMs: 3_000, windowMs: 9_000, now: () => tAb, sleep: async (ms) => { tAb += ms; },
  });
  check('HQ-14', 'no late line when the watcher is stopped (dismissed, or another user)', !abortStates.includes('late'));
  const lateExit = async ({ abortInLastWait = false } = {}) => {
    let t = 0;
    const order = [];
    const ac = new AbortController();
    const last = await pb.watchPurchase({
      read: async () => { order.push(['read', t]); t += 900; return OPEN; }, signal: ac.signal,
      onState: (s) => order.push([s, t]), intervalMs: 3_000, windowMs: 60_000, now: () => t,
      sleep: async (ms) => { t += ms + 400; if (abortInLastWait && t > 60_000) ac.abort(); },
    });
    return { last, order };
  };
  const lx = await lateExit();
  const lxLate = lx.order.filter(([s]) => s === 'late');
  check('HQ-14', "the late line after a late wait: once, at the wait's end (60.2 s), with no read after it",
    lx.last === 'late' && lxLate.length === 1 && lxLate[0][1] === 60_200 && lx.order.at(-1)[0] === 'late'
    && Math.max(...lx.order.filter(([s]) => s === 'read').map(([, at]) => at)) <= 60_000);
  check('HQ-14', 'no late line when the watcher is stopped during its last wait', !(await lateExit({ abortInLastWait: true })).order.some(([s]) => s === 'late'));
  const restart = async ({ previous, startedAt, at, read = OPEN, abort = false }) => {
    let t = at;
    const starts = [], states = [];
    const ac = new AbortController();
    if (abort) ac.abort();
    const last = await pb.watchPurchase({
      read: async () => { starts.push(t); return read; }, previous, startedAt, signal: ac.signal,
      onState: (s) => states.push(s), intervalMs: 3_000, windowMs: 60_000, now: () => t, sleep: async (ms) => { t += ms; },
    });
    return { last, starts, states };
  };
  let rs = await restart({ previous: 'pending', startedAt: 0, at: 30_000 });
  check('HQ-14', 'a restart from state 2 before expiry reads only in the time left (30 s to 60 s), then the late line',
    rs.starts.length === 11 && rs.starts[0] === 30_000 && Math.max(...rs.starts) <= 60_000 && rs.last === 'late' && rs.states.at(-1) === 'late');
  rs = await restart({ previous: 'pending', startedAt: 0, at: 61_000 });
  check('HQ-14', 'a restart from state 2 after expiry starts no read and shows the late line', rs.starts.length === 0 && rs.last === 'late' && rs.states.join() === 'late');
  rs = await restart({ previous: 'paused', startedAt: 0, at: 45_000 });
  check('HQ-14', 'a restart from a latched state 3 before expiry: reads in the time left, still state 3', rs.starts.length > 0
    && Math.max(...rs.starts) <= 60_000 && rs.last === 'paused' && rs.states.every((x) => x === 'paused'));
  rs = await restart({ previous: 'added', startedAt: 0, at: 30_000 });
  check('HQ-14', 'a restart from state 1 before expiry keeps state 1 and stops after one read', rs.starts.length === 1 && rs.last === 'added');
  rs = await restart({ previous: 'late', startedAt: 0, at: 61_000 });
  check('HQ-14', 'a restart after the late line starts no read and keeps it', rs.starts.length === 0 && rs.last === 'late' && rs.states.length === 0);
  w = await runWatch([{ ok: false }, OPEN, OPEN], { windowMs: 6_000 });
  check('HQ-14', "the latch holds after a failed read too: state 3 to the window's end, never state 2", w.states.join() === 'paused,paused,paused' && w.last === 'paused');
  const NB = pb.nextBannerState;
  check('HQ-14', 'nextBannerState: paused holds over open and failed reads; added holds; evidence moves paused to added; no latch from pending',
    NB('paused', OPEN) === 'paused' && NB('paused', { ok: false }) === 'paused' && NB('paused', { ok: true, moneyPaused: true, credited: true }) === 'added'
    && NB('added', { ok: true, moneyPaused: true }) === 'added' && NB('added', { ok: false }) === 'added'
    && NB('pending', { ok: true, moneyPaused: true }) === 'paused' && NB('pending', OPEN) === 'pending' && NB(null, OPEN) === 'pending');
  const windowStarts = async (readMs, lateMs = 0) => {
    let t = 0;
    const starts = [];
    await pb.watchPurchase({ read: async () => { starts.push(t); t += readMs; return OPEN; }, onState: () => {},
      intervalMs: 3_000, windowMs: 60_000, now: () => t, sleep: async (ms) => { t += ms + lateMs; } });
    return starts;
  };
  const ws0 = await windowStarts(0), ws1 = await windowStarts(1_000), ws25 = await windowStarts(2_500), ws7 = await windowStarts(7_000);
  check('HQ-14', 'the strict window: no read starts more than 60 s after the first, read time counted',
    [ws0, ws1, ws25, ws7].every((s) => s.length > 1 && Math.max(...s) <= 60_000) && ws0.length === 21 && ws1.length === 16 && ws25.length === 11 && ws7.length === 7);
  const wsLate = await windowStarts(0, 2_500);
  check('HQ-14', 'the strict window holds when a timer fires late: the read due at 60.5 s never starts', wsLate.length === 11 && Math.max(...wsLate) === 55_000);
  check('HQ-14', 'shownFor: the state only for the user it was shown to', pb.shownFor({ userId: U1, state: 'added' }, U1) === 'added'
    && pb.shownFor({ userId: U1, state: 'added' }, U2) === null && pb.shownFor({ userId: U1, state: 'paused' }, null) === null && pb.shownFor(null, U1) === null);
  // the return read, through the real /api/token-balance
  const tbFetch = (hang = false) => async (url, init) => (hang ? new Promise(() => {}) : R['token-balance'].GET(new Request(`${ORIGIN}${url}`, init)));
  const withFetch = async (f, fn) => { const saved = globalThis.fetch; globalThis.fetch = f; try { return await fn(); } finally { globalThis.fetch = saved; } };
  const wb = world();
  postSwitch(wb);
  await seed(wb, U1, 100);
  let pauseReads = 0;
  wb.hooks.before = (sqls) => { if (sqls.some((s) => s.includes("key = 'money_pause'") && s.startsWith('SELECT value FROM control'))) pauseReads++; };
  let rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => TOK[U1], null));
  check('HQ-14', 'the return read, open: the balance and moneyPaused false, one pause read, no evidence without a session', rd.ok && rd.balance === 100
    && rd.moneyPaused === false && rd.credited === undefined && pauseReads === 1 && S(rd) === 'pending');
  setCtl(wb, 'money_pause', '1');
  rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => TOK[U1], null));
  check('HQ-14', 'the return read, paused: moneyPaused true, so state 3', rd.ok && rd.moneyPaused === true && S(rd) === 'paused');
  const NEWB = 'user_S4TESTS4TESTBANNERNEW0001';
  rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => tok(NEWB), null));
  check('HQ-14', 'the return read for a user with no balance record: no opening, no balance, the pause still read', rd.ok && rd.balance === undefined
    && rd.moneyPaused === true && balanceOf(wb, NEWB) === null);
  setCtl(wb, 'money_pause', '0');
  rd = await withFetch(async () => { throw new TypeError('network'); }, () => pb.readPurchaseStatus(async () => TOK[U1], null));
  const tHang = Date.now();
  const rdHang = await Promise.race([withFetch(tbFetch(true), () => pb.readPurchaseStatus(async () => TOK[U1], null, undefined, 50)), sleepMs(3_000).then(() => ({ ok: 'still waiting' }))]);
  check('HQ-14', 'the return read, failed or unanswered (bounded): no answer, so state 3', !rd.ok && S(rd) === 'paused' && rdHang.ok === false && Date.now() - tHang < 2_000);
  const rdTok = await Promise.race([pb.readPurchaseStatus(() => new Promise(() => {}), null, undefined, 50), sleepMs(3_000).then(() => 'still waiting')]);
  check('HQ-14', 'the bound covers a token that never comes', rdTok !== 'still waiting' && rdTok.ok === false);
  let seenSignal = null;
  const abortable = new AbortController();
  const rdAbort = withFetch(async (url, init) => { seenSignal = init.signal; return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); },
    () => pb.readPurchaseStatus(async () => TOK[U1], null, abortable.signal, 5_000));
  await sleepMs(20);
  abortable.abort();
  check('HQ-14', "the caller's abort reaches the request, and the read ends with no answer", seenSignal?.aborted === true && (await rdAbort).ok === false);
  pauseReads = 0;
  const plain = await body(await R['token-balance'].GET(await authed(U1, '/api/token-balance')));
  check('HQ-14', 'an ordinary balance load does not read the pause and carries no banner fields', plain?.balance === 100 && 'tokenCosts' in plain
    && !('moneyPaused' in plain) && !('credited' in plain) && pauseReads === 0);
  wb.hooks.before = (sqls) => { if (sqls.some((s) => s.startsWith('SELECT balance FROM balances'))) throw new Error('x'); };
  rd = await withFetch(tbFetch(), () => pb.readPurchaseStatus(async () => TOK[U1], null));
  check('HQ-14', 'a failed balance read on return: no balance, never state 1', rd.ok && rd.balance === undefined && S(rd) !== 'added');
  wb.hooks.before = undefined;
  let tDef = 0, nDef = 0;
  const sleeps = [];
  const lastDef = await pb.watchPurchase({ read: async () => { nDef++; return OPEN; }, onState: () => {}, now: () => tDef, sleep: async (ms) => { sleeps.push(ms); tDef += ms; } });
  check('HQ-14', 'the shipped re-check: every 3 s for a minute (21 reads), each read bounded at 8 s', lastDef === 'late' && nDef === 21 && sleeps.length === 20
    && sleeps.every((ms) => ms === 3_000) && pb.RECHECK_INTERVAL_MS === 3_000 && pb.RECHECK_WINDOW_MS === 60_000 && pb.READ_TIMEOUT_MS === 8_000);
  const abortWatch = new AbortController();
  const afterAbort = [];
  await pb.watchPurchase({ read: async () => { abortWatch.abort(); return ADDED; }, onState: (s) => afterAbort.push(s), onBalance: (b) => afterAbort.push(b),
    signal: abortWatch.signal, now: () => 0, sleep: async () => {} });
  check('HQ-14', 'an abort during a read shows nothing from that read', afterAbort.length === 0);
}

// ── Summary ──
const order = ['base', 'T4', 'T5', 'T6', 'T7', 'T10', 'T10b', 'T11', 'T11c', 'T35', '5.1', '5.5', '6.2', 'R9-8', 'HQ-14', 'admin', 'copy', 'retired'];
let total = 0;
for (const t of order) {
  const c = counts.get(t) ?? { pass: 0, fail: 0 };
  total += c.pass + c.fail;
  say(`${t}: ${c.pass}/${c.pass + c.fail}`);
}
say(`${failed === 0 ? 'PASS' : 'FAIL'}: ${total - failed}/${total}`);
process.exit(failed === 0 ? 0 : 1);
