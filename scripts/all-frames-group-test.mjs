// scripts/all-frames-group-test.mjs
//
// Offline tests for Wave 1 PR 7: the synthetic all-frames group the upload
// page passes to exportRawFrames when no group exists. Run from the repo
// root: `node scripts/all-frames-group-test.mjs`. Bundles the helper with
// esbuild into local/.all-frames-group-test/ (gitignored). Prints only case
// names and pass or fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.all-frames-group-test', 'allFramesGroup.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/allFramesGroup.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'silent',
});
const { allFramesGroup } = await import(pathToFileURL(OUT).href);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const f = (id) => ({ id, imageData: null, x: 0, y: 0, width: 8, height: 8, duration: 125 });
const sheet = {
  animations: [
    { id: 'a', name: 'A', type: 'all', frames: [f('1'), f('2')], fps: 8, loop: true },
    { id: 'b', name: 'B', type: 'all', frames: [f('3')], fps: 8, loop: true },
  ],
};
const snapshot = JSON.stringify(sheet);
const group = allFramesGroup(sheet);

check('every sliced frame, in sheet order', group.frames.map((x) => x.id).join(',') === '1,2,3');
check('one non-empty group, so exportRawFrames writes files', group.frames.length > 0);
check('the sheet passed in is not mutated', JSON.stringify(sheet) === snapshot);
check('empty sheet gives an empty group', allFramesGroup({ animations: [] }).frames.length === 0);

process.exit(failed ? 1 : 0);
