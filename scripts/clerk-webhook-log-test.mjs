// scripts/clerk-webhook-log-test.mjs
//
// Offline tests for /api/clerk/webhook: a flagged disposable sign-up is still
// flagged, and no log line on any path carries the user's id or email address.
// Signs made-up `user.created` events with a test secret made here (not a real
// secret). Run from the repo root: `node scripts/clerk-webhook-log-test.mjs`.
// Writes only its esbuild bundle, to local/.clerk-webhook-log-test (gitignored),
// and prints only case names and pass or fail.

import { build } from 'esbuild';
import { webcrypto, randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

process.removeAllListeners('warning');
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.clerk-webhook-log-test', 'route.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/app/api/clerk/webhook/route.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});

const lines = [];
const say = console.log.bind(console);
for (const k of ['log', 'warn', 'error', 'info', 'debug']) {
  // inspect, not JSON.stringify: an Error stringifies as {} and would hide an id inside it.
  console[k] = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 10, breakLength: Infinity }))).join(' ')); };
}
const { POST } = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

const TEST_SECRET = 'whsec_' + randomBytes(24).toString('base64');
const USER_ID = 'user_TESTONLY9x7q2';
const DISPOSABLE = 'someone.test@mailinator.com';
const ORDINARY = 'someone.test@example.org';
const FLAG_LINE = '[Clerk Webhook] Flagged disposable email signup';

let failed = 0;
const check = (name, ok) => { if (ok) say(`[clerk-webhook-log-test] ok   ${name}`); else { failed++; say(`[clerk-webhook-log-test] FAIL ${name}`); } };

function memKV() {
  const m = new Map();
  return { m, async get(k) { return m.get(k) ?? null; }, async put(k, v) { m.set(k, v); },
    async getWithMetadata(k) { return { value: m.get(k) ?? null, metadata: null }; }, async delete(k) { m.delete(k); } };
}
function env(kv) {
  // A plain object: Node's own process.env turns every value into a string.
  process.env = { ...process.env, CLERK_WEBHOOK_SECRET: TEST_SECRET };
  delete process.env.SPRITEBREW_KV;
  if (kv) process.env.SPRITEBREW_KV = kv;
}
async function sign(body, id, ts) {
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(TEST_SECRET.slice(6), 'base64'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  return `v1,${Buffer.from(mac).toString('base64')}`;
}
function event(email) {
  return JSON.stringify({ type: 'user.created', data: { id: USER_ID, primary_email_address_id: 'idn_1',
    email_addresses: [{ id: 'idn_1', email_address: email }] } });
}
async function call(body, { badSig = false, headers = true } = {}) {
  const id = 'msg_test_1', ts = String(Math.floor(Date.now() / 1000));
  const h = { 'Content-Type': 'application/json' };
  if (headers) Object.assign(h, { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': badSig ? 'v1,AAAA' : await sign(body, id, ts) });
  const before = lines.length;
  const res = await POST(new Request('https://x.test/api/clerk/webhook', { method: 'POST', headers: h, body }));
  return { status: res.status, logged: lines.slice(before) };
}
const clean = (logged) => logged.every((l) => !l.includes(USER_ID) && !l.toLowerCase().includes('someone.test') && !l.includes('@'));

// 1. A disposable sign-up: flagged, 200, exactly the fixed line, nothing identifying.
{
  const kv = memKV(); env(kv);
  const r = await call(event(DISPOSABLE));
  check('disposable: 200', r.status === 200);
  check('disposable: flag stored', kv.m.get(`disposable_blocked:${USER_ID}`) === 'true');
  check('disposable: the fixed line, once', r.logged.filter((l) => l === FLAG_LINE).length === 1);
  check('disposable: no id or address in any line', clean(r.logged));
}
// 2. An ordinary sign-up: 200, no flag, nothing identifying.
{
  const kv = memKV(); env(kv);
  const r = await call(event(ORDINARY));
  check('ordinary: 200 and no flag', r.status === 200 && !kv.m.has(`disposable_blocked:${USER_ID}`));
  check('ordinary: no id or address in any line', clean(r.logged));
}
// 3. A bad signature: 401, no flag, nothing identifying.
{
  const kv = memKV(); env(kv);
  const r = await call(event(DISPOSABLE), { badSig: true });
  check('bad signature: 401 and no flag', r.status === 401 && kv.m.size === 0);
  check('bad signature: no id or address in any line', clean(r.logged));
}
// 4. Missing Svix headers: 400.
{
  env(memKV());
  const r = await call(event(DISPOSABLE), { headers: false });
  check('missing headers: 400', r.status === 400);
}
// 5. No store: nothing identifying in any line (the flag cannot be stored).
{
  env(null);
  const r = await call(event(DISPOSABLE));
  check('no store: no id or address in any line', clean(r.logged));
}

say(`[clerk-webhook-log-test] ${failed === 0 ? 'all passed' : `${failed} failed`}`);
process.exit(failed === 0 ? 0 : 1);
