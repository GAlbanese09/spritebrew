// scripts/has-paid-test.mjs
//
// Offline tests for has-paid 001: the plain balance read answers `hasPaid`, true
// only when `purchase:{userId}:has_paid` is set and the account status is
// `active`, and no longer carries `tokenCosts`. The purchase banner's two reads,
// the paused opening's 503 and an opening while open are unchanged. Run from the
// repo root: `node scripts/has-paid-test.mjs`.
//
// Built the way s0-test.mjs builds its routes: LEDGER_DB and EVENTS_DB are real
// SQLite databases (node:sqlite, in memory) from the consumer repo's migrations,
// so an opening runs its admission as written; KV is an in-memory stub. The
// expected `?purchase=` bytes are 821c69a's. The harness writes only its bundle,
// to local/.has-paid-test (gitignored), and prints only case names and pass or fail.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

const subtle = webcrypto.subtle;
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.has-paid-test');
const CONSUMER = process.env.S0_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MIGRATIONS = [
  path.join(CONSUMER, 'migrations-ledger', '0001_control.sql'),
  path.join(CONSUMER, 'migrations-ledger', '0002_stripe_refusals.sql'),
];
const EVENTS_MIGRATION = path.join(CONSUMER, 'migrations', '0001_events.sql');
for (const f of [...MIGRATIONS, EVENTS_MIGRATION]) {
  if (!existsSync(f)) { console.log(`[has-paid-test] missing ${f}: check out the consumer's n1-s0 branch`); process.exit(1); }
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
let ledger, events, kvMap, kvGetThrows, gets, puts, ops;
function reset({ paused = false, admins } = {}) {
  ledger = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) ledger.exec(readFileSync(f, 'utf8'));
  events = new DatabaseSync(':memory:');
  events.exec(readFileSync(EVENTS_MIGRATION, 'utf8'));
  if (paused) ledger.prepare("UPDATE control SET value = '1', updated_at_ms = ?, updated_by = 'test' WHERE key = 'money_pause'").run(Date.now());
  kvMap = new Map(); kvGetThrows = () => false; gets = []; puts = []; ops = [];
  process.env = { ...process.env };
  delete process.env.ADMIN_USER_IDS;
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid',
    LEDGER_DB: d1(ledger), EVENTS_DB: d1(events),
    SPRITEBREW_KV: {
      get: async (k) => { gets.push(k); ops.push(`get ${k}`); if (kvGetThrows(k)) throw new Error('stub: KV get failed'); return kvMap.has(k) ? kvMap.get(k) : null; },
      getWithMetadata: async (k) => ({ value: kvMap.get(k) ?? null, metadata: null }),
      put: async (k, v) => { puts.push(k); ops.push(`put ${k}`); kvMap.set(k, v); },
      delete: async (k) => { kvMap.delete(k); },
      list: async ({ prefix } = {}) => ({ keys: [...kvMap.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true }),
    },
  });
  if (admins !== undefined) process.env.ADMIN_USER_IDS = admins;
}
console.warn = () => {};
console.error = () => {};
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[has-paid-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[has-paid-test] ', '') : x));
})(console.log);
const say = (...a) => console.log('[has-paid-test]', ...a);

// ── Bundle ──

await build({
  entryPoints: {
    tb: path.join(ROOT, 'src/app/api/token-balance/route.ts'),
    moneyPause: path.join(ROOT, 'src/lib/moneyPause.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const R = await import(pathToFileURL(path.join(OUT, 'tb.mjs')).href);
const { UPDATING_MESSAGE } = await import(pathToFileURL(path.join(OUT, 'moneyPause.mjs')).href);

// ── Helpers ──

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const USER = 'user_HASPAIDTESTHASPAIDTESTHA1';
const NEWUSER = 'user_HASPAIDTESTNEWUSERNOBAL2';
const tok = await tokenFor(USER);
const tokNew = await tokenFor(NEWUSER);
const PAID = `purchase:${USER}:has_paid`;
const STATUS = `account_status:${USER}`;
const seedBalance = (u, n) => kvMap.set(`token_balance:${u}`, JSON.stringify({ balance: n, created_at: 'x', last_updated: 'x' }));
const lock = (status) => kvMap.set(STATUS, JSON.stringify({ status, reason: 'test', locked_at: 'x' }));
async function read(t, query = '') {
  const res = await R.GET(new Request(`https://dev.spritebrew.pages.dev/api/token-balance${query}`, {
    headers: { Authorization: `Bearer ${t}` },
  }));
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { res, text, body };
}
const admissionRows = () => ledger.prepare('SELECT * FROM money_admissions').all().map((r) => ({ ...r }));

// ── hasPaid: the flag and the account status ──

for (const [label, setup, want] of [
  ['flag set, no status key (active)', () => kvMap.set(PAID, 'true'), true],
  ['flag set, status active', () => { kvMap.set(PAID, 'true'); lock('active'); }, true],
  ['no flag', () => {}, false],
  ['no flag, status active', () => lock('active'), false],
  ['a flag value other than "true"', () => kvMap.set(PAID, '1'), false],
  ['flag set, refund_locked', () => { kvMap.set(PAID, 'true'); lock('refund_locked'); }, false],
  ['flag set, disputed', () => { kvMap.set(PAID, 'true'); lock('disputed'); }, false],
  ['flag set, the flag read fails', () => { kvMap.set(PAID, 'true'); kvGetThrows = (k) => k === PAID; }, false],
  ['no flag, the status read fails', () => { kvGetThrows = (k) => k === STATUS; }, false],
]) {
  reset(); seedBalance(USER, 100); setup();
  const r = await read(tok);
  check(`${label}: hasPaid ${want}, 200, the balance unchanged, nothing written`,
    r.res.status === 200 && r.body?.success === true && r.body?.balance === 100 && r.body?.hasPaid === want && puts.length === 0);
}
{
  reset(); seedBalance(USER, 100); kvMap.set(PAID, 'true');
  const r = await read(tok);
  check('the plain answer is exactly success, balance, isAdmin and hasPaid, in that order',
    r.text === '{"success":true,"balance":100,"isAdmin":false,"hasPaid":true}');
  check('the plain answer has no tokenCosts', r.body && !('tokenCosts' in r.body));
  check('the plain read reads the flag and the status once each', gets.filter((k) => k === PAID).length === 1 && gets.filter((k) => k === STATUS).length === 1);
}

// ── isAdmin as before ──

for (const [label, admins, want] of [
  ['the caller listed', `user_SOMEONEELSE00000000000001,${USER}`, true],
  ['the caller not listed', 'user_SOMEONEELSE00000000000001', false],
  ['no list', undefined, false],
]) {
  reset({ admins }); seedBalance(USER, 100);
  const r = await read(tok);
  check(`isAdmin, ${label}: ${want}`, r.res.status === 200 && r.body?.isAdmin === want && r.body?.hasPaid === false);
}

// ── The purchase banner's reads: 821c69a's bytes, no hasPaid, no flag or status read ──

for (const [label, setup, query, want] of [
  ['baseline, a balance', () => seedBalance(USER, 100), '?purchase=baseline', '{"success":true,"balance":100}'],
  ['baseline, no balance', () => {}, '?purchase=baseline', '{"success":true,"balance":null}'],
  ['return, a balance, open', () => seedBalance(USER, 100), '?purchase=1', '{"success":true,"balance":100,"moneyPaused":false}'],
  ['return, a balance, paused', () => { seedBalance(USER, 100); ledger.prepare("UPDATE control SET value = '1' WHERE key = 'money_pause'").run(); }, '?purchase=1', '{"success":true,"balance":100,"moneyPaused":true}'],
  ['return, a failed balance read', () => { seedBalance(USER, 100); kvGetThrows = (k) => k.startsWith('token_balance:'); }, '?purchase=1', '{"success":true,"balance":null,"moneyPaused":false}'],
]) {
  for (const paid of [false, true]) {
    reset(); setup(); if (paid) kvMap.set(PAID, 'true');
    const r = await read(tok, query);
    check(`purchase ${label}, ${paid ? 'paid' : 'unpaid'}: 821c69a's bytes, no flag or status read, nothing written`,
      r.res.status === 200 && r.text === want && !gets.includes(PAID) && !gets.includes(STATUS) && puts.length === 0);
  }
}

// ── A first-ever read ──

{
  reset({ paused: true });
  const r = await read(tokNew);
  check('a first-ever read while paused: 503, the paused body as before',
    r.res.status === 503 && r.text === JSON.stringify({ success: false, error: UPDATING_MESSAGE, paused: true }));
  check('a first-ever read while paused: nothing written, no admission row, no flag or status read',
    puts.length === 0 && kvMap.size === 0 && admissionRows().length === 0
    && !gets.includes(`purchase:${NEWUSER}:has_paid`) && !gets.includes(`account_status:${NEWUSER}`));
}
{
  reset();
  const r = await read(tokNew);
  const rows = admissionRows();
  const stored = kvMap.has(`token_balance:${NEWUSER}`) ? JSON.parse(kvMap.get(`token_balance:${NEWUSER}`)).balance : null;
  check('a first-ever read while open: 200, the balance opened and answered, hasPaid false',
    r.res.status === 200 && typeof r.body?.balance === 'number' && r.body.balance > 0 && r.body.balance === stored && r.body?.hasPaid === false);
  check('a first-ever read while open: one opening admission, completed', rows.length === 1 && rows[0].route === 'opening' && rows[0].completed_at_ms !== null);
  const lastPut = ops.findLastIndex((o) => o.startsWith('put '));
  check('a first-ever read while open: the flag and status are read after the opening, and write nothing',
    puts.length > 0 && lastPut >= 0
    && ops.indexOf(`get purchase:${NEWUSER}:has_paid`) > lastPut && ops.indexOf(`get account_status:${NEWUSER}`) > lastPut
    && puts.every((k) => !k.startsWith('purchase:') && !k.startsWith('account_status:')));
}

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
