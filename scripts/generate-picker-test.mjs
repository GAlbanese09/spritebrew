// scripts/generate-picker-test.mjs
//
// Offline tests for polish PR 2, session 1: /generate's Create form with the
// style field, the style picker, Recent and the Generate bar (HQ room
// 2026-11-08-018, -028, -031, -034; DESIGN pr2-generate-picker.md).
//
// 1. ENG condition 1: the request body. The block that builds it is pinned
//    byte for byte to main, then run for one fixed selection; every style's
//    request and money fields in styleRegistry match a snapshot taken once
//    from origin/main ba0b3e0c87fd12114e6b310fa5613170395a7765.
// 2. ENG condition 2: the purchase banner on generate/page.tsx is unchanged.
// 3. recentStyles.ts and 4. stylePickerNav.ts, as units.
// 5. Wiring the browser look also covers: names, roles, the coin, text sizes.
//
// Session 2 (polish PR 2, HQ room 2026-11-09-020): fetchBalance gains exactly
// one line, setServerBalanceKnown(true), and the opening style is the one
// style change that skips chooseStyle; the two checks that pinned the old
// shape now pin the new one. GenerationForm imports nothing new from a money
// path.
//
// Fix round 1 (audit r1 of PR #53; HQ room 2026-11-11-034, ENG -043): the
// style follows the balance until the person acts (one latch, set in the
// handlers that act), the form remembers the style for the visit
// (createFormVisit.ts), Recent is kept per account, and the plural at one
// token. Check 1e takes createFormVisit as the one more source (George, Nov
// 11, 2026); the checks that pinned the old shape now pin the new one.
//
// Fix round 2 (audit r2 of PR #53; HQ room 2026-11-11-076, -083, -090; ENG
// -091): the size fields, Background and the reference images set the latch
// too; from 640 px only the style's name shortens in the bar; 8-Direction
// Rotation is hidden from Create (OFFERED_STYLES) while every lookup and
// price still reads all 21. The checks that pinned the old shape now pin the
// new one.
//
// Run from the repo root: `node scripts/generate-picker-test.mjs`. Bundles
// with esbuild into local/.generate-picker-test/ (gitignored). Prints only
// case names and pass or fail. Wiring checks read the source with comments
// stripped.

import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.generate-picker-test');

await build({
  entryPoints: ['src/lib/recentStyles.ts', 'src/lib/stylePickerNav.ts', 'src/lib/styleRegistry.ts', 'src/lib/affordableStyle.ts', 'src/lib/createValidation.ts'].map((p) => path.join(ROOT, p)),
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const load = (name) => import(pathToFileURL(path.join(OUT_DIR, `${name}.mjs`)).href);
const { RECENT_STYLES_KEY, MAX_RECENT, readRecent, pushRecent, writeRecent, visibleRecent, recentStylesKey, accountRecentStorage } = await load('recentStyles');
const { nextIndex } = await load('stylePickerNav');
const { GENERATION_STYLES, getStyleById, OFFERED_STYLES, getTokenCost, getResolutionMode, getFreeTierBucket } = await load('styleRegistry');
const { OPENING_CANDIDATES } = await load('affordableStyle');
const { validateCreateBody } = await load('createValidation');

let failed = 0;
let cases = 0;
function check(name, ok, detail) {
  cases++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** The text from the line that starts with `from` through the end of the line that holds `to`. */
function block(text, from, to) {
  const start = text.indexOf(from);
  if (start < 0) return null;
  const at = text.indexOf(to, start);
  if (at < 0) return null;
  const end = text.indexOf('\n', at + to.length);
  return text.slice(start, end < 0 ? text.length : end + 1);
}

const formSrc = read('src/components/sprites/GenerationForm.tsx');
const pageSrc = read('src/app/generate/page.tsx');
const fieldSrc = read('src/components/sprites/StyleField.tsx');
const pickerSrc = read('src/components/sprites/StylePicker.tsx');
const panelSrc = read('src/components/sprites/ReferenceImagesPanel.tsx');
const registrySrc = read('src/lib/styleRegistry.ts');
const form = stripComments(formSrc);
const page = stripComments(pageSrc);
const field = stripComments(fieldSrc);
const picker = stripComments(pickerSrc);

// ── 1. ENG condition 1: the request body ──

// main's lines 199 to 219 of GenerationForm.tsx (git show origin/main:...),
// each with its newline. The em dash in main's comment is written as \u2014.
const MAIN_BODY_LINES = [
  '      const body: Payload = {',
  '        prompt: capturedPrompt,',
  '        promptStyle: selectedStyle.promptStyle,',
  '        width: effectiveWidth,',
  '        height: effectiveHeight,',
  '        expectedTokenCost: selectedStyle.tokenCost,',
  '      };',
  '',
  '      if (removeBg && selectedStyle.supportsRemoveBg) {',
  '        body.removeBg = true;',
  '      }',
  '',
  '      if (referenceImages.length > 0 && referencesEnabled) {',
  '        body.referenceImages = referenceImages;',
  '      }',
  '',
  '      // Per-attempt UUID \u2014 server\'s queue-kickoff path requires it; legacy',
  '      // SSE path ignores it. Producer\'s idempotency layer dedupes if the',
  '      // same UUID re-arrives on a network retry.',
  '      const idempotencyKey = crypto.randomUUID();',
  '      body.idempotencyKey = idempotencyKey;',
];
const MAIN_BODY = MAIN_BODY_LINES.map((l) => `${l}\n`).join('');
const MAIN_BODY_SHA = '1ef149e1d628de43f07921a4ba195e0c900e8f24e6d5c9839985b52ce9700539';

{
  check('1a: the embedded main body block is main\'s (21 lines, sha256 pinned)', MAIN_BODY_LINES.length === 21 && sha256(MAIN_BODY) === MAIN_BODY_SHA);
  const body = block(formSrc, '      const body: Payload = {', '      body.idempotencyKey = idempotencyKey;');
  check('1a: the request body block is byte-identical to main', body === MAIN_BODY);
  check('1a: it is built once, inside handleGenerate', formSrc.split('const body: Payload = {').length === 2
    && formSrc.indexOf('const handleGenerate = useCallback(') < formSrc.indexOf('const body: Payload = {'));

  let json = null;
  try {
    const { code } = await transform(
      `function run(capturedPrompt, selectedStyle, effectiveWidth, effectiveHeight, removeBg, referenceImages, referencesEnabled, crypto) {\n${body ?? ''}\nreturn body;\n}`,
      { loader: 'ts' },
    );
    const run = new Function(`${code}\nreturn run;`)();
    const fantasy = GENERATION_STYLES.find((s) => s.label === 'Fantasy');
    const result = run('a small knight', fantasy, 256, 256, true, [], fantasy.supportsReferenceImages === true, { randomUUID: () => 'k' });
    json = JSON.stringify(result);
  } catch (e) {
    json = String(e);
  }
  check('1b: Fantasy, "a small knight", 256 x 256, remove background, no references: the exact body',
    json === '{"prompt":"a small knight","promptStyle":"rd_pro__fantasy","width":256,"height":256,"expectedTokenCost":40,"removeBg":true,"idempotencyKey":"k"}', json);
}

{
  // From origin/main ba0b3e0c, once: id, promptStyle, tokenCost, costPerGeneration,
  // defaultWidth, defaultHeight, minSize, maxSize, fixedSize, supportsRemoveBg,
  // supportsReferenceImages (null when unset), isAnimation, category, tier.
  const FIELDS = ['id', 'promptStyle', 'tokenCost', 'costPerGeneration', 'defaultWidth', 'defaultHeight', 'minSize', 'maxSize', 'fixedSize', 'supportsRemoveBg', 'supportsReferenceImages', 'isAnimation', 'category', 'tier'];
  const SNAPSHOT = [
    ['pro-default', 'rd_pro__default', 40, 0.22, 256, 256, 96, 256, false, true, true, false, 'characters', 'pro'],
    ['pro-fantasy', 'rd_pro__fantasy', 40, 0.22, 256, 256, 96, 256, false, true, true, false, 'characters', 'pro'],
    ['pro-platformer', 'rd_pro__platformer', 40, 0.22, 256, 256, 96, 256, false, true, true, false, 'characters', 'pro'],
    ['pro-spritesheet', 'rd_pro__spritesheet', 40, 0.22, 256, 256, 96, 256, false, false, true, false, 'characters', 'pro'],
    ['pro-inventory', 'rd_pro__inventory_items', 40, 0.22, 256, 256, 96, 256, false, false, true, false, 'items', 'pro'],
    ['pro-fps-weapon', 'rd_pro__fps_weapon', 40, 0.22, 256, 256, 96, 256, false, true, true, false, 'items', 'pro'],
    ['pro-hex-tiles', 'rd_pro__hexagonal_tiles', 40, 0.22, 256, 256, 96, 256, false, false, true, false, 'tiles', 'pro'],
    ['pro-typography', 'rd_pro__typography', 40, 0.22, 256, 128, 96, 256, false, true, true, false, 'ui', 'pro'],
    ['plus-classic', 'rd_plus__classic', 16, 0.06, 192, 192, 32, 192, false, true, null, false, 'characters', 'plus'],
    ['plus-low-res', 'rd_plus__low_res', 16, 0.05, 64, 64, 16, 128, false, true, null, false, 'characters', 'plus'],
    ['plus-skill-icon', 'rd_plus__skill_icon', 16, 0.05, 64, 64, 16, 128, false, true, null, false, 'ui', 'plus'],
    ['plus-topdown-item', 'rd_plus__topdown_item', 16, 0.05, 64, 64, 16, 128, false, true, null, false, 'items', 'plus'],
    ['plus-mc-item', 'rd_plus__mc_item', 16, 0.05, 64, 64, 16, 128, false, true, null, false, 'items', 'plus'],
    ['fast-retro', 'rd_fast__retro', 5, 0.02, 256, 256, 64, 384, false, true, null, false, 'characters', 'fast'],
    ['fast-no-style', 'rd_fast__no_style', 5, 0.02, 256, 256, 64, 384, false, true, null, false, 'characters', 'fast'],
    ['anim-4angle-walking', 'animation__four_angle_walking', 25, 0.07, 48, 48, 48, 48, true, true, null, true, 'animations', 'animation'],
    ['anim-walking-idle', 'animation__walking_and_idle', 25, 0.07, 48, 48, 48, 48, true, true, null, true, 'animations', 'animation'],
    ['anim-small-sprites', 'animation__small_sprites', 25, 0.07, 32, 32, 32, 32, true, true, null, true, 'animations', 'animation'],
    ['anim-vfx', 'animation__vfx', 25, 0.07, 64, 64, 24, 96, false, true, null, true, 'animations', 'animation'],
    ['anim-any', 'animation__any_animation', 50, 0.25, 64, 64, 64, 64, true, true, null, true, 'animations', 'animation'],
    ['anim-8dir', 'animation__8_dir_rotation', 50, 0.25, 80, 80, 80, 80, true, true, null, true, 'animations', 'animation'],
  ];
  const now = GENERATION_STYLES.map((s) => FIELDS.map((f) => s[f] ?? null));
  const diff = now.map((row, i) => (same(row, SNAPSHOT[i]) ? null : row[0])).filter(Boolean);
  check('1c: every style\'s request and money fields match main\'s snapshot (21 styles, same order)', now.length === 21 && diff.length === 0, diff);
}

{
  check('1d: the selectedStyle line is unchanged',
    formSrc.includes('  const selectedStyle = useMemo(\n    () => getStyleById(selectedStyleId) ?? GENERATION_STYLES[0],\n    [selectedStyleId]\n  );\n'));
  check('1d: the Generate button\'s disabled expression is unchanged',
    formSrc.split('disabled={GENERATION_PAUSED || !prompt.trim() || isGenerating || insufficientTokens}').length === 2);
  // Main's balance fetch, and main's lines from selectedStyle through
  // handleGenerate, the poll effects and the progress cleanup: byte-identical.
  const fetchPart = block(formSrc, '  // Fetch token balance from server', '  }, [userId, restoreTokenBalance, fetchBalance]);');
  const logicPart = block(formSrc, '  const selectedStyle = useMemo(', '  useEffect(() => () => setGenerationProgress(null, null, null, null), [setGenerationProgress]);');
  // Main's balance fetch plus exactly one line, right after setTokenBalance.
  const ADDED = '        setServerBalanceKnown(true);';
  const fetchLines = (fetchPart ?? '').split('\n');
  const addedAt = fetchLines.flatMap((l, i) => (l === ADDED ? [i] : []));
  const withoutAdded = fetchLines.filter((_, i) => i !== addedAt[0]).join('\n');
  check('1d: the balance fetch is main\'s plus exactly one line, setServerBalanceKnown(true) after setTokenBalance(data.balance)',
    addedAt.length === 1 && fetchLines[addedAt[0] - 1] === '        setTokenBalance(data.balance);'
    && sha256(withoutAdded) === '031e99d7234fa746b5d8fad330a4dfcea2b8e42b7600c466cdde3a82e631006a'
    && (formSrc.match(/setServerBalanceKnown\(/g) ?? []).length === 1);
  check('1d: handleGenerate, the poll effects and the size effect are byte-identical to main', sha256(logicPart ?? '') === 'ddca238a98c415fd88049639672eba2854bbc8a07897d2a0a4ecac6d97be5f8e');
}

// ── 2. ENG condition 2: the purchase banner ──

{
  // From "function PurchaseStatusContent() {" to its closing "}" line.
  const start = pageSrc.indexOf('function PurchaseStatusContent() {');
  const close = start < 0 ? -1 : pageSrc.indexOf('\n}\n', start);
  const fn = start < 0 || close < 0 ? '' : pageSrc.slice(start, close + 3);
  check('2: PurchaseStatusContent is byte-identical to main (85 lines)', sha256(fn) === '12af133b2c185fc22f2d46e7ddddb66dbb20cc47a4394e98a5d421d4f98e5474');
  const imports = block(pageSrc, 'import {\n  PURCHASE_BANNER_COPY,', "} from '@/lib/purchaseBanner';");
  check('2: the purchaseBanner import block is byte-identical to main', sha256(imports ?? '') === 'd233cd62da308cdc69b3c8273bb4b32447b22fb8719f40a60249abad85f03cea');
  check('2: the three lines that render it inside Suspense are unchanged',
    pageSrc.split('      <Suspense fallback={null}>\n        <PurchaseStatusContent />\n      </Suspense>\n').length === 2);
}

// ── 3. recentStyles ──

{
  const ids = GENERATION_STYLES.map((s) => s.id);
  const memory = (initial) => {
    const map = new Map(initial === undefined ? [] : [[RECENT_STYLES_KEY, initial]]);
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map };
  };
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

  check('3: the key and the cap', RECENT_STYLES_KEY === 'spritebrew_recent_styles' && MAX_RECENT === 3);
  check('3: read keeps order, drops repeats and unknown ids, at most 3',
    same(readRecent(memory(JSON.stringify(['pro-fantasy', 'nope', 'pro-fantasy', 'plus-classic', 'anim-vfx', 'fast-retro'])), ids), ['pro-fantasy', 'plus-classic', 'anim-vfx']));
  check('3: read: bad JSON gives []', same(readRecent(memory('{oops'), ids), []));
  check('3: read: a non-array gives []', same(readRecent(memory('{"a":1}'), ids), []) && same(readRecent(memory('"pro-fantasy"'), ids), []));
  check('3: read: non-string entries are dropped', same(readRecent(memory(JSON.stringify([1, null, 'pro-fantasy'])), ids), ['pro-fantasy']));
  let fromThrowing;
  try { fromThrowing = readRecent(throwing, ids); } catch { fromThrowing = 'threw'; }
  check('3: read: a throwing storage gives []', same(fromThrowing, []), fromThrowing);
  check('3: read: a null storage or a missing key gives []', same(readRecent(null, ids), []) && same(readRecent(memory(), ids), []));
  check('3: push puts the previous style first', same(pushRecent(['a', 'b'], 'c', 'z'), ['c', 'a', 'b']));
  check('3: push moves a repeat to the front, no repeats', same(pushRecent(['a', 'b', 'c'], 'b', 'z'), ['b', 'a', 'c']));
  check('3: push leaves out the current style', same(pushRecent(['a', 'z', 'b'], 'c', 'z'), ['c', 'a', 'b']));
  check('3: push keeps at most 3', same(pushRecent(['a', 'b', 'c'], 'd', 'z'), ['d', 'a', 'b']));
  check('3: push never returns the current style even when it was the previous', same(pushRecent(['a'], 'z', 'z'), ['a']));
  const store = memory();
  writeRecent(store, ['pro-fantasy', 'plus-classic']);
  check('3: write saves JSON that read gives back', store.map.get(RECENT_STYLES_KEY) === '["pro-fantasy","plus-classic"]' && same(readRecent(store, ids), ['pro-fantasy', 'plus-classic']));
  let threw = false;
  try { writeRecent(throwing, ['a']); writeRecent(null, ['a']); } catch { threw = true; }
  check('3: write never throws (a throwing storage, a null storage)', !threw);
  check('3: visible leaves out the current style', same(visibleRecent(['a', 'b', 'c'], 'b'), ['a', 'c']));
  check('3: visible shows at most 3, no repeats', same(visibleRecent(['a', 'a', 'b', 'c', 'd'], 'z'), ['a', 'b', 'c']));
  // A walk: Classic -> Fantasy -> Retro -> Classic.
  let list = [];
  list = pushRecent(list, 'plus-classic', 'pro-fantasy');
  list = pushRecent(list, 'pro-fantasy', 'fast-retro');
  list = pushRecent(list, 'fast-retro', 'plus-classic');
  check('3: a walk of three changes reads newest first without the current', same(visibleRecent(list, 'plus-classic'), ['fast-retro', 'pro-fantasy']));

  // Fix round 1 (ENG -043 condition 4): one list per account.
  const OLD = JSON.stringify(['pro-fantasy', 'anim-vfx']);
  const raw = new Map([[RECENT_STYLES_KEY, OLD]]);
  const log = [];
  const browser = {
    getItem: (k) => { log.push(['get', k]); return raw.has(k) ? raw.get(k) : null; },
    setItem: (k, v) => { log.push(['set', k]); raw.set(k, v); },
  };
  const a = accountRecentStorage(browser, 'user_a');
  const b = accountRecentStorage(browser, 'user_b');
  check('3: an account\'s key is spritebrew_recent_styles_<userId>', recentStylesKey('user_a') === 'spritebrew_recent_styles_user_a');
  check('3: a new account starts empty even when the old unkeyed list exists', same(readRecent(a, ids), []) && same(readRecent(b, ids), []));
  writeRecent(a, ['pro-fantasy', 'fast-retro']);
  writeRecent(b, ['anim-vfx']);
  check('3: two accounts keep separate lists under their own keys',
    same(readRecent(a, ids), ['pro-fantasy', 'fast-retro']) && same(readRecent(b, ids), ['anim-vfx'])
    && raw.get('spritebrew_recent_styles_user_a') === '["pro-fantasy","fast-retro"]' && raw.get('spritebrew_recent_styles_user_b') === '["anim-vfx"]');
  check('3: the old unkeyed key is never read or written, copied or deleted',
    log.length > 0 && log.every(([, k]) => k !== RECENT_STYLES_KEY) && raw.get(RECENT_STYLES_KEY) === OLD && raw.size === 3, log);
  const before = log.length;
  const none = [accountRecentStorage(browser, null), accountRecentStorage(browser, undefined), accountRecentStorage(browser, '')];
  none.forEach((st) => writeRecent(st, ['pro-fantasy']));
  check('3: no userId gives [] and no write', none.every((st) => st === null && same(readRecent(st, ids), [])) && log.length === before && raw.size === 3);
  check('3: the form reads and writes Recent only through this account\'s storage',
    /accountRecentStorage\(window\.localStorage, userId\)/.test(form) && /readRecent\(recentStorage\(userId\), STYLE_IDS\)/.test(form)
    && (form.match(/recentStorage\(/g) ?? []).length === 3 && !/recentStorage\(\)/.test(form) && !/localStorage\.(get|set)Item\([^)]*recent/i.test(form));
}

// ── 4. stylePickerNav ──

{
  const walk = (count, columns, cases) => cases.every(([from, key, to]) => nextIndex(from, key, count, columns) === to);
  // 8 tiles, 4 columns: rows 0-3 and 4-7.
  check('4: 8 in 4: Left and Right move one, clamped at the ends', walk(8, 4, [[3, 'ArrowLeft', 2], [3, 'ArrowRight', 4], [0, 'ArrowLeft', 0], [7, 'ArrowRight', 7]]));
  check('4: 8 in 4: Up and Down move one row; first row Up and last row Down stay', walk(8, 4, [[5, 'ArrowUp', 1], [1, 'ArrowDown', 5], [2, 'ArrowUp', 2], [6, 'ArrowDown', 6]]));
  check('4: 8 in 4: Home and End', walk(8, 4, [[5, 'Home', 0], [2, 'End', 7], [0, 'Home', 0], [7, 'End', 7]]));
  // 6 tiles, 3 columns: rows 0-2 and 3-5.
  check('4: 6 in 3: Left and Right, clamped', walk(6, 3, [[2, 'ArrowRight', 3], [3, 'ArrowLeft', 2], [0, 'ArrowLeft', 0], [5, 'ArrowRight', 5]]));
  check('4: 6 in 3: Up and Down; the ends stay', walk(6, 3, [[4, 'ArrowUp', 1], [1, 'ArrowDown', 4], [0, 'ArrowUp', 0], [5, 'ArrowDown', 5]]));
  check('4: 6 in 3: Home and End', walk(6, 3, [[4, 'Home', 0], [1, 'End', 5]]));
  check('4: a short last row: Down from a column with nothing below goes to the last tile', walk(6, 4, [[3, 'ArrowDown', 5], [1, 'ArrowDown', 5], [4, 'ArrowDown', 4]]));
  check('4: other keys give null', ['Enter', ' ', 'Tab', 'a', 'PageDown'].every((k) => nextIndex(2, k, 8, 4) === null));
  check('4: no tiles gives null', nextIndex(0, 'ArrowRight', 0, 4) === null);
}

// ── 5. Wiring ──

{
  check('5: GenerationForm renders StyleField and StylePicker', /<StyleField\b/.test(form) && /<StylePicker\b/.test(form)
    && /import StyleField from '\.\/StyleField';/.test(form) && /import StylePicker from '\.\/StylePicker';/.test(form));
  check('5: the style card grid is gone (no GROUPED_STYLES, collapsedCategories, toggleCategory, TIER_COLORS, style count note)',
    !/GROUPED_STYLES|collapsedCategories|toggleCategory|TIER_COLORS|styles across/.test(form));
  check('5: every style change goes through chooseStyle (picker, Recent, lightbox); the one other follows the balance until the latch',
    /onChoose=\{chooseStyle\}/.test(form) && /onChooseRecent=\{chooseStyle\}/.test(form) && /chooseStyle\(lightboxStyle\.id\)/.test(form)
    && form.match(/setSelectedStyleId\(/g)?.length === 2
    && /formVisit\.rememberStyle\(userId, id\);\s*setSelectedStyleId\(id\);\s*setStyleAnnouncement\(/.test(form)
    && /useLayoutEffect\(\(\) => \{\s*if \(!serverBalanceKnown \|\| actedRef\.current\) return;\s*const id = openingStyle\(\{ balance: tokenBalance, currentId: selectedStyleId, acted: actedRef\.current \}\);\s*if \(id === selectedStyleId\) return;\s*formVisit\.rememberStyle\(userId, id\);\s*setSelectedStyleId\(id\);\s*\}, \[serverBalanceKnown, tokenBalance, selectedStyleId, userId\]\);/.test(form));
  {
    // Session 1's import sources, plus affordableStyle (which imports only the
    // registry and constants). No money path: debit, balance, Stripe, packs,
    // prices, admission or pause.
    const S1 = ['react', 'lucide-react', '@clerk/react', '@/stores/spriteStore', '@/components/ui/Button', '@/components/ui/PixelCoin',
      '@/components/sprites/ReferenceImagesPanel', '@/lib/styleRegistry', '@/lib/recentStyles', '@/lib/sseClient', '@/lib/generationPause',
      '@/hooks/useGenerationPoll', '@/lib/pollResume', '@/lib/jobResult', '@/lib/spriteUtils', './StyleExamplesLightbox', './StyleField', './StylePicker'];
    const sources = (text) => [...text.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);
    const added = sources(form).filter((src) => !S1.includes(src));
    const affordable = sources(stripComments(read('src/lib/affordableStyle.ts')));
    const visitSrc = stripComments(read('src/lib/createFormVisit.ts'));
    const MONEY = /token(Debit|Balance|Packs|TxMeta)|stripe|priceQuote|moneyAdmission|moneyPause|purchase/i;
    check('1e: GenerationForm imports nothing new but affordableStyle and createFormVisit (which imports nothing), and nothing new from a money path',
      same(added, ['@/lib/affordableStyle', '@/lib/createFormVisit']) && same(affordable.sort(), ['@/lib/constants', '@/lib/styleRegistry'])
      && !/\bimport\b|\brequire\(/.test(visitSrc)
      && [...added, ...affordable].every((src) => !MONEY.test(src)), { added, affordable });
  }
  check('5: chooseStyle updates Recent outside a state updater and announces the change',
    /const list = pushRecent\(recentIds, selectedStyleId, id\);\s*setRecentIds\(list\);\s*writeRecent\(recentStorage\(userId\), list\);/.test(form)
    && /setStyleAnnouncement\(`Style: \$\{next\.label\}, \$\{next\.tokenCost\} tokens`\)/.test(form) && /aria-live="polite"/.test(form));
  const noCoinEmoji = [form, field, picker].every((s) => !s.includes('\u{1FA99}')) && [formSrc, fieldSrc, pickerSrc].every((s) => !s.includes('\u{1FA99}'));
  check('5: no coin emoji in GenerationForm, StyleField or StylePicker', noCoinEmoji);
  check('5: PixelCoin is used in all three', [form, field, picker].every((s) => /import PixelCoin from '@\/components\/ui\/PixelCoin';/.test(s) && /<PixelCoin\b/.test(s)));
  check('5: the picker is a modal dialog named by its heading',
    /role="dialog"/.test(picker) && /aria-modal="true"/.test(picker) && /aria-labelledby=\{titleId\}/.test(picker) && /<h2 id=\{titleId\}/.test(picker));
  check('5: the picker has a radiogroup of radios with aria-checked', /role="radiogroup"/.test(picker) && /role="radio"/.test(picker) && /aria-checked=\{isPending\}/.test(picker));
  check('5: the picker has a tablist of tabs with aria-selected and aria-controls', /role="tablist"/.test(picker) && /role="tab"/.test(picker) && /aria-selected=\{selected\}/.test(picker) && /aria-controls=\{panelId\}/.test(picker) && /role="tabpanel"/.test(picker));
  check('5: Escape closes the picker', /if \(e\.key === 'Escape'\) \{[\s\S]{0,80}onClose\(\);/.test(picker));
  check('5: "Animated from text" names the animations category', /animations: 'Animated from text'/.test(picker));
  check('5: the picker renders into document.body above the bar (z-[60])', /createPortal\(<PickerDialog \{\.\.\.props\} \/>, document\.body\)/.test(picker) && /z-\[60\]/.test(picker));
  check('5: the prompt textarea is named by a label', /<label\s+htmlFor="create-prompt"/.test(form) && /<textarea\s+id="create-prompt"/.test(form));
  check('5: both empty-prompt reasons exist', form.includes("'Describe a character to start.'") && form.includes("'Describe what to generate to start.'"));
  check('5: the button\'s aria-describedby names the reason line',
    /aria-describedby=\{disabledReason \? reasonId : undefined\}/.test(form) && /<p id=\{reasonId\}/.test(form)
    && /const reasonId = GENERATION_PAUSED \? 'generate-paused-reason' : 'generate-reason';/.test(form));
  check('5: the not-enough reason links to Get tokens', /You need \{formatCount\(tokensNeeded\)\} more \{tokensWord\(tokensNeeded\)\} for this style\./.test(form) && /href="\/buy-tokens"[\s\S]{0,200}Get tokens/.test(form));
  check('5: generate/page.tsx has no EarlyAccessBanner', !/EarlyAccessBanner|EARLY_ACCESS_DISMISS_KEY/.test(page));
  check('5: LimitNoticeBanner writes its key when it shows',
    /if \(!dismissed\) \{\s*localStorage\.setItem\(LIMIT_NOTICE_DISMISS_KEY, '1'\);\s*setVisible\(true\);\s*\}/.test(page) && /<LimitNoticeBanner \/>/.test(page) && /<LowBalanceBanner \/>/.test(page));
  {
    // Session 3 (DESIGN room 2026-11-11-001): one example per style, made
    // with SpriteBrew, pinned by sha256. Animated styles have none.
    const EXAMPLE_SHA = {
      'plus-classic': 'eb03d259c69c9998b54f3944075998f563875d8c1a60c4228ec3ed71c80bb3f5',
      'pro-default': '735964ff00d371abbfcf33098494a0c59891a4ee95fad126819972fb0e9ebcff',
      'pro-fantasy': '75bd292534a7aa3dad648a2eb63b26f93f6fed6de6a2f33c54a0d829b4a11bd2',
      'pro-platformer': 'e1b713051a63cdfeca6bb20604b13bce4a4b5bc5403fd36db980e7ac54dead10',
      'pro-spritesheet': '9f11b813370a0d142dae52709abf843a9080d63ea02e834d093b0cf4e52adc9a',
      'pro-inventory': '78f8d76df8403c75f471396134fec45c14ab44fafc8c8daf60d99bbb494e2da6',
      'pro-fps-weapon': '87badc2ab00899a2cc14847a1193114e7864ccd94abbf0d5c6f24d0ae08d0150',
      'pro-hex-tiles': '5d0215fd24cb3adea3b72242a1af19225a68f5f750bb5ad9791a2b66c3a1cea3',
      'pro-typography': '334d70afbd139fbc35f5e74fc182fae7186b90c3e7cdd631106808e2107ca06b',
      'plus-low-res': 'dcd101d9c6981b01d2afc27810a6874d75cc73614fbf4b173476eefb86b79968',
      'plus-skill-icon': 'c2c2cb8a7bb45548358651dd65b0f80af15b599a6dd59eac1ad53fd9fd75e387',
      'plus-topdown-item': '5abcd2f9e102b90fc79002ba99609666ec01936772b6b892f58b3ff7f65c5857',
      'plus-mc-item': '920dbb69c9fb47f9a6c41f366ac3c276765989a778179563685c0996b6ab8365',
      'fast-retro': '5a9977d26a5aaf76a21b1af0455d43e8f4bfec96c6eed013e20edea35a8780f0',
      'fast-no-style': 'bdf7c1dbc0f0f647921b790fe2174f2de092d268b0e335eed8fdf7b042fe0e83',
    };
    const fileSha = (p) => {
      try { return createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'public', p))).digest('hex'); } catch { return null; }
    };
    const bad = Object.entries(EXAMPLE_SHA).filter(([id, sha]) => {
      const paths = getStyleById(id)?.examplePaths;
      return !same(paths, [`/style-examples/${id}-1.png`]) || fileSha(paths[0]) !== sha
        || !registrySrc.includes(`examplePaths: ['/style-examples/${id}-1.png'],`);
    }).map(([id]) => id);
    const animWithExamples = GENERATION_STYLES.filter((s) => s.isAnimation && s.examplePaths !== undefined).map((s) => s.id);
    const withExamples = GENERATION_STYLES.filter((s) => s.examplePaths !== undefined).map((s) => s.id).sort();
    check('5: every style\'s one example is ours (15 ids, <id>-1.png, sha256 pinned); no animated style has examplePaths',
      bad.length === 0 && animWithExamples.length === 0 && same(withExamples, Object.keys(EXAMPLE_SHA).sort()), { bad, animWithExamples });
  }
  const tiny = /text-\[(8|9|10|11)px\]/;
  const tinyIn = [['GenerationForm', formSrc], ['StyleField', fieldSrc], ['StylePicker', pickerSrc], ['ReferenceImagesPanel', panelSrc]].filter(([, s]) => tiny.test(s)).map(([n]) => n);
  check('5: no text-[8px], text-[9px], text-[10px] or text-[11px] in the form, field, picker or reference panel', tinyIn.length === 0, tinyIn);
  check('5: the size hint drops "Tokens scale with canvas size."', !/Tokens scale with canvas size/.test(form) && /Larger canvas = more room for detail and extended poses\./.test(form));
  check('5: Generate keeps its pulse but not under reduced motion', /'animate-pulse motion-reduce:animate-none'/.test(form));
  check('5: no em dashes in the files this change made', [fieldSrc, pickerSrc, read('src/components/ui/PixelCoin.tsx'), read('src/lib/recentStyles.ts'), read('src/lib/stylePickerNav.ts')].every((s) => !s.includes('\u2014')));
}

// ── 6. Fix round 1 ──

{
  const panel = stripComments(panelSrc);
  const emailPanel = stripComments(read('src/components/account/EmailListPanel.tsx'));

  // The latch (HQ -034, ENG -043 condition 1): set in the handler that acts.
  check('6: the latch is set in the prompt box\'s onChange, for a non-empty value only, before the prompt changes',
    /onChange=\{\(e\) => \{\s*if \(e\.target\.value\) markActed\(\);\s*setPrompt\(e\.target\.value\);\s*\}\}/.test(form));
  check('6: the latch is set in the example chips\' handler, before the prompt changes',
    /<ExampleChips\s+onPick=\{\(example\) => \{\s*markActed\(\);\s*setPrompt\(example\);\s*\}\}\s*\/>/.test(form));
  check('6: chooseStyle refuses a style Create does not offer, then sets the latch, before its return for the current style (the audit\'s uncaught mutation)',
    /const chooseStyle = useCallback\(\(id: string\) => \{\s*if \(!STYLE_IDS\.includes\(id\)\) return;\s*markActed\(\);\s*if \(id === selectedStyleId\) return;/.test(form));
  // Fix round 2 (audit N1, HQ -090 ruling 1): the size fields, the Background
  // switch and the reference images act too, in their handler, before the
  // state changes; nothing else in those handlers changed.
  check('6: the width and height fields set the latch in their onChange, before the size changes',
    /onChange=\{\(e\) => \{\s*markActed\(\);\s*setCustomWidth\(Math\.max\(selectedStyle\.minSize, Math\.min\(selectedStyle\.maxSize, Number\(e\.target\.value\)\)\)\);\s*\}\}/.test(form)
    && /onChange=\{\(e\) => \{\s*markActed\(\);\s*setCustomHeight\(Math\.max\(selectedStyle\.minSize, Math\.min\(selectedStyle\.maxSize, Number\(e\.target\.value\)\)\)\);\s*\}\}/.test(form));
  check('6: the Background switch sets the latch in its onClick, before it flips',
    /aria-labelledby=\{`\$\{bgLabelId\} \$\{bgValueId\}`\}\s*onClick=\{\(\) => \{\s*markActed\(\);\s*setRemoveBg\(\(v\) => !v\);\s*\}\}/.test(form));
  check('6: the reference images set the latch in their onChange, before the list changes',
    /<ReferenceImagesPanel\s+referenceImages=\{referenceImages\}\s+onChange=\{\(images\) => \{\s*markActed\(\);\s*setReferenceImages\(images\);\s*\}\}\s+enabled=\{referencesEnabled\}\s*\/>/.test(form));
  check('6: opening the picker is not an act', /onOpenPicker=\{\(\) => setPickerOpen\(true\)\}/.test(form));
  // Every effect at the component's top level, by its two-space indent.
  const effects = [...form.matchAll(/^ {2}use(?:Layout)?Effect\([\s\S]*?^ {2}\}?[^\n]*\);$/gm)].map((m) => m[0]);
  check('6: the latch is set by those seven calls only, through markActed, and in no effect',
    (form.match(/markActed\(\)/g) ?? []).length === 7 && (form.match(/actedRef\.current = /g) ?? []).length === 1
    && /const markActed = useCallback\(\(\) => \{\s*actedRef\.current = true;\s*formVisit\.rememberActed\(userId\);\s*\}, \[userId\]\);/.test(form)
    && effects.length >= 6 && effects.every((e) => !/markActed|actedRef\.current = |rememberActed/.test(e)), effects.length);
  check('6: the prompt changes in those two handlers only, so no render has a typed prompt without the latch',
    (form.match(/setPrompt\(/g) ?? []).length === 2);
  check('6: openingAppliedRef and pickedRef are gone', !/openingAppliedRef|pickedRef|picked:/.test(form));
  check('6: the form starts from the visit: the remembered style when known, else the default; the latch from the visit',
    /const \[visitAtMount\] = useState\(\(\) => formVisit\.read\(userId\)\);/.test(form)
    && /useState\(\(\) => \{\s*const id = visitAtMount\.styleId;\s*return id !== null && STYLE_IDS\.includes\(id\) \? id : DEFAULT_STYLE_ID;\s*\}\)/.test(form)
    && /const actedRef = useRef\(visitAtMount\.acted\);/.test(form) && !/useState\('plus-classic'\)/.test(form));

  // H (audit L2): confirming the current style is a pick.
  check('6: StylePicker\'s choose calls onChoose for every id, the current one too, then closes (the audit\'s uncaught mutation)',
    /const choose = \(id: string\) => \{\s*onChoose\(id\);\s*onClose\(\);\s*\};/.test(picker) && !/id !== currentStyleId/.test(picker));

  // K (audit L9): a click on the dialog's text keeps focus inside it.
  check('6: the picker dialog has tabIndex -1, and the Tab loop still skips the dialog itself',
    /role="dialog"\s*aria-modal="true"\s*aria-labelledby=\{titleId\}\s*tabIndex=\{-1\}\s*onKeyDown=\{onDialogKeyDown\}/.test(picker)
    && /dialogRef\.current\.querySelectorAll<HTMLElement>\('button, a\[href\], \[tabindex\]'\),?\s*\)\.filter\(\(el\) => el\.tabIndex >= 0 &&/.test(picker));

  // D (audit L4c): the plural, run from the form's own helper.
  const helper = formSrc.match(/^const tokensWord = .*;$/m)?.[0] ?? '';
  let tokensWord = () => 'missing';
  try {
    const { code } = await transform(`${helper}\nreturn tokensWord;`, { loader: 'ts' });
    tokensWord = new Function(code)();
  } catch { /* stays 'missing' */ }
  const reason = (n) => `You need ${n} more ${tokensWord(n)} for this style.`;
  const title = (n) => `Need ${n} more ${tokensWord(n)}`;
  check('6: the plural: "1 more token" and "Need 1 more token" at exactly 1, "tokens" at 2',
    reason(1) === 'You need 1 more token for this style.' && reason(2) === 'You need 2 more tokens for this style.'
    && title(1) === 'Need 1 more token' && title(2) === 'Need 2 more tokens'
    && form.includes('You need {formatCount(tokensNeeded)} more {tokensWord(tokensNeeded)} for this style.')
    && form.includes('`Need ${tokensNeeded} more ${tokensWord(tokensNeeded)}`') && !/more tokens for this style|more tokens`/.test(form));

  // F (DESIGN 010 item 3): the bar, rendered from the form's own JSX at both widths.
  const costStart = formSrc.indexOf('  const summaryCostText = ');
  const costEnd = formSrc.indexOf('  }`;\n', costStart);
  const titleSrc = costStart < 0 || costEnd < 0 ? '' : formSrc.slice(costStart, costEnd + 6);
  const jsxStart = formSrc.indexOf('  const summaryCost = (');
  const jsxEnd = formSrc.indexOf('\n  );\n', jsxStart);
  const costJsx = jsxStart < 0 || jsxEnd < 0 ? '' : formSrc.slice(jsxStart, jsxEnd + 5);
  const pStart = formSrc.indexOf('          <p\n            className="min-w-0 sm:min-w-[300px] sm:flex-1 truncate');
  const pEnd = formSrc.indexOf('          </p>\n', pStart);
  const barJsx = pStart < 0 || pEnd < 0 ? 'null' : formSrc.slice(pStart, pEnd + 14);
  let renderBar = null;
  try {
    const { code } = await transform(
      `export function bar({ userId, insufficientTokens, tokenCost, tokenBalance, selectedStyle, sizeLabel, isAdmin, formatCount, PixelCoin }) {\n${titleSrc}\n${costJsx}\nreturn (${barJsx});\n}`,
      { loader: 'tsx', jsx: 'automatic', format: 'esm' },
    );
    const file = path.join(OUT_DIR, 'bar.mjs');
    fs.writeFileSync(file, code);
    const { bar } = await import(pathToFileURL(file).href);
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const PixelCoin = () => createElement('i', null, '{coin}');
    renderBar = (balance, userId = 'user_a') => {
      const html = renderToStaticMarkup(bar({
        userId, insufficientTokens: balance < 16, tokenCost: 16, tokenBalance: balance,
        selectedStyle: { label: 'Classic Pixel Art', costPerGeneration: 0.06 }, sizeLabel: '192', isAdmin: false,
        formatCount: (n) => n.toLocaleString('en-US'), PixelCoin,
      }));
      const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&middot;|·/g, '·').replace(/&amp;/g, '&');
      // The span with this class, through its own closing tag.
      const span = (cls) => {
        const at = html.indexOf(`<span class="${cls}">`);
        if (at < 0) return '';
        const tags = /<(\/?)span\b[^>]*>/g;
        tags.lastIndex = at;
        let depth = 0;
        for (let m = tags.exec(html); m; m = tags.exec(html)) {
          depth += m[1] ? -1 : 1;
          if (depth === 0) return text(html.slice(at, m.index));
        }
        return '';
      };
      return { html, narrow: span('sm:hidden'), wide: span('max-sm:hidden inline-flex max-w-full items-center gap-[1ch] align-bottom'), title: (html.match(/title="([^"]*)"/)?.[1] ?? '').replace(/&#x27;/g, "'") };
    };
  } catch (e) { renderBar = null; console.log(String(e)); }
  const short = renderBar?.(8);
  const covered = renderBar?.(10021);
  const out = renderBar?.(8, null);
  check('6: the bar, short balance, under 640 px: "{coin} 16 tokens · you have 8 · Classic Pixel Art · 192 px"',
    short?.narrow === '{coin}16 tokens · you have 8 · Classic Pixel Art · 192 px', short?.narrow);
  check('6: the bar, short balance, from 640 px: "Classic Pixel Art · 192 px · {coin} 16 tokens · you have 8"',
    short?.wide === 'Classic Pixel Art · 192 px · {coin}16 tokens · you have 8', short?.wide);
  check('6: the bar, short balance: "you have 8" is the red part, and only it',
    (short?.html.match(/text-red-400/g) ?? []).length === 2 && (short?.html.match(/<span class="text-red-400">you have 8<\/span>/g) ?? []).length === 2);
  check('6: the bar, short balance: the title reads "Classic Pixel Art · 192 px · 16 tokens · you have 8"',
    short?.title === 'Classic Pixel Art · 192 px · 16 tokens · you have 8', short?.title);
  check('6: the bar, covered: "{coin} 16 of 10,021 tokens" at both widths and in the title, nothing red',
    covered?.narrow === '{coin}16 of 10,021 tokens · Classic Pixel Art · 192 px' && covered?.wide === 'Classic Pixel Art · 192 px · {coin}16 of 10,021 tokens'
    && covered?.title === 'Classic Pixel Art · 192 px · 16 of 10,021 tokens' && !covered?.html.includes('text-red-400'), covered && [covered.narrow, covered.wide, covered.title]);
  check('6: the bar, signed out: "{coin} 16 tokens", unchanged',
    out?.narrow === '{coin}16 tokens · Classic Pixel Art · 192 px' && out?.title === 'Classic Pixel Art · 192 px · 16 tokens' && !out?.html.includes('text-red-400'), out && [out.narrow, out.title]);

  // Fix round 2, D (audit N4), amended by fix round 3 (audit round 3, F1, and
  // the audit pass on fix 3, G4; HQ 2026-11-13-006, -012): from 640 px the wide
  // span's own children, from the rendered bar: the label gives way first, by
  // a ratio large enough that the size keeps its full width while the label
  // shows; then the size; the cost does not shrink.
  const wideChildren = (html) => {
    const cls = 'max-sm:hidden inline-flex max-w-full items-center gap-[1ch] align-bottom';
    const at = (html ?? '').indexOf(`<span class="${cls}">`);
    if (at < 0) return [];
    const tags = /<(\/?)span\b([^>]*)>/g;
    tags.lastIndex = at;
    const kids = [];
    let depth = 0;
    let open = null;
    for (let m = tags.exec(html); m; m = tags.exec(html)) {
      if (m[1]) {
        depth--;
        if (depth === 1 && open) { kids.push({ cls: open.cls, text: html.slice(open.at, m.index).replace(/<[^>]+>/g, '').replace(/&middot;|·/g, '·') }); open = null; }
        if (depth === 0) break;
      } else {
        if (depth === 1) open = { cls: m[2].match(/class="([^"]*)"/)?.[1] ?? '', at: tags.lastIndex };
        depth++;
      }
    }
    return kids;
  };
  const shortKids = wideChildren(short?.html);
  const coveredKids = wideChildren(covered?.html);
  const shrinks = (c) => /\b(min-w-0|truncate)\b/.test(c) || !/\bflex-shrink-0\b/.test(c);
  check('6: D: from 640 px the style\'s label gives way first (shrink 99999), then " · 192 px · " (shrink 1); the cost group sits in a part that does not shrink',
    [shortKids, coveredKids].every((k) => k.length === 3 && k[0].cls === 'min-w-0 shrink-[99999] truncate' && k[0].text === 'Classic Pixel Art'
      && k[1].cls === 'min-w-0 truncate' && k[1].text === '· 192 px ·' && k[2].cls === 'flex-shrink-0' && !shrinks(k[2].cls))
    && shortKids[2]?.text === '{coin}16 tokens · you have 8' && coveredKids[2]?.text === '{coin}16 of 10,021 tokens', { shortKids, coveredKids });

  // E (audit L13): both measures run once more when the web font is ready.
  const fontsReady = /let mounted = true;\s*if \('fonts' in document\) \{\s*void document\.fonts\.ready\.then\(\(\) => \{\s*if \(mounted\) measure\(\);\s*\}\);\s*\}\s*return \(\) => \{\s*mounted = false;/;
  const chipsAt = form.indexOf('function ExampleChips(');
  check('6: the chip row and the newsletter field measure again on document.fonts.ready, guarded for no document.fonts and an unmounted component',
    chipsAt > 0 && fontsReady.test(form.slice(chipsAt)) && fontsReady.test(emailPanel)
    && /const ro = new ResizeObserver\(measure\);\s*ro\.observe\(row\);/.test(form) && /const ro = new ResizeObserver\(measure\);\s*ro\.observe\(el\);/.test(emailPanel));

  // J (audit L8): Add and the drop zone by keyboard, run from the panel's own source.
  const fnSrc = (name) => {
    const at = panelSrc.indexOf(`  const ${name} = `);
    const end = at < 0 ? -1 : panelSrc.indexOf('\n  };\n', at);
    return at < 0 || end < 0 ? '' : panelSrc.slice(at, end + 5);
  };
  let zone = null;
  try {
    const { code } = await transform(`function make(enabled, fileInputRef) {\n${fnSrc('triggerFilePicker')}\n${fnSrc('onDropZoneKeyDown')}\nreturn { triggerFilePicker, onDropZoneKeyDown };\n}`, { loader: 'ts' });
    const make = new Function(`${code}\nreturn make;`)();
    zone = (enabled, key) => {
      let clicks = 0, prevented = 0;
      const z = make(enabled, { current: { click: () => { clicks++; } } });
      z.onDropZoneKeyDown({ key, preventDefault: () => { prevented++; } });
      return { clicks, prevented };
    };
  } catch { zone = null; }
  const enter = zone?.(true, 'Enter');
  const space = zone?.(true, ' ');
  const other = zone?.(true, 'a');
  const disabledEnter = zone?.(false, 'Enter');
  check('6: the drop zone: Enter and Space open the file picker, other keys do nothing, nothing while disabled',
    enter?.clicks === 1 && enter?.prevented === 1 && space?.clicks === 1 && space?.prevented === 1
    && other?.clicks === 0 && other?.prevented === 0 && disabledEnter?.clicks === 0, { enter, space, other, disabledEnter });
  check('6: the drop zone is a button with a tab stop while enabled, a focus ring and its visible text as its name',
    /<div\s+role="button"\s+tabIndex=\{enabled \? 0 : -1\}\s+onClick=\{triggerFilePicker\}\s+onKeyDown=\{onDropZoneKeyDown\}\s+onDragOver=\{onDragOver\}\s+onDragLeave=\{onDragLeave\}\s+onDrop=\{onDrop\}\s+aria-disabled=\{!enabled\}/.test(panel)
    && /focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber \$\{\s*!enabled/.test(panel)
    && !/role="button"[^>]*aria-label/.test(panel) && panel.includes('Add Images') && panel.includes('Drop images or click to browse'));
  const inputAt = panel.indexOf('<input\n');
  check('6: Add, collapsed and empty, opens the panel and the file picker in one press; the file input sits outside the panel',
    /onClick=\{\(\) => \{\s*if \(!expanded\) triggerFilePicker\(\);\s*setOpen\(\(v\) => !v\);\s*\}\}/.test(panel)
    && inputAt > 0 && inputAt < panel.indexOf('{expanded && (') && (panel.match(/type="file"/g) ?? []).length === 1);
}

// ── 7. Fix round 2, E: 8-Direction Rotation hidden from Create ──

{
  const allIds = GENERATION_STYLES.map((s) => s.id);
  const offeredIds = (OFFERED_STYLES ?? []).map((s) => s.id);
  check('7: the offered list has 20 styles and no anim-8dir; GENERATION_STYLES still has 21 in the same order',
    offeredIds.length === 20 && !offeredIds.includes('anim-8dir') && allIds.length === 21 && allIds[20] === 'anim-8dir'
    && same(offeredIds, allIds.filter((id) => id !== 'anim-8dir')), { offered: offeredIds.length, all: allIds.length });
  check('7: anim-8dir is the one hidden style, with its reason, and OFFERED_STYLES is GENERATION_STYLES without the hidden ones',
    same(GENERATION_STYLES.filter((s) => s.hidden).map((s) => s.id), ['anim-8dir']) && getStyleById('anim-8dir')?.hidden === true
    && registrySrc.includes('    // The upstream model fails every call for this style (HQ room 2026-11-11-076).\n    hidden: true,\n  },\n];')
    && (registrySrc.match(/hidden: true/g) ?? []).length === 1 && /\n {2}hidden\?: boolean;\n/.test(registrySrc)
    && /export const OFFERED_STYLES: GenerationStyle\[\] = GENERATION_STYLES\.filter\(\(s\) => !s\.hidden\);/.test(registrySrc));
  check('7: the picker groups offered styles only; the form\'s STYLE_IDS (Recent, the visit, chooseStyle) are the offered ids',
    /for \(const style of OFFERED_STYLES\) \{/.test(picker) && !/for \(const style of GENERATION_STYLES\)/.test(picker)
    && /^const STYLE_IDS = OFFERED_STYLES\.map\(\(s\) => s\.id\);$/m.test(form) && !/GENERATION_STYLES\.map\(/.test(form)
    && (form.match(/STYLE_IDS/g) ?? []).length === 4);
  check('7: every opening candidate (affordableStyle.ts) is an offered style',
    OPENING_CANDIDATES.length === 2 && OPENING_CANDIDATES.every((id) => offeredIds.includes(id)), OPENING_CANDIDATES);
  check('7: anim-8dir still answers every lookup and price as before: getStyleById, getTokenCost 50, getResolutionMode locked at 80, the pro free-tier bucket',
    getStyleById('anim-8dir')?.label === '8-Direction Rotation' && getStyleById('anim-8dir')?.promptStyle === 'animation__8_dir_rotation'
    && getTokenCost('animation__8_dir_rotation') === 50 && same(getResolutionMode('animation__8_dir_rotation'), { kind: 'locked', size: 80 })
    && getFreeTierBucket('animation__8_dir_rotation') === 'pro');
  const req = (width, height) => ({ prompt: 'a small knight', promptStyle: 'animation__8_dir_rotation', width, height, expectedTokenCost: 50 });
  check('7: createValidation (the real validateCreateBody) still accepts its 80 x 80 request and refuses 64 x 64 as before',
    validateCreateBody(req(80, 80)) === null && validateCreateBody(req(64, 64)) === 'This style is locked at 80x80. Got 64x64.',
    [validateCreateBody(req(80, 80)), validateCreateBody(req(64, 64))]);
}

if (failed > 0) {
  console.log(`\n${failed} of ${cases} failed`);
  process.exit(1);
}
console.log(`\nall pass (${cases} cases)`);
