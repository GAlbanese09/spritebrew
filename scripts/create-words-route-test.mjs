// scripts/create-words-route-test.mjs
//
// Offline tests for G2's public side (HQ 2026-11-18-049, -056): the generate
// route's check of a Create spec through the CREATE_WORDS binding before any
// admission or debit, the ids on the queue message, and GET /api/create-words
// (the "Adds" line). The binding is a stub that answers made-up words: the
// real words live only in the private generation service, and no word of
// them appears here. Built the way replay-first-test.mjs builds the route
// (real SQLite from the consumer's migrations; S0_CONSUMER_DIR or the
// sibling folder). Writes only its bundle to local/.create-words-route-test
// (gitignored). Prints case names and pass or fail.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.removeAllListeners('warning');
const { DatabaseSync } = await import('node:sqlite');

const subtle = webcrypto.subtle;
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.create-words-route-test');
const CONSUMER = process.env.S0_CONSUMER_DIR ?? path.join(ROOT, '..', 'spritebrew-rd-consumer');
const MIGRATIONS = [
  path.join(CONSUMER, 'migrations-ledger', '0001_control.sql'),
  path.join(CONSUMER, 'migrations-ledger', '0002_stripe_refusals.sql'),
];
const EVENTS_MIGRATION = path.join(CONSUMER, 'migrations', '0001_events.sql');
for (const f of [...MIGRATIONS, EVENTS_MIGRATION]) {
  if (!existsSync(f)) { console.log(`[create-words-route-test] missing ${f}: check out the consumer's n1-s0 branch`); process.exit(1); }
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
// stale read that does not see a record already there), or return a promise,
// awaited before the read, to hold the read (section 8; it may resolve to MISS).
// `kvPutHook(k, v)` runs before each put: it may throw before applying, or
// return THROW_AFTER to apply and then throw.
const MISS = Symbol('miss');
const THROW_AFTER = Symbol('throw after');
let ledger, events, kvMap, kvGetHook, kvPutHook, calls, sends, logs, binding, bindingCalls;
function reset(withBinding = okBinding()) {
  bindingCalls = []; binding = withBinding;
  ledger = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) ledger.exec(readFileSync(f, 'utf8'));
  events = new DatabaseSync(':memory:');
  events.exec(readFileSync(EVENTS_MIGRATION, 'utf8'));
  kvMap = new Map(); kvGetHook = () => {}; kvPutHook = () => {}; calls = []; sends = []; logs = [];
  process.env = { ...process.env };
  delete process.env.ADMIN_USER_IDS;
  delete process.env.CREATE_WORDS;
  Object.assign(process.env, {
    APP_ENV: 'dev', CLERK_JWT_KEY: PEM, CLERK_JWT_KID: 'test_kid', QUEUE_KICKOFF_ENABLED: 'true',
    LEDGER_DB: d1(ledger), EVENTS_DB: d1(events),
    SPRITEBREW_KV: {
      get: async (k) => {
        calls.push(`kv.get ${k}`);
        let held = kvGetHook(k);
        if (held && typeof held.then === 'function') held = await held;
        if (held === MISS) return null;
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
    ...(binding == null ? {} : { CREATE_WORDS: binding }),
  });
}
console.warn = () => {};
console.error = (...a) => { logs.push(a.map(String).join(' ')); };
console.log = ((orig) => (...a) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[create-words-route-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[create-words-route-test] ', '') : x));
  else logs.push(a.map(String).join(' '));
})(console.log);
const say = (...a) => console.log('[create-words-route-test]', ...a);
// const replayLines = () => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((l) => l.source === 'generate' && l.event === 'replay_before_admission');
// const endLines = () => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((l) => l.source === 'money-admission' && l.event === 'end');


// ── The binding stub: made-up words only ──

const ADDS = 'stub-adds-a, stub-adds-b';
const VERSION = 'v-test-1';
function okBinding({ length = 77, reason = null, status = 200, raw = null, throws = false, hang = false, version = VERSION } = {}) {
  return {
    fetch: async (url, init) => {
      const req = typeof url === 'string' ? { url, ...init } : url;
      bindingCalls.push({ url: String(req.url ?? url), body: JSON.parse(init?.body ?? '{}') });
      if (throws) throw new Error('stub: binding down');
      if (hang) {
        // Answers only when the caller gives up (its timeout aborts the signal).
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      if (raw !== null) return new Response(raw, { status });
      if (reason) return new Response(JSON.stringify({ ok: false, reason, version }), { status });
      const b = JSON.parse(init.body);
      return new Response(JSON.stringify(b.description === undefined
        ? { ok: true, adds: ADDS, version } : { ok: true, adds: ADDS, length, version }), { status });
    },
  };
}

// ── Bundle ──

await build({
  entryPoints: {
    generate: path.join(ROOT, 'src/app/api/generate/route.ts'),
    words: path.join(ROOT, 'src/lib/createWordsRoute.ts'),
    createValidation: path.join(ROOT, 'src/lib/createValidation.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const G = await import(pathToFileURL(path.join(OUT, 'generate.mjs')).href);
const W = await import(pathToFileURL(path.join(OUT, 'words.mjs')).href);
const CV = await import(pathToFileURL(path.join(OUT, 'createValidation.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; say('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };
const USER = 'user_CREATEWORDSROUTETEST01';
const tok = await tokenFor(USER);
const START = 500;
const seedBalance = (n) => kvMap.set(`token_balance:${USER}`, JSON.stringify({ balance: n, created_at: 'x', last_updated: 'x' }));
const balance = () => JSON.parse(kvMap.get(`token_balance:${USER}`)).balance;
const admissions = () => ledger.prepare('SELECT * FROM money_admissions').all().length;
const SPEC = { card: 'platformer', view: null, framing: null };
let n = 0;
// As G2's page will send it: with a card, the text goes as `description`,
// never `prompt` (M2).
const genReq = (over = {}, idem = `idem-create-words-${++n}`) => new Request('https://dev.spritebrew.pages.dev/api/generate', {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    ...('promptSpec' in over ? { description: '  a knight  ' } : { prompt: '  a knight  ' }),
    style: 'rd_plus__classic', width: 64, height: 64, idempotencyKey: idem, ...over,
  }),
});
async function post(over, idem) {
  const res = await G.POST(genReq(over, idem));
  let body = null; try { body = await res.clone().json(); } catch { /* not JSON */ }
  return { res, body };
}
const nothingMoved = () => admissions() === 0 && balance() === START && sends.length === 0;

// ── The generate route ──

reset(); seedBalance(START);
let r = await post({});
const plainCharge = START - balance();
check('generate: a Create without promptSpec runs as before and never asks the binding',
  r.res.status === 202 && bindingCalls.length === 0 && sends.length === 1 && !('promptSpec' in sends[0]) && !('createBody' in sends[0])
    && sends[0].body.prompt === 'a knight');

reset(); seedBalance(START);
r = await post({ promptSpec: SPEC });
check('generate: a Create with a spec the private side accepts is admitted, enqueued with the ids, and charged exactly as without (L4)',
  r.res.status === 202 && admissions() === 1 && plainCharge > 0 && START - balance() === plainCharge && sends.length === 1
    && JSON.stringify(sends[0].promptSpec) === JSON.stringify(SPEC));
check('generate: a spec\'d message carries createBody and no body, so older consumers cannot run it bare (M2)',
  !('body' in sends[0]) && sends[0].createBody?.prompt === 'a knight' && !JSON.stringify(sends[0]).includes('stub-adds'));
check('generate: the binding was asked once, with the style, the ids and the trimmed description',
  bindingCalls.length === 1 && bindingCalls[0].body.style === 'rd_plus__classic' && bindingCalls[0].body.description === 'a knight'
    && JSON.stringify(bindingCalls[0].body.promptSpec) === JSON.stringify(SPEC) && bindingCalls[0].url.endsWith('/create-words'));

{
  const bad = [null, 'platformer', [], {}, { card: 'platformer' }, { card: 'platformer', view: null, framing: null, x: 1 },
    { card: 'nope', view: null, framing: null }, { card: 'raw', view: 'side', framing: null }, { card: 'platformer', view: 'above', framing: null }];
  let ok = true;
  for (const s of bad) {
    reset(); seedBalance(START);
    const x = await post({ promptSpec: s });
    ok = ok && x.res.status === 400 && x.body?.error === 'create_spec_refused' && x.body?.reason === 'spec' && bindingCalls.length === 0 && nothingMoved();
  }
  check(`generate: a malformed spec (${bad.length} shapes) is refused 400 before the binding, the admission and the debit`, ok);
}

for (const reason of ['spec', 'description', 'framing_style', 'too_long']) {
  reset(okBinding({ reason })); seedBalance(START);
  r = await post({ promptSpec: SPEC });
  check(`generate: the private side refuses (${reason}): 400 with its message, nothing admitted, charged or sent`,
    r.res.status === 400 && r.body?.error === 'create_spec_refused' && r.body?.reason === reason
      && typeof r.body?.message === 'string' && r.body.message.endsWith('You were not charged.') && nothingMoved());
}

for (const [label, b] of [['missing', null], ['throws', okBinding({ throws: true })], ['answers 500', okBinding({ status: 500 })],
  ['answers non-JSON', okBinding({ raw: 'nope' })], ['answers an unknown reason', okBinding({ raw: '{"ok":false,"reason":"other"}' })],
  ['answers ok without a length', okBinding({ raw: '{"ok":true,"adds":"x"}' })]]) {
  reset(b); seedBalance(START);
  r = await post({ promptSpec: SPEC });
  check(`generate: a binding that is ${label}: 503, nothing admitted, charged or sent; the card is never dropped`,
    r.res.status === 503 && r.body?.error === 'create_words_unavailable' && nothingMoved());
}

reset(); seedBalance(START);
r = await post({ promptSpec: SPEC }, 'idem-create-words-replay');
const firstJob = r.body?.jobId;
binding = okBinding({ throws: true }); process.env.CREATE_WORDS = binding;
r = await post({ promptSpec: SPEC }, 'idem-create-words-replay');
check('generate: a repeat of an enqueued request is answered by the replay check, even with the binding down',
  r.res.status === 202 && r.body?.replayed === true && r.body?.jobId === firstJob && sends.length === 1);

reset(); seedBalance(START);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAQklEQVR42u3OMQEAAAgDoK1/aI3hBQnInHSA0NHS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLyARR6AAHdUo4hAAAAAElFTkSuQmCC';
r = await post({ mode: 'animate', style: undefined, prompt: undefined, inputImage: `data:image/png;base64,${PNG}`, action: 'idle', width: 64, height: 64, promptSpec: SPEC });
check('generate: an Animate request ignores promptSpec (G2 is Create only)',
  bindingCalls.length === 0 && sends.every((m) => !('promptSpec' in m)), { status: r.res.status, body: r.body });

reset(); seedBalance(START);
r = await post({ promptSpec: SPEC, prompt: 'a knight' });
const both = r.res.status === 400 && r.body?.reason === 'spec' && nothingMoved();
reset(); seedBalance(START);
r = await post({ promptSpec: SPEC, description: undefined });
check('generate: with a card, `prompt` is refused and `description` is required (M2)',
  both && r.res.status === 400 && r.body?.reason === 'spec' && bindingCalls.length === 0 && nothingMoved());
check('M2: a route without G2 refuses a spec\'d request before any money ("Prompt is required.")',
  CV.validateCreateBody({ description: 'a knight', promptSpec: SPEC, style: 'rd_plus__classic', width: 64, height: 64 }) === 'Prompt is required.');

reset(); seedBalance(START);
r = await post({ promptSpec: SPEC, wordsVersion: 'v-old' });
const changed = r.res.status === 409 && r.body?.error === 'create_words_changed' && r.body?.version === VERSION && nothingMoved();
reset(); seedBalance(START);
r = await post({ promptSpec: SPEC, wordsVersion: VERSION });
check('generate: the "Adds" line\'s version must match the service\'s, or 409 with nothing charged and the current version (L3, H1)', changed && r.res.status === 202);

reset(okBinding({ status: 413 })); seedBalance(START);
r = await post({ promptSpec: SPEC });
check('generate: the service\'s 413 reads as too long, 400, nothing charged (L2)', r.res.status === 400 && r.body?.reason === 'too_long' && nothingMoved());

reset(okBinding({ hang: true })); seedBalance(START);
{
  const t0 = Date.now();
  // AbortSignal.timeout's timer does not hold Node open; this one does.
  const keepAlive = setTimeout(() => {}, 10_000);
  r = await post({ promptSpec: SPEC });
  clearTimeout(keepAlive);
  const took = Date.now() - t0;
  check('generate: a binding that never answers is given up after its timeout: 503, nothing charged (L4)',
    r.res.status === 503 && nothingMoved() && took >= 2500 && took < 8000, { took });
}

reset(); seedBalance(START);
ledger.prepare("UPDATE control SET value = '1' WHERE key = 'money_pause'").run();
r = await post({ promptSpec: { card: 'nope', view: null, framing: null } });
const pausedBad = r.res.status === 400 && r.body?.reason === 'spec';
r = await post({ promptSpec: SPEC });
check('generate: under the money pause the spec check comes first (a bad spec is 400), then the pause refuses a good one; nothing charged (L4)',
  pausedBad && r.res.status !== 202 && r.res.status !== 400 && nothingMoved(), { status: r.res.status, body: r.body });

{
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const block = (envName) => (toml.match(new RegExp(`\\[\\[env\\.${envName}\\.services\\]\\][^\\[]*`)) ?? [''])[0];
  const ok = (b, service) => /binding\s*=\s*"CREATE_WORDS"/.test(b) && new RegExp(`service\\s*=\\s*"${service}"`).test(b) && /entrypoint\s*=\s*"CreateWords"/.test(b);
  check('wrangler.toml: CREATE_WORDS names the CreateWords entrypoint of the right service in production and preview (M3)',
    ok(block('production'), 'spritebrew-rd-consumer') && ok(block('preview'), 'spritebrew-rd-consumer-dev'));
}

// ── GET /api/create-words ──

const wordsReq = (q, auth = true) => new Request(`https://dev.spritebrew.pages.dev/api/create-words?${new URLSearchParams(q)}`, {
  headers: auth ? { Authorization: `Bearer ${tok}` } : {},
});
const get = async (q, auth) => { const res = await W.handleCreateWordsGet(wordsReq(q, auth)); let body = null; try { body = await res.clone().json(); } catch {} return { res, body }; };

reset(); W.resetCreateWordsRouteState();
r = await get({ style: 'rd_plus__classic', card: 'platformer' }, false);
check('words: signed out is 401 and never asks the binding', r.res.status === 401 && bindingCalls.length === 0);

{
  let ok = true;
  for (const q of [{ style: 'rd_nope', card: 'platformer' }, { style: 'rd_plus__classic', card: 'nope' }, { style: 'rd_plus__classic', card: 'platformer', view: 'above' },
    { style: 'rd_plus__classic', card: 'platformer', framing: 'full body' }, { style: 'rd_plus__classic', card: 'raw', view: 'side' }, { style: 'rd_plus__classic' }]) {
    const x = await get(q);
    ok = ok && x.res.status === 400;
  }
  check('words: a bad style or id is 400 and never asks the binding', ok && bindingCalls.length === 0);
}

r = await get({ style: 'rd_plus__classic', card: 'platformer', view: '', framing: '' });
check('words: an accepted spec answers the binding\'s words and version, and the browser keeps nothing (H1)',
  r.res.status === 200 && r.body?.success === true && r.body?.adds === ADDS && r.body?.version === VERSION
    && r.res.headers.get('cache-control') === 'no-store' && bindingCalls.length === 1 && !('description' in bindingCalls[0].body));
r = await get({ style: 'rd_plus__classic', card: 'platformer' });
check('words: the same ids again ask the binding again; nothing is kept in this isolate (H1)', r.body?.adds === ADDS && bindingCalls.length === 2);
binding = okBinding({ version: 'v-next' }); process.env.CREATE_WORDS = binding;
r = await get({ style: 'rd_plus__classic', card: 'platformer' });
check('words: a words change shows at the very next lookup (H1)', r.res.status === 200 && r.body?.version === 'v-next');

reset(okBinding({ reason: 'framing_style' })); W.resetCreateWordsRouteState();
r = await get({ style: 'rd_plus__classic', card: 'portrait', framing: 'waist' });
check('words: a refusal answers success false with its reason and version, kept by no one',
  r.res.status === 200 && r.body?.success === false && r.body?.reason === 'framing_style' && r.body?.version === VERSION && r.res.headers.get('cache-control') === 'no-store');

reset(okBinding({ throws: true })); W.resetCreateWordsRouteState();
r = await get({ style: 'rd_plus__classic', card: 'platformer' });
const firstDown = r.res.status === 503 && r.res.headers.get('cache-control') === 'no-store';
binding = okBinding(); process.env.CREATE_WORDS = binding;
r = await get({ style: 'rd_plus__classic', card: 'platformer' });
check('words: a failing binding is 503, not kept: the next lookup asks again', firstDown && r.res.status === 200 && r.body?.adds === ADDS);

reset(); W.resetCreateWordsRouteState();
{
  const views = [null, 'front', 'side', 'three_quarter', 'back', 'topdown'];
  const framings = [null, 'full', 'waist', 'head'];
  const styles = ['rd_plus__classic', 'rd_pro__default', 'rd_fast__retro', 'rd_pro__fantasy', 'rd_pro__platformer', 'rd_plus__low_res'];
  let last = null, statuses = [];
  outer: for (const style of styles) for (const card of ['platformer', 'topdown', 'portrait']) for (const view of views) for (const framing of framings) {
    const x = await get({ style, card, ...(view ? { view } : {}), ...(framing ? { framing } : {}) });
    statuses.push(x.res.status);
    if (statuses.length > W.RATE_LIMIT_PER_MINUTE) { last = x; break outer; }
  }
  check(`words: past ${W.RATE_LIMIT_PER_MINUTE} lookups a minute an account gets 429`,
    statuses.slice(0, W.RATE_LIMIT_PER_MINUTE).every((s) => s === 200) && last?.res.status === 429);
}

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
