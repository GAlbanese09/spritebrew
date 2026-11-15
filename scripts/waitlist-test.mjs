// scripts/waitlist-test.mjs
//
// Offline tests for /api/waitlist: a sign-up the store cannot fully save is
// answered as an error the page can show, never as a success; a retry finishes
// a half-saved sign-up; the export list is kept and never overwritten when it
// is not an array; and no log line on any path carries the email address.
// Run from the repo root: `node scripts/waitlist-test.mjs`. Writes only its
// esbuild bundle, to local/.waitlist-test (gitignored), and prints only case
// names and pass or fail. Every address here is made up.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.waitlist-test', 'route.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/app/api/waitlist/route.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'silent',
});
const { POST } = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

const EMAIL = 'Person.Test@Example.com';
const LOWER = EMAIL.toLowerCase();
const KEY = `waitlist:${LOWER}`;
const LIST = 'waitlist:__all_emails';
let failed = 0;
const lines = [];
const out = console.log.bind(console);
// inspect, not String or JSON.stringify: an Error or an object would hide an
// address inside it. Every console method is captured.
for (const k of ['log', 'warn', 'error', 'info', 'debug', 'trace']) {
  console[k] = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 10, breakLength: Infinity }))).join(' ')); };
}
const check = (name, ok) => { if (ok) out(`[waitlist-test] ok   ${name}`); else { failed++; out(`[waitlist-test] FAIL ${name}`); } };

// A stand-in store. Its errors name the key and value, so a route that logged a
// caught error would put the address in the log, and the tests would see it.
function memKV({ failPut = () => false, failGet = () => false } = {}) {
  const m = new Map();
  const puts = [];
  return {
    m, puts,
    async get(k) { if (failGet(k)) throw new Error(`get failed for ${k}`); return m.get(k) ?? null; },
    async put(k, v) { if (failPut(k)) throw new Error(`put failed for ${k} = ${v}`); puts.push(k); m.set(k, v); },
  };
}
const req = (raw) => new Request('https://x.test/api/waitlist', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof raw === 'string' ? raw : JSON.stringify(raw),
});
async function run(kv, body) {
  // A plain object: Node's own process.env turns every value into a string.
  process.env = { ...process.env };
  delete process.env.SPRITEBREW_KV;
  if (kv !== undefined) process.env.SPRITEBREW_KV = kv;
  const before = lines.length;
  const res = await POST(req(body));
  const json = await res.json();
  return { status: res.status, json, logged: lines.slice(before) };
}
const clean = (logged, ...addrs) => logged.every((l) => !l.includes('@') && [LOWER, ...addrs].every((a) => !l.toLowerCase().includes(a.toLowerCase().split('@')[0])));
const list = (kv) => JSON.parse(kv.m.get(LIST) ?? '[]');
const NOT_SAVED = (r) => r.status === 503 && r.json.success === false && typeof r.json.error === 'string' && r.json.error.length > 0;

// 1. Saved: 200, the record and the list as expected, nothing logged with the address.
{
  const kv = memKV();
  const r = await run(kv, { email: EMAIL });
  const rec = JSON.parse(kv.m.get(KEY) ?? '{}');
  check('saved: 200 success', r.status === 200 && r.json.success === true && r.json.stored === 'kv');
  check('saved: record holds the address, a time and the default source', rec.email === LOWER && !Number.isNaN(Date.parse(rec.joinedAt)) && rec.source === 'landing-page');
  check('saved: on the export list once', JSON.stringify(list(kv)) === JSON.stringify([LOWER]));
  check('saved: no address in logs', clean(r.logged));
}
// 2. Sources: a known one is kept; anything else is stored as 'other'.
{
  const a = memKV(); await run(a, { email: EMAIL, source: 'pixel_pass' });
  const b = memKV(); await run(b, { email: EMAIL, source: '<script>x</script>' });
  const c = memKV(); await run(c, { email: EMAIL, source: { a: 1 } });
  check('source: pixel_pass kept', JSON.parse(a.m.get(KEY)).source === 'pixel_pass');
  check('source: unknown text stored as other', JSON.parse(b.m.get(KEY)).source === 'other');
  check('source: a non-string stored as other', JSON.parse(c.m.get(KEY)).source === 'other');
}
// 3. Others already on the list are kept.
{
  const kv = memKV(); kv.m.set(LIST, JSON.stringify(['first.test@example.org']));
  const r = await run(kv, { email: EMAIL });
  check('list kept: 200 and both on the list', r.status === 200 && JSON.stringify(list(kv)) === JSON.stringify(['first.test@example.org', LOWER]));
}
// 4. No store: 503, an error the page shows, nothing logged with the address.
{
  const r = await run(undefined, { email: EMAIL });
  check('no store: 503 with an error', NOT_SAVED(r));
  check('no store: the outage line, once', r.logged.length === 1 && r.logged[0] === '[WAITLIST] store unavailable; sign-up not saved');
  check('no store: no address in logs', clean(r.logged));
}
// 5. Every write fails, or every read fails: 503, nothing logged with the address.
{
  const w = await run(memKV({ failPut: () => true }), { email: EMAIL });
  check('writes fail: 503', NOT_SAVED(w));
  check('writes fail: no address in logs', clean(w.logged));
  const g = await run(memKV({ failGet: () => true }), { email: EMAIL });
  check('reads fail: 503', NOT_SAVED(g));
  check('reads fail: no address in logs', clean(g.logged));
}
// 6. Half saved: the record is written, the list write fails. 503; a retry with
//    the store back answers 200 and puts the address on the list.
{
  let listDown = true;
  const kv = memKV({ failPut: (k) => listDown && k === LIST });
  const r1 = await run(kv, { email: EMAIL });
  check('half saved: 503', NOT_SAVED(r1));
  check('half saved: record written, not on the list', kv.m.has(KEY) && !list(kv).includes(LOWER));
  check('half saved: no address in logs', clean(r1.logged));
  listDown = false;
  const r2 = await run(kv, { email: EMAIL });
  check('half saved, retry: 200 and on the list once', r2.status === 200 && JSON.stringify(list(kv)) === JSON.stringify([LOWER]));
  check('half saved, retry: no address in logs', clean(r2.logged));
}
// 7. The list read fails after the record write: 503; the retry finishes it.
{
  let down = true;
  const kv = memKV({ failGet: (k) => down && k === LIST });
  const r1 = await run(kv, { email: EMAIL });
  down = false;
  const r2 = await run(kv, { email: EMAIL });
  check('list read fails: 503, then 200 on the list', NOT_SAVED(r1) && r2.status === 200 && list(kv).includes(LOWER));
  check('list read fails: no address in logs', clean([...r1.logged, ...r2.logged]));
}
// 8. A list value that is not an array, or not JSON: the record is saved, the
//    answer is a success, the list is left as it was, and its own fixed line is
//    written once (not the outage line), for a new sign-up and one already joined.
const LIST_LINE = '[WAITLIST] export list unreadable; record saved, list not updated';
for (const bad of ['{"a":1}', 'not json', '"text"']) {
  const kv = memKV(); kv.m.set(LIST, bad);
  const r = await run(kv, { email: EMAIL });
  check(`list ${JSON.stringify(bad)}: 200, record saved, list left as it was`, r.status === 200 && r.json.success === true && kv.m.has(KEY) && kv.m.get(LIST) === bad);
  check(`list ${JSON.stringify(bad)}: its own line, once`, r.logged.length === 1 && r.logged[0] === LIST_LINE);
  check(`list ${JSON.stringify(bad)}: no address in logs`, clean(r.logged));
  const again = await run(kv, { email: EMAIL });
  check(`list ${JSON.stringify(bad)}, already joined: 200, list left as it was`, again.status === 200 && kv.m.get(LIST) === bad && again.logged.length === 1 && again.logged[0] === LIST_LINE);
}
// 9. Already joined: 200, the record kept as it was.
{
  const kv = memKV(); kv.m.set(KEY, '{"x":1}'); kv.m.set(LIST, JSON.stringify([LOWER]));
  const r = await run(kv, { email: EMAIL });
  check('already joined: 200, record kept, nothing written', r.status === 200 && kv.m.get(KEY) === '{"x":1}' && kv.puts.length === 0);
  check('already joined: no address in logs', clean(r.logged));
}
// 10. Already joined but missing from the list (an earlier half save): added.
{
  const kv = memKV(); kv.m.set(KEY, '{"x":1}');
  const r = await run(kv, { email: EMAIL });
  check('joined, not listed: 200 and now on the list', r.status === 200 && JSON.stringify(list(kv)) === JSON.stringify([LOWER]) && kv.m.get(KEY) === '{"x":1}');
}
// 11. Requests the route refuses: 400, nothing stored, nothing logged with the address.
{
  const long = 'a'.repeat(255 - '@example.com'.length) + '@example.com';
  const fits = 'b'.repeat(254 - '@example.com'.length) + '@example.com';
  const wide = 'é'.repeat(130) + '@example.com';
  const cases = [
    ['an invalid address', { email: 'not-an-address' }],
    ['an address over 254 bytes', { email: long }],
    ['an address over 254 bytes in UTF-8', { email: wide }],
    ['a number for the address', { email: 12345 }],
    ['no address', { source: 'pixel_pass' }],
    ['a body that is null', 'null'],
    ['a body that is text', '"person.test@example.com"'],
    ['a body that is not JSON', '{'],
  ];
  for (const [name, body] of cases) {
    const kv = memKV();
    const r = await run(kv, body);
    check(`refused, ${name}: 400, nothing stored`, r.status === 400 && r.json.success === false && kv.m.size === 0);
    check(`refused, ${name}: no address in logs`, clean(r.logged, long, wide));
  }
  const kv = memKV();
  const r = await run(kv, { email: fits });
  check('an address of exactly 254 bytes: 200', r.status === 200 && kv.m.has(`waitlist:${fits}`));
}

out(`[waitlist-test] ${failed === 0 ? 'all passed' : `${failed} failed`}`);
process.exit(failed === 0 ? 0 : 1);
