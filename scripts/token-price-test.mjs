// scripts/token-price-test.mjs
//
// Offline tests for price-50 001 (amended by 003): Custom Animation and
// 8-Direction Rotation cost 50 tokens; every other price is unchanged. Run from
// the repo root: `node scripts/token-price-test.mjs`.
//
// Part 1 pins getTokenCost for every GENERATION_STYLES entry against a table
// taken from 2541f7e's registry (byte-equal to 624d0c1's), and the Animate-side
// rules. Part 2 drives the real /api/generate route, with the ledger as an
// in-memory SQLite database built from the consumer repo's migrations (as
// s0-test.mjs does) and KV and the queue as stubs. The harness writes only its
// esbuild bundles, to local/.token-price-test (gitignored), and prints only case
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
const OUT = path.join(ROOT, 'local', '.token-price-test');
const CONSUMER = process.env.S0_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MIGRATIONS = [
  path.join(CONSUMER, 'migrations-ledger', '0001_control.sql'),
  path.join(CONSUMER, 'migrations-ledger', '0002_stripe_refusals.sql'),
];
const EVENTS_MIGRATION = path.join(CONSUMER, 'migrations', '0001_events.sql');
for (const f of [...MIGRATIONS, EVENTS_MIGRATION]) {
  if (!existsSync(f)) { console.log(`[token-price-test] missing ${f}`); process.exit(1); }
}

// ── The pinned table: 2541f7e's registry, with price-50's two changes ──

const BEFORE = {
  rd_pro__default: 40, rd_pro__fantasy: 40, rd_pro__platformer: 40, rd_pro__spritesheet: 40,
  rd_pro__inventory_items: 40, rd_pro__fps_weapon: 40, rd_pro__hexagonal_tiles: 40, rd_pro__typography: 40,
  rd_plus__classic: 16, rd_plus__low_res: 16, rd_plus__skill_icon: 16, rd_plus__topdown_item: 16, rd_plus__mc_item: 16,
  rd_fast__retro: 5, rd_fast__no_style: 5,
  animation__four_angle_walking: 25, animation__walking_and_idle: 25, animation__small_sprites: 25, animation__vfx: 25,
  animation__any_animation: 25, animation__8_dir_rotation: 25,
};
const CHANGED = { animation__any_animation: 50, animation__8_dir_rotation: 50 };
const EXPECTED = { ...BEFORE, ...CHANGED };

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

let calls = [], sent = [];
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
  kvMap = new Map(); calls = []; sent = [];
  process.env = { ...process.env };
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid',
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret', QUEUE_KICKOFF_ENABLED: 'true',
    CLERK_SECRET_KEY: 'placeholder',
    GALLERY_BUCKET: { get: async () => null, head: async () => null, put: async () => ({}) },
    RD_QUEUE: { send: async (m) => { calls.push('queue.send'); sent.push(m); } },
    EVENTS_DB: d1(events),
    LEDGER_DB: d1(ledger),
    SPRITEBREW_KV: {
      get: async (k) => (kvMap.has(k) ? kvMap.get(k) : null),
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
  if (typeof a[0] === 'string' && a[0].startsWith('[token-price-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[token-price-test] ', '') : x));
})(console.log);
const say = (...a) => console.log('[token-price-test]', ...a);

// ── Bundle ──

await build({
  entryPoints: {
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
const { getTokenCost, GENERATION_STYLES } = await load('styleRegistry');
const R = await load('generate');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };

// ── 1. Prices ──

const registered = GENERATION_STYLES.map((s) => s.promptStyle);
check(`the registry holds exactly the ${Object.keys(EXPECTED).length} pinned styles`,
  registered.length === Object.keys(EXPECTED).length && registered.every((p) => p in EXPECTED));
for (const s of GENERATION_STYLES) {
  check(`${s.promptStyle}: getTokenCost ${EXPECTED[s.promptStyle]}${s.promptStyle in CHANGED ? ' (was 25)' : ' (unchanged)'}`,
    getTokenCost(s.promptStyle) === EXPECTED[s.promptStyle] && s.tokenCost === EXPECTED[s.promptStyle]);
}
for (const p of Object.keys(CHANGED)) {
  const s = GENERATION_STYLES.find((x) => x.promptStyle === p);
  check(`${p}: costPerGeneration 0.25`, s?.costPerGeneration === 0.25);
}
check('every other costPerGeneration is unchanged from 2541f7e',
  GENERATION_STYLES.filter((s) => !(s.promptStyle in CHANGED)).every((s) => s.costPerGeneration === ({
    rd_pro__default: 0.22, rd_pro__fantasy: 0.22, rd_pro__platformer: 0.22, rd_pro__spritesheet: 0.22,
    rd_pro__inventory_items: 0.22, rd_pro__fps_weapon: 0.22, rd_pro__hexagonal_tiles: 0.22, rd_pro__typography: 0.22,
    rd_plus__classic: 0.06, rd_plus__low_res: 0.05, rd_plus__skill_icon: 0.05, rd_plus__topdown_item: 0.05, rd_plus__mc_item: 0.05,
    rd_fast__retro: 0.02, rd_fast__no_style: 0.02,
    animation__four_angle_walking: 0.07, animation__walking_and_idle: 0.07, animation__small_sprites: 0.07, animation__vfx: 0.07,
  })[s.promptStyle]));
check('Animate rule: rd_advanced_animation__custom_action 50', getTokenCost('rd_advanced_animation__custom_action') === 50);
check('Animate rule: rd_advanced_animation__subtle_motion 50', getTokenCost('rd_advanced_animation__subtle_motion') === 50);
check('Animate rule: another rd_advanced_animation__* (walking, idle, attack) 25',
  ['walking', 'idle', 'attack'].every((a) => getTokenCost(`rd_advanced_animation__${a}`) === 25));
check('rule: an unregistered animation__* 25', getTokenCost('animation__not_in_the_registry') === 25);
check('rule: an unknown style 16', getTokenCost('rd_unknown__style') === 16);

// ── 2. The route ──

const USER = 'user_TOKENPRICETESTTOKENPRICE01';
const tok = await tokenFor(USER);
const balanceKey = `token_balance:${USER}`;
const seed = (n) => kvMap.set(balanceKey, JSON.stringify({ balance: n, created_at: 'x', last_updated: 'x' }));
const balance = () => JSON.parse(kvMap.get(balanceKey)).balance;
const req = (body) => new Request('https://dev.spritebrew.pages.dev/api/generate', {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'a knight', idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`, ...body }),
});
const admissions = () => ledger.prepare('SELECT COUNT(*) AS n, MAX(meta_json) AS meta FROM money_admissions').get();
const sentCost = () => { const m = JSON.stringify(sent[0] ?? {}); const x = /"tokenCost":(\d+)/.exec(m); return x ? Number(x[1]) : null; };

reset(); seed(100);
let res = await R.POST(req({ promptStyle: 'animation__any_animation', width: 64, height: 64 }));
let a = admissions();
check('Create animation__any_animation 64x64 with 100 tokens: 202, debits 50, enqueues tokenCost 50, admission meta tokenCost 50',
  res.status === 202 && balance() === 50 && calls.includes('queue.send') && sentCost() === 50 && a.n === 1 && JSON.parse(a.meta).tokenCost === 50);

reset(); seed(49);
res = await R.POST(req({ promptStyle: 'animation__any_animation', width: 64, height: 64 }));
let j = await res.json().catch(() => null);
check('Create animation__any_animation with 49 tokens: 402 "Insufficient tokens", required 50, no debit, no send',
  res.status === 402 && j?.error === 'Insufficient tokens' && j?.required === 50 && balance() === 49
  && !calls.includes('queue.send') && ![...kvMap.keys()].some((k) => k.startsWith('token_tx:') || k.startsWith('token_idempotency:')));

reset(); seed(100);
res = await R.POST(req({ promptStyle: 'animation__8_dir_rotation', width: 80, height: 80 }));
check('Create animation__8_dir_rotation 80x80: 202, debits 50, enqueues tokenCost 50',
  res.status === 202 && balance() === 50 && sentCost() === 50);

reset(); seed(100);
res = await R.POST(req({ promptStyle: 'animation__vfx', width: 64, height: 64 }));
check('Create animation__vfx (unchanged): debits 25', res.status === 202 && balance() === 75 && sentCost() === 25);

reset(); seed(100);
res = await R.POST(req({ mode: 'animate', action: 'walking', inputImage: 'aGVsbG8=', width: 64, height: 64 }));
check('Animate walking (rd_advanced_animation__walking): still debits 25 and enqueues tokenCost 25',
  res.status === 202 && balance() === 75 && sentCost() === 25);

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
