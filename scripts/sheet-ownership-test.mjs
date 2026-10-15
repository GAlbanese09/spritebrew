// scripts/sheet-ownership-test.mjs
//
// Offline tests for completion-time ownership on /upload: the sprite store's
// sheetVersion and replaceSheetSource guard (src/stores/spriteStore.ts) and
// the decision in src/lib/sheetOwnership.ts. Run from the repo root:
// `node scripts/sheet-ownership-test.mjs`.
//
// Each case is ordered: an async operation captures its token, a newer action
// may land, then the operation completes. The land* helpers make the same
// calls upload/page.tsx makes when that operation completes; the store and
// the ownership decision are the real modules. The harness writes only its
// esbuild bundle, to local/.sheet-ownership-test (gitignored), and prints
// only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.sheet-ownership-test');

await build({
  entryPoints: {
    spriteStore: path.join(ROOT, 'src/stores/spriteStore.ts'),
    sheetOwnership: path.join(ROOT, 'src/lib/sheetOwnership.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
});
const load = (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const { useSpriteStore } = await load('spriteStore');
const { createSheetOwnership } = await load('sheetOwnership');

let pass = 0, fail = 0;
const check = (name, ok) => {
  if (ok) { pass++; console.log(`pass  ${name}`); } else { fail++; console.log(`FAIL  ${name}`); }
};

const store = () => useSpriteStore.getState();
const INITIAL = useSpriteStore.getState();
const reset = () => useSpriteStore.setState(INITIAL, true);
/** A fresh page: its own epoch, reading the real store's sheetVersion. */
const newPage = () => createSheetOwnership(() => useSpriteStore.getState().sheetVersion);

// ── Fixtures ──

function makeSheet(name, n) {
  const frames = Array.from({ length: n }, (_, i) => ({
    id: `${name}_f${i}`, imageData: null, x: i * 16, y: 0, width: 16, height: 16, duration: 125,
  }));
  const spriteSheet = {
    id: `sheet-${name}`, name, sourceImage: `blob:https://example.invalid/${name}`,
    frameWidth: 16, frameHeight: 16, columns: n, rows: 1, totalFrames: n, padding: 0,
    animations: [{ id: 'all-frames', name: 'All Frames', type: 'all', frames, fps: 8, loop: true }],
  };
  const urls = new Map(frames.map((f) => [f.id, `data:image/png;base64,${name}-${f.id}`]));
  return { spriteSheet, frames, urls };
}

/** Sheet A as saved on this device: one group, frame URLs, style and hints. */
function savedSessionA() {
  const { spriteSheet, frames, urls } = makeSheet('A', 4);
  return {
    spriteSheet,
    animations: [{ id: 'anim_walk', name: 'Walk', type: 'walk', fps: 10, loop: true, frames: [frames[0], frames[1], frames[2]] }],
    frameDataUrls: urls,
    currentSheetMetadata: { source: 'animate', animationType: 'walk', frameCount: 4, directional: false, rows: 1, cols: 4 },
    generationStyle: 'any_animation_walk',
  };
}

/** Same references for the sheet, groups and frame map as `before`. */
const sameSheet = (before) => {
  const s = store();
  return s.spriteSheet === before.spriteSheet && s.animations === before.animations && s.frameDataUrls === before.frameDataUrls;
};

// ── The completions, as upload/page.tsx makes them ──

/** Mount effect, img.onload of the generated image. */
function landGeneratedImage(page, token) {
  if (!page.isCurrent(token)) return 'stale';
  const { generationStyle, currentSheetMetadata, setGenerationStyle, setCurrentSheetMetadata } = store();
  store().clearSpriteSheet();
  setGenerationStyle(generationStyle);
  setCurrentSheetMetadata(currentSheetMetadata);
  return 'applied';
}

/** handleBgRemoved, reextractFrames(...).then: through the store's guard. */
function landReextract(page, token, cleaned, urls) {
  return page.isCurrent(token) && store().replaceSheetSource(cleaned, urls, token.sheetVersion) ? 'applied' : 'stale';
}

/** sliceGrid, after its image loads. */
function landSlice(page, token, sheet, urls) {
  if (!page.isCurrent(token)) return 'stale';
  store().setSpriteSheet(sheet);
  store().setFrameDataUrls(urls);
  return 'applied';
}

/** handleLoadStart: UploadZone started reading a file. */
function startFile(page, file) {
  page.bump();
  return { file, token: page.capture() };
}

/** handleImageLoaded: UploadZone finished reading `file` (no groups, so no
 *  confirm). `started` is the page's last handleLoadStart. */
function landFile(page, started, file) {
  if (!started || started.file !== file || !page.isCurrent(started.token)) return 'stale';
  store().clearSpriteSheet();
  return 'applied';
}

/** handleRestoreSheet: the Restore click, then restore()'s check once the
 *  saved session has loaded. */
function startRestore(page) {
  page.bump();
  return page.capture();
}
function landRestore(page, token, session) {
  if (store().spriteSheet || !page.isCurrent(token)) return 'stale';
  store().restoreSheetSession(session);
  return 'applied';
}

// ── A: the generated image lands after the user restored a saved sheet ──

reset();
{
  const page = newPage();
  const token = page.capture(); // load() starts, store empty
  const A = savedSessionA();
  store().restoreSheetSession(A); // user clicks Restore while the image loads
  const before = { spriteSheet: store().spriteSheet, animations: store().animations, frameDataUrls: store().frameDataUrls };
  const result = landGeneratedImage(page, token);
  check('A ordered: generated image lands after Restore: the restored sheet, groups and frame URLs are kept',
    sameSheet(before) && store().spriteSheet === A.spriteSheet && store().animations.length === 1 &&
    store().frameDataUrls.size === 4 && store().generationStyle === 'any_animation_walk');
  check('A ordered: the completion reports stale', result === 'stale');
}

reset();
{
  const page = newPage();
  store().setGenerationStyle('rd_pro__default');
  store().setCurrentSheetMetadata({ source: 'create', frameCount: 4, rows: 2, cols: 2 });
  const token = page.capture(); // load() starts, store empty
  const result = landGeneratedImage(page, token);
  check('A with no newer action: the generated image applies, style and slicer hints kept',
    result === 'applied' && store().spriteSheet === null &&
    store().generationStyle === 'rd_pro__default' && store().currentSheetMetadata?.frameCount === 4);
}

// ── B: background removal's re-cut for sheet A resolves after sheet B ──

reset();
{
  const page = newPage();
  const A = makeSheet('A', 4);
  store().setSpriteSheet(A.spriteSheet);
  store().setFrameDataUrls(A.urls);
  page.bump(); // Apply on the banner
  const token = page.capture(); // reextractFrames(cleaned, A) starts
  const B = makeSheet('B', 6);
  store().setSpriteSheet(B.spriteSheet); // user re-slices
  store().setFrameDataUrls(B.urls);
  const before = { spriteSheet: store().spriteSheet, animations: store().animations, frameDataUrls: store().frameDataUrls };
  const recut = new Map(A.frames.map((f) => [f.id, 'data:image/png;base64,cleaned']));
  const applied = store().replaceSheetSource('data:image/png;base64,cleanedA', recut, token.sheetVersion);
  check('B ordered: replaceSheetSource for A returns false once B is installed', applied === false);
  check("B ordered: B's sheet, frames and frame-URL map are unchanged",
    sameSheet(before) && store().spriteSheet === B.spriteSheet &&
    store().spriteSheet.sourceImage === B.spriteSheet.sourceImage && store().frameDataUrls === B.urls &&
    B.frames.every((f) => store().frameDataUrls.has(f.id)));
  check('B ordered: the page drops it too (stale)', landReextract(page, token, 'data:image/png;base64,cleanedA', recut) === 'stale');
}

reset();
{
  const page = newPage();
  const A = makeSheet('A', 4);
  store().setSpriteSheet(A.spriteSheet);
  store().setFrameDataUrls(A.urls);
  store().addAnimation({ id: 'anim_idle', name: 'Idle', type: 'idle', fps: 4, loop: true, frames: [A.frames[0]] });
  const groups = store().animations;
  page.bump();
  const token = page.capture();
  const recut = new Map(A.frames.map((f) => [f.id, 'data:image/png;base64,cleaned']));
  const result = landReextract(page, token, 'data:image/png;base64,cleanedA', recut);
  check('B with no newer action: the re-cut applies, groups kept, frames and source swapped',
    result === 'applied' && store().frameDataUrls === recut && store().animations === groups &&
    store().spriteSheet.id === 'sheet-A' && store().spriteSheet.sourceImage === 'data:image/png;base64,cleanedA');
}

// ── Grid slice (sliceGrid): its image load is the async step ──

reset();
{
  const page = newPage();
  page.bump(); // Slice click
  const token = page.capture();
  const restoreToken = startRestore(page); // user clicks Restore before the image loads
  const A = savedSessionA();
  const restored = landRestore(page, restoreToken, A);
  const before = { spriteSheet: store().spriteSheet, animations: store().animations, frameDataUrls: store().frameDataUrls };
  const X = makeSheet('X', 8);
  const result = landSlice(page, token, X.spriteSheet, X.urls);
  check('slice lands after Restore: stale, the restored sheet and groups kept',
    restored === 'applied' && result === 'stale' && sameSheet(before) && store().animations.length === 1);
}

reset();
{
  const page = newPage();
  page.bump(); // first Slice click
  const t1 = page.capture();
  page.bump(); // second Slice click before the first lands
  const t2 = page.capture();
  const S1 = makeSheet('S1', 4);
  const S2 = makeSheet('S2', 6);
  const r2 = landSlice(page, t2, S2.spriteSheet, S2.urls);
  const r1 = landSlice(page, t1, S1.spriteSheet, S1.urls);
  check('two slices: the older one landing last is dropped, the newer one stays',
    r2 === 'applied' && r1 === 'stale' && store().spriteSheet === S2.spriteSheet && store().frameDataUrls === S2.urls);
}

reset();
{
  const page = newPage();
  page.bump();
  const token = page.capture();
  const X = makeSheet('X', 8);
  check('slice with no newer action applies',
    landSlice(page, token, X.spriteSheet, X.urls) === 'applied' && store().spriteSheet === X.spriteSheet && store().frameDataUrls === X.urls);
}

// ── File load (UploadZone reads the file, then handleImageLoaded) ──

reset();
{
  const page = newPage();
  const F = { name: 'f.png' };
  const started = startFile(page, F);
  const restoreToken = startRestore(page); // Restore before the file is read
  const A = savedSessionA();
  landRestore(page, restoreToken, A);
  const before = { spriteSheet: store().spriteSheet, animations: store().animations, frameDataUrls: store().frameDataUrls };
  check('file read lands after Restore: stale, the restored sheet and groups kept',
    landFile(page, started, F) === 'stale' && sameSheet(before) && store().spriteSheet === A.spriteSheet);
}

for (const order of [['F2', 'F1'], ['F1', 'F2']]) {
  reset();
  const page = newPage();
  const files = { F1: { name: 'big.png' }, F2: { name: 'small.png' } };
  startFile(page, files.F1);
  const latest = startFile(page, files.F2); // the page keeps only the last file started
  const results = Object.fromEntries(order.map((k) => [k, landFile(page, latest, files[k])]));
  check(`two files, ${order[0]} read first: the second file applies, the first is dropped`,
    results.F2 === 'applied' && results.F1 === 'stale');
}

reset();
{
  const page = newPage();
  const F = { name: 'f.png' };
  const started = startFile(page, F);
  check('file read with no newer action applies', landFile(page, started, F) === 'applied');
}

// ── Background removal's own image load (handleBgRemoved, img.onload) ──

reset();
{
  const page = newPage();
  page.bump(); // Apply
  const token = page.capture();
  startFile(page, { name: 'new.png' }); // user drops a new file before the cleaned image loads
  check('cleaned image lands after a newer file: stale (no swap, no clear)', !page.isCurrent(token));
}

reset();
{
  const page = newPage();
  page.bump();
  const token = page.capture();
  check('cleaned image with no newer action is current', page.isCurrent(token));
}

// ── Restore flow (handleRestoreSheet, then restore() once the session loads) ──

reset();
{
  const page = newPage();
  const token = startRestore(page);
  const F = { name: 'f.png' };
  const started = startFile(page, F); // user drops a file while the saved session loads
  const applied = landFile(page, started, F);
  const versionAfterFile = store().sheetVersion;
  const result = landRestore(page, token, savedSessionA());
  check('restore lands after a newer file: stale, nothing restored',
    applied === 'applied' && result === 'stale' && store().spriteSheet === null && store().sheetVersion === versionAfterFile);
}

reset();
{
  const page = newPage();
  const token = startRestore(page);
  const A = savedSessionA();
  check('restore with no newer action applies',
    landRestore(page, token, A) === 'applied' && store().spriteSheet === A.spriteSheet && store().animations === A.animations);
}

// ── Unmount ──

reset();
{
  const page = newPage();
  const S = makeSheet('S', 4);
  store().setSpriteSheet(S.spriteSheet);
  store().setFrameDataUrls(S.urls);
  const before = { spriteSheet: store().spriteSheet, animations: store().animations, frameDataUrls: store().frameDataUrls };
  const token = page.capture(); // load() starts for a new generated image
  page.bump(); // the page unmounts before it lands
  check('page unmounts before the generated image lands: stale, the store keeps its sheet',
    landGeneratedImage(page, token) === 'stale' && sameSheet(before));
}

// ── sheetVersion moves on every wholesale action, and only on those ──

reset();
{
  const v = () => store().sheetVersion;
  const S = makeSheet('S', 4);
  const steps = [];
  const step = (name, fn, moves) => { const b = v(); fn(); steps.push((v() !== b) === moves); };
  check('sheetVersion starts at 0', v() === 0);
  step('setSpriteSheet', () => store().setSpriteSheet(S.spriteSheet), true);
  step('setFrameDataUrls', () => store().setFrameDataUrls(S.urls), true);
  step('replaceSheetSource (current)', () => store().replaceSheetSource('data:x', new Map(S.urls), v()), true);
  step('replaceSheetSource (stale)', () => store().replaceSheetSource('data:y', new Map(), v() - 1), false);
  step('addAnimation', () => store().addAnimation({ id: 'g', name: 'G', type: 'custom', fps: 8, loop: true, frames: [] }), false);
  step('assignFramesToAnimation', () => store().assignFramesToAnimation('g', [S.frames[0].id]), false);
  step('updateFrameData', () => store().updateFrameData(S.frames[0].id, 'data:edited'), false);
  step('setSelectedFrames', () => store().setSelectedFrames([S.frames[1].id]), false);
  step('restoreSheetSession', () => store().restoreSheetSession(savedSessionA()), true);
  step('clearSpriteSheet', () => store().clearSpriteSheet(), true);
  check('sheetVersion moves on setSpriteSheet, setFrameDataUrls, replaceSheetSource, restoreSheetSession and clearSpriteSheet, not on group or frame edits',
    steps.length === 10 && steps.every(Boolean));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
