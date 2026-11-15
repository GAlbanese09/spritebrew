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
const KEEP_OUT = path.join(ROOT, 'local', '.gallery-paging-test', 'galleryKeep.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/galleryPaging.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'error',
});
await build({
  entryPoints: [path.join(ROOT, 'src/lib/galleryKeep.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: KEEP_OUT, logLevel: 'error',
  alias: { '@': path.join(ROOT, 'src') },
});
const { KEEP_CAP, capKept, quietMerge, keepGallery, takeKept, dropKept } = await import(pathToFileURL(KEEP_OUT).href);
const {
  GALLERY_PAGE_SIZE, PASS_MIN_CARDS, PASS_MAX_PAGES,
  matchesFilter, newEntries, passGoal, passContinues, countLine, loadedLine,
  readRest, clearQuestion, runGalleryPass,
  clearLabel, clearCountingLine, clearFailedLine, clearNoneLine, noneYetLine, noneAtEndLine,
  clearGallery, clearDeletingLine, clearKeptLine, passEndLine, END_LINE, CLEAR_WORKERS, clearedLine, CLEARED_HEADING,
  deleteEntry, deleteOutcome, clearUnconfirmedLine, DELETE_FAILED_LINE,
  noneNextLine, newAtTopLine, clearMoreLine, showNewLabel, showNewName, newWaitingLine,
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

// ── 1a. Keep the place (HQ 2026-11-14-077; DESIGN -230) and the Lows ───────

{
  // AUDIT gallery-paging-r3, L3-2: a pass on its way reads no further once
  // a Clear has emptied the kind shown, before the list page or its pictures.
  const list = makeList(400, (i) => (i < 60 ? 'animate' : 'create'));
  const p = page(list, 'animate');
  await p.first();
  let emptied = false;
  const result = await runGalleryPass('more', { ...p.ports, stop: () => emptied, read: async (c) => { const got = await p.server.read(c); emptied = true; return got; } });
  check('L3-2: a pass on its way stops once the kind shown is emptied: no pictures for that page, no further read, not capped',
    result.state === 'done' && result.pagesRead === 0 && result.read === 0 && !result.capped && p.server.calls.length === 2 && p.state.pictureCalls.length === 0,
    { result, calls: p.server.calls, pictures: p.state.pictureCalls.length });
  const q = page(list, 'animate');
  await q.first();
  const none = await runGalleryPass('more', { ...q.ports, stop: () => true });
  check('L3-2: a pass told to stop before it starts reads nothing', none.state === 'done' && q.server.calls.length === 1 && none.read === 0, none);
  const r = page(makeList(300), 'all');
  await r.first();
  const plain = await runGalleryPass('more', r.ports);
  check('a pass with no stop reads as before, and counts the entries it read', plain.state === 'done' && plain.read === 50 && plain.added === 50, plain);
}

check('L3, the logged case: cards of the kind show, the pass read some and found none of it, pages remain: said once, with the count read (DESIGN 2026-11-14-230)',
  passEndLine({ added: 0, filter: 'animate', shown: 7, read: 250, more: true, readThisPass: 200 }) === 'None of the next 200 were Animated. Load more looks further.' &&
  passEndLine({ added: 0, filter: 'create', shown: 3, read: 100, more: true, readThisPass: 50 }) === 'None of the next 50 were Created. Load more looks further.' &&
  passEndLine({ added: 0, filter: 'animate', shown: 7, read: 250, more: true }) === '' &&
  passEndLine({ added: 0, filter: 'all', shown: 7, read: 250, more: true, readThisPass: 50 }) === '' &&
  passEndLine({ added: 0, filter: 'animate', shown: 7, read: 250, more: false, readThisPass: 50 }) === END_LINE &&
  noneNextLine('animate', 1) === 'None of the next 1 were Animated. Load more looks further.');
check('a return says once, hidden, how many new generations went on top (DESIGN 2026-11-14-230)',
  newAtTopLine(1) === '1 new generation at the top.' && newAtTopLine(2) === '2 new generations at the top.');
check('words: "Show 2 new", its name, and the line said when it appears (DESIGN 2026-11-14-278; HQ 2026-11-14-282)',
  showNewLabel(1) === 'Show 1 new' && showNewLabel(2) === 'Show 2 new' &&
  showNewName(1) === 'Show 1 new generation' && showNewName(2) === 'Show 2 new generations' &&
  newWaitingLine(1) === '1 new generation. Press Show 1 new at the top of the page to see it.' &&
  newWaitingLine(2) === '2 new generations. Press Show 2 new at the top of the page to see them.');
check('L1: Clear all that deleted more than it counted says so, the total first; Clear all only (DESIGN 2026-11-14-230, HQ -232)',
  clearMoreLine(180, 2) === 'Deleted 180 generations, including 2 made after you pressed Clear all.' && clearMoreLine.length === 2);

{
  const entries = makeList(260);
  const ids = (from, to) => entries.slice(from, to).map((e) => e.jobId);
  const pictures = Object.fromEntries(entries.map((e) => [e.jobId, `blob:${e.jobId}`]));
  const top = makeList(3).map((e) => ({ ...e, jobId: `new${e.jobId}` }));
  const state = {
    userId: 'u1', entries: [...top, ...entries], pictures: { ...pictures, newjob0: 'blob:newjob0' }, cursor: '260', paged: true, total: null, filter: 'all', scrollTop: 9000,
    pages: [0, 50, 100, 150, 200, 250].map((from) => ({ ids: ids(from, from + 50), cursor: from + 50 < 260 ? String(from + 50) : null })),
  };
  state.pages[5].cursor = '260';
  const cut = capKept(state);
  check('the cap: at most 200 kept, cut at a page boundary, with that page\'s cursor, so the next read starts at the first one let go',
    KEEP_CAP === 200 && cut.entries.length === 3 + 150 && cut.cursor === '150' && cut.pages.length === 3 &&
    same(cut.entries.slice(0, 3).map((e) => e.jobId), ['newjob0', 'newjob1', 'newjob2']) && cut.entries[cut.entries.length - 1].jobId === 'job149',
    { kept: cut.entries.length, cursor: cut.cursor, pages: cut.pages.length });
  check('the cap: pictures go with their entries; the place, the tab and the total are kept as they were',
    Object.keys(cut.pictures).length === 151 && cut.pictures.job149 === 'blob:job149' && !cut.pictures.job150 && cut.pictures.newjob0 === 'blob:newjob0' &&
    cut.scrollTop === 9000 && cut.filter === 'all' && cut.paged === true);
  const small = { ...state, entries: entries.slice(0, 120), pages: state.pages.slice(0, 3), cursor: '150' };
  check('under the cap nothing is cut', capKept(small) === small);
  const deleted = { ...state, entries: [...entries.slice(0, 40), ...entries.slice(50, 260)] };
  check('the cap counts the entries still there: a page with ten deleted keeps one more page in reach',
    capKept(deleted).entries.length === 190 && capKept(deleted).cursor === '200', capKept(deleted).entries.length);
  check('the cap keeps at least the first page, whatever its size', capKept(state, 10).entries.length === 53 && capKept(state, 10).cursor === '50');
  const whole = { ...state, cursor: null, pages: state.pages.map((page, i) => (i === 5 ? { ...page, cursor: null } : page)) };
  check('the cap: with every page read the whole count is known and kept, so the count line does not drop to "200+"; with pages unread it stays as it was',
    capKept(whole).total === 263 && capKept(whole).cursor === '150' && capKept(state).total === null && capKept({ ...state, total: 400 }).total === 400 &&
    countLine(capKept(whole).entries.length, capKept(whole).cursor !== null, capKept(whole).total) === '263 generations · synced to your account');

  const kept = entries.slice(0, 100);
  const merged = quietMerge(kept, [...top, ...entries.slice(0, 47)]);
  check('the quiet read: new generations on top, newest first, none of the kept ones twice',
    !merged.gap && same(merged.fresh.map((e) => e.jobId), ['newjob0', 'newjob1', 'newjob2']));
  check('the quiet read: one deleted in this visit does not come back', same(quietMerge(kept, [...top, ...kept.slice(0, 47)], new Set(['newjob1'])).fresh.map((e) => e.jobId), ['newjob0', 'newjob2']));
  check('the quiet read: a first page with nothing kept on it (more new ones than a page) is a gap: read from the top; an empty page is an empty list',
    quietMerge(kept, makeList(50).map((e) => ({ ...e, jobId: `x${e.jobId}` }))).gap === true && quietMerge(kept, []).gap === false &&
    quietMerge(kept, []).removed.length === 100 && quietMerge([], top).gap === false);
  {
    // AUDIT keep-place r1, M1: one page kept, its third deleted in the visit; the server's first page now
    // starts with the kept ones and ends with generation 51, older than any kept: it is not new.
    const one = entries.slice(0, 50).filter((e) => e.jobId !== 'job2');
    const page = entries.slice(0, 51).filter((e) => e.jobId !== 'job2');
    const m = quietMerge(one, page, new Set(['job2']));
    check('M1: only what stands before the first kept generation is new; an older one further down the page comes with paging',
      m.fresh.length === 0 && m.removed.length === 0 && !m.gap, m);
    const m2 = quietMerge(one, [...top, ...page.slice(0, 47)]);
    check('M1: new ones before the first kept generation go on top, newest first', same(m2.fresh.map((e) => e.jobId), ['newjob0', 'newjob1', 'newjob2']));
    // AUDIT keep-place r1, M2: generations the server no longer has.
    const away = quietMerge(one, one.filter((e) => e.jobId !== 'job10' && e.jobId !== 'job40'));
    check('M2: kept generations the page covers but no longer holds are removed; those past the page\'s last kept one are not judged',
      same(away.removed, ['job10', 'job40']) && same(quietMerge(entries.slice(0, 100), entries.slice(0, 50).filter((e) => e.jobId !== 'job7')).removed, ['job7']), away.removed);
    const whole = quietMerge(entries.slice(0, 5), entries.slice(0, 3), new Set(), true);
    check('M2: when the first page is the whole list, every kept generation not on it is removed',
      same(whole.removed, ['job3', 'job4']) && same(quietMerge(entries.slice(0, 3), top, new Set(), true).removed, ['job0', 'job1', 'job2']) &&
      same(quietMerge(entries.slice(0, 3), top, new Set(), true).fresh.map((e) => e.jobId), ['newjob0', 'newjob1', 'newjob2']));
  }

  dropKept();
  keepGallery(state);
  check('what is kept is cut to the cap', takeKept('u1').entries.length === 153);
  check('a return reads it again for the same account (a second return too)', takeKept('u1') !== null && takeKept('u1').scrollTop === 9000);
  check('another account, or none, drops it', takeKept('u2') === null && takeKept('u1') === null);
  keepGallery(state);
  check('a sign-out drops it', takeKept(null) === null && takeKept('u1') === null);
  keepGallery(state);
  dropKept();
  check('dropKept drops it', takeKept('u1') === null);
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

// Keep the place on return (HQ 2026-11-14-077; DESIGN 2026-11-14-074, -230).
const between = (from, to) => { const a = gallery.indexOf(from); const b = gallery.indexOf(to, a + 1); return a < 0 || b < 0 ? '' : gallery.slice(a, b); };
const restoreEffect = between('const restoredRef = useRef<KeptGallery | null>(null);', '}, [userId]);');
const keptBranch = between('if (kept) {', 'setCursor(null);');
check('keep: leaving the Gallery, or its account, keeps what is loaded, in memory, unless a Clear or a Delete is on its way or nothing is loaded',
  /useLayoutEffect\(\(\) => \(\) => \{\s*if \(!userId \|\| listOwnerRef\.current !== userId \|\| loadingRef\.current \|\| errorRef\.current !== null\s*\|\| clearBusyRef\.current \|\| cardBusyRef\.current\.size > 0 \|\| entriesRef\.current\.length === 0\) \{\s*dropKept\(\);\s*return;\s*\}/.test(gallery) &&
  /keepGallery\(\{\s*userId,\s*entries: entriesRef\.current,\s*pictures,\s*cursor: cursorRef\.current,\s*paged: pagesRef\.current\.length > 1,\s*total: totalRef\.current,\s*filter: filterRef\.current,\s*scrollTop: scrollTopRef\.current,\s*pages: pagesRef\.current,\s*gone: \[\.\.\.goneRef\.current\],\s*emptied: \[\.\.\.emptiedRef\.current\],\s*\}\);\s*\}, \[userId\]\);/.test(gallery) &&
  !/localStorage\.setItem\([^)]*kept|sessionStorage/.test(gallery));
check('keep: a sign-out drops it; a reload never restores it',
  /if \(!userId\) \{\s*dropKept\(\);/.test(gallery) && /const kept = reloads === 0 \? restoredRef\.current : null;/.test(gallery) &&
  gallery.match(/takeKept\(/g)?.length === 1);
check('keep: a return puts the kept list on screen in a layout effect, before the browser paints: no skeleton, its tab, total and paging state, and no focus moves',
  restoreEffect.length > 0 && /useLayoutEffect\(\(\) => \{\s*if \(!userId\) return;\s*const kept = takeKept\(userId\);\s*if \(!kept\) return;/.test(restoreEffect) &&
  /setEntries\(kept\.entries\);\s*setImageUrls\(urls\);\s*setCursor\(kept\.cursor\);\s*setPaged\(kept\.paged\);\s*setTotal\(kept\.total\);\s*setFilter\(kept\.filter\);\s*setLoading\(false\);/.test(restoreEffect) &&
  /restoreRef\.current = kept\.scrollTop;/.test(restoreEffect) && !/focus\(/.test(restoreEffect) && !/focus\(/.test(keptBranch) &&
  /urls\[e\.jobId\] = URL\.createObjectURL\(blob\);/.test(restoreEffect) && /restoredRef\.current = kept;/.test(restoreEffect));
const quietFn = between('const quietRead = useCallback(', '}, [getToken, dropCards, cleanedUrl]);');
check('keep: then the first page, quietly: new ones before the first kept generation, what the server no longer has removed (M1, M2); scrolled down they wait behind "Show 2 new", at the very top or of no kind shown they go in (M4, DESIGN -278), said once (hidden); too many new ones read from the top after a running Clear (L4); a failure tried once more',
  /const \{ fresh, removed, gap \} = quietMerge\(entriesRef\.current, first\.entries, goneRef\.current, first\.cursor === null\);\s*if \(gap\) return 'gap';\s*if \(removed\.length > 0\) dropCards\(removed\);/.test(quietFn) &&
  /if \(scrollTopRef\.current > 0 && \(shown > 0 \|\| pendingRef\.current\.length > 0\)\) \{\s*pendingRef\.current = \[\.\.\.add, \.\.\.pendingRef\.current\];\s*setPending\(pendingRef\.current\);\s*setAnnounce\(newWaitingLine\(pendingRef\.current\.filter\(\(e\) => matchesFilter\(e, filterRef\.current\)\)\.length\)\);\s*\} else \{\s*entriesRef\.current = \[\.\.\.add, \.\.\.entriesRef\.current\];\s*setEntries\(\(prev\) => \[\.\.\.add, \.\.\.prev\]\);/.test(quietFn) && !/anchorRef|firstInView/.test(gallery) &&
  /if \(shown > 0\) setAnnounce\(newAtTopLine\(shown\)\);/.test(quietFn) && /\} catch \{\s*return 'failed';\s*\}/.test(quietFn) &&
  /if \(!alive\(\) \|\| clearDeletingRef\.current\) \{\s*Object\.values\(read\.urls\)\.forEach\(URL\.revokeObjectURL\);\s*return 'ok';\s*\}/.test(quietFn) &&
  /if \(outcome === 'gap'\) \{[\s\S]*?if \(clearBusyRef\.current\) await clearEndRef\.current;\s*if \(!cancelled\) reload\(reloadNoteRef\.current\);/.test(keptBranch) &&
  /if \(outcome === 'failed' && retry\) \{\s*await new Promise\(\(resolve\) => setTimeout\(resolve, 5000\)\);/.test(keptBranch) &&
  /const quiet = quietReadRef\.current\(\);\s*quietRef\.current = quiet;\s*await afterQuiet\(await quiet, true\);/.test(keptBranch));
check('N2, N3 (AUDIT keep-place r2): a first page that is the whole list leaves nothing to read; a Clear that met a gap says why after the read from the top',
  /if \(first\.cursor === null && cursorRef\.current !== null\) \{\s*cursorRef\.current = null;\s*setCursor\(null\);\s*\}/.test(quietFn) &&
  /if \(quiet === 'gap'\) reloadNoteRef\.current = clearFailedLine\(kind\);/.test(clear));
check('M3: after a return a Clear waits for the quiet read, reads the first page itself if it failed, and deletes nothing if it cannot',
  /if \(quietRef\.current\) \{\s*let quiet = await quietRef\.current;\s*if \(quiet === 'failed' && alive\(\)\) \{\s*const again = quietRead\(\);\s*quietRef\.current = again;\s*quiet = await again;\s*\}\s*if \(!alive\(\) \|\| clearRunRef\.current !== run\) return;\s*if \(quiet !== 'ok'\) \{\s*setClearNote\(clearFailedLine\(kind\)\);\s*if \(quiet === 'gap'\) reloadNoteRef\.current = clearFailedLine\(kind\);\s*return;\s*\}\s*\}/.test(clear));
check('C1: a list is drawn and kept only for the account it was read for: the render waits for its own list, a new account or a sign-out empties the list, and the keep is stamped',
  /if \(loading \|\| \(userId !== undefined && listOwner !== \(userId \?\? null\) && !error\)\) \{/.test(gallery) &&
  /listOwnerRef\.current = null;\s*setListOwner\(null\);\s*quietRef\.current = null;\s*entriesRef\.current = \[\];\s*setEntries\(\[\]\);\s*pendingRef\.current = \[\];\s*setPending\(\[\]\);\s*setImageUrls\(\{\}\);/.test(gallery) &&
  /if \(!userId\) \{\s*dropKept\(\);[\s\S]{0,120}listOwnerRef\.current = null;\s*setListOwner\(null\);\s*entriesRef\.current = \[\];\s*setEntries\(\[\]\);\s*pendingRef\.current = \[\];\s*setPending\(\[\]\);\s*setImageUrls\(\{\}\);/.test(gallery) &&
  /const waitingShown = listOwner === userId \? pending\.filter/.test(gallery) &&
  /listOwnerRef\.current = kept\.userId;\s*setListOwner\(kept\.userId\);\s*loadingRef\.current = false;\s*errorRef\.current = null;/.test(restoreEffect) && /goneRef\.current = new Set\(kept\.gone\);\s*emptiedRef\.current = kept\.emptied;\s*setEmptied\(kept\.emptied\);/.test(restoreEffect) &&
  /loadingRef\.current = loading;\s*errorRef\.current = error;/.test(gallery));
check('keep: the kept place is put back once the list is on screen, and once more on the next frame if the router moved it',
  /const want = restoreRef\.current;\s*if \(want === null \|\| loading\) return;\s*const main = endRef\.current\?\.closest\('main'\);\s*if \(!main\) return;\s*restoreRef\.current = null;\s*main\.scrollTop = want;\s*requestAnimationFrame\(\(\) => \{\s*if \(main\.isConnected && Math\.abs\(main\.scrollTop - want\) > 1\) main\.scrollTop = want;\s*\}\);\s*\}, \[loading, entries\]\);/.test(gallery) &&
  /const onScroll = \(\) => \{\s*scrollTopRef\.current = main\.scrollTop;/.test(gallery) && /main\.addEventListener\('scroll', onScroll, \{ passive: true \}\);/.test(gallery));
const header = stripComments(fs.readFileSync(path.join(ROOT, 'src/components/layout/Header.tsx'), 'utf8'));
check('keep: waiting new generations (DESIGN 2026-11-14-278): "Show 2 new" in the top bar\'s slot, never over a card; pressed, they go in on top, the page goes to the top and the first takes the focus; at the very top, on a tab and before a Clear counts they go in; counted only once in',
  /<div id="header-actions" className="flex min-w-0 items-center" \/>/.test(header) &&
  /setHeaderSlot\(document\.getElementById\?\.\('header-actions'\) \?\? null\);/.test(gallery) &&
  /\{showNewButton && \(headerSlot \? createPortal\(showNewButton, headerSlot\) : showNewButton\)\}/.test(gallery) &&
  /aria-label=\{showNewName\(waitingShown\)\}/.test(gallery) && /\{showNewLabel\(waitingShown\)\}/.test(gallery) &&
  /const add = pendingRef\.current;\s*if \(add\.length === 0\) return add;\s*pendingRef\.current = \[\];\s*setPending\(\[\]\);\s*entriesRef\.current = \[\.\.\.add, \.\.\.entriesRef\.current\];\s*setEntries\(\(prev\) => \[\.\.\.add, \.\.\.prev\]\);\s*if \(totalRef\.current !== null\) \{\s*totalRef\.current \+= add\.length;/.test(gallery) &&
  /const showNew = useCallback\(\(\) => \{\s*const add = flushPending\(\);\s*const first = add\.find\(\(e\) => matchesFilter\(e, filterRef\.current\)\);\s*setAnnounce\(''\);\s*toTopRef\.current = true;\s*focusCardRef\.current = first \? first\.jobId : null;/.test(gallery) &&
  /if \(!toTopRef\.current\) return;\s*toTopRef\.current = false;\s*const main = endRef\.current\?\.closest\('main'\);\s*if \(main\) main\.scrollTop = 0;\s*\}, \[entries\]\);/.test(gallery) &&
  gallery.indexOf('if (!toTopRef.current) return;') < gallery.indexOf('const jobId = focusCardRef.current;') &&
  /if \(main\.scrollTop > 0 \|\| pendingRef\.current\.length === 0\) return;\s*const shown = flushPending\(\)\.filter/.test(gallery) &&
  /onClick=\{\(\) => \{\s*flushPending\(\);\s*setFilter\(mode\);/.test(gallery) &&
  /flushPending\(\);\s*const result = await clearGallery\(\{/.test(clear) &&
  /lowerTotal\(ids\.filter\(\(id\) => !goneRef\.current\.has\(id\) && !waiting\.has\(id\)\)\.length\);/.test(gallery));
check('keep: every picture\'s bytes and the pages read are tracked, and leave with a deleted entry or a reload',
  /blobs\[e\.jobId\] = blob;/.test(gallery) && /return \{ urls, stored, blobs \};/.test(gallery) &&
  /delete storedRef\.current\[id\];\s*delete blobsRef\.current\[id\];/.test(gallery) &&
  /blobsRef\.current = \{\};\s*pagesRef\.current = \[\];\s*entriesRef\.current = \[\];\s*setEntries\(\[\]\);/.test(gallery) &&
  /pagesRef\.current = \[\{ ids: fetched\.map\(\(e\) => e\.jobId\), cursor: first\.cursor \}\];/.test(gallery) &&
  /pagesRef\.current = \[\.\.\.pagesRef\.current, \{ ids: read\.map\(\(e\) => e\.jobId\), cursor: next \}\];/.test(pass));
check('L1: Clear all reads how many the server deleted, and says so when that is more than it counted',
  /if \(resp\.ok\) \{\s*const body: unknown = await resp\.json\(\)\.catch\(\(\) => null\);\s*const deleted = body && typeof body === 'object' \? \(body as \{ deleted\?: unknown \}\)\.deleted : undefined;\s*if \(typeof deleted === 'number' && Number\.isInteger\(deleted\) && deleted >= 0\) deletedAllRef\.current = deleted;\s*\}/.test(clear) &&
  /\} else if \(result\.state === 'done' && kind === 'all'\) \{\s*const deleted = deletedAllRef\.current \?\? result\.asked;\s*if \(deleted > 0\) setCleared\(clearedLine\(deleted, result\.asked\)\);/.test(clear) &&
  /deletedAllRef\.current = null;/.test(clear));
check('L3, the logged case: the line stands beside "Load more" until the next pass or tab, and is said once',
  /setNoneNext\(endState\.filter !== 'all' && endState\.shown > 0 && endState\.more && endState\.added === 0 && result\.read > 0\s*\? noneNextLine\(endState\.filter, result\.read\) : ''\);/.test(pass) &&
  /\{!noneLine && noneNext && offersMore && paging === 'idle' && \(\s*<p aria-hidden="true" className="basis-full text-center text-\[13px\] text-text-secondary">\{noneNext\}<\/p>\s*\)\}/.test(gallery) &&
  /setNoneNext\(''\);\s*const result = await runGalleryPass</.test(pass));
check('L3-1: a lost Delete answer during a running Clear waits for the Clear\'s last answer before the gallery is read again',
  /clearEndRef\.current = new Promise<void>\(\(resolve\) => \{ ended = resolve; \}\);/.test(clear) && /if \(clearBusyRef\.current\) await clearEndRef\.current;/.test(single));

check('the page reads the list through one function that follows the cursor',
  /const after = cursor === null \? '' : `&cursor=\$\{encodeURIComponent\(cursor\)\}`;/.test(gallery) &&
  /fetch\(`\/api\/gallery\?limit=\$\{GALLERY_PAGE_SIZE\}\$\{after\}`/.test(gallery) &&
  /if \(!resp\.ok\) throw new Error/.test(gallery) && /cursor: body\.cursor \?\? null/.test(gallery) &&
  !/limit=50/.test(gallery) && gallery.match(/\/api\/gallery\?/g)?.length === 1);
check('the first read keeps its cursor, its list and the ids it showed, together',
  /const first = await readListPage\(token, null\);/.test(gallery) &&
  /knownRef\.current = new Set\(fetched\.map\(\(e\) => e\.jobId\)\);\s*cursorRef\.current = first\.cursor;\s*entriesRef\.current = fetched;\s*listOwnerRef\.current = userId;\s*setListOwner\(userId\);\s*loadingRef\.current = false;\s*setEntries\(fetched\);/.test(gallery) &&
  /setCursor\(first\.cursor\);/.test(gallery));
check('a new account, a fresh read or a reload starts the paging, Clear and the cards\' own states over',
  /setCursor\(null\);\s*cursorRef\.current = null;\s*knownRef\.current = new Set\(\);\s*goneRef\.current = new Set\(\);/.test(gallery) &&
  /setClearing\(null\);\s*setClearNote\(reloadNoteRef\.current\);\s*reloadNoteRef\.current = '';\s*setCleared\(''\);\s*setLandingHeld\(false\);\s*setEmptied\(\[\]\);\s*emptiedRef\.current = \[\];\s*setTotal\(null\);\s*totalRef\.current = null;\s*setCardState\(\{\}\);\s*cardBusyRef\.current = new Set\(\);\s*clearBusyRef\.current = false;\s*clearDeletingRef\.current = false;\s*failedRef\.current = false;\s*setNoneNext\(''\);\s*blobsRef\.current = \{\};\s*pagesRef\.current = \[\];\s*setLoading\(true\);\s*setError\(null\);/.test(gallery) &&
  /const kept = reloads === 0 \? restoredRef\.current : null;\s*restoredRef\.current = null;\s*if \(kept\) \{/.test(gallery) &&
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
  /if \(!end \|\| loading \|\| landingHeld \|\| cursor === null \|\| paging !== 'idle' \|\| clearing \|\| emptied\.includes\(filter\)\s*\|\| typeof IntersectionObserver === 'undefined'\) return;/.test(gallery));
check('the next page starts when the grid\'s end is about one screen away in the page\'s scroller',
  /\{ root: end\.closest\('main'\), rootMargin: '0px 0px 100% 0px' \}/.test(gallery) &&
  /let armed = !capped;/.test(gallery) && /if \(!record\.isIntersecting\) armed = true;\s*else if \(armed\) void runPass\('more'\);/.test(gallery));
check('a filter that shows less than a screenful reads on; a new filter lifts the cap and clears what was said',
  /if \(loading \|\| landingHeld\) return;\s*void runPass\('filter'\);\s*\}, \[filter, loading, landingHeld, runPass\]\);/.test(gallery) &&
  /setFilter\(mode\);\s*setLandingHeld\(false\);\s*setCapped\(false\);\s*setAnnounce\(''\);\s*setNoneNext\(''\);\s*setClearNote\(''\);/.test(gallery));
check('L3: when a pass ends, the status says what came or the line now standing in its place; under a kind a Clear emptied that line is the end line (G2-6)',
  /const endState = \{\s*added: result\.added,\s*filter: filterRef\.current,\s*shown: shown\(\),\s*read: entriesRef\.current\.length,\s*more: cursorRef\.current !== null && !kindDone\(\),\s*readThisPass: result\.read,\s*\};\s*const endLine = passEndLine\(endState\);\s*setAnnounce\(endLine\);/.test(pass) &&
  /stop: kindDone,/.test(pass) &&
  /const kindDone = \(\) => emptiedRef\.current\.includes\(filterRef\.current\);/.test(pass) &&
  /shown: \(\) => \(kindDone\(\) \? Number\.MAX_SAFE_INTEGER : shown\(\)\),/.test(pass));
check('the count line is the module\'s, with the total a Clear counted; each deleted generation lowers that total once (G2-5)',
  /\{countLine\(entries\.length, cursor !== null, total\)\}/.test(gallery) && !/synced to your account/.test(gallery) &&
  /counted: \(count\) => \{\s*if \(!alive\(\)\) return;\s*totalRef\.current = count;\s*setTotal\(count\);\s*\},/.test(clear) &&
  /const gone = new Set\(ids\);\s*const waiting = new Set\(pendingRef\.current\.filter\(\(e\) => gone\.has\(e\.jobId\)\)\.map\(\(e\) => e\.jobId\)\);\s*lowerTotal\(ids\.filter\(\(id\) => !goneRef\.current\.has\(id\) && !waiting\.has\(id\)\)\.length\);[\s\S]{0,200}ids\.forEach\(\(id\) => \{\s*goneRef\.current\.add\(id\);/.test(gallery) &&
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
  /\{clearNote && <p role="status" className="text-\[13px\] text-text-secondary max-w-md">\{clearNote\}<\/p>\}/.test(gallery) && gallery.match(/role="status"/g)?.length === 5);
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
  /ask: \(question, ids\) => \{\s*const yes = confirm\(question\);\s*if \(yes && slicerJobRef\.current !== null && ids\.includes\(slicerJobRef\.current\)\) setSlicerAside\(\);\s*return yes;\s*\},/.test(clear) &&
  /ask: \(\) => \{\s*const yes = confirm\('Delete this generation\? This cannot be undone\.'\);\s*if \(yes && slicerJobRef\.current === jobId\) setSlicerAside\(\);\s*return yes;\s*\},/.test(single) &&
  gallery.match(/ownership\.slicer\(\)/g)?.length === 1);
// AUDIT gallery-paging-r2, G2-11 (the half logged): a Send to Slicer set
// aside at a yes comes back when its generation was not deleted.
check('G2-11: a Send to Slicer set aside at a yes is sent again when its generation was not deleted; never after an answer that was lost',
  /const setSlicerAside = useCallback\(\(\) => \{\s*const id = slicerJobRef\.current;\s*heldSlicerRef\.current = id \? entriesRef\.current\.find\(\(e\) => e\.jobId === id\) \?\? null : null;\s*slicerJobRef\.current = null;\s*ownership\.slicer\(\);\s*\}, \[ownership\]\);/.test(gallery) &&
  /const entry = heldSlicerRef\.current;\s*heldSlicerRef\.current = null;\s*if \(!entry \|\| goneRef\.current\.has\(entry\.jobId\) \|\| slicerJobRef\.current !== null\) return;\s*slicerJobRef\.current = entry\.jobId;\s*void handleSendToSlicer\(entry\);/.test(gallery) &&
  /ended\(\);\s*if \(alive\(\)\) sendSlicerAgain\(\);/.test(clear) &&
  /else if \(result\.state === 'unconfirmed'\) \{\s*heldSlicerRef\.current = null;\s*reload\(clearUnconfirmedLine\(\)\);/.test(clear) &&
  /\} else if \(outcome === 'unknown'\) \{\s*heldSlicerRef\.current = null;/.test(single));
// Clear in the page: the module does it; the page only hands it its calls.
check('M6: Clear is the module\'s, whole: the page counts nothing, asks nothing and deletes nothing outside it',
  /const result = await clearGallery\(\{/.test(clear) && gallery.match(/clearGallery\(/g)?.length === 1 &&
  !/readRest\(|clearQuestion\(/.test(gallery) && gallery.match(/confirm\(/g)?.length === 2 && /ask: \(question, ids\) => \{\s*const yes = confirm\(question\);/.test(clear) &&
  gallery.match(/method: 'DELETE'/g)?.length === 3);
check('GP-A: each delete fetches its sign-in token at the call, inside the port; its answer is read by the module\'s rule; ids are encoded and an empty id is never sent (G2-9)',
  /deleteAll: async \(\) => \{\s*const token = await getToken\(\);\s*if \(!token\) return 'refused';\s*const resp = await fetch\('\/api\/gallery', \{ method: 'DELETE', headers: \{ Authorization: `Bearer \$\{token\}` \} \}\);[\s\S]*?return deleteOutcome\(\{ ok: resp\.ok, status: resp\.status, body: null \}, false\);\s*\},/.test(clear) &&
  /deleteOne: async \(jobId\) => \{\s*if \(!jobId\) return 'refused';\s*const token = await getToken\(\);\s*if \(!token\) return 'refused';\s*const resp = await fetch\(`\/api\/gallery\/\$\{encodeURIComponent\(jobId\)\}`, \{ method: 'DELETE', headers: \{ Authorization: `Bearer \$\{token\}` \} \}\);\s*return deleteOutcome\(\{ ok: resp\.ok, status: resp\.status, body: resp\.ok \? null : await resp\.json\(\)\.catch\(\(\) => null\) \}, true\);\s*\},/.test(clear) &&
  clear.match(/await getToken\(\)/g)?.length === 3 && clear.indexOf('await getToken()') > clear.indexOf('const result = await clearGallery({') &&
  !/resp\.status === 404/.test(gallery));
check('GP-A, G2-1: nothing leaves the page before the server has deleted it: cards go only through dropCards, called from the module\'s "removed" for Clear and for a single Delete',
  gallery.match(/dropCards\(/g)?.length === 3 && /if \(removed\.length > 0\) dropCards\(removed\);/.test(gallery) && /removed: \(ids, all\) => \{\s*if \(!alive\(\)\) return;\s*dropCards\(ids\);/.test(clear) && /removed: \(\) => dropCards\(\[jobId\]\),/.test(single) &&
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
  /\} finally \{\s*if \(clearRunRef\.current === run\) \{\s*clearBusyRef\.current = false;\s*clearDeletingRef\.current = false;\s*if \(alive\(\)\) setClearing\(null\);\s*\}\s*ended\(\);/.test(clear));
check('M3, G2-2: the button is busy from the press to the last answer; what the server kept is said; an answer that could not be confirmed reads the gallery again and says so',
  /if \(passRef\.current \|\| cursorRef\.current !== null \|\| quietRef\.current\) setClearing\(\{ phase: 'reading', filter: kind, count: 0 \}\);/.test(clear) &&
  /aria-disabled=\{clearing \|\| nothingToClear \? true : undefined\}\s*aria-busy=\{clearing \? true : undefined\}/.test(gallery) &&
  /else if \(result\.state === 'partial' \|\| result\.state === 'failed'\) setClearNote\(clearKeptLine\(result\.kept, result\.asked, kind\)\);/.test(clear) &&
  /else if \(result\.state === 'unconfirmed'\) \{\s*heldSlicerRef\.current = null;\s*reload\(clearUnconfirmedLine\(\)\);/.test(clear) &&
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
  /if \(outcome === 'refused'\) \{\s*mark\('failed'\);\s*setAnnounce\(DELETE_FAILED_LINE\);\s*sendSlicerAgain\(\);\s*\} else if \(outcome === 'unknown'\) \{\s*heldSlicerRef\.current = null;\s*if \(clearBusyRef\.current\) await clearEndRef\.current;\s*if \(alive\(\)\) reload\(clearUnconfirmedLine\(\)\);\s*\} else \{\s*sendSlicerAgain\(\);\s*\}/.test(single) &&
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
  gallery.match(/role="status"/g)?.length === 5);
check('Clear all that empties the Gallery: "Gallery cleared" and the deleted line in place of the usual words, the more line when the server deleted more (DESIGN 2026-11-14-243)',
  CLEARED_HEADING === 'Gallery cleared' && clearedLine(178, 178) === 'Deleted 178 generations.' && clearedLine(1, 1) === 'Deleted 1 generation.' &&
  clearedLine(180, 178) === 'Deleted 180 generations, including 2 made after you pressed Clear all.' && clearedLine(176, 178) === 'Deleted 176 generations.' &&
  /\{cleared \? \(\s*<>\s*<h2 className="text-xl font-semibold text-text-primary">\{CLEARED_HEADING\}<\/h2>\s*<p role="status" className="text-sm text-text-secondary max-w-md">\{cleared\}<\/p>\s*<\/>\s*\) : \(/.test(gallery) &&
  /setClearNote\(''\);\s*setCleared\(''\);/.test(gallery) && !gallery.includes('clearMoreLine('));
check('the usual empty words carry no em dash: two sentences (DESIGN 2026-11-14-243, HQ -245)',
  gallery.includes('Your gallery syncs across devices. Sign in anywhere and your work is here.') && !source.split('\n').some((line) => /syncs across devices/.test(line) && line.includes(String.fromCharCode(0x2014))));
check('a return lands without reading on: the scroll-in read and a filter reading on wait for the person\'s own first scroll or a tab; "Load more" works as ever (DESIGN 2026-11-14-243)',
  /restoredRef\.current = kept;\s*setLandingHeld\(true\);/.test(gallery) &&
  /if \(!landingHeld\) return;[\s\S]{0,200}const keys = new Set\(\['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '\]\);\s*const release = \(\) => setLandingHeld\(false\);\s*const onKey = \(e: KeyboardEvent\) => \{ if \(keys\.has\(e\.key\)\) release\(\); \};\s*const onPointer = \(e: PointerEvent\) => \{ if \(e\.target === main\) release\(\); \};\s*main\.addEventListener\('wheel', release, \{ passive: true \}\);\s*main\.addEventListener\('touchmove', release, \{ passive: true \}\);\s*window\.addEventListener\('keydown', onKey\);\s*main\.addEventListener\('pointerdown', onPointer\);/.test(gallery) &&
  !/addEventListener\('scroll', release/.test(gallery) && gallery.match(/runPass\('more', true\)/g)?.length === 1);
check('the module has no React and no DOM calls', !/from 'react'|document\.|window\.|fetch\(|confirm\(/.test(lib));
check('no em dashes in the new file or the lines this change wrote', !lib.includes(String.fromCharCode(0x2014)) && !source.split('\n').some((line) => /readPictures|Filtered scope/.test(line) && line.includes(String.fromCharCode(0x2014))));

console.log(`\n${pass_} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
