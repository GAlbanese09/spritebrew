// scripts/sheet-tabs-test.mjs
//
// Offline tests for the Sheet Tools leave guard across tabs (audit M1 of PR
// #53, fix round 1): the saved session is one IndexedDB record shared by
// every tab, so another tab's save or clear must make this tab's guard ask
// again (src/hooks/useSheetSession.ts, src/lib/sheetSessionSignal.ts). Run
// from the repo root: `node scripts/sheet-tabs-test.mjs`. Prints only case
// names and pass or fail; exit code 1 on any FAIL.
//
// The real useSheetSession, sheetSession, sheetSessionSignal and sprite store
// are bundled with esbuild into local/.sheet-tabs-test/ (gitignored), once
// per tab, each tab with its own window and document. Stand-ins: react (a
// small one that runs effects, as in editor-history-guard-test), idb (one
// fake IndexedDB shared by the tabs, which logs each tab's reads and writes
// and can hold a tab's write until the test lets it land), and the channel
// (one fake bus that, like a real one, delivers later, and that also
// delivers to the tab that posted, so ignoring its own message is tested).
// Each scripted order imports fresh module instances, as a page load would.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.sheet-tabs-test');
fs.mkdirSync(DIR, { recursive: true });
const lines = (...l) => l.join(String.fromCharCode(10)) + String.fromCharCode(10);

fs.writeFileSync(path.join(DIR, 'fake-react.mjs'), lines(
  'let current = null;',
  'const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));',
  'function slot(init) { const c = current; const i = c.i++; if (!(i in c.slots)) c.slots[i] = init(); return c.slots[i]; }',
  'export function useState(init) {',
  '  const c = current;',
  '  const s = slot(() => ({ value: typeof init === "function" ? init() : init }));',
  '  if (!s.set) s.set = (v) => { s.value = typeof v === "function" ? v(s.value) : v; if (!c.rendering) c.render(); };',
  '  return [s.value, s.set];',
  '}',
  'export function useRef(init) { return slot(() => ({ current: init })); }',
  'export function useCallback(fn, deps) { const s = slot(() => ({ fn, deps })); if (!same(s.deps, deps)) { s.fn = fn; s.deps = deps; } return s.fn; }',
  'export function useMemo(fn, deps) { const s = slot(() => ({ v: fn(), deps })); if (!same(s.deps, deps)) { s.v = fn(); s.deps = deps; } return s.v; }',
  'export function useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot(); }',
  'export function useDebugValue() {}',
  'function effectHook(kind) {',
  '  return function (fn, deps) {',
  '    const c = current; const i = c.i++; const prev = c.slots[i];',
  '    if (prev && deps !== undefined && same(prev.deps, deps)) return;',
  '    const s = { deps, cleanup: prev && prev.cleanup, effect: kind, fn };',
  '    c.slots[i] = s;',
  '    c.pending.push(() => { if (s.cleanup) s.cleanup(); const k = fn(); s.cleanup = typeof k === "function" ? k : undefined; });',
  '  };',
  '}',
  'export const useLayoutEffect = effectHook("layout");',
  'export const useEffect = effectHook("passive");',
  'const React = { useState, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, useLayoutEffect, useEffect };',
  'export default React;',
  'export function mount(component) {',
  '  const c = { slots: {}, pending: [], i: 0, rendering: false };',
  '  c.render = () => { current = c; c.i = 0; c.rendering = true; try { c.value = component(); } finally { current = null; c.rendering = false; } c.pending.splice(0).forEach((r) => r()); };',
  '  c.unmount = () => Object.values(c.slots).forEach((s) => s && s.cleanup && s.cleanup());',
  '  c.render();',
  '  return c;',
  '}',
));

// One IndexedDB for every tab. A tab's writes can be held (gates) or made to
// fail (failPut) per tab; every call is logged with the tab's name.
fs.writeFileSync(path.join(DIR, 'fake-idb.mjs'), lines(
  'const TAB = __SHEET_TAB__;',
  'const idb = () => globalThis.__sheetIdb;',
  'export async function openDB() {',
  '  return {',
  '    objectStoreNames: { contains: () => true },',
  '    async put(store, value, key) {',
  '      const s = idb(); s.ops.push([TAB, "put"]);',
  '      if (s.gates[TAB]) await s.gates[TAB].promise;',
  '      if (s.failPut[TAB]) throw new Error("quota");',
  '      s.data.set(key, structuredClone(value));',
  '    },',
  '    async get(store, key) { const s = idb(); s.ops.push([TAB, "get"]); const v = s.data.get(key); return v === undefined ? undefined : structuredClone(v); },',
  '    async delete(store, key) { const s = idb(); s.ops.push([TAB, "delete"]); s.data.delete(key); },',
  '    async count(store, key) { const s = idb(); s.ops.push([TAB, "count"]); return s.data.has(key) ? 1 : 0; },',
  '  };',
  '}',
));

fs.writeFileSync(path.join(DIR, 'entry.mjs'), lines(
  `export { sheetLeaveLosesWorkNow, forgetSheetSession, useSheetSession } from ${JSON.stringify(path.join(ROOT, 'src/hooks/useSheetSession.ts'))};`,
  `export { setSheetSessionTransport } from ${JSON.stringify(path.join(ROOT, 'src/lib/sheetSessionSignal.ts'))};`,
  `export { useSpriteStore } from ${JSON.stringify(path.join(ROOT, 'src/stores/spriteStore.ts'))};`,
  `export { mount } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};`,
));

for (const tab of ['a', 'b']) {
  await build({
    entryPoints: [path.join(DIR, 'entry.mjs')],
    bundle: true, format: 'esm', platform: 'node', outfile: path.join(DIR, `tab-${tab}.mjs`), logLevel: 'silent',
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    define: { window: `globalThis.__tabWindow_${tab}`, document: `globalThis.__tabDocument_${tab}`, __SHEET_TAB__: JSON.stringify(tab) },
    plugins: [{ name: 'stand-ins', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(DIR, 'fake-react.mjs') }));
      b.onResolve({ filter: /^idb$/ }, () => ({ path: path.join(DIR, 'fake-idb.mjs') }));
    } }],
  });
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};

// ── The stand-ins' state ──

globalThis.indexedDB = {}; // sheetSession.ts only asks whether it exists
// The failed-save order logs sheetSession's one warning; keep the output to case names.
console.warn = () => {};
const deferred = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };
function freshIdb() {
  globalThis.__sheetIdb = { data: new Map(), ops: [], gates: {}, failPut: {} };
  return globalThis.__sheetIdb;
}
function makeBus() {
  const listeners = new Set();
  const bus = { posts: 0 };
  bus.endpoint = () => ({
    post: (message) => {
      bus.posts++;
      for (const l of [...listeners]) setTimeout(() => l(message), 0);
    },
    listen: (onMessage) => { listeners.add(onMessage); return () => listeners.delete(onMessage); },
  });
  return bus;
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 10)); };

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const sheet = (id) => ({ id, name: id, sourceImage: PNG, frameWidth: 16, frameHeight: 16, columns: 1, rows: 1, totalFrames: 1, padding: 0, animations: [] });

let runs = 0;
/** A tab: fresh module instances (a page load), its own window and document. */
async function openTab(name, bus) {
  globalThis[`__tabWindow_${name}`] = new EventTarget();
  globalThis[`__tabDocument_${name}`] = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const mod = await import(`${pathToFileURL(path.join(DIR, `tab-${name}.mjs`)).href}?run=${++runs}`);
  mod.setSheetSessionTransport(bus.endpoint());
  const view = mod.mount(() => mod.useSheetSession());
  const store = mod.useSpriteStore;
  return {
    get hook() { return view.value; },
    loses: () => mod.sheetLeaveLosesWorkNow(),
    slice: (id) => store.setState({ spriteSheet: sheet(id), animations: [], frameDataUrls: new Map(), currentSheetMetadata: null, generationStyle: null }),
    edit: () => store.setState({ animations: [{ id: `g${Math.random()}`, name: 'Walk', type: 'walk', fps: 8, loop: true, frames: [] }] }),
    clearStore: () => store.setState({ spriteSheet: null, animations: [], frameDataUrls: new Map() }),
    replaceSheet: () => mod.forgetSheetSession(),
    /** Leaving the page flushes a pending save at once (pagehide). */
    flush: () => globalThis[`__tabWindow_${name}`].dispatchEvent(new Event('pagehide')),
    ops: () => globalThis.__sheetIdb.ops.filter(([t]) => t === name).map(([, op]) => op),
    unmount: () => view.unmount(),
  };
}
async function saved(tab) { tab.flush(); await settle(); }

// ── One tab alone: nine orders, the answers today's code gives ──
// Each answer is sheetLeaveLosesWorkNow() at that point.

const single = [];
const orders = {
  async 'open with nothing held'(r) { const t = await openTab('a', makeBus()); r(t.loses()); },
  async 'slice; then the save lands'(r) { const t = await openTab('a', makeBus()); t.slice('s1'); r(t.loses()); await saved(t); r(t.loses()); },
  async 'saved, then a change to the groups, then its save'(r) { const t = await openTab('a', makeBus()); t.slice('s1'); await saved(t); t.edit(); r(t.loses()); await saved(t); r(t.loses()); },
  async 'a save in flight, then it lands'(r) {
    const idb = globalThis.__sheetIdb; const gate = deferred(); idb.gates.a = gate;
    const t = await openTab('a', makeBus()); t.slice('s1'); t.flush(); await settle();
    r(t.loses()); r(idb.data.size); gate.release(); delete idb.gates.a; await settle(); r(t.loses()); r(idb.data.size);
  },
  async 'Replace sheet: the sheet still shown, then the store cleared'(r) { const t = await openTab('a', makeBus()); t.slice('s1'); await saved(t); t.replaceSheet(); await settle(); r(t.loses()); r(globalThis.__sheetIdb.data.size); t.clearStore(); r(t.loses()); },
  async 'reload after the save, then Discard on the Restore offer'(r) {
    const first = await openTab('a', makeBus()); first.slice('s1'); await saved(first); first.unmount();
    const t = await openTab('a', makeBus()); await settle(); r(t.hook.offerRestore); r(t.loses()); t.hook.discard(); await settle(); r(globalThis.__sheetIdb.data.size); r(t.loses());
  },
  async 'Restore with nothing changed, then a change, then its save'(r) {
    const first = await openTab('a', makeBus()); first.slice('s1'); await saved(first); first.unmount();
    const t = await openTab('a', makeBus()); await settle(); r(await t.hook.restore()); await settle(); r(t.loses()); t.edit(); r(t.loses()); await saved(t); r(t.loses());
  },
  async 'a failed save turns the guard on for good'(r) {
    globalThis.__sheetIdb.failPut.a = true;
    const t = await openTab('a', makeBus()); t.slice('s1'); await saved(t); r(t.loses()); delete globalThis.__sheetIdb.failPut.a; t.edit(); await saved(t); r(t.loses());
  },
  async 'reload after the save: nothing held, the offer, nothing at risk'(r) {
    const first = await openTab('a', makeBus()); first.slice('s1'); await saved(first); first.unmount();
    const t = await openTab('a', makeBus()); await settle(); r(t.loses()); r(t.hook.offerRestore);
  },
};
const TODAY = {
  'open with nothing held': [false],
  'slice; then the save lands': [true, false],
  'saved, then a change to the groups, then its save': [true, false],
  'a save in flight, then it lands': [true, 0, false, 1],
  'Replace sheet: the sheet still shown, then the store cleared': [false, 0, false],
  'reload after the save, then Discard on the Restore offer': [true, false, 0, false],
  'Restore with nothing changed, then a change, then its save': [true, false, true, false],
  'a failed save turns the guard on for good': [true, true],
  'reload after the save: nothing held, the offer, nothing at risk': [false, true],
};
for (const [name, run] of Object.entries(orders)) {
  freshIdb();
  const answers = [];
  await run((v) => answers.push(v));
  single.push([name, answers]);
  check(`one tab alone: ${name}: ${JSON.stringify(TODAY[name])}`, JSON.stringify(answers) === JSON.stringify(TODAY[name]), answers);
}
check('one tab alone: nine orders', single.length === 9);

// The audit's third uncaught mutation: lastSaved set before the save lands.
{
  const idb = freshIdb();
  const gate = deferred(); idb.gates.a = gate;
  const t = await openTab('a', makeBus());
  t.slice('s1'); t.flush(); await settle();
  const inFlight = t.loses();
  gate.release(); delete idb.gates.a; await settle();
  check('while its save is in flight a tab still counts its work as unsaved; once it lands, saved',
    inFlight === true && t.loses() === false, { inFlight, after: t.loses() });
}

// A tab ignores its own message: the fake bus delivers it back to the poster.
{
  freshIdb();
  const bus = makeBus();
  const t = await openTab('a', bus);
  t.slice('s1'); await saved(t);
  check('a tab ignores its own message (its save is posted and delivered back to it, and it stays saved)', bus.posts === 1 && t.loses() === false, bus.posts);
}

// ── Two tabs over one IndexedDB: the orders that must now ask in tab A ──

async function twoTabs() {
  freshIdb();
  const bus = makeBus();
  const A = await openTab('a', bus);
  A.slice('sheet-a'); await saved(A);
  const savedInA = A.loses() === false;
  const B = await openTab('b', bus);
  await settle();
  return { A, B, bus, savedInA };
}
const quietAfterHearing = async (A, opsBefore) => { await settle(); return A.ops().length === opsBefore; };

{
  const { A, B, savedInA } = await twoTabs();
  const offered = B.hook.offerRestore;
  const opsA = A.ops().length;
  B.hook.discard();
  await settle();
  check('(a) B presses Discard on the Restore offer: A asks again', savedInA && offered === true && A.loses() === true && globalThis.__sheetIdb.data.size === 0, { savedInA, offered });
  check('(a) hearing it, A neither saves, loads nor clears', await quietAfterHearing(A, opsA), A.ops());
}
{
  const { A, B, savedInA } = await twoTabs();
  const opsA = A.ops().length;
  B.slice('sheet-b'); await saved(B);
  check('(b) B slices another sheet and its save lands: A asks again', savedInA && A.loses() === true && globalThis.__sheetIdb.data.get('current')?.sheet?.id === 'sheet-b');
  check('(b) hearing it, A neither saves, loads nor clears', await quietAfterHearing(A, opsA), A.ops());
}
{
  const { A, B, savedInA } = await twoTabs();
  const opsA = A.ops().length;
  const restored = await B.hook.restore();
  await settle();
  const quietAfterRestore = A.loses() === false;
  B.replaceSheet();
  await settle();
  check('(c) B restores (A still saved), then presses Replace sheet: A asks again', savedInA && restored === true && quietAfterRestore && A.loses() === true, { restored, quietAfterRestore });
  check('(c) hearing it, A neither saves, loads nor clears', await quietAfterHearing(A, opsA), A.ops());
}
{
  freshIdb();
  const bus = makeBus();
  const first = await openTab('a', bus);
  first.slice('sheet-a'); await saved(first); first.unmount();
  const A = await openTab('a', bus);
  const B = await openTab('b', bus);
  await settle();
  const both = (await A.hook.restore()) && (await B.hook.restore());
  await settle();
  A.edit(); await saved(A);
  const savedInA = A.loses() === false;
  const opsA = A.ops().length;
  B.edit(); await saved(B);
  check('(d) both edit a restored session and B saves last: A asks again', both && savedInA && A.loses() === true && B.loses() === false, { both, savedInA });
  check('(d) hearing it, A neither saves, loads nor clears', await quietAfterHearing(A, opsA), A.ops());
  // A's next change saves again, and then it is B that asks.
  A.edit(); await saved(A);
  check('(d) A\'s next change is saved again, and then B asks', A.loses() === false && B.loses() === true);
}

// ── The browser transport: nothing opens at import or without a window ──

{
  const out = path.join(DIR, 'signal.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src/lib/sheetSessionSignal.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  });
  let opened = 0;
  const posted = [];
  const RealChannel = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = class {
    constructor(name) { opened++; this.name = name; this.listeners = []; }
    postMessage(m) { posted.push([this.name, m]); }
    addEventListener(type, fn) { this.listeners.push(fn); }
    removeEventListener() {}
  };
  const savedWindow = globalThis.window;
  delete globalThis.window;
  const sig = await import(`${pathToFileURL(out).href}?run=node`);
  sig.signalSheetSessionChanged();
  const stop = sig.onSheetSessionChangedElsewhere(() => {});
  stop();
  check('no window (node): importing and using the signal opens no channel and throws nothing', opened === 0 && posted.length === 0);

  globalThis.window = new EventTarget();
  const inBrowser = await import(`${pathToFileURL(out).href}?run=browser`);
  const importedOpened = opened;
  inBrowser.signalSheetSessionChanged();
  inBrowser.signalSheetSessionChanged();
  check('in a window: no channel at import; one BroadcastChannel on first use, named spritebrew-sheet-session, reused',
    importedOpened === 0 && opened === 1 && posted.length === 2 && posted.every(([n, m]) => n === 'spritebrew-sheet-session' && typeof m === 'string' && m.length > 0));

  // No BroadcastChannel: a localStorage counter, heard through the storage event.
  delete globalThis.BroadcastChannel;
  const store = new Map();
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
  });
  const fallback = await import(`${pathToFileURL(out).href}?run=storage`);
  let heard = 0;
  fallback.onSheetSessionChangedElsewhere(() => { heard++; });
  fallback.signalSheetSessionChanged();
  const first = store.get('spritebrew_sheet_session_signal');
  fallback.signalSheetSessionChanged();
  const second = store.get('spritebrew_sheet_session_signal');
  const fire = (newValue) => globalThis.window.dispatchEvent(Object.assign(new Event('storage'), { key: 'spritebrew_sheet_session_signal', newValue }));
  fire(second);
  const ownIgnored = heard === 0;
  fire('3 another-tab');
  check('no BroadcastChannel: a counter in localStorage that changes on each post, its own ignored, another tab\'s heard',
    /^1 \S+$/.test(first ?? '') && /^2 \S+$/.test(second ?? '') && ownIgnored && heard === 1, { first, second, heard });

  if (RealChannel) globalThis.BroadcastChannel = RealChannel;
  if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
}

console.log(fail ? `\n${fail} of ${pass + fail} failed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
