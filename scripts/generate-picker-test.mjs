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
  entryPoints: ['src/lib/recentStyles.ts', 'src/lib/stylePickerNav.ts', 'src/lib/styleRegistry.ts'].map((p) => path.join(ROOT, p)),
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const load = (name) => import(pathToFileURL(path.join(OUT_DIR, `${name}.mjs`)).href);
const { RECENT_STYLES_KEY, MAX_RECENT, readRecent, pushRecent, writeRecent, visibleRecent } = await load('recentStyles');
const { nextIndex } = await load('stylePickerNav');
const { GENERATION_STYLES, getStyleById } = await load('styleRegistry');

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
  check('1d: the balance fetch is byte-identical to main', sha256(fetchPart ?? '') === '031e99d7234fa746b5d8fad330a4dfcea2b8e42b7600c466cdde3a82e631006a');
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
  check('5: every style change goes through chooseStyle (picker, Recent, lightbox)',
    /onChoose=\{chooseStyle\}/.test(form) && /onChooseRecent=\{chooseStyle\}/.test(form) && /chooseStyle\(lightboxStyle\.id\)/.test(form)
    && form.match(/setSelectedStyleId\(/g)?.length === 1);
  check('5: chooseStyle updates Recent outside a state updater and announces the change',
    /const list = pushRecent\(recentIds, selectedStyleId, id\);\s*setRecentIds\(list\);\s*writeRecent\(recentStorage\(\), list\);/.test(form)
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
  check('5: the not-enough reason links to Get tokens', /You need \{formatCount\(tokensNeeded\)\} more tokens for this style\./.test(form) && /href="\/buy-tokens"[\s\S]{0,200}Get tokens/.test(form));
  check('5: generate/page.tsx has no EarlyAccessBanner', !/EarlyAccessBanner|EARLY_ACCESS_DISMISS_KEY/.test(page));
  check('5: LimitNoticeBanner writes its key when it shows',
    /if \(!dismissed\) \{\s*localStorage\.setItem\(LIMIT_NOTICE_DISMISS_KEY, '1'\);\s*setVisible\(true\);\s*\}/.test(page) && /<LimitNoticeBanner \/>/.test(page) && /<LowBalanceBanner \/>/.test(page));
  check('5: Character (Pro) shows the cat first', getStyleById('pro-default')?.examplePaths?.[0] === '/style-examples/pro-default-5.png'
    && same(getStyleById('pro-default')?.examplePaths, [5, 1, 2, 3, 4].map((n) => `/style-examples/pro-default-${n}.png`))
    && registrySrc.includes("examplePaths: ['/style-examples/pro-default-5.png', '/style-examples/pro-default-1.png',"));
  const tiny = /text-\[(8|9|10|11)px\]/;
  const tinyIn = [['GenerationForm', formSrc], ['StyleField', fieldSrc], ['StylePicker', pickerSrc], ['ReferenceImagesPanel', panelSrc]].filter(([, s]) => tiny.test(s)).map(([n]) => n);
  check('5: no text-[8px], text-[9px], text-[10px] or text-[11px] in the form, field, picker or reference panel', tinyIn.length === 0, tinyIn);
  check('5: the size hint drops "Tokens scale with canvas size."', !/Tokens scale with canvas size/.test(form) && /Larger canvas = more room for detail and extended poses\./.test(form));
  check('5: Generate keeps its pulse but not under reduced motion', /'animate-pulse motion-reduce:animate-none'/.test(form));
  check('5: no em dashes in the files this change made', [fieldSrc, pickerSrc, read('src/components/ui/PixelCoin.tsx'), read('src/lib/recentStyles.ts'), read('src/lib/stylePickerNav.ts')].every((s) => !s.includes('\u2014')));
}

if (failed > 0) {
  console.log(`\n${failed} of ${cases} failed`);
  process.exit(1);
}
console.log(`\nall pass (${cases} cases)`);
