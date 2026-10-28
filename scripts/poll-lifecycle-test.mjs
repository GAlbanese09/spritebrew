// scripts/poll-lifecycle-test.mjs
//
// Offline lifecycle tests for the generation poll hook
// (src/hooks/useGenerationPoll.ts). Run from the repo root:
// `node scripts/poll-lifecycle-test.mjs`. Prints only case names and pass or
// fail.
//
// The hook is bundled with esbuild into local/.poll-lifecycle-test/
// (gitignored), with react and @clerk/react swapped for small stand-ins
// written there too: a fake React for one hook per mount (state, refs,
// callbacks, effects, unmount; state updates re-render in a microtask) and a
// useAuth whose getToken and signed-in user each case scripts (no user, as
// before Clerk loads, unless a case sets one). fetch and localStorage are
// scripted the same way. This models React rather than running it; the same
// sequences were also run in Chromium against the real page.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.poll-lifecycle-test');
fs.mkdirSync(DIR, { recursive: true });

const FAKE_REACT = `
let current = null;
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
export function useState(init) {
  const c = current; const i = c.i++;
  if (!(i in c.slots)) c.slots[i] = { v: typeof init === 'function' ? init() : init };
  const slot = c.slots[i];
  if (!slot.set) {
    slot.set = (next) => {
      if (c.unmounted) { c.lateSets++; return; }
      slot.v = typeof next === 'function' ? next(slot.v) : next;
      // An update during the hook's own render: React renders it again at
      // once, before anything commits (see mount).
      if (current === c) { c.renderAgain = true; return; }
      if (!c.scheduled) {
        c.scheduled = true;
        queueMicrotask(() => { c.scheduled = false; if (!c.unmounted) c.update(); });
      }
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
export function mount(hook, opts = {}) {
  const c = { slots: {}, layout: [], passive: [], unmounted: false, scheduled: false, renderAgain: false, lateSets: 0, value: undefined, i: 0 };
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
      try { c.value = hook(); } finally { current = null; }
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
    Object.values(c.slots).forEach((s) => { if (s && s.effect && s.cleanup) s.cleanup(); });
  };
  c.render();
  if (!opts.defer) { c.commitLayout(); c.commitPassive(); }
  return c;
}
`;
const CLERK_STUB = 'export function useAuth() { return { getToken: globalThis.__getToken, userId: globalThis.__userId }; }';
const TAB_HOOK = path.join(ROOT, 'src/hooks/useGenerateTab.ts');
const ENTRY = `
export * from ${JSON.stringify(path.join(ROOT, 'src/hooks/useGenerationPoll.ts'))};
${fs.existsSync(TAB_HOOK) ? `export * from ${JSON.stringify(TAB_HOOK)};` : ''}
export { mount, useState as fakeUseState, useLayoutEffect as fakeUseLayoutEffect } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};
`;
fs.writeFileSync(path.join(DIR, 'fake-react.mjs'), FAKE_REACT);
fs.writeFileSync(path.join(DIR, 'clerk-stub.mjs'), CLERK_STUB);
fs.writeFileSync(path.join(DIR, 'entry.mjs'), ENTRY);

// localStorage and window, before the hook module loads.
const store = new Map();
// The saved job's value may be refused above jobLimit characters, a stand-in
// for nearly full storage (Second 094).
let jobLimit = Infinity;
const fakeStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (k === 'spritebrew:activeJob' && String(v).length > jobLimit) throw new Error('QuotaExceededError');
    store.set(k, String(v));
  },
  removeItem: (k) => { store.delete(k); },
};
Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true });
globalThis.window = globalThis;

// Scripted getToken and fetch: each call takes the next behaviour queued by
// the case; with none queued, getToken resolves a token and fetch hangs.
const tokenQueue = [];
const fetchQueue = [];
let fetchCalls = [];
globalThis.__getToken = () => (tokenQueue.length ? tokenQueue.shift()() : Promise.resolve('tok'));
globalThis.fetch = (url, init) => {
  fetchCalls.push(String(url));
  return (fetchQueue.length ? fetchQueue.shift() : pending)(init);
};

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
function onAbort(signal, reject) {
  if (signal?.aborted) reject(abortError());
  else signal?.addEventListener('abort', () => reject(abortError()), { once: true });
}
// A request that never answers; it rejects when its signal aborts, as fetch does.
function pending(init) {
  return new Promise((_, reject) => onAbort(init?.signal, reject));
}
// Headers arrive, then the body never finishes; reading it rejects on abort,
// as a real response body does.
function hangingBody(init) {
  return Promise.resolve({
    status: 200, ok: true,
    json: () => new Promise((_, reject) => onAbort(init?.signal, reject)),
    text: async () => '',
  });
}
function answer(body) {
  return () => Promise.resolve({ status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) });
}
function notJson() {
  return Promise.resolve({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected token'); }, text: async () => '<html>' });
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const OUT = path.join(DIR, 'bundle.mjs');
await build({
  entryPoints: [path.join(DIR, 'entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  alias: { react: path.join(DIR, 'fake-react.mjs'), '@clerk/react': path.join(DIR, 'clerk-stub.mjs') },
});
const mod = await import(pathToFileURL(OUT).href);
const { useGenerationPoll, onBeforeResume, useGenerateTab, mount, fakeUseState, fakeUseLayoutEffect } = mod;

const KEY = 'spritebrew:activeJob';
const saved = () => { const raw = store.get(KEY); return raw ? JSON.parse(raw).jobId : null; };
const settle = () => new Promise((r) => setTimeout(r, 10));
const SUCCESS = { status: 'success', resultBase64: 'AAAA', completedAt: 1 };

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
function fresh() {
  store.clear(); tokenQueue.length = 0; fetchQueue.length = 0; fetchCalls = []; jobLimit = Infinity;
  globalThis.__userId = undefined;
}

// The stand-in itself: an update during render renders again before
// anything commits, and only the last pass's effects run.
{
  const runs = [];
  const h = mount(() => {
    const [n, setN] = fakeUseState(0);
    if (n < 2) setN(n + 1);
    fakeUseLayoutEffect(() => { runs.push(n); }, [n]);
    return n;
  });
  check("stand-in: an update during render renders again first, and only the last pass's effect runs",
    h.value === 2 && JSON.stringify(runs) === '[2]', { value: h.value, runs });
  h.unmount();
}

// 1. Leave while the body of a status response is being read, then come back
// twice. The stopped loop's abort surfaces as pollClient's non-JSON error; it
// must leave the saved job to the form that resumed it (Second 073 P2-A).
{
  fresh();
  fetchQueue.push(hangingBody);
  const a = mount(useGenerationPoll);
  a.value.startPolling('job-1', 'key-1', 'create');
  await settle();
  a.unmount();
  const b = mount(useGenerationPoll); // the next mount resumes it; its request hangs
  await settle();
  check('body abort: the stopped loop leaves the saved job to the form that resumed it',
    saved() === 'job-1' && b.value.status === 'polling', { saved: saved(), b: b.value.status });
  check('body abort: the stopped loop makes no state update', a.lateSets === 0, { lateSets: a.lateSets });
  b.unmount(); // a second leave
  await settle();
  check('body abort: after a second leave the job is still saved', saved() === 'job-1', { saved: saved() });
  fetchQueue.push(answer(SUCCESS));
  const c = mount(useGenerationPoll);
  await settle();
  check('body abort: the second return shows the result and clears the saved job',
    c.value.status === 'success' && saved() === null, { c: c.value.status, saved: saved() });
  c.unmount();
}

// 2. Leave while the session token is still on its way; it then resolves
// empty, which pollClient reports as an auth error.
{
  fresh();
  const late = deferred();
  tokenQueue.push(() => late.promise);
  const a = mount(useGenerationPoll);
  a.value.startPolling('job-2', 'key-2', 'animate');
  await settle();
  a.unmount();
  const b = mount(useGenerationPoll);
  await settle();
  late.resolve(null);
  await settle();
  check('late token: the stopped loop leaves the saved job and the resumed poll alone',
    saved() === 'job-2' && b.value.status === 'polling' && a.lateSets === 0,
    { saved: saved(), b: b.value.status, lateSets: a.lateSets });
  b.unmount();
}

// 3. Controls: the live loop still ends a job on a real error.
{
  fresh();
  fetchQueue.push(notJson);
  const a = mount(useGenerationPoll);
  a.value.startPolling('job-3', 'key-3', 'create');
  await settle();
  check('control: a non-JSON answer on the live loop is an error and clears the saved job',
    a.value.status === 'error' && a.value.error?.message === 'Polling endpoint returned non-JSON body.' && saved() === null,
    { status: a.value.status, error: a.value.error, saved: saved() });
  a.unmount();
}
{
  fresh();
  tokenQueue.push(() => Promise.resolve(null));
  const a = mount(useGenerationPoll);
  a.value.startPolling('job-4', 'key-4', 'create');
  await settle();
  check('control: no session token on the live loop is an auth error and clears the saved job',
    a.value.status === 'error' && /Session expired/.test(a.value.error?.message ?? '') && saved() === null,
    { status: a.value.status, error: a.value.error, saved: saved() });
  a.unmount();
}

// 4. Which form finishes a saved job (Second 073 P2-B and 090). Before any
// hook resumes a saved job, it asks the checks registered with
// onBeforeResume. The page here is the real useGenerateTab. A form is a mount
// of the hook, and only the form for the page's tab is mounted, as on
// /generate. A job "lands late" when the form that sent its Generate request
// has unmounted (the user left) before the 202 arrives.
const RESCUED = { status: 'success', resultBase64: 'AAAA', completedAt: 1, rescued: true, deliveredCellSize: 64, deliveredFrames: 4 };
function sendFromAFormThatLeft() {
  const sender = mount(useGenerationPoll);
  const send = sender.value.startPolling;
  sender.unmount();
  return send;
}

check('onBeforeResume is exported', typeof onBeforeResume === 'function');
if (typeof onBeforeResume === 'function') {
  fresh();
  const asked = [];
  const off = onBeforeResume((mode) => { asked.push(mode); return true; });
  const send = sendFromAFormThatLeft();
  const form = mount(useGenerationPoll);
  send('job-5', 'key-5', 'animate');
  await settle();
  check('a check that takes the job leaves the asking form idle, with no request and the job saved',
    asked.join() === 'animate' && form.value.status === 'idle' && fetchCalls.length === 0 && saved() === 'job-5',
    { asked, form: form.value.status, fetchCalls: fetchCalls.length, saved: saved() });
  form.unmount();
  off();

  fresh();
  const offNo = onBeforeResume(() => false);
  const send2 = sendFromAFormThatLeft();
  const form2 = mount(useGenerationPoll);
  send2('job-6', 'key-6', 'create');
  await settle();
  check('a check that declines lets the form on screen resume the job', form2.value.status === 'polling' && saved() === 'job-6',
    { form: form2.value.status, saved: saved() });
  form2.unmount();
  offNo();

  fresh();
  let calls = 0;
  const offGone = onBeforeResume(() => { calls++; return true; });
  offGone();
  const send3 = sendFromAFormThatLeft();
  const form3 = mount(useGenerationPoll);
  send3('job-7', 'key-7', 'create');
  await settle();
  check('an unregistered check is not asked', calls === 0 && form3.value.status === 'polling', { calls, form: form3.value.status });
  form3.unmount();
}

check('useGenerateTab is exported', typeof useGenerateTab === 'function');
if (typeof useGenerateTab === 'function') {
  // The Animate form finishes what the page hands it; a rescued result keeps
  // its rescue fields for the form's notice.
  async function animateFormFinishes(page, jobId) {
    fetchQueue.push(answer(RESCUED));
    const animateForm = mount(useGenerationPoll);
    await settle();
    const ok = page.value.tab === 'animate' && animateForm.value.status === 'success' && animateForm.value.result?.rescued === true && saved() === null;
    const detail = { tab: page.value.tab, status: animateForm.value.status, rescued: animateForm.value.result?.rescued, saved: saved(), jobId };
    animateForm.unmount();
    page.unmount();
    return [ok, detail];
  }

  // a. Second 090: the 202 lands after the page's first render chose a tab,
  // before the page commits and registers its check.
  fresh();
  let send = sendFromAFormThatLeft();
  let page = mount(useGenerateTab, { defer: true });
  const chosen = page.value.tab;
  send('job-8', 'key-8', 'animate');
  page.commitLayout();
  page.commitPassive();
  let createForm = mount(useGenerationPoll);
  await settle();
  check(`Animate job landing between the page's render and its commit: the page opens Animate, and the Create form makes no request`,
    chosen === 'create' && page.value.tab === 'animate' && createForm.value.status === 'idle' && fetchCalls.length === 0 && saved() === 'job-8',
    { chosen, tab: page.value.tab, create: createForm.value.status, fetchCalls: fetchCalls.length });
  createForm.unmount();
  let [ok, detail] = await animateFormFinishes(page, 'job-8');
  check('... and the Animate form finishes it, rescue fields kept', ok, detail);

  // b. It lands after the page committed, before the Create form's mount
  // effect runs.
  fresh();
  send = sendFromAFormThatLeft();
  page = mount(useGenerateTab);
  createForm = mount(useGenerationPoll, { defer: true });
  send('job-9', 'key-9', 'animate');
  createForm.commitLayout();
  createForm.commitPassive();
  await settle();
  check(`Animate job landing between the page's commit and the Create form's mount effect: the page opens Animate, and the Create form makes no request`,
    page.value.tab === 'animate' && createForm.value.status === 'idle' && fetchCalls.length === 0,
    { tab: page.value.tab, create: createForm.value.status, fetchCalls: fetchCalls.length });
  createForm.unmount();
  [ok, detail] = await animateFormFinishes(page, 'job-9');
  check('... and the Animate form finishes it', ok, detail);

  // c. Control: it lands before the page renders; the page opens on Animate.
  fresh();
  send = sendFromAFormThatLeft();
  send('job-10', 'key-10', 'animate');
  page = mount(useGenerateTab);
  check('control: Animate job saved before the page renders: the page opens on Animate', page.value.tab === 'animate', { tab: page.value.tab });
  [ok, detail] = await animateFormFinishes(page, 'job-10');
  check('... and the Animate form finishes it', ok, detail);

  // d. Control: it lands after the page and the Create form are both set up.
  fresh();
  send = sendFromAFormThatLeft();
  page = mount(useGenerateTab);
  createForm = mount(useGenerationPoll);
  send('job-11', 'key-11', 'animate');
  await settle();
  check('control: Animate job landing after everything is set up: the page opens Animate, and the Create form makes no request',
    page.value.tab === 'animate' && createForm.value.status === 'idle' && fetchCalls.length === 0,
    { tab: page.value.tab, create: createForm.value.status, fetchCalls: fetchCalls.length });
  createForm.unmount();
  [ok, detail] = await animateFormFinishes(page, 'job-11');
  check('... and the Animate form finishes it', ok, detail);

  // e. Control: a tab the user picked is kept (the known limitation: the
  // Create form finishes the Animate job).
  fresh();
  send = sendFromAFormThatLeft();
  page = mount(useGenerateTab);
  page.value.pickTab('create');
  await settle();
  createForm = mount(useGenerationPoll);
  send('job-12', 'key-12', 'animate');
  await settle();
  check('control: after the user picks a tab, the page keeps it and the form on screen resumes the job',
    page.value.tab === 'create' && createForm.value.status === 'polling', { tab: page.value.tab, create: createForm.value.status });
  createForm.unmount();
  page.unmount();

  // f. Control: a Create job landing on the Create tab: no switch.
  fresh();
  send = sendFromAFormThatLeft();
  page = mount(useGenerateTab);
  createForm = mount(useGenerationPoll);
  fetchQueue.push(answer(SUCCESS));
  send('job-13', 'key-13', 'create');
  await settle();
  check('control: a Create job on the Create tab stays there, and the Create form finishes it',
    page.value.tab === 'create' && createForm.value.status === 'success' && saved() === null,
    { tab: page.value.tab, create: createForm.value.status, saved: saved() });
  createForm.unmount();
  page.unmount();
}

// 5. The click-time context travels with the saved job (history gap, HQ
// 2026-10-27-017): the poll that sent the job exposes it, a resumed poll
// reads it back, and a job saved without one, or with a malformed one,
// still resumes, without it.
{
  const CTX = { prompt: 'knight with sword', styleId: 'plus-classic' };
  fresh();
  const a = mount(useGenerationPoll);
  a.value.startPolling('job-14', 'key-14', 'create', CTX);
  await settle();
  const stored = JSON.parse(store.get(KEY)).context;
  check('context: saved with the job, and exposed by the poll that sent it',
    JSON.stringify(stored) === JSON.stringify(CTX) && JSON.stringify(a.value.context) === JSON.stringify(CTX),
    { stored, exposed: a.value.context });
  a.unmount();
  fetchQueue.push(answer(SUCCESS));
  const b = mount(useGenerationPoll);
  await settle();
  check('context: after a leave and a return, the resumed poll has it at success',
    b.value.status === 'success' && b.value.isResume === true && JSON.stringify(b.value.context) === JSON.stringify(CTX),
    { status: b.value.status, isResume: b.value.isResume, context: b.value.context });
  b.value.reset();
  await settle();
  check('context: reset clears it', b.value.context === null, { context: b.value.context });
  b.unmount();
}
{
  const ANIM = { action: 'attack', motionPrompt: '', bgColor: '#FF00FF', frameCount: 6, frameSize: 128 };
  fresh();
  const send = sendFromAFormThatLeft();
  const form = mount(useGenerationPoll);
  send('job-15', 'key-15', 'animate', ANIM);
  await settle();
  check('context: a job landing after its form left keeps it for the form on screen',
    form.value.status === 'polling' && JSON.stringify(form.value.context) === JSON.stringify(ANIM),
    { status: form.value.status, context: form.value.context });
  form.unmount();

  fresh();
  store.set(KEY, JSON.stringify({ jobId: 'job-16', idempotencyKey: 'key-16', mode: 'create', startedAt: Date.now() }));
  const old = mount(useGenerationPoll);
  await settle();
  check('context: a job saved without one (by the version before) resumes, with none',
    old.value.status === 'polling' && old.value.context === null, { status: old.value.status, context: old.value.context });
  old.unmount();

  fresh();
  const { frameSize: _dropped, ...noSize } = ANIM;
  void _dropped;
  store.set(KEY, JSON.stringify({ jobId: 'job-17', idempotencyKey: 'key-17', mode: 'animate', startedAt: Date.now(), context: noSize }));
  const bad = mount(useGenerationPoll);
  await settle();
  check('context: a malformed one is dropped, and the job still resumes',
    bad.value.status === 'polling' && bad.value.context === null, { status: bad.value.status, context: bad.value.context });
  bad.unmount();
}

// 6. Nearly full storage (Second 094): when the record with its context does
// not fit but the lean record does, the lean one is saved, so a later mount
// still resumes the job (without a Recent entry). The sending hook keeps the
// full context for its own finish.
{
  const LONG = { prompt: 'k'.repeat(300), styleId: 'plus-classic' };
  const now = Date.now();
  const leanFits = (id) => JSON.stringify({ jobId: id, idempotencyKey: id.replace('job', 'key'), mode: 'create', startedAt: now }).length + 20;

  fresh();
  jobLimit = leanFits('job-18');
  const a = mount(useGenerationPoll);
  a.value.startPolling('job-18', 'key-18', 'create', LONG);
  await settle();
  const stored = store.get(KEY) ? JSON.parse(store.get(KEY)) : null;
  check('nearly full: the lean record is saved, and the sending hook keeps the full context',
    stored !== null && stored.jobId === 'job-18' && stored.context === undefined && JSON.stringify(a.value.context) === JSON.stringify(LONG),
    { stored: stored && Object.keys(stored), context: a.value.context && a.value.context.styleId });
  a.unmount();
  fetchQueue.push(answer(SUCCESS));
  const b = mount(useGenerationPoll);
  await settle();
  check('nearly full: after a leave and a return the job resumes and finishes, without a context',
    b.value.status === 'success' && b.value.isResume === true && b.value.context === null && saved() === null,
    { status: b.value.status, context: b.value.context, saved: saved() });
  b.unmount();

  fresh();
  jobLimit = leanFits('job-19');
  const send = sendFromAFormThatLeft();
  const form = mount(useGenerationPoll);
  send('job-19', 'key-19', 'create', LONG);
  await settle();
  check('nearly full: a job landing after its form left is still picked up by the form on screen',
    form.value.status === 'polling' && saved() === 'job-19' && fetchCalls.length === 1,
    { status: form.value.status, saved: saved(), fetchCalls: fetchCalls.length });
  form.unmount();

  fresh();
  jobLimit = JSON.stringify({ jobId: 'job-20', idempotencyKey: 'key-20', mode: 'create', startedAt: now, context: LONG }).length + 20;
  const c = mount(useGenerationPoll);
  c.value.startPolling('job-20', 'key-20', 'create', LONG);
  await settle();
  const kept = store.get(KEY) ? JSON.parse(store.get(KEY)) : null;
  check('control: with room, the saved record keeps its context', kept !== null && kept.context !== undefined && kept.context.prompt === LONG.prompt,
    { kept: kept && Object.keys(kept) });
  c.unmount();
}

// 7. A saved job belongs to the account that sent it (George's ruling, Oct
// 27). A sign-out unmounts the forms (they sit in the page's signed-in Show),
// so another account meets the job when its own form mounts, or when the
// job's 202 lands late.
const ANIM_JOB = (id, userId) => JSON.stringify({ jobId: id, idempotencyKey: id.replace('job', 'key'), mode: 'animate', startedAt: Date.now(), ...(userId ? { userId } : {}) });
{
  fresh();
  globalThis.__userId = 'user_a';
  const a = mount(useGenerationPoll);
  a.value.startPolling('job-21', 'key-21', 'create', { prompt: 'knight with sword', styleId: 'plus-classic' });
  await settle();
  const owner = store.get(KEY) ? JSON.parse(store.get(KEY)).userId : null;
  check('account: the saved job carries the account that sent it', owner === 'user_a', { owner });
  a.unmount(); // A signs out mid-job
  globalThis.__userId = 'user_b';
  const sentBefore = fetchCalls.length;
  const b = mount(useGenerationPoll);
  await settle();
  check("account: another account's form drops it, with no request",
    b.value.status === 'idle' && saved() === null && fetchCalls.length === sentBefore,
    { status: b.value.status, saved: saved(), fetchCalls: fetchCalls.length - sentBefore });
  b.unmount();

  fresh();
  globalThis.__userId = 'user_a';
  const a2 = mount(useGenerationPoll);
  a2.value.startPolling('job-22', 'key-22', 'create');
  await settle();
  a2.unmount();
  fetchQueue.push(answer(SUCCESS));
  const back = mount(useGenerationPoll);
  await settle();
  check('account: the same account, back after a leave, resumes and finishes it',
    back.value.status === 'success' && back.value.isResume === true && saved() === null,
    { status: back.value.status, saved: saved() });
  back.unmount();

  fresh();
  globalThis.__userId = 'user_b';
  store.set(KEY, JSON.stringify({ jobId: 'job-23', idempotencyKey: 'key-23', mode: 'create', startedAt: Date.now() }));
  const old = mount(useGenerationPoll);
  await settle();
  check('account: a job saved without a user id (by the version before) still resumes',
    old.value.status === 'polling' && saved() === 'job-23', { status: old.value.status, saved: saved() });
  old.unmount();

  fresh();
  globalThis.__userId = 'user_a';
  const send = sendFromAFormThatLeft(); // A sends, then signs out before the 202
  globalThis.__userId = 'user_b';
  const bForm = mount(useGenerationPoll);
  send('job-24', 'key-24', 'create');
  await settle();
  check("account: A's 202 landing while B's form is mounted is dropped, with no request",
    bForm.value.status === 'idle' && saved() === null && fetchCalls.length === 0,
    { status: bForm.value.status, saved: saved(), fetchCalls: fetchCalls.length });
  bForm.unmount();

  // A form that stays mounted while the account changes saves its next job
  // under the account now signed in.
  fresh();
  globalThis.__userId = 'user_a';
  const stay = mount(useGenerationPoll);
  globalThis.__userId = 'user_b';
  stay.update();
  stay.value.startPolling('job-28', 'key-28', 'create');
  await settle();
  const next = store.get(KEY) ? JSON.parse(store.get(KEY)).userId : null;
  check('account: a form still mounted when the account changes saves its next job under the new account', next === 'user_b', { owner: next });
  stay.unmount();

  // A dropped job is reported to onDrop, so the form ends the Brewing state
  // that the form which sent it left on; a resumed job, or nothing saved, is
  // not reported. The hook calls the form's latest onDrop.
  let drops = [];
  let onDrop = () => drops.push('first');
  const useWithDrop = () => useGenerationPoll({ onDrop });
  const job = (id, extra) => JSON.stringify({ jobId: id, idempotencyKey: id.replace('job', 'key'), mode: 'create', startedAt: Date.now(), ...extra });

  fresh();
  globalThis.__userId = 'user_b';
  store.set(KEY, job('job-29', { userId: 'user_a' }));
  let f = mount(useWithDrop);
  await settle();
  check("onDrop: another account's job dropped on mount is reported once", drops.length === 1 && saved() === null, { drops, saved: saved() });
  f.unmount();

  drops = [];
  fresh();
  store.set(KEY, job('job-30', { startedAt: Date.now() - 60 * 60 * 1_000 }));
  f = mount(useWithDrop);
  await settle();
  check('onDrop: a job from an earlier visit past the stale limit is reported', drops.length === 1 && saved() === null, { drops, saved: saved() });
  f.unmount();

  drops = [];
  fresh();
  globalThis.__userId = 'user_a';
  store.set(KEY, job('job-31', { userId: 'user_a' }));
  f = mount(useWithDrop);
  await settle();
  const resumed = f.value.status;
  f.unmount();
  fresh();
  f = mount(useWithDrop);
  await settle();
  check('onDrop: control: a resumed job, and nothing saved, are not reported', drops.length === 0 && resumed === 'polling', { drops, resumed });
  f.unmount();

  drops = [];
  fresh();
  globalThis.__userId = 'user_a';
  const sendLate = sendFromAFormThatLeft();
  globalThis.__userId = 'user_b';
  f = mount(useWithDrop);
  onDrop = () => drops.push('second');
  f.update();
  sendLate('job-32', 'key-32', 'create');
  await settle();
  check("onDrop: A's 202 landing while B's form is mounted is reported, to the form's latest onDrop",
    drops.join() === 'second' && saved() === null, { drops, saved: saved() });
  f.unmount();
  onDrop = () => drops.push('first');
}
if (typeof useGenerateTab === 'function') {
  // The page's tab. Another account signing in by navigation (Clerk loaded
  // before the page renders): the page opens on Create.
  fresh();
  globalThis.__userId = 'user_b';
  store.set(KEY, ANIM_JOB('job-25', 'user_a'));
  let page = mount(useGenerateTab);
  let form = mount(useGenerationPoll);
  await settle();
  check("account, tab: another account's Animate job does not open Animate, and the Create form drops it",
    page.value.tab === 'create' && form.value.status === 'idle' && saved() === null && fetchCalls.length === 0,
    { tab: page.value.tab, status: form.value.status, saved: saved(), fetchCalls: fetchCalls.length });
  form.unmount();
  page.unmount();

  // A reload: the page renders before Clerk knows the user, so its first tab
  // follows the saved Animate job. When Clerk's user arrives, the page
  // renders again, and the signed-in Show mounts the form for the tab that
  // render settles on; the form's layout effects run, then the page's, then
  // the form's mount effect.
  async function reloadThenUserArrives(userId) {
    const p = mount(useGenerateTab);
    const firstTab = p.value.tab;
    globalThis.__userId = userId;
    p.render();
    const formTab = p.value.tab;
    const f = mount(useGenerationPoll, { defer: true });
    f.commitLayout();
    p.commitLayout();
    f.commitPassive();
    p.commitPassive();
    await settle();
    return { p, f, firstTab, formTab };
  }
  fresh();
  store.set(KEY, ANIM_JOB('job-26', 'user_a'));
  let run = await reloadThenUserArrives('user_b');
  check("account, tab: on a reload, another account's Animate job: the render where the user arrives settles on Create, and the Create form drops the job",
    run.firstTab === 'animate' && run.formTab === 'create' && run.p.value.tab === 'create' && run.f.value.status === 'idle' && saved() === null && fetchCalls.length === 0,
    { firstTab: run.firstTab, formTab: run.formTab, tab: run.p.value.tab, status: run.f.value.status, saved: saved(), fetchCalls: fetchCalls.length });
  run.f.unmount();
  run.p.unmount();

  fresh();
  store.set(KEY, ANIM_JOB('job-27', 'user_a'));
  run = await reloadThenUserArrives('user_a');
  check('account, tab: on a reload, the same account stays on Animate, and the Animate form resumes the job',
    run.firstTab === 'animate' && run.formTab === 'animate' && run.p.value.tab === 'animate' && run.f.value.status === 'polling' && saved() === 'job-27',
    { firstTab: run.firstTab, formTab: run.formTab, tab: run.p.value.tab, status: run.f.value.status, saved: saved() });
  run.f.unmount();
  run.p.unmount();

  // A pick does not outlive its account. A picks a tab and signs out; B
  // signs in. B's own Create job opens on Create, and the resume check
  // counts no pick for B.
  async function pickThenAnotherAccount(pick, savedForB) {
    globalThis.__userId = 'user_a';
    const p = mount(useGenerateTab);
    p.value.pickTab(pick);
    await settle();
    globalThis.__userId = null;
    p.update();
    globalThis.__userId = 'user_b';
    if (savedForB) store.set(KEY, savedForB);
    p.update();
    await settle();
    return p;
  }
  fresh();
  page = await pickThenAnotherAccount('animate', JSON.stringify({ jobId: 'job-33', idempotencyKey: 'key-33', mode: 'create', startedAt: Date.now(), userId: 'user_b' }));
  form = mount(useGenerationPoll);
  await settle();
  check("account, tab: A's pick does not hold for B: B's own Create job opens on Create, and the Create form resumes it",
    page.value.tab === 'create' && form.value.status === 'polling' && saved() === 'job-33', { tab: page.value.tab, status: form.value.status, saved: saved() });
  form.unmount();
  page.unmount();

  fresh();
  page = await pickThenAnotherAccount('create', null);
  const sendForB = sendFromAFormThatLeft();
  form = mount(useGenerationPoll);
  sendForB('job-34', 'key-34', 'animate');
  await settle();
  check("account, tab: ... and B's Animate job landing late opens Animate, with no request from the Create form (no pick counted for B)",
    page.value.tab === 'animate' && form.value.status === 'idle' && fetchCalls.length === 0 && saved() === 'job-34',
    { tab: page.value.tab, status: form.value.status, fetchCalls: fetchCalls.length, saved: saved() });
  form.unmount();
  page.unmount();

  // Control: a pick holds while the same account stays signed in, through
  // later renders: A's own Animate job landing late is resumed by the form
  // on the tab A picked, and the tab stays.
  fresh();
  globalThis.__userId = 'user_a';
  page = mount(useGenerateTab);
  page.value.pickTab('create');
  await settle();
  page.update();
  await settle();
  const sendForA = sendFromAFormThatLeft();
  form = mount(useGenerationPoll);
  sendForA('job-35', 'key-35', 'animate');
  await settle();
  check('account, tab: control: a pick holds while the account stays signed in, through later renders',
    page.value.tab === 'create' && form.value.status === 'polling' && saved() === 'job-35',
    { tab: page.value.tab, status: form.value.status, saved: saved() });
  form.unmount();
  page.unmount();
}

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
