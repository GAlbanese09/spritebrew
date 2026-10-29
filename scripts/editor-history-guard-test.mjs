// scripts/editor-history-guard-test.mjs
//
// Offline tests for src/components/sprites/useEditorHistoryGuard.ts (BUILD
// 2026-10-29): while the editor is open, the browser's Back (on iOS an edge
// swipe, which no page can block) pops an entry of the editor's own and
// calls the editor instead of leaving the page; the entry is put back to
// stay, and taken off when the editor closes. Run from the repo root:
// `node scripts/editor-history-guard-test.mjs`. Prints only case names and
// pass or fail.
//
// The hook is bundled with esbuild into local/.editor-history-guard-test/
// (gitignored) with react swapped for a small stand-in that runs layout
// then passive effects and can replay them as StrictMode does. The history
// is a stand-in too: a stack of entries, where back() moves one entry down
// in a later task and fires popstate, as browsers do.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'local', '.editor-history-guard-test');
fs.mkdirSync(DIR, { recursive: true });
const lines = (...l) => l.join(String.fromCharCode(10)) + String.fromCharCode(10);
fs.writeFileSync(path.join(DIR, 'fake-react.mjs'), lines(
  'let current = null;',
  'const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));',
  'export function useRef(init) { const c = current; const i = c.i++; if (!(i in c.slots)) c.slots[i] = { current: init }; return c.slots[i]; }',
  'export function useCallback(fn, deps) { const c = current; const i = c.i++; const p = c.slots[i]; if (p && same(p.deps, deps)) return p.fn; c.slots[i] = { fn, deps }; return fn; }',
  'function effectHook(kind) {',
  '  return function (fn, deps) {',
  '    const c = current; const i = c.i++; const prev = c.slots[i];',
  '    if (prev && deps !== undefined && same(prev.deps, deps)) return;',
  '    const slot = { deps, cleanup: prev && prev.cleanup, effect: kind, fn };',
  '    c.slots[i] = slot;',
  '    c[kind].push(() => { if (slot.cleanup) slot.cleanup(); const k = fn(); slot.cleanup = typeof k === "function" ? k : undefined; });',
  '  };',
  '}',
  'export const useLayoutEffect = effectHook("layout");',
  'export const useEffect = effectHook("passive");',
  'const React = { useRef, useCallback, useLayoutEffect, useEffect };',
  'export default React;',
  'export function mount(component) {',
  '  const c = { slots: {}, layout: [], passive: [], i: 0 };',
  '  const effects = (kind) => Object.values(c.slots).filter((s) => s && s.effect === kind);',
  '  c.render = () => { current = c; c.i = 0; try { c.value = component(); } finally { current = null; } c.layout.splice(0).forEach((r) => r()); c.passive.splice(0).forEach((r) => r()); };',
  '  c.unmount = () => { for (const kind of ["layout", "passive"]) effects(kind).forEach((s) => s.cleanup && s.cleanup()); };',
  '  c.strictReplay = () => { c.unmount(); for (const kind of ["layout", "passive"]) effects(kind).forEach((s) => { const k = s.fn(); s.cleanup = typeof k === "function" ? k : undefined; }); };',
  '  c.render();',
  '  return c;',
  '}',
));
fs.writeFileSync(path.join(DIR, 'entry.mjs'), lines(
  `export { useEditorHistoryGuard } from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/useEditorHistoryGuard.ts'))};`,
  `export { useLeaveByBack, LEAVE_BACK_WAIT_MS } from ${JSON.stringify(path.join(ROOT, 'src/components/sprites/useLeaveByBack.ts'))};`,
  `export { mount } from ${JSON.stringify(path.join(DIR, 'fake-react.mjs'))};`,
));

// The stand-in history.
const win = new EventTarget();
const hist = {
  entries: [{ page: 'previous' }, { page: 'here' }],
  index: 1,
  get state() { return this.entries[this.index]; },
  get length() { return this.entries.length; },
  pushState(state) { this.entries = this.entries.slice(0, this.index + 1); this.entries.push(state); this.index++; },
  back() {
    setTimeout(() => {
      if (this.index === 0) return;
      this.index--;
      win.dispatchEvent(new Event('popstate'));
    }, 0);
  },
};
win.history = hist;
// The page's path is the current entry's (an entry without one is the
// editor's own page).
Object.defineProperty(win, 'location', { get: () => ({ pathname: (hist.state && hist.state.path) || '/editor' }) });
win.setTimeout = setTimeout;
win.clearTimeout = clearTimeout;
globalThis.window = win;
const tick = () => new Promise((r) => setTimeout(r, 5));

const OUT = path.join(DIR, 'bundle.mjs');
await build({
  entryPoints: [path.join(DIR, 'entry.mjs')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  plugins: [{ name: 'stand-ins', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: path.join(DIR, 'fake-react.mjs') })); } }],
});
const { useEditorHistoryGuard, useLeaveByBack, LEAVE_BACK_WAIT_MS, mount } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const ours = () => hist.entries.filter((e) => e && e.__spritebrewEditor).length;
const fresh = () => { hist.entries = [{ page: 'previous' }, { page: 'here' }]; hist.index = 1; };
function guard(active = true) {
  const calls = { back: 0 };
  const props = { active };
  const c = mount(() => useEditorHistoryGuard(props.active, () => { calls.back++; }));
  return { c, calls, props, rearm: () => c.value.rearm() };
}

// 1. Opening: one entry on top, same page.
{
  fresh();
  const { c } = guard();
  check('opening the editor puts one entry of its own on top of the history', hist.length === 3 && hist.index === 2 && ours() === 1);
  c.unmount();
  await tick();
}

// 2. Back pops it and calls the editor, which may stay (rearm) or not.
{
  fresh();
  const { c, calls, rearm } = guard();
  hist.back();
  await tick();
  const afterBack = { back: calls.back, index: hist.index };
  rearm();
  const afterRearm = hist.index;
  hist.back();
  await tick();
  check('Back pops the entry and calls the editor once instead of leaving the page',
    afterBack.back === 1 && afterBack.index === 1, afterBack);
  check('to stay, the entry is put back, and the next Back is caught again',
    afterRearm === 2 && ours() === 1 && calls.back === 2, { afterRearm, calls, index: hist.index });
  c.unmount();
  await tick();
}

// 3. Closing the editor takes its entry off; the next Back is the user's own.
{
  fresh();
  const { c, calls } = guard();
  c.unmount();
  await tick();
  check('closing the editor takes its entry off (no Back is spent on it), without calling the editor',
    hist.index === 1 && calls.back === 0, { index: hist.index, calls });
}

// 4. A navigation on top: the entry is left where it is.
{
  fresh();
  const { c } = guard();
  hist.pushState({ page: 'next' });
  c.unmount();
  await tick();
  check('after a navigation pushed a new entry, closing leaves the history alone', hist.index === 3 && hist.state.page === 'next');
}

// 5. Turning the guard off (the page editor with no edits left) takes it off.
{
  fresh();
  const g = guard(true);
  g.props.active = false;
  g.c.render();
  await tick();
  check('when the guard turns off, its entry comes off', hist.index === 1 && ours() === 1 && hist.state.page === 'here', { index: hist.index });
  g.c.unmount();
  await tick();
}

// 6. Off from the start: no entry.
{
  fresh();
  const { c } = guard(false);
  check('an inactive guard adds no entry', hist.length === 2 && hist.index === 1);
  c.unmount();
  await tick();
}

// 7. StrictMode: mount, clean up, mount again: still one entry, kept.
{
  fresh();
  const { c, calls } = guard();
  c.strictReplay();
  await tick();
  check("StrictMode's replay keeps exactly one entry and does not take it off",
    hist.index === 2 && ours() === 1 && calls.back === 0, { index: hist.index, ours: ours() });
  c.unmount();
  await tick();
}

// 8. A popstate that lands on the entry (Forward) is not a Back.
{
  fresh();
  const { c, calls } = guard();
  hist.back();
  await tick();
  hist.index = 2;
  win.dispatchEvent(new Event('popstate'));
  await tick();
  check('Forward back onto the entry does not call the editor again', calls.back === 1, calls);
  c.unmount();
  await tick();
}

// 9a. Back from an entry pushed over the editor's (the editor still open)
// lands on the editor's entry: that is not a Back from the editor.
{
  fresh();
  const { c, calls } = guard();
  hist.pushState({ page: 'over' });
  hist.back();
  await tick();
  check("Back onto the editor's own entry (from one pushed over it) does not call the editor",
    calls.back === 0 && hist.index === 2 && c.value.ownsTop() === true, { calls, index: hist.index });
  c.unmount();
  await tick();
}

// 9b. A reload in the middle of a session leaves the old entry current:
// the next editor takes it over instead of pushing another on it.
{
  hist.entries = [{ page: 'here' }, { page: 'here', __spritebrewEditor: 'before-reload' }];
  hist.index = 1;
  const { c, calls } = guard();
  const opened = { length: hist.length, index: hist.index, ownsTop: c.value.ownsTop() };
  c.unmount();
  await tick();
  check('after a reload, the entry left on top is taken over (none pushed on it) and taken off when the editor closes',
    opened.length === 2 && opened.index === 1 && opened.ownsTop === true && hist.index === 0 && calls.back === 0, { opened, index: hist.index, calls });
}

// 9c. Second 121: an editor replaced at once by another (which takes over
// the same entry) must not take that entry off as it goes.
{
  fresh();
  const a = guard();
  const idOnTop = hist.state.__spritebrewEditor;
  a.c.unmount();
  const b = guard();
  await tick();
  check("an editor that goes while a new one takes over its entry leaves the entry to the new one",
    hist.index === 2 && hist.state.__spritebrewEditor === idOnTop && b.c.value.ownsTop() === true && a.calls.back === 0, { index: hist.index });
  b.c.unmount();
  await tick();
  check('and the new one takes it off when it goes', hist.index === 1, { index: hist.index });
}

// 9. ownsTop: whether a navigation away should replace the entry.
{
  fresh();
  const { c } = guard();
  const onTop = c.value.ownsTop();
  hist.back();
  await tick();
  const afterBack = c.value.ownsTop();
  c.value.rearm();
  const afterRearm = c.value.ownsTop();
  hist.pushState({ page: 'next' });
  const afterPush = c.value.ownsTop();
  check("ownsTop is true only while the editor's own entry is the current one (not after Back pops it, or a navigation on top)",
    onTop === true && afterBack === false && afterRearm === true && afterPush === false, { onTop, afterBack, afterRearm, afterPush });
  c.unmount();
  await tick();
}

// 10. Leave by Back (useLeaveByBack): it leaves when there is a page to go
// back to, falls back when there is not (or the entry below is this same
// page), and its wait dies with the editor that started it (Second 121).
const waitOut = () => new Promise((r) => setTimeout(r, LEAVE_BACK_WAIT_MS + 150));
function leaver() {
  const calls = { fallback: 0 };
  const c = mount(() => useLeaveByBack(() => { calls.fallback++; }));
  return { c, calls, leave: () => c.value() };
}
{
  hist.entries = [{ path: '/generate' }, { path: '/editor' }];
  hist.index = 1;
  const a = leaver();
  a.leave();
  await tick();
  // Next renders /generate: the editor goes.
  a.c.unmount();
  await waitOut();
  check('Leave by Back with a page to go back to: it goes there, and nothing more happens',
    hist.index === 0 && a.calls.fallback === 0, { index: hist.index, calls: a.calls });
}
{
  hist.entries = [{ path: '/editor' }];
  hist.index = 0;
  const a = leaver();
  a.leave();
  await waitOut();
  check("Leave by Back on the tab's first page: the fallback runs once", a.calls.fallback === 1, a.calls);
  a.c.unmount();
}
{
  hist.entries = [{ path: '/editor' }, { path: '/editor', x: 1 }];
  hist.index = 1;
  const a = leaver();
  a.leave();
  await waitOut();
  check('Leave by Back onto another entry of the same page: the fallback runs once', hist.index === 0 && a.calls.fallback === 1, a.calls);
  a.c.unmount();
}
{
  // Second 121 P2-D: the editor goes to /generate, and before its wait is
  // over the user comes back to /editor and a new editor opens.
  hist.entries = [{ path: '/generate' }, { path: '/editor' }];
  hist.index = 1;
  const a = leaver();
  a.leave();
  await tick();
  a.c.unmount();
  hist.index = 1;
  const b = leaver();
  await waitOut();
  check('an old Leave by Back never acts after its editor went, even back on the same page with a new editor',
    a.calls.fallback === 0 && b.calls.fallback === 0, { a: a.calls, b: b.calls });
  b.c.unmount();
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('all pass');
