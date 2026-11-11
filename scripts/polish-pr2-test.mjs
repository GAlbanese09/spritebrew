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
// Run from the repo root: `node scripts/polish-pr2-test.mjs`. Bundles with
// esbuild into local/.polish-pr2-test/ (gitignored). Prints only case names
// and pass or fail. Source pins read the source with comments stripped.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.polish-pr2-test');

await build({
  entryPoints: ['src/lib/affordableStyle.ts', 'src/lib/middleEllipsis.ts', 'src/lib/sheetSession.ts', 'src/lib/styleRegistry.ts', 'src/lib/constants.ts']
    .map((p) => path.join(ROOT, p)),
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const load = (name) => import(pathToFileURL(path.join(OUT_DIR, `${name}.mjs`)).href);
const { openingStyle, affordableNote } = await load('affordableStyle');
const { middleEllipsis } = await load('middleEllipsis');
const { sheetLeaveLosesWork } = await load('sheetSession');
const { getStyleById, GENERATION_STYLES } = await load('styleRegistry');
const { DAILY_LOGIN_TOKENS, EMAIL_LIST_BONUS_TOKENS } = await load('constants');

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
  const open = (balance, currentId = 'plus-classic', picked = false) => openingStyle({ balance, currentId, picked });

  check('1: balance 8 opens Retro Arcade (fast-retro)', open(8) === 'fast-retro', open(8));
  check('1: balance 5, exactly Retro Arcade\'s cost, opens fast-retro', open(fast.tokenCost) === 'fast-retro');
  check('1: balance 16 keeps plus-classic', open(16) === 'plus-classic');
  check('1: balance 10,021 keeps plus-classic', open(10021) === 'plus-classic');
  check('1: balance 4 (covers nothing) keeps plus-classic', open(4) === 'plus-classic');
  check('1: picked true keeps the pick', open(8, 'plus-classic', true) === 'plus-classic' && open(3, 'pro-fantasy', true) === 'pro-fantasy');
  check('1: a currentId other than plus-classic is kept', open(8, 'pro-fantasy') === 'pro-fantasy' && open(0, 'fast-no-style') === 'fast-no-style');

  const more = (claimed) => `+${DAILY_LOGIN_TOKENS} a day${claimed ? '' : `, +${EMAIL_LIST_BONUS_TOKENS} for the newsletter`}`;
  const tier = fast.tier.charAt(0).toUpperCase() + fast.tier.slice(1);
  const note8 = (claimed) => `You have 8 tokens: ${tier} styles are ready. ${classic.label} needs ${classic.tokenCost} (${more(claimed)}).`;
  const note3 = (claimed) => `You have 3 tokens. ${fast.label} needs ${fast.tokenCost} (${more(claimed)}).`;
  check('1: note for 8, newsletter not claimed (numbers and names from the registry and constants)',
    affordableNote({ balance: 8, emailListClaimed: false }) === note8(false), affordableNote({ balance: 8, emailListClaimed: false }));
  check('1: note for 8, newsletter claimed, leaves the newsletter out',
    affordableNote({ balance: 8, emailListClaimed: true }) === note8(true), affordableNote({ balance: 8, emailListClaimed: true }));
  check('1: note for 3, newsletter not claimed',
    affordableNote({ balance: 3, emailListClaimed: false }) === note3(false), affordableNote({ balance: 3, emailListClaimed: false }));
  check('1: note for 3, newsletter claimed',
    affordableNote({ balance: 3, emailListClaimed: true }) === note3(true), affordableNote({ balance: 3, emailListClaimed: true }));
  check('1: today\'s values give the words HQ -020 wrote',
    affordableNote({ balance: 8, emailListClaimed: false }) === 'You have 8 tokens: Fast styles are ready. Classic Pixel Art needs 16 (+3 a day, +5 for the newsletter).'
    && affordableNote({ balance: 3, emailListClaimed: false }) === 'You have 3 tokens. Retro Arcade needs 5 (+3 a day, +5 for the newsletter).');
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
  check('4: the animation style count comes from the registry, and the footer line is the new one',
    /GENERATION_STYLES\.filter\(\(s\) => s\.isAnimation\)\.length/.test(landing) && landing.includes('${ANIMATED_STYLE_COUNT} animation styles available now.')
    && landing.includes('Made by George, an indie developer') && landing.includes('Zoom in to edit single pixels.')
    && GENERATION_STYLES.filter((s) => s.isAnimation).length === 6);

  const layout = stripComments(read('src/app/layout.tsx'));
  check('4: layout.tsx has metadataBase spritebrew.com and a per-page canonical',
    layout.includes("metadataBase: new URL('https://spritebrew.com')") && layout.includes("alternates: { canonical: './' }"));

  const result = stripComments(read('src/components/sprites/GenerationResult.tsx'));
  check('4: the result card says "Download unedited sheet", never "Download original"',
    !result.includes('Download original') && result.includes('Download unedited sheet')
    && result.includes('Could not make the sheet. Try Download unedited sheet.'));
  check('4: the result card has the hint under it, 12 px, text-secondary',
    /<p id=\{uneditedHintId\} className="text-xs font-mono text-text-secondary mt-1">\s*The whole sheet as SpriteBrew delivered it, background removed, before any frame edits\.\s*<\/p>/.test(result));
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
  check('4: /upload\'s banner shows only for Send to Slicer\'s image, with the new words',
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

if (failed > 0) {
  console.log(`\n${failed} of ${cases} failed`);
  process.exit(1);
}
console.log(`\nall pass (${cases} cases)`);
