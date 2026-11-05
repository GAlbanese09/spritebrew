// scripts/played-sheet-test.mjs
//
// Offline tests for src/lib/playedSheet.ts, the sheet the result card's
// Download saves on an Animate result (HQ 2026-11-05-003): the size in the
// source sheet's columns, where each frame lands, and that the frames follow
// playback() from src/lib/loopSequence.ts through Remove, Duplicate and
// ping-pong. Also runs framesFromSheet on a stand-in canvas, and pins what
// the card must keep in GenerationResult.tsx, which has no browser test here.
// Run from the repo root: `node scripts/played-sheet-test.mjs`. Bundles with
// esbuild into local/.played-sheet-test/ (gitignored). Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.played-sheet-test');

await build({
  entryPoints: ['playedSheet', 'loopSequence', 'gifExport'].map((n) => path.join(ROOT, 'src/lib', `${n}.ts`)),
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const load = (n) => import(pathToFileURL(path.join(OUT_DIR, `${n}.mjs`)).href);
const { playedSheetSize, framePosition, assemblePlayedSheet } = await load('playedSheet');
const { createSequence, playback, remove, duplicate, togglePingPong } = await load('loopSequence');
const { framesFromSheet } = await load('gifExport');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A canvas that records its size and every putImageData.
function standIn(width, height) {
  const puts = [];
  return { width, height, puts, getContext: () => ({ putImageData: (data, x, y) => puts.push({ data, x, y }) }) };
}
// The frames as the card lays them out: one marker per entry of the order.
const assemble = (order, frameW, frameH, cols) => assemblePlayedSheet(order, frameW, frameH, cols, standIn);
const where = (canvas) => canvas.puts.map(({ data, x, y }) => [data, x, y]);

// 1. Sizes.
check('16 frames at 4 columns: 4 x 4 cells', same(playedSheetSize(16, 4, 32, 32), { cols: 4, rows: 4, width: 128, height: 128 }));
check('3 frames at 4 columns: one row, still 4 cells wide', same(playedSheetSize(3, 4, 32, 32), { cols: 4, rows: 1, width: 128, height: 32 }));
check('5 frames at 4 columns: a second row', same(playedSheetSize(5, 4, 32, 32), { cols: 4, rows: 2, width: 128, height: 64 }));
check('0 frames: no rows, no height', same(playedSheetSize(0, 4, 32, 32), { cols: 4, rows: 0, width: 128, height: 0 }));
check('0 columns count as 1', same(playedSheetSize(3, 0, 32, 32), { cols: 1, rows: 3, width: 32, height: 96 }));
check('frames need not be square', same(playedSheetSize(4, 2, 16, 24), { cols: 2, rows: 2, width: 32, height: 48 }));

// 2. Positions.
check('the first frame is at the origin', same(framePosition(0, 4, 32, 32), { x: 0, y: 0 }));
check('a wrapped frame starts the next row', same(framePosition(4, 4, 32, 32), { x: 0, y: 32 }));
check('the last of 16 at 4 columns is the bottom right cell', same(framePosition(15, 4, 32, 32), { x: 96, y: 96 }));
check('0 columns stack the frames', same(framePosition(2, 0, 32, 32), { x: 0, y: 64 }));

// 3. Assembling.
{
  const canvas = assemble(['a', 'b', 'c', 'd', 'e'], 32, 32, 4);
  check('the canvas is the sheet size', canvas.width === 128 && canvas.height === 64, [canvas.width, canvas.height]);
  check('one putImageData per frame', canvas.puts.length === 5, canvas.puts.length);
  check('each frame lands in its cell', same(where(canvas), [['a', 0, 0], ['b', 32, 0], ['c', 64, 0], ['d', 96, 0], ['e', 0, 32]]), where(canvas));
  let threw = false;
  try {
    assemblePlayedSheet(['a'], 32, 32, 4, () => ({ getContext: () => null }));
  } catch {
    threw = true;
  }
  check('no 2D context throws', threw);
}

// 4. With playback().
{
  const seq = createSequence(4);
  const pingPong = playback(togglePingPong(seq));
  check('ping-pong on [0,1,2,3] plays 6 frames', same(pingPong, [0, 1, 2, 3, 2, 1]), pingPong);
  const size = playedSheetSize(pingPong.length, 4, 32, 32);
  check('6 frames at 4 columns: two rows, still 4 cells wide', same(size, { cols: 4, rows: 2, width: 128, height: 64 }), size);
  check('the ping-pong frames wrap to the second row', same(where(assemble(pingPong, 32, 32, 4)).slice(4), [[2, 0, 32], [1, 32, 32]]));

  const removed = playback(remove(seq, 1));
  check('a Remove drops the frame and closes the gap', same(where(assemble(removed, 32, 32, 4)), [[0, 0, 0], [2, 32, 0], [3, 64, 0]]));
  const then = playback(duplicate(remove(seq, 1), 2));
  check('a Remove then a Duplicate: the copy takes the next cell', same(where(assemble(then, 32, 32, 4)), [[0, 0, 0], [2, 32, 0], [3, 64, 0], [3, 96, 0]]));
  const grown = playback(duplicate(seq, 3));
  check('a Duplicate past the columns adds a row', same(playedSheetSize(grown.length, 4, 32, 32), { cols: 4, rows: 2, width: 128, height: 64 }));
}

// 5. From the sheet to the file: cut by framesFromSheet, as the card does.
{
  const cuts = [];
  globalThis.document = {
    createElement: () => ({
      getContext: () => {
        let cell = null;
        return {
          clearRect() {},
          drawImage: (_src, sx, sy) => { cell = [sx, sy]; cuts.push(cell); },
          getImageData: () => ({ cell }),
        };
      },
    }),
  };
  const geometry = { frameW: 32, frameH: 32, cols: 2, rows: 2, frames: 4 };
  const order = playback(duplicate(remove(createSequence(4), 0), 0)); // [1, 1, 2, 3]
  const canvas = assemble(framesFromSheet({}, geometry, order), 32, 32, geometry.cols);
  check('frames are cut from their source cells and repeats are cut once', same(cuts, [[32, 0], [0, 32], [32, 32]]), cuts);
  check('the sheet keeps the source columns', canvas.width === 64 && canvas.height === 64, [canvas.width, canvas.height]);
  const placed = canvas.puts.map(({ data, x, y }) => [...data.cell, x, y]);
  check('each cut lands at its played position', same(placed, [[32, 0, 0, 0], [32, 0, 32, 0], [0, 32, 0, 32], [32, 32, 32, 32]]), placed);
}

// 6. What the result card must keep.
{
  const card = fs.readFileSync(path.join(ROOT, 'src/components/sprites/GenerationResult.tsx'), 'utf8');
  check('a transparent sheet turns background removal off', /const bgRemovalActive = bgRemovalWanted && sheetIsTransparent !== true;/.test(card));
  check('transparency is read from the corners and held with its source', /transparent: !cornersOpaque\(/.test(card) && /sheetAlpha\.src === generatedImageDataUrl/.test(card));
  check('the disabled toggle is announced with its reason', /aria-disabled=\{sheetIsTransparent === true \|\| undefined\}/.test(card) && /aria-describedby=\{sheetIsTransparent === true \? bgNoteId : undefined\}/.test(card) && /id=\{bgNoteId\}[^>]*>\s*Background already removed\./.test(card));
  check('the disabled toggle keeps a focus style and ignores a press', /focus-visible:outline-2/.test(card) && /if \(sheetIsTransparent === true\) return;/.test(card));
  check('Download goes to the played sheet only with loop geometry and a frame', /const playedSheetReady = !!loopGeometry && loopPlayback\.length > 0;/.test(card) && /onClick=\{playedSheetReady \? handleDownloadPlayed : handleDownload\}/.test(card));
  check('Download original shows in that case only and saves the delivered sheet', /\{playedSheetReady && \(\s*<Button[^>]*onClick=\{handleDownloadOriginal\}/.test(card) && /saveDataUrl\(generatedImageDataUrl, `spritebrew_animation_\$\{Date\.now\(\)\}_original\.png`\)/.test(card));
  check('a second press while it works does nothing', /!loopGeometry \|\| sheetPreparing\) return;/.test(card) && /disabled=\{sheetPreparing\}/.test(card));
  check('the spinner stops under reduced motion and the label says Preparing', /animate-spin motion-reduce:animate-none/.test(card) && /'Preparing\.\.\.'/.test(card));
  check('a failed sheet says what to do instead', /Could not make the sheet\. Try Download original\./.test(card));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
