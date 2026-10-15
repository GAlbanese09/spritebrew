// scripts/frame-drag-test.mjs
//
// Offline tests for Wave 1 PR 8: the pure drop math behind dragging frames
// (src/lib/frameDragMath.ts). Run from the repo root:
// `node scripts/frame-drag-test.mjs`. Bundles the module with esbuild into
// local/.frame-drag-test/ (gitignored). Prints only case names and pass or
// fail.

import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'local', '.frame-drag-test', 'frameDragMath.mjs');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/frameDragMath.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  logLevel: 'silent',
});
const { insertionIndex, dropIndex, indicatorBox, moveItem, insertAt } = await import(
  pathToFileURL(OUT).href
);

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Six 40 px tiles, gap 6, four per row: row 1 is tiles 0-3, row 2 is 4-5.
const boxes = [0, 1, 2, 3, 4, 5].map((i) => {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const left = col * 46;
  const top = 100 + row * 46;
  return { left, top, right: left + 40, bottom: top + 40 };
});
const six = ['a', 'b', 'c', 'd', 'e', 'f'];

// insertionIndex
check('left half of a tile inserts before it', insertionIndex(boxes, 50, 120) === 1);
check('right half of a tile inserts after it', insertionIndex(boxes, 80, 120) === 2);
check('past the end of row 1 inserts before row 2', insertionIndex(boxes, 300, 120) === 4);
check('right half of the last tile appends', insertionIndex(boxes, 80, 166) === 6);
check('below every row appends', insertionIndex(boxes, 10, 400) === 6);
check('no tiles gives index 0', insertionIndex([], 10, 10) === 0);

// dropIndex
check('above the strip (group header) appends', dropIndex(boxes, 10, 20) === 6);
check('on the strip uses the position under the pointer', dropIndex(boxes, 10, 120) === 0);
check('empty group gives index 0', dropIndex([], 10, 20) === 0);

// indicatorBox
check('bar sits in the gap before the target tile', same(indicatorBox(boxes, 1, 6), { left: 42, right: 44, top: 100, bottom: 140 }));
check('bar sits after the last tile when appending', same(indicatorBox(boxes, 6, 6), { left: 88, right: 90, top: 146, bottom: 186 }));
check('no bar for an empty group', indicatorBox([], 0, 6) === null);

// moveItem: reorder a 6-frame group
check('move first to the end', same(moveItem(six, 0, 6), ['b', 'c', 'd', 'e', 'f', 'a']));
check('move last to the start', same(moveItem(six, 5, 0), ['f', 'a', 'b', 'c', 'd', 'e']));
check('move forward into the middle', same(moveItem(six, 1, 4), ['a', 'c', 'd', 'b', 'e', 'f']));
check('move backward into the middle', same(moveItem(six, 4, 1), ['a', 'e', 'b', 'c', 'd', 'f']));
check('drop on its own slot is a no-op (same array)', moveItem(six, 2, 2) === six && moveItem(six, 2, 3) === six);
check('bad source index is a no-op', moveItem(six, 9, 0) === six);
check('moveItem does not mutate its input', same(six, ['a', 'b', 'c', 'd', 'e', 'f']));

// insertAt: copies from the Frames grid, reuse allowed
const once = insertAt(['a', 'b'], 1, 'x');
const twice = insertAt(once, 3, 'x');
check('insert a copy at the drop position', same(once, ['a', 'x', 'b']));
check('the same frame can be inserted twice', same(twice, ['a', 'x', 'b', 'x']));
check('insert into an empty group', same(insertAt([], 0, 'x'), ['x']));
check('out of range index is clamped', same(insertAt(['a'], 99, 'x'), ['a', 'x']));

process.exit(failed ? 1 : 0);
