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
// useAuth whose getToken each case scripts. fetch and localStorage are
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
      if (!c.scheduled) {
        c.scheduled = true;
        queueMicrotask(() => { c.scheduled = false; if (!c.unmounted) c.render(); });
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
  c.slots[i] = { fn, deps };
  return fn;
}
export function useEffect(fn, deps) {
  const c = current; const i = c.i++;
  const prev = c.slots[i];
  if (prev && same(prev.deps, deps)) return;
  const slot = { deps, cleanup: prev && prev.cleanup, effect: true };
  c.slots[i] = slot;
  c.effects.push(() => {
    if (slot.cleanup) slot.cleanup();
    const cleanup = fn();
    slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
}
export function mount(hook) {
  const c = { slots: {}, effects: [], unmounted: false, scheduled: false, lateSets: 0, value: undefined, i: 0 };
  c.render = () => {
    current = c; c.i = 0; c.value = hook(); current = null;
    c.effects.splice(0).forEach((run) => run());
  };
  c.unmount = () => {
    c.unmounted = true;
    Object.values(c.slots).forEach((s) => { if (s && s.effect && s.cleanup) s.cleanup(); });
  };
  c.render();
  return c;
}
`;
const CLERK_STUB = 'export function useAuth() { return { getToken: globalThis.__getToken }; }';
const ENTRY = `
export * from ${JSON.stringify(path.join(ROOT, 'src/hooks/useGenerationPoll.ts'))};
export { mount } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};
`;
fs.writeFileSync(path.join(DIR, 'fake-react.mjs'), FAKE_REACT);
fs.writeFileSync(path.join(DIR, 'clerk-stub.mjs'), CLERK_STUB);
fs.writeFileSync(path.join(DIR, 'entry.mjs'), ENTRY);

// localStorage and window, before the hook module loads.
const store = new Map();
const fakeStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
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
const { useGenerationPoll, onLateJob, mount } = mod;

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
  store.clear(); tokenQueue.length = 0; fetchQueue.length = 0; fetchCalls = [];
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

// 4. A job saved after its form unmounted (the Generate request was in flight
// when the user left): the page's taker is asked before any mounted hook
// (Second 073 P2-B).
check('onLateJob is exported', typeof onLateJob === 'function');
if (typeof onLateJob === 'function') {
  fresh();
  const asked = [];
  const off = onLateJob((mode) => { asked.push(mode); return true; });
  const a = mount(useGenerationPoll); // the Animate form that sent the request
  const send = a.value.startPolling;
  a.unmount(); // the user leaves before the 202 arrives
  const b = mount(useGenerationPoll); // the Create form on return
  await settle();
  send('job-5', 'key-5', 'animate'); // the 202 lands
  await settle();
  check('late job: the taker is asked with its mode and the other form is not told',
    asked.join() === 'animate' && b.value.status === 'idle' && fetchCalls.length === 0 && saved() === 'job-5',
    { asked, b: b.value.status, fetchCalls: fetchCalls.length, saved: saved() });
  b.unmount(); // the page opens the Animate tab
  fetchQueue.push(answer(SUCCESS));
  const c = mount(useGenerationPoll);
  await settle();
  check('late job: the form on the job tab resumes it on mount', c.value.status === 'success' && saved() === null,
    { c: c.value.status, saved: saved() });
  c.unmount();
  off();

  fresh();
  const offNo = onLateJob(() => false); // the user picked a tab, or the job's tab is open
  const a2 = mount(useGenerationPoll);
  const send2 = a2.value.startPolling;
  a2.unmount();
  const b2 = mount(useGenerationPoll);
  await settle();
  send2('job-6', 'key-6', 'create');
  await settle();
  check('late job: when the taker declines, the form on screen picks the job up',
    b2.value.status === 'polling' && saved() === 'job-6', { b: b2.value.status, saved: saved() });
  b2.unmount();
  offNo();

  fresh();
  let calls = 0;
  const offGone = onLateJob(() => { calls++; return true; });
  offGone();
  const a3 = mount(useGenerationPoll);
  const send3 = a3.value.startPolling;
  a3.unmount();
  const b3 = mount(useGenerationPoll);
  await settle();
  send3('job-7', 'key-7', 'create');
  await settle();
  check('late job: an unregistered taker is not asked', calls === 0 && b3.value.status === 'polling', { calls, b: b3.value.status });
  b3.unmount();
}

if (failed > 0) {
  console.log(`${failed} FAIL`);
  process.exit(1);
}
console.log('all pass');
