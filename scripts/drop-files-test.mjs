// scripts/drop-files-test.mjs
//
// A drop of several files (external product audit r2, SB-13): the upload
// zone opens one, the first by name in natural order (frame2 before
// frame10), and says how many came and which one opened. A drop of one file
// says nothing new. Runs src/lib/dropFiles.ts, and checks by text that the
// upload zone uses it; the browser check is in BUILD's harness
// (build/harness/ext-mediums/). Run from the repo root:
// `node scripts/drop-files-test.mjs`. Bundles with esbuild into
// local/.drop-files-test/ (gitignored). Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`pass  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
}
let D = null;
try {
  const OUT_DIR = path.join(ROOT, 'local', '.drop-files-test');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outfile = path.join(OUT_DIR, 'dropFiles.mjs');
  await build({ entryPoints: [path.join(ROOT, 'src/lib/dropFiles.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent' });
  D = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
} catch {
  D = null;
}
const f = (name, type = 'image/png') => ({ name, type });

check('1: src/lib/dropFiles.ts exports pickDropped and droppedNote', !!D && typeof D.pickDropped === 'function' && typeof D.droppedNote === 'function');
if (D && typeof D.pickDropped === 'function') {
  const three = D.pickDropped([f('frame10.png'), f('frame02.png'), f('frame01.png')]);
  check('2: frame01, frame02 and frame10 dropped together open frame01, and the count is 3', three?.file.name === 'frame01.png' && three?.count === 3, three && { name: three.file.name, count: three.count });
  const natural = D.pickDropped([f('frame10.png'), f('frame2.png')]);
  check('3: natural order: frame2 before frame10', natural?.file.name === 'frame2.png');
  check('4: one file opens with no note', D.pickDropped([f('sheet.png')])?.count === 1 && D.droppedNote(1, 'sheet.png') === null);
  check('5: nothing dropped opens nothing', D.pickDropped([]) === null);
  check('6: the note for several, in DESIGN\'s words (2026-11-25-063)', D.droppedNote(3, 'frame01.png') === '3 files were dropped. Only one opens at a time, so frame01.png is open.');
  const mixed = D.pickDropped([f('a-notes.txt', 'text/plain'), f('frame01.png')], (x) => x.type === 'image/png');
  check('6b: the first image opens, not a text file before it by name, and the count is every file (AUDIT ext-mediums r1 L6)', mixed?.file.name === 'frame01.png' && mixed?.count === 2, mixed && { name: mixed.file.name, count: mixed.count });
  const none = D.pickDropped([f('a.txt', 'text/plain')], (x) => x.type === 'image/png');
  check('6c: with no image at all, the first file is still handed on, so the zone says what is wrong', none?.file.name === 'a.txt' && none?.count === 1);
}
{
  const zone = fs.readFileSync(path.join(ROOT, 'src/components/sprites/UploadZone.tsx'), 'utf8');
  check('7: the upload zone opens the picked file and keeps the note', /const picked = pickDropped\(Array\.from\(e\.dataTransfer\.files\), \(f\) => ACCEPTED_TYPES\.includes\(f\.type\)\);/.test(zone)
    && /setDropNote\(droppedNote\(picked\.count, picked\.file\.name\)\);/.test(zone) && !/e\.dataTransfer\.files\[0\]/.test(zone));
  check('8: the note shows with the loaded sheet, and a new choice or Remove clears it', /\{dropNote && \(/.test(zone) && (zone.match(/setDropNote\(null\)/g) ?? []).length >= 2);
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall pass (${pass} cases)`);
process.exit(fail ? 1 : 0);
