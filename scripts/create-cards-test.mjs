// scripts/create-cards-test.mjs
//
// G2, Create Sprite's "What's it for?" (DESIGN, design/generate-pass/
// generate-pass.md 2.1 to 2.5, approved by HQ in room 2026-11-18-079):
// src/lib/createCards.ts and its wiring in GenerationForm.tsx.
//
// Open core (HQ 2026-11-18-049, -056): the page holds ids and the words people
// read; the words a card adds to the description live in the private
// generation service. This test checks the ids, the page's rules and the
// request the page sends. Its "Adds" text is a made-up placeholder.
//
// 1. The cards, rows and page words.
// 2. Which styles the cards apply to; Waist up on Character (Pro) only.
// 3. The ids a press sends (specFor), and "Changed in fine-tune below."
// 4. The "Adds" lookup's answer, the line, and what is sent with it.
// 5. The body sent: the Create form's own block, then withCreateSpec, for
//    every Create style; REV-L1: createBody equals that block for every
//    offered style, with and without background and reference images.
// 6. The side-view line and its offers; the Fast three-quarter note.
// 7. Wiring in GenerationForm.tsx and WhatsItFor.tsx.
// 8. With ENG's PR #81 merged: its id lists are the page's.
//
// Run from the repo root: `node scripts/create-cards-test.mjs`.

import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.create-cards-test');
const entries = {
  createCards: path.join(ROOT, 'src/lib/createCards.ts'),
  createBody: path.join(ROOT, 'src/lib/createBody.ts'),
  createFormVisit: path.join(ROOT, 'src/lib/createFormVisit.ts'),
  styleRegistry: path.join(ROOT, 'src/lib/styleRegistry.ts'),
};
const ENG_WORDS = path.join(ROOT, 'src/lib/createWords.ts');
if (fs.existsSync(ENG_WORDS)) entries.createWords = ENG_WORDS;
await build({
  entryPoints: entries,
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
});
const load = (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const C = await load('createCards');
const { createBody } = await load('createBody');
const { createFormVisit } = await load('createFormVisit');
const { OFFERED_STYLES, getStyleById } = await load('styleRegistry');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const S = (id) => getStyleById(id);
const createStyles = OFFERED_STYLES.filter((s) => !s.isAnimation);

// ── 1. The cards, rows and page words ──

check('1a: four cards in the grid\'s order, with DESIGN\'s names and lines (2.2, G5)', same(C.CREATE_CARDS, [
  { id: 'platformer', name: 'Side-scroller or platformer', line: 'Side view, facing right, full body. Made for animating.' },
  { id: 'topdown', name: 'Top-down RPG', line: 'Front view, full body, the way top-down RPGs draw characters.' },
  { id: 'portrait', name: 'Portrait or icon', line: 'Front view, head and shoulders.' },
  { id: 'raw', name: 'Just a sprite', line: 'Your words, nothing added.' },
]) && C.DEFAULT_CARD === 'platformer' && same(C.DEFAULT_CHOICE, { card: 'platformer', view: 'side', framing: 'full' }));
check('1b: the rows\' chips and labels (2.3, G5: "From above")', same(C.CREATE_VIEWS.map((v) => [v.id, v.label]),
  [['front', 'Front'], ['side', 'Side'], ['three_quarter', 'Three-quarter'], ['back', 'Back'], ['topdown', 'From above']])
  && same(C.CREATE_FRAMINGS.map((f) => [f.id, f.label]), [['full', 'Full body'], ['waist', 'Waist up'], ['head', 'Head only']]));
check('1c: each card\'s own rows: Side-scroller Side and Full body, Top-down From above and Full body, Portrait Front and Head only',
  same(C.CARD_ROWS, { platformer: { view: 'side', framing: 'full' }, topdown: { view: 'topdown', framing: 'full' }, portrait: { view: 'front', framing: 'head' } })
  && same(C.cardChoice('raw'), { card: 'raw', view: null, framing: null }));
check('1d: the page words, exactly', C.DESCRIBE_PLACEHOLDER === 'a knight in silver armor with a red cape'
  && C.GREYED_CARDS_LINE === 'This style draws as it is. Nothing is added.'
  && C.UNDER_CARDS_LINE === 'Making an item, tile or icon? Pick its style in step 3.'
  && C.CHANGED_LINE === 'Changed in fine-tune below.' && C.FINE_TUNE_LINK === 'Fine-tune view and framing'
  && C.RAW_ROWS_LINE === 'Pick another card to fine-tune.'
  && C.WAIST_LINE === 'Waist up works on Character (Pro). This style draws the full body.'
  && C.FAST_THREE_QUARTER_LINE === 'Fast styles often miss three-quarter views.'
  && C.ADDS_NOTHING_RAW === 'Adds nothing. Your words go as you wrote them.' && C.ADDS_NOTHING_STYLE === 'Adds nothing for this style.'
  && C.MORE_SETTINGS_LABEL === 'More settings: size, background, reference images'
  && C.FINE_TUNE_OPEN_KEY === 'spritebrew_create_finetune_open_v1' && C.MORE_OPEN_KEY === 'spritebrew_create_more_open_v1');
{
  const all = [C.DESCRIBE_PLACEHOLDER, C.GREYED_CARDS_LINE, C.UNDER_CARDS_LINE, C.CHANGED_LINE, C.FINE_TUNE_LINK, C.RAW_ROWS_LINE, C.WAIST_LINE,
    C.FAST_THREE_QUARTER_LINE, C.ADDS_NOTHING_RAW, C.ADDS_NOTHING_STYLE, C.MORE_SETTINGS_LABEL, ...C.CREATE_CARDS.flatMap((c) => [c.name, c.line])];
  check('1e: no em dash in any page word', all.every((w) => !w.includes('\u2014')));
}

// ── 2. Which styles; Waist up ──

const applying = createStyles.filter((s) => C.cardsApply(s)).map((s) => s.id);
check('2a: the cards apply to the character styles but Sprite Collection, and to no other style',
  same(applying, createStyles.filter((s) => s.category === 'characters' && s.id !== 'pro-spritesheet').map((s) => s.id))
  && applying.length === 7 && !C.cardsApply(S('pro-spritesheet')) && !C.cardsApply(S('plus-skill-icon')) && !C.cardsApply(S('plus-mc-item'))
  && OFFERED_STYLES.filter((s) => s.isAnimation).every((s) => !C.cardsApply(s)), applying);
check('2b: Waist up is live on Character (Pro) only', createStyles.filter((s) => C.waistAllowed(s.id)).map((s) => s.id).join() === 'pro-default');
{
  const onPro = C.pickFraming(C.cardChoice('platformer'), 'waist', 'pro-default');
  const onClassic = C.pickFraming(C.cardChoice('platformer'), 'waist', 'plus-classic');
  check('2c: Waist up is picked on Character (Pro) and refused elsewhere; under "Just a sprite" no row is picked',
    onPro.framing === 'waist' && same(onClassic, C.cardChoice('platformer'))
    && same(C.pickView(C.cardChoice('raw'), 'front'), C.cardChoice('raw')) && same(C.pickFraming(C.cardChoice('raw'), 'full', 'pro-default'), C.cardChoice('raw')));
  check('2d: Waist up chosen on Character (Pro), then another style: the row shows the card\'s own framing, and nothing is sent for it',
    same(C.effectiveRows(onPro, 'plus-classic'), { view: 'side', framing: 'full' }) && C.specFor(onPro, S('plus-classic')).framing === null
    && C.specFor(onPro, S('pro-default')).framing === 'waist');
  check('2e: choosing a card resets both rows to its values', same(C.cardChoice('portrait'), { card: 'portrait', view: 'front', framing: 'head' }));
}

// ── 3. The ids sent, and "Changed in fine-tune below." ──

{
  const classic = S('plus-classic');
  check('3a: each card as it is sends its id and no row', ['platformer', 'topdown', 'portrait'].every((card) =>
    same(C.specFor(C.cardChoice(card), classic), { card, view: null, framing: null })));
  check('3b: "Just a sprite" and a style the cards do not apply to send no ids',
    C.specFor(C.cardChoice('raw'), classic) === null && C.specFor(C.DEFAULT_CHOICE, S('plus-skill-icon')) === null
    && C.specFor(C.DEFAULT_CHOICE, S('pro-spritesheet')) === null);
  const tq = C.pickView(C.DEFAULT_CHOICE, 'three_quarter');
  check('3c: a row that differs from the card\'s own is sent by its id; one picked back to the card\'s own is not',
    same(C.specFor(tq, classic), { card: 'platformer', view: 'three_quarter', framing: null })
    && same(C.specFor(C.pickView(tq, 'side'), classic), { card: 'platformer', view: null, framing: null })
    && same(C.specFor(C.pickFraming(C.cardChoice('topdown'), 'head', 'plus-classic'), classic), { card: 'topdown', view: null, framing: 'head' }));
  check('3d: every id sent is in the lists, and the spec has exactly card, view and framing', createStyles.every((st) =>
    C.CREATE_CARDS.every((card) => C.CREATE_VIEWS.every((v) => C.CREATE_FRAMINGS.every((f) => {
      const choice = C.pickFraming(C.pickView(C.cardChoice(card.id), v.id), f.id, st.id);
      const sp = C.specFor(choice, st);
      if (sp === null) return card.id === 'raw' || !C.cardsApply(st);
      return same(Object.keys(sp), ['card', 'view', 'framing']) && sp.card !== 'raw'
        && (sp.view === null || C.CREATE_VIEWS.some((x) => x.id === sp.view))
        && (sp.framing === null || C.CREATE_FRAMINGS.some((x) => x.id === sp.framing))
        && (sp.framing !== 'waist' || st.id === 'pro-default');
    })))));
  check('3e: "Changed in fine-tune below." while a row differs from the chosen card\'s own; never for "Just a sprite"',
    C.changedInFineTune(tq, 'plus-classic') && !C.changedInFineTune(C.DEFAULT_CHOICE, 'plus-classic')
    && !C.changedInFineTune(C.cardChoice('raw'), 'plus-classic')
    && !C.changedInFineTune(C.pickFraming(C.DEFAULT_CHOICE, 'waist', 'pro-default'), 'plus-classic')
    && C.changedInFineTune(C.pickFraming(C.DEFAULT_CHOICE, 'waist', 'pro-default'), 'pro-default'));
  check('3f: the lookup\'s key and query carry the style and the ids, an empty row for the card\'s own',
    C.wordsKey('rd_plus__classic', { card: 'platformer', view: null, framing: null }) === 'rd_plus__classic|platformer||'
    && C.wordsQuery('rd_plus__classic', { card: 'topdown', view: 'back', framing: null }) === '/api/create-words?style=rd_plus__classic&card=topdown&view=back&framing=');
}

// ── 4. The lookup's answer, the line, what is sent ──

{
  const R = C.readWordsAnswer;
  check('4a: a 200 with words and a version is ok; a 200 refusal with a version is refused; anything else is unavailable',
    same(R(200, { success: true, adds: 'stub words', version: 'v1' }), { state: 'ok', adds: 'stub words', version: 'v1' })
    && same(R(200, { success: false, reason: 'spec', version: 'v1' }), { state: 'refused', version: 'v1' })
    && [[503, { success: false, error: 'unavailable' }], [429, { success: false, error: 'rate_limited' }], [401, {}], [404, null], [400, { success: false }],
      [200, { success: true, adds: 'x' }], [200, { success: true, adds: 'x', version: '' }], [200, { success: true, version: 'v1' }], [200, 'x'], [200, null]]
      .every(([st, j]) => R(st, j).state === 'unavailable'));
  const ok = { state: 'ok', adds: 'stub-a, stub-b', version: 'v7' };
  check('4b: the "Adds" line: the service\'s words after "Adds: "; DESIGN\'s lines for "Just a sprite" and for other styles; nothing while a lookup is out or refused',
    C.addsLine(true, 'platformer', ok) === 'Adds: stub-a, stub-b' && C.addsLine(true, 'raw', { state: 'none' }) === C.ADDS_NOTHING_RAW
    && C.addsLine(false, 'platformer', { state: 'none' }) === C.ADDS_NOTHING_STYLE && C.addsLine(true, 'platformer', { state: 'loading' }) === ''
    && C.addsLine(true, 'platformer', { state: 'refused', version: 'v7' }) === '' && C.addsLine(true, 'platformer', { state: 'ok', adds: ' ', version: 'v7' }) === C.ADDS_NOTHING_STYLE);
  check('4c: no answer from the service: the line says nothing is added and no ids are sent (HQ -056 change 6); the cards grey only for a style they do not apply to (AUDIT g2-page-r1 M2)',
    C.addsLine(true, 'platformer', { state: 'unavailable' }) === C.ADDS_NOTHING_RAW
    && C.specToSend({ card: 'platformer', view: null, framing: null }, { state: 'unavailable' }) === null
    && C.cardsGreyed(false) && !C.cardsGreyed(true));
  check('4e: while a new choice\'s lookup is out, the last line stays, marked as checking; otherwise the line itself (M1)',
    same(C.shownAddsLine('', { state: 'loading' }, 'Adds: stub-old'), { text: 'Adds: stub-old', checking: true })
    && same(C.shownAddsLine('Adds: stub-new', ok, 'Adds: stub-old'), { text: 'Adds: stub-new', checking: false })
    && same(C.shownAddsLine('', { state: 'refused', version: 'v1' }, 'Adds: stub-old'), { text: '', checking: false })
    && same(C.shownAddsLine('', { state: 'loading' }, ''), { text: '', checking: false }));
  check('4f: what the result card reads after a Generate: the View\'s facing and the description; none and none for "Just a sprite" or a style the cards do not apply to (DESIGN -016)',
    same(C.lastCreateFor(S('pro-default'), C.DEFAULT_CHOICE, 'a knight'), { facing: 'right', subject: 'a knight' })
    && same(['front', 'side', 'three_quarter', 'back', 'topdown'].map((v) => C.lastCreateFor(S('pro-default'), C.pickView(C.cardChoice('portrait'), v), 'x').facing), ['front', 'right', 'three-quarter', null, 'top-down'])
    && same(C.lastCreateFor(S('pro-default'), C.cardChoice('topdown'), 'x'), { facing: 'top-down', subject: 'x' })
    && same(C.lastCreateFor(S('pro-default'), C.cardChoice('raw'), 'x'), { facing: null, subject: null })
    && createStyles.filter((st) => !C.cardsApply(st)).every((st) => same(C.lastCreateFor(st, C.DEFAULT_CHOICE, 'x'), { facing: null, subject: null })));
  const sp = { card: 'platformer', view: 'back', framing: null };
  check('4d: sent with the ids: the version the line showed; while a lookup is out, the ids alone; none without ids',
    same(C.specToSend(sp, ok), { spec: sp, version: 'v7' }) && same(C.specToSend(sp, { state: 'refused', version: 'v8' }), { spec: sp, version: 'v8' })
    && same(C.specToSend(sp, { state: 'loading' }), { spec: sp }) && C.specToSend(null, ok) === null && C.specToSend(sp, { state: 'none' }) === null);
}

// ── 5. The body sent ──

const formSrc = read('src/components/sprites/GenerationForm.tsx');
const start = formSrc.indexOf('      const body: Payload = {\n');
const endMark = '      body.idempotencyKey = idempotencyKey;\n';
const end = formSrc.indexOf(endMark, start);
let createBlock = null;
if (start >= 0 && end > start) {
  const block = formSrc.slice(start, end + endMark.length).replace('const body: Payload = {', 'const body = {');
  const { code } = await transform(`(capturedPrompt, selectedStyle, effectiveWidth, effectiveHeight, removeBg, referenceImages, referencesEnabled, crypto) => {\n${block}\nreturn body;\n}`, { loader: 'js' });
  createBlock = (0, eval)(code.trim().replace(/;$/, ''));
}
check('5a: the Create form\'s request block is found and runs', typeof createBlock === 'function');
const fakeCrypto = { randomUUID: () => 'key-1' };
{
  const sp = { card: 'topdown', view: null, framing: 'head' };
  const results = createStyles.flatMap((st) => [true, false].map((bg) => {
    const refs = st.supportsReferenceImages ? ['data:ref'] : [];
    const body = createBlock('a knight', st, st.defaultWidth, st.defaultHeight, bg, refs, st.supportsReferenceImages === true, fakeCrypto);
    const sent = C.withCreateSpec(body, { spec: sp, version: 'v7' });
    const { prompt, ...rest } = body;
    const want = { description: prompt, ...rest, promptSpec: sp, wordsVersion: 'v7' };
    return { id: st.id, ok: same(sent, want) && !('prompt' in sent) && Object.keys(sent)[0] === 'description'
      && C.withCreateSpec(body, null) === body && same(C.withCreateSpec(body, { spec: sp }), { description: prompt, ...rest, promptSpec: sp }) };
  }));
  const bad = results.filter((r) => !r.ok).map((r) => r.id);
  check('5b: for every Create style, with and without background: ids sent, the text goes as `description` in place of `prompt`, every other key and value is the block\'s own, the version only when given; without ids, the block\'s body itself',
    bad.length === 0 && results.length === createStyles.length * 2, bad);
  const sent = C.withCreateSpec({ prompt: 'x', promptStyle: 'rd_plus__classic' }, { spec: sp, version: 'v7' });
  check('5c: the ids are sent as ids only: three keys, each an id or null', same(Object.keys(sent.promptSpec), ['card', 'view', 'framing'])
    && sent.promptSpec !== sp && Object.values(sent.promptSpec).every((v) => v === null || /^[a-z_]+$/.test(v)));
}
{
  // REV-L1 (room 2026-11-18-010): createBody equals the Create form's block for
  // every offered style, background on and off, with reference images where
  // the style takes them and where it does not.
  const bad = OFFERED_STYLES.flatMap((st) => [true, false].flatMap((bg) => [[], ['data:ref']].map((refs) => {
    const fromForm = createBlock('a knight', st, st.defaultWidth, st.defaultHeight, bg, refs, st.supportsReferenceImages === true, fakeCrypto);
    delete fromForm.idempotencyKey;
    const fromBody = createBody({ prompt: 'a knight', style: st, width: st.defaultWidth, height: st.defaultHeight, removeBg: bg, referenceImages: refs });
    return same(fromForm, fromBody) ? null : `${st.id}/${bg}/${refs.length}`;
  }))).filter(Boolean);
  check('5d: REV-L1: createBody equals the Create form\'s block for every offered style (20), background on and off, with and without reference images', bad.length === 0 && OFFERED_STYLES.length === 20, bad);
}

// ── 6. The side-view line, the Fast note ──

{
  const side = C.DEFAULT_CHOICE;
  const lineOf = (id, choice = side) => C.sideViewLine(S(id), choice);
  check('6a: the three tested styles\' lines, word for word, and their offers (2.5; HQ -079)',
    same(lineOf('fast-retro'), { text: 'Retro Arcade faces right about 3 times in 4.', offers: [] })
    && same(lineOf('plus-classic'), { text: 'Classic Pixel Art faces right about half the time, often on a patch of ground. For a side view, Retro Arcade or Platformer keep it better.', offers: ['fast-retro', 'pro-platformer'] })
    && same(lineOf('pro-default'), { text: 'Character (Pro) faces right, usually in a three-quarter fighting stance. Platformer draws the calmest side view.', offers: ['pro-platformer'] }));
  check('6b: the line shows only while the card or the View row is Side: not for Platformer or an untested style, not for another view, not for "Just a sprite"',
    lineOf('pro-platformer') === null && lineOf('plus-low-res') === null && lineOf('fast-no-style') === null
    && lineOf('plus-classic', C.cardChoice('portrait')) === null && lineOf('plus-classic', C.cardChoice('raw')) === null
    && lineOf('plus-classic', C.pickView(C.cardChoice('topdown'), 'side')) !== null && lineOf('plus-skill-icon') === null);
  check('6c: the offers name offered styles whose costs are 5 and 40', S('fast-retro').tokenCost === 5 && S('pro-platformer').tokenCost === 40
    && ['fast-retro', 'pro-platformer'].every((id) => OFFERED_STYLES.some((s) => s.id === id)) && S('pro-platformer').label === 'Platformer' && S('fast-retro').label === 'Retro Arcade');
  const tq = C.pickView(side, 'three_quarter');
  check('6d: "Fast styles often miss three-quarter views." with a Fast style and Three-quarter only',
    C.fastThreeQuarter(S('fast-retro'), tq) && C.fastThreeQuarter(S('fast-no-style'), tq) && !C.fastThreeQuarter(S('plus-classic'), tq)
    && !C.fastThreeQuarter(S('fast-retro'), side) && !C.fastThreeQuarter(S('fast-retro'), C.cardChoice('raw')));
}

// ── 7. Wiring ──

{
  const v = createFormVisit();
  v.rememberChoice('user_a', { card: 'portrait', view: 'back', framing: 'head' });
  check('7a: the visit keeps the choice per account; another account, or none, reads none',
    same(v.read('user_a').choice, { card: 'portrait', view: 'back', framing: 'head' }) && v.read(null).choice === null
    && v.read('user_b').choice === null && v.read('user_a').choice === null);
  check('7b: a choice read back is checked: a bad one gives the default, a card without rows its own',
    same(C.validChoice(null), C.DEFAULT_CHOICE) && same(C.validChoice({ card: 'nope' }), C.DEFAULT_CHOICE)
    && same(C.validChoice({ card: 'topdown' }), C.cardChoice('topdown')) && same(C.validChoice({ card: 'raw', view: 'side' }), C.cardChoice('raw'))
    && same(C.validChoice({ card: 'portrait', view: 'back', framing: 'head' }), { card: 'portrait', view: 'back', framing: 'head' }));
  const form = formSrc;
  check('7c: the press sends the body through withCreateSpec, with the ids captured at the press',
    form.split('withCreateSpec(body, capturedSend)').length === 2 && /const capturedSend = toSend;/.test(form)
    && /const result = await fetchGeneration\(sent, sessionToken\);/.test(form) && !/fetchGeneration\(body, sessionToken\)/.test(form));
  check('7d: PR #81\'s three refusals are shown as the server words them, before any other error branch but the cap and the balance',
    /if \(errObj\.error === 'create_spec_refused' \|\| errObj\.error === 'create_words_unavailable' \|\| errObj\.error === 'create_words_changed'\) \{[\s\S]{0,500}?setGenerationError\(msg\);\s*return;/.test(form)
    && form.indexOf("'create_spec_refused'") < form.indexOf("errObj.error === 'submission_failed'"));
  check('7e: the "Adds" line sits under the description, polite to screen readers, one line\'s height kept, the last line held while a lookup is out (M1)',
    /<p data-adds-line="" aria-live="polite" aria-busy=\{addsShown\.checking \|\| undefined\}\s*className=\{`mt-2 min-h-\[18px\] text-xs font-mono text-accent-teal leading-normal transition-opacity \$\{addsShown\.checking \? 'opacity-60' : ''\}`\}>\s*\{addsShown\.text\}\s*<\/p>/.test(form)
    && /const \[heldAdds, setHeldAdds\] = useState\(adds\);\s*if \(adds !== '' && adds !== heldAdds\) setHeldAdds\(adds\);\s*const addsShown = shownAddsLine\(adds, words, heldAdds\);/.test(form)
    && form.indexOf('data-adds-line') > form.indexOf('id="create-prompt"') && form.indexOf('data-adds-line') < form.indexOf('<ExampleChips'));
  check('7f: the sections in order: Describe it, What\'s it for?, Style, More settings', form.indexOf('id="create-prompt"') < form.indexOf('<WhatsItFor')
    && form.indexOf('<WhatsItFor') < form.indexOf('<StyleField') && form.indexOf('<StyleField') < form.indexOf('{MORE_SETTINGS_LABEL}')
    && form.indexOf('{MORE_SETTINGS_LABEL}') < form.indexOf('<ReferenceImagesPanel') && form.indexOf('<ReferenceImagesPanel') < form.indexOf('aria-label="Size in pixels"'));
  check('7g: More settings is a button with aria-expanded, closed by default, kept per browser',
    /aria-expanded=\{moreOpen\}\s*aria-controls=\{moreOpen \? moreId : undefined\}/.test(form) && /useState\(\(\) => readOpen\(MORE_OPEN_KEY\)\)/.test(form)
    && /writeOpen\(MORE_OPEN_KEY, next\);/.test(form) && /\{moreOpen && \(/.test(form) && /window\.localStorage\.getItem\(key\) === '1'/.test(form));
  check('7h: the side-view line\'s offers go through chooseStyle, then the focus moves to the style chosen (L4), and only with the balance',
    /onClick=\{\(\) => \{\s*chooseStyle\(s\.id\);[\s\S]{0,200}?requestAnimationFrame\(\(\) => styleBoxRef\.current\?\.querySelector<HTMLElement>\('button\[aria-haspopup="dialog"\]'\)\?\.focus\(\)\);/.test(form)
    && /<div ref=\{styleBoxRef\}>\s*<StyleField/.test(form)
    && /serverBalanceKnown && tokenBalance >= s\.tokenCost/.test(form) && /Use \{s\.label\} &middot; <PixelCoin \/> \{formatCount\(s\.tokenCost\)\}\s*<span className="sr-only"> tokens<\/span>/.test(form));
  const wf = read('src/components/sprites/WhatsItFor.tsx');
  check('7i: the cards and both rows are radio groups; a greyed choice is aria-disabled and never chosen; arrows, Home and End move and choose',
    (wf.match(/<RadioGroup\b/g) ?? []).length === 3 && /role="radiogroup"/.test(wf) && /role: 'radio'/.test(wf)
    && /'aria-disabled': opt\.disabled \|\| undefined/.test(wf) && /if \(!opt\.disabled\) onPick\(opt\.id\);/.test(wf)
    && /if \(!options\[n\]\.disabled\) onPick\(options\[n\]\.id\);/.test(wf) && /k === 'Home'/.test(wf) && /k === 'End'/.test(wf)
    && /aria-expanded=\{fineTuneOpen\}/.test(wf) && /min-h-11/.test(wf) && /pointer-coarse:h-11/.test(wf));
  check('7k: an accepted Generate writes what the result card reads, from the choice at the press (G0 setLastCreate; DESIGN -016)',
    /const capturedLast = lastCreateFor\(selectedStyle, choice, capturedPrompt\);/.test(form)
    && /const result = await fetchGeneration\(sent, sessionToken\);\s*\/\/[^\n]*\n\s*setLastCreate\(capturedLast\.facing, capturedLast\.subject\);/.test(form)
    && form.split('setLastCreate(').length === 2);
  check('7j: no file of G2 builds or holds the words sent: the page sends ids and shows the service\'s words', !/promptBuilder/.test(form + wf)
    && !fs.existsSync(path.join(ROOT, 'src/lib/promptBuilder.ts')));
}

// ── 8. With ENG's PR #81 ──

if (entries.createWords) {
  const W = await load('createWords');
  check('8a: PR #81\'s id lists are the page\'s', same([...W.CREATE_CARDS], C.CREATE_CARDS.map((c) => c.id))
    && same([...W.CREATE_VIEWS], C.CREATE_VIEWS.map((v) => v.id)) && same([...W.CREATE_FRAMINGS], C.CREATE_FRAMINGS.map((f) => f.id)));
  check('8b: every spec the page sends passes PR #81\'s shape check', createStyles.every((st) => C.CREATE_CARDS.every((card) =>
    C.CREATE_VIEWS.every((v) => { const sp = C.specFor(C.pickView(C.cardChoice(card.id), v.id), st); return sp === null || W.parseCreateSpecIds(sp) !== null; }))));
} else {
  console.log('note  8: src/lib/createWords.ts (ENG\'s PR #81) is not on this tree; section 8 runs once it is');
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
