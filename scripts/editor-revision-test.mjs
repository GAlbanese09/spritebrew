// scripts/editor-revision-test.mjs
//
// Offline tests for the pixel editor store's revision counter
// (src/components/sprites/editorStore.ts), the signal useEditorRecovery
// subscribes to for autosave. Run from the repo root:
// `node scripts/editor-revision-test.mjs`. Bundles the real store with
// esbuild (zustand external) into local/.editor-revision-test/ (gitignored)
// and prints only case names and pass or fail.
//
// Background: the autosave hook used to subscribe to historyIndex. Once the
// history stack reaches MAX_HISTORY (50), endStroke shifts the stack and the
// index stays at 49, so the subscription never fired again and autosave
// silently stopped. revision must rise on every history write, cap or not.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.editor-revision-test');

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
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const s = () => useEditorStore.getState();
const W = 4, H = 4;

/** A small transparent frame, built by the repo's own document factory. */
const smallProject = () => createBlankProject({ width: W, height: H, name: 'revision test' });

/** One pencil stroke at (x, y): the same calls the editor body makes. */
function stroke(x, y, color = '#ff0000') {
  s().beginStroke();
  s().paintPixel(x, y, color);
  s().endStroke();
}

// ── Load ──

const r0 = s().revision;
check('revision starts at 0 on a fresh store', r0 === 0);
const loaded = s().loadProject(smallProject(), new Uint8ClampedArray(W * H * 4));
check('loadProject accepts the small frame', loaded === true);
check('loadProject raises revision once', s().revision === r0 + 1);
check('loaded frame has historyIndex 0', s().historyIndex === 0);

// ── 60 strokes: every one raises revision, including past the 50-entry cap ──

const MAX_HISTORY = 50;
let everyStrokeRaised = true;
let indexStayedAtCap = true;
let sawCap = false;
for (let i = 0; i < 60; i++) {
  const before = s().revision;
  // Alternate colours so consecutive snapshots differ.
  stroke(i % W, Math.floor(i / W) % H, i % 2 ? '#00ff00' : '#ff0000');
  if (s().revision !== before + 1) everyStrokeRaised = false;
  if (i + 1 >= MAX_HISTORY) {
    sawCap = true;
    if (s().historyIndex !== MAX_HISTORY - 1 || s().historyStack.length !== MAX_HISTORY) {
      indexStayedAtCap = false;
    }
  }
}
check('every one of 60 strokes raises revision by exactly 1', everyStrokeRaised);
check('the stack is capped at 50 entries', sawCap && indexStayedAtCap);
check('historyIndex stays at 49 once capped (the old signal that stopped moving)', s().historyIndex === 49);
check('revision after load and 60 strokes is 61', s().revision === 61);

// ── Undo, redo, revert and flip each raise it once ──

let before = s().revision;
s().undo();
check('undo raises revision once', s().revision === before + 1 && s().historyIndex === 48);

before = s().revision;
s().redo();
check('redo raises revision once', s().revision === before + 1 && s().historyIndex === 49);

before = s().revision;
s().revertToOriginal();
check('revert raises revision once (at the cap, index stays 49)', s().revision === before + 1 && s().historyIndex === 49);

before = s().revision;
s().revertToOriginal();
check('a second revert at the baseline is a no-op: revision unchanged', s().revision === before);

// Make the canvas asymmetric so a flip changes it.
stroke(0, 0, '#0000ff');
before = s().revision;
s().flipHorizontal();
check('flip raises revision once', s().revision === before + 1 && s().historyIndex === 49);

// ── No-ops leave it alone ──

before = s().revision;
s().setActiveTool('eraser');
s().setBrushSize(2);
check('tool and brush changes do not raise revision', s().revision === before);

// ── beginStroke that drops a redo branch, and reset ──

s().undo();
before = s().revision;
s().beginStroke();
check('beginStroke that truncates a redo branch raises revision once', s().revision === before + 1);
s().paintPixel(1, 1, '#ff00ff');
s().endStroke();

before = s().revision;
s().reset();
check('reset raises revision once and empties the history', s().revision === before + 1 && s().historyIndex === -1);

// ── A fresh load after reset keeps counting up (never restarts at 0) ──

before = s().revision;
s().loadProject(smallProject(), new Uint8ClampedArray(W * H * 4));
check('a second load keeps counting up', s().revision === before + 1);

process.exit(failed ? 1 : 0);
