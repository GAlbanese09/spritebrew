// scripts/editor-draft-safety-test.mjs
//
// Offline tests for the outside audit's three data-loss findings on the
// editor's drafts (audit/external/product-audit-r2-2026-11-24.xlsx; HQ
// 2026-11-25-019), each acceptance check written as a case:
// - SB-26: a draft keeps the pixels on screen, also after Undo back to the
//   start or to the oldest step history keeps;
// - SB-25: the leave question says the edits are saved only once the write
//   of the current state has landed, and says they are not when a save
//   failed or this browser cannot save drafts;
// - SB-04: Discard asks first, with the draft's size and age.
// Run from the repo root: `node scripts/editor-draft-safety-test.mjs`.
//
// The hook and the real editor store are bundled with esbuild into
// local/.editor-draft-safety-test/ (gitignored), with react, @clerk/react and
// @/lib/editorRecovery swapped for stand-ins, as in editor-recovery-test.mjs.
// The stand-in draft store keeps every saved picture whole, can refuse a
// write the way a full disk does, and can be unavailable. setTimeout is a
// fake clock the cases advance.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.editor-draft-safety-test');
fs.mkdirSync(DIR, { recursive: true });
const lines = (...l) => l.join(String.fromCharCode(10)) + String.fromCharCode(10);

const FAKE_REACT = lines(
  'let current = null;',
  'const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));',
  'export function useRef(init) { const c = current; const i = c.i++; if (!(i in c.slots)) c.slots[i] = { current: init }; return c.slots[i]; }',
  'function effectHook(kind) {',
  '  return function (fn, deps) {',
  '    const c = current; const i = c.i++; const prev = c.slots[i];',
  '    if (prev && deps !== undefined && same(prev.deps, deps)) return;',
  '    const slot = { deps, cleanup: prev && prev.cleanup, effect: kind };',
  '    c.slots[i] = slot;',
  '    c[kind].push(() => { if (slot.cleanup) slot.cleanup(); const k = fn(); slot.cleanup = typeof k === "function" ? k : undefined; });',
  '  };',
  '}',
  'export const useLayoutEffect = effectHook("layout");',
  'export const useEffect = effectHook("passive");',
  'export function useSyncExternalStore(subscribe, get) { return get(); }',
  'const React = { useRef, useLayoutEffect, useEffect, useSyncExternalStore };',
  'export default React;',
  'export function mount(component) {',
  '  const c = { slots: {}, layout: [], passive: [], i: 0 };',
  '  c.render = () => { current = c; c.i = 0; try { component(); } finally { current = null; } c.layout.splice(0).forEach((r) => r()); c.passive.splice(0).forEach((r) => r()); };',
  '  c.unmount = () => { for (const kind of ["layout", "passive"]) Object.values(c.slots).forEach((s) => s && s.effect === kind && s.cleanup && s.cleanup()); };',
  '  c.render();',
  '  return c;',
  '}',
);
const CLERK = 'export function useAuth() { return globalThis.__auth; }';
const FAKE_RECOVERY = lines(
  'export const MAX_DRAFTS = 5;',
  'export function draftVisibleTo(m, owner) { return m.owner === undefined || m.owner === null || m.owner === owner; }',
  'const db = (globalThis.__draftDb ??= { drafts: new Map(), log: [], gate: null, fail: null, available: true });',
  'export class IndexedDbDraftStore {',
  '  async saveDraft(input) {',
  '    db.log.push(["save", input.projectKey, input.reason]);',
  '    if (db.gate) await db.gate();',
  '    if (db.fail) { const e = db.fail; db.log.push(["failed", input.projectKey]); throw e; }',
  '    db.drafts.set(input.projectKey, { bytes: Array.from(input.bytes), owner: input.owner });',
  '    db.log.push(["saved", input.projectKey]);',
  '    return { manifest: { draftId: input.projectKey } };',
  '  }',
  '  async getLatest(id) { const d = db.drafts.get(id); return d ? { manifest: { draftId: id, owner: d.owner } } : null; }',
  '  async markClosed(id) { db.log.push(["close", id]); }',
  '  async deleteDraft(id) { db.log.push(["delete", id]); db.drafts.delete(id); }',
  '  async prune() {}',
  '}',
  'export async function isRecoveryAvailable() { if (db.available === "throw") throw new Error("no IndexedDB here"); return db.available; }',
  'export async function requestPersistentStorage() { return false; }',
);
const ENTRY = lines(
  `export * from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/useEditorRecovery.ts'))};`,
  `export { useEditorStore } from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/editorStore.ts'))};`,
  `export { mount } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};`,
);
for (const [name, text] of Object.entries({ 'fake-react.mjs': FAKE_REACT, 'clerk.mjs': CLERK, 'recovery.mjs': FAKE_RECOVERY, 'entry.mjs': ENTRY })) {
  fs.writeFileSync(path.join(DIR, name), text);
}

globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
const win = new EventTarget();
win.location = { hostname: 'example.com' };
globalThis.window = win;
const doc = new EventTarget();
doc.visibilityState = 'visible';
globalThis.document = doc;
let now = 0;
let timers = [];
let nextTimer = 1;
globalThis.setTimeout = (fn, ms = 0) => { const id = nextTimer++; timers.push({ id, at: now + ms, fn }); return id; };
globalThis.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
const drain = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    await drain();
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > end) break;
    timers.shift();
    if (t.at > now) now = t.at;
    t.fn();
  }
  now = end;
}

const OUT = path.join(DIR, 'bundle.mjs');
await build({
  entryPoints: [path.join(DIR, 'entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  plugins: [{
    name: 'stand-ins',
    setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(DIR, 'fake-react.mjs') }));
      b.onResolve({ filter: /^@clerk[/]react$/ }, () => ({ path: path.join(DIR, 'clerk.mjs') }));
      b.onResolve({ filter: /^@[/]lib[/]editorRecovery$/ }, () => ({ path: path.join(DIR, 'recovery.mjs') }));
    },
  }],
});
const R = await import(pathToFileURL(OUT).href);
const db = globalThis.__draftDb;

// The words, from their own modules (no stand-ins needed).
const WORDS = path.join(DIR, 'words.mjs');
fs.writeFileSync(path.join(DIR, 'words-entry.mjs'), lines(
  `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/editorCopy.ts'))};`,
  `export { draftListLine } from ${JSON.stringify(path.join(ROOT, 'src/lib/editorRecovery/drafts.ts'))};`,
  // freshPress.ts is new with the fix; on `main` its checks fail instead of the run.
  fs.existsSync(path.join(ROOT, 'src/lib/freshPress.ts')) ? `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/freshPress.ts'))};` : '',
));
await build({
  entryPoints: [path.join(DIR, 'words-entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: WORDS, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
});
const W = await import(pathToFileURL(WORDS).href);

// The hook warns on a dev host when a save fails; the cases make it fail.
console.warn = () => {};

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// An 8x8 picture, every pixel a different shade, so each stroke below makes
// a picture of its own.
const W8 = 8;
function original() {
  const px = new Uint8ClampedArray(W8 * W8 * 4);
  for (let i = 0; i < W8 * W8; i++) { px[i * 4] = i; px[i * 4 + 1] = 100; px[i * 4 + 2] = 200; px[i * 4 + 3] = 255; }
  return px;
}
const store = () => R.useEditorStore.getState();
const visible = () => Array.from(store().pixels);
// One stroke: pixel k painted a colour of its own.
function stroke(k) {
  const s = store();
  s.beginStroke();
  s.paintPixel(k % W8, Math.floor(k / W8) % W8, `#${(k * 37 % 256).toString(16).padStart(2, '0')}2233`);
  store().endStroke();
}
let n = 0;
async function session({ key = `page:safety${++n}`, available = true } = {}) {
  await advance(100);
  db.log.length = 0;
  db.drafts.clear();
  db.gate = null;
  db.fail = null;
  db.available = available;
  timers = [];
  globalThis.__auth = { isLoaded: true, userId: 'user_a' };
  store().reset();
  store().loadFrame('f1', original(), W8, W8, { kind: 'upload' });
  const c = R.mount(() => R.useEditorRecovery({ enabled: true, getPalette: () => [], projectKey: key, surface: 'page' }));
  await drain();
  return { key, c };
}
const saved = (key) => db.drafts.get(key)?.bytes;
const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'RecoveryQuotaError' });

// ---- SB-26: the draft is the picture on screen ----

// A fresh file nobody edits writes no draft.
{
  const { key, c } = await session();
  await advance(20_000);
  check('SB-26 a fresh picture, never edited, saves no draft', saved(key) === undefined && db.log.length === 0, db.log);
  c.unmount();
}

// One edit, saved; then undone back to the original: the draft follows.
{
  const { key, c } = await session();
  stroke(3);
  await advance(1000);
  const editedSaved = same(saved(key), visible());
  store().undo();
  await advance(2000);
  check('SB-26 one edit saved, then undone to the original: after the save interval the draft is the original picture',
    editedSaved && same(saved(key), Array.from(original())), { editedSaved, first: saved(key)?.slice(12, 16) });
  c.unmount();
}

// 55 strokes, undone to the oldest step history keeps (index 0 after the
// 50-step cap): the draft is what is on screen, not stroke 55's picture.
{
  const { key, c } = await session();
  for (let k = 0; k < 55; k++) { stroke(k); await advance(200); }
  await advance(1000);
  const all55 = same(saved(key), visible());
  let undos = 0;
  while (store().historyIndex > 0) { store().undo(); undos++; }
  await advance(2000);
  check('SB-26 55 strokes undone to the oldest kept step (49 undos): after the save interval the draft is the picture on screen',
    all55 && undos === 49 && same(saved(key), visible()), { all55, undos, index: store().historyIndex });
  store().redo();
  await advance(2000);
  check('SB-26 and a Redo from there is saved too', same(saved(key), visible()));
  c.unmount();
}

// 55 quick strokes, none saved yet, undone to the oldest kept step: the
// edits still on screen are saved, though history is at index 0.
{
  const { key, c } = await session();
  for (let k = 0; k < 55; k++) stroke(k);
  while (store().historyIndex > 0) store().undo();
  await advance(2000);
  check('SB-26 55 quick strokes (no save yet) undone to the oldest kept step: the picture on screen is saved',
    saved(key) !== undefined && same(saved(key), visible()) && !same(visible(), Array.from(original())), { saves: db.log.length });
  c.unmount();
}

// A close (a Save, a Leave whose Back had nowhere to go) while the editor
// stays open, then an Undo back to the start: the draft follows.
{
  const { key, c } = await session();
  stroke(20);
  await R.closeEditorDraft(key);
  await drain();
  const closedWithEdit = same(saved(key), visible());
  store().undo();
  await advance(2000);
  check('SB-26 after a close, an Undo back to the start is saved too (the session goes on)',
    closedWithEdit && same(saved(key), Array.from(original())), { closedWithEdit });
  c.unmount();
}

// A cancelled stroke changes nothing, so nothing is saved.
{
  const { key, c } = await session();
  const s = store();
  s.beginStroke();
  s.paintPixel(1, 1, '#ff0000');
  store().cancelStroke();
  await advance(20_000);
  check('SB-26 a cancelled stroke alone saves no draft', saved(key) === undefined, db.log);
  c.unmount();
}

// ---- SB-25: the leave question tells the truth ----

check('SB-25 the hook says how the current state is kept (leaveSaveState, flushEditorDraft)',
  typeof R.leaveSaveState === 'function' && typeof R.flushEditorDraft === 'function');

if (typeof R.leaveSaveState === 'function' && typeof R.flushEditorDraft === 'function') {
  // A successful write: saved, and the draft is every edited pixel.
  {
    const { key, c } = await session();
    stroke(5); stroke(9);
    R.flushEditorDraft(key);
    await drain();
    check('SB-25 a write that landed: the leave question says saved, and the draft is every edited pixel',
      R.leaveSaveState(key) === 'saved' && same(saved(key), visible()), { state: R.leaveSaveState(key) });
    // An edit after it: not saved until its own write lands.
    stroke(12);
    const afterEdit = R.leaveSaveState(key);
    R.flushEditorDraft(key);
    await drain();
    check('SB-25 an edit after a landed write is "saving" until its own write lands, at once on a flush (no 1 s wait)',
      afterEdit === 'saving' && R.leaveSaveState(key) === 'saved' && same(saved(key), visible()), { afterEdit, now: R.leaveSaveState(key) });
    c.unmount();
  }

  // No session under the key (none yet, or it has ended): never "saved" on a guess.
  check('SB-25 with no session under the key, the state is never "saved"', R.leaveSaveState('page:no-such-session') === 'saving');

  // A write in flight: saving, then saved.
  {
    const { key, c } = await session();
    let release;
    db.gate = () => new Promise((r) => { release = r; });
    stroke(2);
    R.flushEditorDraft(key);
    await drain();
    const during = R.leaveSaveState(key);
    db.gate = null;
    release();
    await drain();
    check('SB-25 while the write is in flight the leave question says saving, then saved', during === 'saving' && R.leaveSaveState(key) === 'saved', { during, after: R.leaveSaveState(key) });
    c.unmount();
  }

  // A full disk: the write fails, so the edits are unsaved.
  {
    const { key, c } = await session();
    db.fail = quota();
    stroke(4);
    R.flushEditorDraft(key);
    await drain();
    check('SB-25 a quota error: the leave question says the edits are unsaved, and no draft was kept',
      R.leaveSaveState(key) === 'unsaved' && saved(key) === undefined, { state: R.leaveSaveState(key), log: db.log });
    // Space comes back: the next write of the current state lands.
    db.fail = null;
    R.flushEditorDraft(key);
    await drain();
    check('SB-25 after a failure, a later write of the same state that lands says saved', R.leaveSaveState(key) === 'saved' && same(saved(key), visible()));
    c.unmount();
  }

  // A failure, then a second try on its way: saving, not unsaved.
  {
    const { key, c } = await session();
    db.fail = quota();
    stroke(14);
    R.flushEditorDraft(key);
    await drain();
    const failed = R.leaveSaveState(key);
    db.fail = null;
    let release;
    db.gate = () => new Promise((r) => { release = r; });
    R.flushEditorDraft(key);
    await drain();
    const retrying = R.leaveSaveState(key);
    db.gate = null;
    release();
    await drain();
    check('SB-25 a failed write, then a second try on its way: unsaved, then saving, then saved',
      failed === 'unsaved' && retrying === 'saving' && R.leaveSaveState(key) === 'saved', { failed, retrying, after: R.leaveSaveState(key) });
    c.unmount();
  }

  // An older write landed, a newer one failed: unsaved.
  {
    const { key, c } = await session();
    stroke(6);
    R.flushEditorDraft(key);
    await drain();
    db.fail = quota();
    stroke(7);
    R.flushEditorDraft(key);
    await drain();
    check('SB-25 an older state saved and the current one refused: unsaved (the draft lacks the last edit)',
      R.leaveSaveState(key) === 'unsaved' && !same(saved(key), visible()), { state: R.leaveSaveState(key) });
    c.unmount();
  }

  // No drafts in this browser (private mode, blocked storage): unsaved.
  {
    const { key, c } = await session({ available: false });
    stroke(8);
    R.flushEditorDraft(key);
    await advance(2000);
    check('SB-25 storage unavailable: the leave question says the edits are unsaved', R.leaveSaveState(key) === 'unsaved', { state: R.leaveSaveState(key) });
    c.unmount();
  }

  // An older write lands after a newer edit: the newer picture is not saved.
  {
    const { key, c } = await session();
    let release;
    db.gate = () => new Promise((r) => { release = r; });
    stroke(21);
    R.flushEditorDraft(key);
    await drain();
    db.gate = null;
    stroke(22); // a newer picture, its write not asked for yet
    release();
    await drain();
    check('SB-25 an older write landing after a newer edit does not make the newer picture "saved"', R.leaveSaveState(key) === 'saving', { state: R.leaveSaveState(key) });
    c.unmount();
  }

  // A landed write, then a later write of the same picture fails: the newest
  // finished write decides (AUDIT data-loss r1, L3).
  {
    const { key, c } = await session();
    stroke(23);
    R.flushEditorDraft(key);
    await drain();
    const first = R.leaveSaveState(key);
    db.fail = quota();
    R.flushEditorDraft(key);
    await drain();
    check('SB-25 a landed write, then a failed write of the same picture: unsaved (L3)', first === 'saved' && R.leaveSaveState(key) === 'unsaved', { first, after: R.leaveSaveState(key) });
    c.unmount();
  }

  // A landed write, then a second write of the same picture on its way: the
  // words say saving until it finishes, so they never say saved and then
  // not saved (AUDIT data-loss r2, L1). It lands: saved; it fails: unsaved.
  for (const outcome of ['lands', 'fails']) {
    const { key, c } = await session();
    stroke(outcome === 'lands' ? 24 : 25);
    R.flushEditorDraft(key);
    await drain();
    const first = R.leaveSaveState(key);
    let release;
    db.gate = () => new Promise((r) => { release = r; });
    if (outcome === 'fails') db.fail = quota();
    R.flushEditorDraft(key);
    await drain();
    const during = R.leaveSaveState(key);
    db.gate = null;
    release();
    await drain();
    const after = R.leaveSaveState(key);
    db.fail = null;
    check(`SB-25 a landed write, then a second write of the same picture in flight: saving, and once it ${outcome}, ${outcome === 'lands' ? 'saved' : 'unsaved'} (data-loss r2, L1)`,
      first === 'saved' && during === 'saving' && after === (outcome === 'lands' ? 'saved' : 'unsaved'), { first, during, after });
    c.unmount();
  }

  // The check for IndexedDB itself throws: unsaved.
  {
    const { key, c } = await session({ available: 'throw' });
    stroke(9);
    R.flushEditorDraft(key);
    await advance(2000);
    check('SB-25 the check for drafts throws: the leave question says unsaved', R.leaveSaveState(key) === 'unsaved', { state: R.leaveSaveState(key) });
    c.unmount();
  }

  // Nothing to keep (an edit undone before any save): nothing is lost.
  {
    const { key, c } = await session();
    stroke(1);
    store().undo();
    R.flushEditorDraft(key);
    await drain();
    check('SB-25 an edit undone before any save: nothing to lose, so the leave question says saved and no draft is written',
      R.leaveSaveState(key) === 'saved' && saved(key) === undefined, { state: R.leaveSaveState(key), log: db.log });
    c.unmount();
  }
}

// The words.
check('SB-25 the leave question has words for saved, saving and unsaved (leaveEditorText)', typeof W.leaveEditorText === 'function');
if (typeof W.leaveEditorText === 'function') {
  const s = W.leaveEditorText('saved'), g = W.leaveEditorText('saving'), u = W.leaveEditorText('unsaved');
  check('SB-25 saved says the edits are on this device; saving and unsaved never do',
    /edits are saved on this device/.test(s) && !/edits are saved/.test(g) && !/edits are saved/.test(u), { s, g, u });
  check('SB-25 unsaved says they could not be saved and points to Download PNG', /not be saved/.test(u) && u.includes(W.DOWNLOAD_PNG_LABEL), u);
}
check('SB-25 the leave question\'s view for each state (leaveDialogView)', typeof W.leaveDialogView === 'function');
if (typeof W.leaveDialogView === 'function') {
  const v = (s, w) => { const x = W.leaveDialogView(s, w); return [x.state, x.download, x.leaveLabel, x.leaveEnabled, x.text === W.leaveEditorText(x.state)]; };
  check('SB-25 saved: Leave, on; no Download PNG', same(v('saved', false), ['saved', false, 'Leave', true, true]) && same(v('saved', true), ['saved', false, 'Leave', true, true]));
  check('SB-25 saving: Leave waits; no Download PNG yet', same(v('saving', false), ['saving', false, 'Leave', false, true]));
  check('SB-25 still saving after the wait counts as unsaved: Download PNG and Leave anyway, on', same(v('saving', true), ['unsaved', true, W.LEAVE_ANYWAY_LABEL, true, true]));
  check('SB-25 unsaved: Download PNG and Leave anyway, on', same(v('unsaved', false), ['unsaved', true, 'Leave anyway', true, true]));
  // DESIGN 2026-11-25-067: the line says saving only once a write has taken 300 ms; before that it
  // waits, quiet, with Leave off, so a quick save never reads saving and then saved.
  const q = (s, w, shown) => { const x = W.leaveDialogView(s, w, shown); return [x.state, x.quiet, x.leaveEnabled]; };
  check('SB-25 saving, under 300 ms: the line is quiet and Leave waits; from 300 ms it says saving (DESIGN -067)',
    same(q('saving', false, false), ['saving', true, false]) && same(q('saving', false, true), ['saving', false, false]));
  check('SB-25 saved, not saved, and saving past the 2 s wait are never quiet (DESIGN -067)',
    ['saved', 'unsaved'].every((st) => q(st, false, false)[1] === false && q(st, true, false)[1] === false) && same(q('saving', true, false), ['unsaved', false, true]));
}

// ---- AUDIT data-loss r1, M1: a double tap cannot answer the question ----
check('M1 freshPress: a keyboard press always counts; a pointer press counts only from 400 ms after the question opened',
  typeof W.freshPress === 'function' && W.FRESH_PRESS_MS === 400
  && W.freshPress(1000, null, 0) === true
  && W.freshPress(1000, 1150, 1) === false
  && W.freshPress(1000, 1399, 2) === false
  && W.freshPress(1000, 1400, 1) === true
  && W.freshPress(1000, null, 1) === false
  && W.freshPress(null, 1500, 1) === false);

// ---- SB-04: Discard asks first ----

check('SB-04 Discard has a question with the draft in it (discardDraftText)', typeof W.discardDraftText === 'function');
if (typeof W.discardDraftText === 'function') {
  const m = { draftId: 'page:x', updatedAt: 1_000_000 - 5 * 60_000, summary: { width: 48, height: 48 }, project: { source: { kind: 'upload' } } };
  const t = W.discardDraftText(m, 1_000_000);
  check('SB-04 the question names the draft by size, source and age, and says it cannot be undone',
    t.includes(W.draftListLine(m, 1_000_000)) && /can.t be undone|cannot be undone/.test(t), t);
}
// Every Discard of a draft goes through the question: the buttons no longer
// delete on their own click.
const landing = fs.readFileSync(path.join(ROOT, 'src/components/sprites/EditorLanding.tsx'), 'utf8');
const banner = fs.readFileSync(path.join(ROOT, 'src/components/sprites/EditorDraftBanner.tsx'), 'utf8');
const body = fs.readFileSync(path.join(ROOT, 'src/components/sprites/PixelEditorBody.tsx'), 'utf8');
check('SB-04 the Editor landing\'s Discard buttons open the question (DraftDiscardDialog), not the delete',
  /DraftDiscardDialog/.test(landing) && !/onClick=\{\(\) => onDiscardDraft\?\.\(/.test(landing));
check('SB-04 Generate\'s restore banner asks too', /DraftDiscardDialog/.test(banner) && !/onClick=\{\(\) => \{ void discard\(\); \}\}/.test(banner));
check('SB-04 the broken-draft screen\'s Discard draft asks too', /DraftDiscardDialog/.test(body) && !/onClick=\{onDiscardDraft\}/.test(body));
check('SB-25 the leave dialog is told how the edits are kept, and offers Download PNG', /<EditorLeaveDialog[^>]*saveState=/.test(body) && /<EditorLeaveDialog[^>]*onDownload=/.test(body));
// What the browser shows right, pinned here too (AUDIT data-loss r1, L10).
const leaveDlg = fs.readFileSync(path.join(ROOT, 'src/components/sprites/EditorLeaveDialog.tsx'), 'utf8');
// New with the fix; on `main` its checks fail instead of the run.
const discardDlgPath = path.join(ROOT, 'src/components/sprites/DraftDiscardDialog.tsx');
const discardDlg = fs.existsSync(discardDlgPath) ? fs.readFileSync(discardDlgPath, 'utf8') : '';
check('L10 the body asks for the write as the question opens, and again when the picture moves while it is open',
  /if \(!leaveAsking\) return;\s*flushEditorDraft\(draftKey\);\s*return useEditorStore\.subscribe\(\(s\) => s\.revision, \(\) => flushEditorDraft\(draftKey\)\);/.test(body));
check('L10 the discard question: Escape and the backdrop keep (onClose is Keep), Keep draft has the focus, Discard acts only on a fresh press',
  /<Dialog open=\{text !== null\} onClose=\{onKeep\}/.test(discardDlg) && /autoFocus\s*onClick=\{onKeep\}/.test(discardDlg) && /onClick=\{\(e\) => \{ if \(press\.accept\(e\)\) onDiscard\(\); \}\}/.test(discardDlg) && /useFreshPress\(text !== null\)/.test(discardDlg));
check('L10 the leave question: Leave waits while saving, both Leaves act only on a fresh press, the 2 s clock runs while a save is on its way',
  /disabled=\{!view\.leaveEnabled\}/.test(leaveDlg) && (leaveDlg.match(/if \(press\.accept\(e\)\) onLeave\(\);/g) || []).length === 2
  && /const saving = open && saveState === 'saving';/.test(leaveDlg) && /setTimeout\(\(\) => setWaitedOut\(true\), LEAVE_SAVE_WAIT_MS\);[\s\S]{0,120}\}, \[saving\]\);/.test(leaveDlg) && /useFreshPress\(open\)/.test(leaveDlg));
check('SB-25 the leave question counts 300 ms from each save on its way, and while saving keeps the line\'s height with the saved sentence, unseen and unread (DESIGN -067)',
  /export const LEAVE_SAVING_SHOW_MS = 300;/.test(leaveDlg) && /setTimeout\(\(\) => setSavingShown\(true\), LEAVE_SAVING_SHOW_MS\);[\s\S]{0,120}\}, \[saving\]\);/.test(leaveDlg)
  && /leaveDialogView\(saveState, waitedOut, savingShown\)/.test(leaveDlg)
  && /\{view\.state === 'saving' && <span className="invisible col-start-1 row-start-1" aria-hidden="true">\{leaveEditorText\('saved'\)\}<\/span>\}/.test(leaveDlg)
  && /\{!view\.quiet && <span className="col-start-1 row-start-1">\{view\.text\}<\/span>\}/.test(leaveDlg));
check('L6 Generate\'s banner shows the question, and its Discard deletes, only while the draft it names is the one offered',
  /text=\{discardAsk && discardAsk\.draftId === draft\.draftId \? discardAsk\.text : null\}/.test(banner) && /if \(ask && ask\.draftId === draft\.draftId\) void discard\(\);/.test(banner));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
