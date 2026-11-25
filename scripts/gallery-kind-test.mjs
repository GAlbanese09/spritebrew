// scripts/gallery-kind-test.mjs
//
// The Gallery's kinds (external product audit r2, SB-24): Animate from Text
// writes a create job whose style is an animation, so the Gallery shows a
// card by what it holds, not by how it was billed. A create job with an
// animation style (`animation__...`) is Animated, like an animate job;
// everything else a create job made is Created. Filters, paging and the
// badge use the kind; downloads keep the job's own mode. Old and new
// records alike: the kind is worked out on read. Runs src/lib/galleryPaging.ts
// and checks the Gallery by text. Run from the repo root:
// `node scripts/gallery-kind-test.mjs`. Bundles with esbuild into
// local/.gallery-kind-test/ (gitignored). Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.gallery-kind-test');
fs.mkdirSync(OUT_DIR, { recursive: true });
const outfile = path.join(OUT_DIR, 'galleryPaging.mjs');
await build({ entryPoints: [path.join(ROOT, 'src/lib/galleryPaging.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
const G = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
}
const entry = (jobId, mode, style, extra = {}) => ({ jobId, prompt: jobId, style, mode, createdAt: 1, v: 1, ...extra });
const still = entry('still', 'create', 'rd_fast__default');
const textWalk = entry('text-walk', 'create', 'animation__four_angle_walking');
const artWalk = entry('art-walk', 'animate', 'rd_advanced_animation__walking', { action: 'walking' });
// An old record: written before Animate from Text existed, by the Create
// form's own animation styles, with no `action`.
const oldVfx = entry('old-vfx', 'create', 'animation__vfx');
const oldStill = entry('old-still', 'create', 'rd_pro__fantasy');
const noStyle = { jobId: 'no-style', prompt: 'x', mode: 'create', createdAt: 1, v: 1 };

check('1: entryKind is exported', typeof G.entryKind === 'function');
if (typeof G.entryKind === 'function') {
  check('2: a still is Created; a text walk and an uploaded-art walk are Animated; old records likewise',
    G.entryKind(still) === 'create' && G.entryKind(textWalk) === 'animate' && G.entryKind(artWalk) === 'animate'
    && G.entryKind(oldVfx) === 'animate' && G.entryKind(oldStill) === 'create',
    [still, textWalk, artWalk, oldVfx, oldStill].map((e) => G.entryKind(e)));
}
const ids = (list, f) => list.filter((e) => G.matchesFilter(e, f)).map((e) => e.jobId);
const all = [still, textWalk, artWalk, oldVfx, oldStill];
check('2b: a record without a style counts by its mode and does not throw', (() => { try { return G.entryKind(noStyle) === 'create' && G.matchesFilter(noStyle, 'create'); } catch { return false; } })());
check('2c: the rule\'s edges: only a style that starts with "animation__", in that case, counts (AUDIT ext-mediums r1 L1)',
  typeof G.entryKind === 'function' && ['xanimation__vfx', 'Animation__vfx', 'animation_vfx', 'rd_animation__x'].every((st) => G.entryKind(entry('e', 'create', st)) === 'create'));
check('2d: a record of an unknown mode, or none, shows under neither kind, as before (L3)',
  ['pack', undefined].every((m) => { const e = { jobId: 'u', prompt: 'u', style: 'animation__vfx', mode: m, createdAt: 1, v: 1 };
    return G.matchesFilter(e, 'all') && !G.matchesFilter(e, 'create') && !G.matchesFilter(e, 'animate'); }));
check('3: Animated shows both animations and the old VFX; Created shows the stills only',
  JSON.stringify(ids(all, 'animate')) === '["text-walk","art-walk","old-vfx"]' && JSON.stringify(ids(all, 'create')) === '["still","old-still"]',
  { animate: ids(all, 'animate'), create: ids(all, 'create') });

// Counts agree across pages: three pages read by a pass under Animated add
// exactly the Animated cards, as the whole list filtered at once.
{
  const pages = [[still, textWalk], [artWalk, oldStill], [oldVfx]];
  const added = [];
  let cursor = 'p0';
  const result = await G.runGalleryPass('filter', {
    cursor: () => cursor,
    known: () => new Set(added.map((e) => e.jobId)),
    matches: (e) => G.matchesFilter(e, 'animate'),
    shown: () => added.filter((e) => G.matchesFilter(e, 'animate')).length,
    read: async (c) => {
      const i = Number(c.slice(1));
      return { entries: pages[i], cursor: i + 1 < pages.length ? `p${i + 1}` : null };
    },
    pictures: async () => ({}),
    current: () => true,
    commit: ({ fresh, cursor: next }) => { added.push(...fresh); cursor = next; },
    drop: () => {},
  }).catch((e) => ({ error: String(e) }));
  const animatedShown = added.filter((e) => G.matchesFilter(e, 'animate')).length;
  check('4: a pass under Animated over three pages shows the three animations, as the list filtered whole', animatedShown === 3 && result.added === 3 && animatedShown === ids(all, 'animate').length, { result, animatedShown });
}

// A kind's Clear deletes exactly what its filter shows, the unread page
// included (L1): ids asked about and deleted equal the filter's.
for (const filter of ['create', 'animate']) {
  const shown = [still, textWalk];
  const unread = [artWalk, oldStill, oldVfx, noStyle];
  const asked = [];
  const deleted = [];
  const questions = [];
  const kinds = [];
  const res = await G.clearGallery({
    filter,
    settled: async () => {},
    snapshot: () => ({ entries: shown, cursor: 'p1' }),
    gone: () => new Set(),
    read: async () => ({ entries: unread, cursor: null }),
    ask: (q, ids) => { questions.push(q); asked.push(...ids); return true; },
    current: () => true,
    deleteAll: async () => 'deleted',
    deleteOne: async (id, kind) => { deleted.push(id); kinds.push(kind); return 'deleted'; },
    removed: () => {},
    phase: () => {},
    counted: () => {},
  });
  const want = [...shown, ...unread].filter((e) => G.matchesFilter(e, filter)).map((e) => e.jobId).sort();
  check(`4${filter === 'create' ? 'b' : 'c'}: Clear ${filter === 'create' ? 'Created' : 'Animated'} asks about and deletes exactly what its filter shows, the unread page included`,
    res.state === 'done' && JSON.stringify([...asked].sort()) === JSON.stringify(want) && JSON.stringify([...deleted].sort()) === JSON.stringify(want),
    { asked, deleted, want });
  check(`4${filter === 'create' ? 'd' : 'e'}: every delete of that Clear carries its kind (HQ 2026-11-25-079)`, kinds.length > 0 && kinds.every((k) => k === filter), kinds);
  const wantQ = filter === 'animate'
    ? 'Delete all 3 Animated generations? It includes 2 Animate from Text results and older Creates made with an animation style. The other 3 stay. This cannot be undone.'
    : 'Delete all 3 Created generations? The other 3 stay. This cannot be undone.';
  check(`4${filter === 'create' ? 'f' : 'g'}: the question ${filter === 'animate' ? 'says how many moved items it holds (HQ -076 (b), DESIGN -080)' : 'is unchanged under Created'}`, questions[0] === wantQ, questions);
}

// The clause's forms (DESIGN 2026-11-25-080): the split between Animate from
// Text and older Creates is not known from a record (both used the same
// styles), so the combined form; its singular; none when nothing moved.
check('4h: the clause, plural and singular, only under Animated and only with moved items',
  G.clearQuestion(100, 'animate', 100, 50) === 'Delete all 100 Animated generations? It includes 50 Animate from Text results and older Creates made with an animation style. The other 100 stay. This cannot be undone.'
  && G.clearQuestion(5, 'animate', 0, 1) === 'Delete all 5 Animated generations? It includes 1 Animate from Text result or older Create made with an animation style. This cannot be undone.'
  && G.clearQuestion(5, 'animate', 2, 0) === 'Delete all 5 Animated generations? The other 2 stay. This cannot be undone.'
  && G.clearQuestion(5, 'create', 2, 3) === 'Delete all 5 Created generations? The other 2 stay. This cannot be undone.');

// A refused item (409) is a stale page: nothing deleted for it, and the page
// says to reload, not "may have gone through".
check('4i: the route\'s own 409 (its body marked stale) reads as stale', G.deleteOutcome({ ok: false, status: 409, body: { error: 'Reload the Gallery and try again.', stale: true } }, true) === 'stale');
check('4i2: any other 409, or one on delete-everything, stays unknown (AUDIT ext-mediums r2 L2, L3)',
  G.deleteOutcome({ ok: false, status: 409, body: null }, true) === 'unknown' && G.deleteOutcome({ ok: false, status: 409, body: { error: 'x' } }, true) === 'unknown'
  && G.deleteOutcome({ ok: false, status: 409, body: { stale: true } }, false) === 'unknown');
{
  const res = await G.clearGallery({
    filter: 'animate', settled: async () => {}, snapshot: () => ({ entries: [textWalk, artWalk, oldVfx], cursor: null }), gone: () => new Set(),
    read: async () => ({ entries: [], cursor: null }), ask: () => true, current: () => true, deleteAll: async () => 'deleted',
    deleteOne: async (id) => (id === 'art-walk' ? 'stale' : 'deleted'), removed: () => {}, phase: () => {}, counted: () => {},
  });
  check('4j: one stale item: the Clear ends stale, 2 deleted, 1 stale, none refused', res.state === 'stale' && res.deleted === 2 && res.stale === 1 && res.refused === 0, res);
  // DESIGN 2026-11-25-082: the words; the stale and the refused counted apart (AUDIT ext-mediums r2 L1).
  const L = G.clearStaleLine;
  check('4k: the lines for a stale Clear, in DESIGN\'s words, with the right numbers', typeof L === 'function'
    && L({ asked: 3, deleted: 0, stale: 3, refused: 0 }, 'animate') === 'Nothing was deleted, because this page is out of date. Reload the Gallery and try again.'
    && L({ asked: 3, deleted: 2, stale: 1, refused: 0 }, 'animate') === 'Deleted 2 of 3 Animated generations. The other 1 was not deleted, because this page is out of date. Reload the Gallery and try again.'
    && L({ asked: 9, deleted: 4, stale: 5, refused: 0 }, 'create') === 'Deleted 4 of 9 Created generations. The other 5 were not deleted, because this page is out of date. Reload the Gallery and try again.');
  check('4k2: with sign-in refusals among them, out of date names only the stale ones (L1)',
    L({ asked: 45, deleted: 15, stale: 15, refused: 15 }, 'animate') === 'Deleted 15 of 45 Animated generations. 15 were not deleted, because this page is out of date, and 15 did not go through. Reload the Gallery and try again.'
    && L({ asked: 45, deleted: 0, stale: 1, refused: 44 }, 'animate') === 'None of the 45 Animated generations were deleted: 1 because this page is out of date, and 44 because the request did not go through. Reload the Gallery and try again.'
    && L({ asked: 3, deleted: 0, stale: 2, refused: 1 }, 'create') === 'None of the 3 Created generations were deleted: 2 because this page is out of date, and 1 because the request did not go through. Reload the Gallery and try again.');
  const mixed = await G.clearGallery({
    filter: 'animate', settled: async () => {}, snapshot: () => ({ entries: [textWalk, artWalk, oldVfx], cursor: null }), gone: () => new Set(),
    read: async () => ({ entries: [], cursor: null }), ask: () => true, current: () => true, deleteAll: async () => 'deleted',
    deleteOne: async (id) => (id === 'art-walk' ? 'stale' : id === 'old-vfx' ? 'refused' : 'deleted'), removed: () => {}, phase: () => {}, counted: () => {},
  });
  check('4k3: a Clear with one stale and one refused counts them apart', mixed.state === 'stale' && mixed.deleted === 1 && mixed.stale === 1 && mixed.refused === 1, mixed);
  const all = await G.clearGallery({
    filter: 'all', settled: async () => {}, snapshot: () => ({ entries: [still, textWalk], cursor: null }), gone: () => new Set(),
    read: async () => ({ entries: [], cursor: null }), ask: () => true, current: () => true, deleteAll: async () => 'stale',
    deleteOne: async () => 'deleted', removed: () => {}, phase: () => {}, counted: () => {},
  });
  check('4l: Clear all ends done only on deleted; anything else is not done (L4)', all.state !== 'done' && all.deleted === 0, all);
}
check('4m: a set of one, itself moved, says what it is (AUDIT ext-mediums r2 L8)',
  G.clearQuestion(1, 'animate', 3, 1) === 'Delete 1 Animated generation? It is an Animate from Text result or an older Create made with an animation style. The other 3 stay. This cannot be undone.');

{
  const page = fs.readFileSync(path.join(ROOT, 'src/app/gallery/page.tsx'), 'utf8');
  check('5: the Gallery\'s filtered list, badge and card name use the kind',
    /entries\.filter\(\(e\) => matchesFilter\(e, filter\)\)/.test(page) && !/entries\.filter\(\(e\) => e\.mode === filter\)/.test(page)
    && /const kind = entryKind\(entry\);/.test(page) && /aria-label=\{`\$\{entry\.prompt\}, \$\{kind === 'create' \? 'Created' : 'Animated'\}`\}/.test(page)
    && /\{kind === 'create' \? 'Created' : \(/.test(page));
  check('5b: an Animated card shows the play mark only when it plays, an animate job; Animate from Text cards show none (AUDIT ext-mediums r1 L5, DESIGN 2026-11-25-074 (a))',
    /\{entry\.mode === 'animate' && <Play size=\{10\} className="inline mr-1" aria-hidden="true" \/>\}/.test(page));
  check('5d: a card\'s own Delete reads stale as it reads unknown (L3), and an id of "." or ".." is never sent (L7)',
    /\} else if \(outcome === 'unknown' \|\| outcome === 'stale'\) \{/.test(page) && /if \(!jobId \|\| jobId === '\.' \|\| jobId === '\.\.'\) return 'refused';/.test(page));
  check('5c: a kind\'s Clear sends its kind with each delete, and a stale Clear shows its line',
    /fetch\(`\/api\/gallery\/\$\{encodeURIComponent\(jobId\)\}\?kind=\$\{encodeURIComponent\(kind\)\}`/.test(page)
    && /else if \(result\.state === 'stale'\) setClearNote\(clearStaleLine\(result, kind\)\);/.test(page));
  check('6: downloads and stored pictures keep the job\'s own mode', /if \(e\.mode === 'animate'\) stored\[e\.jobId\] = blob;/.test(page) && /entry\.mode === 'animate' \? cleanedUrl\(entry\.jobId\)/.test(page));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
