// scripts/played-sheet-test.mjs
//
// Offline tests for src/lib/playedSheet.ts, the sheet the result card's
// Download saves on an Animate result (HQ 2026-11-05-003): the size in the
// source sheet's columns, where each frame lands, and that the frames follow
// playback() from src/lib/loopSequence.ts through Remove, Duplicate and
// ping-pong. Also runs framesFromSheet on a stand-in canvas, and pins what
// the card must keep in GenerationResult.tsx, which has no browser test here.
// Also covers src/lib/sheetAlpha.ts, the card's test for a transparent sheet.
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
  entryPoints: ['playedSheet', 'sheetAlpha', 'loopSequence', 'gifExport'].map((n) => path.join(ROOT, 'src/lib', `${n}.ts`)),
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const load = (n) => import(pathToFileURL(path.join(OUT_DIR, `${n}.mjs`)).href);
const { playedSheetSize, framePosition, assemblePlayedSheet, playedIsIdentity } = await load('playedSheet');
const { borderMostlyTransparent } = await load('sheetAlpha');
const { createSequence, playback, move, remove, duplicate, togglePingPong } = await load('loopSequence');
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

// 6. The border test for a transparent sheet.
{
  // RGBA pixels, with alpha from alphaAt(x, y).
  const sheet = (W, H, alphaAt) => {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[(y * W + x) * 4 + 3] = alphaAt(x, y);
    return px;
  };
  const reads = (W, H, alphaAt) => borderMostlyTransparent(sheet(W, H, alphaAt), W, H);
  const opaque = () => 255;
  const clear = () => 0;
  const onRing = (W, H, x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1;
  check('an opaque sheet reads opaque', !reads(16, 16, opaque));
  check('an opaque sheet with one corner erased reads opaque', !reads(16, 16, (x, y) => (x === 0 && y === 0 ? 0 : 255)));
  check('a transparent sheet with art in all four corners reads transparent', reads(16, 16, (x, y) => ((x === 0 || x === 15) && (y === 0 || y === 15) ? 255 : 0)));
  check('a fully transparent sheet reads transparent', reads(16, 16, clear));
  check('art inside an opaque ring does not count', !reads(8, 8, (x, y) => (onRing(8, 8, x, y) ? 255 : 0)));
  check('a clear middle inside a clear ring needs only the ring', reads(8, 8, (x, y) => (onRing(8, 8, x, y) ? 0 : 255)));
  check('half alpha is not clear', !reads(8, 8, () => 128));
  check('corners count once: 4 clear corners are 4 of a 4 x 4 ring of 12', !reads(4, 4, (x, y) => ((x === 0 || x === 3) && (y === 0 || y === 3) ? 0 : 255)));
  const firstClear = (n) => { let left = n; return (x, y) => (onRing(4, 4, x, y) && left-- > 0 ? 0 : 255); };
  check('exactly half the ring reads transparent', reads(4, 4, firstClear(6)));
  check('one short of half reads opaque', !reads(4, 4, firstClear(5)));
  check('1 x 1 opaque reads opaque', !reads(1, 1, opaque));
  check('1 x 1 transparent reads transparent', reads(1, 1, clear));
  check('W x 1 counts each pixel once: 2 of 3 clear reads transparent', reads(3, 1, (x) => (x === 1 ? 255 : 0)));
  check('W x 1 counts each pixel once: 1 of 3 clear reads opaque', !reads(3, 1, (x) => (x === 1 ? 0 : 255)));
  check('1 x H counts each pixel once: 1 of 3 clear reads opaque', !reads(1, 3, (_x, y) => (y === 1 ? 0 : 255)));
  check('0 x 0 is not transparent', !borderMostlyTransparent(new Uint8ClampedArray(0), 0, 0));
  check('0 wide or 0 tall is not transparent', !borderMostlyTransparent(new Uint8ClampedArray(0), 0, 4) && !borderMostlyTransparent(new Uint8ClampedArray(0), 4, 0));
}

// 7. Whether the loop is the sheet as delivered.
{
  const seq = createSequence(4);
  check('an unedited loop is the identity', playedIsIdentity(playback(seq), 4));
  check('a Remove is not', !playedIsIdentity(playback(remove(seq, 1)), 4));
  check('a Remove of the last frame, a clean prefix, is not', !playedIsIdentity(playback(remove(seq, 3)), 4));
  check('a Duplicate is not', !playedIsIdentity(playback(duplicate(seq, 1)), 4));
  check('a Remove then a Duplicate, same length, is not', !playedIsIdentity(playback(duplicate(remove(seq, 1), 2)), 4));
  check('a reorder, same length, is not', !playedIsIdentity(playback(move(seq, 0, 1)), 4));
  check('ping-pong is not', !playedIsIdentity(playback(togglePingPong(seq)), 4));
  check('ping-pong on 2 frames adds none, so it is', playedIsIdentity(playback(togglePingPong(createSequence(2))), 2));
  check('no frames is not', !playedIsIdentity(playback(createSequence(0)), 0));
  check('an empty loop of a 4-frame sheet is not', !playedIsIdentity([], 4));
  check('more frames than the sheet has is not', !playedIsIdentity([0, 1, 2, 3, 4], 4));
}

// 8. What the result card must keep.
{
  const card = fs.readFileSync(path.join(ROOT, 'src/components/sprites/GenerationResult.tsx'), 'utf8');
  // The text from one marker to the next, so a pin reads one handler or element.
  const slice = (from, to) => {
    const start = card.indexOf(from);
    const end = card.indexOf(to, start + from.length);
    return start < 0 || end < 0 ? '' : card.slice(start, end);
  };
  const played = slice('const handleDownloadPlayed = useCallback(', '// The sheet as delivered');
  const borderRead = slice("// Read the sheet's border.", '// Recompute background removal');
  const pngButton = slice('<Button\n          variant="secondary"\n          size="md"\n          className="aria-disabled:', '</Button>');
  const toggle = slice('<button\n            type="button"\n            id={bgToggleId}', '</button>');
  const grid = slice('<div className="grid grid-cols-2 gap-2">', '</Link>\n      </div>');
  // A native disabled, not the end of aria-disabled.
  const nativeDisabled = /(?<![-\w])disabled\b/;

  check('a transparent sheet turns background removal off', /const bgRemovalActive = bgRemovalWanted && sheetIsTransparent !== true;/.test(card));
  check('transparency is read from the border and held with its source', /transparent: borderMostlyTransparent\(px, W, H\)/.test(borderRead) && /sheetAlpha\.src === generatedImageDataUrl/.test(card));
  check('the disabled toggle is announced with its reason', /aria-disabled=\{sheetIsTransparent === true \|\| undefined\}/.test(card) && /aria-describedby=\{sheetIsTransparent === true \? bgNoteId : undefined\}/.test(card) && /id=\{bgNoteId\}[^>]*>\s*Background already removed\./.test(card));
  check('the disabled toggle keeps a focus style and ignores a press', /focus-visible:outline-2/.test(card) && /if \(sheetIsTransparent === true\) return;/.test(card));
  check('Download goes to the played sheet only with loop geometry and a frame', /const playedSheetReady = !!loopGeometry && loopPlayback\.length > 0;/.test(card) && /onClick=\{playedSheetReady \? handleDownloadPlayed : handleDownload\}/.test(card));
  check('Download original shows in that case only and saves the delivered sheet', /\{playedSheetReady && \(\s*<div className="flex">\s*<Button[^>]*onClick=\{handleDownloadOriginal\}/.test(card) && /const delivered = originalGeneratedImageDataUrl \?\? generatedImageDataUrl;\s*if \(!delivered\) return;\s*saveDataUrl\(delivered, `spritebrew_animation_\$\{Date\.now\(\)\}_original\.png`\)/.test(card));
  check('a second press while it works does nothing', /!loopGeometry \|\| sheetPreparing\) return;/.test(played) && /if \(!displayImageDataUrl \|\| sheetPreparing\) return;/.test(card) && /aria-disabled=\{sheetPreparing \|\| undefined\}/.test(pngButton) && /aria-busy=\{sheetPreparing \|\| undefined\}/.test(pngButton));
  check('the spinner stops under reduced motion and the label says Preparing', /animate-spin motion-reduce:animate-none/.test(card) && /'Preparing\.\.\.'/.test(card));
  check('a failed sheet says what to do instead', /Could not make the sheet\. Try Download original\./.test(card));
  check('the status is one always-rendered polite line, hidden from sight', /\/\* Always rendered[^*]*\*\/\}\s*<p className="sr-only" role="status">\{sheetStatus\}<\/p>/.test(card) && /sheetPreparing\s*\? 'Preparing the sheet\.'\s*: sheetReadySrc !== null && sheetReadySrc === generatedImageDataUrl\s*\? 'Sheet ready\.'\s*: ''/.test(card));
  check('Sheet ready follows the hand-off to the browser, on both paths', /saveDataUrl\(src, [^\n]*\n\s*setSheetReadySrc\(generatedImageDataUrl\);/.test(played) && /downloadFile\([^\n]*\n\s*setSheetReadySrc\(generatedImageDataUrl\);/.test(played));
  check('an unedited loop saves the displayed image with no canvas', /if \(playedIsIdentity\(loopPlayback, loopFrames\)\) \{\s*saveDataUrl\(src, `spritebrew_animation_\$\{Date\.now\(\)\}\.png`\);/.test(played) && played.indexOf('playedIsIdentity(') < played.indexOf('setSheetPreparing(true)'));
  check('the toggle is named by its title and its state', /<span id=\{bgTitleId\}[^>]*>\s*Remove background/.test(card) && /aria-labelledby=\{`\$\{bgTitleId\} \$\{bgToggleId\}`\}/.test(toggle));
  check('the cut loads only from the displayed image', /const src = displayImageDataUrl;/.test(played) && same(played.match(/loadImage\([^)]*\)/g), ['loadImage(src)']));
  check('framesFromSheet is given the played order', /framesFromSheet\(img, loopGeometry, loopPlayback\)/.test(played));
  check('assemblePlayedSheet is given the source columns', /assemblePlayedSheet\(frames, loopGeometry\.frameW, loopGeometry\.frameH, loopGeometry\.cols,/.test(played));
  check('the failure note is keyed to the generated image', /catch \{\s*setSheetFailedSrc\(generatedImageDataUrl\);/.test(played) && /sheetFailedSrc !== null && sheetFailedSrc === generatedImageDataUrl/.test(card));
  check('the failure note clears at the start of the handler', /sheetPreparing\) return;\s*setSheetFailedSrc\(null\);/.test(played));
  check('setSheetPreparing(false) is in a finally', /finally \{\s*setSheetPreparing\(false\);\s*\}/.test(played) && played.match(/setSheetPreparing\(false\)/g)?.length === 1);
  check('Download PNG has no native disabled', pngButton !== '' && !nativeDisabled.test(pngButton));
  check('the toggle has no native disabled', toggle !== '' && !nativeDisabled.test(toggle));
  check('no native disabled anywhere is tied to the preparing or transparent state', !/(?<![-\w])disabled=\{[^}]*(sheetPreparing|sheetIsTransparent)/.test(card));
  check('the border read drops its answer once cancelled', /await loadImage\(src\);\s*if \(cancelled\) return;/.test(borderRead) && /if \(!cancelled\) setSheetAlpha\(/.test(borderRead) && /return \(\) => \{ cancelled = true; \};/.test(borderRead));
  check('the GIF scale row shows under playedSheetReady, in either view', /\{\/\* GIF scale, for Download GIF \*\/\}\s*\{playedSheetReady && \(\s*<div className="flex items-center gap-2" role="group" aria-label="GIF scale">/.test(card));
  check('Download GIF shows under playedSheetReady, in either view', /\{playedSheetReady && \(\s*<Button variant="secondary" size="md" onClick=\{handleDownloadGif\}/.test(card));
  check('only the derived bgRemovalActive reads the raw background flag', card.match(/\bbgRemovalWanted\b/g)?.length === 2 && /const \[bgRemovalWanted, setBgRemovalWanted\] = useState\(false\);/.test(card) && /const bgRemovalActive = bgRemovalWanted && /.test(card));
  check('the action grid holds no Download original; it sits right under the grid, under playedSheetReady', grid.includes('View Gallery') && !grid.includes('Download original') && /<\/Link>\s*<\/div>\s*\{playedSheetReady && \(\s*<div className="flex">\s*<Button variant="ghost" size="sm" onClick=\{handleDownloadOriginal\}>\s*<Download size=\{12\} \/>\s*Download original\s*<\/Button>\s*<\/div>\s*\)\}/.test(card));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
