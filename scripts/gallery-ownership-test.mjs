// scripts/gallery-ownership-test.mjs
//
// Offline tests for completion-time ownership in the Gallery
// (src/lib/galleryOwnership.ts, Second 118): Download and Send to Slicer wait
// for an animation's clean copy, and act only if they still belong to the
// Gallery's visit and, for the Slicer, are still the newest choice. Run from
// the repo root: `node scripts/gallery-ownership-test.mjs`.
//
// Each case is ordered: a click captures its token and waits for its clean
// copy, something newer may happen, then the copy is ready. The download and
// sendToSlicer helpers call the module's whenCurrent exactly as
// handleDownload and handleSendToSlicer in src/app/gallery/page.tsx do, so
// the click, the wait and the check before acting are the real code; only
// what the page does when it acts (save a file, hand over and navigate) is
// recorded here instead. Section 2 reads the page's source and checks its
// wiring: both handlers go through whenCurrent with nothing awaited around
// it, every handoff write and navigation sits inside it, and the visit ends
// only in a layout cleanup keyed to the account. Section 3 runs the real page
// on a stand-in React whose commit, layout and passive phases each case runs
// in its own order (Second 119): an account change or an unmount committed,
// then a waiting clean copy finishing, then the passive effects. The harness
// writes only its esbuild bundles and stand-ins, to
// local/.gallery-ownership-test (gitignored), and prints only case names and
// pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.gallery-ownership-test', 'galleryOwnership.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/galleryOwnership.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: OUT, logLevel: 'error',
});
const { createGalleryOwnership } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One Gallery visit's world: what the Slicer was handed, where the router
// went, which files were saved, and each entry's clean copy, held until the
// case says it is ready (no URL, here null, once its entry is deleted).
function gallery() {
  const ownership = createGalleryOwnership();
  const world = { slicer: null, pushes: [], saved: [] };
  const held = {};
  const cleanedUrl = (jobId) => {
    if (!held[jobId]) {
      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      held[jobId] = { promise, resolve };
    }
    return held[jobId].promise;
  };
  const ready = async (jobId, url = `blob:clean-${jobId}`) => { cleanedUrl(jobId); held[jobId].resolve(url); await new Promise((r) => setTimeout(r, 0)); };
  // As handleDownload and handleSendToSlicer (animations).
  const download = (jobId) => ownership.whenCurrent('download', () => cleanedUrl(jobId), (url) => {
    world.saved.push(url);
  });
  const sendToSlicer = (jobId) => ownership.whenCurrent('slicer', () => cleanedUrl(jobId), (url) => {
    world.slicer = { url, jobId };
    world.pushes.push('/upload');
  });
  return { ownership, world, ready, download, sendToSlicer };
}

// 1. The decisions, in order.

// 1a. The ordinary handoff.
{
  const g = gallery();
  const done = g.sendToSlicer('A');
  await g.ready('A');
  await done;
  check('an ordinary Send to Slicer hands the clean copy over and opens the Slicer once',
    same(g.world.slicer, { url: 'blob:clean-A', jobId: 'A' }) && same(g.world.pushes, ['/upload']), g.world);
}

// 1b. Second 118: A is held, B is ready and wins; then A's copy is ready.
{
  const g = gallery();
  const a = g.sendToSlicer('A');
  await g.ready('B');
  await g.sendToSlicer('B');
  await g.ready('A');
  await a;
  check('A held, then B: B is handed over; A, ready later, changes nothing and opens nothing',
    same(g.world.slicer, { url: 'blob:clean-B', jobId: 'B' }) && same(g.world.pushes, ['/upload']), g.world);
}

// 1c. Leaving the Gallery for another page while A waits.
{
  const g = gallery();
  const a = g.sendToSlicer('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  check('leaving the Gallery while A waits: A hands nothing over and opens nothing',
    g.world.slicer === null && g.world.pushes.length === 0, g.world);
}

// 1d. The account changes on the page while A waits (the Gallery's fetch
// effect ends the visit as it starts the new account's).
{
  const g = gallery();
  const a = g.sendToSlicer('A');
  const d = g.download('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  await d;
  check('an account change while A waits: no handoff, no navigation, no file',
    g.world.slicer === null && g.world.pushes.length === 0 && g.world.saved.length === 0, g.world);
}

// 1e. Downloads do not replace each other or a Slicer choice.
{
  const g = gallery();
  const a = g.download('A');
  await g.ready('B');
  await g.download('B');
  const s = g.sendToSlicer('B');
  await g.ready('A');
  await a;
  await s;
  check('two Downloads, A held: both files are saved; a Slicer click meanwhile does not cancel A',
    same(g.world.saved, ['blob:clean-B', 'blob:clean-A']) && same(g.world.slicer, { url: 'blob:clean-B', jobId: 'B' }), g.world);
}

// 1f. A Download held while the Gallery is left.
{
  const g = gallery();
  const a = g.download('A');
  g.ownership.endVisit();
  await g.ready('A');
  await a;
  check('leaving the Gallery while a Download waits: no file is saved', g.world.saved.length === 0, g.world);
}

// 1g. A click in a later visit acts.
{
  const g = gallery();
  g.ownership.endVisit();
  const s = g.sendToSlicer('A');
  await g.ready('A');
  await s;
  check('a click after the visit changed belongs to the new visit and acts', same(g.world.pushes, ['/upload']), g.world);
}

// 1h. The entry is deleted while its copy is cleaned: nothing to hand over.
{
  const g = gallery();
  const s = g.sendToSlicer('A');
  const d = g.download('A');
  await g.ready('A', null);
  await s;
  await d;
  check('deleted while waiting: no handoff and no file', g.world.slicer === null && g.world.saved.length === 0 && g.world.pushes.length === 0, g.world);
}

// 1i. A sheet with nothing to clean (a Create entry's URL, given at once):
// whenCurrent still checks before acting, and says whether it acted.
{
  const g = gallery();
  const acted = await g.ownership.whenCurrent('slicer', () => 'blob:create-C', (url) => { g.world.slicer = { url, jobId: 'C' }; });
  const none = await g.ownership.whenCurrent('download', () => undefined, () => { g.world.saved.push('none'); });
  check('a URL given at once acts and resolves true; no URL acts on nothing and resolves false',
    acted === true && none === false && same(g.world.slicer, { url: 'blob:create-C', jobId: 'C' }) && g.world.saved.length === 0, g.world);
}

// 2. The page's wiring (src/app/gallery/page.tsx, read as text). Text is
// compared with each line trimmed and the lines joined by one space.
{
  const src = fs.readFileSync(path.join(ROOT, 'src/app/gallery/page.tsx'), 'utf8');
  const NL = String.fromCharCode(10);
  const flat = (text) => text.split(NL).map((l) => l.trim()).filter(Boolean).join(' ');
  const count = (text, needle) => text.split(needle).length - 1;
  // A handler's text: from its declaration to the end of its useCallback.
  const handler = (name) => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    if (start < 0) return '';
    const end = src.indexOf(']);', start);
    return end < 0 ? '' : flat(src.slice(start, end + 3));
  };
  const dl = handler('handleDownload');
  const sl = handler('handleSendToSlicer');
  // The act passed to whenCurrent: from its arrow to the brace that closes
  // it, which must also close the whenCurrent call and then the handler, so
  // nothing (an await, a then, a later write) runs after the check outside
  // it.
  const actOf = (text, name, action) => {
    if (!text.startsWith(`const ${name} = useCallback((entry: GalleryEntryV1) => ownership.whenCurrent( '${action}', `)) return '';
    const arrow = text.indexOf('(url) => {');
    const close = text.indexOf('}, ), [');
    if (arrow < 0 || close < arrow || close !== text.lastIndexOf('}, ), [') || text.indexOf(']);') !== text.length - 3) return '';
    return text.slice(arrow, close);
  };
  const dlAct = actOf(dl, 'handleDownload', 'download');
  const slAct = actOf(sl, 'handleSendToSlicer', 'slicer');
  check('both handlers are one whenCurrent call each, with nothing awaited or run after it',
    dlAct !== '' && slAct !== '' && ![dl, sl].some((t) => t.includes('await') || t.includes('.then(')),
    { download: dl.slice(0, 160), slicer: sl.slice(0, 160) });
  const writes = ['setGeneratedImage(', 'setGenerationStyle(', 'setCurrentSheetMetadata(', 'router.push('];
  check("every handoff write and navigation on the page is inside Send to Slicer's act, and the Download's click inside its own",
    writes.every((w) => count(src, w) >= 1 && count(slAct, w) === count(src, w)) && count(dlAct, 'a.click()') === 1,
    writes.map((w) => [w, count(src, w), count(slAct, w)]));
  // The visit ends in one place: a layout cleanup keyed to the account, which
  // React runs in the commit that unmounts the page or changes its account
  // (Second 119). A second, passive end could later end a newer visit.
  check('the visit ends only in a layout cleanup keyed to the account (userId) and the ownership',
    count(src, 'ownership.endVisit()') === 1
      && count(src, 'useLayoutEffect(() => () => ownership.endVisit(), [userId, ownership]);') === 1,
    flat(src.slice(Math.max(0, src.indexOf('ownership.endVisit()') - 120), src.indexOf('ownership.endVisit()') + 60)));
}

// 3. The real page (src/app/gallery/page.tsx), with React's phases made
// explicit (Second 119). The page is bundled with esbuild into
// local/.gallery-ownership-test/ with react, its JSX runtime, @clerk/react,
// next/navigation and next/link swapped for stand-ins written there too, and
// its cleanGallerySheet for one that finishes only when the case says. The
// stand-in React keeps layout and passive effects in separate queues, as
// React does, and runs nothing by itself while a case holds it. A case can
// then commit a change (render, then the layout effects and cleanups), let a
// waiting clean copy finish, and only then run the passive effects: the
// order React allows when passive effects run after paint. fetch, Blob
// URLs, localStorage, confirm and the download link are scripted. This
// models React rather than running it.
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
{
  const DIR = path.join(ROOT, 'local', '.gallery-ownership-test');
  fs.mkdirSync(DIR, { recursive: true });
  const lines = (...l) => l.join(String.fromCharCode(10)) + String.fromCharCode(10);
  const files = {
    'fake-react.mjs': FAKE_REACT,
    'jsx-runtime.mjs': lines('export function jsx(type, props) { return { type, props }; }', 'export const jsxs = jsx;', "export const Fragment = 'Fragment';"),
    'clerk-stub.mjs': lines("export function useAuth() { const u = globalThis.__galleryUser; return { userId: u, getToken: async () => (u ? 'tok-' + u : null) }; }"),
    'next-navigation-stub.mjs': lines('export function useRouter() { return globalThis.__galleryRouter; }'),
    'next-link-stub.mjs': lines('export default function Link() { return null; }'),
    'clean-stub.mjs': lines('export function cleanGallerySheet(blob) { return globalThis.__galleryClean(blob); }'),
    'page-entry.mjs': lines(
      `export { default as GalleryPage } from ${JSON.stringify(path.join(ROOT, 'src/app/gallery/page.tsx'))};`,
      `export { useSpriteStore } from ${JSON.stringify(path.join(ROOT, 'src/stores/spriteStore.ts'))};`,
      `export { mount } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};`,
    ),
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(DIR, name), text);
  const stubs = {
    react: path.join(DIR, 'fake-react.mjs'),
    'react/jsx-runtime': path.join(DIR, 'jsx-runtime.mjs'),
    'react/jsx-dev-runtime': path.join(DIR, 'jsx-runtime.mjs'),
    '@clerk/react': path.join(DIR, 'clerk-stub.mjs'),
    'next/navigation': path.join(DIR, 'next-navigation-stub.mjs'),
    'next/link': path.join(DIR, 'next-link-stub.mjs'),
  };

  // The world the page runs in, reset by each case.
  let world;
  const blobJob = new WeakMap();
  const realCreate = URL.createObjectURL.bind(URL);
  const realRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => realCreate(blob);
  URL.revokeObjectURL = (url) => { if (world) world.revoked.add(url); realRevoke(url); };
  const storage = new Map();
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => { storage.set(k, String(v)); }, removeItem: (k) => { storage.delete(k); }, key: () => null, length: 0 },
    configurable: true, writable: true,
  });
  globalThis.confirm = () => true;
  globalThis.document = {
    createElement: () => ({ click() { world.saved.push(this.download); } }),
    body: { appendChild() {}, removeChild() {} },
  };
  globalThis.__galleryRouter = { push: (url) => world.pushes.push(url), replace() {}, back() {}, prefetch() {} };
  // Each account's list: two animations (A and B) and one Create sheet (C).
  const entriesFor = (user) => [
    { jobId: `${user}-A`, prompt: 'A', style: 'any_animation_walking', mode: 'animate', action: 'walking', createdAt: 3, v: 1 },
    { jobId: `${user}-B`, prompt: 'B', style: 'any_animation_attack', mode: 'animate', action: 'attack', createdAt: 2, v: 1 },
    { jobId: `${user}-C`, prompt: 'C', style: 'rd_fast__default', mode: 'create', createdAt: 1, v: 1 },
  ];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const user = String((init.headers && init.headers.Authorization) || '').replace('Bearer tok-', '');
    if (init.method === 'DELETE') return { ok: true, status: 200, json: async () => ({}) };
    if (u.startsWith('/api/gallery?')) return { ok: true, status: 200, json: async () => ({ entries: entriesFor(user) }) };
    if (u.startsWith('/api/gallery/image/')) {
      const jobId = u.slice('/api/gallery/image/'.length);
      const blob = new Blob([`stored ${jobId}`], { type: 'image/png' });
      blobJob.set(blob, jobId);
      return { ok: true, status: 200, blob: async () => blob };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  // Each clean copy waits until the case finishes it.
  globalThis.__galleryClean = (blob) => new Promise((resolve) => {
    world.cleaning[blobJob.get(blob)] = () => resolve(new Blob([`clean ${blobJob.get(blob)}`], { type: 'image/png' }));
  });

  const OUT = path.join(DIR, 'page-bundle.mjs');
  await build({
    entryPoints: [path.join(DIR, 'page-entry.mjs')],
    bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
    tsconfig: path.join(ROOT, 'tsconfig.json'), jsx: 'automatic',
    plugins: [{
      name: 'stand-ins',
      setup(b) {
        b.onResolve({ filter: /^(react|@clerk|next)/ }, (args) => (stubs[args.path] ? { path: stubs[args.path] } : undefined));
        b.onResolve({ filter: /spriteUtils$/ }, (args) => (args.importer.endsWith(path.join('app', 'gallery', 'page.tsx')) ? { path: path.join(DIR, 'clean-stub.mjs') } : undefined));
      },
    }],
  });
  const { GalleryPage, useSpriteStore, mount } = await import(pathToFileURL(OUT).href);

  const tick = () => new Promise((r) => setTimeout(r, 0));
  const drain = async () => { for (let i = 0; i < 20; i++) await tick(); };
  const textOf = (node) => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    return node.props ? textOf(node.props.children) : '';
  };
  // Every element in the rendered tree whose props pass the test.
  const find = (root, test) => {
    const out = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.props) { if (test(n.props)) out.push(n.props); walk(n.props.children); }
    };
    walk(root);
    return out;
  };
  const card = (page, jobId) => find(page.value, (p) => p.entry && p.entry.jobId === jobId && p.onSendToSlicer)[0];
  const until = async (cond, what) => {
    for (let i = 0; i < 200; i++) { if (cond()) return; await tick(); }
    throw new Error(`the stand-in page never showed ${what}`);
  };
  const handedOver = () => {
    const s = useSpriteStore.getState();
    return s.generatedImageDataUrl ? { url: s.generatedImageDataUrl, style: s.generationStyle } : null;
  };
  // A fresh store and world, the Gallery open for an account, its three
  // cards shown and the two animations' clean copies started and waiting.
  const open = async (user) => {
    world = { pushes: [], saved: [], revoked: new Set(), cleaning: {} };
    useSpriteStore.setState({ generatedImageUrl: null, generatedImageDataUrl: null, generationStyle: null, currentSheetMetadata: null });
    globalThis.__galleryUser = user;
    const page = mount(GalleryPage);
    await until(() => ['A', 'B', 'C'].every((k) => card(page, `${user}-${k}`)) && world.cleaning[`${user}-A`] && world.cleaning[`${user}-B`], `${user}'s cards with their clean copies started`);
    return page;
  };
  // The account changes and React commits it (render, then layout), but its
  // passive effects wait.
  const commitAccount = (page, user) => {
    page.hold = true;
    globalThis.__galleryUser = user;
    page.render();
    page.commitLayout();
  };
  const passiveThenRelease = async (page) => {
    page.commitPassive();
    page.hold = false;
    if (page.dirty) page.update();
    await drain();
  };
  const nothing = () => handedOver() === null && world.pushes.length === 0 && world.saved.length === 0;
  const pageCase = async (name, run) => {
    try { await run(); } catch (err) { check(name, false, String(err)); }
  };

  await pageCase('page: an ordinary Send to Slicer hands the clean copy over once', async () => {
    const page = await open('user_a');
    card(page, 'user_a-A').onSendToSlicer();
    world.cleaning['user_a-A']();
    await drain();
    const h = handedOver();
    check('page: an ordinary Send to Slicer hands the clean copy over once',
      !!h && h.style === 'any_animation_walking' && h.url.startsWith('blob:') && world.pushes.length === 1, { h, pushes: world.pushes });
    page.unmountLayout(); page.unmountPassive();
  });

  await pageCase("page: Second 119's order", async () => {
    const page = await open('user_a');
    card(page, 'user_a-A').onSendToSlicer();
    card(page, 'user_a-B').onDownload();
    commitAccount(page, 'user_b');
    world.cleaning['user_a-A']();
    world.cleaning['user_a-B']();
    await drain();
    const between = nothing();
    await passiveThenRelease(page);
    check("page, Second 119's order: account B committed, then A's and B's clean copies finish, then the passive effects run: no handoff, navigation or file",
      between && nothing(), { handedOver: handedOver(), pushes: world.pushes, saved: world.saved });
    page.unmountLayout(); page.unmountPassive();
  });

  await pageCase('page: leaving', async () => {
    const page = await open('user_a');
    card(page, 'user_a-A').onSendToSlicer();
    card(page, 'user_a-B').onDownload();
    page.unmountLayout();
    world.cleaning['user_a-A']();
    world.cleaning['user_a-B']();
    await drain();
    const between = nothing();
    page.unmountPassive();
    await drain();
    check('page, leaving: the unmount committed, then the clean copies finish, then the passive cleanups run: no handoff, navigation or file',
      between && nothing(), { handedOver: handedOver(), pushes: world.pushes, saved: world.saved });
  });

  await pageCase('page: passive before completion', async () => {
    const page = await open('user_a');
    card(page, 'user_a-A').onSendToSlicer();
    commitAccount(page, 'user_b');
    page.commitPassive();
    world.cleaning['user_a-A']();
    page.hold = false;
    await drain();
    check('page, control: account B fully committed before A finishes: no handoff or navigation', nothing(), { handedOver: handedOver(), pushes: world.pushes });
    page.unmountLayout(); page.unmountPassive();
  });

  await pageCase('page: later visit', async () => {
    const page = await open('user_a');
    commitAccount(page, 'user_b');
    await passiveThenRelease(page);
    await until(() => card(page, 'user_b-A') && world.cleaning['user_b-A'], "user_b's cards");
    card(page, 'user_b-A').onSendToSlicer();
    world.cleaning['user_b-A']();
    await drain();
    const h = handedOver();
    check("page, a later visit: after the switch, a Send to Slicer on account B's sheet acts once",
      !!h && h.style === 'any_animation_walking' && world.pushes.length === 1, { h, pushes: world.pushes });
    page.unmountLayout(); page.unmountPassive();
  });

  await pageCase('page: StrictMode', async () => {
    const page = await open('user_a');
    page.strictReplay();
    await drain();
    card(page, 'user_a-B').onSendToSlicer();
    Object.values(world.cleaning).forEach((finish) => finish());
    await drain();
    const h = handedOver();
    check("page, StrictMode's replay after mounting: a Send to Slicer still acts once",
      !!h && h.style === 'any_animation_attack' && world.pushes.length === 1, { h, pushes: world.pushes });
    page.unmountLayout(); page.unmountPassive();
  });

  await pageCase('page: Create over Animate', async () => {
    const page = await open('user_a');
    card(page, 'user_a-A').onSendToSlicer();
    card(page, 'user_a-C').onSendToSlicer();
    await drain();
    world.cleaning['user_a-A']();
    await drain();
    const h = handedOver();
    check('page: a Create sheet sent while A waits is handed over; A, ready later, changes nothing',
      !!h && h.style === 'rd_fast__default' && world.pushes.length === 1, { h, pushes: world.pushes });
    page.unmountLayout(); page.unmountPassive();
  });

  await pageCase('page: delete and clear', async () => {
    const page = await open('user_a');
    card(page, 'user_a-A').onSendToSlicer();
    card(page, 'user_a-A').onDelete();
    world.cleaning['user_a-A']();
    await drain();
    const afterDelete = nothing();
    page.unmountLayout(); page.unmountPassive();
    const page2 = await open('user_a');
    card(page2, 'user_a-B').onSendToSlicer();
    const clear = find(page2.value, (p) => typeof p.onClick === 'function' && textOf(p.children).includes('Clear all'))[0];
    if (clear) clear.onClick();
    world.cleaning['user_a-B']();
    await drain();
    check('page: Delete, or Clear all, while a Send to Slicer waits: no handoff or navigation',
      afterDelete && !!clear && nothing(), { clear: !!clear, handedOver: handedOver(), pushes: world.pushes });
    page2.unmountLayout(); page2.unmountPassive();
  });

  await pageCase('page: URL survival', async () => {
    const page = await open('user_a');
    card(page, 'user_a-A').onSendToSlicer();
    world.cleaning['user_a-A']();
    await drain();
    const h = handedOver();
    page.unmountLayout(); page.unmountPassive();
    await drain();
    check('page: after a valid handoff, leaving the Gallery keeps the handed URL alive',
      !!h && !world.revoked.has(h.url) && world.pushes.length === 1, { h, revoked: [...world.revoked].length });
  });
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('all pass');
