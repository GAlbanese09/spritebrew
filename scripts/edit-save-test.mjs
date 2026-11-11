// scripts/edit-save-test.mjs
//
// Offline tests for an editor save from the result card (BUILD-2, Nov 11):
//   A. src/lib/cardImage.ts: the card's image and the versions kept beside it
//   B. src/stores/spriteStore.ts: the same through the store's actions
//   C. src/components/sprites/editorStore.ts: selectHasPixelChanges, the test
//      for whether a Save has anything to write
//   D. src/lib/editorCopy.ts: the editor's words by where it was opened from
// Run from the repo root: `node scripts/edit-save-test.mjs`. Bundles the
// modules with esbuild into local/.edit-save-test/ (gitignored). Prints only
// case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.edit-save-test');
async function load(entry) {
  const outfile = path.join(OUT, path.basename(entry).replace(/\.tsx?$/, '.mjs'));
  await build({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}
const card = await load('src/lib/cardImage.ts');
const { useSpriteStore } = await load('src/stores/spriteStore.ts');
const editor = await load('src/components/sprites/editorStore.ts');
const copy = await load('src/lib/editorCopy.ts');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- A. cardImage ----
{
  const { EMPTY_CARD, newResult, saveEdit, showVersion, replaceShown, deliveredOf, resultKeyOf } = card;
  const d = newResult('D');
  check('A1: a new result is shown as delivered, nothing kept', same(d, { shown: 'D', original: null, edited: null, beforeEdit: null, version: null }), d);
  check('A1: delivered and result key are the sheet itself', deliveredOf(d) === 'D' && resultKeyOf(d) === 'D');

  const e1 = saveEdit(d, 'E1');
  check('A2: an editor save shows the edit and keeps both sheets', same(e1, { shown: 'E1', original: 'D', edited: 'E1', beforeEdit: 'D', version: 'edited' }), e1);
  check('A2: Download original still gives the delivered sheet', deliveredOf(e1) === 'D');
  check('A2: the result key does not move with the edit', resultKeyOf(e1) === 'D');

  const b = showVersion(e1, 'before');
  check('A3: Before edit shows the sheet from before the edit, the edit kept', same(b, { shown: 'D', original: 'D', edited: 'E1', beforeEdit: 'D', version: 'before' }), b);
  check('A3: back to Edited shows the edit again', same(showVersion(b, 'edited'), e1));
  check('A3: the version already shown is no change (same object)', showVersion(e1, 'edited') === e1 && showVersion(b, 'before') === b);
  check('A3: no editor save, no versions to show (same object)', showVersion(d, 'before') === d && showVersion(d, 'edited') === d);

  const e2 = saveEdit(e1, 'E2');
  check('A4: a second save replaces the edit only', same(e2, { shown: 'E2', original: 'D', edited: 'E2', beforeEdit: 'D', version: 'edited' }), e2);
  const e3 = saveEdit(b, 'E3');
  check('A4: a save made from Before edit replaces the edit and shows it', same(e3, { shown: 'E3', original: 'D', edited: 'E3', beforeEdit: 'D', version: 'edited' }), e3);

  check('A5: nothing on the card, nothing to save onto (same object)', saveEdit(EMPTY_CARD, 'E') === EMPTY_CARD);

  const h0 = replaceShown(d, 'D-bg');
  check('A6: a handoff image on a delivered sheet keeps the sheet for Download original', same(h0, { shown: 'D-bg', original: 'D', edited: null, beforeEdit: null, version: null }), h0);
  const h1 = replaceShown(e1, 'E1-bg');
  check('A6: a handoff image takes the place of the edit when the edit is shown', same(h1, { shown: 'E1-bg', original: 'D', edited: 'E1-bg', beforeEdit: 'D', version: 'edited' }), h1);
  const h2 = replaceShown(b, 'D-bg');
  check('A6: and of the sheet from before when that is shown', same(h2, { shown: 'D-bg', original: 'D', edited: 'E1', beforeEdit: 'D-bg', version: 'before' }), h2);
  check('A6: the image already shown, or an empty card, is no change (same object)', replaceShown(e1, 'E1') === e1 && replaceShown(EMPTY_CARD, 'X') === EMPTY_CARD);

  // Edit after a handoff: the delivered sheet is still the original, and
  // Before edit is the card's sheet from before the edit (the handoff image).
  const e4 = saveEdit(h0, 'E4');
  check('A7: an edit after a handoff keeps the delivered sheet and the sheet before the edit apart', same(e4, { shown: 'E4', original: 'D', edited: 'E4', beforeEdit: 'D-bg', version: 'edited' }), e4);

  // Every state reachable from a result keeps the delivered sheet and its key.
  let c = newResult('D'); let ok = true;
  for (const step of [(x) => saveEdit(x, 'a'), (x) => showVersion(x, 'before'), (x) => replaceShown(x, 'b'), (x) => saveEdit(x, 'c'), (x) => showVersion(x, 'before'), (x) => showVersion(x, 'edited'), (x) => replaceShown(x, 'd')]) {
    c = step(c);
    ok = ok && deliveredOf(c) === 'D' && resultKeyOf(c) === 'D' && c.shown !== null && (c.version === null || c.shown === (c.version === 'edited' ? c.edited : c.beforeEdit));
  }
  check('A8: through saves, switches and handoffs the delivered sheet, the key and the shown version hold', ok, c);
}

// ---- B. the store ----
{
  const s = () => useSpriteStore.getState();
  const view = () => ({ url: s().generatedImageUrl, shown: s().generatedImageDataUrl, original: s().originalGeneratedImageDataUrl, edited: s().editedImageDataUrl, before: s().beforeEditImageDataUrl, version: s().cardVersion, error: s().generationError });
  const fresh = () => useSpriteStore.setState(useSpriteStore.getInitialState(), true);

  fresh();
  s().setGeneratedImage('U', 'D');
  check('B1: a new result: shown, its url kept, nothing beside it', same(view(), { url: 'U', shown: 'D', original: null, edited: null, before: null, version: null, error: null }), view());

  s().setGenerationError('boom');
  s().saveEditedImage('E1');
  check('B2: an editor save: the edit shown, both sheets kept, the error cleared', same(view(), { url: 'E1', shown: 'E1', original: 'D', edited: 'E1', before: 'D', version: 'edited', error: null }), view());

  s().showCardVersion('before');
  check('B3: Before edit shows the sheet from before', view().shown === 'D' && view().version === 'before' && view().edited === 'E1', view());
  const held = s();
  s().showCardVersion('before');
  check('B3: the version already shown changes nothing (same state object)', s() === held);
  s().showCardVersion('edited');
  check('B3: Edited shows the edit again', view().shown === 'E1' && view().version === 'edited', view());

  s().setWorkingImage('E1-bg');
  check('B4: a handoff image takes the edit\'s place and keeps the delivered sheet', same(view(), { url: 'E1-bg', shown: 'E1-bg', original: 'D', edited: 'E1-bg', before: 'D', version: 'edited', error: null }), view());

  s().setGeneratedImage('U2', 'D2');
  check('B5: a new result drops every kept version', same(view(), { url: 'U2', shown: 'D2', original: null, edited: null, before: null, version: null, error: null }), view());

  s().saveEditedImage('E');
  s().clearGeneratedImage();
  check('B6: clearing the card drops the image and every kept version', same(view(), { url: null, shown: null, original: null, edited: null, before: null, version: null, error: null }), view());

  const empty = s();
  s().saveEditedImage('E'); s().setWorkingImage('X'); s().showCardVersion('edited');
  check('B7: with no result on the card the three actions change nothing (same state object)', s() === empty);
}

// ---- C. selectHasPixelChanges ----
{
  // loadFrame builds an ImageData for the document model; node has none.
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  }
  const { useEditorStore, selectHasPixelChanges } = editor;
  const st = () => useEditorStore.getState();
  const px = (n, v = 0) => new Uint8ClampedArray(n * 4).fill(v);
  st().reset();
  check('C1: an empty editor has nothing to save', selectHasPixelChanges(st()) === false);
  st().loadFrame('current', px(16, 200), 4, 4);
  check('C2: a freshly loaded image has nothing to save', selectHasPixelChanges(st()) === false && st().historyIndex === 0);
  st().beginStroke(); st().erasePixel(1, 1); st().endStroke();
  check('C3: one stroke is a change', selectHasPixelChanges(st()) === true);
  st().undo();
  check('C4: undone back to the loaded image: nothing to save', selectHasPixelChanges(st()) === false);
  // More steps than the history keeps, then Undo to the oldest kept step:
  // the index reads 0 while the canvas still holds edits.
  for (let i = 0; i < 60; i++) { st().beginStroke(); st().paintPixel(i % 4, Math.floor(i / 4) % 4, i % 2 ? '#ff0000' : '#00ff00'); st().endStroke(); }
  while (st().historyIndex > 0) st().undo();
  check('C5: past the history cap, Undo to the oldest kept step: index 0, edits still there, still a change', st().historyIndex === 0 && selectHasPixelChanges(st()) === true);
  st().revertToOriginal();
  check('C6: reverted to the loaded image: nothing to save, whatever the index', selectHasPixelChanges(st()) === false && st().historyIndex > 0);
  st().reset();
}

// ---- D. editorCopy ----
{
  const { saveTargetOf, downloadPngHint, unsavedEditsText, DOWNLOAD_PNG_LABEL, DOWNLOAD_PNG_SHORT } = copy;
  check('D1: the save target by source', saveTargetOf({ kind: 'generation' }) === 'card' && saveTargetOf({ kind: 'sheet-import' }) === 'frame' && saveTargetOf({ kind: 'upload' }) === 'image' && saveTargetOf(undefined) === 'image' && saveTargetOf(null) === 'image');
  check('D2: the card\'s words are DESIGN\'s', downloadPngHint({ kind: 'generation' }) === 'Download a PNG of this edit. The card changes only when you Save.' && unsavedEditsText({ kind: 'generation' }) === 'Your edits are not on the card yet. Save and close to use them.');
  check('D3: a frame and any other image never say "card"', [{ kind: 'sheet-import' }, { kind: 'upload' }, { kind: 'blank' }, { kind: 'gallery' }, undefined].every((src) => !/card/i.test(downloadPngHint(src)) && !/card/i.test(unsavedEditsText(src))));
  check('D4: the visible label is inside the name, short and long', DOWNLOAD_PNG_LABEL === 'Download PNG' && DOWNLOAD_PNG_LABEL.includes(DOWNLOAD_PNG_SHORT));
  check('D5: no em dash in any string', [downloadPngHint({ kind: 'generation' }), downloadPngHint(undefined), downloadPngHint({ kind: 'sheet-import' }), unsavedEditsText({ kind: 'generation' }), unsavedEditsText(undefined), unsavedEditsText({ kind: 'sheet-import' })].every((t) => !t.includes(String.fromCharCode(0x2014))));
}

console.log(failed === 0 ? '\nall pass' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
