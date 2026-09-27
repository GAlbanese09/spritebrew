// scripts/auth-verify-test.mjs
//
// Offline tests for the session-token check (auth-verify.md 003, ruling 4 of
// second-02.md 008). Run from the repo root: `node scripts/auth-verify-test.mjs`.
//
// Keys are generated in memory for this run only; no key, token or fixture is
// written anywhere or printed. Each protected route is bundled with esbuild
// into local/.auth-test/ (gitignored), then called with every binding and
// global fetch replaced by counting stubs, so an invalid token can be shown to
// cause zero store, queue and provider calls. Output: case names and pass or
// fail only.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const subtle = webcrypto.subtle;
// src/lib/stripe.ts builds its client at module load; a placeholder, not a secret.
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_secret';
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.auth-test');

// ── Keys and tokens (in memory only) ──

async function makeKey() {
  const pair = await subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const spki = Buffer.from(await subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  return { pair, pem };
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const enc = (obj) => b64u(Buffer.from(JSON.stringify(obj)));

async function sign(key, header, payload) {
  const input = `${enc(header)}.${enc(payload)}`;
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key.pair.privateKey, Buffer.from(input));
  return `${input}.${b64u(sig)}`;
}

async function hs256(secret, header, payload) {
  const input = `${enc(header)}.${enc(payload)}`;
  const k = await subtle.importKey('raw', Buffer.from(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${input}.${b64u(await subtle.sign('HMAC', k, Buffer.from(input)))}`;
}

const ISS = { production: 'https://clerk.spritebrew.com', dev: 'https://needed-blowfish-74.clerk.accounts.dev' };
const AZP = { production: 'https://spritebrew.com', dev: 'https://dev.spritebrew.pages.dev' };
const KID = { production: 'test_kid_production', dev: 'test_kid_dev' };

function claims(env, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const c = { iss: ISS[env], sub: 'user_TESTTESTTESTTESTTESTTESTTEST', sid: 'sess_test', azp: AZP[env],
    iat: now - 10, nbf: now - 10, exp: now + 60, ...over };
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return c;
}
const hdr = (env, over = {}) => ({ alg: 'RS256', typ: 'JWT', kid: KID[env], ...over });

// ── Stubs that count every call ──

let calls = [];
const rec = (name) => (...args) => { calls.push(name); return undefined; };
function kvStub() {
  return {
    get: async () => { calls.push('kv.get'); return null; },
    getWithMetadata: async () => { calls.push('kv.getWithMetadata'); return { value: null, metadata: null }; },
    put: async () => { calls.push('kv.put'); },
    delete: async () => { calls.push('kv.delete'); },
    list: async () => { calls.push('kv.list'); return { keys: [], list_complete: true }; },
  };
}
function r2Stub() {
  return {
    get: async () => { calls.push('r2.get'); return null; },
    head: async () => { calls.push('r2.head'); return null; },
    put: async () => { calls.push('r2.put'); return {}; },
    delete: async () => { calls.push('r2.delete'); },
    list: async () => { calls.push('r2.list'); return { objects: [], truncated: false }; },
  };
}
function d1Stub() {
  const stmt = { bind: () => stmt, first: async () => { calls.push('d1.first'); return null; },
    all: async () => { calls.push('d1.all'); return { results: [] }; }, run: async () => { calls.push('d1.run'); return {}; } };
  return { prepare: () => { calls.push('d1.prepare'); return stmt; }, batch: async () => { calls.push('d1.batch'); return []; } };
}

function setEnv(appEnv, key, kid) {
  process.env = {
    ...process.env,
    STRIPE_SECRET_KEY: 'sk_test_placeholder_not_a_secret',
    ...(appEnv ? { APP_ENV: appEnv } : { APP_ENV: undefined }),
    ...(key ? { CLERK_JWT_KEY: key } : { CLERK_JWT_KEY: undefined }),
    ...(kid ? { CLERK_JWT_KID: kid } : { CLERK_JWT_KID: undefined }),
  };
  for (const k of ['APP_ENV', 'CLERK_JWT_KEY', 'CLERK_JWT_KID']) if (process.env[k] === undefined) delete process.env[k];
  Object.assign(process.env, {
    SPRITEBREW_KV: kvStub(), GALLERY_BUCKET: r2Stub(), EVENTS_DB: d1Stub(),
    RD_QUEUE: { send: async () => { calls.push('queue.send'); } },
    QUEUE_KICKOFF_ENABLED: 'true', RESEND_API_KEY: 'placeholder', RESEND_AUDIENCE_ID: 'placeholder',
    CLERK_SECRET_KEY: 'placeholder',
  });
}
globalThis.fetch = async () => { calls.push('fetch'); return new Response('{}', { status: 503 }); };
let warnings = [];
console.warn = (line) => { warnings.push(String(line)); };
console.error = () => {};
console.log = ((orig) => (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[auth-test]')) orig(...a.map((x) => typeof x === 'string' ? x.replace('[auth-test] ', '') : x)); })(console.log);
const say = (...a) => console.log('[auth-test]', ...a);

// ── Bundle the helper and the eleven route files ──

const ROUTES = [
  ['account/daily-reward', 'POST'], ['account/email-list', 'POST'], ['admin/r2-smoke', 'GET'],
  ['gallery/[jobId]', 'DELETE'], ['gallery/image/[jobId]', 'GET'], ['gallery', 'GET'], ['gallery', 'DELETE'],
  ['generate', 'POST'], ['generation-limit', 'GET'], ['generation-status/[jobId]', 'GET'],
  ['stripe/checkout', 'POST'], ['token-balance', 'GET'],
];
const files = [...new Set(ROUTES.map(([r]) => r))];
const entryPoints = { edgeAuth: path.join(ROOT, 'src/lib/edgeAuth.ts') };
for (const r of files) entryPoints[r.replace(/[\/\[\]]/g, '_')] = path.join(ROOT, 'src/app/api', r, 'route.ts');
await build({
  entryPoints, bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  // Keep Next external; Node's ESM loader needs the file extension.
  plugins: [{ name: 'next-external', setup(b) {
    b.onResolve({ filter: /^next(\/.*)?$/ }, (a) => ({ path: a.path === 'next' ? 'next' : `${a.path}.js`, external: true }));
  } }],
});
const load = async (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const auth = await load('edgeAuth');
const mods = {};
for (const r of files) mods[r] = await load(r.replace(/[\/\[\]]/g, '_'));

// ── Cases ──

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; say('FAIL', name); } };
const req = (token, method = 'GET') => new Request('https://example.test/api/x', {
  method, headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  body: method === 'GET' ? undefined : JSON.stringify({ packId: 'starter', prompt: 'x', style: 'rd_fast__default', idempotencyKey: 'abcdefgh1234', consent: true }),
});

const prod = await makeKey();
const dev = await makeKey();
const now = Math.floor(Date.now() / 1000);

// Helper-level contract, production configuration.
setEnv('production', prod.pem, KID.production);
const valid = await sign(prod, hdr('production'), claims('production'));
const helperCases = {
  'valid token accepted': [valid, 'ok'],
  'no Authorization header': [undefined, 'missing'],
  'Bearer null': ['null', 'empty'],
  'payload sub edited after signing': [(() => { const [h, , s] = valid.split('.'); return `${h}.${enc(claims('production', { sub: 'user_SOMEONEELSESOMEONEELSEABC' }))}.${s}`; })(), 'invalid'],
  'unsigned (alg none)': [`${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims('production'))}.`, 'invalid'],
  'wrong kid': [await sign(prod, hdr('production', { kid: 'other' }), claims('production')), 'invalid'],
  'wrong issuer (dev issuer, prod key)': [await sign(prod, hdr('production'), claims('production', { iss: ISS.dev })), 'invalid'],
  'azp missing': [await sign(prod, hdr('production'), claims('production', { azp: undefined })), 'invalid'],
  'azp empty': [await sign(prod, hdr('production'), claims('production', { azp: '' })), 'invalid'],
  'azp wrong (dev origin)': [await sign(prod, hdr('production'), claims('production', { azp: AZP.dev })), 'invalid'],
  'azp wildcard-looking': [await sign(prod, hdr('production'), claims('production', { azp: 'https://evil.spritebrew.com' })), 'invalid'],
  'sub missing': [await sign(prod, hdr('production'), claims('production', { sub: undefined })), 'invalid'],
  'sub empty': [await sign(prod, hdr('production'), claims('production', { sub: '' })), 'invalid'],
  'sid missing': [await sign(prod, hdr('production'), claims('production', { sid: undefined })), 'invalid'],
  'sid empty': [await sign(prod, hdr('production'), claims('production', { sid: '' })), 'invalid'],
  'exp as string': [await sign(prod, hdr('production'), claims('production', { exp: String(now + 60) })), 'invalid'],
  'nbf missing': [await sign(prod, hdr('production'), claims('production', { nbf: undefined })), 'invalid'],
  'exp 4 s ago (inside 5 s skew)': [await sign(prod, hdr('production'), claims('production', { exp: now - 4 })), 'ok'],
  'exp 7 s ago (outside skew)': [await sign(prod, hdr('production'), claims('production', { exp: now - 7 })), 'expired'],
  'nbf 3 s ahead (inside skew)': [await sign(prod, hdr('production'), claims('production', { nbf: now + 3 })), 'ok'],
  'nbf 8 s ahead (outside skew)': [await sign(prod, hdr('production'), claims('production', { nbf: now + 8 })), 'invalid'],
  'dev token under production config': [await sign(dev, hdr('dev', { kid: KID.production }), claims('dev')), 'invalid'],
  'malformed (two parts)': ['abc.def', 'invalid'],
};
helperCases['HS256 with the public PEM as secret'] = [await hs256(prod.pem, { alg: 'HS256', typ: 'JWT', kid: KID.production }, claims('production')), 'invalid'];
for (const [name, [token, expect]] of Object.entries(helperCases)) {
  warnings = [];
  const r = await auth.getAuthedUserId(req(token));
  const azpLogged = warnings.some((w) => w.includes('"azp_missing"'));
  check(`helper: ${name} -> azp_missing logged only when azp is absent or empty`,
    azpLogged === (name === 'azp missing' || name === 'azp empty'));
  const got = 'userId' in r ? 'ok' : r.reason;
  check(`helper: ${name} -> ${expect}`, got === expect && (expect !== 'ok' || r.userId === 'user_TESTTESTTESTTESTTESTTESTTEST'));
}

// Each environment's key rejected by the other, and the dev configuration accepting its own.
setEnv('dev', dev.pem, KID.dev);
check('helper: dev token under dev config -> ok', 'userId' in await auth.getAuthedUserId(req(await sign(dev, hdr('dev'), claims('dev')))));
check('helper: production token under dev config -> invalid', !('userId' in await auth.getAuthedUserId(req(valid))));

// Missing or bad configuration fails closed.
for (const [label, e] of [['no CLERK_JWT_KEY', ['production', null, null]], ['APP_ENV unset', [null, prod.pem, null]],
  ['APP_ENV "preview"', ['preview', prod.pem, null]], ['wrong PEM', ['production', dev.pem, null]]]) {
  setEnv(...e);
  check(`helper: ${label} -> rejected`, !('userId' in await auth.getAuthedUserId(req(valid))));
}

// All twelve handlers: invalid authentication answers 401 with zero store, queue and provider calls.
setEnv('production', prod.pem, KID.production);
const badTokens = {
  'no header': undefined,
  'forged sub': helperCases['payload sub edited after signing'][0],
  'unsigned': helperCases['unsigned (alg none)'][0],
  'wrong issuer': helperCases['wrong issuer (dev issuer, prod key)'][0],
  'azp missing': helperCases['azp missing'][0],
  'expired': helperCases['exp 7 s ago (outside skew)'][0],
  'dev token': helperCases['dev token under production config'][0],
};
const ctx = { params: Promise.resolve({ jobId: 'abcdef0123456789abcdef0123456789' }) };
for (const [route, method] of ROUTES) {
  const handler = mods[route][method];
  if (typeof handler !== 'function') { check(`${method} ${route}: handler exported`, false); continue; }
  for (const [label, token] of Object.entries(badTokens)) {
    calls = [];
    const res = await handler(req(token, method), ctx);
    check(`${method} ${route}: ${label} -> 401, no calls`, res.status === 401 && calls.length === 0);
  }
  // Missing configuration on the same handler.
  setEnv('production', null, null);
  calls = [];
  const resCfg = await handler(req(valid, method), ctx);
  check(`${method} ${route}: missing config -> 401, no calls`, resCfg.status === 401 && calls.length === 0);
  setEnv('production', prod.pem, KID.production);
  // A valid token gets past authentication (whatever the stubbed downstream then answers).
  calls = [];
  let status;
  try { status = (await handler(req(valid, method), ctx)).status; } catch { status = 'threw'; }
  check(`${method} ${route}: valid token -> not 401`, status !== 401);
}

say(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
