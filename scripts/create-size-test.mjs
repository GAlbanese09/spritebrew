// scripts/create-size-test.mjs
//
// Offline tests for size-limits 001 (amended by 003): the server refuses Create
// sizes and styles the browser would not send. Run from the repo root:
// `node scripts/create-size-test.mjs`.
//
// Part 1 calls validateCreateBody (src/lib/createValidation.ts) for every
// registry style. Part 2 drives the real /api/generate route, with the ledger as
// an in-memory SQLite database built from the consumer repo's migrations (as
// s0-test.mjs does) and KV and the queue as stubs, and checks that a refused
// request reaches no admission, no debit and no send. The harness writes only its
// esbuild bundles, to local/.create-size-test (gitignored), and prints only case
// names and pass or fail.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

const subtle = webcrypto.subtle;
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_secret';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.create-size-test');
const CONSUMER = process.env.S0_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MIGRATIONS = [
  path.join(CONSUMER, 'migrations-ledger', '0001_control.sql'),
  path.join(CONSUMER, 'migrations-ledger', '0002_stripe_refusals.sql'),
];
const EVENTS_MIGRATION = path.join(CONSUMER, 'migrations', '0001_events.sql');
for (const f of [...MIGRATIONS, EVENTS_MIGRATION]) {
  if (!existsSync(f)) { console.log(`[create-size-test] missing ${f}`); process.exit(1); }
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

// ── D1 over node:sqlite, KV and queue stubs ──

let calls = [];
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
let ledger, events, kvMap;
function reset() {
  ledger = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) ledger.exec(readFileSync(f, 'utf8'));
  events = new DatabaseSync(':memory:');
  events.exec(readFileSync(EVENTS_MIGRATION, 'utf8'));
  kvMap = new Map(); calls = [];
  process.env = { ...process.env };
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid',
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret', QUEUE_KICKOFF_ENABLED: 'true',
    CLERK_SECRET_KEY: 'placeholder',
    GALLERY_BUCKET: { get: async () => null, head: async () => null, put: async () => ({}) },
    RD_QUEUE: { send: async () => { calls.push('queue.send'); } },
    EVENTS_DB: d1(events),
    LEDGER_DB: d1(ledger),
    SPRITEBREW_KV: {
      get: async (k) => { calls.push(`kv.get ${k}`); return kvMap.has(k) ? kvMap.get(k) : null; },
      getWithMetadata: async (k) => ({ value: kvMap.get(k) ?? null, metadata: null }),
      put: async (k, v) => { calls.push(`kv.put ${k}`); kvMap.set(k, v); },
      delete: async (k) => { kvMap.delete(k); },
      list: async ({ prefix } = {}) => ({ keys: [...kvMap.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name })), list_complete: true }),
    },
  });
}
globalThis.fetch = async () => new Response('{}', { status: 503 });
console.warn = () => {};
console.error = () => {};
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[create-size-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[create-size-test] ', '') : x));
})(console.log);
const say = (...a) => console.log('[create-size-test]', ...a);

// ── Bundle ──

await build({
  entryPoints: {
    createValidation: path.join(ROOT, 'src/lib/createValidation.ts'),
    styleRegistry: path.join(ROOT, 'src/lib/styleRegistry.ts'),
    generate: path.join(ROOT, 'src/app/api/generate/route.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const load = async (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const { validateCreateBody } = await load('createValidation');
const { GENERATION_STYLES } = await load('styleRegistry');
const R = await load('generate');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const v = (ps, width, height, over = {}) => validateCreateBody({ prompt: 'a knight', promptStyle: ps, width, height, ...over });

// ── 1. validateCreateBody, every registry style ──

for (const s of GENERATION_STYLES) {
  const m = s.resolutionMode;
  const ps = s.promptStyle;
  if (!m) {
    check(`${ps}: min ${s.minSize} accepted`, v(ps, s.minSize, s.minSize) === null);
    check(`${ps}: max ${s.maxSize} accepted`, v(ps, s.maxSize, s.maxSize) === null);
    check(`${ps}: min width with max height accepted`, v(ps, s.minSize, s.maxSize) === null);
    check(`${ps}: width one below min refused`,
      v(ps, s.minSize - 1, s.minSize) === `Width must be between ${s.minSize} and ${s.maxSize} for this style. Got ${s.minSize - 1}.`);
    check(`${ps}: width one above max refused`,
      v(ps, s.maxSize + 1, s.maxSize) === `Width must be between ${s.minSize} and ${s.maxSize} for this style. Got ${s.maxSize + 1}.`);
    check(`${ps}: height one below min refused`,
      v(ps, s.minSize, s.minSize - 1) === `Height must be between ${s.minSize} and ${s.maxSize} for this style. Got ${s.minSize - 1}.`);
    check(`${ps}: height one above max refused`,
      v(ps, s.minSize, s.maxSize + 1) === `Height must be between ${s.minSize} and ${s.maxSize} for this style. Got ${s.maxSize + 1}.`);
  } else if (m.kind === 'locked') {
    // The existing check, unchanged.
    check(`${ps} (locked ${m.size}): its size accepted`, v(ps, m.size, m.size) === null);
    check(`${ps} (locked ${m.size}): one below refused as before`,
      v(ps, m.size - 1, m.size - 1) === `This style is locked at ${m.size}x${m.size}. Got ${m.size - 1}x${m.size - 1}.`);
    check(`${ps} (locked ${m.size}): one above refused as before`,
      v(ps, m.size + 1, m.size + 1) === `This style is locked at ${m.size}x${m.size}. Got ${m.size + 1}x${m.size + 1}.`);
  } else {
    // variable_special (and any variable entry): the existing check, unchanged.
    check(`${ps} (${m.kind} ${m.min} to ${m.max}): min and max accepted`, v(ps, m.min, m.min) === null && v(ps, m.max, m.max) === null);
    check(`${ps} (${m.kind}): one below refused as before`,
      v(ps, m.min - 1, m.min) === `Width must be between ${m.min} and ${m.max} for this style. Got ${m.min - 1}.`);
    check(`${ps} (${m.kind}): one above refused as before`,
      v(ps, m.min, m.max + 1) === `Height must be between ${m.min} and ${m.max} for this style. Got ${m.max + 1}.`);
  }
  check(`${ps}: the registry default ${s.defaultWidth}x${s.defaultHeight} (what the form first sends) accepted`,
    v(ps, s.defaultWidth, s.defaultHeight) === null);
}
const kinds = new Set(GENERATION_STYLES.map((s) => s.resolutionMode?.kind ?? 'none'));
check('the registry covers no-mode, locked and variable_special styles', kinds.has('none') && kinds.has('locked') && kinds.has('variable_special'));

const FAST = 'rd_fast__no_style';
check('missing width refused', validateCreateBody({ prompt: 'x', promptStyle: FAST, height: 64 }) === 'Width is required.');
check('missing height refused', validateCreateBody({ prompt: 'x', promptStyle: FAST, width: 64 }) === 'Height is required.');
check('a non-integer width refused', v(FAST, 64.5, 64) === 'Width must be a whole number.');
check('a non-integer height refused', v(FAST, 64, 64.5) === 'Height must be a whole number.');
check('a string width refused', v(FAST, '64', 64) === 'Width must be a whole number.');
check('a null width refused', v(FAST, null, 64) === 'Width must be a whole number.');
check('an unknown style refused (was the 16 fallback)', v('rd_fast__default', 64, 64) === 'Unknown style.');
check('Family B (rd_advanced_animation__walking) on Create refused as an unknown style (003 item 3)',
  v('rd_advanced_animation__walking', 64, 64) === 'Unknown style.');
check('the legacy style field is checked the same way', validateCreateBody({ prompt: 'x', style: FAST, width: 400, height: 64 })
  === 'Width must be between 64 and 384 for this style. Got 400.');
check('prompt and style checks still come first', validateCreateBody({ promptStyle: FAST, width: 64, height: 64 }) === 'Prompt is required.'
  && validateCreateBody({ prompt: 'x', width: 64, height: 64 }) === 'Style is required.');

// ── 2. The route: a refusal reaches no admission, no debit, no send ──

const USER = 'user_CREATESIZETESTCREATESIZE1';
const tok = await tokenFor(USER);
const balanceKey = `token_balance:${USER}`;
const req = (body) => new Request('https://dev.spritebrew.pages.dev/api/generate', {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'a knight', idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`, ...body }),
});
const admissions = () => ledger.prepare('SELECT COUNT(*) AS n FROM money_admissions').get().n;
const refusals = [
  ['above max', { promptStyle: FAST, width: 385, height: 64 }, 'Width must be between 64 and 384 for this style. Got 385.'],
  ['below min', { promptStyle: 'rd_pro__default', width: 64, height: 64 }, 'Width must be between 96 and 256 for this style. Got 64.'],
  ['unknown style', { promptStyle: 'rd_fast__default', width: 64, height: 64 }, 'Unknown style.'],
  ['Family B on Create', { promptStyle: 'rd_advanced_animation__idle', width: 64, height: 64 }, 'Unknown style.'],
  ['no width', { promptStyle: FAST, height: 64 }, 'Width is required.'],
  ['non-integer height', { promptStyle: FAST, width: 64, height: 64.5 }, 'Height must be a whole number.'],
];
for (const [label, body, msg] of refusals) {
  reset(); kvMap.set(balanceKey, JSON.stringify({ balance: 100, created_at: 'x', last_updated: 'x' }));
  const res = await R.POST(req(body));
  const j = await res.json().catch(() => null);
  const debited = [...kvMap.keys()].some((k) => k.startsWith('token_idempotency:') || k.startsWith('token_tx:'));
  check(`route, ${label}: 400 with the message, no admission, no debit, no send, balance untouched`,
    res.status === 400 && j?.error === msg && admissions() === 0 && !debited && !calls.includes('queue.send')
    && JSON.parse(kvMap.get(balanceKey)).balance === 100 && !calls.some((c) => c.startsWith('kv.put')));
}
reset(); kvMap.set(balanceKey, JSON.stringify({ balance: 100, created_at: 'x', last_updated: 'x' }));
const ok = await R.POST(req({ promptStyle: FAST, width: 64, height: 64 }));
check('route, a valid Create still admits, debits the style price and sends (the harness reaches the money path)',
  ok.status === 202 && admissions() === 1 && calls.includes('queue.send') && JSON.parse(kvMap.get(balanceKey)).balance === 95);

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
