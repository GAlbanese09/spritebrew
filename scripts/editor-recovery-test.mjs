// scripts/editor-recovery-test.mjs
//
// Offline lifecycle tests for src/components/sprites/useEditorRecovery.ts
// (BUILD 2026-10-29: the modal editor saved nothing, and an iPhone reload
// lost a whole session): when an editing session is saved, under which
// account and surface, and how closing or discarding a session orders
// against a save still in flight. Run from the repo root:
// `node scripts/editor-recovery-test.mjs`. Prints only case names and pass
// or fail.
//
// The hook and the real editor store are bundled with esbuild into
// local/.editor-recovery-test/ (gitignored), with react, @clerk/react and
// @/lib/editorRecovery swapped for stand-ins written there too: a small
// React that runs layout then passive effects, a useAuth whose account each
// case sets, and an in-memory draft store that logs every call and can hold
// a save in flight. setTimeout is a fake clock the cases advance.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.editor-recovery-test');
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
  'const React = { useRef, useLayoutEffect, useEffect };',
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
  'const db = (globalThis.__draftDb ??= { manifests: new Map(), log: [], gate: null });',
  'export class IndexedDbDraftStore {',
  '  async saveDraft(input) {',
  '    db.log.push(["save", input.projectKey, input.reason, input.owner, input.surface, input.bytes[0]]);',
  '    if (db.gate) await db.gate();',
  '    const existing = db.manifests.get(input.projectKey);',
  '    db.manifests.set(input.projectKey, { draftId: input.projectKey, owner: input.owner !== undefined ? input.owner : existing && existing.owner, surface: input.surface, bytes0: input.bytes[0] });',
  '    db.log.push(["saved", input.projectKey]);',
  '    return { manifest: db.manifests.get(input.projectKey) };',
  '  }',
  '  async markClosed(id) { db.log.push(["close", id]); const m = db.manifests.get(id); if (m) m.closedAt = 1; }',
  '  async deleteDraft(id) { db.log.push(["delete", id]); db.manifests.delete(id); }',
  '  async prune(keep, protect) { db.log.push(["prune", keep, protect]); }',
  '}',
  'export async function isRecoveryAvailable() { return true; }',
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

// The page around the hook: window and document events, and the fake clock.
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
const win = new EventTarget();
win.location = { hostname: 'localhost' };
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
// Runs every timer due within `ms`, including ones that work started by an
// earlier timer sets for now, then moves the clock to the end.
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

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A 4x1 frame whose first pixel's red channel tells the edits apart: a flip
// moves pixel 3 (red 40) to the front, a second flip moves pixel 0 (red 10)
// back.
function loadFrame() {
  const px = new Uint8ClampedArray(16);
  [10, 20, 30, 40].forEach((r, i) => { px[i * 4] = r; px[i * 4 + 3] = 255; });
  R.useEditorStore.getState().loadFrame('f1', px, 4, 1, { kind: 'generation' });
}
const edit = () => R.useEditorStore.getState().flipHorizontal();
let n = 0;
async function session({ key = `modal:case${++n}`, surface = 'modal', user = 'user_a', loaded = true } = {}) {
  // What an earlier case left in flight (an editor's last save or close as
  // it went) lands first, outside this case's log.
  await advance(100);
  db.log.length = 0;
  db.manifests.clear();
  db.gate = null;
  timers = [];
  globalThis.__auth = { isLoaded: loaded, userId: user };
  R.useEditorStore.getState().reset();
  loadFrame();
  const c = R.mount(() => R.useEditorRecovery({ enabled: true, getPalette: () => ['#ffffff'], projectKey: key, surface }));
  return { key, c };
}
const saves = () => db.log.filter((e) => e[0] === 'save');

// 1. One edit is saved a second later, once, with its account and surface.
{
  const { key, c } = await session();
  await drain();
  edit();
  await advance(999);
  const before = saves().length;
  await advance(1);
  const s = saves();
  check('an edit is saved 1 s later, once, with the account, the surface and the edited pixels',
    before === 0 && s.length === 1 && same(s[0], ['save', key, 'edit', 'user_a', 'modal', 40]), db.log);
  check('each save keeps the newest five drafts, this one among them',
    db.log.some((e) => same(e, ['prune', 5, key])), db.log);
  await advance(20_000);
  check('nothing more is saved without another edit', saves().length === 1, db.log);
  c.unmount();
}

// 2. Steady editing is saved at least every 10 s.
{
  const { c } = await session();
  await drain();
  for (let t = 0; t < 12_000; t += 500) { edit(); await advance(500); }
  const s = saves();
  check('editing that never pauses for 1 s is still saved within 10 s', s.length >= 1 && s[0][2] === 'idle', s);
  c.unmount();
}

// 3. No account yet: wait for Clerk, then save under the account.
{
  const { key, c } = await session({ loaded: false, user: undefined });
  await drain();
  edit();
  await advance(3000);
  const early = saves().length;
  // Clerk loads: useAuth changes, and React renders the editor again.
  globalThis.__auth = { isLoaded: true, userId: 'user_a' };
  c.render();
  await advance(1000);
  check('before Clerk knows the account nothing is saved; once it does, the draft is saved as that account',
    early === 0 && saves().length === 1 && saves()[0][3] === 'user_a', db.log);
  // The account is the session's: an account change later does not move it.
  globalThis.__auth = { isLoaded: true, userId: 'user_b' };
  c.render();
  edit();
  await advance(1000);
  check("a later save keeps the session's account", saves().length === 2 && saves()[1][3] === 'user_a' && saves()[1][1] === key, db.log);
  c.unmount();
}

// 4. Signed out: saved with no account.
{
  const { c } = await session({ user: null });
  await drain();
  edit();
  await advance(1000);
  check('signed out, the draft is saved with no account (null)', saves().length === 1 && saves()[0][3] === null, db.log);
  c.unmount();
}

// 5. Hidden tab: saved at once.
{
  const { c } = await session();
  await drain();
  edit();
  await advance(100);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await drain();
  doc.visibilityState = 'visible';
  check('when the tab is hidden the edit is saved at once', saves().length === 1 && saves()[0][2] === 'lifecycle', db.log);
  c.unmount();
}

// 6. Closing the session: the newest state, then closed; nothing after.
{
  const { key, c } = await session();
  await drain();
  edit();
  await advance(1000);
  edit(); // a second flip, not yet saved
  const closing = R.closeEditorDraft(key);
  c.unmount();
  await closing;
  win.dispatchEvent(new Event('popstate'));
  edit();
  await advance(20_000);
  const order = db.log.filter((e) => e[0] !== 'prune').map((e) => e[0] + (e[2] ? `:${e[2]}` : '') + (e[5] !== undefined ? `:${e[5]}` : ''));
  check('closing saves the newest state first, then marks the draft closed, and nothing is saved after',
    same(order, ['save:edit:40', 'saved', 'save:explicit:10', 'saved', 'close']) && db.manifests.get(key).closedAt === 1, order);
}

// 7. Discard while a save is in flight: the delete comes after it; no save after.
{
  const { key, c } = await session();
  await drain();
  let release;
  db.gate = () => new Promise((r) => { release = r; });
  edit();
  await advance(1000);
  const discarding = R.discardEditorDraft(key);
  await advance(2000);
  const midway = db.log.map((e) => e[0]);
  db.gate = null;
  release();
  await discarding;
  await advance(20_000);
  c.unmount();
  check('Discard during a save: the delete waits for the save, then the draft is gone and never saved again',
    same(midway, ['save']) && same(db.log.filter((e) => e[0] !== 'prune').map((e) => e[0]), ['save', 'saved', 'delete']) && !db.manifests.has(key), db.log);
}

// 8. A restored session under a closed key may save again, after the close.
{
  const { key, c } = await session({ key: 'modal:restore-me' });
  await drain();
  edit();
  await advance(1000);
  const closing = R.closeEditorDraft(key);
  c.unmount();
  // The draft is restored at once in the full-page editor, under its key.
  R.useEditorStore.getState().reset();
  loadFrame();
  const c2 = R.mount(() => R.useEditorRecovery({ enabled: true, getPalette: () => [], projectKey: key, surface: 'page' }));
  await drain();
  edit();
  await closing;
  await advance(1000);
  const tail = db.log.filter((e) => e[0] === 'close' || e[0] === 'save').map((e) => e[0] + (e[4] ? `:${e[4]}` : ''));
  check('a restored session under a closed key saves again, after the close, as the page',
    same(tail.slice(-2), ['close', 'save:page']), tail);
  c2.unmount();
}

// 9. Open sessions are not offered, and nothing is saved without an edit.
{
  const { key, c } = await session();
  await drain();
  const open = R.isEditorSessionOpen(key);
  await advance(30_000);
  c.unmount();
  check('a session is "open" while its editor is mounted, and not after', open && !R.isEditorSessionOpen(key));
  check('an editor that is opened and closed with no edit saves nothing', saves().length === 0, db.log);
}

// 10. No edit: a hidden tab saves nothing, and a close only marks the draft.
{
  const { key, c } = await session();
  await drain();
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  await drain();
  doc.visibilityState = 'visible';
  const closing = R.closeEditorDraft(key);
  c.unmount();
  await closing;
  check('with no edit, a hidden tab saves nothing and a close only marks the draft closed',
    saves().length === 0 && same(db.log.map((e) => e[0]), ['close']), db.log);
}

// 11. Discard while a save is still waiting for its second: never saved.
{
  const { key, c } = await session();
  await drain();
  edit();
  await advance(500);
  const discarding = R.discardEditorDraft(key);
  await advance(20_000);
  await discarding;
  c.unmount();
  check('Discard before the waiting save is due: that save never happens, and the draft is deleted',
    saves().length === 0 && same(db.log.map((e) => e[0]), ['delete']), db.log);
}

// 12. A close while the editor stays open (a Leave whose Back had nowhere
// to go): the next edit goes on saving, after the close.
{
  const { key, c } = await session();
  await drain();
  edit();
  await advance(1000);
  await R.closeEditorDraft(key);
  await advance(20_000);
  const afterClose = saves().length;
  edit();
  await advance(1000);
  const order = db.log.filter((e) => e[0] === 'save' || e[0] === 'close').map((e) => e[0] + ':' + e[2]);
  check('an edit after a close, with the editor still open, is saved again after the close (no silent loss)',
    afterClose === 2 && same(order, ['save:edit', 'save:explicit', 'close:undefined', 'save:edit']), order);
  c.unmount();
}

// 13. Clerk never loads: the work is not held back past 5 s.
{
  const { key, c } = await session({ loaded: false, user: undefined });
  await drain();
  edit();
  await advance(4000);
  const early = saves().length;
  await advance(2000);
  const late = saves().map((e) => e[3]);
  // Clerk loads after all: the next save takes the account.
  globalThis.__auth = { isLoaded: true, userId: 'user_a' };
  c.render();
  edit();
  await advance(1000);
  const then = saves().map((e) => [e[1], e[3]]);
  check('if Clerk has not loaded after 5 s the edit is saved as no account, and once Clerk knows the account the next save takes it',
    early === 0 && same(late, [null]) && same(then, [[key, null], [key, 'user_a']]), { early, late, then });
  c.unmount();
}

// 14. Discard while the editor stays open, then an edit: saved again, after
// the delete (in the app a Discard closes the editor at once).
{
  const { key, c } = await session();
  await drain();
  edit();
  await advance(1000);
  await R.discardEditorDraft(key);
  edit();
  await advance(1000);
  const order = db.log.filter((e) => e[0] !== 'prune').map((e) => e[0]);
  check('an edit after a Discard, with the editor still open, is saved again after the delete',
    same(order, ['save', 'saved', 'delete', 'save', 'saved']) && db.manifests.has(key), order);
  c.unmount();
}

// 15. A session with no edit of its own closes the draft it opened when it
// ends (a restored draft left as it was), after the task; not a session
// that saved, and not a StrictMode remount.
{
  const mountUnder = (key) => R.mount(() => R.useEditorRecovery({ enabled: true, getPalette: () => [], projectKey: key, surface: 'page' }));
  const { key, c } = await session({ key: 'page:restored-untouched' });
  db.manifests.set(key, { draftId: key, owner: 'user_a' });
  await drain();
  c.unmount();
  await advance(1);
  const untouched = db.log.filter((e) => e[0] === 'close').map((e) => e[1]);
  // A remount at once (StrictMode): not an end.
  db.log.length = 0;
  const again = mountUnder(key);
  again.unmount();
  const third = mountUnder(key);
  await advance(1);
  const remount = db.log.filter((e) => e[0] === 'close').length;
  third.unmount();
  await advance(1);
  // A session that saved keeps its draft on offer when it ends without a close.
  const s2 = await session({ key: 'page:restored-edited' });
  await drain();
  edit();
  await advance(1000);
  s2.c.unmount();
  await advance(1);
  const edited = db.log.filter((e) => e[0] === 'close').length;
  check('a session that ends with no edit closes the draft it opened (after the task, not on a remount); one with edits leaves it on offer',
    same(untouched, [key]) && remount === 0 && edited === 0, { untouched, remount, edited });
}

// 16. An editor that goes without a close or a Discard (a sign-out, or the
// page around it going away) saves its newest edit as it goes.
{
  const { c } = await session();
  await drain();
  edit();
  await advance(300);
  c.unmount();
  await advance(10);
  const s = saves();
  check('an editor that goes without a close saves its newest edit at once, and the draft stays on offer',
    s.length === 1 && s[0][2] === 'lifecycle' && s[0][5] === 40 && !db.log.some((e) => e[0] === 'close'), db.log);
}

// 17. The same before Clerk knows the account: saved, as no account.
{
  const { c } = await session({ loaded: false, user: undefined });
  await drain();
  edit();
  await advance(300);
  c.unmount();
  await advance(10);
  check('an editor that goes before Clerk knows the account still saves its edit, as no account',
    saves().length === 1 && saves()[0][3] === null, db.log);
}

// 18. A list read after editorWritesSettled() sees what an editor that just
// went asked for, including the close of a draft it left as it was.
{
  const { key, c } = await session({ key: 'page:settle' });
  db.manifests.set(key, { draftId: key, owner: 'user_a' });
  await drain();
  c.unmount();
  let settled = false;
  const waiting = R.editorWritesSettled().then(() => { settled = true; });
  await drain();
  const before = settled;
  await advance(1);
  await waiting;
  check('a list read after editorWritesSettled() sees the close of an editor that just went',
    before === false && settled === true && db.log.some((e) => e[0] === 'close' && e[1] === key), { before, settled, log: db.log });
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('all pass');
