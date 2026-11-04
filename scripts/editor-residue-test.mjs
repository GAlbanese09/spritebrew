// scripts/editor-residue-test.mjs
//
// Offline tests for the pixel editor store's cleanResidue action
// (src/components/sprites/editorStore.ts; George, Oct 31; HQ 2026-10-31-057):
// one undoable history entry that cleans the purple residue, a no-op when
// there is none, and undo and redo around it. Run from the repo root:
// `node scripts/editor-residue-test.mjs`. Bundles the real store with esbuild
// (zustand external) into local/.editor-residue-test/ (gitignored) and prints
// only case names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.editor-residue-test');

await build({
  entryPoints: {
    editorStore: path.join(ROOT, 'src/components/sprites/editorStore.ts'),
    spriteProject: path.join(ROOT, 'src/lib/spriteProject.ts'),
  },
  bundle: true, platform: 'node', format: 'esm', outdir: OUT, logLevel: 'error',
  tsconfig: path.join(ROOT, 'tsconfig.json'), outExtension: { '.js': '.mjs' },
  external: ['zustand', 'zustand/*'],
});
const load = (name) => import(pathToFileURL(path.join(OUT, `${name}.mjs`)).href);
const { useEditorStore } = await load('editorStore');
const { createBlankProject } = await load('spriteProject');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const s = () => useEditorStore.getState();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// A 10 x 10 frame: a green body (2..7) with a 1 px ring of George's goblin
// residue (176,41,177) round it, as an animation frame comes back.
const W = 10, H = 10;
function frame(ring) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const body = x >= 2 && x <= 7 && y >= 2 && y <= 7;
    const edge = x >= 1 && x <= 8 && y >= 1 && y <= 8;
    if (body) px.set([60, 140, 50, 255], (y * W + x) * 4);
    else if (edge && ring) px.set([176, 41, 177, 255], (y * W + x) * 4);
  }
  return px;
}
const project = () => createBlankProject({ width: W, height: H, name: 'residue test' });

check('loads the frame with residue', s().loadProject(project(), frame(true)) === true);
const loadedPixels = Array.from(s().pixels);
let rev = s().revision;
let idx = s().historyIndex;
const r = s().cleanResidue();
check('clean: the 28 ring pixels cleared', r.cleared === 28 && r.despilled === 0, r);
check('clean: pixels match the frame without the ring', same(Array.from(s().pixels), Array.from(frame(false))));
check('clean: one history entry, revision raised once', s().historyIndex === idx + 1 && s().revision === rev + 1);
check('clean: counts as an edit', s().hasAttemptedEdit === true);

rev = s().revision;
idx = s().historyIndex;
const r2 = s().cleanResidue();
check('a second clean: nothing, no entry, revision unchanged', r2.cleared === 0 && r2.despilled === 0 && s().historyIndex === idx && s().revision === rev, r2);

s().undo();
check('undo brings the ring back', same(Array.from(s().pixels), loadedPixels));
s().redo();
check('redo cleans it again', same(Array.from(s().pixels), Array.from(frame(false))));

check('loads a frame without residue', s().loadProject(project(), frame(false)) === true);
rev = s().revision;
idx = s().historyIndex;
const r3 = s().cleanResidue();
check('no residue: a no-op', r3.cleared === 0 && r3.despilled === 0 && s().historyIndex === idx && s().revision === rev && s().hasAttemptedEdit === false, r3);

// Audit r1 (BUILD-2, W2): a clean after an undo drops the redo branch, as
// a stroke does, and the history stays capped at 50 entries.
check('reloads the frame with residue', s().loadProject(project(), frame(true)) === true);
s().beginStroke();
s().paintPixel(4, 4, '#ff0000');
s().endStroke();
s().undo();
check('redo branch: one entry to redo before the clean', s().historyIndex === s().historyStack.length - 2);
s().cleanResidue();
check('redo branch: the clean drops it (nothing left to redo)', s().historyIndex === s().historyStack.length - 1);
s().redo();
check('redo branch: redo after the clean changes nothing', same(Array.from(s().pixels), Array.from(frame(false))));
s().undo();
check('redo branch: undo after the clean returns to the loaded frame, not the undone stroke', same(Array.from(s().pixels), Array.from(frame(true))));

check('reloads for the cap', s().loadProject(project(), frame(true)) === true);
for (let i = 0; i < 60; i++) {
  s().beginStroke();
  s().paintPixel(2 + (i % 6), 2 + (Math.floor(i / 6) % 6), i % 2 ? '#112233' : '#445566');
  s().endStroke();
}
const before = s().historyStack.length;
s().cleanResidue();
check('cap: history holds 50 entries after 60 strokes and a clean', before === 50 && s().historyStack.length === 50 && s().historyIndex === 49, { before, len: s().historyStack.length, idx: s().historyIndex });
check('cap: the clean is the newest entry', same(Array.from(s().historyStack[49]), Array.from(s().pixels)));

console.log(failed ? `${failed} FAILED` : 'all pass');
process.exit(failed ? 1 : 0);
