// scripts/editor-drafts-test.mjs
//
// Offline tests for src/lib/editorRecovery/drafts.ts (BUILD 2026-10-29):
// which saved editor drafts are offered to whom, the newest-first order and
// the cap, which draft Generate offers, and the restore messages' words.
// Run from the repo root: `node scripts/editor-drafts-test.mjs`. Bundles the
// module with esbuild into local/.editor-drafts-test/ (gitignored) and
// prints only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.editor-drafts-test', 'drafts.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/lib/editorRecovery/drafts.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
});
const D = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TIMES = String.fromCharCode(0xd7);
const DOT = String.fromCharCode(0xb7);

const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const MIN = 60_000;
const m = (id, { owner, updatedAt = NOW, closedAt, kind = 'generation', w = 512, h = 512 } = {}) => ({
  draftId: id, projectKey: id, updatedAt, createdAt: updatedAt,
  summary: { width: w, height: h, frameCount: 1 },
  project: { source: kind ? { kind } : undefined },
  ...(owner === undefined ? {} : { owner }),
  ...(closedAt === undefined ? {} : { closedAt }),
});

// 1. Keys.
{
  const a = D.newDraftKey('modal');
  const b = D.newDraftKey('modal');
  const p = D.newDraftKey('page');
  check('a new session key names its surface and is new each time',
    a.startsWith('modal:') && p.startsWith('page:') && a !== b, { a, b, p });
}

// 2. Who sees which drafts, in what order.
{
  const all = [
    m('old-a', { owner: 'user_a', updatedAt: NOW - 50 * MIN }),
    m('legacy', { updatedAt: NOW - 10 * 24 * 60 * MIN }),
    m('new-a', { owner: 'user_a', updatedAt: NOW - 1 * MIN }),
    m('b', { owner: 'user_b', updatedAt: NOW - 2 * MIN }),
    m('anon', { owner: null, updatedAt: NOW - 3 * MIN }),
  ];
  check("an account sees its own drafts and the device's drafts no account owns (made signed out, or from before owners), newest first; never another account's",
    same(D.draftsFor(all, 'user_a').map((x) => x.draftId), ['new-a', 'anon', 'old-a', 'legacy']), D.draftsFor(all, 'user_a').map((x) => x.draftId));
  check('signed out sees drafts made signed out, and drafts from before owners',
    same(D.draftsFor(all, null).map((x) => x.draftId), ['anon', 'legacy']), D.draftsFor(all, null).map((x) => x.draftId));
  const many = Array.from({ length: 8 }, (_, i) => m(`d${i}`, { owner: 'user_a', updatedAt: NOW - i * MIN }));
  check(`at most ${D.MAX_DRAFTS} drafts are listed, the newest`,
    D.MAX_DRAFTS === 5 && same(D.draftsFor(many, 'user_a').map((x) => x.draftId), ['d0', 'd1', 'd2', 'd3', 'd4']));
}

// 3. What Generate offers.
{
  const all = [
    m('closed-newest', { owner: 'user_a', updatedAt: NOW - 1 * MIN, closedAt: NOW }),
    m('crashed', { owner: 'user_a', updatedAt: NOW - 5 * MIN }),
    m('crashed-older', { owner: 'user_a', updatedAt: NOW - 9 * MIN }),
    m('legacy', { updatedAt: NOW }),
    m('b-crashed', { owner: 'user_b', updatedAt: NOW }),
  ];
  check("Generate offers the account's newest draft whose session did not end by choice",
    D.unfinishedDraft(all, 'user_a')?.draftId === 'crashed', D.unfinishedDraft(all, 'user_a')?.draftId);
  check('Generate never offers a draft from before owners, or a closed one',
    D.unfinishedDraft([m('legacy'), m('x', { owner: 'user_a', closedAt: NOW })], 'user_a') === null);
  check("Generate never offers another account's draft",
    D.unfinishedDraft(all, 'user_c') === null && D.unfinishedDraft(all, 'user_b')?.draftId === 'b-crashed');
  check('Generate never offers an account a draft made signed out (the Editor lists it)',
    D.unfinishedDraft([m('anon', { owner: null })], 'user_a') === null && D.draftsFor([m('anon', { owner: null })], 'user_a').length === 1);
}

// 3b. Which drafts make room for a new one (at most MAX_DRAFTS stay).
{
  const ids = (list) => list.map((x) => x.draftId);
  const closed = (id, mins, owner = 'user_a') => m(id, { owner, updatedAt: NOW - mins * MIN, closedAt: NOW });
  const crashed = (id, mins, owner = 'user_a') => m(id, { owner, updatedAt: NOW - mins * MIN });
  check('nothing goes while there is room',
    D.draftsToPrune([closed('c1', 1), crashed('x', 2)], 5, 'c1').length === 0);
  const mixed = [crashed('p', 0), closed('c1', 1), closed('c2', 2), closed('c3', 3), closed('c4', 4), closed('c5', 5), crashed('x', 100), m('legacy', { updatedAt: NOW - MIN })];
  check('drafts ended by choice go first, oldest first; the work a crash left behind stays, however old',
    same(ids(D.draftsToPrune(mixed, 5, 'p')), ['c5', 'c4', 'c3']), ids(D.draftsToPrune(mixed, 5, 'p')));
  const allCrashed = [crashed('p', 0), ...[1, 2, 3, 4, 5, 6, 7].map((i) => crashed(`i${i}`, i))];
  check('only when every other draft is a crash survivor do the oldest of those go',
    same(ids(D.draftsToPrune(allCrashed, 5, 'p')), ['i7', 'i6', 'i5']), ids(D.draftsToPrune(allCrashed, 5, 'p')));
  const otherAccounts = [crashed('p', 0, 'user_b'), crashed('a-crash', 50), closed('b1', 1, 'user_b'), closed('b2', 2, 'user_b'), closed('b3', 3, 'user_b'), closed('b4', 4, 'user_b'), closed('b5', 5, 'user_b')];
  check("another account's new sessions do not push out this account's crash survivor",
    same(ids(D.draftsToPrune(otherAccounts, 5, 'p')), ['b5', 'b4']), ids(D.draftsToPrune(otherAccounts, 5, 'p')));
  const withLegacy = [crashed('p', 0), m('legacy', { updatedAt: NOW - 200 * MIN }), crashed('x', 100), closed('c1', 1), closed('c2', 2), closed('c3', 3), closed('c4', 4)];
  check('a draft from before owners goes before the work a crash left behind',
    same(ids(D.draftsToPrune(withLegacy, 5, 'p')), ['legacy', 'c4']), ids(D.draftsToPrune(withLegacy, 5, 'p')));
  const anonCrash = [crashed('p', 0), crashed('anon', 300, null), closed('c1', 1), closed('c2', 2), closed('c3', 3), closed('c4', 4), closed('c5', 5)];
  check('work a crash left behind while signed out is kept like any other',
    same(ids(D.draftsToPrune(anonCrash, 5, 'p')), ['c5', 'c4']), ids(D.draftsToPrune(anonCrash, 5, 'p')));
  const oldProtected = [closed('p', 90), closed('c1', 1), closed('c2', 2), closed('c3', 3), closed('c4', 4), closed('c5', 5)];
  check('the session saving now always stays, even as the oldest',
    same(ids(D.draftsToPrune(oldProtected, 5, 'p')), ['c5']), ids(D.draftsToPrune(oldProtected, 5, 'p')));
}

// 4. Words (George's copy).
{
  check('sources: generated sheet, Slicer frame, uploaded image, blank canvas, Gallery',
    D.draftSourceLabel({ kind: 'generation' }) === 'from a generated sheet'
      && D.draftSourceLabel({ kind: 'sheet-import' }) === 'from a Slicer frame'
      && D.draftSourceLabel({ kind: 'upload' }) === 'from an uploaded image'
      && D.draftSourceLabel({ kind: 'blank' }) === 'from a blank canvas'
      && D.draftSourceLabel({ kind: 'gallery' }) === 'from your Gallery'
      && D.draftSourceLabel(undefined) === 'from the editor');
  check('ages: just now, minutes, hours, days, singular and plural',
    D.formatDraftAge(NOW - 30_000, NOW) === 'just now' && D.formatDraftAge(NOW - MIN, NOW) === '1 minute ago'
      && D.formatDraftAge(NOW - 10 * MIN, NOW) === '10 minutes ago' && D.formatDraftAge(NOW - 60 * MIN, NOW) === '1 hour ago'
      && D.formatDraftAge(NOW - 26 * 60 * MIN, NOW) === '1 day ago' && D.formatDraftAge(NOW - 3 * 24 * 60 * MIN, NOW) === '3 days ago');
  const at942 = new Date(2026, 9, 29, 9, 42).getTime();
  const oct19 = new Date(2026, 9, 19, 9, 42).getTime();
  const clock = D.formatDraftClock(at942, NOW);
  const date = D.formatDraftClock(oct19, NOW);
  check('the time: the clock on the same day, the date on another day',
    /9:42/.test(clock) && !/Oct/.test(clock) && /19/.test(date) && !/9:42/.test(date), { clock, date });
  const s = D.draftSentence(m('x', { owner: 'user_a', updatedAt: at942 }), new Date(2026, 9, 29, 9, 52).getTime());
  check('the restore sentence reads as proposed to George (BUILD 2026-10-29-001)',
    s === `A 512${TIMES}512 draft from 10 minutes ago (${D.formatDraftClock(at942, NOW)}), from a generated sheet, is saved on this device.`, s);
  const l = D.draftListLine(m('y', { owner: 'user_a', updatedAt: NOW - 2 * 24 * 60 * MIN, kind: 'sheet-import', w: 64, h: 32 }), NOW);
  check('an older draft line reads "64x32 . from a Slicer frame . 2 days ago"',
    l === `64${TIMES}32 ${DOT} from a Slicer frame ${DOT} 2 days ago`, l);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('all pass');
