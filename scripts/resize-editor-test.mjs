// scripts/resize-editor-test.mjs
//
// An image too large for the editor goes to /resize and back without being
// chosen again (external product audit r2, SB-06). The editor's landing keeps
// the refused file; its "Resize page" link hands it to /resize in memory;
// /resize opens it and picks the largest size the editor opens; "Edit resized
// image" hands the result to /editor, which opens it. Nothing leaves the
// device: the handoff is a module in the page's memory, with no storage and
// no request. Runs src/lib/editorResizeHandoff.ts and src/lib/resizePage.ts,
// and checks the pages by text; the browser check is in BUILD's harness
// (build/harness/ext-mediums/). Run from the repo root:
// `node scripts/resize-editor-test.mjs`. Bundles with esbuild into
// local/.resize-editor-test/ (gitignored). Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.resize-editor-test');
fs.mkdirSync(OUT_DIR, { recursive: true });
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
}
async function load(rel, out) {
  try {
    const outfile = path.join(OUT_DIR, out);
    await build({ entryPoints: [path.join(ROOT, rel)], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
    return await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
  } catch {
    return null;
  }
}
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };

// ── 1. The handoff, both ways, one-shot ──
const H = await load('src/lib/editorResizeHandoff.ts', 'handoff.mjs');
check('1a: src/lib/editorResizeHandoff.ts exports the two handoffs', !!H && ['sendToResize', 'takeForResize', 'sendToEditor', 'takeForEditor'].every((k) => typeof H[k] === 'function'));
if (H && typeof H.sendToResize === 'function') {
  const file = { name: 'big.png' };
  H.sendToResize(file);
  check('1b: /resize takes the editor\'s file once', H.takeForResize() === file && H.takeForResize() === null);
  const img = { dataUrl: 'data:image/png;base64,AA', width: 1024, height: 512, name: 'big.png' };
  H.sendToEditor(img);
  check('1c: /editor takes the resized image once', H.takeForEditor() === img && H.takeForEditor() === null);
  const src = read('src/lib/editorResizeHandoff.ts');
  if (typeof H.dropForResize === 'function') { H.sendToResize(file); H.dropForResize(); }
  check('1e: a waiting file can be dropped, so a later /resize does not open it (AUDIT ext-mediums r1 L4)', typeof H.dropForResize === 'function' && H.takeForResize() === null);
  check('1d: in memory only: no storage, no request', !/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(src));
}

// ── 2. The size /resize picks for the editor ──
const P = await load('src/lib/resizePage.ts', 'resizePage.mjs');
check('2a: resizePage exports fitsEditor and editorPick', !!P && typeof P.fitsEditor === 'function' && typeof P.editorPick === 'function');
if (P && typeof P.editorPick === 'function') {
  check('2b: fitsEditor follows the editor\'s limits', P.fitsEditor(1024, 1024) && !P.fitsEditor(2048, 1024) && P.fitsEditor(4096, 256) && !P.fitsEditor(4097, 1));
  const pick = P.editorPick(P.unitOf(2048, 1024, null));
  check('2c: 2048 by 1024 picks 1024 by 512, the largest size the editor opens', !!pick && pick.width === 1024 && pick.height === 512 && pick.direction === 'down', pick);
  const sheetPick = P.editorPick(P.unitOf(2048, 1024, { columns: 4, rows: 2 }));
  check('2d: on a sheet the whole sheet must fit: 4 x 2 frames of 512 by 512 pick frames of 256 by 256', !!sheetPick && sheetPick.width === 256 && sheetPick.height === 256, sheetPick);
  const big = P.editorPick(P.unitOf(4096, 4096, null));
  check('2c2: 4096 by 4096 picks a quarter, 1024 by 1024: the half is still too many pixels (L7)', !!big && big.width === 1024 && big.height === 1024, big);
  check('2e: an image the editor already opens picks nothing', P.editorPick(P.unitOf(512, 512, null)) === null);
  const W = P.RESIZE_WORDS;
  check('2f: the words (DESIGN 2026-11-25-063, with the editor\'s real limit, a pixel count, from its constant)', W.edit === 'Edit resized image'
    && W.editTooLarge === 'Too large for the editor, which opens up to 1,048,576 pixels, such as 1024 by 1024. Choose a smaller size to edit it.'
    && typeof W.fromEditor === 'function' && W.fromEditor(1024, 512) === 'The editor opens up to 1,048,576 pixels, such as 1024 by 1024, so 1024 by 512 px is chosen.');
  const rp = read('src/lib/resizePage.ts');
  check('2g: the count and the example come from the editor\'s constant, not typed (DESIGN 2026-11-25-074)', !/1,048,576|1024 by 1024/.test(rp) && /Math\.sqrt\(EDITOR_MAX_PIXELS\)/.test(rp));
}

// ── 3. The pages ──
{
  const refusal = read('src/components/sprites/EditorRefusalText.tsx');
  const landing = read('src/components/sprites/EditorLanding.tsx');
  const resize = read('src/app/resize/page.tsx');
  const editor = read('src/app/editor/page.tsx');
  check('3a: the refusal\'s "Resize page" link can carry the refused file', /onResize\?: \(e: MouseEvent<HTMLAnchorElement>\) => void/.test(refusal) && /onClick=\{onResize\}/.test(refusal));
  check('3b: the editor\'s landing keeps the refused file and hands it on when the link is followed',
    /refusedRef\.current = file;/.test(landing) && /sendToResize\(refusedRef\.current\)/.test(landing) && /<EditorRefusalText message=\{uploadError\} onResize=\{/.test(landing));
  check('3b2: only a plain click hands it on, and a new file drops it (L4)',
    /if \(e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey\) return;/.test(landing)
    && /dropForResize\(\);/.test(landing) && /onResize\?: \(e: MouseEvent<HTMLAnchorElement>\) => void/.test(refusal));
  check('3c: /resize opens a file the editor handed it, and picks the editor\'s size',
    /const handed = takeForResize\(\);/.test(resize) && /editorPick\(/.test(resize) && /W\.fromEditor\(/.test(resize));
  check('3d: /resize offers "Edit resized image", which hands the image to /editor',
    /\{W\.edit\}/.test(resize) && /sendToEditor\(\{/.test(resize) && /router\.push\('\/editor'\)/.test(resize));
  check('3e: too large for the editor, the button is aria-disabled and says why',
    /aria-disabled=\{!editable\}/.test(resize) && /aria-describedby=\{tooLarge \? editTooLargeId : undefined\}/.test(resize) && /W\.editTooLarge/.test(resize));
  check('3f: /editor opens the image /resize handed it', /const handed = takeForEditor\(\);/.test(editor) && /source: \{ kind: 'upload' \}/.test(editor));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
