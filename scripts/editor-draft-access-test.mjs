// scripts/editor-draft-access-test.mjs
//
// Offline tests for who may restore or discard an editor draft (Second 121
// P2-B): the Editor page (src/app/editor/page.tsx) and Generate's banner
// (src/components/sprites/EditorDraftBanner.tsx) show a draft only to the
// account it was listed for, hide it the moment the account changes, and
// check the draft's owner in the store, against the account at the time,
// before a Restore or a Discard acts; a restore that finishes after an
// account change or a newer choice does nothing. And (Second 122) every
// action belongs to its visit: a Restore, a Discard or a close that answers
// after its banner or page went (a sign-out removes the banner with
// Generate's signed-in view), or after another draft took its place, does
// nothing; the landing's latest choice wins. Run from the repo root:
// `node scripts/editor-draft-access-test.mjs`. Prints only case names and
// pass or fail.
//
// The real page, banner and landing, with the real draft rules, the real
// useEditorRecovery module and the real stores, are bundled with esbuild
// into local/.editor-draft-access-test/ (gitignored) with react, its JSX
// runtime, @clerk/react, next/navigation, the editor body, the page's
// landing, the upload zone, react-hotkeys-hook, lucide-react, the Button
// and @/lib/editorRecovery's IndexedDB store swapped for stand-ins written
// there too. The stand-in store keeps drafts in memory and can hold a list,
// an owner lookup or a load until the case lets it go. The stand-in React
// (as in gallery-ownership-test) runs render, layout and passive effects,
// and re-renders in a later task; removing a component runs its layout
// cleanups first, as React's commit does.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.editor-draft-access-test');
fs.mkdirSync(DIR, { recursive: true });
const lines = (...l) => l.join(String.fromCharCode(10)) + String.fromCharCode(10);

const FAKE_REACT = `
let current = null;
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
// An update re-renders in a later task, as React's scheduler does, unless a
// case holds the component; then it waits for the case.
function schedule(c) {
  if (c.unmounted) return;
  c.dirty = true;
  if (c.hold || c.timer) return;
  c.timer = setTimeout(() => { c.timer = null; if (c.dirty && !c.hold && !c.unmounted) c.update(); }, 0);
}
export function useState(init) {
  const c = current; const i = c.i++;
  if (!(i in c.slots)) c.slots[i] = { v: typeof init === 'function' ? init() : init };
  const slot = c.slots[i];
  if (!slot.set) {
    slot.set = (next) => {
      if (c.unmounted) return;
      slot.v = typeof next === 'function' ? next(slot.v) : next;
      if (current === c) { c.renderAgain = true; return; }
      schedule(c);
    };
  }
  return [slot.v, slot.set];
}
export function useRef(init) {
  const c = current; const i = c.i++;
  if (!(i in c.slots)) c.slots[i] = { current: init };
  return c.slots[i];
}
export function useCallback(fn, deps) {
  const c = current; const i = c.i++;
  const prev = c.slots[i];
  if (prev && same(prev.deps, deps)) return prev.fn;
  c.slots[i] = { fn, deps, memo: true };
  return fn;
}
export function useMemo(make, deps) {
  const c = current; const i = c.i++;
  const prev = c.slots[i];
  if (prev && same(prev.deps, deps)) return prev.value;
  const slot = { value: make(), deps, memo: true };
  c.slots[i] = slot;
  return slot.value;
}
export function useSyncExternalStore(subscribe, getSnapshot) {
  const c = current; const i = c.i++;
  if (!(i in c.slots)) {
    const slot = { external: true };
    slot.unsubscribe = subscribe(() => schedule(c));
    c.slots[i] = slot;
  }
  return getSnapshot();
}
export function useDebugValue() {}
export function forwardRef(render) { return { forwardRef: render }; }
export function createElement(type, props, ...children) { return { type, props: { ...props, children } }; }
export function createContext(value) { return { value, Provider: 'Provider' }; }
export function useContext(context) { return context.value; }
function effectHook(kind) {
  return function (fn, deps) {
    const c = current; const i = c.i++;
    const prev = c.slots[i];
    if (prev && same(prev.deps, deps)) return;
    const slot = { deps, cleanup: prev && prev.cleanup, effect: kind, fn };
    c.slots[i] = slot;
    c[kind].push(() => {
      if (slot.cleanup) slot.cleanup();
      const cleanup = fn();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    });
  };
}
export const useLayoutEffect = effectHook('layout');
export const useEffect = effectHook('passive');
export default { useState, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, forwardRef, createElement, createContext, useContext, useLayoutEffect, useEffect };
export function mount(component) {
  const c = { slots: {}, layout: [], passive: [], unmounted: false, hold: false, dirty: false, timer: null, renderAgain: false, value: undefined, i: 0 };
  const effects = (kind) => Object.values(c.slots).filter((s) => s && s.effect === kind);
  c.render = () => {
    for (let pass = 0; ; pass++) {
      if (pass > 25) throw new Error('Too many re-renders');
      const kept = {};
      for (const [k, s] of Object.entries(c.slots)) if (s && (s.effect || s.memo)) kept[k] = s;
      const queued = [c.layout.length, c.passive.length];
      c.renderAgain = false; c.dirty = false;
      current = c; c.i = 0;
      try { c.value = component(); } finally { current = null; }
      if (!c.renderAgain) return;
      c.layout.length = queued[0];
      c.passive.length = queued[1];
      for (const [k, s] of Object.entries(c.slots)) {
        if (!s || !(s.effect || s.memo) || kept[k] === s) continue;
        if (k in kept) c.slots[k] = kept[k]; else delete c.slots[k];
      }
    }
  };
  // The commit: layout effects (and the layout cleanups of changed ones).
  c.commitLayout = () => c.layout.splice(0).forEach((run) => run());
  // Passive effects (and their cleanups), which React may run after paint.
  c.commitPassive = () => c.passive.splice(0).forEach((run) => run());
  c.update = () => { c.render(); c.commitLayout(); c.commitPassive(); };
  // Unmounting: the commit runs the layout cleanups; the passive cleanups
  // may come later.
  c.unmountLayout = () => { c.unmounted = true; effects('layout').forEach((s) => s.cleanup && s.cleanup()); };
  c.unmountPassive = () => {
    effects('passive').forEach((s) => s.cleanup && s.cleanup());
    Object.values(c.slots).forEach((s) => s && s.external && s.unsubscribe());
  };
  // StrictMode in development: every effect is cleaned up and run again
  // once after mounting, layout effects first.
  c.strictReplay = () => {
    effects('layout').forEach((s) => s.cleanup && s.cleanup());
    effects('passive').forEach((s) => s.cleanup && s.cleanup());
    effects('layout').forEach((s) => { const k = s.fn(); s.cleanup = typeof k === 'function' ? k : undefined; });
    effects('passive').forEach((s) => { const k = s.fn(); s.cleanup = typeof k === 'function' ? k : undefined; });
  };
  c.update();
  return c;
}
`;

const FAKE_STORE = lines(
  `export * from ${JSON.stringify(path.join(ROOT, 'src/lib/editorRecovery/drafts.ts'))};`,
  'const db = (globalThis.__draftDb ??= { manifests: new Map(), log: [], hold: {}, waiting: {} });',
  '// A held step waits until the case releases it.',
  'function gate(name) {',
  '  if (!db.hold[name]) return Promise.resolve();',
  '  return new Promise((resolve) => { (db.waiting[name] ??= []).push(resolve); });',
  '}',
  'export class IndexedDbDraftStore {',
  '  async listDrafts() { await gate("list"); return [...db.manifests.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((m) => ({ manifest: m })); }',
  '  async getLatest(id) { await gate("latest"); const m = db.manifests.get(id); return m ? { manifest: m } : null; }',
  '  // The real store reads the manifest, then the payload: a held load has its manifest already.',
  '  async loadDraft(id) { const m = db.manifests.get(id); await gate("load"); if (!m) throw new Error("gone"); db.log.push(["load", id]); return { project: m.project, bytes: new Uint8ClampedArray(4) }; }',
  '  async deleteDraft(id) { db.log.push(["delete", id]); db.manifests.delete(id); }',
  '  async markClosed(id) { db.log.push(["close", id]); }',
  '  async saveDraft(input) { db.log.push(["save", input.projectKey]); return { manifest: {} }; }',
  '  async prune() {}',
  '}',
  'export async function isRecoveryAvailable() { return true; }',
  'export async function requestPersistentStorage() { return false; }',
);
const files = {
  'fake-react.mjs': FAKE_REACT,
  'jsx-runtime.mjs': lines('export function jsx(type, props, key) { return { type, props, key }; }', 'export const jsxs = jsx;', "export const Fragment = 'Fragment';"),
  'clerk.mjs': lines('export function useAuth() { return globalThis.__auth; }'),
  'navigation.mjs': lines('export function useRouter() { return globalThis.__router; }'),
  'hotkeys.mjs': lines('export function HotkeysProvider(props) { return props.children; }'),
  'icons.mjs': lines(...['RotateCcw', 'UploadCloud', 'FilePlus', 'FolderOpen', 'Image', 'AlertCircle'].map((n) => `export function ${n}() { return null; }`)),
  'button.mjs': lines('export default function Button() { return null; }'),
  'landing.mjs': lines('export default function EditorLanding() { return null; }'),
  'body.mjs': lines('export default function PixelEditorBody() { return null; }'),
  'upload.mjs': lines('export default function UploadZone() { return null; }'),
  'recovery.mjs': FAKE_STORE,
  'entry.mjs': lines(
    `export { default as EditorPage } from ${JSON.stringify(path.join(ROOT, 'src/app/editor/page.tsx'))};`,
    `export { default as EditorDraftBanner } from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/EditorDraftBanner.tsx'))};`,
    `export { useSpriteStore } from ${JSON.stringify(path.join(ROOT, 'src/stores/spriteStore.ts'))};`,
    `export { default as EditorLanding } from ${JSON.stringify(path.join(DIR, 'landing.mjs'))};`,
    `export { default as PixelEditorBody } from ${JSON.stringify(path.join(DIR, 'body.mjs'))};`,
    `export { default as RealLanding } from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/EditorLanding.tsx'))};`,
    `export { default as UploadZone } from ${JSON.stringify(path.join(DIR, 'upload.mjs'))};`,
    `export { useEditorStore } from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/editorStore.ts'))};`,
    `export { default as Button } from ${JSON.stringify(path.join(DIR, 'button.mjs'))};`,
    `export { mount } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};`,
  ),
};
for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(DIR, name), text);
const stubs = {
  react: 'fake-react.mjs', 'react/jsx-runtime': 'jsx-runtime.mjs', 'react/jsx-dev-runtime': 'jsx-runtime.mjs',
  '@clerk/react': 'clerk.mjs', 'next/navigation': 'navigation.mjs', 'react-hotkeys-hook': 'hotkeys.mjs',
  'lucide-react': 'icons.mjs', '@/components/ui/Button': 'button.mjs', '@/components/sprites/EditorLanding': 'landing.mjs',
  '@/components/sprites/PixelEditorBody': 'body.mjs', '@/lib/editorRecovery': 'recovery.mjs', './UploadZone': 'upload.mjs',
};
globalThis.window = globalThis;
globalThis.location = { hostname: 'localhost', pathname: '/editor' };
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
};
const OUT = path.join(DIR, 'bundle.mjs');
await build({
  entryPoints: [path.join(DIR, 'entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent', jsx: 'automatic',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  plugins: [{ name: 'stand-ins', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (stubs[args.path] ? { path: path.join(DIR, stubs[args.path]) } : undefined));
  } }],
});
const R = await import(pathToFileURL(OUT).href);
const db = globalThis.__draftDb;

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
function find(node, type, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => find(n, type, out)); return out; }
  if (node.type === type) out.push(node);
  if (node.props) find(node.props.children, type, out);
  return out;
}
const draft = (id, owner, updatedAt) => ({
  draftId: id, projectKey: id, updatedAt, createdAt: updatedAt,
  summary: { width: 8, height: 8, frameCount: 1 },
  project: { source: { kind: 'generation' }, canvas: { width: 8, height: 8 }, color: { palette: [] }, frames: [{ id: 'f1' }] },
  ...(owner === undefined ? {} : { owner }),
});
let router;
function world() {
  db.manifests.clear(); db.log.length = 0; db.hold = {}; db.waiting = {};
  db.manifests.set('modal:a1', draft('modal:a1', 'user_a', 3));
  db.manifests.set('page:scratch', draft('page:scratch', undefined, 1));
  router = { pushes: [] };
  globalThis.__router = { push: (u) => router.pushes.push(u), replace() {}, back() {}, prefetch() {} };
  R.useSpriteStore.getState().setPendingEditorRestore(null);
}
const release = async (name) => { db.hold[name] = false; (db.waiting[name] || []).splice(0).forEach((r) => r()); await settle(); };
const signIn = (user, loaded = true) => { globalThis.__auth = { isLoaded: loaded, userId: user }; };
async function page(user, loaded = true) {
  signIn(user, loaded);
  const c = R.mount(() => R.EditorPage());
  await settle();
  return c;
}
const landing = (c) => (find(c.value, R.EditorLanding)[0] || { props: null }).props;
const body = (c) => (find(c.value, R.PixelEditorBody)[0] || { props: null }).props;
const listed = (c) => (landing(c) ? landing(c).drafts.map((m) => m.draftId) : null);
const switchTo = async (c, user) => { signIn(user); c.update(); };
const loads = () => db.log.filter((e) => e[0] === 'load').map((e) => e[1]);

// 1. The Editor's list: shown to its account only, hidden at once.
{
  world();
  const c = await page('user_a');
  const asA = listed(c);
  db.hold.list = true;
  await switchTo(c, null);
  const atOnce = listed(c);
  await release('list');
  const signedOut = listed(c);
  check("the Editor lists A's draft for A; signing out hides it at once, before the new list; the new list has only the device's draft",
    same(asA, ['modal:a1', 'page:scratch']) && same(atOnce, []) && same(signedOut, ['page:scratch']), { asA, atOnce, signedOut });
  c.unmountLayout(); c.unmountPassive();
}

// 2. A Restore taken from A's list after a sign-out does nothing.
{
  world();
  const c = await page('user_a');
  const restore = landing(c).onRestoreDraft;
  await switchTo(c, null);
  restore('modal:a1');
  await settle();
  check("a Restore from A's list, used after signing out, opens nothing and loads nothing", body(c) === null && same(loads(), []), { body: !!body(c), loads: loads() });
  c.unmountLayout(); c.unmountPassive();
}

// 3. A Restore that finishes after an account change does nothing.
for (const [label, other] of [['a sign-out', null], ['another account', 'user_b']]) {
  world();
  const c = await page('user_a');
  db.hold.load = true;
  landing(c).onRestoreDraft('modal:a1');
  await settle();
  await switchTo(c, other);
  await release('load');
  check(`A's Restore that finishes after ${label} does not open A's draft`, body(c) === null, { body: !!body(c) });
  c.unmountLayout(); c.unmountPassive();
}

// 4. A Discard taken from A's list after a sign-out does nothing.
{
  world();
  const c = await page('user_a');
  const discard = landing(c).onDiscardDraft;
  await switchTo(c, null);
  discard('modal:a1');
  await settle();
  check("a Discard from A's list, used after signing out, deletes nothing", db.manifests.has('modal:a1') && !db.log.some((e) => e[0] === 'delete'), db.log);
  c.unmountLayout(); c.unmountPassive();
}

// 5. Controls: A restores and discards A's own; anyone the device's draft.
{
  world();
  const c = await page('user_a');
  landing(c).onRestoreDraft('modal:a1');
  await settle();
  const opened = body(c);
  c.unmountLayout(); c.unmountPassive();
  world();
  const d = await page('user_a');
  landing(d).onDiscardDraft('modal:a1');
  await settle();
  const deleted = !db.manifests.has('modal:a1');
  d.unmountLayout(); d.unmountPassive();
  world();
  const e = await page(null);
  landing(e).onRestoreDraft('page:scratch');
  await settle();
  const legacy = body(e);
  e.unmountLayout(); e.unmountPassive();
  check("A restores and discards A's own draft; signed out, the device's own draft restores",
    !!(opened && opened.restore && opened.draftKey === 'modal:a1') && deleted && !!(legacy && legacy.draftKey === 'page:scratch'), { opened: !!opened, deleted, legacy: !!legacy });
}

// 6. A new image chosen while a Restore is still loading wins.
{
  world();
  const c = await page('user_a');
  db.hold.load = true;
  landing(c).onRestoreDraft('modal:a1');
  await settle();
  landing(c).onProjectReady('data:image/png;base64,AA', 8, 8, { kind: 'blank' });
  await settle();
  await release('load');
  const props = body(c);
  check('a new image chosen while a Restore loads stays; the Restore does not replace it', !!props && !props.restore && props.frameDataUrl === 'data:image/png;base64,AA', props && { restore: !!props.restore });
  c.unmountLayout(); c.unmountPassive();
}

// 7. Generate's one-shot Restore opens only for the account that chose it,
// and waits for Clerk.
{
  world();
  R.useSpriteStore.getState().setPendingEditorRestore({ draftId: 'modal:a1', account: 'user_a' });
  const b = await page('user_b');
  const asB = { body: !!body(b), loads: loads(), left: R.useSpriteStore.getState().pendingEditorRestore };
  b.unmountLayout(); b.unmountPassive();
  world();
  R.useSpriteStore.getState().setPendingEditorRestore({ draftId: 'modal:a1', account: 'user_a' });
  const a = await page('user_a', false);
  const beforeClerk = { body: !!body(a), left: R.useSpriteStore.getState().pendingEditorRestore };
  await switchTo(a, 'user_a');
  await settle();
  const asA = !!(body(a) && body(a).draftKey === 'modal:a1');
  a.unmountLayout(); a.unmountPassive();
  check("Generate's Restore opens A's draft for A only (not for B), and waits for Clerk",
    !asB.body && same(asB.loads, []) && asB.left === null && !beforeClerk.body && beforeClerk.left !== null && asA, { asB, beforeClerk, asA });
}

// 8. Generate's banner: shown to its account only, hidden at once.
async function banner(user) {
  signIn(user);
  const c = R.mount(() => R.EditorDraftBanner());
  await settle();
  return c;
}
const restoreButton = (c) => (find(c.value, R.Button)[0] || { props: {} }).props.onClick;
const discardButton = (c) => (find(c.value, 'button')[0] || { props: {} }).props.onClick;
{
  world();
  const c = await banner('user_a');
  const shown = c.value !== null;
  db.hold.list = true;
  await switchTo(c, 'user_b');
  const atOnce = c.value;
  await release('list');
  check("Generate's banner offers A's draft to A, and hides it the moment B is signed in", shown && atOnce === null && c.value === null, { shown, atOnce: atOnce !== null });
  c.unmountLayout(); c.unmountPassive();
}
{
  world();
  const c = await banner('user_a');
  const restore = restoreButton(c);
  const discard = discardButton(c);
  await switchTo(c, null);
  restore();
  discard();
  await settle();
  check("the banner's Restore and Discard, used after signing out, do nothing",
    R.useSpriteStore.getState().pendingEditorRestore === null && same(router.pushes, []) && db.manifests.has('modal:a1'), { pushes: router.pushes, log: db.log });
  c.unmountLayout(); c.unmountPassive();
}
{
  world();
  const c = await banner('user_a');
  restoreButton(c)();
  await settle();
  const intent = R.useSpriteStore.getState().pendingEditorRestore;
  c.unmountLayout(); c.unmountPassive();
  world();
  const d = await banner('user_a');
  discardButton(d)();
  await settle();
  check("for A, the banner's Restore hands A's draft to the Editor for A, and Discard deletes it",
    same(intent, { draftId: 'modal:a1', account: 'user_a' }) && !db.manifests.has('modal:a1'), { intent, log: db.log });
  d.unmountLayout(); d.unmountPassive();
}

// Second 122 P2-B: an action belongs to its visit. A sign-out takes the
// banner away with Generate's signed-in view (<Show when="signed-in">)
// without rendering it again, so the banner never sees the signed-out
// account; its going must end what it started.
const removeSignedOut = (c, passiveLater) => {
  c.unmountLayout();
  signIn(null);
  if (!passiveLater) c.unmountPassive();
};
for (const passiveLater of [false, true]) {
  const when = passiveLater ? ', the commit done and its passive cleanups not yet run' : '';
  world();
  const c = await banner('user_a');
  db.hold.latest = true;
  discardButton(c)();
  await settle();
  removeSignedOut(c, passiveLater);
  await release('latest');
  const discardLeft = db.manifests.has('modal:a1') && !db.log.some((e) => e[0] === 'delete');
  if (passiveLater) c.unmountPassive();
  world();
  const d = await banner('user_a');
  db.hold.latest = true;
  restoreButton(d)();
  await settle();
  removeSignedOut(d, passiveLater);
  await release('latest');
  const restoreLeft = R.useSpriteStore.getState().pendingEditorRestore === null && same(router.pushes, []);
  if (passiveLater) d.unmountPassive();
  check(`a banner Discard or Restore still waiting on its owner check when a sign-out removes the banner${when} does nothing`,
    discardLeft && restoreLeft, { discardLeft, restoreLeft, pushes: router.pushes, log: db.log });
}
{
  // The banner stays up while the account changes under a held check.
  world();
  const c = await banner('user_a');
  db.hold.latest = true;
  discardButton(c)();
  restoreButton(c)();
  await settle();
  await switchTo(c, 'user_b');
  await release('latest');
  check("a banner Discard or Restore still waiting on its owner check when the account changes does nothing",
    db.manifests.has('modal:a1') && R.useSpriteStore.getState().pendingEditorRestore === null && same(router.pushes, []), { pushes: router.pushes, log: db.log });
  c.unmountLayout(); c.unmountPassive();
}
{
  // The same on the Editor page, which stays up while the account changes.
  world();
  const c = await page('user_a');
  db.hold.latest = true;
  landing(c).onDiscardDraft('modal:a1');
  await settle();
  await switchTo(c, 'user_b');
  await release('latest');
  check("a page Discard still waiting on its owner check when the account changes deletes nothing",
    db.manifests.has('modal:a1') && !db.log.some((e) => e[0] === 'delete'), db.log);
  c.unmountLayout(); c.unmountPassive();
}
{
  // The control: the same held checks, with the banner still up, act.
  world();
  const c = await banner('user_a');
  db.hold.latest = true;
  restoreButton(c)();
  await settle();
  await release('latest');
  const intent = R.useSpriteStore.getState().pendingEditorRestore;
  const pushes = [...router.pushes];
  c.unmountLayout(); c.unmountPassive();
  world();
  const d = await banner('user_a');
  db.hold.latest = true;
  discardButton(d)();
  await settle();
  await release('latest');
  check("with the banner still up, A's held Restore hands A's draft on and A's held Discard deletes it",
    same(intent, { draftId: 'modal:a1', account: 'user_a' }) && same(pushes, ['/editor']) && !db.manifests.has('modal:a1'), { intent, pushes, log: db.log });
  d.unmountLayout(); d.unmountPassive();
}

// The Editor page goes too (the Sidebar's sign-out navigates away): a
// Discard, a Restore or a restored draft's own Discard that answers after
// the page went does nothing, and never resets the editor store another
// editor may be using by then.
const loadOther = () => {
  const px = new Uint8ClampedArray(16).fill(200);
  R.useEditorStore.getState().loadFrame('other', px, 2, 2, { kind: 'blank' });
};
{
  world();
  const c = await page('user_a');
  db.hold.latest = true;
  landing(c).onDiscardDraft('modal:a1');
  await settle();
  removeSignedOut(c, false);
  await release('latest');
  const discardLeft = db.manifests.has('modal:a1') && !db.log.some((e) => e[0] === 'delete');
  world();
  const d = await page('user_a');
  db.hold.latest = true;
  landing(d).onRestoreDraft('modal:a1');
  await settle();
  removeSignedOut(d, false);
  await release('latest');
  const restoreLoaded = loads().length > 0;
  world();
  const e = await page('user_a');
  landing(e).onRestoreDraft('modal:a1');
  await settle();
  const restored = body(e);
  db.hold.latest = true;
  const own = restored.onDiscardDraft();
  await settle();
  removeSignedOut(e, false);
  loadOther();
  await release('latest');
  await own;
  const store = R.useEditorStore.getState();
  const kept = db.manifests.has('modal:a1') && store.pixels !== null && store.width === 2;
  check("a page Discard, Restore or restored draft's Discard still waiting when the page goes does nothing (no delete, no load, no reset)",
    discardLeft && !restoreLoaded && kept, { discardLeft, restoreLoaded, kept, log: db.log });
  R.useEditorStore.getState().reset();
}

// Second 122 P2-D: each draft gets its own editor body, and a close for one
// draft never closes another that took its place.
{
  world();
  const c = await page('user_a');
  landing(c).onRestoreDraft('modal:a1');
  await settle();
  const node = find(c.value, R.PixelEditorBody)[0];
  const restoreKeyed = !!node && node.key === 'modal:a1' && node.props.draftKey === 'modal:a1';
  c.unmountLayout(); c.unmountPassive();
  world();
  const d = await page('user_a');
  const lateReady = landing(d).onProjectReady;
  lateReady('data:image/png;base64,AA', 8, 8, { kind: 'blank' });
  await settle();
  const a = find(d.value, R.PixelEditorBody)[0];
  const imageKeyed = !!a && a.key === a.props.draftKey && a.props.draftKey.startsWith('page:');
  // A late callback brings B while A is open; A's close (its Leave's
  // fallback, say) runs before React has rendered B.
  lateReady('data:image/png;base64,BB', 8, 8, { kind: 'blank' });
  a.props.onDismiss();
  await settle();
  const b = find(d.value, R.PixelEditorBody)[0];
  const bStays = !!b && b.props.frameDataUrl === 'data:image/png;base64,BB' && b.key !== a.key;
  // B's own close still closes B.
  if (b) b.props.onDismiss();
  await settle();
  const closed = !!b && body(d) === null && landing(d) !== null;
  check("the page keys the editor body by its draft, and A's close never closes the draft B that took its place; B's own close does",
    restoreKeyed && imageKeyed && bStays && closed, { restoreKeyed, imageKeyed, bStays, closed });
  d.unmountLayout(); d.unmountPassive();
}

// George's copy (HQ 2026-10-30-001): the real landing heads its newest
// draft by how its session ended.
{
  const heading = (drafts) => {
    const c = R.mount(() => R.RealLanding({ onProjectReady() {}, drafts, onRestoreDraft() {}, onDiscardDraft() {} }));
    const text = find(c.value, 'p').map((n) => n.props.children).find((t) => typeof t === 'string' && t.endsWith('your last edit?'));
    c.unmountLayout(); c.unmountPassive();
    return text;
  };
  const open = heading([draft('modal:a1', 'user_a', 3)]);
  const closed = heading([{ ...draft('page:c1', 'user_a', 4), closedAt: 5 }]);
  check('the Editor landing heads an interrupted draft "Recover your last edit?" and one that ended normally "Continue your last edit?"',
    open === 'Recover your last edit?' && closed === 'Continue your last edit?', { open, closed });
}

// The landing's latest choice wins: an upload that finishes decoding after
// a later choice, or after the landing went, opens nothing.
function realLanding() {
  const calls = { ready: [], chose: 0, restore: [] };
  const c = R.mount(() => R.RealLanding({
    onProjectReady: (url) => calls.ready.push(url),
    onChoose: () => { calls.chose++; },
    drafts: [draft('modal:a1', 'user_a', 3)],
    onRestoreDraft: (id) => calls.restore.push(id),
    onDiscardDraft: () => {},
  }));
  const zone = () => find(c.value, R.UploadZone)[0].props;
  const restore = () => find(c.value, R.Button).find((n) => n.props.children === 'Restore').props.onClick();
  const blank = () => find(c.value, R.Button).find((n) => Array.isArray(n.props.children) && n.props.children[0] === 'Start blank ').props.onClick();
  return { c, calls, zone, restore, blank };
}
const fileOf = (name) => ({ name });
{
  const revoked = [];
  const realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    const l = realLanding();
    const f = fileOf('b.png');
    l.zone().onLoadStart?.(f);
    l.zone().onImageLoaded(f, 'blob:b', 8, 8);
    const control = same(l.calls.ready, ['blob:b']) && l.calls.chose === 1;
    l.c.unmountLayout(); l.c.unmountPassive();

    const m = realLanding();
    const g = fileOf('b.png');
    m.zone().onLoadStart?.(g);
    const loaded = m.zone().onImageLoaded;
    m.c.unmountLayout(); m.c.unmountPassive();
    loaded(g, 'blob:gone', 8, 8);
    const afterGone = m.calls.ready.length === 0 && revoked.includes('blob:gone');

    const n = realLanding();
    const h = fileOf('b.png');
    n.zone().onLoadStart?.(h);
    n.restore();
    n.zone().onImageLoaded(h, 'blob:late', 8, 8);
    const afterRestore = n.calls.ready.length === 0 && same(n.calls.restore, ['modal:a1']) && revoked.includes('blob:late');
    n.c.unmountLayout(); n.c.unmountPassive();

    const o = realLanding();
    const first = fileOf('first.png');
    const second = fileOf('second.png');
    o.zone().onLoadStart?.(first);
    o.zone().onLoadStart?.(second);
    o.zone().onImageLoaded(first, 'blob:first', 8, 8);
    o.zone().onImageLoaded(second, 'blob:second', 8, 8);
    const latestUpload = same(o.calls.ready, ['blob:second']) && o.calls.chose === 2;
    o.c.unmountLayout(); o.c.unmountPassive();

    const q = realLanding();
    const k = fileOf('b.png');
    q.zone().onLoadStart?.(k);
    const realDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ width: 0, height: 0, toDataURL: () => 'data:blank' }) };
    try { q.blank(); } finally { globalThis.document = realDocument; }
    q.zone().onImageLoaded(k, 'blob:afterBlank', 8, 8);
    const afterBlank = same(q.calls.ready, ['data:blank']) && revoked.includes('blob:afterBlank');
    q.c.unmountLayout(); q.c.unmountPassive();
    check("the landing's latest choice wins: an upload decoded after the landing went, after a Restore, a blank canvas or a newer upload opens nothing (its blob URL is let go); one decoded in time opens",
      control && afterGone && afterRestore && latestUpload && afterBlank, { control, afterGone, afterRestore, latestUpload, afterBlank, calls: [l.calls, m.calls, n.calls, o.calls, q.calls] });
  } finally {
    URL.revokeObjectURL = realRevoke;
  }
}
{
  // StrictMode in development runs every effect a second time right after
  // the first mount; that is not the page, the banner or the landing going.
  world();
  R.useSpriteStore.getState().setPendingEditorRestore({ draftId: 'modal:a1', account: 'user_a' });
  signIn('user_a');
  const c = R.mount(() => R.EditorPage());
  c.strictReplay();
  await settle();
  const oneShot = !!(body(c) && body(c).draftKey === 'modal:a1');
  c.unmountLayout(); c.unmountPassive();
  world();
  const d = await banner('user_a');
  d.strictReplay();
  await settle();
  discardButton(d)();
  await settle();
  const bannerDiscard = !db.manifests.has('modal:a1');
  d.unmountLayout(); d.unmountPassive();
  const l = realLanding();
  l.c.strictReplay();
  const f = fileOf('b.png');
  l.zone().onLoadStart?.(f);
  l.zone().onImageLoaded(f, 'blob:strict', 8, 8);
  const upload = same(l.calls.ready, ['blob:strict']);
  l.c.unmountLayout(); l.c.unmountPassive();
  check("under StrictMode's second run of effects, Generate's one-shot Restore still opens, and the banner's Discard and the landing's upload still act",
    oneShot && bannerDiscard && upload, { oneShot, bannerDiscard, upload });
}
{
  // Audit r5: a Discard of the draft a Restore is loading cancels the
  // Restore, so the editor never opens on a deleted draft; a Discard of
  // another draft does not.
  world();
  const c = await page('user_a');
  db.hold.load = true;
  landing(c).onRestoreDraft('modal:a1');
  await settle();
  landing(c).onDiscardDraft('modal:a1');
  await settle();
  await release('load');
  const same_ = body(c) === null && !db.manifests.has('modal:a1');
  c.unmountLayout(); c.unmountPassive();
  world();
  const d = await page('user_a');
  db.hold.load = true;
  landing(d).onRestoreDraft('modal:a1');
  await settle();
  landing(d).onDiscardDraft('page:scratch');
  await settle();
  await release('load');
  const other = !!(body(d) && body(d).draftKey === 'modal:a1') && !db.manifests.has('page:scratch');
  d.unmountLayout(); d.unmountPassive();
  check('a Discard of the draft a Restore is loading cancels the Restore (no editor on a deleted draft); a Discard of another draft does not',
    same_ && other, { same: same_, other });
}
{
  // Audit r5: a stale action that is refused leaves what the newer account
  // sees alone: Generate's offer for B, and the Editor's list for B.
  world();
  db.manifests.set('modal:b1', draft('modal:b1', 'user_b', 2));
  const c = await banner('user_a');
  db.hold.latest = true;
  restoreButton(c)();
  await settle();
  await switchTo(c, 'user_b');
  await settle();
  const bShown = c.value !== null;
  await release('latest');
  const bKept = c.value !== null && R.useSpriteStore.getState().pendingEditorRestore === null && same(router.pushes, []);
  c.unmountLayout(); c.unmountPassive();
  world();
  const d = await page('user_a');
  db.hold.latest = true;
  landing(d).onDiscardDraft('page:scratch');
  await settle();
  await switchTo(d, 'user_b');
  await settle();
  const bList = listed(d);
  await release('latest');
  const bListAfter = listed(d);
  d.unmountLayout(); d.unmountPassive();
  check("a stale banner Restore or page Discard that is refused leaves B's offer and B's list alone",
    bShown && bKept && same(bList, ['page:scratch']) && same(bListAfter, ['page:scratch']) && db.manifests.has('page:scratch'), { bShown, bKept, bList, bListAfter });
}
{
  // The page drops a restore still loading when an upload starts.
  world();
  const c = await page('user_a');
  db.hold.load = true;
  landing(c).onRestoreDraft('modal:a1');
  await settle();
  landing(c).onChoose?.();
  await release('load');
  check('an upload started while a Restore loads cancels the Restore', body(c) === null && landing(c) !== null, { body: !!body(c) });
  c.unmountLayout(); c.unmountPassive();
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('all pass');
