// scripts/gallery-paging-test.mjs
//
// Offline tests for the Gallery's paging (src/lib/galleryPaging.ts; HQ room
// 2026-11-11-013, 2026-11-14-075; DESIGN 2026-11-14-074). Run from the repo
// root: `node scripts/gallery-paging-test.mjs`.
//
// Section 1 drives the real pass and the real "read the rest" against a
// stand-in list API: an in-memory list of entries, paged 50 at a time with a
// cursor, newest first, as /api/gallery answers. Reads can be made to fail
// and the visit can be ended at any read. Section 2 reads the page's source
// (src/app/gallery/page.tsx) and checks its wiring: the page reads through
// the module, the cursor is followed, the count line, the end of the grid
// and the Clear button are as ruled. The harness writes only its esbuild
// bundle, to local/.gallery-paging-test (gitignored), and prints only case
// names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.gallery-paging-test', 'galleryPaging.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/galleryPaging.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'error',
});
const {
  GALLERY_PAGE_SIZE, PASS_MIN_CARDS, PASS_MAX_PAGES,
  matchesFilter, newEntries, passGoal, passContinues, countLine, loadedLine,
  readRest, clearQuestion, runGalleryPass,
  clearLabel, clearCountingLine, clearFailedLine, clearNoneLine, noneYetLine, noneAtEndLine,
  clearGallery, clearDeletingLine, clearKeptLine, passEndLine, END_LINE, CLEAR_WORKERS,
  deleteEntry, deleteOutcome, clearUnconfirmedLine, DELETE_FAILED_LINE,
} = await import(pathToFileURL(OUT).href);

let pass_ = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass_++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── The stand-in list API ──────────────────────────────────────────────────

/** n entries, newest first. modeOf(i) gives each entry's mode. */
const makeList = (n, modeOf = () => 'create') =>
  Array.from({ length: n }, (_, i) => ({ jobId: `job${i}`, prompt: `p${i}`, style: 's', mode: modeOf(i), createdAt: 1e6 - i, v: 1 }));

/** A list API over `list`: pages of `size`, cursor = the next index as text,
 *  null at the end. failAt: the read numbers (1-based) that reject.
 *  before(n): runs before read n answers (to end a visit, add an entry). */
function api(list, { size = 50, failAt = [], before = () => {} } = {}) {
  const calls = [];
  const read = async (cursor) => {
    calls.push(cursor);
    const n = calls.length;
    before(n);
    if (failAt.includes(n)) throw new Error(`read ${n} failed`);
    const start = cursor === null ? 0 : Number(cursor);
    const entries = list.slice(start, start + size);
    const next = start + size < list.length ? String(start + size) : null;
    return { entries, cursor: next };
  };
  return { read, calls };
}

/** A page's state, as the Gallery page keeps it, with the ports a pass uses. */
function page(list, filter = 'all', options = {}) {
  const server = api(list, options);
  const state = { entries: [], cursor: null, known: new Set(), filter, alive: true, dropped: [], pictureCalls: [], commits: 0 };
  const ports = {
    cursor: () => state.cursor,
    known: () => state.known,
    matches: (e) => matchesFilter(e, state.filter),
    shown: () => state.entries.filter((e) => matchesFilter(e, state.filter)).length,
    read: server.read,
    pictures: async (fresh) => { state.pictureCalls.push(fresh.map((e) => e.jobId)); return fresh.map((e) => `url:${e.jobId}`); },
    current: () => state.alive,
    commit: ({ fresh, cursor }) => {
      fresh.forEach((e) => state.known.add(e.jobId));
      state.entries = [...state.entries, ...fresh];
      state.cursor = cursor;
      state.commits += 1;
    },
    drop: (pictures) => state.dropped.push(pictures),
  };
  /** The first page, as the page's first read does it. */
  const first = async () => {
    const got = await server.read(null);
    got.entries.forEach((e) => state.known.add(e.jobId));
    state.entries = got.entries;
    state.cursor = got.cursor;
  };
  return { state, ports, server, first };
}

// ── 1. The rules and the pass ──────────────────────────────────────────────

check('the page size is the most the list API answers', GALLERY_PAGE_SIZE === 50 && PASS_MIN_CARDS === 12 && PASS_MAX_PAGES === 4);

check('a filter matches by mode; All matches everything',
  matchesFilter({ mode: 'create' }, 'all') && matchesFilter({ mode: 'animate' }, 'all') &&
  matchesFilter({ mode: 'create' }, 'create') && !matchesFilter({ mode: 'create' }, 'animate'));

{
  const known = new Set(['a', 'b']);
  const fresh = newEntries(known, [{ jobId: 'b' }, { jobId: 'c' }, { jobId: 'c' }, { jobId: 'd' }]);
  check('a page gives only the entries not shown yet, each once, in its order, and leaves the known set alone',
    same(fresh.map((e) => e.jobId), ['c', 'd']) && known.size === 2);
}

check('a scroll or a press asks for the next batch; a filter asks only for what a screenful lacks',
  passGoal('more', 0) === 12 && passGoal('more', 500) === 12 &&
  passGoal('filter', 0) === 12 && passGoal('filter', 5) === 7 && passGoal('filter', 12) === 0 && passGoal('filter', 40) === 0);

check('a pass goes on while pages are unread, its goal is unmet and it is under its cap',
  passContinues({ added: 0, goal: 12, pagesRead: 0, more: true }) &&
  !passContinues({ added: 12, goal: 12, pagesRead: 1, more: true }) &&
  !passContinues({ added: 3, goal: 12, pagesRead: 4, more: true }) &&
  !passContinues({ added: 0, goal: 12, pagesRead: 0, more: false }) &&
  passContinues({ added: 11, goal: 12, pagesRead: 3, more: true }));

check('the count line says 50+ while pages are unread and the true count once all are in',
  countLine(50, true) === '50+ generations · synced to your account' &&
  countLine(150, true) === '150+ generations · synced to your account' &&
  countLine(178, false) === '178 generations · synced to your account' &&
  countLine(1, false) === '1 generation · synced to your account' &&
  countLine(0, false) === '0 generations · synced to your account' &&
  countLine(1, true) === '1+ generations · synced to your account');
check('with nothing loaded and pages unread the count line never says 0+', countLine(0, true) === 'Not all loaded yet · synced to your account' && countLine(0, true, null) === 'Not all loaded yet · synced to your account');
check('once a Clear has counted the list, the count line says the true total while pages are unread (DESIGN 2026-11-14-126)',
  countLine(50, true, 178) === '178 generations · synced to your account' && countLine(0, true, 118) === '118 generations · synced to your account' &&
  countLine(0, true, 1) === '1 generation · synced to your account' && countLine(50, true, null) === '50+ generations · synced to your account' &&
  countLine(60, true, 40) === '60+ generations · synced to your account' && countLine(178, false, 999) === '178 generations · synced to your account' &&
  countLine(0, true, 0) === 'Not all loaded yet · synced to your account' && countLine(1, false) === '1 generation · synced to your account');
check('a pass that ends says once what came, or the line that now stands in its place',
  passEndLine({ added: 50, filter: 'all', shown: 100, read: 100, more: true }) === 'Loaded 50 more' &&
  passEndLine({ added: 0, filter: 'animate', shown: 0, read: 250, more: true }) === 'No Animated generations in your newest 250 yet.' &&
  passEndLine({ added: 0, filter: 'animate', shown: 0, read: 120, more: false }) === 'No Animated generations.' &&
  passEndLine({ added: 0, filter: 'all', shown: 50, read: 50, more: false }) === END_LINE && END_LINE === "That's everything." &&
  passEndLine({ added: 0, filter: 'create', shown: 30, read: 200, more: true }) === '');
check('Clear says how many it is deleting; a refused Clear says nothing was deleted; a partial one says what is gone, then what is left (HQ 2026-11-14-128)',
  clearDeletingLine('all', 178) === 'Deleting 178 generations...' && clearDeletingLine('create', 142) === 'Deleting 142 Created generations...' &&
  clearDeletingLine('animate', 1) === 'Deleting 1 Animated generation...' &&
  clearKeptLine(178, 178, 'all') === 'Nothing was deleted: the request did not go through. Press Clear all to try again.' &&
  clearKeptLine(59, 59, 'animate') === 'Nothing was deleted: the request did not go through. Press Clear Animated to try again.' &&
  clearKeptLine(23, 142, 'create') === 'Deleted 119 of 142 Created generations. The other 23 are still here: press Clear Created to try again.' &&
  clearKeptLine(1, 60, 'animate') === 'Deleted 59 of 60 Animated generations. The other one is still here: press Clear Animated to try again.' &&
  clearKeptLine(1, 2, 'create') === 'Deleted 1 of 2 Created generations. The other one is still here: press Clear Created to try again.' &&
  clearUnconfirmedLine() === 'The delete may have gone through, so your gallery was loaded again to show what is there.' &&
  DELETE_FAILED_LINE === 'Not deleted. Press Delete to try again.');

check('the pass says what it loaded once, and nothing when it put no card in view',
  loadedLine(50) === 'Loaded 50 more' && loadedLine(7) === 'Loaded 7 more' && loadedLine(0) === '');

check('the Clear question carries the true count and the kind',
  clearQuestion(178, 'all') === 'Delete all 178 generations? This cannot be undone.' &&
  clearQuestion(61, 'create') === 'Delete all 61 Created generations? This cannot be undone.' &&
  clearQuestion(9, 'animate') === 'Delete all 9 Animated generations? This cannot be undone.' &&
  clearQuestion(1, 'all') === 'Delete 1 generation? This cannot be undone.' &&
  clearQuestion(1, 'create') === 'Delete 1 Created generation? This cannot be undone.');
check('a filter\'s Clear question says how many of the other kind stay (DESIGN 2026-11-14-086, HQ -087)',
  clearQuestion(36, 'animate', 142) === 'Delete all 36 Animated generations? The other 142 stay. This cannot be undone.' &&
  clearQuestion(61, 'create', 1) === 'Delete all 61 Created generations? The other 1 stays. This cannot be undone.' &&
  clearQuestion(5, 'create', 0) === 'Delete all 5 Created generations? This cannot be undone.' &&
  clearQuestion(178, 'all', 99) === 'Delete all 178 generations? This cannot be undone.');
check('Clear\'s lines: counting, the failed count (what is safe first, then the button by its own label), nothing of that kind',
  clearLabel('all') === 'Clear all' && clearLabel('create') === 'Clear Created' && clearLabel('animate') === 'Clear Animated' &&
  clearCountingLine('all') === 'Counting your generations...' && clearCountingLine('animate') === 'Counting your Animated generations...' &&
  clearFailedLine('all') === 'Nothing was deleted: we could not count your whole gallery. Press Clear all to try again.' &&
  clearFailedLine('create') === 'Nothing was deleted: we could not count your whole gallery. Press Clear Created to try again.' &&
  clearNoneLine('all') === 'Nothing to clear.' && clearNoneLine('create') === 'No Created generations to clear.');
check('a filter with no card says how far the list was read, and that there are none once it ended',
  noneYetLine('animate', 250) === 'No Animated generations in your newest 250 yet.' && noneYetLine('create', 50) === 'No Created generations in your newest 50 yet.' &&
  noneAtEndLine('animate') === 'No Animated generations.' && noneAtEndLine('create') === 'No Created generations.');

// George's gallery: 178 entries, read to the end in four reads.
{
  const g = page(makeList(178));
  await g.first();
  const seen = [g.state.entries.length];
  const results = [];
  while (g.state.cursor !== null) {
    results.push(await runGalleryPass('more', g.ports));
    seen.push(g.state.entries.length);
  }
  check('178 entries arrive as 50, 100, 150, 178, one page a pass, and the list ends',
    same(seen, [50, 100, 150, 178]) && results.every((r) => r.state === 'done' && r.pagesRead === 1 && !r.capped) &&
    same(results.map((r) => r.added), [50, 50, 28]) && g.state.cursor === null);
  check('every entry shows once, newest first, as the server lists them',
    same(g.state.entries.map((e) => e.jobId), makeList(178).map((e) => e.jobId)));
  check('each read follows the cursor the last one gave', same(g.server.calls, [null, '50', '100', '150']));
  const after = await runGalleryPass('more', g.ports);
  check('with the list ended a pass reads nothing', after.state === 'none' && g.server.calls.length === 4);
}

// A page that repeats an entry (the store pages by key, so this is a guard, not the usual case).
{
  const list = makeList(120);
  const g = page(list, 'all', { before: (n) => { if (n === 2) list.unshift({ jobId: 'new', prompt: '', style: 's', mode: 'create', createdAt: 2e6, v: 1 }); } });
  await g.first();
  const r = await runGalleryPass('more', g.ports);
  const ids = g.state.entries.map((e) => e.jobId);
  check('an entry the next page repeats is not shown twice, and its picture is not read twice',
    r.state === 'done' && new Set(ids).size === ids.length && ids.length === 99 && r.added === 49 &&
    !g.state.pictureCalls[0].includes('job49') && g.state.pictureCalls[0].length === 49);
}

// A failed read.
{
  const g = page(makeList(178), 'all', { failAt: [2] });
  await g.first();
  const failed = await runGalleryPass('more', g.ports);
  check('a read that fails leaves what is loaded in place and says failed',
    failed.state === 'failed' && g.state.entries.length === 50 && g.state.cursor === '50' && g.state.commits === 0);
  const again = await runGalleryPass('more', g.ports);
  check('trying again reads the same page and carries on', again.state === 'done' && g.state.entries.length === 100 && same(g.server.calls, [null, '50', '50']));
}

// The visit ends mid-pass.
{
  const g = page(makeList(178));
  await g.first();
  g.ports.read = ((read) => async (cursor) => { const got = await read(cursor); g.state.alive = false; return got; })(g.ports.read);
  const r = await runGalleryPass('more', g.ports);
  check('a visit that ends while the list is read puts nothing in and reads no picture',
    r.state === 'ended' && g.state.entries.length === 50 && g.state.commits === 0 && g.state.pictureCalls.length === 0);
}
{
  const g = page(makeList(178));
  await g.first();
  g.ports.pictures = async (fresh) => { g.state.alive = false; return fresh.map((e) => `url:${e.jobId}`); };
  const r = await runGalleryPass('more', g.ports);
  check('a visit that ends while the pictures are read drops them and puts nothing in',
    r.state === 'ended' && g.state.commits === 0 && g.state.dropped.length === 1 && g.state.dropped[0].length === 50);
}
{
  const g = page(makeList(178), 'all', { before: (n) => { if (n === 2) g.state.alive = false; }, failAt: [2] });
  await g.first();
  const r = await runGalleryPass('more', g.ports);
  check('a read that fails after the visit ended is the visit ending, not a failure', r.state === 'ended');
}

// Filters.
{
  // Animations are rare: one in ten.
  const g = page(makeList(400, (i) => (i % 10 === 0 ? 'animate' : 'create')), 'all');
  await g.first();
  g.state.filter = 'animate';
  const shownBefore = g.ports.shown();
  const r = await runGalleryPass('filter', g.ports);
  check('a filter with less than a screenful reads on until 12 cards show',
    shownBefore === 5 && r.state === 'done' && g.ports.shown() === 15 && r.added === 10 && r.pagesRead === 2 && !r.capped);
  const none = await runGalleryPass('filter', g.ports);
  check('a filter that already shows a screenful reads nothing by itself', none.state === 'none' && g.server.calls.length === 3);
  const more = await runGalleryPass('more', g.ports);
  check('under a filter, a scroll or a press reads until 12 more cards show', more.state === 'done' && more.added === 15 && more.pagesRead === 3 && g.ports.shown() === 30);
}
{
  // No animation in the first 400 entries; a large gallery.
  const g = page(makeList(1000, (i) => (i >= 400 && i % 2 === 0 ? 'animate' : 'create')), 'all');
  await g.first();
  g.state.filter = 'animate';
  const r = await runGalleryPass('filter', g.ports);
  check('a pass stops at four pages with nothing found, and says it was capped',
    r.state === 'done' && r.capped && r.pagesRead === 4 && r.added === 0 && g.state.entries.length === 250 && g.state.cursor === '250');
  const r2 = await runGalleryPass('more', g.ports);
  check('a press reads four pages more, and the cards arrive', r2.state === 'done' && r2.pagesRead === 4 && r2.added === 25 && !r2.capped && g.ports.shown() === 25);
}
{
  const g = page(makeList(120, () => 'create'), 'all');
  await g.first();
  g.state.filter = 'animate';
  const r = await runGalleryPass('filter', g.ports);
  check('a filter with no match reads to the end of a small gallery and is not capped',
    r.state === 'done' && !r.capped && r.added === 0 && g.state.cursor === null && r.pagesRead === 2);
}
{
  const g = page(makeList(178, (i) => (i % 2 ? 'animate' : 'create')), 'all');
  await g.first();
  // The person switches the filter while the pass reads.
  g.ports.read = ((read) => async (cursor) => { const got = await read(cursor); g.state.filter = 'animate'; return got; })(g.ports.read);
  const r = await runGalleryPass('more', g.ports);
  check('a pass counts its cards under the filter chosen when they arrive', r.state === 'done' && r.added === 25 && r.pagesRead === 1);
}

// Clear reads the rest first.
{
  const g = page(makeList(178, (i) => (i % 3 === 0 ? 'animate' : 'create')));
  await g.first();
  const rest = await readRest(g.server.read, g.state.cursor, g.state.known);
  const all = [...g.state.entries, ...rest];
  check('reading the rest gives every entry not shown, so the count is the true one',
    rest.length === 128 && all.length === 178 && new Set(all.map((e) => e.jobId)).size === 178 &&
    all.filter((e) => matchesFilter(e, 'animate')).length === 60 && same(g.server.calls, [null, '50', '100', '150']));
  check('reading the rest changes nothing the page shows', g.state.entries.length === 50 && g.state.cursor === '50' && g.state.known.size === 50);
}
{
  const g = page(makeList(178), 'all', { failAt: [3] });
  await g.first();
  let threw = false;
  try { await readRest(g.server.read, g.state.cursor, g.state.known); } catch { threw = true; }
  check('a failed read of the rest rejects: there is never a partial count', threw);
}
{
  const g = page(makeList(178));
  await g.first();
  let alive = true, threw = false;
  const read = async (cursor) => { const got = await g.server.read(cursor); alive = false; return got; };
  try { await readRest(read, g.state.cursor, g.state.known, () => alive); } catch { threw = true; }
  check('reading the rest stops when the visit ends', threw && g.server.calls.length === 2);
}
{
  let threw = false;
  try { await readRest(async () => ({ entries: [], cursor: 'same' }), 'same', new Set()); } catch { threw = true; }
  check('a list that hands the same cursor back is an error, not an endless read', threw);
  check('with nothing unread there is nothing to read', same(await readRest(async () => { throw new Error('no'); }, null, new Set()), []));
}

// ── 1b. Clear, whole, on the stand-in server (AUDIT gallery-paging-r1) ─────

/** A Gallery page and a server for Clear. The server holds `list`; every
 *  call is recorded with the tick it was made at; `ask` takes the person
 *  `think` ticks. `refuse` answers a delete call: false lets it through,
 *  true refuses it (401), 'unknown' is a 5xx that deleted nothing, 'lost'
 *  deletes and then loses the answer. */
function clearRig(list, filter, { shownPages = 1, think = 100, refuse = () => false, failRead = [], answer = true } = {}) {
  let tick = 0;
  const server = { list: [...list], calls: [] };
  const shown = list.slice(0, shownPages * 50);
  const state = { entries: [...shown], cursor: shown.length < list.length ? String(shown.length) : null, gone: new Set(), run: true,
    asked: [], askedIds: [], askedAt: null, removed: [], removedAll: false, phases: [], counted: [], inFlight: 0, maxInFlight: 0, reads: 0 };
  const ports = {
    filter,
    settled: async () => {},
    snapshot: () => ({ entries: state.entries, cursor: state.cursor }),
    gone: () => state.gone,
    read: async (cursor) => {
      state.reads += 1; tick += 1;
      server.calls.push({ what: 'list', cursor, at: tick });
      if (failRead.includes(state.reads)) throw new Error('read failed');
      const start = Number(cursor);
      const entries = server.list.slice(start, start + 50);
      return { entries, cursor: start + 50 < server.list.length ? String(start + 50) : null };
    },
    ask: (question, ids) => { state.asked.push(question); state.askedIds.push([...ids]); tick += think; state.askedAt = tick; return answer; },
    counted: (total) => state.counted.push(total),
    current: () => state.run,
    deleteAll: async () => {
      tick += 1; const at = tick;
      server.calls.push({ what: 'deleteAll', at });
      await null;
      const said = refuse({ what: 'deleteAll', at });
      if (said === 'lost') { server.list = []; return 'unknown'; }
      if (said) return said === true ? 'refused' : said;
      server.list = [];
      return 'deleted';
    },
    deleteOne: async (jobId) => {
      tick += 1; const at = tick;
      state.inFlight += 1; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      server.calls.push({ what: 'deleteOne', jobId, at });
      await null; await null;
      state.inFlight -= 1;
      const said = refuse({ what: 'deleteOne', jobId, at });
      if (said === 'lost') { server.list = server.list.filter((e) => e.jobId !== jobId); return 'unknown'; }
      if (said) return said === true ? 'refused' : said;
      server.list = server.list.filter((e) => e.jobId !== jobId);
      return 'deleted';
    },
    removed: (ids, all) => { state.removed.push(...ids); if (all) state.removedAll = true; state.entries = state.entries.filter((e) => !ids.includes(e.jobId)); },
    phase: (p, n) => state.phases.push([p, n]),
  };
  return { state, ports, server };
}
const mixed = () => makeList(178, (i) => (i % 3 === 0 ? 'animate' : 'create'));   // 60 animated, 118 created
const deletes = (server) => server.calls.filter((c) => c.what !== 'list');

{
  const r = clearRig(mixed(), 'all');
  const res = await clearGallery(r.ports);
  check('Clear all: counts the whole list, asks with the true number, then one "delete everything", and only then empties the page',
    same(r.state.asked, ['Delete all 178 generations? This cannot be undone.']) && same(res, { state: 'done', asked: 178, deleted: 178, kept: 0, unknown: 0 }) &&
    same(deletes(r.server).map((c) => c.what), ['deleteAll']) && r.state.removedAll && r.state.removed.length === 178 && r.server.list.length === 0 &&
    same(r.state.phases, [['reading', 0], ['deleting', 178]]) && same(r.state.counted, [178]) && r.state.reads === 3);
  check('GP-A: every delete goes out after the answer, never before (a token fetched at the call cannot predate the question)',
    deletes(r.server).every((c) => c.at > r.state.askedAt) && r.server.calls.filter((c) => c.what === 'list').every((c) => c.at < r.state.askedAt));
}
{
  const r = clearRig(mixed(), 'animate');
  const res = await clearGallery(r.ports);
  const d = deletes(r.server);
  check("a kind's Clear: asks about that kind and says how many stay, deletes each one once, the unread ones too, and never calls \"delete everything\"",
    same(r.state.asked, ['Delete all 60 Animated generations? The other 118 stay. This cannot be undone.']) && same(res, { state: 'done', asked: 60, deleted: 60, kept: 0, unknown: 0 }) &&
    d.length === 60 && d.every((c) => c.what === 'deleteOne') && new Set(d.map((c) => c.jobId)).size === 60 &&
    r.server.list.length === 118 && r.server.list.every((e) => e.mode === 'create') && !r.state.removedAll && r.state.removed.length === 60);
  check('the question comes with the ids it is about (so the page can drop a waiting Send to Slicer for one of them only), the count with the whole total',
    r.state.askedIds.length === 1 && same([...r.state.askedIds[0]].sort(), d.map((c) => c.jobId).sort()) && same(r.state.counted, [178]) && same(r.state.phases, [['reading', 0], ['deleting', 60]]));
  check("GP-A: a kind's deletes all go out after the answer, at most six on their way at once",
    d.every((c) => c.at > r.state.askedAt) && r.state.maxInFlight === CLEAR_WORKERS && CLEAR_WORKERS === 6);
}
{
  // The server refuses every delete (a sign-in that ran out).
  const all = clearRig(mixed(), 'all', { refuse: () => true });
  const resAll = await clearGallery(all.ports);
  const kind = clearRig(mixed(), 'animate', { refuse: () => true });
  const resKind = await clearGallery(kind.ports);
  check('GP-A: a refused delete never shows as done: nothing leaves the page, and the result says all were kept',
    same(resAll, { state: 'failed', asked: 178, deleted: 0, kept: 178, unknown: 0 }) && all.state.removed.length === 0 && all.state.entries.length === 50 && all.server.list.length === 178 &&
    same(resKind, { state: 'failed', asked: 60, deleted: 0, kept: 60, unknown: 0 }) && kind.state.removed.length === 0 && kind.server.list.length === 178);
}
{
  // Every fifth delete fails.
  let n = 0;
  const r = clearRig(mixed(), 'create', { refuse: () => (++n % 5 === 0) });
  const res = await clearGallery(r.ports);
  const left = r.server.list.filter((e) => e.mode === 'create').map((e) => e.jobId);
  check('M3: every answer is read: a card goes only when its own delete went through, and the rest are counted',
    res.state === 'partial' && res.asked === 118 && res.kept === 23 && res.deleted === 95 && left.length === 23 &&
    r.state.removed.length === 95 && left.every((id) => !r.state.removed.includes(id)));
}
{
  const r = clearRig(mixed(), 'animate');
  r.ports.deleteOne = async () => { throw new Error('network'); };
  const res = await clearGallery(r.ports);
  check('a delete that throws is not known to have failed: nothing leaves the page, and the result says it could not be confirmed', res.state === 'unconfirmed' && res.unknown === 60 && res.kept === 0 && r.state.removed.length === 0);
}
{
  // GP-B: a page is on its way when Clear is pressed. Clear waits for it, then takes its snapshot.
  const list = makeList(178, (i) => (i % 10 === 0 ? 'animate' : 'create'));
  const r = clearRig(list, 'animate');
  let waited = false;
  r.ports.settled = async () => { await null; r.state.entries = list.slice(0, 100); r.state.cursor = '100'; waited = true; };
  const res = await clearGallery(r.ports);
  check('GP-B: Clear waits for a page on its way, so no generation is counted twice',
    waited && same(r.state.asked, ['Delete all 18 Animated generations? The other 160 stay. This cannot be undone.']) && res.deleted === 18 && deletes(r.server).length === 18);
}
{
  // GP-B, belt and braces: the unread pages repeat entries the page already shows.
  const list = makeList(120);
  const r = clearRig(list, 'all');
  r.ports.read = async () => ({ entries: list.slice(30, 120), cursor: null });
  await clearGallery(r.ports);
  check('each generation is counted once even when a page repeats entries', same(r.state.asked, ['Delete all 120 generations? This cannot be undone.']));
}
{
  // M1: the list and its cursor are read at one moment.
  const list = makeList(178);
  const r = clearRig(list, 'all', { shownPages: 4 });
  let snaps = 0;
  r.ports.snapshot = () => { snaps += 1; return { entries: r.state.entries, cursor: r.state.cursor }; };
  await clearGallery(r.ports);
  check('M1: one snapshot of the list and its cursor, and with the whole list in, no read', snaps === 1 && r.state.reads === 0 && same(r.state.asked, ['Delete all 178 generations? This cannot be undone.']));
}
{
  // A card is deleted singly while Clear counts.
  const r = clearRig(mixed(), 'all');
  const read = r.ports.read;
  r.ports.read = async (c) => { const got = await read(c); r.state.gone.add('job1'); r.state.gone.add('job170'); return got; };
  await clearGallery(r.ports);
  check('a generation deleted while Clear counts is not in the question', same(r.state.asked, ['Delete all 176 generations? This cannot be undone.']));
}
{
  // M5: another filter is chosen while Clear counts.
  const r = clearRig(mixed(), 'all');
  const read = r.ports.read;
  r.ports.read = async (c) => { const got = await read(c); r.state.run = false; return got; };
  const res = await clearGallery(r.ports);
  const late = clearRig(mixed(), 'all', { shownPages: 4 });
  late.ports.settled = async () => { late.state.run = false; };
  const resLate = await clearGallery(late.ports);
  // Dropped just after the last page of the count came in.
  const end = clearRig(mixed(), 'all');
  let asks = 0;
  end.ports.current = () => (asks += 1) <= 4;      // the first check, then one for each of the three pages read
  const resEnd = await clearGallery(end.ports);
  check('M5: a Clear dropped after its count is in still asks nothing', resEnd.state === 'dropped' && end.state.reads === 3 && end.state.asked.length === 0 && deletes(end.server).length === 0);
  check('M5: a Clear dropped while it counts asks nothing and deletes nothing',
    res.state === 'dropped' && r.state.asked.length === 0 && deletes(r.server).length === 0 && r.state.reads === 1 &&
    resLate.state === 'dropped' && late.state.asked.length === 0 && deletes(late.server).length === 0);
}
{
  const r = clearRig(mixed(), 'all', { failRead: [2] });
  const res = await clearGallery(r.ports);
  check('a count that fails asks nothing, deletes nothing and gives no total', res.state === 'count-failed' && r.state.counted.length === 0 && r.state.asked.length === 0 && deletes(r.server).length === 0 && r.state.removed.length === 0);
}
{
  const r = clearRig(makeList(120, () => 'create'), 'animate');
  const res = await clearGallery(r.ports);
  const no = clearRig(mixed(), 'all', { answer: false });
  const resNo = await clearGallery(no.ports);
  check('nothing of that kind: no question; a "no" at the question: no delete',
    res.state === 'none' && r.state.asked.length === 0 && deletes(r.server).length === 0 && same(r.state.counted, [120]) && same(no.state.counted, [178]) &&
    resNo.state === 'declined' && resNo.asked === 178 && deletes(no.server).length === 0 && no.state.removed.length === 0);
}
{
  const r = clearRig(makeList(60, (i) => (i < 59 ? 'create' : 'animate')), 'animate');
  await clearGallery(r.ports);
  const one = clearRig(makeList(1), 'all');
  await clearGallery(one.ports);
  check('one of a kind and one in all: the question says 1',
    same(r.state.asked, ['Delete 1 Animated generation? The other 59 stay. This cannot be undone.']) && same(one.state.asked, ['Delete 1 generation? This cannot be undone.']));
}

{
  // AUDIT gallery-paging-r2, G2-2: an answer that is lost, or is neither a
  // yes nor a refusal, proves nothing. Clear must not say "nothing was
  // deleted": it reports that it could not confirm.
  const lost = clearRig(mixed(), 'all', { refuse: () => 'lost' });
  const resLost = await clearGallery(lost.ports);
  const five = clearRig(mixed(), 'all', { refuse: () => 'unknown' });
  const resFive = await clearGallery(five.ports);
  let n = 0;
  const kind = clearRig(mixed(), 'create', { refuse: () => (++n % 4 === 0 ? 'lost' : false) });
  const resKind = await clearGallery(kind.ports);
  let m = 0;
  const both = clearRig(mixed(), 'animate', { refuse: () => (++m % 3 === 0 ? true : m % 5 === 0 ? 'unknown' : false) });
  const resBoth = await clearGallery(both.ports);
  check('G2-2: a lost answer or a 5xx is "unconfirmed", never "failed": the page is told it cannot know what is left',
    same(resLost, { state: 'unconfirmed', asked: 178, deleted: 0, kept: 0, unknown: 178 }) && lost.server.list.length === 0 && lost.state.removed.length === 0 &&
    same(resFive, { state: 'unconfirmed', asked: 178, deleted: 0, kept: 0, unknown: 178 }) && five.server.list.length === 178 &&
    resKind.state === 'unconfirmed' && resKind.unknown === 29 && resKind.deleted === 89 && resKind.kept === 0 && kind.state.removed.length === 89 &&
    resBoth.state === 'unconfirmed' && resBoth.unknown > 0 && resBoth.kept > 0 && resBoth.deleted + resBoth.kept + resBoth.unknown === 60);
}
{
  // G2-4: the visit ends while a kind's deletes run. Nothing more is sent.
  const r = clearRig(mixed(), 'create');
  const one = r.ports.deleteOne; let sent = 0;
  r.ports.deleteOne = async (id) => { sent += 1; if (sent === 20) r.state.run = false; return one(id); };
  const res = await clearGallery(r.ports);
  check('G2-4: once the visit has ended a kind\'s Clear sends no more deletes', res.state === 'dropped' && sent >= 20 && sent <= 20 + CLEAR_WORKERS && deletes(r.server).length === sent && sent < 118, { sent, res });
}
{
  // G2-9: what an answer proves.
  check('G2-9: a 404 counts as gone only with the single-delete route\'s own body; a refusal is 401 or 403; the rest is unknown',
    deleteOutcome({ ok: true, status: 200, body: null }, true) === 'deleted' && deleteOutcome({ ok: true, status: 200, body: null }, false) === 'deleted' &&
    deleteOutcome({ ok: false, status: 404, body: { deleted: false, reason: 'Entry not found.' } }, true) === 'deleted' &&
    deleteOutcome({ ok: false, status: 404, body: null }, true) === 'unknown' && deleteOutcome({ ok: false, status: 404, body: '<html>' }, true) === 'unknown' &&
    deleteOutcome({ ok: false, status: 404, body: { deleted: false } }, false) === 'unknown' &&
    deleteOutcome({ ok: false, status: 401, body: null }, true) === 'refused' && deleteOutcome({ ok: false, status: 403, body: null }, false) === 'refused' &&
    deleteOutcome({ ok: false, status: 500, body: null }, true) === 'unknown' && deleteOutcome({ ok: false, status: 503, body: { deleted: false } }, true) === 'unknown');
}
{
  // G2-1, G2-7: a single Delete, whole. The card leaves only when the
  // server has deleted it.
  const run = async ({ yes = true, outcome = 'deleted', throws = false, alive = true } = {}) => {
    const log = [];
    const res = await deleteEntry({
      ask: () => { log.push('ask'); return yes; },
      current: () => alive,
      busy: (on) => log.push(on ? 'busy' : 'idle'),
      send: async () => { log.push('send'); if (throws) throw new Error('network'); return outcome; },
      removed: () => log.push('removed'),
    });
    return { res, log };
  };
  const ok = await run(); const no = await run({ yes: false }); const refused = await run({ outcome: 'refused' });
  const unknown = await run({ outcome: 'unknown' }); const thrown = await run({ throws: true }); const gone = await run({ alive: false });
  check('G2-1: a single Delete asks, waits, sends once, and takes the card only when the server has deleted it',
    same(ok, { res: 'deleted', log: ['ask', 'busy', 'send', 'idle', 'removed'] }) && same(no, { res: 'declined', log: ['ask'] }) &&
    same(refused, { res: 'refused', log: ['ask', 'busy', 'send', 'idle'] }) && same(unknown, { res: 'unknown', log: ['ask', 'busy', 'send', 'idle'] }) &&
    same(thrown, { res: 'unknown', log: ['ask', 'busy', 'send', 'idle'] }) && same(gone, { res: 'dropped', log: ['ask', 'busy', 'send'] }));
}

// ── 2. The page's wiring ───────────────────────────────────────────────────

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const source = fs.readFileSync(path.join(ROOT, 'src/app/gallery/page.tsx'), 'utf8');
const gallery = stripComments(source);
const lib = fs.readFileSync(path.join(ROOT, 'src/lib/galleryPaging.ts'), 'utf8');
/** The text of one useCallback of the component, from its declaration to the end of its dependency list. */
const fn = (name) => { const a = gallery.indexOf(`  const ${name} = useCallback(`); const c = gallery.indexOf('\n  }, [', a); return a < 0 ? '' : gallery.slice(a, gallery.indexOf('\n', c + 5)); };
const clear = fn('handleClearAll');
const pass = fn('runPass');
const single = fn('handleDelete');

check('the page reads the list through one function that follows the cursor',
  /const after = cursor === null \? '' : `&cursor=\$\{encodeURIComponent\(cursor\)\}`;/.test(gallery) &&
  /fetch\(`\/api\/gallery\?limit=\$\{GALLERY_PAGE_SIZE\}\$\{after\}`/.test(gallery) &&
  /if \(!resp\.ok\) throw new Error/.test(gallery) && /cursor: body\.cursor \?\? null/.test(gallery) &&
  !/limit=50/.test(gallery) && gallery.match(/\/api\/gallery\?/g)?.length === 1);
check('the first read keeps its cursor, its list and the ids it showed, together',
  /const first = await readListPage\(token, null\);/.test(gallery) &&
  /knownRef\.current = new Set\(fetched\.map\(\(e\) => e\.jobId\)\);\s*cursorRef\.current = first\.cursor;\s*entriesRef\.current = fetched;\s*setEntries\(fetched\);/.test(gallery) &&
  /setCursor\(first\.cursor\);/.test(gallery));
check('a new account, a fresh read or a reload starts the paging, Clear and the cards\' own states over',
  /setCursor\(null\);\s*cursorRef\.current = null;\s*knownRef\.current = new Set\(\);\s*goneRef\.current = new Set\(\);/.test(gallery) &&
  /setClearing\(null\);\s*setClearNote\(reloadNoteRef\.current\);\s*reloadNoteRef\.current = '';\s*setEmptied\(\[\]\);\s*emptiedRef\.current = \[\];\s*setTotal\(null\);\s*totalRef\.current = null;\s*setCardState\(\{\}\);\s*cardBusyRef\.current = new Set\(\);\s*clearBusyRef\.current = false;\s*clearDeletingRef\.current = false;\s*failedRef\.current = false;\s*setLoading\(true\);/.test(gallery) &&
  /\}, \[userId, reloads\]\);/.test(gallery));
check('leaving the page or changing account ends the visit for every read and every count in flight, in the commit itself (a layout cleanup) as well as after it',
  /cancelled = true;\s*visitRef\.current \+= 1;\s*passRef\.current = false;\s*clearRunRef\.current \+= 1;/.test(gallery) &&
  /useLayoutEffect\(\(\) => \(\) => \{\s*visitRef\.current \+= 1;\s*clearRunRef\.current \+= 1;\s*\}, \[userId\]\);/.test(gallery));
check('the pass is the module\'s, one at a time, never while a Clear runs, and a visit that ended is left alone',
  /if \(passRef\.current \|\| clearBusyRef\.current \|\| cursorRef\.current === null\) return;/.test(pass) &&
  /const result = await runGalleryPass</.test(pass) && gallery.match(/runGalleryPass</g)?.length === 1 &&
  /const current = \(\) => visitRef\.current === visit;/.test(pass) &&
  /if \(!current\(\)\) return;\s*passRef\.current = false;/.test(pass));
check('GP-B: a pass says when it has ended, whatever its end, so Clear can wait for it',
  /let ended: \(\) => void = \(\) => \{\};\s*passEndRef\.current = new Promise<void>\(\(resolve\) => \{ ended = resolve; \}\);/.test(pass) &&
  /\} finally \{\s*ended\(\);\s*\}/.test(pass) && /settled: \(\) => passEndRef\.current,/.test(clear));
check('a pass fetches its sign-in token at each read, not once at its start',
  /read: async \(after\) => \{\s*const token = await getToken\(\);\s*if \(!token\) throw new Error\('signed out'\);\s*return readListPage\(token, after\);\s*\},/.test(pass) &&
  /pictures: async \(fresh\) => \{\s*const token = await getToken\(\);/.test(pass));
check('M1: a page goes in after the cards shown, and the list and its cursor move together in the commit',
  /entriesRef\.current = \[\.\.\.entriesRef\.current, \.\.\.fresh\];\s*cursorRef\.current = next;/.test(pass) &&
  /setEntries\(\(prev\) => \[\.\.\.prev, \.\.\.fresh\]\);\s*setImageUrls\(\(prev\) => \(\{ \.\.\.prev, \.\.\.urls \}\)\);\s*setCursor\(next\);/.test(pass) &&
  /read\.forEach\(\(e\) => knownRef\.current\.add\(e\.jobId\)\);/.test(pass) &&
  /drop: \(\{ urls \}\) => Object\.values\(urls\)\.forEach\(URL\.revokeObjectURL\)/.test(pass) &&
  /snapshot: \(\) => \(\{ entries: entriesRef\.current, cursor: cursorRef\.current \}\),/.test(clear));
check('after a failure nothing loads by itself: the end is watched only while idle, and a filter change does not read (L2)',
  /if \(result\.state === 'failed'\) \{\s*failedRef\.current = true;\s*setPaging\('failed'\);\s*return;\s*\}/.test(pass) &&
  /if \(trigger === 'filter' && failedRef\.current\) return;/.test(pass) && /failedRef\.current = false;\s*setCapped\(result\.capped\);/.test(pass) &&
  /if \(!end \|\| loading \|\| cursor === null \|\| paging !== 'idle' \|\| clearing \|\| emptied\.includes\(filter\)\s*\|\| typeof IntersectionObserver === 'undefined'\) return;/.test(gallery));
check('the next page starts when the grid\'s end is about one screen away in the page\'s scroller',
  /\{ root: end\.closest\('main'\), rootMargin: '0px 0px 100% 0px' \}/.test(gallery) &&
  /let armed = !capped;/.test(gallery) && /if \(!record\.isIntersecting\) armed = true;\s*else if \(armed\) void runPass\('more'\);/.test(gallery));
check('a filter that shows less than a screenful reads on; a new filter lifts the cap and clears what was said',
  /if \(loading\) return;\s*void runPass\('filter'\);\s*\}, \[filter, loading, runPass\]\);/.test(gallery) &&
  /setFilter\(mode\);\s*setCapped\(false\);\s*setAnnounce\(''\);\s*setClearNote\(''\);/.test(gallery));
check('L3: when a pass ends, the status says what came or the line now standing in its place; under a kind a Clear emptied that line is the end line (G2-6)',
  /setAnnounce\(passEndLine\(\{\s*added: result\.added,\s*filter: filterRef\.current,\s*shown: shown\(\),\s*read: entriesRef\.current\.length,\s*more: cursorRef\.current !== null && !kindDone\(\),\s*\}\)\);/.test(pass) &&
  /const kindDone = \(\) => emptiedRef\.current\.includes\(filterRef\.current\);/.test(pass) &&
  /shown: \(\) => \(kindDone\(\) \? Number\.MAX_SAFE_INTEGER : shown\(\)\),/.test(pass));
check('the count line is the module\'s, with the total a Clear counted; each deleted generation lowers that total once (G2-5)',
  /\{countLine\(entries\.length, cursor !== null, total\)\}/.test(gallery) && !/synced to your account/.test(gallery) &&
  /counted: \(count\) => \{\s*if \(!alive\(\)\) return;\s*totalRef\.current = count;\s*setTotal\(count\);\s*\},/.test(clear) &&
  /const gone = new Set\(ids\);\s*lowerTotal\(ids\.filter\(\(id\) => !goneRef\.current\.has\(id\)\)\.length\);\s*ids\.forEach\(\(id\) => \{\s*goneRef\.current\.add\(id\);/.test(gallery) &&
  gallery.match(/lowerTotal\(/g)?.length === 1 &&
  /if \(totalRef\.current === null \|\| by === 0\) return;\s*totalRef\.current = Math\.max\(0, totalRef\.current - by\);\s*setTotal\(totalRef\.current\);/.test(gallery));
check('the grid\'s end: one status line, "Load more" or "Try again" while more is offered, the failure line, the end line',
  /<div ref=\{endRef\} className="relative mt-6 flex flex-wrap items-center justify-center gap-3 min-h-11">/.test(gallery) &&
  /<p role="status" className="sr-only">\s*\{paging === 'loading' \? 'Loading more' : paging === 'failed' \? 'Could not load more\.' : announce\}\s*<\/p>/.test(gallery) &&
  /\{offersMore && paging === 'failed' && \(\s*<p aria-hidden="true" className="text-\[13px\] text-text-secondary">Could not load more\.<\/p>/.test(gallery) &&
  /\{paging === 'loading' \? 'Loading\.\.\.' : paging === 'failed' \? 'Try again' : 'Load more'\}/.test(gallery) &&
  /\{!offersMore && \(noneLine \|\| \(cursor === null && paged && filteredEntries\.length > 0\)\) && \(\s*<p ref=\{endLineRef\} tabIndex=\{-1\} className="text-\[13px\] text-text-secondary outline-none">\s*\{noneLine \|\| END_LINE\}\s*<\/p>/.test(gallery) &&
  !/That&apos;s everything|That's everything/.test(gallery));
check('under a filter with no card: how far the list was read, above "Load more", while idle and no Clear runs; none of that kind once the list ended or a Clear emptied it (M7); no "Load more" while a Clear runs (G2-6)',
  /const kindDone = filter !== 'all' && \(cursor === null \|\| emptied\.includes\(filter\)\);/.test(gallery) &&
  /const noneLine = filter === 'all' \|\| filteredEntries\.length > 0 \? ''\s*: kindDone \? noneAtEndLine\(filter\)\s*: paging === 'idle' && !clearing \? noneYetLine\(filter, entries\.length\)\s*: '';/.test(gallery) &&
  /const offersMore = cursor !== null && !clearing && !\(filter !== 'all' && emptied\.includes\(filter\)\);/.test(gallery) &&
  /\{noneLine && offersMore && \(\s*<p className="basis-full text-center text-\[13px\] text-text-secondary">\{noneLine\}<\/p>/.test(gallery) &&
  /\{offersMore && \(\s*<Button\s*ref=\{moreRef\}/.test(gallery) &&
  gallery.indexOf('{noneLine && offersMore && (') < gallery.indexOf('ref={moreRef}'));
check('M7: a kind a Clear has emptied reads no further: no pass, no watch, and the page says none are left',
  /if \(emptiedRef\.current\.includes\(filterRef\.current\)\) return;/.test(pass) &&
  /else if \(result\.state === 'done' && kind !== 'all'\) \{\s*emptiedRef\.current = \[\.\.\.emptiedRef\.current, kind\];\s*setEmptied\(emptiedRef\.current\);\s*if \(filterRef\.current === kind\) setAnnounce\(noneAtEndLine\(kind\)\);\s*\}/.test(clear));
check('"Load more" stays in place while a page loads, dimmed and busy, so the keyboard keeps its place',
  /ref=\{moreRef\}/.test(gallery) && /aria-disabled=\{paging === 'loading' \|\| undefined\}\s*aria-busy=\{paging === 'loading' \|\| undefined\}/.test(gallery) &&
  /if \(paging !== 'loading'\) void runPass\('more', true\);/.test(gallery) && /pointer-coarse:min-h-11/.test(gallery));
check('four skeleton cards stand at the grid\'s end while a page loads, hidden from screen readers',
  /\{paging === 'loading' && Array\.from\(\{ length: 4 \}, \(_, i\) => \(\s*<div\s*key=\{`more-\$\{i\}`\}\s*aria-hidden="true"/.test(gallery));
check('when the list ends under a focused "Load more", the end line takes the focus',
  /\} else if \(next === null && focusCardRef\.current === null && document\.activeElement === moreRef\.current\) \{\s*focusEndRef\.current = true;\s*\}/.test(pass) &&
  /if \(cursor === null && focusEndRef\.current\) \{\s*focusEndRef\.current = false;\s*endLineRef\.current\?\.focus\(\);/.test(gallery));
check('G2-2: the empty screen carries Clear\'s line when there is one (a reload that found nothing still says why it reloaded)',
  /\{clearNote && <p role="status" className="text-\[13px\] text-text-secondary max-w-md">\{clearNote\}<\/p>\}/.test(gallery) && gallery.match(/role="status"/g)?.length === 4);
check('M4: the empty screen shows only when nothing is loaded and nothing is unread; a counted total of 0 is not trusted while pages remain (G2-5)',
  /if \(entries\.length === 0 && cursor === null\) \{/.test(gallery) && !/if \(entries\.length === 0\) \{/.test(gallery) && !/total === 0/.test(gallery));
check('L5: a press of "Load more" or "Try again", or a page that arrives while the button holds the focus (G2-8), hands the focus to the first new card itself, never a control in it; loading by scrolling with the focus elsewhere never does (DESIGN 2026-11-14-126, -134, -147)',
  /const runPass = useCallback\(async \(trigger: 'more' \| 'filter', pressed = false\) => \{/.test(pass) && /pressedRef\.current = pressed;/.test(pass) &&
  /const atButton = pressedRef\.current \|\| \(moreRef\.current !== null && document\.activeElement === moreRef\.current\);\s*const firstShown = atButton \? fresh\.find\(\(e\) => matchesFilter\(e, filterRef\.current\)\) : undefined;\s*if \(firstShown\) \{\s*pressedRef\.current = false;\s*focusCardRef\.current = firstShown\.jobId;/.test(pass) &&
  /else if \(armed\) void runPass\('more'\);/.test(gallery) && /void runPass\('filter'\);/.test(gallery) && gallery.match(/runPass\('more', true\)/g)?.length === 1 &&
  /if \(!card\) return;\s*card\.focus\(\{ preventScroll: true \}\);\s*card\.scrollIntoView\(\{ block: 'nearest' \}\);\s*\}, \[entries\]\);/.test(gallery) &&
  !/querySelector<HTMLElement>\('button/.test(gallery) &&
  /<div\s*data-gallery-card=\{entry\.jobId\}\s*tabIndex=\{-1\}\s*role="group"\s*aria-label=\{`\$\{entry\.prompt\}, \$\{entry\.mode === 'create' \? 'Created' : 'Animated'\}`\}/.test(gallery));
check('a yes to Clear, or to a card\'s Delete, drops a waiting Send to Slicer only when its own generation is among those to delete',
  /onSendToSlicer=\{\(\) => \{\s*slicerJobRef\.current = entry\.jobId;\s*return handleSendToSlicer\(entry\);\s*\}\}/.test(gallery) &&
  /ask: \(question, ids\) => \{\s*const yes = confirm\(question\);\s*if \(yes && slicerJobRef\.current !== null && ids\.includes\(slicerJobRef\.current\)\) \{\s*slicerJobRef\.current = null;\s*ownership\.slicer\(\);\s*\}\s*return yes;\s*\},/.test(clear) &&
  /ask: \(\) => \{\s*const yes = confirm\('Delete this generation\? This cannot be undone\.'\);\s*if \(yes && slicerJobRef\.current === jobId\) \{\s*slicerJobRef\.current = null;\s*ownership\.slicer\(\);\s*\}\s*return yes;\s*\},/.test(single) &&
  gallery.match(/ownership\.slicer\(\)/g)?.length === 2);
// Clear in the page: the module does it; the page only hands it its calls.
check('M6: Clear is the module\'s, whole: the page counts nothing, asks nothing and deletes nothing outside it',
  /const result = await clearGallery\(\{/.test(clear) && gallery.match(/clearGallery\(/g)?.length === 1 &&
  !/readRest\(|clearQuestion\(/.test(gallery) && gallery.match(/confirm\(/g)?.length === 2 && /ask: \(question, ids\) => \{\s*const yes = confirm\(question\);/.test(clear) &&
  gallery.match(/method: 'DELETE'/g)?.length === 3);
check('GP-A: each delete fetches its sign-in token at the call, inside the port; its answer is read by the module\'s rule; ids are encoded and an empty id is never sent (G2-9)',
  /deleteAll: async \(\) => \{\s*const token = await getToken\(\);\s*if \(!token\) return 'refused';\s*const resp = await fetch\('\/api\/gallery', \{ method: 'DELETE', headers: \{ Authorization: `Bearer \$\{token\}` \} \}\);\s*return deleteOutcome\(\{ ok: resp\.ok, status: resp\.status, body: null \}, false\);\s*\},/.test(clear) &&
  /deleteOne: async \(jobId\) => \{\s*if \(!jobId\) return 'refused';\s*const token = await getToken\(\);\s*if \(!token\) return 'refused';\s*const resp = await fetch\(`\/api\/gallery\/\$\{encodeURIComponent\(jobId\)\}`, \{ method: 'DELETE', headers: \{ Authorization: `Bearer \$\{token\}` \} \}\);\s*return deleteOutcome\(\{ ok: resp\.ok, status: resp\.status, body: resp\.ok \? null : await resp\.json\(\)\.catch\(\(\) => null\) \}, true\);\s*\},/.test(clear) &&
  clear.match(/await getToken\(\)/g)?.length === 3 && clear.indexOf('await getToken()') > clear.indexOf('const result = await clearGallery({') &&
  !/resp\.status === 404/.test(gallery));
check('GP-A, G2-1: nothing leaves the page before the server has deleted it: cards go only through dropCards, called from the module\'s "removed" for Clear and for a single Delete',
  gallery.match(/dropCards\(/g)?.length === 2 && /removed: \(ids, all\) => \{\s*if \(!alive\(\)\) return;\s*dropCards\(ids\);/.test(clear) && /removed: \(\) => dropCards\(\[jobId\]\),/.test(single) &&
  !/setEntries\(/.test(clear) && !/setEntries\(/.test(single) && !/goneRef\.current\.add/.test(single) &&
  /entriesRef\.current = entriesRef\.current\.filter\(\(e\) => !gone\.has\(e\.jobId\)\);\s*setEntries\(\(prev\) => prev\.filter\(\(e\) => !gone\.has\(e\.jobId\)\)\);/.test(gallery));
check('an entry deleted in this visit never comes back: later pages skip it, and a page on its way drops it and frees its picture',
  /ids\.forEach\(\(id\) => \{\s*goneRef\.current\.add\(id\);\s*knownRef\.current\.add\(id\);/.test(gallery) &&
  /const fresh = read\.filter\(\(e\) => !goneRef\.current\.has\(e\.jobId\)\);/.test(pass) &&
  /if \(goneRef\.current\.has\(e\.jobId\)\) \{\s*if \(url\) URL\.revokeObjectURL\(url\);\s*continue;\s*\}/.test(pass));
check('Clear all, once the server has done it, leaves no page to read',
  /if \(all\) \{\s*cursorRef\.current = null;\s*setCursor\(null\);\s*setPaged\(false\);\s*setPaging\('idle'\);\s*setCapped\(false\);\s*setAnnounce\(''\);\s*failedRef\.current = false;\s*\}/.test(clear));
check('M5, G2-3: one Clear at a time, by a ref; a filter change drops one that is still counting, with its question, and frees the button at once; one that is deleting goes on; a dropped Clear never resets a newer one\'s flags',
  /if \(clearBusyRef\.current\) return;\s*clearBusyRef\.current = true;/.test(clear) &&
  /const run = \(clearRunRef\.current \+= 1\);/.test(clear) && /current: \(\) => alive\(\) && clearRunRef\.current === run,/.test(clear) &&
  /if \(clearBusyRef\.current && !clearDeletingRef\.current\) \{\s*clearRunRef\.current \+= 1;\s*clearBusyRef\.current = false;\s*setClearing\(null\);\s*\}/.test(gallery) &&
  /clearDeletingRef\.current = phase === 'deleting';/.test(clear) &&
  /\} finally \{\s*if \(clearRunRef\.current === run\) \{\s*clearBusyRef\.current = false;\s*clearDeletingRef\.current = false;\s*if \(alive\(\)\) setClearing\(null\);\s*\}\s*\}/.test(clear));
check('M3, G2-2: the button is busy from the press to the last answer; what the server kept is said; an answer that could not be confirmed reads the gallery again and says so',
  /if \(passRef\.current \|\| cursorRef\.current !== null\) setClearing\(\{ phase: 'reading', filter: kind, count: 0 \}\);/.test(clear) &&
  /aria-disabled=\{clearing \|\| nothingToClear \? true : undefined\}\s*aria-busy=\{clearing \? true : undefined\}/.test(gallery) &&
  /else if \(result\.state === 'partial' \|\| result\.state === 'failed'\) setClearNote\(clearKeptLine\(result\.kept, result\.asked, kind\)\);/.test(clear) &&
  /else if \(result\.state === 'unconfirmed'\) reload\(clearUnconfirmedLine\(\)\);/.test(clear) &&
  /if \(result\.state === 'count-failed'\) setClearNote\(clearFailedLine\(kind\)\);\s*else if \(result\.state === 'none'\) setClearNote\(clearNoneLine\(kind\)\);/.test(clear) &&
  /const reload = useCallback\(\(note: string\) => \{\s*reloadNoteRef\.current = note;/.test(gallery) && /setReloads\(\(n\) => n \+ 1\);/.test(gallery));
check('G2-10: with nothing of that kind to clear, shown or unread, the Clear button is dimmed and does nothing, and keeps the focus: aria-disabled, never the disabled attribute',
  /const nothingToClear = filteredEntries\.length === 0 && \(cursor === null \|\| emptied\.includes\(filter\)\);/.test(gallery) &&
  /onClick=\{\(\) => \{\s*if \(!nothingToClear\) void handleClearAll\(\);\s*\}\}\s*aria-disabled=\{clearing \|\| nothingToClear \? true : undefined\}/.test(gallery) &&
  !/onClick=\{handleClearAll\}/.test(gallery) && /aria-disabled:opacity-50 aria-disabled:cursor-not-allowed/.test(gallery));
check('G2-1: a single Delete is the module\'s, whole: it asks first, its token is fetched at the call, it sends one DELETE for that generation, and the card waits, then leaves or says it was not deleted',
  /if \(!jobId \|\| cardBusyRef\.current\.has\(jobId\)\) return;/.test(single) && /const outcome = await deleteEntry\(\{/.test(single) && gallery.match(/deleteEntry\(/g)?.length === 1 &&
  /send: async \(\) => \{\s*const token = await getToken\(\);\s*if \(!token\) return 'refused';\s*const resp = await fetch\(`\/api\/gallery\/\$\{encodeURIComponent\(jobId\)\}`, \{ method: 'DELETE', headers: \{ Authorization: `Bearer \$\{token\}` \} \}\);\s*return deleteOutcome\(\{ ok: resp\.ok, status: resp\.status, body: resp\.ok \? null : await resp\.json\(\)\.catch\(\(\) => null\) \}, true\);\s*\},/.test(single) &&
  single.indexOf("confirm('Delete this generation?") < single.indexOf('await getToken()') &&
  /if \(outcome === 'refused'\) \{\s*mark\('failed'\);\s*setAnnounce\(DELETE_FAILED_LINE\);\s*\} else if \(outcome === 'unknown'\) \{\s*reload\(clearUnconfirmedLine\(\)\);\s*\}/.test(single) &&
  /state=\{cardState\[entry\.jobId\]\}/.test(gallery) && /const busy = state === 'busy';/.test(gallery) &&
  /onClick=\{busy \? undefined : onDelete\}\s*aria-disabled=\{busy \|\| undefined\}/.test(gallery) &&
  /\{state === 'failed'\s*\? <p className="text-xs text-accent-amber">\{DELETE_FAILED_LINE\}<\/p>\s*: <p className="text-xs text-text-muted">\{relativeTime\(entry\.createdAt\)\}<\/p>\}/.test(gallery) &&
  gallery.match(/method: 'DELETE'/g)?.length === 3 && gallery.match(/confirm\(/g)?.length === 2);
check('Clear\'s label never wraps, under 640 px the button has its own row under the count line, and on touch it is 44 px tall at any width (DESIGN 2026-11-14-086)',
  /<div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">/.test(gallery) &&
  /className="-ml-4 sm:ml-0 flex-shrink-0 whitespace-nowrap pointer-coarse:min-h-11 text-text-secondary /.test(gallery) &&
  /<Trash2 className="mr-2 h-4 w-4 sm:h-3\.5 sm:w-3\.5" aria-hidden="true" \/>\} \{clearLabel\(filter\)\}/.test(gallery));
check('Clear\'s lines are the module\'s, for the filter the Clear was pressed on, said once in a row of their own under the title',
  /const clearLine = clearing \? \(clearing\.phase === 'reading' \? clearCountingLine\(clearing\.filter\) : clearDeletingLine\(clearing\.filter, clearing\.count\)\) : clearNote;/.test(gallery) &&
  /<p role="status" className=\{`text-\[13px\] text-text-secondary sm:text-right \$\{clearLine \? 'mt-1 sm:mt-2' : ''\}`\}>\s*\{clearLine\}\s*<\/p>/.test(gallery) &&
  gallery.match(/role="status"/g)?.length === 4);
check('the module has no React and no DOM calls', !/from 'react'|document\.|window\.|fetch\(|confirm\(/.test(lib));
check('no em dashes in the new file or the lines this change wrote', !lib.includes(String.fromCharCode(0x2014)) && !source.split('\n').some((line) => /readPictures|Filtered scope/.test(line) && line.includes(String.fromCharCode(0x2014))));

console.log(`\n${pass_} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
