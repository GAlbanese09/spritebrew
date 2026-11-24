// scripts/generate-tabs-test.mjs
//
// Offline tests for the Generate page pass, ticket G1 (DESIGN,
// design/generate-pass/generate-pass.md sections 1, 3 and 6): three tabs,
// the guide, step badges, the bar's states, Animate from Text as its own
// form, tips by tab, and <main>'s scroll padding. Run from the repo root:
// `node scripts/generate-tabs-test.mjs`. The reload and resume cases are in
// scripts/poll-lifecycle-test.mjs (section g).
//
// 1. generateTabs.ts: the tabs, the five cards, which tab finishes a job,
//    step 1's words, the guide's rows and when it shows, the bar's rows, the
//    badges and the tips.
// 2. createBody.ts: for each of the five animation styles, Animate from
//    Text's body equals the body the Create form's own request block builds
//    for the same style and words (the block is read from GenerationForm.tsx
//    and run); and Animate from Text sends it as Create did.
// 3. Source pins: the page's tabs and guide, the forms' bars, the tips, the
//    scroll padding, and the imports added to the two frozen files.
//
// The harness writes only its esbuild bundle, to local/.generate-tabs-test
// (gitignored), and prints only case names and pass or fail.

import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.generate-tabs-test');
await build({
  entryPoints: {
    generateTabs: path.join(ROOT, 'src/lib/generateTabs.ts'),
    createBody: path.join(ROOT, 'src/lib/createBody.ts'),
    styleRegistry: path.join(ROOT, 'src/lib/styleRegistry.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const load = (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const T = await load('generateTabs');
const { createBody } = await load('createBody');
const { OFFERED_STYLES, getStyleById } = await load('styleRegistry');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. generateTabs.ts ──

check('1a: three tabs in order, with DESIGN\'s names', same(T.TAB_ORDER, ['create', 'text', 'animate'])
  && same(T.TAB_LABELS, { create: 'Create Sprite', text: 'Animate from Text', animate: 'Animate My Character' }));
check('1b: the line under the title', T.PAGE_LINE === 'Make a sprite from a description, animate one from a description, or bring your own character and animate it.');
const createIds = OFFERED_STYLES.filter((s) => !s.isAnimation).map((s) => s.id);
check('1c: Create Sprite offers the offered styles that are not animations (15)', same(T.CREATE_STYLE_IDS, createIds) && createIds.length === 15);
const animIds = OFFERED_STYLES.filter((s) => s.isAnimation).map((s) => s.id);
check('1d: the five cards are exactly the offered animation styles, 4-Angle Walking first and the default',
  same([...T.TEXT_ANIMATION_IDS].sort(), [...animIds].sort()) && T.TEXT_ANIMATION_IDS.length === 5
  && T.TEXT_ANIMATION_IDS[0] === 'anim-4angle-walking' && T.DEFAULT_TEXT_ANIMATION_ID === 'anim-4angle-walking');
check('1e: each card\'s line', same(T.TEXT_ANIMATIONS.map((a) => a.line), [
  'A walk in 4 directions, 16 frames.', 'A walk and an idle, side by side.', 'Several actions for one small character.',
  'A looping effect: fire, magic, explosions.', 'Describe any action. Costs more.']));
check('1f: which tab finishes a job: animate, a create job by its style, a create job without one',
  T.tabForJob('animate', null) === 'animate' && T.tabForJob('animate', 'anim-vfx') === 'animate'
  && animIds.every((id) => T.tabForJob('create', id) === 'text') && T.tabForJob('create', 'anim-8dir') === 'text'
  && createIds.every((id) => T.tabForJob('create', id) === 'create')
  && T.tabForJob('create', null) === 'create' && T.tabForJob('create', undefined) === 'create' && T.tabForJob('create', 'no-such-style') === 'create');
check('1g: step 1\'s words by card', same(T.textDescribeWords('anim-4angle-walking'), { label: 'Describe it', placeholder: 'a knight in silver armor with a red cape', hint: 'Step 1: describe your character.' })
  && same(T.textDescribeWords('anim-vfx'), { label: 'Describe the effect', placeholder: 'a blue fireball with sparks', hint: 'Step 1: describe the effect.' })
  && same(T.textDescribeWords('anim-any'), { label: 'Describe it and the action', placeholder: 'a knight swinging a sword overhead', hint: 'Step 1: describe your character.' }));
const from = T.fromCosts();
check('1h: the guide\'s costs come from the registry and the action list', from.create === Math.min(...createIds.map((id) => getStyleById(id).tokenCost))
  && from.text === Math.min(...animIds.map((id) => getStyleById(id).tokenCost)) && from.create === 5 && from.text === 25 && from.animate === 25, from);
check('1i: the guide\'s heading and rows', T.GUIDE_HEADING === 'New here? Start with one of these.' && same(T.guideRows(), [
  { tab: 'create', text: 'Create Sprite: a still character, item or icon from a description. From 5 tokens.' },
  { tab: 'text', text: 'Animate from Text: a moving sprite sheet from a description. From 25 tokens.' },
  { tab: 'animate', text: 'Animate My Character: bring your own picture and make it move. From 25 tokens.' },
]));
const G = (o) => T.guideShows({ signedIn: true, storageReadable: true, keySet: false, recentCount: 0, ...o });
check('1j: the guide shows only signed in, with storage readable, its key unset and Recent Generations empty',
  G({}) === true && G({ signedIn: false }) === false && G({ storageReadable: false }) === false && G({ keySet: true }) === false
  && G({ recentCount: 1 }) === false && G({ recentCount: null }) === false && T.GUIDE_KEY === 'spritebrew_generate_guide_v1');
const R = (o) => T.barRow({ generating: false, paused: false, guideShowing: false, requiredMissing: false, shortBy: 0, ...o });
check('1k: the bar\'s rows, the first that applies', R({}) === 'ready' && R({ shortBy: 3 }) === 'short' && R({ requiredMissing: true, shortBy: 3 }) === 'required'
  && R({ guideShowing: true, requiredMissing: true, shortBy: 3 }) === 'guide' && R({ paused: true, guideShowing: true }) === 'paused'
  && R({ generating: true, paused: true }) === 'generating' && T.GUIDE_HINT === 'Pick one to start.'
  && T.PAUSED_HINT === 'Generating is paused for now. Details are in the notice above.');
check('1l: badges: the first required step not done is next; a default is done; an optional step is never next; all plain while the guide shows',
  same(T.badgeStates([{ required: true, done: false }, { required: true, done: true }], false), ['next', 'done'])
  && same(T.badgeStates([{ required: true, done: true }, { required: true, done: true }], false), ['done', 'done'])
  && same(T.badgeStates([{ required: false, done: false }, { required: true, done: false }], false), ['plain', 'next'])
  && same(T.badgeStates([{ required: true, done: false }, { required: true, done: true }], true), ['plain', 'plain']));
const tc = T.tipsFor('create'), tt = T.tipsFor('text', 'anim-4angle-walking'), tany = T.tipsFor('text', 'anim-any'), ta = T.tipsFor('animate');
check('1m: tips by tab (2.6, 3, 4.6)', tc.lead === 'Your sprite will appear here' && tc.heading === 'Tips for good descriptions'
  && same(tc.tips, ['Say what it wears and holds.', 'Name the colors.', 'Keep it to one character.', 'Actions come later: use Send to Animator on your sprite.'])
  && tt.lead === 'Your animation will appear here'
  && same(tt.tips, ['Describe the character, not the motion: the card you pick is the motion.', 'One character per animation.', 'Want your own picture to move? Use Animate My Character.'])
  && tany.tips[0] === 'For Custom Animation, describe the character and what it does.' && same(tany.tips.slice(1), tt.tips.slice(1))
  && ta.lead === 'Your animation will appear here'
  && same(ta.tips, ['Pick the action first, then say how it moves: heavy steps, sneaking.', 'Direction comes from your picture. Walks face the way it does.']));
const tabsSrc = read('src/lib/generateTabs.ts');
const MONEY = /token(Debit|Balance|Packs|TxMeta)|stripe|priceQuote|moneyAdmission|moneyPause|purchase|ledger/i;
const sources = (text) => [...text.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);
check('1n: generateTabs.ts imports only the registry and the action list, no money path', same(sources(tabsSrc).sort(), ['./animateConfig', './styleRegistry'])
  && sources(read('src/lib/animateConfig.ts')).every((s) => !MONEY.test(s)));

// The gate, run (AUDIT g1-tabs-r1 M6): the cost shown is the cost sent; a
// short balance, a pause, an empty description or brewing each say no; the
// size sent is fixed for four cards and clamped for VFX.
{
  const base = { tokenBalance: 500, prompt: 'a knight', generating: false, paused: false, width: 64, height: 64 };
  const all = T.TEXT_ANIMATION_IDS.every((id) => {
    const g = T.textAnimationGate({ ...base, styleId: id });
    const sent = createBody({ prompt: 'a knight', style: g.style, width: g.width, height: g.height, removeBg: true, referenceImages: [] });
    return g.style.id === id && g.tokenCost === getStyleById(id).tokenCost && sent.expectedTokenCost === g.tokenCost && g.canGenerate === true && g.shortBy === 0;
  });
  check('1o: for each card the gate\'s cost is the card\'s, and the body sends that cost', all);
  const any = (o) => T.textAnimationGate({ ...base, styleId: 'anim-any', ...o });
  check('1p: short by the difference, and no Generate, at every balance under the cost; yes at the cost', any({ tokenBalance: 49 }).shortBy === 1 && any({ tokenBalance: 49 }).canGenerate === false
    && any({ tokenBalance: 0 }).shortBy === 50 && any({ tokenBalance: 50 }).canGenerate === true && any({ tokenBalance: 50 }).shortBy === 0);
  check('1q: a pause, an empty or blank description, or brewing: no Generate', !any({ paused: true }).canGenerate && !any({ prompt: '' }).canGenerate && !any({ prompt: '   ' }).canGenerate && !any({ generating: true }).canGenerate);
  const vfx = (w, h) => { const g = T.textAnimationGate({ ...base, styleId: 'anim-vfx', width: w, height: h }); return [g.width, g.height]; };
  check('1r: VFX sends its size clamped to 24 to 96; the other four send their fixed size whatever is typed', same(vfx(48, 96), [48, 96]) && same(vfx(4, 960), [24, 96]) && same(vfx(NaN, 50.4), [64, 50])
    && T.TEXT_ANIMATION_IDS.filter((id) => id !== 'anim-vfx').every((id) => { const g = T.textAnimationGate({ ...base, styleId: id, width: 13, height: 999 }); const s = getStyleById(id); return g.width === s.defaultWidth && g.height === s.defaultHeight; }));
  check('1s: an unknown card falls back to 4-Angle Walking and its cost', T.textAnimationGate({ ...base, styleId: 'pro-fantasy' }).style.id === 'anim-4angle-walking' && T.textAnimationGate({ ...base, styleId: 'pro-fantasy' }).tokenCost === 25);
  const N = (o) => T.earlyNoticeMayShow({ guideKnown: true, guideShowing: false, guideShownThisLoad: false, ...o });
  // The order of events in one load: unknown, the guide shows, it closes.
  const load = [N({ guideKnown: false }), N({ guideShowing: true, guideShownThisLoad: false }), N({ guideShowing: false, guideShownThisLoad: true })];
  check('1t: the early-user notice: not before the guide is known, not beside the guide, not after it closes in the same load; on a load with no guide, yes',
    same(load, [false, false, false]) && N({}) === true);
  check('1u: the dimmed Generate keeps a light label on a dark amber fill', same(T.DIMMED_GENERATE, { opacity: 1, backgroundColor: '#5a3d14', borderColor: '#5a3d14', color: '#f3e6d3' }));
}

// ── 2. createBody.ts against the Create form's own block ──

const formSrc = read('src/components/sprites/GenerationForm.tsx');
const start = formSrc.indexOf('      const body: Payload = {\n');
const endMark = '        body.referenceImages = referenceImages;\n      }\n';
const end = formSrc.indexOf(endMark, start);
let createBlock = null;
if (start >= 0 && end > start) {
  const block = formSrc.slice(start, end + endMark.length).replace('const body: Payload = {', 'const body = {');
  const { code } = await transform(`(capturedPrompt, selectedStyle, effectiveWidth, effectiveHeight, removeBg, referenceImages, referencesEnabled) => {\n${block}\nreturn body;\n}`, { loader: 'js' });
  createBlock = (0, eval)(code.trim().replace(/;$/, ''));
}
check('2a: the Create form\'s request block is found and runs', typeof createBlock === 'function');
for (const id of T.TEXT_ANIMATION_IDS) {
  const style = getStyleById(id);
  const cases = [
    { prompt: 'a knight in silver armor', w: style.defaultWidth, h: style.defaultHeight, bg: true },
    { prompt: 'a knight in silver armor', w: style.defaultWidth, h: style.defaultHeight, bg: false },
  ];
  if (!style.fixedSize) cases.push({ prompt: 'a blue fireball', w: 48, h: 96, bg: true });
  const ok = createBlock && cases.every((c) => {
    const fromCreate = createBlock(c.prompt, style, c.w, c.h, c.bg, [], style.supportsReferenceImages === true);
    const fromText = createBody({ prompt: c.prompt, style, width: c.w, height: c.h, removeBg: c.bg, referenceImages: [] });
    return JSON.stringify(fromCreate) === JSON.stringify(fromText);
  });
  check(`2b: ${id}: Animate from Text's body equals Create's for the same style and words, key order included`, !!ok);
}
check('2c: Custom Animation\'s body carries expectedTokenCost 50', createBody({ prompt: 'x', style: getStyleById('anim-any'), width: 64, height: 64, removeBg: true, referenceImages: [] }).expectedTokenCost === 50);
{
  const pro = getStyleById('pro-fantasy');
  const refs = ['data:image/png;base64,AAAA'];
  check('2d: createBody also matches Create on a style with reference images', !!createBlock
    && JSON.stringify(createBlock('k', pro, 256, 256, true, refs, true)) === JSON.stringify(createBody({ prompt: 'k', style: pro, width: 256, height: 256, removeBg: true, referenceImages: refs })));
}
const text = read('src/components/sprites/TextAnimationForm.tsx');
check('2e: Animate from Text sends createBody with no reference images, adds a fresh idempotency key, and polls it as a create job with its style',
  /const body: Payload = createBody\(\{\s*prompt: capturedPrompt,\s*style,\s*width: effectiveWidth,\s*height: effectiveHeight,\s*removeBg,\s*referenceImages: \[\],\s*\}\);\s*const idempotencyKey = crypto\.randomUUID\(\);\s*body\.idempotencyKey = idempotencyKey;/.test(text)
  && /poll\.startPolling\(result\.jobId, idempotencyKey, 'create', \{ prompt: capturedPrompt, styleId: capturedStyleId \}\);/.test(text));
check('2f: one request for a double press, nothing sent while paused, with an empty description, while brewing or with a short balance',
  /if \(GENERATION_PAUSED \|\| !prompt\.trim\(\) \|\| isGenerating\) return;\s*\/\/[^\n]*\n\s*if \(!canGenerate\) return;\s*\/\/[^\n]*\n\s*const now = Date\.now\(\);\s*if \(now - lastGenerateAtRef\.current < 1_000\) return;/.test(text)
  && /disabled=\{!canGenerate\}/.test(text)
  && /const gate = textAnimationGate\(\{\s*styleId, tokenBalance, prompt, generating: isGenerating, paused: GENERATION_PAUSED, width: customWidth, height: customHeight,\s*\}\);\s*const \{ style, tokenCost, shortBy: tokensNeeded, canGenerate \} = gate;/.test(text)
  && /const effectiveWidth = gate\.width;\s*const effectiveHeight = gate\.height;/.test(text));
check('2g: a refused request (money_paused, submission_failed) shows the server\'s words, as on Create',
  /if \(errObj\.error === 'submission_failed' \|\| errObj\.error === 'money_paused'\) \{[\s\S]{0,120}setGenerationError\(msg\);/.test(text));

// ── 3. Source pins ──

const page = read('src/app/generate/page.tsx');
check('3a: the page renders the line, a tablist of three tabs with roving focus, and a tab panel',
  page.includes('{PAGE_LINE}') && /role="tablist"/.test(page) && /role="tab"/.test(page) && /aria-selected=\{selected\}/.test(page)
  && /tabIndex=\{selected \? 0 : -1\}/.test(page) && /role="tabpanel"/.test(page) && /TAB_ORDER\.map\(/.test(page));
check('3b: manual activation: the arrow keys only move the focus; a click chooses, and choosing never moves the focus into the form',
  /tabRefs\.current\[TAB_ORDER\[next\]\]\?\.focus\(\);/.test(page) && !/onTabKey[\s\S]{0,700}handleTabChange/.test(page.slice(page.indexOf('const onTabKey'), page.indexOf('const onTabKey') + 700))
  && /onClick=\{\(\) => handleTabChange\(t\)\}/.test(page));
check('3c: under 1024 px the tabs are a 3-column grid, icon over label, 44 px tall',
  /className="grid grid-cols-3 gap-1 rounded-lg bg-bg-secondary p-1 lg:flex lg:w-fit"/.test(page) && /flex flex-col items-center justify-center gap-1 min-h-11/.test(page));
check('3d: every tab press shows that tab\'s form, after a result too', /pickTab\(newTab\);\s*setAnimateMode\(newTab === 'animate' \? 'animate' : 'create'\);\s*setShowForm\(true\);/.test(page));
check('3e: the guide: closing writes its key and moves the focus to the chosen tab; the early-user notice is mounted only as earlyNoticeMayShow says, with this load\'s guide flag',
  /localStorage\.setItem\(GUIDE_KEY, '1'\)/.test(page) && /tabRefs\.current\[focusTab\]\?\.focus\(\);/.test(page)
  && /\{earlyNoticeMayShow\(\{ guideKnown: guide !== null && guide\.userId === userId, guideShowing, guideShownThisLoad: guideLoad\.shown \}\) && <LimitNoticeBanner \/>\}/.test(page)
  && /if \(guideShowing\) guideLoad\.shown = true;/.test(page) && /^const guideLoad = \{ shown: false \};$/m.test(page)
  && /\{guideShowing && <FirstVisitGuide onChoose=\{chooseFromGuide\} onClose=\{dismissGuide\} \/>\}/.test(page)
  && /aria-label="Close the guide"/.test(page) && page.indexOf('aria-label="Close the guide"') < page.indexOf('{guideRows().map(') && page.includes('Got it'));
check('3f: each tab its own form; the forms and the result card are told the tab and the guide',
  /tab === 'create' \? \(\s*<GenerationForm onGenerated=\{handleGenerated\} guideShowing=\{guideShowing\} \/>\s*\) : tab === 'text' \? \(\s*<TextAnimationForm/.test(page)
  && /<GenerationResult onReset=\{handleReset\} tab=\{tab\} textStyleId=\{textStyleId\} \/>/.test(page));
const form = formSrc;
// G2 inserts "What's it for?" as step 2 and renumbers (generate-pass.md 2, 7).
check('3g: Create Sprite: step badges 1, 2 (What\'s it for?) and 3 (Style), the bar\'s hint by its row, "Step 4: Generate." when ready',
  /<StepBadge n=\{1\} state=\{describeBadge\} \/>/.test(form) && /badge=\{forBadge\}/.test(form) && /step=\{\{ n: 3, state: styleBadge \}\}/.test(form)
  && form.includes("disabledReason = 'Step 1: describe your sprite.';") && form.includes("disabledReason = 'Step 4: Generate.';") && form.includes('disabledReason = GUIDE_HINT;'));
check('3g2: Create Sprite\'s button reads "Generate sprite" with its cost, and "tokens" for screen readers (2.7; DESIGN -072)',
  /Generate sprite\s*<span className="inline-flex items-center gap-1\.5 tabular-nums">\s*&middot; <PixelCoin \/> \{formatCount\(tokenCost\)\}\s*<span className="sr-only"> tokens<\/span>/.test(form));
check('3h: Animate from Text: badges 1 and 2, its hints, "Generate animation" with the cost and "tokens" for screen readers',
  /<StepBadge n=\{1\} state=\{describeBadge\} \/>/.test(text) && /<StepBadge n=\{2\} state=\{pickBadge\} \/>/.test(text) && text.includes('hint = words.hint;')
  && text.includes('for this animation.') && text.includes("hint = 'Step 3: Generate.';") && /Generate animation\s*<span className="inline-flex items-center gap-1\.5 tabular-nums">\s*&middot; <PixelCoin \/> \{formatCount\(tokenCost\)\}\s*<span className="sr-only"> tokens<\/span>/.test(text));
check('3i: the cards are one radio group: arrow keys move and choose; each card is at least 44 px',
  /role="radiogroup"/.test(text) && /role="radio"/.test(text) && /aria-checked=\{chosen\}/.test(text) && /onStyleChange\(TEXT_ANIMATIONS\[next\]\.id\);\s*cardRefs\.current\[next\]\?\.focus\(\);/.test(text) && /min-h-11 rounded-xl border/.test(text));
const badge = read('src/components/sprites/StepBadge.tsx');
check('3j: the badge: 22 px, hidden from screen readers; "Step n:" read from the label', /aria-hidden="true"/.test(badge) && /w-\[22px\] h-\[22px\]/.test(badge) && /<span className="sr-only">Step \{n\}: <\/span>/.test(badge));
const result = read('src/components/sprites/GenerationResult.tsx');
const tipsBlock = result.slice(result.indexOf('const tips = tipsFor(tab, textStyleId);'), result.indexOf('{/* History */}'));
check('3k: the empty result card reads its lead and tips from the tab, at 12 px or more', tipsBlock.length > 0 && tipsBlock.includes('{tips.lead}') && !/text-\[(9|10|11)px\]/.test(tipsBlock));
const shell = read('src/components/layout/AppShell.tsx');
check('3l: on /generate, <main> keeps a bottom scroll padding 8 px taller than the bar',
  /const barHeight = useGenerateBarHeight\(pathname === '\/generate'\);/.test(shell) && /scrollPaddingBottom: barHeight \+ GENERATE_BAR_GAP_PX/.test(shell));
const picker = read('src/components/sprites/StylePicker.tsx');
check('3m: Create Sprite\'s picker has no "Animated from text" group', /for \(const style of OFFERED_STYLES\.filter\(\(s\) => !s\.isAnimation\)\)/.test(picker));
const pollSrc = read('src/hooks/useGenerationPoll.ts');
check('3o: the poll\'s not-found line says HQ\'s words for an unknown end (HQ 2026-11-18-064), and no longer promises the tokens back',
  pollSrc.includes("'We could not find this generation anymore. If it finished, it is in your gallery. If your balance looks wrong after a day, contact support.'")
  && !pollSrc.includes('If it failed, your tokens come back automatically.'));
check('3p: the dimmed Generate on both bars: inline, so the fill dims and the label stays (M4)',
  form.includes('style={!GENERATION_PAUSED && !isGenerating && prompt.trim() && !insufficientTokens ? undefined : DIMMED_GENERATE}') && text.includes('style={canGenerate ? undefined : DIMMED_GENERATE}'));
check('3q: real room at the end of <main> as tall as the bar, while it shows (M3)', /\{barHeight !== null && <div aria-hidden="true" data-bar-room="" style=\{\{ height: barHeight \}\} \/>\}/.test(shell));
check('3r: the card\'s cost wraps under its name where the card is narrow (M5)', /<span className="flex flex-wrap items-baseline justify-between gap-x-2">/.test(text));
check('3s: Animate from Text words a provider failure as the other forms do, in its own kind (M2)',
  text.includes('const isUpstreamError = isUpstreamFailure(rawMessage, poll.error?.errorCode);') && text.includes("? providerFailureMessage('text-animation', refundedNote, poll.error?.errorCode)") && !text.includes('upstreamFailureMessage('));
check('3t: the chosen card is kept for its account; a card change keeps Background and the VFX size; VFX\'s size clamps on leaving the field (L2, L8, L4)',
  /const textStyleId = textCard\.account === userId \? textCard\.id : DEFAULT_TEXT_ANIMATION_ID;/.test(page) && !text.includes('sizedFor') && /onBlur=\{\(\) => setCustomWidth\(effectiveWidth\)\}/.test(text) && /onBlur=\{\(\) => setCustomHeight\(effectiveHeight\)\}/.test(text));
check('3u: placeholders at 4.5 to 1 and the Dismiss at 44 px by touch on Animate from Text (L9)', text.includes('placeholder:text-text-secondary') && !text.includes('placeholder:text-text-muted') && /pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:-m-3 text-red-400/.test(text));
check('3v: the page does not wire the text-animation request; G4 does, with its button (L14)', !page.includes('textAnimationRequest'));
check('3w: the guide also closes at the first input in a form and at a press of Generate, and then the focus stays put (DESIGN -097, L5)',
  /onInputCapture=\{closeGuideOnInput\}/.test(page) && /if \(\(e\.target as Element\)\.closest\('button, a, \[role=radio\], \[role=switch\], input'\)\) closeGuideOnInput\(\);/.test(page)
  && /if \(guideShowing\) closeGuide\(null\);/.test(page) && /if \(focusTab\) tabRefs\.current\[focusTab\]\?\.focus\(\);/.test(page));
check('3x: below 1100 px Animate from Text\'s bar stacks as on a phone; from 1100 px one row (DESIGN -097, L7)',
  text.includes('<div className="flex flex-col min-[1100px]:flex-row min-[1100px]:items-center min-[1100px]:justify-between gap-2 min-[1100px]:gap-3">')
  && text.includes('className={`w-full min-[1100px]:w-auto whitespace-nowrap') && !/\b(sm|lg):(flex-row|w-auto)\b/.test(text.slice(text.indexOf('data-generate-bar'))));
{
  const re = new RegExp(text.match(/const SHORT_FOR_ANIMATION = \/(.+)\/;/)?.[1] ?? 'x^');
  check('3y: a 402 on Animate from Text says the bar\'s row 7 words, "for this animation", and the box adds Get tokens (DESIGN -097, L10)',
    text.includes('setGenerationError(`You need ${formatCount(more)} more ${tokensWord(more)} for this animation.`);') && text.includes('const more = Math.max(1, errObj.required - errObj.balance);')
    && re.test('You need 20 more tokens for this animation.') && re.test('You need 1 more token for this animation.') && !re.test('You need 20 tokens for this style, but you have 30.')
    && /SHORT_FOR_ANIMATION\.test\(generationError\) \? \(\s*<>\s*\{generationError\}\{' '\}\s*<a href="\/buy-tokens"[^>]*>Get tokens<\/a>/.test(text));
}
const DASH = String.fromCharCode(0x2014);
check('3o: VFX Effects\' two tips (DESIGN -098, HQ -102; AUDIT g2-page-r1 L8); every other text style keeps its own',
  same(T.tipsFor('text', 'anim-vfx').tips, ['Describe the effect: its colors, its shape and how it moves.', 'One effect per animation.', 'Want your own picture to move? Use Animate My Character.'])
  && same(T.tipsFor('text', 'anim-any').tips.slice(0, 2), ['For Custom Animation, describe the character and what it does.', 'One character per animation.'])
  && same(T.tipsFor('text', null).tips.slice(0, 2), ['Describe the character, not the motion: the card you pick is the motion.', 'One character per animation.']));
check('3n: no em dash in the new files', ['src/lib/generateTabs.ts', 'src/lib/createBody.ts', 'src/components/sprites/TextAnimationForm.tsx', 'src/components/sprites/StepBadge.tsx',
  'src/components/layout/useGenerateBarHeight.ts', 'scripts/generate-tabs-test.mjs'].every((f) => !read(f).includes(DASH)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
