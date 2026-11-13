// scripts/edit-save-test.mjs
//
// Offline tests for an editor save from the result card (BUILD-2, Nov 11):
//   A. src/lib/cardImage.ts: the card's image and the versions kept beside it
//   B. src/stores/spriteStore.ts: the same through the store's actions
//   C. src/components/sprites/editorStore.ts: selectHasPixelChanges, the test
//      for whether a Save has anything to write
//   D. src/lib/editorCopy.ts: the editor's words by where it was opened from
//   E. the wiring: where the card and the editor use A to D, read from their
//      source with comments stripped (audit r1, finding 5)
// Run from the repo root: `node scripts/edit-save-test.mjs`. Bundles the
// modules with esbuild into local/.edit-save-test/ (gitignored). Prints only
// case names and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
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
  const { EMPTY_CARD, newResult, saveEdit, showVersion, handOff, shownOf, deliveredOf, resultKeyOf } = card;
  const d = newResult('D');
  check('A1: a new result is the working image, nothing kept beside it', same(d, { working: 'D', original: null, edited: null, beforeEdit: null, version: null }), d);
  check('A1: shown, delivered and result key are the sheet itself', shownOf(d) === 'D' && deliveredOf(d) === 'D' && resultKeyOf(d) === 'D');

  const e1 = saveEdit(d, 'E1');
  check('A2: an editor save makes the edit the working image and keeps both sheets', same(e1, { working: 'E1', original: 'D', edited: 'E1', beforeEdit: 'D', version: 'edited' }), e1);
  check('A2: the card shows the edit; Download original still gives the delivered sheet', shownOf(e1) === 'E1' && deliveredOf(e1) === 'D');
  check('A2: the result key does not move with the edit', resultKeyOf(e1) === 'D');

  const b = showVersion(e1, 'before');
  check('A3: Before edit is a view change only: the working image stays the edit', same(b, { working: 'E1', original: 'D', edited: 'E1', beforeEdit: 'D', version: 'before' }), b);
  check('A3: the card then shows the sheet from before the edit', shownOf(b) === 'D' && deliveredOf(b) === 'D' && resultKeyOf(b) === 'D');
  check('A3: back to Edited shows the edit again', same(showVersion(b, 'edited'), e1) && shownOf(showVersion(b, 'edited')) === 'E1');
  check('A3: the version already shown is no change (same object)', showVersion(e1, 'edited') === e1 && showVersion(b, 'before') === b);
  check('A3: no editor save, no versions to show (same object)', showVersion(d, 'before') === d && showVersion(d, 'edited') === d);

  const e2 = saveEdit(e1, 'E2');
  check('A4: a second save replaces the edit only', same(e2, { working: 'E2', original: 'D', edited: 'E2', beforeEdit: 'D', version: 'edited' }), e2);
  const e3 = saveEdit(b, 'E3');
  check('A4: a save made from Before edit replaces the edit and shows it', same(e3, { working: 'E3', original: 'D', edited: 'E3', beforeEdit: 'D', version: 'edited' }), e3);

  check('A5: nothing on the card, nothing to save onto (same object)', saveEdit(EMPTY_CARD, 'E') === EMPTY_CARD);

  const h0 = handOff(d, 'D-bg');
  check('A6: a handoff image on a delivered sheet becomes the working image and keeps the sheet', same(h0, { working: 'D-bg', original: 'D', edited: null, beforeEdit: null, version: null }), h0);
  const h1 = handOff(e1, 'E1-bg');
  check('A6: a handoff image takes the place of the edit when the edit is shown', same(h1, { working: 'E1-bg', original: 'D', edited: 'E1-bg', beforeEdit: 'D', version: 'edited' }), h1);
  const h2 = handOff(b, 'D-bg');
  check('A6: and of the sheet from before when that is shown', same(h2, { working: 'D-bg', original: 'D', edited: 'E1', beforeEdit: 'D-bg', version: 'before' }), h2);
  const h3 = handOff(b, 'D');
  check('A6: handing off Before edit as it is makes it the working image; the edit is kept', same(h3, { working: 'D', original: 'D', edited: 'E1', beforeEdit: 'D', version: 'before' }) && shownOf(showVersion(h3, 'edited')) === 'E1', h3);
  check('A6: the image that is already shown and working, or an empty card, is no change (same object)', handOff(e1, 'E1') === e1 && handOff(d, 'D') === d && handOff(EMPTY_CARD, 'X') === EMPTY_CARD);

  // Edit after a handoff: the delivered sheet is still the original, and
  // Before edit is the card's sheet from before the edit (the handoff image).
  const e4 = saveEdit(h0, 'E4');
  check('A7: an edit after a handoff keeps the delivered sheet and the sheet before the edit apart', same(e4, { working: 'E4', original: 'D', edited: 'E4', beforeEdit: 'D-bg', version: 'edited' }), e4);

  // Every state reachable from a result keeps the delivered sheet and its
  // key, shows one of its versions, and moves the working image only on a
  // save or a handoff.
  let c = newResult('D'); let ok = true;
  const steps = [
    ['save', (x) => saveEdit(x, 'a')], ['switch', (x) => showVersion(x, 'before')], ['handoff', (x) => handOff(x, 'b')],
    ['save', (x) => saveEdit(x, 'c')], ['switch', (x) => showVersion(x, 'before')], ['switch', (x) => showVersion(x, 'edited')],
    ['handoff', (x) => handOff(x, 'd')], ['switch', (x) => showVersion(x, 'before')], ['handoff', (x) => handOff(x, shownOf(x))],
  ];
  for (const [kind, step] of steps) {
    const before = c;
    c = step(c);
    ok = ok && deliveredOf(c) === 'D' && resultKeyOf(c) === 'D' && shownOf(c) !== null
      && (c.version === null || (c.edited !== null && c.beforeEdit !== null))
      && (kind !== 'switch' || c.working === before.working)
      && (kind === 'switch' || c.working === shownOf(c));
  }
  check('A8: through saves, switches and handoffs: the delivered sheet and the key hold, a switch never moves the working image, a save or a handoff makes it the image shown', ok, c);
}

// ---- B. the store ----
{
  const s = () => useSpriteStore.getState();
  const view = () => ({ url: s().generatedImageUrl, working: s().generatedImageDataUrl, original: s().originalGeneratedImageDataUrl, edited: s().editedImageDataUrl, before: s().beforeEditImageDataUrl, version: s().cardVersion, error: s().generationError });
  const fresh = () => useSpriteStore.setState(useSpriteStore.getInitialState(), true);

  fresh();
  s().setGeneratedImage('U', 'D');
  check('B1: a new result: the working image, its url kept, nothing beside it', same(view(), { url: 'U', working: 'D', original: null, edited: null, before: null, version: null, error: null }), view());

  s().setGenerationError('boom');
  s().saveEditedImage('E1');
  check('B2: an editor save: the edit is the working image, both sheets kept, the error cleared', same(view(), { url: 'E1', working: 'E1', original: 'D', edited: 'E1', before: 'D', version: 'edited', error: null }), view());

  // A switch is a view change: what the Slicer, the Animator and the forms
  // read (generatedImageDataUrl) and an error notice stay as they are.
  s().setGenerationError('not enough tokens');
  s().showCardVersion('before');
  check('B3: Before edit changes cardVersion only: the working image and the error notice stay', same(view(), { url: 'E1', working: 'E1', original: 'D', edited: 'E1', before: 'D', version: 'before', error: 'not enough tokens' }), view());
  const held = s();
  s().showCardVersion('before');
  check('B3: the version already shown changes nothing (same state object)', s() === held);
  s().showCardVersion('edited');
  check('B3: Edited again: still only cardVersion moves', same(view(), { url: 'E1', working: 'E1', original: 'D', edited: 'E1', before: 'D', version: 'edited', error: 'not enough tokens' }), view());

  s().setWorkingImage('E1-bg');
  check('B4: a handoff image becomes the working image, takes the edit\'s place, keeps the delivered sheet and clears the error', same(view(), { url: 'E1-bg', working: 'E1-bg', original: 'D', edited: 'E1-bg', before: 'D', version: 'edited', error: null }), view());
  s().showCardVersion('before');
  s().setWorkingImage('D');
  check('B4: handing off Before edit makes it the working image and keeps the edit', same(view(), { url: 'D', working: 'D', original: 'D', edited: 'E1-bg', before: 'D', version: 'before', error: null }), view());

  s().setGeneratedImage('U2', 'D2');
  check('B5: a new result drops every kept version', same(view(), { url: 'U2', working: 'D2', original: null, edited: null, before: null, version: null, error: null }), view());

  s().saveEditedImage('E');
  s().clearGeneratedImage();
  check('B6: clearing the card drops the image and every kept version', same(view(), { url: null, working: null, original: null, edited: null, before: null, version: null, error: null }), view());

  const empty = s();
  s().saveEditedImage('E'); s().setWorkingImage('X'); s().showCardVersion('edited');
  check('B7: with no result on the card the three actions change nothing (same state object)', s() === empty);

  fresh();
  s().setGeneratedImage('D', 'D');
  const delivered = s();
  s().setWorkingImage('D');
  check('B8: handing off the image already shown and working changes nothing (same state object)', s() === delivered);
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
  // An unknown baseline counts as changed: a Save never drops work.
  st().loadFrame('current', px(16, 200), 4, 4);
  useEditorStore.setState({ originalPixels: null });
  check('C7: with the loaded image unknown, there is something to save', selectHasPixelChanges(st()) === true);
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

// ---- E. the wiring (source with comments stripped) ----
{
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const read = (rel) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const cardSrc = read('src/components/sprites/GenerationResult.tsx');
  const body = read('src/components/sprites/PixelEditorBody.tsx');
  const modal = read('src/components/sprites/PixelEditor.tsx');
  // The text of one `const name = useCallback(...)` up to its dependency list.
  const fn = (src, name) => {
    const at = src.indexOf(`const ${name} = useCallback(`);
    if (at < 0) return '';
    const end = src.indexOf('\n  }, [', at);
    return end < 0 ? '' : src.slice(at, src.indexOf(']);', end) + 3);
  };

  const headerSave = fn(body, 'doSaveAndDismiss');
  check('E1: the header Save writes by pixels, not by the history index', /if \(selectHasPixelChanges\(useEditorStore\.getState\(\)\)\) \{\s*const dataUrl = renderToDataUrl\(\);\s*if \(dataUrl\) onSave\(dataUrl\);/.test(headerSave) && !/historyIndex/.test(headerSave), headerSave.length);
  const dialogSave = fn(modal, 'saveAndCloseFromConfirm');
  check('E2: Save and close writes by pixels, not by the history index', /if \(state\.pixels && selectHasPixelChanges\(state\)\) \{\s*onSave\(pixelsToPngDataUrl\(state\.pixels, state\.width, state\.height\)\);/.test(dialogSave) && !/historyIndex/.test(dialogSave), dialogSave.length);

  const save = fn(cardSrc, 'handleEditorSave');
  check('E3: the card\'s editor save goes through saveEditedImage', /saveEditedImage\(editedDataUrl\);/.test(save) && !/setWorkingImage|setGeneratedImage/.test(save), save.length);
  check('E3: the card never starts a new result itself', !/setGeneratedImage/.test(cardSrc));
  check('E4: the card shows shownOf(card), keys by resultKeyOf(card) and downloads deliveredOf(card)', /const generatedImageDataUrl = shownOf\(card\);/.test(cardSrc) && /const resultKey = resultKeyOf\(card\);/.test(cardSrc) && /const delivered = deliveredOf\(card\);/.test(fn(cardSrc, 'handleDownloadOriginal')));
  check('E4: the card\'s working image is the store\'s generatedImageDataUrl, read under another name', /const workingImageDataUrl = useSpriteStore\(\(s\) => s\.generatedImageDataUrl\);/.test(cardSrc) && /working: workingImageDataUrl,/.test(cardSrc));
  check('E5: the view, the loop and the zoom are held per result', /sheetViewSrc !== resultKey/.test(cardSrc) && /setSheetViewSrc\(view === 'sheet' \? resultKey : null\)/.test(cardSrc) && /loopEdit\.src === resultKey/.test(cardSrc) && /setLoopEdit\(\{ src: resultKey,/.test(cardSrc) && /lastDefaultZoomSrcRef\.current === resultKey/.test(cardSrc));
  check('E5: the card\'s size is reset for a new result only', /if \(dimsResultKeyRef\.current !== resultKey\) setNaturalDims\(\{ w: 0, h: 0 \}\);\s*dimsResultKeyRef\.current = resultKey;/.test(cardSrc) && (cardSrc.match(/setNaturalDims\(\{ w: 0, h: 0 \}\)/g) ?? []).length === 1);
  check('E5: the transparency answer stands for the result while a version\'s own is read', /sheetAlpha\.src === generatedImageDataUrl \|\| sheetAlpha\.key === resultKey/.test(cardSrc) && /setSheetAlpha\(\{ src, key, transparent:/.test(cardSrc));
  const sw = fn(cardSrc, 'handleShowVersion');
  check('E6: the switch is a named group of pressed buttons that goes through handleShowVersion', /role="group" aria-label="Version"/.test(cardSrc) && /onClick=\{\(\) => handleShowVersion\(version\)\}\s*aria-pressed=\{selected\}/.test(cardSrc) && /\['edited', 'Edited'\], \['before', 'Before edit'\]/.test(cardSrc));
  check('E6: a switch shows the version and drops the notes made for the other one', /if \(version === cardVersion\) return;\s*showCardVersion\(version\);\s*setAnnouncedEdit\(null\);\s*setSheetReady\(null\);\s*setGifReady\(null\);\s*setSheetFailedSrc\(null\);\s*setGifError\(null\);/.test(sw), sw.length);
  const slicer = fn(cardSrc, 'handleSendToSlicer');
  const animator = fn(cardSrc, 'handleSendToAnimator');
  const handed = /const handed = bgRemovalActive && bgRemovedDataUrl \? bgRemovedDataUrl : generatedImageDataUrl;\s*if \(handed\) setWorkingImage\(handed\);/;
  check('E7: Send to Slicer and Send to Animator hand over the version shown', handed.test(slicer) && handed.test(animator));
  check('E8: each save is announced one frame later, and the note is one polite line', /setAnnouncedEdit\(null\);[\s\S]*requestAnimationFrame\(\(\) => \{\s*announceFrameRef\.current = null;\s*setAnnouncedEdit\(editedDataUrl\);/.test(save) && /'Your edit is on the card\. Before edit is one tap away\.'/.test(cardSrc) && /<p className="sr-only" role="status">\{editNote\}<\/p>/.test(cardSrc));

  const labels = ['Discard changes', 'Keep editing', 'Save and close'].map((t) => modal.indexOf(`\n                ${t}\n`));
  check('E9: the dialog\'s buttons come in Tab order Discard changes, Keep editing, Save and close', labels.every((i) => i > 0) && labels[0] < labels[1] && labels[1] < labels[2], labels);
  const lastButton = modal.slice(modal.lastIndexOf('<button', labels[2]), labels[2]);
  check('E9: focus starts on Save and close, and every button is 44 px on touch at any width', /^<button\s+autoFocus\s/.test(lastButton) && (modal.match(/autoFocus/g) ?? []).length === 1 && (modal.match(/min-h-11 sm:min-h-0 sm:pointer-coarse:min-h-11/g) ?? []).length === 3, lastButton.slice(0, 40));
  check('E9: the dialog\'s text comes from editorCopy, by source', /\{unsavedEditsText\(source\)\}/.test(modal) && !/You have unsaved pixel edits/.test(modal));
  check('E10: the header\'s download button is named by its label and described by the hidden hint', /aria-label=\{DOWNLOAD_PNG_LABEL\}\s*aria-describedby=\{downloadHintId\}\s*title=\{downloadHint\}/.test(body) && /<span id=\{downloadHintId\} hidden>\{downloadHint\}<\/span>/.test(body) && /const downloadHint = downloadPngHint\(source\);/.test(body));
}

console.log(failed === 0 ? '\nall pass' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
