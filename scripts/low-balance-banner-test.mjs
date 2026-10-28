// scripts/low-balance-banner-test.mjs
//
// Offline lifecycle tests for the low-balance banner
// (src/components/sprites/LowBalanceBanner.tsx) with the real store
// (src/stores/spriteStore.ts) and rules (src/lib/lowBalance.ts): the order of
// its balance read against newer balances published meanwhile (a job's
// refresh, the purchase watcher), and account visits (Second 099). Run from
// the repo root: `node scripts/low-balance-banner-test.mjs`. Prints only case
// names and pass or fail.
//
// The banner is bundled with esbuild into local/.low-balance-banner-test/
// (gitignored), with react, its JSX runtime and @clerk/react swapped for small
// stand-ins written there too: the fake React of
// scripts/poll-lifecycle-test.mjs (an update during render renders again
// before anything commits; other updates re-render in a microtask) with
// useSyncExternalStore added for the store, a JSX runtime that returns plain
// objects, and a useAuth whose user each case sets. fetch, localStorage and
// the page's query are scripted. This models React rather than running it.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.low-balance-banner-test');
fs.mkdirSync(DIR, { recursive: true });

const FAKE_REACT = `
let current = null;
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
function schedule(c) {
  if (!c.scheduled) {
    c.scheduled = true;
    queueMicrotask(() => { c.scheduled = false; if (!c.unmounted) c.update(); });
  }
}
export function useState(init) {
  const c = current; const i = c.i++;
  if (!(i in c.slots)) c.slots[i] = { v: typeof init === 'function' ? init() : init };
  const slot = c.slots[i];
  if (!slot.set) {
    slot.set = (next) => {
      if (c.unmounted) { c.lateSets++; return; }
      slot.v = typeof next === 'function' ? next(slot.v) : next;
      // An update during the component's own render: React renders it again
      // at once, before anything commits (see mount).
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
// The store's subscription: any store write re-renders, in a microtask.
export function useSyncExternalStore(subscribe, getSnapshot) {
  const c = current; const i = c.i++;
  if (!(i in c.slots)) {
    const slot = { external: true };
    slot.unsubscribe = subscribe(() => { if (!c.unmounted) schedule(c); });
    c.slots[i] = slot;
  }
  return getSnapshot();
}
export function useDebugValue() {}
function effectHook(queue) {
  return function (fn, deps) {
    const c = current; const i = c.i++;
    const prev = c.slots[i];
    if (prev && same(prev.deps, deps)) return;
    const slot = { deps, cleanup: prev && prev.cleanup, effect: true };
    c.slots[i] = slot;
    c[queue].push(() => {
      if (slot.cleanup) slot.cleanup();
      const cleanup = fn();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    });
  };
}
export const useLayoutEffect = effectHook('layout');
export const useEffect = effectHook('passive');
export default { useState, useRef, useCallback, useSyncExternalStore, useDebugValue, useLayoutEffect, useEffect };
export function mount(component) {
  const c = { slots: {}, layout: [], passive: [], unmounted: false, scheduled: false, renderAgain: false, lateSets: 0, value: undefined, i: 0, renders: 0 };
  // A pass with an update during render is thrown away and rendered again,
  // as React does: its effects and callbacks are discarded; state and refs
  // are kept.
  c.render = () => {
    for (let pass = 0; ; pass++) {
      if (pass > 25) throw new Error('Too many re-renders');
      const kept = {};
      for (const [k, s] of Object.entries(c.slots)) if (s && (s.effect || s.memo)) kept[k] = s;
      const queued = [c.layout.length, c.passive.length];
      c.renderAgain = false;
      current = c; c.i = 0;
      try { c.value = component(); c.renders++; } finally { current = null; }
      if (!c.renderAgain) return;
      c.layout.length = queued[0];
      c.passive.length = queued[1];
      for (const [k, s] of Object.entries(c.slots)) {
        if (!s || !(s.effect || s.memo) || kept[k] === s) continue;
        if (k in kept) c.slots[k] = kept[k]; else delete c.slots[k];
      }
    }
  };
  c.commitLayout = () => c.layout.splice(0).forEach((run) => run());
  c.commitPassive = () => c.passive.splice(0).forEach((run) => run());
  c.update = () => { c.render(); c.commitLayout(); c.commitPassive(); };
  c.unmount = () => {
    c.unmounted = true;
    Object.values(c.slots).forEach((s) => {
      if (s && s.effect && s.cleanup) s.cleanup();
      if (s && s.external) s.unsubscribe();
    });
  };
  c.update();
  return c;
}
`;
const JSX_RUNTIME = `
export function jsx(type, props) { return { type, props }; }
export const jsxs = jsx;
export const Fragment = 'Fragment';
`;
const CLERK_STUB = 'export function useAuth() { return { getToken: globalThis.__getToken, userId: globalThis.__userId }; }';
const ENTRY = `
export { default as LowBalanceBanner } from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/LowBalanceBanner.tsx'))};
export { useSpriteStore } from ${JSON.stringify(path.join(ROOT, 'src/stores/spriteStore.ts'))};
export { lowBalanceDismissKey, lowBalanceLine } from ${JSON.stringify(path.join(ROOT, 'src/lib/lowBalance.ts'))};
export { mount } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};
`;
fs.writeFileSync(path.join(DIR, 'fake-react.mjs'), FAKE_REACT);
fs.writeFileSync(path.join(DIR, 'jsx-runtime.mjs'), JSX_RUNTIME);
fs.writeFileSync(path.join(DIR, 'clerk-stub.mjs'), CLERK_STUB);
fs.writeFileSync(path.join(DIR, 'entry.mjs'), ENTRY);

// localStorage, window and the page's query, before the modules load.
const storage = new Map();
const fakeStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => { storage.set(k, String(v)); },
  removeItem: (k) => { storage.delete(k); },
};
Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true });
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'location', { value: { search: '' }, configurable: true, writable: true });

// Scripted balance reads: each fetch waits until the case answers it.
let reads = [];
globalThis.__getToken = () => Promise.resolve('tok');
globalThis.fetch = (url) => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  reads.push({ url: String(url), resolve });
  return promise;
};
function answer(i, body) {
  reads[i].resolve({ ok: true, status: 200, json: async () => body });
}

const stubs = {
  react: path.join(DIR, 'fake-react.mjs'),
  'react/jsx-runtime': path.join(DIR, 'jsx-runtime.mjs'),
  'react/jsx-dev-runtime': path.join(DIR, 'jsx-runtime.mjs'),
  '@clerk/react': path.join(DIR, 'clerk-stub.mjs'),
};
const OUT = path.join(DIR, 'bundle.mjs');
await build({
  entryPoints: [path.join(DIR, 'entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'), jsx: 'automatic',
  plugins: [{
    name: 'stand-ins',
    setup(b) {
      b.onResolve({ filter: /^(react|@clerk)/ }, (args) => (stubs[args.path] ? { path: stubs[args.path] } : undefined));
    },
  }],
});
const { LowBalanceBanner, useSpriteStore, lowBalanceDismissKey, lowBalanceLine, mount } = await import(pathToFileURL(OUT).href);

const settle = () => new Promise((r) => setTimeout(r, 10));
const text = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.props?.children);
};
// The banner's line, or null when it renders nothing.
const shown = (h) => (h.value == null ? null : text(h.value).replace(/Buy tokensNot now$/, ''));
const balance = () => useSpriteStore.getState().tokenBalance;
// A balance published elsewhere on the page: a form's refresh after a job,
// the purchase watcher, the Sidebar.
const publish = (n) => useSpriteStore.getState().setTokenBalance(n);
const PAID = (n) => ({ success: true, balance: n, hasPaid: true });

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
function fresh() {
  storage.clear();
  reads = [];
  globalThis.location.search = '';
  globalThis.__userId = 'user_a';
  useSpriteStore.setState({ tokenBalance: 0, serverTokenBalance: null, tokenBalanceVersion: 0 });
}

// 0. The store's guarded publish.
{
  fresh();
  const s = useSpriteStore.getState();
  s.setTokenBalance(40);
  const v1 = useSpriteStore.getState().tokenBalanceVersion;
  const applied = useSpriteStore.getState().setTokenBalanceIfUnchanged(30, v1);
  const v2 = useSpriteStore.getState().tokenBalanceVersion;
  const refused = useSpriteStore.getState().setTokenBalanceIfUnchanged(10, v1);
  check('store: every balance published moves the version; a read publishes only at the version it began with',
    v1 === 1 && applied === true && v2 === 2 && refused === false && balance() === 30 && useSpriteStore.getState().tokenBalanceVersion === 2,
    { v1, applied, v2, refused, balance: balance() });
  useSpriteStore.getState().restoreTokenBalance(77);
  check("store: restoring this device's cached balance shows it, and leaves the version and the server's balance",
    balance() === 77 && useSpriteStore.getState().tokenBalanceVersion === 2 && useSpriteStore.getState().serverTokenBalance === 30 &&
    useSpriteStore.getState().setTokenBalanceIfUnchanged(12, 2) === true && useSpriteStore.getState().serverTokenBalance === 12,
    { balance: balance(), version: useSpriteStore.getState().tokenBalanceVersion, server: useSpriteStore.getState().serverTokenBalance });
}

// 1. Before its own read answers, the store's starting 0 shows nothing; a
// read with nothing published meanwhile is published and acted on.
{
  fresh();
  const h = mount(LowBalanceBanner);
  await settle();
  const before = shown(h);
  answer(0, PAID(18));
  await settle();
  check("the starting 0 shows nothing; the account's own read of 18 is published and shows the line",
    before === null && reads.length === 1 && balance() === 18 && shown(h) === lowBalanceLine(18),
    { before, reads: reads.length, balance: balance(), shown: shown(h) });
  h.unmount();
}

// 2. Second 099 P2: a job's refresh publishes 20 while the banner's read is
// in flight; the read then answers 100. The newer 20 stays and the banner
// shows.
{
  fresh();
  const h = mount(LowBalanceBanner);
  await settle();
  publish(20);
  await settle();
  const whileReading = shown(h);
  answer(0, PAID(100));
  await settle();
  check("a job's refresh to 20 during the read: the read's older 100 does not replace it, and the banner shows at 20",
    whileReading === null && balance() === 20 && shown(h) === lowBalanceLine(20),
    { whileReading, balance: balance(), shown: shown(h) });
  h.unmount();
}

// 3. The purchase ordering: back from Checkout, the purchase watcher
// publishes the credited 125 while the banner's read is in flight; the read
// then answers the pre-credit 20. The 125 stays, the banner stays hidden, the
// Checkout return's dismissal ends at 125, and a later fall to 20 shows it.
{
  fresh();
  globalThis.location.search = '?purchase=success';
  const h = mount(LowBalanceBanner);
  await settle();
  publish(125);
  await settle();
  answer(0, PAID(20));
  await settle();
  const afterRead = { balance: balance(), shown: shown(h) };
  publish(20);
  await settle();
  check('back from Checkout: the credited 125 published during the read stays; the banner is hidden, then shows after a fall to 20',
    afterRead.balance === 125 && afterRead.shown === null && balance() === 20 && shown(h) === lowBalanceLine(20) &&
    localStorage.getItem(lowBalanceDismissKey('user_a')) === null,
    { afterRead, balance: balance(), shown: shown(h) });
  h.unmount();
}

// 4. A balance published before the read began (a cached value at mount) is
// older than the read: the read replaces it.
{
  fresh();
  publish(300);
  const h = mount(LowBalanceBanner);
  await settle();
  answer(0, PAID(18));
  await settle();
  check('a balance published before the read began is replaced by the read',
    balance() === 18 && shown(h) === lowBalanceLine(18), { balance: balance(), shown: shown(h) });
  h.unmount();
}

// 5. Second 099 P3: an account round trip in one mount. A and B each kept a
// "Not now". A's read says 20; switch to B, whose read stays pending while
// B's form publishes 100; switch back to A. A's earlier read must not let B's
// 100 act for A: both dismissals hold, and A's fresh 20 keeps the banner
// hidden. B's read answering late changes nothing.
{
  fresh();
  localStorage.setItem(lowBalanceDismissKey('user_a'), '1');
  localStorage.setItem(lowBalanceDismissKey('user_b'), '1');
  const h = mount(LowBalanceBanner);
  await settle();
  answer(0, PAID(20));
  await settle();
  const onA = shown(h);
  globalThis.__userId = 'user_b';
  h.update();
  await settle();
  publish(100);
  await settle();
  globalThis.__userId = 'user_a';
  h.update();
  await settle();
  const backOnA = {
    a: localStorage.getItem(lowBalanceDismissKey('user_a')), b: localStorage.getItem(lowBalanceDismissKey('user_b')),
    shown: shown(h), reads: reads.length,
  };
  answer(2, PAID(20));
  await settle();
  answer(1, PAID(100));
  await settle();
  check("A to B to A: A's earlier read does not let B's 100 act for A; both kept dismissals hold; A's fresh 20 stays hidden",
    onA === null && backOnA.a === '1' && backOnA.b === '1' && backOnA.shown === null && backOnA.reads === 3 &&
    localStorage.getItem(lowBalanceDismissKey('user_a')) === '1' && localStorage.getItem(lowBalanceDismissKey('user_b')) === '1' &&
    shown(h) === null && balance() === 20,
    { onA, backOnA, a: localStorage.getItem(lowBalanceDismissKey('user_a')), shown: shown(h), balance: balance() });
  h.unmount();
}

// 6. The same round trip with no kept dismissals: back on A, nothing shows
// until A's fresh read answers, then A's own 20 does.
{
  fresh();
  const h = mount(LowBalanceBanner);
  await settle();
  answer(0, PAID(20));
  await settle();
  const onA = shown(h);
  globalThis.__userId = 'user_b';
  h.update();
  await settle();
  publish(10);
  await settle();
  const onB = shown(h);
  globalThis.__userId = 'user_a';
  h.update();
  await settle();
  const beforeFresh = shown(h);
  answer(2, PAID(20));
  await settle();
  const fresh20 = shown(h);
  // B's read, given up when B was left, answers late: it changes nothing.
  answer(1, PAID(100));
  await settle();
  check("A to B to A: nothing shows for B without B's read, nor for A until A's fresh read, then A's 20 does; B's late answer changes nothing",
    onA === lowBalanceLine(20) && onB === null && beforeFresh === null && fresh20 === lowBalanceLine(20) &&
    shown(h) === lowBalanceLine(20) && balance() === 20,
    { onA, onB, beforeFresh, fresh20, shown: shown(h), balance: balance() });
  h.unmount();
}

// 7. Each account visit starts from that account's own kept dismissal: B's
// "Not now" holds at 10 after A showed at 20, and A shows again after.
{
  fresh();
  localStorage.setItem(lowBalanceDismissKey('user_b'), '1');
  const h = mount(LowBalanceBanner);
  await settle();
  answer(0, PAID(20));
  await settle();
  const onA = shown(h);
  globalThis.__userId = 'user_b';
  h.update();
  await settle();
  answer(1, PAID(10));
  await settle();
  const onB = shown(h);
  globalThis.__userId = 'user_a';
  h.update();
  await settle();
  answer(2, PAID(20));
  await settle();
  check("a switch loads the account's own dismissal: B's kept Not now holds at 10; A shows before and after",
    onA === lowBalanceLine(20) && onB === null && shown(h) === lowBalanceLine(20) &&
    localStorage.getItem(lowBalanceDismissKey('user_b')) === '1' && localStorage.getItem(lowBalanceDismissKey('user_a')) === null,
    { onA, onB, shown: shown(h) });
  h.unmount();
}

// 8. An answer that lands after a switch is committed but before the old
// read's cleanup runs (React runs effect cleanups after the commit): it is
// not the shown account's read, so nothing acts on it for B, and back on A
// the switch's own pass acts on nothing, so A's kept dismissal holds.
{
  fresh();
  const h = mount(LowBalanceBanner);
  await settle();
  globalThis.__userId = 'user_b';
  h.render();
  h.commitLayout();
  answer(0, PAID(20));
  await settle();
  check("an answer for A landing after the switch to B is committed lets nothing show for B",
    shown(h) === null && reads.length === 2, { shown: shown(h), reads: reads.length });
  h.unmount();
}
{
  fresh();
  localStorage.setItem(lowBalanceDismissKey('user_a'), '1');
  localStorage.setItem(lowBalanceDismissKey('user_b'), '1');
  const h = mount(LowBalanceBanner);
  await settle();
  globalThis.__userId = 'user_b';
  h.render();
  h.commitLayout();
  answer(0, PAID(20));
  await settle();
  publish(100);
  await settle();
  globalThis.__userId = 'user_a';
  h.update();
  await settle();
  const backOnA = localStorage.getItem(lowBalanceDismissKey('user_a'));
  answer(2, PAID(20));
  await settle();
  check("and back on A, that answer does not let B's 100 end A's kept dismissal; A's fresh 20 stays hidden",
    backOnA === '1' && localStorage.getItem(lowBalanceDismissKey('user_a')) === '1' &&
    localStorage.getItem(lowBalanceDismissKey('user_b')) === '1' && shown(h) === null,
    { backOnA, a: localStorage.getItem(lowBalanceDismissKey('user_a')), shown: shown(h) });
  h.unmount();
}

// 9. A cached balance restored while the read is out (a form or the
// Sidebar mounting, from this device's cache) is older than the read, which
// still publishes over it. Back from Checkout with 1000 cached and 10 on the
// server: hidden while the credit is on its way, and still hidden at 20.
{
  fresh();
  globalThis.location.search = '?purchase=success';
  const h = mount(LowBalanceBanner);
  await settle();
  useSpriteStore.getState().restoreTokenBalance(1000);
  await settle();
  answer(0, PAID(10));
  await settle();
  const afterRead = { balance: balance(), shown: shown(h) };
  publish(20);
  await settle();
  check("back from Checkout with 1000 cached: the read's 10 replaces the cache, and the return's dismissal holds at 10 and 20",
    afterRead.balance === 10 && afterRead.shown === null && shown(h) === null,
    { afterRead, shown: shown(h) });
  h.unmount();
}

// 11. A cached copy never drives the banner, before or after its read (the
// banner audit, Oct 28). A refused read, then a restore (a tab switch
// remounting a form): the server's 20 still shows the banner, though the
// page shows the cached 1000 until the form's own read answers.
{
  fresh();
  const h = mount(LowBalanceBanner);
  await settle();
  publish(20);
  answer(0, PAID(100));
  await settle();
  useSpriteStore.getState().restoreTokenBalance(1000);
  await settle();
  check("a refused read, then a cached 1000 restored: the banner still acts on the server's 20",
    balance() === 1000 && useSpriteStore.getState().serverTokenBalance === 20 && shown(h) === lowBalanceLine(20),
    { balance: balance(), server: useSpriteStore.getState().serverTokenBalance, shown: shown(h) });
  h.unmount();
}
// 12. After a credit: back from Checkout, the read says 10, the watcher sees
// 510; then the first switch to the Animate tab restores the old cached 10.
// The banner stays hidden (beside "Payment received").
{
  fresh();
  globalThis.location.search = '?purchase=success';
  const h = mount(LowBalanceBanner);
  await settle();
  answer(0, PAID(10));
  await settle();
  publish(510);
  await settle();
  useSpriteStore.getState().restoreTokenBalance(10);
  await settle();
  check('after the credit, the old cached 10 restored by a tab switch does not show the banner',
    balance() === 10 && shown(h) === null, { balance: balance(), shown: shown(h) });
  h.unmount();
}
// 13. Back from Checkout with 1000 cached: the watcher's pre-credit 10 lands
// during the banner's read, then a tab switch restores 1000, then the
// banner's own 10 is refused. The Checkout hold must still stand: hidden,
// and still hidden at 20 until a balance of 25 or more comes from the server.
{
  fresh();
  globalThis.location.search = '?purchase=success';
  const h = mount(LowBalanceBanner);
  await settle();
  publish(10);
  useSpriteStore.getState().restoreTokenBalance(1000);
  await settle();
  answer(0, PAID(10));
  await settle();
  const afterRead = shown(h);
  publish(20);
  await settle();
  check('a restore between the watcher and the refused read does not end the Checkout hold',
    afterRead === null && shown(h) === null, { afterRead, shown: shown(h) });
  h.unmount();
}

// 10. Every cached restore in the app goes through restoreTokenBalance, so
// none moves the version (the forms and the Sidebar; not bundled above).
{
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const restores = [];
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => x.endsWith('.ts') || x.endsWith('.tsx'))) {
    fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).forEach((line, i) => {
      if (line.includes('parseInt(cached')) restores.push({ file: path.relative(ROOT, f), line: i + 1, ok: line.includes('restoreTokenBalance(') });
    });
  }
  check('every cached balance restore in src uses restoreTokenBalance (Sidebar, both forms)',
    restores.length >= 3 && restores.every((r) => r.ok), restores);
}

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
