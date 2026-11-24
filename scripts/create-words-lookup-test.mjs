// scripts/create-words-lookup-test.mjs
//
// G2, the "Adds" lookup on Create Sprite (src/lib/createWordsLookup.ts and its
// hook src/hooks/useCreateWords.ts), and the rendered "What's it for?" choice
// (src/components/sprites/WhatsItFor.tsx). AUDIT g2-page-r1 M3: the lookup,
// its keeping, its retries, its token and its key guard, driven on a stand-in
// (a made-up fetch and clock; made-up words only), and which card and chips
// render checked and greyed.
//
// 1. One lookup: the token, past the browser's cache, the answer read, eight
//    seconds at most.
// 2. Kept answers and the key guard.
// 3. The lookup over time: a short pause per new choice, answers out of order,
//    late answers kept, retries that slow down, the ten-minute age, renew.
// 4. The key and query for every choice on every Create style.
// 5. The rendered choice.
// 6. Wiring: the hook gives the browser and nothing else; the form renews on
//    create_words_changed.
//
// Run from the repo root: `node scripts/create-words-lookup-test.mjs`.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.create-words-lookup-test');
await build({
  entryPoints: {
    createWordsLookup: path.join(ROOT, 'src/lib/createWordsLookup.ts'),
    createCards: path.join(ROOT, 'src/lib/createCards.ts'),
    styleRegistry: path.join(ROOT, 'src/lib/styleRegistry.ts'),
    WhatsItFor: path.join(ROOT, 'src/components/sprites/WhatsItFor.tsx'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error', jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const load = (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const L = await load('createWordsLookup');
const C = await load('createCards');
const { OFFERED_STYLES, getStyleById } = await load('styleRegistry');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// A made-up clock with timers, and a made-up fetch whose answers the test
// gives, in any order.
function standIn({ token = 'tok_made_up' } = {}) {
  let now = 1_000_000, nextId = 1;
  const timers = new Map();
  const calls = [];
  const deps = {
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    getToken: async () => token,
    fetch: (url, init) => new Promise((resolve, reject) => {
      const call = { url, init, resolve, reject, done: false };
      calls.push(call);
      init.signal?.addEventListener('abort', () => { if (!call.done) { call.done = true; reject(new Error('aborted')); } });
    }),
  };
  const answer = async (call, status, json) => {
    call.done = true;
    call.resolve({ status, json: async () => { if (json === undefined) throw new Error('not json'); return json; } });
    await flush();
  };
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      await flush();
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
    await flush();
  };
  return { deps, calls, answer, advance, timers, get now() { return now; } };
}
const query = (url) => Object.fromEntries(new URL(url, 'http://x').searchParams);
const okJson = (adds, version = 'v1') => ({ success: true, adds, version });
const spPlat = { card: 'platformer', view: null, framing: null };
const spTop = { card: 'topdown', view: null, framing: null };
const spPort = { card: 'portrait', view: null, framing: null };

// ── 1. One lookup ──

{
  const t = standIn();
  const p = L.lookupWords(t.deps, 'rd_plus__classic', spPlat);
  await t.advance(0);
  const c = t.calls[0];
  check('1a: the lookup carries the session token, goes past the browser\'s cache, and asks for the choice\'s ids (H1, M3)',
    c && c.init.headers.Authorization === 'Bearer tok_made_up' && c.init.cache === 'no-store'
    && same(query(c.url), { style: 'rd_plus__classic', card: 'platformer', view: '', framing: '' }) && c.url.startsWith('/api/create-words?'));
  await t.answer(c, 200, okJson('stub-a'));
  check('1b: a well-formed answer is read', same(await p, { state: 'ok', adds: 'stub-a', version: 'v1' }));
  const t2 = standIn({ token: null });
  const p2 = L.lookupWords(t2.deps, 'rd_plus__classic', spPlat);
  await t2.advance(0);
  check('1c: no session token, no Authorization header', same(t2.calls[0].init.headers, {}));
  await t2.answer(t2.calls[0], 503, { success: false, error: 'unavailable' });
  check('1d: a 503 is unavailable', (await p2).state === 'unavailable');
  const t3 = standIn();
  const p3 = L.lookupWords(t3.deps, 'rd_plus__classic', spPlat);
  await t3.advance(0);
  await t3.answer(t3.calls[0], 200, undefined);
  check('1e: an answer that is not JSON is unavailable', (await p3).state === 'unavailable');
  const t4 = standIn();
  const p4 = L.lookupWords(t4.deps, 'rd_plus__classic', spPlat);
  await t4.advance(L.ANSWER_TIMEOUT_MS - 1);
  let settled = false; p4.then(() => { settled = true; });
  await t4.advance(0);
  const before = settled;
  await t4.advance(1);
  check('1f: no answer in eight seconds is no answer (L2)', !before && settled && (await p4).state === 'unavailable' && L.ANSWER_TIMEOUT_MS === 8000);
}

// ── 2. Kept answers and the key guard ──

{
  const k = new L.KeptWords();
  k.set('a', { state: 'ok', adds: 'x', version: 'v1' }, 0);
  k.set('b', { state: 'refused', version: 'v1' }, 0);
  k.set('c', { state: 'unavailable' }, 0);
  check('2a: well-formed answers are kept; no answer is not', !!k.get('a', 1) && !!k.get('b', 1) && k.get('c', 1) === null);
  check('2b: kept ten minutes, then gone', !!k.get('a', L.KEEP_MS - 1) && k.get('a', L.KEEP_MS) === null && L.KEEP_MS === 600000);
  k.set('d', { state: 'ok', adds: 'y', version: 'v1' }, 0); k.clear();
  check('2c: clear forgets every kept answer', k.get('d', 1) === null);
  const last = { key: 'K1', answer: { state: 'ok', adds: 'x', version: 'v1' } };
  check('2d: the key guard: another choice\'s answer never shows; it reads as loading (M3)',
    L.shownWords('K2', last).state === 'loading' && same(L.shownWords('K1', last), last.answer)
    && L.shownWords(null, last).state === 'none' && L.shownWords('K1', null).state === 'loading');
  check('2e: retries slow down: 20 s, 40, 80, 160, then every 5 minutes (L3)',
    same([1, 2, 3, 4, 5, 6, 9].map(L.retryDelay), [20000, 40000, 80000, 160000, 300000, 300000, 300000]));
}

// ── 3. The lookup over time ──

{
  const t = standIn();
  const kept = new L.KeptWords();
  const w = new L.WordsLookup(t.deps, kept);
  let emits = 0; w.subscribe(() => { emits++; });
  const key = (sp) => C.wordsKey('rd_plus__classic', sp);
  // A held arrow key: three choices inside the pause ask once, for the last.
  w.choose('rd_plus__classic', spPlat);
  await t.advance(50);
  w.choose('rd_plus__classic', spTop);
  await t.advance(50);
  w.choose('rd_plus__classic', spPort);
  await t.advance(L.ASK_AFTER_MS);
  check('3a: a new choice is asked after a short pause, so choices passed through are not asked (L9)',
    t.calls.length === 1 && query(t.calls[0].url).card === 'portrait');
  await t.answer(t.calls[0], 200, okJson('stub-portrait'));
  check('3b: the answer is the shown one, for its own key', same(w.last(), { key: key(spPort), answer: { state: 'ok', adds: 'stub-portrait', version: 'v1' } }) && emits >= 1);
  // Answers out of order: platformer asked, then topdown; platformer's lands last.
  w.choose('rd_plus__classic', spPlat); await t.advance(L.ASK_AFTER_MS);
  w.choose('rd_plus__classic', spTop); await t.advance(L.ASK_AFTER_MS);
  const [cPlat, cTop] = t.calls.slice(1);
  await t.answer(cTop, 200, okJson('stub-top'));
  await t.answer(cPlat, 200, okJson('stub-plat'));
  check('3c: answers out of order: the late one never replaces the current choice\'s (key guard)',
    w.last().key === key(spTop) && w.last().answer.adds === 'stub-top');
  check('3d: the late answer is kept by its own key, so going back asks nothing (L9)', !!kept.get(key(spPlat), t.now));
  const n = t.calls.length;
  w.choose('rd_plus__classic', spPlat); await t.advance(0);
  check('3e: a kept answer shows at once, with no lookup', t.calls.length === n && w.last().key === key(spPlat) && w.last().answer.adds === 'stub-plat');
  // The age: ten minutes after it was kept, the answer on screen is asked again.
  await t.advance(L.KEEP_MS);
  check('3f: the answer on screen is asked again once ten minutes old (H1)', t.calls.length === n + 1 && query(t.calls[n].url).card === 'platformer');
  await t.answer(t.calls[n], 200, okJson('stub-plat-2', 'v2'));
  check('3g: and the new answer replaces it', w.last().answer.adds === 'stub-plat-2' && w.last().answer.version === 'v2');
  // Renew: every kept answer forgotten, the choice asked again at once, nothing shown meanwhile.
  w.renew();
  check('3h: renew forgets the kept answers and shows nothing old while it asks (H1)', w.last() === null && kept.get(key(spTop), t.now) === null);
  await t.advance(0);
  check('3i: renew asks at once, past the browser\'s cache', t.calls.length === n + 2 && t.calls[n + 1].init.cache === 'no-store');
  await t.answer(t.calls[n + 1], 200, okJson('stub-plat-3', 'v3'));
  check('3j: the renewed answer carries the new version', w.last().answer.version === 'v3');
}
{
  // No answer: asked again, slower each time; another choice asks at once after its pause.
  const t = standIn();
  const w = new L.WordsLookup(t.deps, new L.KeptWords());
  w.choose('rd_plus__classic', spPlat); await t.advance(L.ASK_AFTER_MS);
  await t.answer(t.calls[0], 503, { success: false, error: 'unavailable' });
  check('3k: no answer shows as unavailable', w.last().answer.state === 'unavailable');
  await t.advance(19999);
  const at19 = t.calls.length;
  await t.advance(1);
  await t.answer(t.calls[1], 503, {});
  await t.advance(39999);
  const at39 = t.calls.length;
  await t.advance(1);
  check('3l: retried after 20 s, then after 40 s (L3)', at19 === 1 && at39 === 2 && t.calls.length === 3);
  await t.answer(t.calls[2], 503, {});
  w.choose('rd_plus__classic', spTop); await t.advance(L.ASK_AFTER_MS);
  check('3m: another choice after a failure asks at once, after the pause (M2)', t.calls.length === 4 && query(t.calls[3].url).card === 'topdown');
  await t.answer(t.calls[3], 200, okJson('stub-top'));
  await t.advance(300000);
  check('3n: the old choice\'s retries stop once the choice moved on', t.calls.length === 4 && w.last().answer.adds === 'stub-top');
  w.dispose();
  let emitted = 0; w.subscribe(() => { emitted++; });
  w.choose('rd_plus__classic', spTop); await t.advance(L.ASK_AFTER_MS);
  check('3o: after dispose (React\'s dev remount), the same choice is taken again: here from its kept answer, with no lookup',
    emitted === 1 && t.calls.length === 4 && w.last().answer.adds === 'stub-top');
  w.choose('rd_plus__classic', null); await t.advance(L.ASK_AFTER_MS);
  check('3p: no ids ("Just a sprite", or a style the cards do not apply to): nothing asked', t.calls.length === 4);
}

// ── 4. Keys and queries for every choice ──

{
  const createStyles = OFFERED_STYLES.filter((s) => !s.isAnimation);
  const seen = new Map();
  let allRoundTrip = true, distinct = true, count = 0;
  for (const st of createStyles) for (const card of C.CREATE_CARDS) for (const v of [null, ...C.CREATE_VIEWS.map((x) => x.id)]) for (const f of [null, ...C.CREATE_FRAMINGS.map((x) => x.id)]) {
    let ch = C.cardChoice(card.id);
    if (v) ch = C.pickView(ch, v);
    if (f) ch = C.pickFraming(ch, f, st.id);
    const sp = C.specFor(ch, st);
    if (!sp) continue;
    count++;
    const k = C.wordsKey(st.promptStyle, sp);
    const q = query(C.wordsQuery(st.promptStyle, sp));
    if (!(q.style === st.promptStyle && q.card === sp.card && q.view === (sp.view ?? '') && q.framing === (sp.framing ?? ''))) allRoundTrip = false;
    const id = JSON.stringify([st.promptStyle, sp]);
    if (seen.has(k) && seen.get(k) !== id) distinct = false;
    seen.set(k, id);
  }
  check(`4a: every choice's query carries its style, card, view and framing (${count} choices)`, allRoundTrip && count > 50);
  check('4b: two choices that send different ids never share a key (framing included; M3)', distinct);
}

// ── 5. The rendered choice ──

{
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { default: WhatsItFor } = await load('WhatsItFor');
  const render = (choice, styleId, applies, fineTuneOpen = true) => renderToStaticMarkup(createElement(WhatsItFor, {
    choice, onChoose: () => {}, style: getStyleById(styleId), applies, greyed: C.cardsGreyed(applies), badge: 'done', fineTuneOpen, onToggleFineTune: () => {},
  }));
  const attrsOf = (html, attr) => [...html.matchAll(new RegExp(`<button[^>]*${attr}="([^"]+)"[^>]*>`, 'g'))].map((m) => ({
    id: m[1], checked: /aria-checked="true"/.test(m[0]), disabled: /aria-disabled="true"/.test(m[0]) }));
  const pro = 'pro-default';
  const h1 = render(C.pickView(C.cardChoice('platformer'), 'front'), pro, true);
  const cards1 = attrsOf(h1, 'data-create-card'), chips1 = attrsOf(h1, 'data-create-chip');
  check('5a: the chosen card and the effective rows render checked; nothing greyed where the cards apply',
    same(cards1.filter((c) => c.checked).map((c) => c.id), ['platformer']) && cards1.every((c) => !c.disabled)
    && same(chips1.filter((c) => c.checked).map((c) => c.id), ['view-front', 'framing-full']) && chips1.filter((c) => c.disabled).length === 0);
  check('5b: a row changed: the chosen card reads "Changed in fine-tune below." and keeps its own line\'s room (M1)',
    /<span class="\[grid-area:1\/1\] ">Changed in fine-tune below\.<\/span><span class="\[grid-area:1\/1\] invisible">Side view, facing right/.test(h1));
  const h2 = render(C.pickView(C.cardChoice('portrait'), 'side'), 'plus-classic', false);
  const cards2 = attrsOf(h2, 'data-create-card');
  check('5c: a style the cards do not apply to: every card and chip greyed and none checked as on; no "Changed" line',
    cards2.every((c) => c.disabled) && attrsOf(h2, 'data-create-chip').every((c) => c.disabled && !c.checked)
    && !/<span class="\[grid-area:1\/1\] ">Changed in fine-tune/.test(h2) && h2.includes(C.GREYED_CARDS_LINE));
  const h3 = render(C.cardChoice('raw'), pro, true);
  check('5d: "Just a sprite": the card checked, the rows greyed with their line', same(attrsOf(h3, 'data-create-card').filter((c) => c.checked).map((c) => c.id), ['raw'])
    && attrsOf(h3, 'data-create-chip').every((c) => c.disabled) && h3.includes(C.RAW_ROWS_LINE));
  const h4 = render(C.pickFraming(C.cardChoice('topdown'), 'waist', 'plus-classic'), 'plus-classic', true);
  check('5e: Waist up greyed off Character (Pro), and never checked there', attrsOf(h4, 'data-create-chip').find((c) => c.id === 'framing-waist').disabled
    && !attrsOf(h4, 'data-create-chip').find((c) => c.id === 'framing-waist').checked);
  const fast = OFFERED_STYLES.find((s) => s.tier === 'fast' && !s.isAnimation && C.cardsApply(s));
  const h5 = render(C.pickView(C.cardChoice('platformer'), 'three_quarter'), fast.id, true, false);
  check('5f: the fine-tune button names its rows only while they are open; the Fast note shows with them closed (L13)',
    !/aria-controls=/.test(h5) && h5.includes(C.FAST_THREE_QUARTER_LINE) && /aria-controls=/.test(render(C.cardChoice('platformer'), pro, true, true)));
}

// ── 6. Wiring ──

{
  const hook = read('src/hooks/useCreateWords.ts');
  const form = read('src/components/sprites/GenerationForm.tsx');
  check('6a: the hook gives the lookup the browser and the choice, and shows the answer for the rendered choice only',
    /new WordsLookup\(\{/.test(hook) && /fetch: \(url, init\) => fetch\(url, init\)/.test(hook) && /getToken: \(\) => tokenRef\.current\(\)/.test(hook)
    && /lookup\.choose\(promptStyle, spec\);/.test(hook) && /return \{ words: shownWords\(key, last\), renew \};/.test(hook)
    && (hook.match(/fetch\(/g) ?? []).length === 1);
  check('6b: the form renews the words when Generate says they changed (H1)',
    /if \(errObj\.error === 'create_words_changed'\) renewWords\(\);\s*setGenerationError\(msg\);/.test(form)
    && /const \{ words, renew: renewWords \} = useCreateWords\(selectedStyle\.promptStyle, spec, getToken\);/.test(form));
  check('6c: no file of the lookup holds words: made-up words in this test only', !/Adds:/.test(read('src/lib/createWordsLookup.ts')));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
