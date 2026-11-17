// scripts/resize-page-test.mjs
//
// Offline tests for the free /resize page (DESIGN design/tickets/editor-tools-batch.md
// v4.1, B2 to B5; DESIGN 2026-11-14-249): its rules and words in
// src/lib/resizePage.ts, driven, and the page, the sidebar, the header and
// the landing line, read as source. Run from the repo root:
// `node scripts/resize-page-test.mjs`. Bundles with esbuild into
// local/.resize-page-test/ (gitignored). Prints only case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.resize-page-test');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/resizePage.ts'), path.join(ROOT, 'src/lib/pixelResize.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
});
const P = await import(pathToFileURL(path.join(OUT_DIR, 'resizePage.mjs')).href);
const E = await import(pathToFileURL(path.join(OUT_DIR, 'pixelResize.mjs')).href);
const {
  RESIZE_SIDE_CAP, RESIZE_WORDS: W, takesFile, fileProblem, wholeGuess, wholeCounts, gridLine, unitOf, sizeRows,
  pillLabel, otherState, readSide, cleanSizeLabel, previewZoom, zoomLine, caption, downloadName,
} = P;

let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (ok) passed++; else failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// B5's words, as approved with the spec (HQ 2026-11-14-160).
check('B5: the page\'s words',
  W.title === 'Resize pixel art' &&
  W.lead === 'Shrink or grow pixel art without blurring it. Free, no account, and your image never leaves your browser.' &&
  W.drop === 'Drop an image here or choose a file' && W.choose === 'Choose a file' && W.another === 'Choose another' &&
  W.hint === 'PNG, JPEG, WebP or GIF, up to 4096 px a side.' && W.tooLarge === 'That image is larger than 4096 px a side. Try a smaller one.' &&
  W.oneImage === 'One image' && W.sheet === "It's a sheet" && W.what === 'What is this image?' && W.frameSize === 'Frame size' && W.size === 'Size' &&
  W.bigger === 'Bigger, for posting' && W.other === 'Other size...' && W.before === 'Before' && W.after === 'After' && W.download === 'Download PNG' &&
  RESIZE_SIDE_CAP === 4096 && RESIZE_SIDE_CAP === E.DOWNLOAD_SIDE_CAP);

check('the files the page takes: PNG, JPEG, WebP, GIF, by type, or by name when the browser gives none',
  takesFile({ type: 'image/png', name: 'a.png' }) && takesFile({ type: 'image/jpeg', name: 'a.jpg' }) && takesFile({ type: 'image/webp', name: 'a' }) &&
  takesFile({ type: 'image/gif', name: 'a' }) && takesFile({ type: '', name: 'knight.JPEG' }) && !takesFile({ type: 'image/bmp', name: 'a.png' }) &&
  !takesFile({ type: '', name: 'a.bmp' }) && !takesFile({ type: 'application/pdf', name: 'a.pdf' }));
check('a file over 4096 px a side is refused with B5\'s line; 4096 by 4096 is taken',
  fileProblem({ type: 'image/png', name: 'a.png' }, 4097, 10) === W.tooLarge && fileProblem({ type: 'image/png', name: 'a.png' }, 10, 4097) === W.tooLarge &&
  fileProblem({ type: 'image/png', name: 'a.png' }, 4096, 4096) === null && fileProblem({ type: 'image/bmp', name: 'a' }) === W.wrongType &&
  W.wrongType === 'That file is not a PNG, JPEG, WebP or GIF. Choose another.' && W.unreadable === 'That image could not be read. Choose another.' &&
  W.noGrid === 'No even grid found. Pick the columns and rows.');

check('B3: the grid guess is kept only when every frame is whole pixels and there is more than one frame',
  same(wholeGuess(512, 512, { cols: 4, rows: 4 }), { columns: 4, rows: 4 }) && wholeGuess(512, 512, { cols: 3, rows: 4 }) === null &&
  wholeGuess(512, 512, { cols: 1, rows: 1 }) === null && wholeGuess(512, 512, null) === null && wholeGuess(512, 512, { cols: 0, rows: 4 }) === null);
check('B3: the picker lists only counts that give whole frames',
  same(wholeCounts(12), [1, 2, 3, 4, 6, 12]) && same(wholeCounts(97), [1, 97]));
check('the grid line: "4 by 4 frames of 128 px", and a frame that is not square',
  gridLine(512, 512, { columns: 4, rows: 4 }) === '4 by 4 frames of 128 px' && gridLine(72, 32, { columns: 3, rows: 1 }) === '3 by 1 frames of 24 by 32 px');

{
  const sheet = unitOf(512, 512, { columns: 4, rows: 4 });
  const rows = sizeRows(sheet);
  check('B2: a sheet\'s sizes are the frame\'s: "128 px, as is", half, a quarter, an eighth; then 2x, 4x, 8x (the mockup)',
    same(sheet, { width: 128, height: 128, columns: 4, rows: 4 }) &&
    same(rows.down.map(pillLabel), ['128 px, as is', '64 px, half', '32 px, a quarter', '16 px, an eighth']) &&
    same(rows.up.map(pillLabel), ['2x', '4x', '8x']) && rows.noSmaller === null);
  const big = sizeRows(unitOf(1100, 1100, null));
  check('B2: an up size that would pass 4096 px a side on the whole image (a sheet counts its frames) is disabled, with its reason in -160\'s form (DESIGN -259); 4096 itself fits',
    same(rows.up.map((c) => c.overCap), [false, false, false]) && rows.overLine === null &&
    same(sizeRows(unitOf(2048, 2048, { columns: 4, rows: 4 })).up.map((c) => c.overCap), [false, true, true]) &&
    sizeRows(unitOf(1024, 1024, null)).overLine === '8x would go over the 4096 px limit.' &&
    same(big.up.map((c) => c.overCap), [false, true, true]) && big.overLine === '4x and 8x would go over the 4096 px limit.' &&
    sizeRows(unitOf(4096, 4096, null)).overLine === '2x, 4x and 8x would go over the 4096 px limit.');
  const odd = sizeRows(unitOf(97, 97, null));
  check('B2: a start with no clean smaller size says so and still offers Other size',
    odd.down.length === 1 && odd.noSmaller === '97 px has no clean smaller size of 8 px or more.');
}

{
  const u = unitOf(396, 396, null);
  const s = otherState(u, '150', '150');
  check('Other size, smaller and uneven: B2\'s line, the nearest clean sizes either side, "Use 132 px" and "Use 198 px" (the mockup)',
    s.kind === 'uneven-down' && s.line === '150 px is not a whole fraction of 396 px, so rows and columns of pixels will be dropped unevenly.' &&
    s.smaller && s.larger && cleanSizeLabel(s.smaller) === 'Use 132 px' && cleanSizeLabel(s.larger) === 'Use 198 px' && s.button === null && !s.overCap);
  const up = otherState(unitOf(64, 64, null), '100', '100');
  check('Other size, larger and uneven: B2\'s line',
    up.kind === 'uneven-up' && up.line === '100 px is not a whole multiple of 64 px, so some pixels will come out wider than others.');
  const mixed = otherState(unitOf(64, 64, null), '50', '100');
  check('Other size, one side smaller and the other larger: DESIGN\'s line (-249)',
    mixed.kind === 'uneven-mixed' && mixed.line === '50 by 100 px shrinks one side and grows the other unevenly, so some pixels will be dropped and some will come out wider.');
  const stretch = otherState(unitOf(64, 64, null), '32', '64');
  const stretch2 = otherState(unitOf(64, 64, null), '32', '128');
  check('Other size, both sides by whole factors but different ones: stretched, with "Resize anyway" only (DESIGN -249), as the engine reports it (BUILD-2 -254)',
    stretch.kind === 'stretched' && stretch.line === 'Width and height change by different amounts, so the art will be stretched.' &&
    stretch.smaller === null && stretch.larger === null && stretch2.kind === 'stretched' && E.classifySize(64, 64, 32, 64) === 'stretched');
  const clean = otherState(unitOf(64, 64, null), '16', '16');
  const cleanRect = otherState(unitOf(48, 64, null), '24', '32');
  check('Other size, a clean size: no warning, the button "Resize to 16 px" ("Resize to 24 by 32 px")',
    clean.kind === 'clean' && clean.line === null && clean.button === 'Resize to 16 px' && cleanRect.button === 'Resize to 24 by 32 px');
  const big = otherState(unitOf(128, 128, { columns: 4, rows: 4 }), '2048', '2048');
  check('Other size over the cap (a sheet counts its frames): nothing can be applied, with "That is larger than 4096 px a side."',
    big.overCap && big.overLine === 'That is larger than 4096 px a side.' && !otherState(unitOf(128, 128, { columns: 4, rows: 4 }), '1024', '1024').overCap);
  check('Other size reads only whole numbers of pixels',
    otherState(u, '', '10').kind === 'invalid' && otherState(u, '1.5', '10').kind === 'invalid' && otherState(u, '0', '10').kind === 'invalid' &&
    otherState(u, '-3', '10').kind === 'invalid' && readSide(' 64 ') === 64 && readSide('6e1') === null);
}

check('B4.3: one whole-number zoom, the largest at which Before fits; at 100% when it does not fit, and both pan',
  same(previewZoom(128, 128, 392, 392), { zoom: 3, pans: false }) && same(previewZoom(128, 64, 600, 120), { zoom: 1, pans: false }) &&
  same(previewZoom(1000, 1000, 392, 392), { zoom: 1, pans: true }) && same(previewZoom(10, 10, 0, 0), { zoom: 1, pans: false }));
check('B4.3: the zoom is named under them: "Frame 1 of each, both at 300%."',
  zoomLine(true, 3) === 'Frame 1 of each, both at 300%.' && zoomLine(false, 1) === 'Both at 100%.');
check('DESIGN -259: both boxes are the Before picture\'s height plus 12 px above and below, as wide as the column; a picture that pans gets the whole room',
  same(P.boxSize(128, 3, false, 430, 408), { width: 430, height: 408 }) && same(P.boxSize(128, 1, false, 135, 264), { width: 135, height: 152 }) &&
  same(P.boxSize(64, 2, false, 300, 408), { width: 300, height: 152 }) && same(P.boxSize(1000, 1, true, 300, 264), { width: 300, height: 264 }) && P.BOX_PAD === 12);
check('the captions: "Before · frame 1, 128 px", "After · frame 1, 64 px" (the mockup), and one image by its size',
  caption('before', true, 128, 128) === 'Before · frame 1, 128 px' && caption('after', true, 64, 64) === 'After · frame 1, 64 px' &&
  caption('after', false, 24, 32) === 'After · 24 by 32 px');
check('the saved name (B4.2; DESIGN -249): "{name}-{size}px.png", "{name}.png" as is, a "-{n}px" ending replaced',
  downloadName('knight-idle-sheet.png', { width: 64, height: 64 }) === 'knight-idle-sheet-64px.png' &&
  downloadName('knight-idle-sheet.png', null) === 'knight-idle-sheet.png' && downloadName('photo.jpeg', null) === 'photo.png' &&
  downloadName('knight-64px.png', { width: 32, height: 32 }) === 'knight-32px.png' && downloadName('knight-64px.png', null) === 'knight-64px.png' &&
  downloadName('walk.webp', { width: 24, height: 32 }) === 'walk-24x32px.png' && downloadName('walk-24x32px.png', { width: 48, height: 64 }) === 'walk-48x64px.png' &&
  downloadName('.png', { width: 8, height: 8 }) === 'image-8px.png');

// The page, read as source.
const page = stripComments(read('src/app/resize/page.tsx'));
const lib = read('src/lib/resizePage.ts');
const worker = read('src/lib/pixelResize.worker.ts');
check('the page sends nothing anywhere: no fetch, no beacon, no form posts',
  !/fetch\(|sendBeacon|XMLHttpRequest|<form[^>]*action=/.test(page) && (page.match(/<form/g) ?? []).length === 1 &&
  /<form noValidate onSubmit=\{\(e\) => \{ e\.preventDefault\(\); submitOther\(\); \}\}/.test(page) && !/fetch\(|sendBeacon|XMLHttpRequest/.test(lib + worker));
check('the resize runs in a worker, with the page as the fallback, and only the newest ask is shown; a worker that fails or does not answer in time is put down and what waits on it resizes on the page (AUDIT resize-page-r1, M1)',
  /new Worker\(new URL\('\.\.\/\.\.\/lib\/pixelResize\.worker\.ts', import\.meta\.url\)\)/.test(page) &&
  /if \(!w\) \{ onPage\(\); return; \}/.test(page) && /const back = waitingRef\.current\.get\(m\.id\);\s*if \(!back\) return;/.test(page) && /if \(ask !== askRef\.current\) return;/.test(page) &&
  /w\.addEventListener\('error', \(\) => dropWorker\(w\)\);/.test(page) && /w\.addEventListener\('messageerror', \(\) => dropWorker\(w\)\);/.test(page) &&
  /const waiting = \[\.\.\.waitingRef\.current\.values\(\)\];\s*waitingRef\.current\.clear\(\);\s*waiting\.forEach\(\(back\) => back\(null\)\);/.test(page) &&
  /dropWorker\(w\);\s*back\(null\);\s*\}, RESIZE_TIME_LIMIT_MS\);/.test(page) && /const RESIZE_TIME_LIMIT_MS = 15000;/.test(page) &&
  /scope\.postMessage\(\{ id, ok: true, width: out\.width, height: out\.height, data: out\.data \}, \[out\.data\.buffer\]\);/.test(worker));
check('never smoothing: the engine\'s mapping for every size, pixelated on screen, smoothing off where a canvas scales',
  /imageRendering: 'pixelated'/.test(page) && (page.match(/imageSmoothingEnabled = false/g) ?? []).length === 2 && !/imageSmoothingEnabled = true/.test(page));
check('Check true size is absent until #50 merges (B1)', !/Check true size/i.test(page + lib));
check('the sizes are buttons with aria-pressed; an over-cap size is disabled; "Other size..." opens a dialog that names itself and closes on Escape',
  /aria-pressed=\{pressed\(choice\)\} disabled=\{choice\.overCap\}/.test(page) && /aria-haspopup="dialog"/.test(page) &&
  /role="dialog" aria-modal="true" aria-labelledby="other-size-title"/.test(page) && /if \(e\.key === 'Escape'\) closeOther\(\);/.test(page));
check('the Other size dialog keeps the focus inside, Enter applies a clean size or goes to the warning\'s choices, every way out returns the focus, the warning is said, a side that is not a size is named (AUDIT resize-page-r1, M3)',
  /onKeyDown=\{keepFocusIn\}/.test(page) && /if \(e\.shiftKey && document\.activeElement === first\) \{ e\.preventDefault\(\); last\.focus\(\); \}/.test(page) &&
  /if \(otherNow\.kind === 'invalid'\) \{ setOtherTried\(true\); return; \}/.test(page) && /warnRef\.current\?\.querySelector<HTMLElement>\('button:not\(\[disabled\]\)'\)\?\.focus\(\);/.test(page) &&
  /const closeOther = useCallback\(\(\) => \{\s*setOther\(null\);\s*setOtherTried\(false\);\s*otherButtonRef\.current\?\.focus\(\);/.test(page) &&
  /if \(e\.target === e\.currentTarget\) \{ e\.preventDefault\(\); closeOther\(\); \}/.test(page) && /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); submitOther\(\); \} \}\}/.test(page) && /<p role="status" className="sr-only">\{otherTried && otherBad && \(otherBad\.width \|\| otherBad\.height\) \? W\.notASize : \[otherNow\.line, otherNow\.overLine\]\.filter\(Boolean\)\.join\(' '\)\}<\/p>/.test(page) &&
  /aria-invalid=\{bad \|\| undefined\}/.test(page) && /\{W\.notASize\}/.test(page) && W.notASize === 'Type a whole number of pixels, 1 or more, for each side.');
check('by touch every action keeps 44 px at every width; the pills are 44 px wide; the row labels are 12 px and readable (AUDIT resize-page-r1, M2, L4, L2)',
  (page.match(/pointer-coarse:min-h-11/g) ?? []).length >= 12 && /pointer-coarse:min-w-11/.test(page) && !/text-\[11px\]/.test(page));
// Each named control keeps its own touch floor, so undoing any one fails here (AUDIT resize-page-r2, R2-L4).
const floors = {
  'Choose another': /<Button variant="secondary" className="w-full sm:w-auto pointer-coarse:min-h-11" onClick=\{\(\) => inputRef\.current\?\.click\(\)\}>/,
  'Choose a file': /<Button className="w-full sm:w-auto pointer-coarse:min-h-11" onClick=\{\(\) => inputRef\.current\?\.click\(\)\} disabled=\{reading\}>/,
  'Download PNG': /<Button className="w-full sm:w-auto pointer-coarse:min-h-11" onClick=\{save\}/,
  'Close': /aria-label="Close" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick=\{closeOther\}/,
  'Use {n} px': /size="sm" className="pointer-coarse:min-h-11" onClick=\{\(\) => applyOther\(choice\.width, choice\.height\)\}/,
  'Resize anyway': /underline-offset-4 min-h-9 pointer-coarse:min-h-11 cursor-pointer disabled:opacity-50/,
  'Cancel': /<Button type="button" variant="secondary" className="pointer-coarse:min-h-11" onClick=\{closeOther\}>\{W\.cancel\}<\/Button>/,
  'Resize to': /<Button type="submit" className="pointer-coarse:min-h-11" disabled=\{otherNow\.overCap\}>/,
  'the pills': /const PILL = '[^']*pointer-coarse:min-h-11 pointer-coarse:min-w-11/,
};
const lostFloor = Object.entries(floors).filter(([, re]) => !re.test(page)).map(([name]) => name);
check('each action keeps its own 44 px touch floor (AUDIT resize-page-r2, R2-L4)', lostFloor.length === 0, lostFloor);
check('a failed worker is let go and a new one starts; the time limit is cleared only by an answer or the clean-up (AUDIT resize-page-r2, R2-L4)',
  /const dropWorker = useCallback\(\(w: Worker\) => \{\s*if \(workerRef\.current === w\) workerRef\.current = null;\s*w\.terminate\(\);/.test(page) &&
  /\}, RESIZE_TIME_LIMIT_MS\);\s*waiting\.set\(ask, back\);/.test(page) &&
  (page.match(/window\.clearTimeout\(timer\)/g) ?? []).length === 2 &&
  /if \(settled\) return;\s*settled = true;\s*window\.clearTimeout\(timer\);/.test(page) &&
  /return \(\) => \{\s*settled = true;\s*window\.clearTimeout\(timer\);/.test(page));
check('a wrong file during a read brings the button back (AUDIT resize-page-r1, L6; r2, R2-L4)',
  /if \(wrong\) \{[\s\S]{0,200}?setReading\(false\);\s*setProblem\(wrong\);\s*return;/.test(page));
check('the dialog holds focus itself, so a click on its text keeps focus in; Tab from it goes in (AUDIT resize-page-r2, R2-L1)',
  /role="dialog" aria-modal="true" aria-labelledby="other-size-title" tabIndex=\{-1\} onKeyDown=\{keepFocusIn\}/.test(page) &&
  /if \(!stops\.includes\(document\.activeElement as HTMLElement\)\) \{ e\.preventDefault\(\); \(e\.shiftKey \? last : first\)\.focus\(\); return; \}/.test(page));
check('over the cap with a warning, Enter goes to its first open choice; both lines are said (AUDIT resize-page-r2, R2-L2)',
  /if \(!otherNow\.overCap && otherNow\.button && otherNow\.width && otherNow\.height\) \{/.test(page) && !/if \(otherNow\.overCap\) return;/.test(page));
check('every way out, a warning\'s choices too, clears the tried state, and so does opening (AUDIT resize-page-r2, R2-L3)',
  /const applyOther = \(width: number, height: number\) => \{\s*if \(!unit\) return;\s*setOther\(null\);[\s\S]{0,120}?setOtherTried\(false\);/.test(page) &&
  /onClick=\{\(\) => \{ setOtherTried\(false\); setOther\(\{ width:/.test(page));
const resizeLayout = read('src/app/resize/layout.tsx');
check('the page has its own title and description, as HQ approved them (-102), and keeps the per-page canonical',
  /title: 'Free Pixel Art Resizer \| SpriteBrew',/.test(resizeLayout) &&
  /description: 'Resize pixel art and sprite sheets without blurring\. Shrink or grow by whole steps, free, no account, and your image never leaves your browser\.',/.test(resizeLayout) &&
  !/alternates\s*:/.test(resizeLayout) && !/\u2014/.test(resizeLayout));
const sidebar = read('src/components/layout/Sidebar.tsx');
const header = read('src/components/layout/Header.tsx');
check('the sidebar lists Resize after Edit; the header\'s title table has /resize',
  /\{ href: '\/editor', label: 'Edit', icon: Pencil, soon: false \},\s*\{ href: '\/resize', label: 'Resize', icon: Scaling, soon: false \},/.test(sidebar) &&
  /'\/resize': 'Resize',/.test(header));
check('the sidebar scrolls when it is taller than the window (AUDIT resize-page-r1, M4; r2, R2-L4)',
  /fixed top-0 left-0 z-50 flex h-full w-\[var\(--sidebar-width\)\] flex-col\s+overflow-y-auto overscroll-contain/.test(sidebar));
const landing = read('src/app/page.tsx');
check('the landing line links "resizer" to /resize (DESIGN -249)',
  /Free tools \(slicer, editor, exporter,\{' '\}\s*<Link href="\/resize"[^>]*>resizer<\/Link>\s*\) work without AI and without an account\./.test(landing));
check('no em dashes in the new files', ![page, lib, worker, read('scripts/resize-page-test.mjs')].some((s) => s.includes(String.fromCharCode(0x2014))));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
