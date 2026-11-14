// scripts/polish-pr2-test.mjs
//
// Offline tests for polish PR 2, session 2 (HQ room 2026-11-08-021,
// 2026-11-09-001, -002, -017, -020; backlog 27 to 30, 44).
//
// 1. affordableStyle.ts: the style a short balance opens on, and its note,
//    with every name and number read from the registry and constants.
// 2. middleEllipsis.ts: the newsletter field's shortened address.
// 3. sheetSession.ts: the leave guard's saved-or-not check.
// 4. Source pins: the landing page, layout.tsx, the result card, the
//    Gallery, /upload, buy-tokens/page.tsx and the registry.
//
// Session 3 (DESIGN room 2026-11-11-001, -008; BUILD 2026-11-11-002):
// 5. animatedStills.ts: the three stills and the CSS for one frame.
// 6. public/style-examples/ holds exactly the 18 files, sha256 pinned.
// 7. Source pins: the chips, the bar under 640 px, the held reference
//    images, the stills in the picker and the field, the lightbox, and the
//    result card's Playing view.
//
// Fix round 1 (audit r1 of PR #53; HQ room 2026-11-11-034, ENG -043, DESIGN
// -010): the style follows the balance until the person acts, the note names
// the ready style and offers the newsletter only once the reward's answer is
// known, middleEllipsis never lengthens, the lightbox with one example, and
// 8. the latch and the visit driven through the real createFormVisit and
//    openingStyle, the newsletter flag through the real dailyRewardClient
//    and store, the border read run on real pixel data from the result
//    card's own source, and the pins for L and M.
//
// Fix round 2 (audit r2 of PR #53; HQ room 2026-11-11-076, -083, -090;
// DESIGN -012): any edit of the form (the size, Background, reference
// images) is an act; the note shows only on the two styles it speaks of;
// 8-Direction Rotation is hidden from Create and cannot come back through the
// visit, Recent or chooseStyle; the landing page counts 5 offered animated
// styles; "Download as delivered"; the lightbox's toolbar button and
// backdrop close pinned.
//
// Fix round 3 (audit round 3, F1, and the audit pass on fix 3, G1 to G4; HQ
// room 2026-11-13-006, -012): from 640 px the bar's summary keeps at least
// 300 px, the name gives way first, then the size, and the cost never
// shrinks; the reason may wrap, so a long one (the paused message) cannot
// push the cost or the button out of the bar; while paused the bar shows
// one short line (HQ 2026-11-13-015); and
// 9. generateBarHeight.ts: the notice above the bar follows the bar's real
//    height, driven here with a stand-in for the page.
//
// Run from the repo root: `node scripts/polish-pr2-test.mjs`. Bundles with
// esbuild into local/.polish-pr2-test/ (gitignored). Prints only case names
// and pass or fail. Source pins read the source with comments stripped.

import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.polish-pr2-test');

await build({
  entryPoints: ['src/lib/affordableStyle.ts', 'src/lib/middleEllipsis.ts', 'src/lib/sheetSession.ts', 'src/lib/styleRegistry.ts', 'src/lib/constants.ts',
    'src/components/sprites/animatedStills.ts', 'src/lib/createFormVisit.ts', 'src/lib/sheetAlpha.ts', 'src/lib/recentStyles.ts',
    'src/lib/generateBarHeight.ts']
    .map((p) => path.join(ROOT, p)),
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, entryNames: '[name]', logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
// The lightbox, with next/dynamic standing in for YARL's lazy load (the
// component is a plain function, so calling it gives the element YARL gets),
// and dailyRewardClient with the store, its claimer swapped for one that
// hands its apply to the test.
const STAND_INS = path.join(OUT_DIR, 'stand-ins');
fs.mkdirSync(STAND_INS, { recursive: true });
fs.writeFileSync(path.join(STAND_INS, 'next-dynamic.mjs'), 'export default function dynamic() { return function Lightbox() { return null; }; }\n');
fs.writeFileSync(path.join(STAND_INS, 'claim.mjs'),
  'export function createDailyRewardClaimer(io) { globalThis.__rewardApply = io.apply; return { claimOnce: async () => {}, reset: () => {} }; }\n');
fs.writeFileSync(path.join(STAND_INS, 'client-entry.mjs'),
  `export { resetDailyRewardClaim } from ${JSON.stringify(path.join(ROOT, 'src/lib/dailyRewardClient.ts'))};\n`
  + `export { useSpriteStore } from ${JSON.stringify(path.join(ROOT, 'src/stores/spriteStore.ts'))};\n`);
await build({
  entryPoints: { lightbox: path.join(ROOT, 'src/components/sprites/StyleExamplesLightbox.tsx'), rewardClient: path.join(STAND_INS, 'client-entry.mjs') },
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent', jsx: 'automatic',
  alias: { '@': path.join(ROOT, 'src') }, loader: { '.css': 'empty' },
  external: ['react', 'react/jsx-runtime'],
  plugins: [{ name: 'stand-ins', setup(b) {
    b.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: path.join(STAND_INS, 'next-dynamic.mjs') }));
    b.onResolve({ filter: /^@\/lib\/dailyRewardClaim$/ }, () => ({ path: path.join(STAND_INS, 'claim.mjs') }));
  } }],
});
const load = (name) => import(pathToFileURL(path.join(OUT_DIR, `${name}.mjs`)).href);
const { openingStyle, affordableNote, OPENING_CANDIDATES } = await load('affordableStyle');
const { middleEllipsis } = await load('middleEllipsis');
const { sheetLeaveLosesWork } = await load('sheetSession');
const { getStyleById, GENERATION_STYLES, OFFERED_STYLES } = await load('styleRegistry');
const { DAILY_LOGIN_TOKENS, EMAIL_LIST_BONUS_TOKENS } = await load('constants');
const { ANIMATED_STILLS, stillFrameStyle } = await load('animatedStills');
const { createFormVisit } = await load('createFormVisit');
const { borderMostlyTransparent } = await load('sheetAlpha');
const { readRecent, accountRecentStorage, recentStylesKey } = await load('recentStyles');
const { GENERATE_BAR_SELECTOR, GENERATE_BAR_GAP_PX, readBarHeight, watchBar } = await load('generateBarHeight');
const { StyleExamplesLightbox } = await load('lightbox');
const { resetDailyRewardClaim, useSpriteStore } = await load('rewardClient');

let failed = 0;
let cases = 0;
function check(name, ok, detail) {
  cases++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1').replace(/\{\s*\}/g, '');

// ── 1. affordableStyle ──

{
  const classic = getStyleById('plus-classic');
  const fast = getStyleById('fast-retro');
  const open = (balance, currentId = 'plus-classic', acted = false) => openingStyle({ balance, currentId, acted });

  check('1: balance 8 opens Retro Arcade (fast-retro)', open(8) === 'fast-retro', open(8));
  check('1: balance 5, exactly Retro Arcade\'s cost, opens fast-retro', open(fast.tokenCost) === 'fast-retro');
  check('1: balance 16 keeps plus-classic', open(16) === 'plus-classic');
  check('1: balance 10,021 keeps plus-classic', open(10021) === 'plus-classic');
  check('1: balance 4 (covers nothing) keeps plus-classic', open(4) === 'plus-classic');
  check('1: acted keeps the current style whatever the balance', open(8, 'plus-classic', true) === 'plus-classic' && open(3, 'pro-fantasy', true) === 'pro-fantasy');
  check('1: not acted, a current style other than plus-classic follows the balance', open(8, 'pro-fantasy') === 'fast-retro' && open(0, 'fast-no-style') === 'plus-classic');

  // The newsletter is offered only once the reward's answer is known and unclaimed.
  const more = (offered) => `+${DAILY_LOGIN_TOKENS} a day${offered ? `, +${EMAIL_LIST_BONUS_TOKENS} for the newsletter` : ''}`;
  const note8 = (offered) => `You have 8 tokens: ${fast.label} is ready at ${fast.tokenCost}. ${classic.label} needs ${classic.tokenCost} (${more(offered)}).`;
  const note3 = (offered) => `You have 3 tokens. ${fast.label} needs ${fast.tokenCost} (${more(offered)}).`;
  const known = (balance, emailListClaimed) => affordableNote({ balance, emailListClaimed, emailListClaimKnown: true });
  check('1: note for 8, newsletter not claimed (numbers and names from the registry and constants)',
    known(8, false) === note8(true), known(8, false));
  check('1: note for 8, newsletter claimed, leaves the newsletter out',
    known(8, true) === note8(false), known(8, true));
  check('1: note for 3, newsletter not claimed',
    known(3, false) === note3(true), known(3, false));
  check('1: note for 3, newsletter claimed',
    known(3, true) === note3(false), known(3, true));
  check('1: today\'s values give the words HQ -034 wrote',
    known(8, false) === 'You have 8 tokens: Retro Arcade is ready at 5. Classic Pixel Art needs 16 (+3 a day, +5 for the newsletter).'
    && known(3, false) === 'You have 3 tokens. Retro Arcade needs 5 (+3 a day, +5 for the newsletter).');
  check('1: no note once the balance covers plus-classic (16, 10,021)',
    affordableNote({ balance: 16, emailListClaimed: false }) === null && affordableNote({ balance: 10021, emailListClaimed: true }) === null);
  check('1: one token reads "1 token"', affordableNote({ balance: 1, emailListClaimed: true })?.startsWith('You have 1 token. '));
  const src = stripComments(read('src/lib/affordableStyle.ts'));
  check('1: affordableStyle types no cost, label or bonus number', !/\b(16|5|3|40|25|50)\b/.test(src.replace(/import[\s\S]*?;/g, ''))
    && !/Classic Pixel Art|Retro Arcade/.test(src));
}

// ── 2. middleEllipsis ──

{
  const addr = 'georgealbanese@example.com';
  check('2: a short address stays whole', middleEllipsis('a@b.co', 20) === 'a@b.co' && middleEllipsis(addr, addr.length) === addr);
  check('2: a long address keeps its start and the whole domain', middleEllipsis(addr, 22) === 'georgealb…@example.com', middleEllipsis(addr, 22));
  check('2: the result fits maxChars when the domain leaves room', middleEllipsis(addr, 16).length === 16 && middleEllipsis(addr, 16).endsWith('@example.com'));
  check('2: the domain is never cut; at least one character of the name stays', middleEllipsis(addr, 5) === 'g…@example.com');
  check('2: no address: start and end kept', middleEllipsis('abcdefghijklmnop', 7) === 'abc…nop', middleEllipsis('abcdefghijklmnop', 7));
  check('2: no name before @ is treated as no address', middleEllipsis('@averyveryverylongdomain.com', 9) === '@ave….com', middleEllipsis('@averyveryverylongdomain.com', 9));
  check('2: odd input: empty, non-string, NaN, zero', middleEllipsis('', 5) === '' && middleEllipsis(undefined, 5) === ''
    && middleEllipsis(addr, Number.NaN) === addr && middleEllipsis('abcdef', 0) === '…');
  check('2: the last @ splits the address', middleEllipsis('a@b@example.com', 14) === 'a…@example.com', middleEllipsis('a@b@example.com', 14));
}

// ── 3. The leave guard: saved or not ──

{
  const sheet = { id: 's' };
  const session = { spriteSheet: sheet, animations: [], frameDataUrls: new Map(), currentSheetMetadata: null, generationStyle: null };
  // The store's snapshot: a new object holding the same fields.
  const snap = (over = {}) => ({ ...session, ...over });
  const loses = (current, lastSaved, savingOn = true) => sheetLeaveLosesWork({ current, lastSaved, savingOn });

  check('3: nothing to lose without a sheet', loses(null, null) === false && loses(null, session, false) === false);
  check('3: unsaved after a change (new groups, nothing saved yet)', loses(snap({ animations: [{ id: 'g' }] }), session) === true && loses(snap(), null) === true);
  check('3: saved after the save lands (the saved session is the store\'s)', loses(snap(), session) === false);
  check('3: a change after the save is unsaved again', loses(snap({ frameDataUrls: new Map() }), session) === true);
  check('3: guard on after a save error (saving off), even when the last save matched', loses(snap(), session, false) === true);
  check('3: off after Restore with nothing changed (the store holds the restored fields)', loses(snap(), session) === false);
}

// ── 4. Source pins ──

{
  const landing = stripComments(read('src/app/page.tsx'));
  const banned = ['+6 bonus', '7-day streaks', '4 animation styles', '16x zoom', 'Built by George Albanese'].filter((t) => landing.includes(t));
  check('4: the landing page has none of the old claims or the full name', banned.length === 0, banned);
  const constImport = landing.match(/import \{([^}]*)\} from '@\/lib\/constants';/)?.[1] ?? '';
  const names = ['SIGNUP_BONUS_TOKENS', 'DAILY_LOGIN_TOKENS', 'STREAK_WEEKLY_BONUS_TOKENS', 'STREAK_INTERVAL_DAYS', 'EMAIL_LIST_BONUS_TOKENS'];
  check('4: the landing page imports the streak and bonus constants and uses them in the Free list',
    names.every((n) => new RegExp(`\\b${n}\\b`).test(constImport))
    && landing.includes('`${DAILY_LOGIN_TOKENS} free tokens each day, ${STREAK_WEEKLY_BONUS_TOKENS} on every ${ordinal(STREAK_INTERVAL_DAYS)} day in a row`')
    && landing.includes('`${SIGNUP_BONUS_TOKENS} tokens to start`') && landing.includes('`+${EMAIL_LIST_BONUS_TOKENS} for joining the newsletter`'));
  // The page's own count, run on the real registry.
  const countExpr = landing.match(/const ANIMATED_STYLE_COUNT = (GENERATION_STYLES\.filter\([^\n]*\)\.length);/)?.[1];
  let pageCount = null;
  try { pageCount = countExpr ? new Function('GENERATION_STYLES', `return ${countExpr};`)(GENERATION_STYLES) : null; } catch { pageCount = null; }
  check('4: the animation style count comes from the registry and counts the 5 offered animated styles, and the footer line is the new one',
    /GENERATION_STYLES\.filter\(\(s\) => s\.isAnimation && !s\.hidden\)\.length/.test(landing) && landing.includes('${ANIMATED_STYLE_COUNT} animation styles available now.')
    && landing.includes('Made by George, an indie developer') && landing.includes('Zoom in to edit single pixels.')
    && pageCount === 5 && OFFERED_STYLES.filter((s) => s.isAnimation).length === 5 && GENERATION_STYLES.filter((s) => s.isAnimation).length === 6, pageCount);

  const layout = stripComments(read('src/app/layout.tsx'));
  check('4: layout.tsx has metadataBase spritebrew.com and a per-page canonical',
    layout.includes("metadataBase: new URL('https://spritebrew.com')") && layout.includes("alternates: { canonical: './' }"));

  const result = stripComments(read('src/components/sprites/GenerationResult.tsx'));
  check('4: the result card says "Download as delivered", never "Download original" or "Download unedited sheet"',
    !result.includes('Download original') && !result.includes('Download unedited sheet') && result.includes('Download as delivered')
    && result.includes('Could not make the sheet. Try Download as delivered.'));
  check('4: the result card has the hint under it, 12 px, text-secondary',
    /<p id=\{uneditedHintId\} className="text-xs font-mono text-text-secondary mt-1">\s*The whole sheet as SpriteBrew delivered it, background removed, before any frame or pixel edits\.\s*<\/p>/.test(result));
  // DESIGN -012: the old name is gone from every file under src/.
  const srcFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? srcFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const oldName = srcFiles(path.join(ROOT, 'src')).filter((f) => fs.readFileSync(f, 'utf8').includes('Download unedited sheet')).map((f) => path.relative(ROOT, f));
  check('4: "Download unedited sheet" appears nowhere under src/', oldName.length === 0, oldName);
  // From the <Button that holds a label to the label: its props and icon.
  const buttonFor = (label) => {
    const at = result.indexOf(label);
    const open = at < 0 ? -1 : result.lastIndexOf('<Button', at);
    return open < 0 ? '' : result.slice(open, at);
  };
  const gif = buttonFor('Download GIF\n');
  const editor = buttonFor('Send to Editor\n');
  check('4: neither Download GIF nor Send to Editor carries a native disabled; both aria-disabled',
    gif !== '' && editor !== '' && !/\sdisabled=/.test(gif) && !/\sdisabled=/.test(editor)
    && /aria-disabled=\{gifEncoding \|\| undefined\}/.test(gif) && /aria-disabled=\{openingEditor \|\| undefined\}/.test(editor));
  check('4: busy guards and polite status for the GIF and the editor; the GIF spinner stops under reduced motion',
    /if \(!src \|\| !generatedImageDataUrl \|\| !loopGeometry \|\| gifEncoding\) return;/.test(result) && /if \(!url \|\| openingEditor\) return;/.test(result)
    && /<p className="sr-only" role="status">\{gifStatus\}<\/p>/.test(result) && /role="status">\{openingEditor \? 'Opening the editor\.' : ''\}<\/p>/.test(result)
    && /gifEncoding \? <Loader2 size=\{14\} className="animate-spin motion-reduce:animate-none" \/>/.test(result));
  check('4: the overlay puts the dimmed result and the loader in one grid cell',
    (result.match(/\[grid-area:1\/1\] opacity-20 pointer-events-none/g) ?? []).length === 1
    && /\[grid-area:1\/1\] flex items-center justify-center/.test(result) && !/absolute inset-0 flex items-center justify-center/.test(result));
  check('4: the border read takes four one-pixel strips, never the whole sheet',
    !/getImageData\(0, 0, W, H\)/.test(result) && /getImageData\(0, 0, W, 1\)/.test(result) && /getImageData\(0, H - 1, W, 1\)/.test(result)
    && /getImageData\(0, 1, 1, H - 2\)/.test(result) && /getImageData\(W - 1, 1, 1, H - 2\)/.test(result)
    && /borderMostlyTransparent\(ring, ring\.length \/ 4, 1\)/.test(result));
  check('4: the processed image is held with its source, and each save changes the status',
    /bgRemoved !== null && bgRemoved\.src === generatedImageDataUrl \? bgRemoved\.url : null/.test(result)
    && /setSheetReady\(\(prev\) => nextPress\(prev, generatedImageDataUrl\)\);\s*return;/.test(result) && !/setSheetReadySrc/.test(result));
  check('4: a version switch clears the sheet and GIF status (handleShowVersion), and setSheetReadySrc appears nowhere',
    /const handleShowVersion = useCallback\(\(version: CardVersion\) => \{[^}]*setSheetReady\(null\);\s*setGifReady\(null\);[^}]*\}, \[/.test(result)
    && !/setSheetReadySrc/.test(read('src/components/sprites/GenerationResult.tsx')));

  const gallery = stripComments(read('src/app/gallery/page.tsx'));
  const loadingAt = gallery.indexOf('if (loading) {');
  const emptyAt = gallery.indexOf('No generations yet');
  const loadingBlock = loadingAt < 0 ? '' : gallery.slice(loadingAt, gallery.indexOf('if (error) {', loadingAt));
  check('4: the Gallery shows "No generations yet" only when not loading',
    loadingAt >= 0 && emptyAt > loadingAt && gallery.split('No generations yet').length === 2 && !loadingBlock.includes('No generations yet')
    && /aria-busy="true"/.test(loadingBlock) && /Loading your gallery/.test(loadingBlock));
  check('4: the Gallery keeps loading while Clerk loads and starts loading again for each account',
    /if \(userId === undefined\) return;/.test(gallery) && /setLoading\(true\);\s*setError\(null\);\s*try \{/.test(gallery));

  const upload = stripComments(read('src/app/upload/page.tsx'));
  check('4: /upload\'s banner shows only for the generated image /upload loads by itself (however /upload is opened), with the new words',
    /\{fromSlicerHandoff && uploaded && \(/.test(upload) && upload.includes('Generated image loaded. Set the frame size, then slice.')
    && (upload.match(/setFromSlicerHandoff\(true\)/g) ?? []).length === 1
    && /setFromGenerated\(false\);\s*setFromSlicerHandoff\(false\);\s*setPreferredFrameW\(undefined\);/.test(upload));

  const guard = stripComments(read('src/hooks/useSheetLeaveGuard.ts'));
  check('4: the leave guard asks only when leaving would lose work',
    /if \(!sheetLeaveLosesWorkNow\(\)\) return;\s*e\.preventDefault\(\);/.test(guard));

  const buy = read('src/app/buy-tokens/page.tsx');
  const LINE = `          <a href="/refund-policy" className="text-accent-amber hover:underline">Refund policy</a>{' '}`;
  const MAIN_LINE = `          <a href="/refund-policy" className="text-accent-amber hover:underline">/refund-policy</a>{' '}`;
  check('4: buy-tokens/page.tsx differs from main in exactly one line, the refund link\'s text',
    buy.split(LINE).length === 2 && sha256(buy.replace(LINE, MAIN_LINE)) === 'bb0974d58727aca788a8942b3081f6a6065557e9d538747436225e4c1e274540');

  const anyAnim = getStyleById('anim-any');
  check('4: anim-any\'s description has no em dash', anyAnim.description === 'Open-ended animation: AI decides the layout' && !anyAnim.description.includes('\u2014'));
}

// ── 5. animatedStills ──

{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('5: the three stills: file, cols, rows, frame', same(ANIMATED_STILLS, {
    'anim-4angle-walking': { file: '/style-examples/anim-4angle-walking-1.png', cols: 4, rows: 4, frame: 8 },
    'anim-small-sprites': { file: '/style-examples/anim-small-sprites-1.png', cols: 5, rows: 4, frame: 0 },
    'anim-any': { file: '/style-examples/anim-any-1.png', cols: 4, rows: 4, frame: 0 },
  }), ANIMATED_STILLS);
  const css = (file, size, position) => ({
    backgroundImage: `url(${file})`, backgroundSize: size, backgroundPosition: position, backgroundRepeat: 'no-repeat', imageRendering: 'pixelated',
  });
  const walking = stillFrameStyle(ANIMATED_STILLS['anim-4angle-walking'] ?? {});
  check('5: 4-Angle Walking: frame 8 of a 4 by 4 sheet is column 0, row 2',
    same(walking, css('/style-examples/anim-4angle-walking-1.png', '400% 400%', '0% 66.6667%')), walking);
  const small = stillFrameStyle(ANIMATED_STILLS['anim-small-sprites'] ?? {});
  const any = stillFrameStyle(ANIMATED_STILLS['anim-any'] ?? {});
  check('5: Small Sprites (5 by 4) and Custom Animation (4 by 4) show frame 0',
    same(small, css('/style-examples/anim-small-sprites-1.png', '500% 400%', '0% 0%'))
    && same(any, css('/style-examples/anim-any-1.png', '400% 400%', '0% 0%')), { small, any });
  const last = stillFrameStyle({ file: '/x.png', cols: 5, rows: 4, frame: 19 });
  check('5: the last column and last row land at 100% 100%', last.backgroundPosition === '100% 100%', last.backgroundPosition);
  const oneCol = stillFrameStyle({ file: '/x.png', cols: 1, rows: 4, frame: 2 });
  const oneRow = stillFrameStyle({ file: '/x.png', cols: 4, rows: 1, frame: 3 });
  check('5: a one-column and a one-row sheet: no division by zero',
    oneCol.backgroundSize === '100% 400%' && oneCol.backgroundPosition === '0% 66.6667%'
    && oneRow.backgroundSize === '400% 100%' && oneRow.backgroundPosition === '100% 0%', { oneCol, oneRow });
}

// ── 6. public/style-examples/ ──

{
  const FILES = {
    'plus-classic-1.png': 'eb03d259c69c9998b54f3944075998f563875d8c1a60c4228ec3ed71c80bb3f5',
    'pro-default-1.png': '735964ff00d371abbfcf33098494a0c59891a4ee95fad126819972fb0e9ebcff',
    'pro-fantasy-1.png': '75bd292534a7aa3dad648a2eb63b26f93f6fed6de6a2f33c54a0d829b4a11bd2',
    'pro-platformer-1.png': 'e1b713051a63cdfeca6bb20604b13bce4a4b5bc5403fd36db980e7ac54dead10',
    'pro-spritesheet-1.png': '9f11b813370a0d142dae52709abf843a9080d63ea02e834d093b0cf4e52adc9a',
    'pro-inventory-1.png': '78f8d76df8403c75f471396134fec45c14ab44fafc8c8daf60d99bbb494e2da6',
    'pro-fps-weapon-1.png': '87badc2ab00899a2cc14847a1193114e7864ccd94abbf0d5c6f24d0ae08d0150',
    'pro-hex-tiles-1.png': '5d0215fd24cb3adea3b72242a1af19225a68f5f750bb5ad9791a2b66c3a1cea3',
    'pro-typography-1.png': '334d70afbd139fbc35f5e74fc182fae7186b90c3e7cdd631106808e2107ca06b',
    'plus-low-res-1.png': 'dcd101d9c6981b01d2afc27810a6874d75cc73614fbf4b173476eefb86b79968',
    'plus-skill-icon-1.png': 'c2c2cb8a7bb45548358651dd65b0f80af15b599a6dd59eac1ad53fd9fd75e387',
    'plus-topdown-item-1.png': '5abcd2f9e102b90fc79002ba99609666ec01936772b6b892f58b3ff7f65c5857',
    'plus-mc-item-1.png': '920dbb69c9fb47f9a6c41f366ac3c276765989a778179563685c0996b6ab8365',
    'fast-retro-1.png': '5a9977d26a5aaf76a21b1af0455d43e8f4bfec96c6eed013e20edea35a8780f0',
    'fast-no-style-1.png': 'bdf7c1dbc0f0f647921b790fe2174f2de092d268b0e335eed8fdf7b042fe0e83',
    'anim-4angle-walking-1.png': '0fc188f607a9ab132b6dd08ed92b810b5f4fab2ac714324b8498acd1e7d8400a',
    'anim-small-sprites-1.png': '82ea5584c8e938b50d93cda83b1ddd6502fe236174b94421a6b0b3622aa75bf9',
    'anim-any-1.png': '26e73a5514b959324caab0be204ab0de247dbb8de6e9985b7a4775ff0a07e46c',
  };
  const dir = path.join(ROOT, 'public', 'style-examples');
  const names = fs.readdirSync(dir).sort();
  const bad = names.filter((n) => FILES[n] !== createHash('sha256').update(fs.readFileSync(path.join(dir, n))).digest('hex'));
  check('6: public/style-examples/ holds exactly the 18 files, each with its sha256',
    names.length === 18 && JSON.stringify(names) === JSON.stringify(Object.keys(FILES).sort()) && bad.length === 0, { count: names.length, bad });
}

// ── 7. Source pins, session 3 ──

{
  const form = stripComments(read('src/components/sprites/GenerationForm.tsx'));
  const CHIPS = [['Knight', 'pixel art knight with sword'], ['Goblin', 'small goblin with wooden club'], ['Wizard', 'wizard with blue robe and staff'],
    ['Skeleton', 'skeleton warrior with shield'], ['Slime', 'cute slime monster'], ['Robot', 'robot with laser gun']];
  check('7: the six chips: one word each, paired with its full prompt',
    CHIPS.every(([label, prompt]) => form.includes(`{ label: '${label}', prompt: '${prompt}' }`))
    && (form.match(/\{ label: '[^']*', prompt: '[^']*' \}/g) ?? []).length === 6
    && /onClick=\{\(\) => onPick\(ex\.prompt\)\}/.test(form) && /\{ex\.label\}\s*<\/button>/.test(form));
  check('7: each chip carries "Use example:" in aria-label and title',
    form.includes('aria-label={`Use example: ${ex.prompt}`}') && form.includes('title={`Use example: ${ex.prompt}`}'));
  check('7: the chip row fades at its right edge only while more chips sit past it',
    /\{moreRight && \(\s*<div\s+className="pointer-events-none absolute top-0 right-0 bottom-1 w-6 bg-linear-to-r from-transparent to-bg-surface"/.test(form)
    && /setMoreRight\(row\.scrollLeft \+ row\.clientWidth < row\.scrollWidth - 1\)/.test(form)
    && /className="flex flex-nowrap gap-1\.5 overflow-x-auto/.test(form));
  check('7: under 640 px the bar leads with the cost and the balance; from 640 px the same order, the style\'s name shrinking first, then the size; a short balance reads "tokens · you have", in red',
    /<span className="sm:hidden">\s*\{summaryCost\} &middot; \{selectedStyle\.label\} &middot; \{sizeLabel\} px\s*<\/span>/.test(form)
    && /<span className="max-sm:hidden inline-flex max-w-full items-center gap-\[1ch\] align-bottom">\s*<span className="min-w-0 shrink-\[99999\] truncate">\{selectedStyle\.label\}<\/span>\{' '\}\s*<span className="min-w-0 truncate">&middot; \{sizeLabel\} px &middot;<\/span>\{' '\}\s*<span className="flex-shrink-0">\{summaryCost\}<\/span>\s*<\/span>/.test(form)
    && /\{formatCount\(tokenCost\)\}\s*\{!userId \? \(\s*' tokens'\s*\) : insufficientTokens \? \(\s*<>\s*\{' '\}tokens &middot;\{' '\}\s*<span className="text-red-400">you have \{formatCount\(tokenBalance\)\}<\/span>\s*<\/>\s*\) : \(\s*<span>\s*\{' '\}of \{formatCount\(tokenBalance\)\} tokens\s*<\/span>\s*\)\}/.test(form)
    && /<p\s+className="min-w-0 sm:min-w-\[300px\] sm:flex-1 truncate text-\[13px\] font-mono text-text-secondary tabular-nums"/.test(form));
  check('7: the Generate button carries the cost at every width (no hidden sm:inline-flex)',
    !form.includes('hidden sm:inline-flex') && /<span className="inline-flex items-center gap-1\.5 tabular-nums">\s*&middot; <PixelCoin \/> \{formatCount\(tokenCost\)\}/.test(form));
  // Fix round 3: the button's side may shrink and the reason may wrap, so no
  // reason, however long, sets the width of that side (G1, G2).
  check('7: the reason sits under the button below 1024 px and beside it from 1024 px; the button\'s side can shrink, and the reason is not held to one line and, from 640 px, wraps in lines of even length',
    /<div className="flex flex-col-reverse items-stretch gap-1 lg:flex-row lg:items-center lg:gap-3">\s*\{disabledReason && \(\s*<p id=\{reasonId\} className="text-\[13px\] font-mono text-text-secondary text-center sm:text-balance lg:text-right">\s*\{disabledReason\}\s*<\/p>\s*\)\}/.test(form));
  check('7: the Get tokens link keeps its 44 px touch target everywhere and adds no height to the reason beside the button',
    /<a\s+href="\/buy-tokens"\s+className="inline-flex items-center pointer-coarse:min-h-11 lg:pointer-coarse:-my-3 text-accent-amber underline hover:text-accent-amber-strong"/.test(form));
  check('7: while paused the bar shows one short line, and the whole message stays for screen readers in the element the button is described by',
    /if \(GENERATION_PAUSED\) \{\s*disabledReason = \(\s*<>\s*<span aria-hidden="true">Generating is paused for now\. Details are in the notice above\.<\/span>\s*<span className="sr-only">\{GENERATION_PAUSED_MESSAGE\}<\/span>\s*<\/>\s*\);\s*\} else if \(insufficientTokens\)/.test(form)
    && !form.includes('disabledReason = GENERATION_PAUSED_MESSAGE')
    && /<p id=\{reasonId\} className="[^"]*">\s*\{disabledReason\}\s*<\/p>/.test(form)
    && /aria-describedby=\{disabledReason \? reasonId : undefined\}/.test(form)
    && form.includes('title={GENERATION_PAUSED ? GENERATION_PAUSED_MESSAGE : insufficientTokens ?'));
  check('7: the bar is marked for what sits above it (data-generate-bar), once',
    /<div\s+data-generate-bar=""\s+className="fixed bottom-0 left-0 right-0 lg:left-\[var\(--sidebar-width\)\] z-40 /.test(form)
    && form.split('data-generate-bar').length === 2);

  const panel = stripComments(read('src/components/sprites/ReferenceImagesPanel.tsx'));
  check('7: held reference images on a non-Pro style: the one and the many sentences, no "will be sent"',
    !panel.includes('will be sent')
    && /\{count === 1 && \(\s*<> Your image is kept and will be used if you switch to a Pro style\.<\/>/.test(panel)
    && /\{count > 1 && \(\s*<> Your \{count\} images are kept and will be used if you switch to a Pro style\.<\/>/.test(panel)
    && panel.includes('Reference images: Pro styles only.'));
  check('7: the Add button names its panel only while the panel is rendered',
    panel.includes('aria-controls={expanded ? panelId : undefined}') && !panel.includes('aria-controls={panelId}'));

  const picker = stripComments(read('src/components/sprites/StylePicker.tsx'));
  const field = stripComments(read('src/components/sprites/StyleField.tsx'));
  const BADGE = '"absolute bottom-1 right-1 flex items-center justify-center w-4 h-4 rounded bg-black/60 text-white"';
  check('7: StylePicker and StyleField read the stills map, show the badge and still hold the Film icon',
    [picker, field].every((src) => /import \{ ANIMATED_STILLS, stillFrameStyle \} from '\.\/animatedStills';/.test(src)
      && /style=\{stillFrameStyle\(still\)\} aria-hidden="true"/.test(src)
      && src.includes(`className=${BADGE}`) && /<Play size=\{10\} fill="currentColor" \/>/.test(src)
      && /<Film size=\{32\}/.test(src))
    && /const still = ANIMATED_STILLS\[s\.id\];/.test(picker) && /const still = ANIMATED_STILLS\[style\.id\];/.test(field));

  // DESIGN 010 item 2: one example, no Previous or Next (this lightbox has no
  // dots plugin); two or more, YARL's own buttons as before.
  const classicStyle = getStyleById('plus-classic');
  const one = StyleExamplesLightbox({ style: classicStyle, onClose() {}, onUseStyle() {} });
  const two = StyleExamplesLightbox({ style: { ...classicStyle, examplePaths: ['/a.png', '/b.png'] }, onClose() {}, onUseStyle() {} });
  const oneRender = one?.props?.render ?? {};
  const twoRender = two?.props?.render ?? {};
  check('7: the lightbox with one example renders no Previous and no Next',
    one?.props?.slides?.length === 1 && typeof oneRender.slide === 'function'
    && typeof oneRender.buttonPrev === 'function' && oneRender.buttonPrev() === null
    && typeof oneRender.buttonNext === 'function' && oneRender.buttonNext() === null, Object.keys(oneRender));
  check('7: the lightbox with two examples keeps YARL\'s Previous and Next, and everything else as it was',
    two?.props?.slides?.length === 2 && Object.keys(twoRender).join() === 'slide' && twoRender.slide === oneRender.slide
    && JSON.stringify({ ...one.props, render: null, slides: null, toolbar: null }) === JSON.stringify({ ...two.props, render: null, slides: null, toolbar: null })
    && two.props.labels.Previous === 'Previous example' && two.props.labels.Next === 'Next example' && two.props.carousel.finite === true, Object.keys(twoRender));
  // Audit r2: both of these could be removed with every test passing.
  const useOne = () => {};
  const useTwo = () => {};
  const withUse = [
    StyleExamplesLightbox({ style: classicStyle, onClose() {}, onUseStyle: useOne }),
    StyleExamplesLightbox({ style: { ...classicStyle, examplePaths: ['/a.png', '/b.png'] }, onClose() {}, onUseStyle: useTwo }),
  ];
  const toolbarButtons = withUse.map((el) => el?.props?.toolbar?.buttons ?? []);
  check('7: the lightbox toolbar\'s Use this style button calls onUseStyle, then Close, with one example or two',
    toolbarButtons.every((b) => b.length === 2 && b[0]?.type === 'button' && b[0]?.key === 'use-style' && b[1] === 'close')
    && toolbarButtons[0][0].props.onClick === useOne && toolbarButtons[1][0].props.onClick === useTwo
    && toolbarButtons[0][0].props['aria-label'] === `Use ${classicStyle.label} style`);
  check('7: the lightbox still closes on a backdrop click (controller exactly { closeOnBackdropClick: true }), with one example or two',
    withUse.every((el) => JSON.stringify(el?.props?.controller) === '{"closeOnBackdropClick":true}'), withUse.map((el) => el?.props?.controller));
  const yarl = read('node_modules/yet-another-react-lightbox/dist/index.js');
  check('7: YARL renders render.buttonPrev and render.buttonNext in place of its own buttons (what the one-example case relies on)',
    yarl.includes('buttonPrev ? (buttonPrev()) : (React.createElement(NavigationButton, { label: "Previous"')
    && yarl.includes('buttonNext ? (buttonNext()) : (React.createElement(NavigationButton, { label: "Next"'));

  const result = stripComments(read('src/components/sprites/GenerationResult.tsx'));
  check('7: the result card: the sheet takes no height while Playing, the loop none in Sheet view, and the frame strip keeps its space',
    result.includes("[grid-area:1/1] self-center [justify-self:safe_center] inline-block ${showLoop ? 'invisible w-0 h-0 overflow-hidden' : ''}")
    && result.includes("[grid-area:1/1] self-center mx-auto ${showLoop ? '' : 'invisible h-0 overflow-hidden'}")
    && /<div className=\{showLoop \? undefined : 'invisible'\} inert=\{!showLoop\} aria-hidden=\{!showLoop \|\| undefined\}>\s*<LoopFrameStrip/.test(result)
    && /onLoad=\{\(e\) => \{\s*const nw = e\.currentTarget\.naturalWidth;/.test(result));
}

// ── 8. Fix round 1 ──

{
  // openingStyle (HQ -034): until the person acts, the balance decides, from
  // any current style; once they act, the current style stays.
  const TABLE = [[0, 'plus-classic'], [1, 'plus-classic'], [4, 'plus-classic'], [5, 'fast-retro'], [15, 'fast-retro'], [16, 'plus-classic'], [10021, 'plus-classic']];
  const open = (balance, currentId, acted) => openingStyle({ balance, currentId, acted });
  const OTHERS = ['pro-fantasy', 'fast-retro', 'fast-no-style', 'anim-any', 'plus-low-res'];
  check('8: openingStyle, not acted, from the default: 0, 1, 4 Classic; 5, 15 Retro Arcade; 16, 10,021 Classic',
    TABLE.every(([b, id]) => open(b, 'plus-classic', false) === id), TABLE.map(([b]) => open(b, 'plus-classic', false)));
  check('8: openingStyle, not acted, from a style other than the default: the same table',
    OTHERS.every((cur) => TABLE.every(([b, id]) => open(b, cur, false) === id)));
  check('8: openingStyle, acted: the current style at every balance',
    ['plus-classic', ...OTHERS].every((cur) => TABLE.every(([b]) => open(b, cur, true) === cur)));

  // affordableNote (HQ -034, ENG -043): the ready style by name and cost; the
  // newsletter only when the reward's answer is known and unclaimed.
  const note = (balance, emailListClaimed = false, emailListClaimKnown = true) => affordableNote({ balance, emailListClaimed, emailListClaimKnown });
  const NEWS = ', +5 for the newsletter';
  check('8: the new sentence at 5, 8 and 15',
    [5, 8, 15].every((n) => note(n) === `You have ${n} tokens: Retro Arcade is ready at 5. Classic Pixel Art needs 16 (+3 a day${NEWS}).`), [5, 8, 15].map((n) => note(n)));
  check('8: the old sentence at 0 and 4',
    [0, 4].every((n) => note(n) === `You have ${n} tokens. Retro Arcade needs 5 (+3 a day${NEWS}).`), [0, 4].map((n) => note(n)));
  check('8: no note at 16', note(16) === null && note(16, false, false) === null);
  check('8: the newsletter part only when the answer is known and unclaimed',
    note(8, false, true).includes(NEWS) && !note(8, true, true).includes(NEWS)
    && !note(8, false, false).includes(NEWS) && !note(8, true, false).includes(NEWS)
    && note(3, false, true).includes(NEWS) && !note(3, false, false).includes(NEWS));
  check('8: 1 token reads "1 token"', note(1) === `You have 1 token. Retro Arcade needs 5 (+3 a day${NEWS}).`, note(1));
  check('8: the note names no tier word', [1, 5, 8, 15].every((n) => !/\b(Fast|Plus|Pro) styles\b/.test(note(n))));

  // The flag, through the real dailyRewardClient and store.
  const apply = globalThis.__rewardApply;
  const knownNow = () => useSpriteStore.getState().emailListClaimKnown;
  const startsFalse = knownNow() === false;
  apply({ balance: 8 });
  const noAnswer = knownNow() === false;
  apply({ emailListClaimed: 'yes' });
  const notBoolean = knownNow() === false;
  apply({ emailListClaimed: false });
  const afterAnswer = knownNow() === true && useSpriteStore.getState().emailListClaimed === false;
  resetDailyRewardClaim();
  const afterReset = knownNow() === false;
  check('8: the newsletter flag: false at start and without a boolean answer, true after one, false after sign-out',
    typeof apply === 'function' && startsFalse && noAnswer && notBoolean && afterAnswer && afterReset,
    { startsFalse, noAnswer, notBoolean, afterAnswer, afterReset });
  const formForNote = stripComments(read('src/components/sprites/GenerationForm.tsx'));
  check('8: the form passes the flag to the note',
    /affordableNote\(\{ balance: tokenBalance, emailListClaimed, emailListClaimKnown \}\)/.test(formForNote)
    && /const emailListClaimKnown = useSpriteStore\(\(s\) => s\.emailListClaimKnown\);/.test(formForNote));
}

{
  // The latch and the visit (ENG -043 condition 3), driving the real
  // createFormVisit and openingStyle as GenerationForm does: a mount reads
  // the visit; the layout effect follows the balance until the latch; the
  // prompt box (non-empty), a chip and chooseStyle set it in their handler,
  // and every style change is written to the visit (pinned in
  // generate-picker-test section 6).
  const formSrc = read('src/components/sprites/GenerationForm.tsx');
  const bodyStart = formSrc.indexOf('      const body: Payload = {');
  const bodyEndAt = formSrc.indexOf('      body.idempotencyKey = idempotencyKey;', bodyStart);
  const bodyBlock = bodyStart < 0 || bodyEndAt < 0 ? '' : formSrc.slice(bodyStart, formSrc.indexOf('\n', bodyEndAt) + 1);
  check('8: the request body block still has sha256 1ef149e1',
    sha256(bodyBlock) === '1ef149e1d628de43f07921a4ba195e0c900e8f24e6d5c9839985b52ce9700539');
  const { code } = await transform(`function run(capturedPrompt, selectedStyle, effectiveWidth, effectiveHeight, removeBg, referenceImages, referencesEnabled, crypto) {\n${bodyBlock}\nreturn body;\n}`, { loader: 'ts' });
  const runBody = new Function(`${code}\nreturn run;`)();
  const bodyFor = (styleId, prompt) => {
    const st = getStyleById(styleId);
    return JSON.stringify(runBody(prompt, st, st.defaultWidth, st.defaultHeight, st.supportsRemoveBg, [], st.supportsReferenceImages === true, { randomUUID: () => 'k' }));
  };

  // The form's own code for the opening style, the latch and the visit, cut
  // from GenerationForm.tsx and run with React's state as plain variables:
  // the first style, the latch's start, markActed, chooseStyle, the layout
  // effect (run again after each change, as React does when its deps move),
  // the prompt box's onChange and the chip handler.
  const grab = (from, to) => {
    const a = formSrc.indexOf(from);
    const b = a < 0 ? -1 : formSrc.indexOf(to, a + from.length);
    return a < 0 || b < 0 ? null : formSrc.slice(a + from.length, b);
  };
  // A JSX handler, whole: from the `={` before `marker` through the `}` that
  // closes its arrow (the first `}}` after the marker).
  const handlerAround = (marker) => {
    const at = formSrc.indexOf(marker);
    const open = at < 0 ? -1 : formSrc.lastIndexOf('={', at);
    const close = at < 0 ? -1 : formSrc.indexOf('}}', at);
    return open < 0 || close < 0 ? null : formSrc.slice(open + 2, close + 1);
  };
  const parts = {
    visit: formSrc.match(/const \[visitAtMount\] = useState\(\(\) => (.+)\);\n/)?.[1],
    acted: formSrc.match(/const actedRef = useRef\((.+)\);\n/)?.[1],
    styleIds: formSrc.match(/^const STYLE_IDS = (.+);$/m)?.[1],
    recent: formSrc.match(/const \[recentIds, setRecentIds\] = useState<string\[\]>\((.+)\);\n/)?.[1],
    init: grab('  const [selectedStyleId, setSelectedStyleId] = useState(() => {\n', '\n  });\n'),
    mark: grab('  const markActed = useCallback(() => {\n', '\n  }, [userId]);'),
    choose: grab('  const chooseStyle = useCallback((id: string) => {\n', '\n  }, [selectedStyleId, recentIds, markActed, userId]);'),
    effect: grab('  useLayoutEffect(() => {\n', '\n  }, [serverBalanceKnown, tokenBalance, selectedStyleId, userId]);'),
    size: grab('  // Update dimensions when style changes\n  useEffect(() => {\n', '\n  }, [selectedStyle]);'),
    change: grab('          onChange={(e) => {\n', '\n          }}'),
    chip: grab('          onPick={(example) => {\n', '\n          }}'),
    width: handlerAround('setCustomWidth(Math.max('),
    height: handlerAround('setCustomHeight(Math.max('),
    bg: handlerAround('setRemoveBg((v) => !v);'),
    refs: handlerAround('setReferenceImages(images);'),
    note: formSrc.match(/  const balanceNote = ([\s\S]*?: null);\n/)?.[1],
    tokenCost: formSrc.match(/^ {2}const tokenCost = (.+);$/m)?.[1],
    insufficient: formSrc.match(/^ {2}const insufficientTokens = (.+);$/m)?.[1],
    disabled: formSrc.match(/\n {14}disabled=\{(GENERATION_PAUSED [^\n]*)\}\n/)?.[1],
  };
  const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
  check('8: the form\'s opening, latch and visit code is found in GenerationForm.tsx', missing.length === 0, missing);
  let makeForm = null;
  try {
    // React's state as plain variables; the layout effect and then the size
    // effect (which React runs when selectedStyle moves) after each change.
    const { code: formCode } = await transform(`function makeForm({ formVisit, openingStyle, getStyleById, DEFAULT_STYLE_ID, userId, pushRecent, writeRecent,
  OFFERED_STYLES, GENERATION_STYLES, readRecent, recentStore, OPENING_CANDIDATES, affordableNote, GENERATION_PAUSED }) {
  const visitAtMount = ${parts.visit};
  const STYLE_IDS = ${parts.styleIds};
  const recentStorage = () => recentStore;
  const state = { selectedStyleId: null, prompt: '', recentIds: [], announcement: '', serverBalanceKnown: false, tokenBalance: 0,
    customWidth: 256, customHeight: 256, removeBg: true, referenceImages: [] };
  state.selectedStyleId = (() => {\n${parts.init}\n})();
  state.recentIds = (${parts.recent})();
  const actedRef = { current: ${parts.acted} };
  const setSelectedStyleId = (id) => { state.selectedStyleId = id; };
  const setPrompt = (p) => { state.prompt = p; };
  const setRecentIds = (l) => { state.recentIds = l; };
  const setStyleAnnouncement = (t) => { state.announcement = t; };
  const setCustomWidth = (v) => { state.customWidth = v; };
  const setCustomHeight = (v) => { state.customHeight = v; };
  const setRemoveBg = (v) => { state.removeBg = typeof v === 'function' ? v(state.removeBg) : v; };
  const setReferenceImages = (v) => { state.referenceImages = v; };
  const styleNow = () => getStyleById(state.selectedStyleId) ?? GENERATION_STYLES[0];
  const markActed = () => {\n${parts.mark}\n};
  let sizedFor = null;
  const sizeEffect = () => {
    if (sizedFor === state.selectedStyleId) return;
    sizedFor = state.selectedStyleId;
    const selectedStyle = styleNow();\n${parts.size}\n};
  const layoutEffect = () => { const { serverBalanceKnown, tokenBalance, selectedStyleId } = state;\n${parts.effect}\n};
  const effect = () => { layoutEffect(); sizeEffect(); };
  sizeEffect();
  const chooseStyle = (id) => { const { selectedStyleId, recentIds } = state;\n${parts.choose}\n  effect();\n};
  return {
    state, actedRef,
    balance(b) { state.serverBalanceKnown = true; state.tokenBalance = b; effect(); effect(); },
    type(value) { const e = { target: { value } };\n${parts.change}\n  effect();\n},
    chip(example) {\n${parts.chip}\n  effect();\n},
    width(value) { const selectedStyle = styleNow(); (${parts.width})({ target: { value: String(value) } }); effect(); },
    height(value) { const selectedStyle = styleNow(); (${parts.height})({ target: { value: String(value) } }); effect(); },
    background() { (${parts.bg})(); effect(); },
    references(images) { (${parts.refs})(images); effect(); },
    note({ emailListClaimed = false, emailListClaimKnown = true } = {}) {
      const { serverBalanceKnown, tokenBalance, selectedStyleId } = state;
      return ${parts.note};
    },
    disabled(isGenerating = false) {
      const selectedStyle = styleNow();
      const { tokenBalance, prompt } = state;
      const tokenCost = ${parts.tokenCost};
      const insufficientTokens = ${parts.insufficient};
      return ${parts.disabled};
    },
    choose: chooseStyle,
  };
}`, { loader: 'ts' });
    makeForm = new Function(`${formCode}\nreturn makeForm;`)();
  } catch (e) { makeForm = null; console.log(String(e)); }
  const mountForm = (visit, userId, recentStore = null) => {
    // Without the form's code every check below fails by its title.
    if (!makeForm) return { style: 'missing', acted: null, prompt: null, size: null, balance() {}, type() {}, chip() {}, choose() {}, width() {}, height() {}, background() {}, references() {}, note: () => 'missing', formNote: () => 'missing', disabled: () => null, announced: () => 'missing', recent: () => ['missing'] };
    const real = makeForm({
      formVisit: visit, openingStyle, getStyleById, DEFAULT_STYLE_ID: 'plus-classic', userId,
      pushRecent: (list, prev, id) => [prev, ...list.filter((x) => x !== id && x !== prev)], writeRecent: () => {},
      OFFERED_STYLES, GENERATION_STYLES, readRecent, recentStore, OPENING_CANDIDATES, affordableNote,
      // Not paused, so the balance alone decides the button.
      GENERATION_PAUSED: false,
    });
    const f = {
      get style() { return real.state.selectedStyleId; },
      get acted() { return real.actedRef.current; },
      get prompt() { return real.state.prompt; },
      get size() { return { w: real.state.customWidth, h: real.state.customHeight, bg: real.state.removeBg, refs: real.state.referenceImages.length }; },
      balance: (b) => real.balance(b),
      type: (t) => real.type(t),
      chip: (t) => real.chip(t),
      choose: (id) => real.choose(id),
      width: (v) => real.width(v),
      height: (v) => real.height(v),
      background: () => real.background(),
      references: (images) => real.references(images),
      note: () => affordableNote({ balance: real.state.tokenBalance, emailListClaimed: false, emailListClaimKnown: true }),
      // The note as the form shows it (its own balanceNote expression).
      formNote: () => real.note(),
      // The Generate button's own disabled expression.
      disabled: () => real.disabled(),
      announced: () => real.state.announcement,
      recent: () => real.state.recentIds,
    };
    return f;
  };

  {
    const f = mountForm(createFormVisit(), 'user_a');
    f.balance(8);
    const at8 = f.style === 'fast-retro' && f.note() !== null;
    f.balance(508);
    check('8: balance 8 opens on Retro Arcade; then 508 with nothing typed returns to Classic and the note goes',
      at8 && f.style === 'plus-classic' && f.note() === null, f.style);
  }
  {
    const f = mountForm(createFormVisit(), 'user_a');
    f.balance(13);
    const at13 = f.style;
    f.balance(16);
    const g = mountForm(createFormVisit(), 'user_a');
    g.balance(3);
    const at3 = g.style;
    g.balance(6);
    check('8: 13 then 16: Retro Arcade then Classic; 3 then 6: Classic then Retro Arcade with the note',
      at13 === 'fast-retro' && f.style === 'plus-classic' && at3 === 'plus-classic' && g.style === 'fast-retro' && g.note() !== null,
      { at13, at16: f.style, at3, at6: g.style });
  }
  {
    const f = mountForm(createFormVisit(), 'user_a');
    f.balance(8);
    f.type('a small knight');
    const before = bodyFor(f.style, f.prompt);
    const styleBefore = f.style;
    f.balance(508);
    const g = mountForm(createFormVisit(), 'user_a');
    g.balance(21);
    g.type('a small knight');
    g.balance(8);
    check('8: after a non-empty prompt, 8 to 508 and 21 to 8 leave the style and the request body unchanged; at 8 on Classic the button is disabled',
      f.style === styleBefore && bodyFor(f.style, f.prompt) === before && g.style === 'plus-classic' && g.disabled(), { f: f.style, g: g.style });
  }
  {
    const f = mountForm(createFormVisit(), 'user_a');
    f.balance(8);
    f.type('');
    f.balance(508);
    const emptyTypingKeepsFollowing = f.style === 'plus-classic' && f.acted === false;
    const g = mountForm(createFormVisit(), 'user_a');
    g.balance(8);
    g.chip('pixel art knight with sword');
    g.balance(508);
    const h = mountForm(createFormVisit(), 'user_a');
    h.balance(508);
    h.choose('plus-classic');
    h.balance(8);
    check('8: an empty prompt is not an act; a chip and choosing the current style are (the current style: no Recent, no announcement)',
      emptyTypingKeepsFollowing && g.style === 'fast-retro' && h.style === 'plus-classic' && h.acted
      && h.recent().length === 0 && h.announced() === '');
  }
  {
    const visit = createFormVisit();
    const f = mountForm(visit, 'user_a');
    f.balance(50);
    f.choose('pro-fantasy');
    // Generate, then Generate Another: the form is built again with 10 left.
    const again = mountForm(visit, 'user_a');
    const opened = again.style;
    again.balance(10);
    again.balance(10021);
    // Create to Animate to Create: built again.
    const back = mountForm(visit, 'user_a');
    back.balance(3);
    check('8: a second mount for the same account starts on the remembered style with the latch set, whatever the balance',
      opened === 'pro-fantasy' && again.acted && again.style === 'pro-fantasy' && back.style === 'pro-fantasy' && back.acted,
      { opened, again: again.style, back: back.style });
    const other = mountForm(visit, 'user_b');
    const returning = mountForm(visit, 'user_a');
    check('8: another account starts empty, and what was held is dropped',
      other.style === 'plus-classic' && other.acted === false && returning.style === 'plus-classic' && returning.acted === false);
    const before = createFormVisit();
    mountForm(before, 'user_a').choose('pro-fantasy');
    const held = mountForm(before, 'user_a').style;
    const reload = mountForm(createFormVisit(), 'user_a');
    check('8: a reload (a new page load) starts over on the default', held === 'pro-fantasy' && reload.style === 'plus-classic' && reload.acted === false, { held, reload: reload.style });
  }
  {
    const visit = createFormVisit();
    const f = mountForm(visit, 'user_a');
    f.balance(8);
    const again = mountForm(visit, 'user_a');
    const opened = again.style;
    again.balance(508);
    check('8: a style the balance chose is remembered too, still unlatched, so it keeps following',
      opened === 'fast-retro' && again.acted === false && again.style === 'plus-classic', { opened, after: again.style });
    const visit2 = createFormVisit();
    visit2.rememberStyle('user_a', 'pro-fantasy');
    visit2.rememberStyle(null, 'fast-retro');
    visit2.rememberActed(undefined);
    const empty = JSON.stringify(visit2.read(null)) === '{"styleId":null,"acted":false}' && JSON.stringify(visit2.read(undefined)) === '{"styleId":null,"acted":false}';
    const kept = JSON.stringify(visit2.read('user_a')) === '{"styleId":"pro-fantasy","acted":false}';
    const visit3 = createFormVisit();
    visit3.rememberStyle('user_a', 'not-a-style');
    const unknown = mountForm(visit3, 'user_a');
    check('8: no userId reads empty and writes nothing (what is held stays); an unknown remembered id opens on the default',
      empty && kept && unknown.style === 'plus-classic' && unknown.acted === false, { empty, kept, unknown: unknown.style });
  }

  // Fix round 2, A (audit N1; HQ -090 ruling 1): any edit of the form is an
  // act. Balance 8 opens on Retro Arcade; the edit; then the balance becomes
  // 508: the style, the size and Background stay as the person left them.
  {
    const run = (edit) => {
      const f = mountForm(createFormVisit(), 'user_a');
      f.balance(8);
      const opened = f.style;
      edit(f);
      const edited = { style: f.style, ...f.size };
      f.balance(508);
      return { opened, edited, after: { style: f.style, ...f.size }, acted: f.acted };
    };
    const kept = (r) => r.opened === 'fast-retro' && r.acted === true && JSON.stringify(r.after) === JSON.stringify(r.edited);
    const size = run((f) => { f.width(128); f.height(128); });
    // Each field alone acts too.
    const widthOnly = run((f) => f.width(128));
    const heightOnly = run((f) => f.height(128));
    check('8: A: after a size edit (128 x 128, and the width or the height alone), 8 to 508 leaves the style, the size and Background unchanged',
      kept(size) && size.after.style === 'fast-retro' && size.after.w === 128 && size.after.h === 128 && size.after.bg === true
      && kept(widthOnly) && widthOnly.after.w === 128 && kept(heightOnly) && heightOnly.after.h === 128, { size, widthOnly, heightOnly });
    const bg = run((f) => f.background());
    check('8: A: after a Background press (off), 8 to 508 leaves the style, the size and Background unchanged',
      kept(bg) && bg.after.style === 'fast-retro' && bg.after.bg === false && bg.after.w === getStyleById('fast-retro').defaultWidth, bg);
    const refs = run((f) => f.references(['iVBORw0KGgo']));
    check('8: A: after a reference image is added, 8 to 508 leaves the style, the size and Background unchanged',
      kept(refs) && refs.after.style === 'fast-retro' && refs.after.refs === 1 && refs.after.bg === true, refs);
    const none = run(() => {});
    check('8: A: with no edit, 8 to 508 still moves to Classic and its size (the harness runs the size effect)',
      none.opened === 'fast-retro' && none.edited.w === getStyleById('fast-retro').defaultWidth
      && none.after.style === 'plus-classic' && none.acted === false && none.after.w === getStyleById('plus-classic').defaultWidth, none);
  }

  // Fix round 2, C (audit N6; HQ -090 ruling 3): the form's own note
  // expression shows the note only on the two opening styles.
  {
    const known10 = affordableNote({ balance: 10, emailListClaimed: false, emailListClaimKnown: true });
    const noteOn = (styleId) => {
      const f = mountForm(createFormVisit(), 'user_a');
      f.balance(10);
      if (styleId !== null) f.choose(styleId);
      return { style: f.style, note: f.formNote() };
    };
    const opened = noteOn(null);
    const classic = noteOn('plus-classic');
    const third = noteOn('pro-fantasy');
    const anim = noteOn('anim-any');
    check('8: C: at balance 10 the note is the known sentence on fast-retro and plus-classic, and null on a third style',
      known10 === 'You have 10 tokens: Retro Arcade is ready at 5. Classic Pixel Art needs 16 (+3 a day, +5 for the newsletter).'
      && opened.style === 'fast-retro' && opened.note === known10 && classic.style === 'plus-classic' && classic.note === known10
      && third.style === 'pro-fantasy' && third.note === null && anim.style === 'anim-any' && anim.note === null, { opened, classic, third, anim });
    check('8: C: the form checks the opening styles through OPENING_CANDIDATES, not ids typed again',
      /const balanceNote = serverBalanceKnown && \(OPENING_CANDIDATES as readonly string\[\]\)\.includes\(selectedStyleId\)\s*\?/.test(stripComments(formSrc))
      && !/balanceNote[^;]*'(plus-classic|fast-retro)'/.test(formSrc));
  }

  // Fix round 2, E (HQ -076, -083; ENG -091): 8-Direction Rotation remembered
  // in the visit and in this account's Recent: the form opens on the default
  // and offers no way back to it.
  {
    const raw = new Map([[recentStylesKey('user_a'), JSON.stringify(['anim-8dir', 'pro-fantasy'])]]);
    const browser = { getItem: (k) => (raw.has(k) ? raw.get(k) : null), setItem: (k, v) => raw.set(k, v) };
    const visit = createFormVisit();
    visit.rememberStyle('user_a', 'anim-8dir');
    const f = mountForm(visit, 'user_a', accountRecentStorage(browser, 'user_a'));
    const opened = f.style;
    const recentAtOpen = [...f.recent()];
    f.balance(508);
    const before = JSON.stringify({ style: f.style, acted: f.acted, recent: f.recent(), announced: f.announced(), visit: visit.read('user_a') });
    f.choose('anim-8dir');
    const after = JSON.stringify({ style: f.style, acted: f.acted, recent: f.recent(), announced: f.announced(), visit: visit.read('user_a') });
    // The picker's groups, run from StylePicker.tsx's own code.
    const pickerSrc = read('src/components/sprites/StylePicker.tsx');
    const names = pickerSrc.match(/const CATEGORY_NAMES: Record<StyleCategory, string> = (\{[\s\S]*?\});/)?.[1];
    const groupsSrc = pickerSrc.match(/const CATEGORIES: [^=]*= (\(\(\) => \{[\s\S]*?\}\)\(\));/)?.[1];
    let pickerIds = ['missing'];
    try {
      const { code: g } = await transform(`const CATEGORY_NAMES = ${names};\nreturn ${groupsSrc};`, { loader: 'ts' });
      pickerIds = new Function('OFFERED_STYLES', 'GENERATION_STYLES', g)(OFFERED_STYLES, GENERATION_STYLES).flatMap((c) => c.styles.map((s) => s.id));
    } catch { pickerIds = ['missing']; }
    check('8: E: anim-8dir remembered in the visit opens on the default, and Recent read from this account drops it',
      opened === 'plus-classic' && JSON.stringify(recentAtOpen) === '["pro-fantasy"]' && JSON.stringify(readRecent(accountRecentStorage(browser, 'user_a'), GENERATION_STYLES.map((s) => s.id))) === '["anim-8dir","pro-fantasy"]',
      { opened, recentAtOpen });
    check('8: E: chooseStyle(\'anim-8dir\') changes nothing: no style, no latch, no Recent, no visit write, no announcement',
      before === after && f.style === 'plus-classic' && f.acted === false && f.announced() === '', { before, after });
    check('8: E: the picker\'s groups (StylePicker\'s own code) hold the 20 offered styles and not anim-8dir',
      pickerIds.length === 20 && !pickerIds.includes('anim-8dir') && JSON.stringify([...pickerIds].sort()) === JSON.stringify(OFFERED_STYLES.map((s) => s.id).sort()), pickerIds.length);
  }
}

{
  // middleEllipsis (audit L6): never longer than its input.
  check('8: a one-letter name before a long domain comes back whole',
    middleEllipsis('j@company-mail.example.org', 20) === 'j@company-mail.example.org', middleEllipsis('j@company-mail.example.org', 20));
  const names = ['', 'j', 'jo', 'joe', 'georgealbanese', 'a.b'];
  const domains = ['@b.co', '@example.com', '@company-mail.example.org', '@averyveryverylongdomain.example.com'];
  const inputs = [...names.flatMap((n) => domains.map((d) => n + d)), 'abcdefghijklmnop', 'a', 'ab', '', 'x@', '@', 'a@b@example.com'];
  const longer = [];
  for (const text of inputs) for (let max = -1; max <= 45; max++) {
    const out = middleEllipsis(text, max);
    if (out.length > text.length || (text.length <= max && out !== text)) longer.push([text, max, out]);
  }
  check(`8: no result is longer than its input (${inputs.length} inputs, maxChars -1 to 45)`, longer.length === 0, longer.slice(0, 3));
}

{
  // The border read (the audit's uncaught mutation), run from the result
  // card's own source on real pixel data: four one-edge sheets, a clear one,
  // one with only its center opaque, and a fully opaque one.
  const card = read('src/components/sprites/GenerationResult.tsx');
  const from = card.indexOf('        const strips = [');
  const toLine = 'if (!cancelled) setSheetAlpha({ src, key, transparent: borderMostlyTransparent(ring, ring.length / 4, 1) });';
  const to = from < 0 ? -1 : card.indexOf(toLine, from);
  const readSrc = from < 0 || to < 0 ? '' : card.slice(from, to + toLine.length);
  let runRead = null;
  try {
    const { code: c } = await transform(`function run(ctx, W, H, borderMostlyTransparent, setSheetAlpha, src, key, cancelled) {\n${readSrc}\n}`, { loader: 'ts' });
    runRead = new Function(`${c}\nreturn run;`)();
  } catch { runRead = null; }
  const sheetOf = (W, H, opaque) => {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque(x, y)) px[(y * W + x) * 4 + 3] = 255;
    const ctx = {
      getImageData: (x0, y0, w, h) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = px[((y0 + y) * W + (x0 + x)) * 4 + k];
        return { data };
      },
    };
    return { ctx, W, H };
  };
  const answer = ({ ctx, W, H }) => {
    if (!runRead) return 'no read';
    let got = 'none';
    runRead(ctx, W, H, borderMostlyTransparent, (v) => { got = v.transparent; }, 's', 'k', false);
    return got;
  };
  check('8: the border read is found in GenerationResult.tsx and runs', readSrc.length > 0 && runRead !== null);
  check('8: border read: only the top edge opaque (8 by 3) reads transparent', answer(sheetOf(8, 3, (x, y) => y === 0)) === true);
  check('8: border read: only the bottom edge opaque (8 by 3) reads transparent', answer(sheetOf(8, 3, (x, y) => y === 2)) === true);
  check('8: border read: only the left edge opaque (3 by 8) reads transparent', answer(sheetOf(3, 8, (x) => x === 0)) === true);
  check('8: border read: only the right edge opaque (3 by 8) reads transparent', answer(sheetOf(3, 8, (x) => x === 2)) === true);
  check('8: border read: a fully transparent sheet reads transparent', answer(sheetOf(6, 6, () => false)) === true);
  check('8: border read: only the center opaque (10 by 10, 8 by 8 inside) reads transparent', answer(sheetOf(10, 10, (x, y) => x > 0 && x < 9 && y > 0 && y < 9)) === true);
  check('8: border read: a fully opaque sheet reads not transparent', answer(sheetOf(5, 5, () => true)) === false);
}

{
  // L (audit L12 and L5) and M (DESIGN 010 item 1).
  const result = stripComments(read('src/components/sprites/GenerationResult.tsx'));
  check('8: the GIF error is text-xs, like the sheet error beside it',
    result.includes('<p className="text-xs font-mono text-red-400" role="alert">{gifError.message}</p>')
    && !/text-\[10px\][^\n]*\{gifError\.message\}/.test(result));
  const landing = stripComments(read('src/app/page.tsx'));
  check('8: the landing line takes its daily tokens from DAILY_LOGIN_TOKENS',
    landing.includes('Start free. Earn +{DAILY_LOGIN_TOKENS} tokens every day you log in. No credit card required.') && !landing.includes('Earn +3'));
  const badgeAreas = [stripComments(read('src/components/sprites/StylePicker.tsx')), stripComments(read('src/components/sprites/StyleField.tsx'))];
  check('8: the Play badge stays bottom-right (DESIGN 010 item 1: the top-right corner had still pixels under it at 56 px)',
    badgeAreas.every((src) => src.includes('"absolute bottom-1 right-1 flex items-center justify-center w-4 h-4 rounded bg-black/60 text-white"')
      && !src.includes('"absolute top-1 right-1 flex items-center justify-center w-4 h-4')));
}

{
  // 9. The notice above the bar follows the bar's real height (the audit pass
  // on fix 3, G3). watchBar and readBarHeight driven with a stand-in page.
  const page = () => {
    const p = { bar: null, sizeWatchers: new Map(), treeWatchers: new Set(), sizeStops: 0, treeStops: 0 };
    p.env = {
      find: () => p.bar,
      observeSize: (bar, onChange) => { p.sizeWatchers.set(bar, onChange); return () => { p.sizeWatchers.delete(bar); p.sizeStops++; }; },
      observeTree: (onChange) => { p.treeWatchers.add(onChange); return () => { p.treeWatchers.delete(onChange); p.treeStops++; }; },
    };
    p.tree = () => [...p.treeWatchers].forEach((f) => f());
    p.resize = (bar, h) => { bar.offsetHeight = h; p.sizeWatchers.get(bar)?.(); };
    return p;
  };
  check('9: the height is null with no bar, null for a bar that takes no room, and the bar\'s height otherwise',
    readBarHeight(() => null) === null && readBarHeight(() => ({ offsetHeight: 0 })) === null
    && readBarHeight(() => ({ offsetHeight: 73 })) === 73 && readBarHeight(() => ({ offsetHeight: 144 })) === 144);
  check('9: the selector is the attribute the form puts on its bar, and the gap is 8 px',
    GENERATE_BAR_SELECTOR === '[data-generate-bar]' && GENERATE_BAR_GAP_PX === 8);
  {
    const p = page(); const bar = { offsetHeight: 73 }; p.bar = bar; let calls = 0;
    const stop = watchBar(p.env, () => { calls++; });
    const atStart = calls === 0 && p.sizeWatchers.has(bar) && p.treeWatchers.size === 1;
    p.resize(bar, 116);
    const afterResize = calls === 1 && readBarHeight(p.env.find) === 116;
    p.tree();                                   // something else on the page changed: the same bar
    const sameBar = calls === 1 && p.sizeWatchers.size === 1;
    check('9: watching a bar: nothing is called at the start, a resize is announced, and other changes on the page are not', atStart && afterResize && sameBar,
      { atStart, afterResize, sameBar, calls });
    p.bar = null; p.tree();                     // the form left the page
    const gone = calls === 2 && p.sizeWatchers.size === 0 && p.sizeStops === 1 && readBarHeight(p.env.find) === null;
    const next = { offsetHeight: 97 }; p.bar = next; p.tree();   // a form is back, with another bar
    const back = calls === 3 && p.sizeWatchers.has(next) && !p.sizeWatchers.has(bar) && readBarHeight(p.env.find) === 97;
    p.resize(next, 73);
    const nextResize = calls === 4;
    check('9: the bar leaving the page and another one arriving are both announced, and only the bar on the page is watched', gone && back && nextResize,
      { gone, back, nextResize, calls });
    stop();
    const stopped = p.treeWatchers.size === 0 && p.sizeWatchers.size === 0 && p.treeStops === 1 && p.sizeStops === 2;
    p.tree(); bar.offsetHeight = 1; next.offsetHeight = 1;
    check('9: stopping ends both watches, and nothing is called after it', stopped && calls === 4, { stopped, calls });
  }
  {
    const p = page(); let calls = 0;            // no bar at the start (the Animate tab), then the Create form arrives
    const stop = watchBar(p.env, () => { calls++; });
    const none = calls === 0 && p.sizeWatchers.size === 0 && readBarHeight(p.env.find) === null;
    const bar = { offsetHeight: 121 }; p.bar = bar; p.tree();
    check('9: with no bar at the start nothing is watched; a bar that arrives later is announced and watched',
      none && calls === 1 && p.sizeWatchers.has(bar) && readBarHeight(p.env.find) === 121, { none, calls });
    stop();
  }

  const notice = stripComments(read('src/components/sprites/GenerationErrorNotice.tsx'));
  const STRIP = 'className={`pointer-events-none fixed left-0 right-0 lg:left-[var(--sidebar-width)] z-40 ${BOTTOM_OFFSET}`}';
  check('9: the notice reads the marked bar from the page, watches its size and the page for a bar coming or going',
    notice.includes('find: () => document.querySelector<HTMLElement>(GENERATE_BAR_SELECTOR),')
    && /const sizes = new ResizeObserver\(onChange\);\s*sizes\.observe\(bar\);\s*return \(\) => sizes\.disconnect\(\);/.test(notice)
    && /const nodes = new MutationObserver\(onChange\);\s*nodes\.observe\(document\.body, \{ childList: true, subtree: true \}\);\s*return \(\) => nodes\.disconnect\(\);/.test(notice)
    && notice.includes('const subscribeBar = (onChange: () => void) => watchBar(browserBar, onChange);')
    && notice.includes('const getBarHeight = () => readBarHeight(browserBar.find);')
    && notice.includes('const getServerBarHeight = () => null;'));
  check('9: both notices sit in one strip placed 8 px above the bar\'s real height, with the fixed offsets kept for a bar that is not marked',
    notice.includes('const barHeight = useSyncExternalStore(subscribeBar, getBarHeight, getServerBarHeight);')
    && notice.includes('style={barHeight === null ? undefined : { bottom: barHeight + GENERATE_BAR_GAP_PX }}')
    && notice.split(STRIP).length === 2
    && notice.split('<AboveBar>').length === 3 && notice.split('</AboveBar>').length === 3
    && notice.includes("'bottom-[calc(147px+env(safe-area-inset-bottom))] sm:bottom-[calc(81px+env(safe-area-inset-bottom))]'"));
}

if (failed > 0) {
  console.log(`\n${failed} of ${cases} failed`);
  process.exit(1);
}
console.log(`\nall pass (${cases} cases)`);
