// scripts/gallery-delete-test.mjs
//
// Offline tests for the Gallery's two delete routes, DELETE /api/gallery
// (delete everything, in batches) and DELETE /api/gallery/[jobId] (one entry):
// no picture and no job status copy is ever left in storage without its index
// entry, whatever call fails; a request stays well under Cloudflare's
// per-request call limit; the answer (deleted, remaining, done, cursor) is
// right in every path; a retry finishes what a stopped request left; and
// another account's entries, pictures and job copies are never touched.
//
// Stand-in KV and R2 count every call and fail on cue, and can lag, return
// short pages, drop a cursor, ignore the prefix after a cursor, or fail an R2
// call part-way. The sign-in check is replaced by one that reads a made-up
// account id from a test header. Run from the repo root:
// `node scripts/gallery-delete-test.mjs`. Writes only its esbuild bundles, to
// local/.gallery-delete-test (gitignored), and prints only case names and
// pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.gallery-delete-test');

// The sign-in check, replaced: the account is the x-test-user header.
const authStub = {
  name: 'auth-stub',
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/edgeAuth$/ }, () => ({ path: 'edgeAuth', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `export async function getAuthedUserId(request) {
        const u = request.headers.get('x-test-user');
        return u ? { userId: u } : { error: 'Sign in again.', status: 401, reason: 'missing' };
      }`,
      loader: 'js',
    }));
  },
};
async function bundle(entry, name) {
  const outfile = path.join(OUT, `${name}.mjs`);
  await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'silent',
    alias: { '@': path.join(ROOT, 'src') },
    plugins: [authStub],
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}
const all = await bundle('src/app/api/gallery/route.ts', 'all');
const one = await bundle('src/app/api/gallery/[jobId]/route.ts', 'one');

const out = console.log.bind(console);
// The routes' log lines, kept to check that none carries an id or a cursor.
const logs = [];
for (const k of ['log', 'warn', 'error', 'info', 'debug']) {
  console[k] = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 10 }))).join(' ')); };
}
const cursorsSeen = new Set();

let failed = 0;
const check = (name, ok) => { if (ok) out(`pass  ${name}`); else { failed++; out(`FAIL  ${name}`); } };

const A = 'user_TESTONLYaaaa';
const B = 'user_TESTONLYbbbb';
const MAX = Number.MAX_SAFE_INTEGER;
const PER_CALL = 3400;   // 34 batches of 100
const CALL_LIMIT = 10_000;

// A sorted, cursor-paged KV with metadata, and an R2 bucket. Both count calls;
// fail.<kind> = n makes the n-th call of that kind throw (1-based).
function world({ staleLists = false, shortPages = 0, dropCursorOnce = false, cursorIgnoresPrefix = false, r2Partial = false } = {}) {
  const kv = new Map();       // name -> metadata
  const r2 = new Set();       // object keys
  const owner = new Map();    // jobId -> account
  // KV lists lag behind deletes (up to about a minute): with staleLists,
  // deleted names keep showing in lists for the rest of the case.
  const ghosts = new Map();
  const calls = { list: 0, kvDelete: 0, r2Delete: 0, r2Keys: [] };
  const fail = { list: 0, kvDelete: 0, r2Delete: 0 };
  let dropped = false;
  const enc = (n) => Buffer.from(n).toString('base64');
  const dec = (c) => Buffer.from(c, 'base64').toString();
  const store = {
    async list({ prefix = '', limit = 1000, cursor }) {
      calls.list++;
      if (fail.list && calls.list === fail.list) throw new Error('list failed');
      const usePrefix = cursorIgnoresPrefix && cursor ? '' : prefix;
      const names = [...new Set([...kv.keys(), ...ghosts.keys()])].filter((n) => n.startsWith(usePrefix)).sort();
      const after = cursor ? dec(cursor) : null;
      const from = after === null ? 0 : names.findIndex((n) => n > after);
      const start = from < 0 ? names.length : from;
      const size = shortPages ? Math.min(limit, shortPages) : limit;
      const page = names.slice(start, start + size);
      const complete = start + size >= names.length;
      const res = { keys: page.map((name) => ({ name, metadata: kv.get(name) ?? ghosts.get(name) })), list_complete: complete };
      if (!complete) {
        if (dropCursorOnce && !dropped) { dropped = true; return res; }
        res.cursor = enc(page[page.length - 1]);
      }
      return res;
    },
    async delete(name) {
      calls.kvDelete++;
      if (fail.kvDelete && calls.kvDelete === fail.kvDelete) throw new Error(`delete failed: ${name}`);
      if (staleLists && kv.has(name)) ghosts.set(name, kv.get(name));
      kv.delete(name);
    },
  };
  const bucket = {
    async delete(keys) {
      calls.r2Delete++;
      const list = Array.isArray(keys) ? keys : [keys];
      calls.r2Keys.push(list.length);
      if (list.length > 1000) throw new Error('R2 takes at most 1000 keys a call');
      if (fail.r2Delete && calls.r2Delete === fail.r2Delete) {
        // A part-failed call: some keys go, then it throws.
        if (r2Partial) for (const k of list.slice(0, Math.ceil(list.length / 2))) r2.delete(k);
        throw new Error('r2 failed');
      }
      for (const k of list) r2.delete(k);
    },
  };
  let t = 1_800_000_000_000;
  const entry = (user, jobId, { malformed = false, nameJob = jobId } = {}) => {
    const name = `gen:${user}:${String(MAX - t++).padStart(16, '0')}:${nameJob}`;
    kv.set(name, malformed ? { prompt: 'x' } : { jobId, prompt: 'x', style: 's', mode: 'create', createdAt: t, v: 1 });
    for (const j of new Set([jobId, nameJob])) { r2.add(`${user}/${j}.png`); r2.add(`jobs/${j}.json`); owner.set(j, user); }
    return name;
  };
  const add = (user, n, { malformed = 0 } = {}) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const jobId = `${user.slice(-4)}${String(ids.length + kv.size).padStart(6, '0')}`;
      entry(user, jobId, { malformed: i < malformed });
      ids.push(jobId);
    }
    return ids;
  };
  const indexedJobs = (user) => {
    const s = new Set();
    for (const [n, md] of kv) if (n.startsWith(`gen:${user}:`)) { s.add(n.split(':').pop()); if (md && md.jobId) s.add(md.jobId); }
    return s;
  };
  const indexed = (user) => [...kv.keys()].filter((n) => n.startsWith(`gen:${user}:`)).length;
  const pictures = (user) => [...r2].filter((k) => k.startsWith(`${user}/`)).length;
  const copies = (user) => [...r2].filter((k) => k.startsWith('jobs/') && owner.get(k.slice(5, -5)) === user).length;
  // The rule: every picture and every job copy of the account still stored has its index entry.
  const noOrphans = (user) => {
    const live = indexedJobs(user);
    return [...r2].every((k) => {
      if (k.startsWith(`${user}/`)) return live.has(k.slice(user.length + 1, -4));
      if (k.startsWith('jobs/') && owner.get(k.slice(5, -5)) === user) return live.has(k.slice(5, -5));
      return true;
    });
  };
  const reset = () => { calls.list = 0; calls.kvDelete = 0; calls.r2Delete = 0; calls.r2Keys = []; };
  return { kv, r2, calls, fail, store, bucket, add, entry, indexed, pictures, copies, noOrphans, reset };
}

function bind(w, { noKv = false, noBucket = false } = {}) {
  process.env = { ...process.env };
  delete process.env.SPRITEBREW_KV; delete process.env.GALLERY_BUCKET;
  if (!noKv) process.env.SPRITEBREW_KV = w.store;
  if (!noBucket) process.env.GALLERY_BUCKET = w.bucket;
}
const callsOf = (w) => w.calls.list + w.calls.kvDelete + w.calls.r2Delete;

async function delAll(w, user, cursor, opts, query = '') {
  bind(w, opts);
  w.reset();
  const url = `https://x.test/api/gallery${cursor ? `?cursor=${encodeURIComponent(cursor)}` : query}`;
  const res = await all.DELETE(new Request(url, { method: 'DELETE', headers: user ? { 'x-test-user': user } : {} }));
  const json = await res.json();
  if (cursor) cursorsSeen.add(cursor);
  if (typeof json.cursor === 'string') cursorsSeen.add(json.cursor);
  return { status: res.status, json, calls: callsOf(w) };
}
async function delOne(w, user, jobId, query = '') {
  bind(w);
  w.reset();
  const res = await one.DELETE(new Request(`https://x.test/api/gallery/${jobId}${query}`, { method: 'DELETE', headers: { 'x-test-user': user } }), { params: { jobId } });
  return { status: res.status, json: await res.json() };
}
// The page's loop: call again with the answer's cursor until done.
async function loop(w, user, cursor, max = 20) {
  let total = 0; let maxCalls = 0; let n = 0; let last;
  do {
    last = await delAll(w, user, cursor);
    if (last.status === 200) total += last.json.deleted;
    cursor = last.json.cursor ?? null; maxCalls = Math.max(maxCalls, last.calls); n++;
  } while (!(last.status === 200 && last.json.done) && n < max);
  return { total, maxCalls, n, last };
}
const allGone = (w, user) => w.indexed(user) === 0 && w.pictures(user) === 0 && w.copies(user) === 0;
const untouched = (w, user, n) => w.indexed(user) === n && w.pictures(user) === n && w.copies(user) === n;

// 1. Sizes: one call answers as documented; the loop clears everything; every
//    request under the call limit, every R2 call at most 1,000 keys; B untouched.
for (const n of [0, 1, 100, 101, 178, 3400, 3401, 7500]) {
  const w = world();
  w.add(A, n); w.add(B, 7);
  const first = await delAll(w, A);
  const k = Math.min(n, PER_CALL);
  check(`${n} entries: one call deletes ${k}, says ${n - k} remain, done ${n <= PER_CALL}`,
    first.status === 200 && first.json.deleted === k && first.json.remaining === n - k && first.json.done === (n <= PER_CALL)
    && (n <= PER_CALL ? first.json.cursor === null : typeof first.json.cursor === 'string'));
  check(`${n} entries: the first call makes ${first.calls} storage calls, under ${CALL_LIMIT}`, first.calls < CALL_LIMIT && first.calls <= Math.ceil(k / 100) * 2 + k + Math.ceil((n - k) / 1000) + 1);
  const rest = first.json.done ? { total: 0, maxCalls: 0 } : await loop(w, A, first.json.cursor);
  check(`${n} entries: the loop clears every entry, picture and job copy`, allGone(w, A) && first.json.deleted + rest.total === n);
  check(`${n} entries: every request under the limit, every R2 call at most 1,000 keys`, rest.maxCalls < CALL_LIMIT && w.calls.r2Keys.every((x) => x <= 1000));
  check(`${n} entries: account B untouched`, untouched(w, B, 7));
}

// 2. Today's page calls once and reads nothing back: 178 and 3,400 are cleared by that one call.
for (const n of [178, 3400]) {
  const w = world(); w.add(A, n);
  const r = await delAll(w, A);
  check(`one call, as today's page makes it: ${n} cleared`, r.status === 200 && allGone(w, A));
}

// 3. Calling again from the start (no cursor) also finishes.
{
  const w = world(); w.add(A, 7500);
  let n = 0; let r;
  do { r = await delAll(w, A); n++; } while (!r.json.done && n < 10);
  check('no cursor, called again from the start: finishes in 3 calls', r.json.done === true && n === 3 && allGone(w, A));
}

// 4. Lists that lag behind deletes: following the answer's cursor still
//    finishes in 3 calls for 7,500 entries, each deleting new entries.
{
  const w = world({ staleLists: true }); w.add(A, 7500);
  let cursor = null; let n = 0; let r; const perCall = []; const remainingSeen = [];
  do { r = await delAll(w, A, cursor); cursor = r.json.cursor; perCall.push(r.json.deleted); remainingSeen.push(r.json.remaining); n++; } while (!r.json.done && n < 10);
  check('lists that lag: the cursor loop finishes in 3 calls, 3400, 3400, 700', n === 3 && perCall.join(',') === '3400,3400,700' && allGone(w, A));
  check('lists that lag: remaining counted from the cursor, 4100 then 700 then 0', remainingSeen.join(',') === '4100,700,0');
}

// 5. Short pages (37 names a list) still finish, under the limit, with the rule kept.
{
  const w = world({ shortPages: 37 }); w.add(A, 250); w.add(B, 3);
  const r = await loop(w, A, null);
  check('short pages: the loop finishes, B untouched', r.last.json.done === true && allGone(w, A) && untouched(w, B, 3) && r.maxCalls < CALL_LIMIT);
}

// 6. A failure at every point of a 250-entry clear: 503 with the right body,
//    no picture or job copy left without its entry, and a retry finishes.
for (const [kind, points, opts] of [
  ['list', [1, 2, 3], {}],
  ['r2Delete', [1, 2, 3], {}],
  ['r2Delete', [1, 2, 3], { r2Partial: true }],
  ['kvDelete', [1, 50, 100, 101, 150, 201, 250], {}],
]) {
  for (const at of points) {
    const label = `${kind}${opts.r2Partial ? ' (part-way)' : ''} fails at call ${at}`;
    const w = world(opts); w.add(A, 250); w.add(B, 3);
    w.fail[kind] = at;
    const before = w.indexed(A);
    const r = await delAll(w, A);
    w.fail[kind] = 0;
    const removed = before - w.indexed(A);
    // Batch b (0-based) starts at no cursor for b = 0, else at a cursor.
    const batch = kind === 'list' ? at - 1 : kind === 'r2Delete' ? at - 1 : Math.floor((at - 1) / 100);
    const expectCursor = kind === 'list' ? null : batch === 0 ? null : 'string';
    const cursorOk = expectCursor === null ? r.json.cursor === null : typeof r.json.cursor === 'string';
    check(`${label}: 503, deleted ${removed}, cursor ${expectCursor ?? 'null'}, done false`,
      r.status === 503 && r.json.deleted === removed && r.json.done === false && cursorOk && typeof r.json.error === 'string');
    check(`${label}: no picture or job copy left without its entry`, w.noOrphans(A));
    const rest = await loop(w, A, r.json.cursor);
    check(`${label}: a retry from the answer finishes; B untouched`, rest.last.json.done === true && allGone(w, A) && untouched(w, B, 3));
  }
}

// 7. The count after the batches fails: 200, the deletes stand, remaining null,
//    done false, a cursor to go on; the next call finishes.
{
  const w = world(); w.add(A, 3500);
  w.fail.list = 35;                       // 34 batch lists, then the count
  const r = await delAll(w, A);
  w.fail.list = 0;
  check('the count fails: 200, 3400 deleted, remaining null, done false, a cursor',
    r.status === 200 && r.json.deleted === 3400 && r.json.remaining === null && r.json.done === false && typeof r.json.cursor === 'string' && w.indexed(A) === 100);
  const rest = await loop(w, A, r.json.cursor);
  check('the count fails: the next call finishes', rest.last.json.done === true && allGone(w, A));
}

// 8. More than 10,000 left: the count stops at 10,000 and says "at least".
{
  const w = world(); w.add(A, 13_500);
  const r = await delAll(w, A);
  check('13,500 entries: 3400 deleted, remaining 10000 with remainingAtLeast, done false',
    r.json.deleted === 3400 && r.json.remaining === 10_000 && r.json.remainingAtLeast === true && r.json.done === false && typeof r.json.cursor === 'string');
  const rest = await loop(w, A, r.json.cursor);
  check('13,500 entries: the loop finishes in 3 more calls', rest.last.json.done === true && rest.n === 3 && allGone(w, A));
}

// 9. A page that says more remain but gives no cursor: not treated as the end.
{
  const w = world({ dropCursorOnce: true }); w.add(A, 250);
  const r = await delAll(w, A);
  check('a page with no cursor: done false, remaining 150, cursor null (start again)',
    r.status === 200 && r.json.deleted === 100 && r.json.done === false && r.json.remaining === 150 && r.json.cursor === null);
  const rest = await loop(w, A, r.json.cursor);
  check('a page with no cursor: the next call finishes', rest.last.json.done === true && allGone(w, A));
}

// 10. A list that fails on a cursor KV no longer takes: cursor null, the next call starts over.
{
  const w = world(); w.add(A, 3600);
  const r1 = await delAll(w, A);
  w.fail.list = 1;
  const r2 = await delAll(w, A, r1.json.cursor);
  w.fail.list = 0;
  const r3 = await delAll(w, A, r2.json.cursor);
  check('a list failure answers cursor null; the next call starts over and finishes',
    r1.json.done === false && r2.status === 503 && r2.json.cursor === null && r2.json.deleted === 0 && r3.status === 200 && r3.json.done === true && allGone(w, A));
}

// 11. A cursor that makes KV list past the caller's prefix: names outside it are never touched.
{
  const w = world({ cursorIgnoresPrefix: true }); w.add(A, 150); w.add(B, 120);
  const cursorIntoB = Buffer.from('gen:user_TESTONLYaaaa:').toString('base64');
  const r = await delAll(w, A, cursorIntoB);
  check('a cursor that escapes the prefix: B\'s entries, pictures and job copies untouched', untouched(w, B, 120) && w.noOrphans(B) && r.status === 200);
  check('a cursor that escapes the prefix: A\'s own entries still deleted, the rule kept', w.indexed(A) === 0 && allGone(w, A));
}

// 11b. The count after the batches also reads only the caller's names.
{
  const w = world({ cursorIgnoresPrefix: true }); w.add(A, 3500); w.add(B, 50);
  const r = await delAll(w, A);
  check('the count skips names outside the prefix: remaining 100 of A\'s, B untouched', r.status === 200 && r.json.remaining === 100 && r.json.done === false && untouched(w, B, 50));
}

// 11c. Pages holding only another account's names, ahead of the caller's: never the end.
{
  const C = 'user_TESTONLYa0';    // sorts before A's names
  const w = world({ cursorIgnoresPrefix: true }); w.add(C, 250); w.add(A, 150);
  const start = Buffer.from('gen:user_TESTONLYa').toString('base64');
  const r = await delAll(w, A, start);
  const rest = r.json.done ? { last: r } : await loop(w, A, r.json.cursor);
  check('foreign-only pages ahead of the caller\'s: done only with A cleared, C untouched', rest.last.json.done === true && allGone(w, A) && untouched(w, C, 250));
}

// 12. Index entries: no job id in the metadata, or metadata and key name that disagree.
{
  const w = world(); w.add(A, 12, { malformed: 5 });
  const r = await delAll(w, A);
  check('no job id in the metadata: entries, pictures and job copies deleted', r.json.done === true && allGone(w, A));
  const w2 = world(); w2.entry(A, 'aaaameta01', { nameJob: 'aaaaname01' }); w2.add(B, 2);
  await delAll(w2, A);
  check('metadata and key name disagree: both jobs\' pictures and copies deleted', allGone(w2, A) && untouched(w2, B, 2));
  const w3 = world(); w3.kv.set(`gen:${A}:0000000000000001`, { prompt: 'x' }); w3.add(A, 2);
  const r3 = await delAll(w3, A);
  check('an entry whose key and metadata name no job: its index entry still deleted', r3.json.done === true && w3.indexed(A) === 0);
}

// 13. Requests the route refuses.
{
  const w = world(); w.add(A, 3);
  const r = await delAll(w, null);
  check('no sign-in: 401, nothing deleted', r.status === 401 && untouched(w, A, 3));
  const long = await delAll(w, A, 'x'.repeat(3000));
  check('a cursor over 2,048 characters: 400, nothing deleted', long.status === 400 && untouched(w, A, 3));
  const noKv = await delAll(w, A, null, { noKv: true });
  check('no KV store: 503, nothing deleted', noKv.status === 503 && untouched(w, A, 3));
  const noBucket = await delAll(w, A, null, { noBucket: true });
  check('no R2 bucket: 503, nothing deleted', noBucket.status === 503 && untouched(w, A, 3));
}

// 14. Account A's cursor sent by account B lists only B's entries.
{
  const w = world(); w.add(A, 3600); w.add(B, 3);
  const r = await delAll(w, A);
  const b = await delAll(w, B, r.json.cursor);
  check('A\'s cursor used by B: only B\'s entries are touched', w.indexed(A) === 200 && w.pictures(A) === 200 && w.copies(A) === 200 && b.status === 200 && allGone(w, B));
}

// 15. One entry.
{
  const w = world(); const [j0, j1, j2] = w.add(A, 3); w.add(B, 1);
  const r = await delOne(w, A, j0);
  check('one entry: 200, its entry, picture and job copy gone, the others kept',
    r.status === 200 && r.json.deleted === true && w.indexed(A) === 2 && !w.r2.has(`${A}/${j0}.png`) && !w.r2.has(`jobs/${j0}.json`) && w.r2.has(`${A}/${j1}.png`));
  w.fail.r2Delete = 1;
  const f = await delOne(w, A, j1);
  w.fail.r2Delete = 0;
  check('one entry, R2 fails: 503, deleted false, the entry still listed', f.status === 503 && f.json.deleted === false && w.indexed(A) === 2 && w.noOrphans(A));
  w.fail.kvDelete = 1;
  const g = await delOne(w, A, j1);
  w.fail.kvDelete = 0;
  check('one entry, the index delete fails after R2: 503 JSON, deleted false, the entry still listed', g.status === 503 && g.json.deleted === false && w.indexed(A) === 2 && w.noOrphans(A));
  const again = await delOne(w, A, j1);
  check('one entry, tried again: deleted', again.status === 200 && w.indexed(A) === 1 && !w.r2.has(`${A}/${j1}.png`) && !w.r2.has(`jobs/${j1}.json`));
  const [bj] = [...w.kv.entries()].filter(([n]) => n.startsWith(`gen:${B}:`)).map(([, m]) => m.jobId);
  const other = await delOne(w, A, bj);
  check('another account\'s job id: 404, its entry, picture and job copy kept', other.status === 404 && untouched(w, B, 1));
  w.r2.add(`${A}/stale0001.png`);
  const stale = await delOne(w, A, 'stale0001');
  check('no entry, a stale picture of the caller\'s: 404 and the picture deleted', stale.status === 404 && !w.r2.has(`${A}/stale0001.png`));
  check('one entry: the last one untouched by the others', w.r2.has(`${A}/${j2}.png`) && w.indexed(A) === 1);
}

// 16. One entry found past the first page of the index (more than 1,000 entries).
{
  const w = world(); const ids = w.add(A, 1500);
  const oldest = ids[0];   // the first added is the oldest, and the oldest sorts last
  const r = await delOne(w, A, oldest);
  check('one entry on the second page of 1,500: deleted', r.status === 200 && w.indexed(A) === 1499 && !w.r2.has(`${A}/${oldest}.png`) && w.noOrphans(A));
}

// 17. The routes' log lines: a stopped request logs its step; no line carries an
//     account id, a job id or a cursor.
{
  const w = world(); w.add(A, 50);
  w.fail.r2Delete = 1;
  const before = logs.length;
  await delAll(w, A);
  w.fail.r2Delete = 0;
  const line = logs.slice(before).join('\n');
  check('a stopped request logs one line naming the step (r2)', /"step":"r2"/.test(line));
  const leaks = logs.filter((l) => /user_TESTONLY|aaaa\d|bbbb\d|a0\d|meta01|name01/.test(l) || [...cursorsSeen].some((c) => l.includes(c)));
  check(`no log line carries an account id, a job id or a cursor (${logs.length} lines read)`, leaks.length === 0 && logs.length > 0);
}

// 18. A kind's Clear sends its kind; the server refuses an entry of another
//     kind and deletes nothing for it (HQ 2026-11-25-079). Old pages send no
//     kind and are served as before. One shared rule, entryKind.
{
  const w = world();
  w.entry(A, 'kstill01');
  const walkName = w.entry(A, 'kwalk001');
  w.kv.set(walkName, { ...w.kv.get(walkName), style: 'animation__four_angle_walking' });
  const anim = w.entry(A, 'kanim001');
  w.kv.set(anim, { ...w.kv.get(anim), mode: 'animate', style: 'rd_advanced_animation__walking', action: 'walking' });
  const n0 = w.indexed(A);
  const r1 = await delOne(w, A, 'kwalk001', '?kind=create');
  check('18a: a text walk asked for under Created: 409, "Reload the Gallery and try again.", marked stale, nothing deleted',
    r1.status === 409 && r1.json.error === 'Reload the Gallery and try again.' && r1.json.stale === true && w.indexed(A) === n0 && w.r2.has(`${A}/kwalk001.png`) && w.calls.r2Delete === 0 && w.calls.kvDelete === 0);
  const r2 = await delOne(w, A, 'kwalk001', '?kind=animate');
  check('18b: the same walk under Animated: deleted', r2.status === 200 && w.indexed(A) === n0 - 1 && !w.r2.has(`${A}/kwalk001.png`) && w.noOrphans(A));
  const r3 = await delOne(w, A, 'kanim001', '?kind=create');
  check('18c: an animate job under Created: 409, nothing deleted', r3.status === 409 && w.indexed(A) === n0 - 1);
  const r4 = await delOne(w, A, 'kstill01', '?kind=animate');
  check('18d: a still under Animated: 409, nothing deleted', r4.status === 409 && w.indexed(A) === n0 - 1);
  const r5 = await delOne(w, A, 'kstill01');
  check('18e: no kind, as an old page or a card\'s own Delete sends: deleted as before', r5.status === 200 && w.indexed(A) === n0 - 2);
  const r6 = await delOne(w, A, 'kanim001', '?kind=video');
  check('18f: a kind the server does not know: 400, nothing deleted', r6.status === 400 && w.indexed(A) === n0 - 2);
  const r7 = await delOne(w, A, 'kanim001', '?kind=animate');
  check('18g: the animate job under Animated: deleted', r7.status === 200 && w.indexed(A) === n0 - 3 && w.noOrphans(A));
  // AUDIT ext-mediums r2 L5: the check's edges.
  const packName = w.entry(A, 'kpack001');
  w.kv.set(packName, { ...w.kv.get(packName), mode: 'pack' });
  const r8 = await delOne(w, A, 'kpack001', '?kind=create');
  const r8b = await delOne(w, A, 'kpack001', '?kind=animate');
  check('18i: an entry of a mode the Gallery does not know is neither kind: 409 under each, nothing deleted', r8.status === 409 && r8b.status === 409 && w.kv.has(packName));
  bind(w); w.reset();
  const noUser = await one.DELETE(new Request('https://x.test/api/gallery/kpack001?kind=video', { method: 'DELETE' }), { params: { jobId: 'kpack001' } });
  check('18j: sign-in comes first: no sign-in and a bad kind answers 401, and touches nothing', noUser.status === 401 && w.calls.list === 0);
  const r9 = await delOne(w, A, 'knotthere', '?kind=animate');
  check('18k: a missing entry under a kind answers 404 deleted false, not 409', r9.status === 404 && r9.json.deleted === false);
  const twoName = w.entry(A, 'kwalk002');
  w.kv.set(twoName, { ...w.kv.get(twoName), style: 'animation__vfx' });
  const r10 = await delOne(w, A, 'kwalk002', '?kind=create&kind=animate');
  check('18l: a repeated kind is read as its first: create, so the walk is refused', r10.status === 409 && w.kv.has(twoName));
  const nAll = w.indexed(A);
  const rAll = await delAll(w, A, null, undefined, '?kind=animate');
  check('18m: delete-everything refuses any kind with 400 and deletes nothing (AUDIT ext-mediums r2 L7)', rAll.status === 400 && w.indexed(A) === nAll);
  const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'src/app/api/gallery/[jobId]/route.ts'), 'utf8');
  check('18h: the route decides the kind with the shared rule', /import \{[^}]*\bentryKind\b[^}]*\} from '@\/lib\/galleryTypes'/.test(src) && /entryKind\(found\) !== kind/.test(src));
}

out(failed === 0 ? 'all pass' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
