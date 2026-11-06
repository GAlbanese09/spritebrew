// scripts/align-frames-test.mjs
//
// Offline tests for src/lib/alignFrames.ts, the library behind the Align
// frames card on /upload (HQ 2026-11-05-017, 2026-11-06-001): the feet row and
// center column, the crop guard, what must not steer a frame, and the words
// the card shows. Synthetic frames only. Also pins what the card and the page
// must keep, which have no browser test here.
// Run from the repo root: `node scripts/align-frames-test.mjs`. Bundles with
// esbuild into local/.align-frames-test/ (gitignored). Prints only case names
// and pass or fail.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'local', '.align-frames-test');

await build({
  entryPoints: [path.join(ROOT, 'src/lib/alignFrames.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const {
  planAlignment, shiftFrame, applyAlignment, moveWords, alignmentSummary,
} = await import(pathToFileURL(path.join(OUT_DIR, 'alignFrames.mjs')).href);

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Frames ──

const blank = (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });

// Each pixel's color comes from its place in the shape, so a frame that moved
// as a whole keeps its colors and one that tore does not.
function paint(frame, x0, y0, w, h, alpha = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * frame.width + x) * 4;
      frame.data.set([(x - x0) * 9 + 20, (y - y0) * 9 + 20, 90, alpha], i);
    }
  }
  return frame;
}

// A 10 x 20 figure: 12 rows of torso, 8 of legs. Its feet are on row oy + 19
// and its legs center on column ox + 4.5; `legWidth` makes that fractional.
function figure(frame, ox, oy, legWidth = 2) {
  paint(frame, ox, oy, 10, 12);
  paint(frame, ox, oy + 12, legWidth, 8);
  paint(frame, ox + 8, oy + 12, 2, 8);
  return frame;
}
const figureAt = ([dx, dy], size = 40, ox = 10, oy = 6) => figure(blank(size, size), ox + dx, oy + dy);
const withBody = (offsets) => offsets.map((o) => figureAt(o));

const noMoves = (plan) => plan.moves.every((m) => m.dx === 0 && m.dy === 0 && m.shortened === false);

// The lowest painted row and the alpha-weighted center of the rows from
// `bandTop` down, measured here so the test does not lean on the library.
function feetOf(frame) {
  for (let y = frame.height - 1; y >= 0; y--) {
    for (let x = 0; x < frame.width; x++) {
      if (frame.data[(y * frame.width + x) * 4 + 3] > 0) return y;
    }
  }
  return -1;
}
function centerOf(frame, rows) {
  const feet = feetOf(frame);
  let weight = 0, sum = 0;
  for (let y = feet - rows + 1; y <= feet; y++) {
    for (let x = 0; x < frame.width; x++) {
      const a = frame.data[(y * frame.width + x) * 4 + 3];
      weight += a;
      sum += a * x;
    }
  }
  return sum / weight;
}

// True when `moved` is `frame` with every painted pixel at (x + dx, y + dy) in
// the same color, the same number of them, and everything else (0, 0, 0, 0).
function movedWhole(frame, moved, { dx, dy }) {
  const { width: W, height: H } = frame;
  let painted = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (frame.data[i + 3] === 0) continue;
      painted++;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
      const j = (ny * W + nx) * 4;
      for (let c = 0; c < 4; c++) if (frame.data[i + c] !== moved.data[j + c]) return false;
    }
  }
  let after = 0;
  for (let i = 0; i < moved.data.length; i += 4) {
    if (moved.data[i + 3] > 0) after++;
    else if (moved.data[i] || moved.data[i + 1] || moved.data[i + 2]) return false;
  }
  return painted === after;
}

// ── Jitter ──

const JITTER = [[0, 0], [2, -1], [-1, 1], [3, 2], [0, -2], [-2, 0]];
{
  const frames = withBody(JITTER);
  const { frames: out, plan } = applyAlignment(frames);
  check('jittered frames land on one feet row', out.every((f) => feetOf(f) === 25), out.map(feetOf));
  check('jittered frames land on one center column', out.every((f) => centerOf(f, 5) === 14.5), out.map((f) => centerOf(f, 5)));
  check('each move undoes its known offset', same(plan.moves.map((m) => [m.dx, m.dy]), JITTER.map(([x, y]) => [-x + 0, -y + 0])), plan.moves);
  check('the target is the median frame', same(plan.target, { feetRow: 25, centerCol: 14.5 }), plan.target);
  check('the counts say who moved', plan.aligned === 5 && plan.alreadyInPlace === 1 && same(plan.shortenedFrames, []), plan);
  check('every pixel moves by the same whole-pixel vector', frames.every((f, i) => movedWhole(f, out[i], plan.moves[i])));
  check('moves are whole pixels and never -0', plan.moves.every((m) => Number.isInteger(m.dx) && Number.isInteger(m.dy) && !Object.is(m.dx, -0) && !Object.is(m.dy, -0)));
}
{
  // Sorted feet are 25, 26, 27, 28: the lower middle is 26. Centers likewise.
  const { target } = planAlignment(withBody([[0, 0], [1, 1], [2, 2], [3, 3]]));
  check('an even count takes the lower middle', same(target, { feetRow: 26, centerCol: 15.5 }), target);
}

// ── What must not steer a frame ──

{
  const frames = withBody([[0, 0], [0, 0], [0, 0], [0, 0]]);
  paint(frames[1], 34, 34, 5, 5);
  paint(frames[2], 2, 36, 2, 2);
  const plan = planAlignment(frames);
  check('a detached spark does not steer the frame', noMoves(plan), plan.moves);
  check('the spark does not change the target', same(plan.target, { feetRow: 25, centerCol: 14.5 }), plan.target);
}
{
  // HQ condition 2: the body stays still while a 12 px weapon reaches out to
  // one side, touching the torso, in two of six frames.
  const frames = withBody([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
  for (const i of [1, 4]) paint(frames[i], 20, 11, 12, 2);
  const plan = planAlignment(frames);
  check('the weapon fixture: a 12 px weapon in two of six frames, all six moves are zero', noMoves(plan), plan.moves);
  check('the weapon fixture: every frame counts as in place', plan.aligned === 0 && plan.alreadyInPlace === 6, plan);
}
{
  // Documented: a weapon touching the body and reaching below the feet counts
  // as the feet. The preview shows it, and the frame can be left out.
  const frames = withBody([[0, 0], [0, 0], [0, 0], [0, 0]]);
  paint(frames[3], 18, 22, 2, 8);
  const { moves, target } = planAlignment(frames);
  check('an attached weapon below the feet counts as feet', target.feetRow === 25 && moves[3].dy === -4, moves[3]);
}

// ── The crop guard ──

{
  const frames = withBody([[0, 0], [0, 0], [0, -4], [0, 0], [0, 0]]);
  // A faint pixel the body rule cannot see, 3 rows under the last row a full
  // move could reach. Any alpha at all counts.
  paint(frames[2], 3, 36, 1, 1, 3);
  const { frames: out, plan } = applyAlignment(frames);
  check('the crop guard shortens the move', same(plan.moves[2], { dx: 0, dy: 3, shortened: true }), plan.moves[2]);
  check('the crop guard names the frame', same(plan.shortenedFrames, [2]), plan.shortenedFrames);
  check('a shortened frame loses nothing', movedWhole(frames[2], out[2], plan.moves[2]));
  check('the status names it from 1', alignmentSummary(plan, [1, 2, 3, 4, 5]) === 'Aligned 1 of 5 frames. 4 were already in place. Frame 3 moved as far as it could without cutting anything off.', alignmentSummary(plan, [1, 2, 3, 4, 5]));
}
{
  const frames = withBody([[0, 0], [0, 0], [-8, 0], [0, 0], [0, 0]]);
  paint(frames[2], 39, 3, 1, 1);
  const plan = planAlignment(frames);
  check('it shortens sideways too, at the right edge', same(plan.moves[2], { dx: 0, dy: 0, shortened: true }) && same(plan.shortenedFrames, [2]), plan.moves[2]);
  check('a frame held still does not count as in place', plan.aligned === 0 && plan.alreadyInPlace === 4, plan);
}
{
  const frame = figureAt([20, 0]);
  const plan = planAlignment([frame], { target: { feetRow: 25, centerCol: 0 } });
  check('it stops at the left edge with no -0', plan.moves[0].dx === -30 && !Object.is(plan.moves[0].dx, -0) && plan.moves[0].shortened, plan.moves[0]);
}

// ── Nothing to do ──

{
  const empty = planAlignment([]);
  check('no frames: no moves, no target', same(empty.moves, []) && empty.target === null && empty.refused === null, empty);
  const hollow = planAlignment([blank(16, 16), blank(16, 16)]);
  check('empty frames move nothing', noMoves(hollow) && hollow.target === null && hollow.refused === null, hollow);
  const mixed = planAlignment([blank(40, 40), ...withBody([[0, 0], [2, 0]])]);
  check('an empty frame among others moves nothing and sets nothing', noMoves({ moves: mixed.moves.slice(0, 1) }) && mixed.moves[2].dx === -2, mixed.moves);
  const single = planAlignment(withBody([[3, 2]]));
  check('a single frame moves nothing', noMoves(single) && single.alreadyInPlace === 1, single);
}

// ── Twice ──

{
  const once = applyAlignment(withBody(JITTER));
  check('aligning twice moves nothing the second time', noMoves(planAlignment(once.frames)));

  // Fractional centers. The median of the first pass's results can differ
  // from the median it aligned to; a second pass must still move nothing,
  // with or without a frame the crop guard holds.
  let seed = 12345;
  const random = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  let nudged = 0;
  for (let run = 0; run < 300; run++) {
    const frames = Array.from({ length: 8 }, () => figure(blank(64, 64), 26 + random(9), 30 + random(9), 1 + random(6)));
    if (run % 2) paint(frames[3], 0, 28, 64, 1);
    const out = applyAlignment(frames).frames;
    if (!noMoves({ moves: planAlignment(out).moves.map((m) => ({ ...m, shortened: false })) })) nudged++;
  }
  check('aligning twice moves nothing on fractional centers, in 300 fuzzed sets', nudged === 0, nudged);
}
{
  // Legs of width 2 center on ox + 4.5, width 3 on ox + 4, width 1 on ox + 17/3.
  const legs = (ox, width) => figure(blank(40, 40), ox, 6, width);
  const { moves } = planAlignment([legs(10, 2), legs(10, 2), legs(11, 1)]);
  check('the first pass rounds the distance to the target', moves[2].dx === -2 && moves[0].dx === 0, moves);
  const close = planAlignment([legs(10, 3), legs(10, 3), legs(9, 1)]);
  check('centers that fit in one pixel count as aligned', noMoves(close) && close.alreadyInPlace === 3, close.moves);
  const given = planAlignment([legs(9, 1)], { target: close.target });
  check('that does not soften a given target', given.moves[0].dx === -1, given.moves);
}

// ── Refused ──

{
  const opaque = () => paint(blank(16, 16), 0, 0, 16, 16);
  const plan = planAlignment([...withBody([[0, 0], [3, 3]]), opaque()]);
  check('an opaque frame is refused, with no moves', plan.refused === 'opaque' && noMoves(plan) && plan.target === null && plan.aligned === 0, plan);
  const faint = paint(blank(16, 16), 0, 0, 16, 16, 9);
  check('alpha 9 counts as see-through', planAlignment([faint]).refused === null);
  const edge = paint(blank(16, 16), 0, 0, 16, 16, 10);
  check('alpha 10 counts as opaque', planAlignment([edge]).refused === 'opaque');
  const out = planAlignment([...withBody([[0, 0], [3, 3]]), opaque()], { leaveOut: [false, false, true] });
  check('a left out opaque frame does not refuse', out.refused === null && out.moves[1].dx === -3 && out.target !== null, out);
}

// ── Scope ──

{
  const frames = withBody([[0, 0], [0, 0], [0, 0], [9, 9], [9, 9], [9, 9], [9, 9]]);
  const plan = planAlignment(frames, { leaveOut: [false, false, false, true, true, true, true] });
  check('left out frames do not move', plan.moves.slice(3).every((m) => m.dx === 0 && m.dy === 0));
  check('left out frames do not count toward the target', same(plan.target, { feetRow: 25, centerCol: 14.5 }), plan.target);
  check('left out frames count as neither aligned nor in place', plan.aligned === 0 && plan.alreadyInPlace === 3, plan);
}
{
  const frames = withBody([[0, 0], [2, 1]]);
  const target = { feetRow: 28, centerCol: 12.5 };
  const plan = planAlignment(frames, { target });
  check('options.target is used when given', same(plan.target, target) && same(plan.moves.map((m) => [m.dx, m.dy]), [[-2, 3], [-4, 2]]), plan);
  check('options.target with no bodies is kept and moves nothing', same(planAlignment([blank(8, 8)], { target }).target, target));
}

// ── Inputs and shiftFrame ──

{
  const frames = withBody(JITTER);
  const copies = frames.map((f) => new Uint8ClampedArray(f.data));
  const options = { leaveOut: [false, true, false, false, false, false] };
  const { frames: out } = applyAlignment(frames, options);
  shiftFrame(frames[1], { dx: 3, dy: 3, shortened: false });
  check('inputs are not mutated', frames.every((f, i) => same([...f.data], [...copies[i]])));
  check('the options are not mutated', same(options, { leaveOut: [false, true, false, false, false, false] }));
  check('every output is a new frame', out.every((f, i) => f !== frames[i] && f.data !== frames[i].data));
  check('the size stays and the count stays', out.length === frames.length && out.every((f) => f.width === 40 && f.height === 40));
}
{
  const frames = withBody(JITTER);
  const { frames: out, plan } = applyAlignment(frames);
  const byHand = frames.map((f, i) => shiftFrame(f, plan.moves[i]));
  check('shiftFrame alone matches applyAlignment', byHand.every((f, i) => same([...f.data], [...out[i].data])));
  const frame = figureAt([0, 0]);
  const moved = { dx: -2, dy: 3, shortened: false };
  check('shiftFrame moves every pixel and clears what it left', movedWhole(frame, shiftFrame(frame, moved), moved));
  const zero = shiftFrame(frame, { dx: 0, dy: 0, shortened: false });
  check('a zero move is an identical copy', zero !== frame && same([...zero.data], [...frame.data]));
  const gone = shiftFrame(frame, { dx: 40, dy: 0, shortened: false });
  check('a move past the frame leaves it clear, with no throw', gone.data.every((v) => v === 0));
  // An ImageData from a canvas has this same shape.
  check('a Uint8ClampedArray view works', shiftFrame({ data: frame.data.subarray(0), width: 40, height: 40 }, moved).data.length === frame.data.length);
}

// ── Words ──

check('the words for a move', moveWords({ dx: -1, dy: -2 }) === 'Up 2, left 1' && moveWords({ dx: 3, dy: 4 }) === 'Down 4, right 3');
check('one direction reads alone', moveWords({ dx: -1, dy: 0 }) === 'Left 1' && moveWords({ dx: 0, dy: 2 }) === 'Down 2');
check('no move', moveWords({ dx: 0, dy: 0 }) === 'No move');
{
  const n = (aligned, alreadyInPlace) => ({ moves: [], refused: null, aligned, alreadyInPlace, shortenedFrames: [] });
  check('the status matches the approved copy', alignmentSummary(n(14, 2), []) === 'Aligned 14 of 16 frames. 2 were already in place.');
  check('the status reads for one frame', alignmentSummary(n(1, 1), []) === 'Aligned 1 of 2 frames. 1 was already in place.');
  check('the status drops a zero count', alignmentSummary(n(3, 0), []) === 'Aligned 3 of 3 frames.');
  check('every move zero says already aligned', alignmentSummary(n(0, 16), []) === 'These frames are already aligned.');
  check('refused says what to do', alignmentSummary({ ...n(0, 0), refused: 'opaque' }, []) === 'Remove the background first, then align.');
}

// ── Source pins ──

{
  const page = fs.readFileSync(path.join(ROOT, 'src/app/upload/page.tsx'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'src/components/sprites/AlignFramesPanel.tsx'), 'utf8');
  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/alignFrames.ts'), 'utf8');
  const between = (text, from, to) => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start + from.length);
    return start < 0 || end < 0 ? '' : text.slice(start, end);
  };
  const commit = between(page, 'const handleAlignCommit = useCallback(', 'const sliceGrid = useCallback(');
  const alignCard = between(page, '{/* Frame grid', '{/* Continue / shortcut export buttons */}');
  const press = between(panel, 'const runPress = useCallback(', 'const stillCurrent = useCallback(');
  const align = between(panel, 'const handleAlign = useCallback(', 'const handleUndo = useCallback(');
  const undoPress = between(panel, 'const handleUndo = useCallback(', 'return (\n    <div className="space-y-4">');
  const loop = between(panel, '// One timer steps both loops together.', 'const changeScope = useCallback(');
  const build = between(panel, 'async function buildAlignedSheet(', 'function paint(');

  check('the commit goes through replaceSheetSource with the version guard', /ownership\.bump\(\);\s*const token = ownership\.capture\(\);\s*const next = await prepare\(\);/.test(commit) && /!ownership\.isCurrent\(token\) \|\| !replaceSheetSource\(next\.sourceImage, next\.urls, token\.sheetVersion\)/.test(commit));
  check('a dropped commit reports false and notes it', /noteStale\('align'\);\s*return false;/.test(commit) && /return true;/.test(commit));
  check('only the commit writes: the panel never calls the store setters', !/replaceSheetSource|setFrameDataUrls|updateFrameData|setSpriteSheet/.test(panel));
  check('Align and Undo both go through the page commit', /await onCommit\(/.test(align) && /await onCommit\(/.test(undoPress));
  check('the card sits between the frame grid and the animations, once a sheet is set', /<FrameGrid frameDataUrls=\{frameDataUrls\} \/>\s*<\/div>\s*\)\}\s*\{\/\* Align frames, shown after slicing \*\/\}\s*\{spriteSheet && \(\s*<div className="rounded-lg border border-border-default bg-bg-surface p-6">\s*<AlignFramesPanel[\s\S]*?\/>\s*<\/div>\s*\)\}\s*\{\/\* Animation panel/.test(alignCard));
  check('the page hands the panel its commit, keyed to the sheet', /key=\{spriteSheet\.id\}/.test(alignCard) && /onCommit=\{handleAlignCommit\}/.test(alignCard));

  check('jump, death and destroy start left out', /LEFT_OUT_TYPES = \['jump', 'death', 'destroy'\]/.test(panel) && /animations\.filter\(\(a\) => LEFT_OUT_TYPES\.includes\(a\.type\)\)/.test(panel) && /toggled\.get\(f\.id\) \?\? startLeftOut\.has\(f\.id\)/.test(panel));
  check('the jumps line is the approved copy', /Jumps and falls are left out: aligning their feet would flatten them\./.test(panel));
  check('Leave out is a real toggle with a name', /<Button[^>]*aria-pressed=\{leftOut\}\s*aria-label=\{`Leave out frame \$\{numbers\[i\]\}`\}/.test(panel));
  check('the status line is always rendered, once', panel.match(/role="status"/g)?.length === 1 && /<\/div>\s*\{\/\* Always rendered, so each result is announced once\. \*\/\}\s*<p role="status"/.test(panel));
  check('the status clears before each press, so a repeat is announced', /setBusy\(true\);\s*setStatus\(''\);/.test(press));
  check('a second press while working does nothing', /if \(busyRef\.current\) return;\s*busyRef\.current = true;/.test(press) && /finally \{\s*busyRef\.current = false;/.test(press));
  check('decoding yields first', /useEffect\(\(\) => \{\s*let cancelled = false;\s*const timer = setTimeout\(async \(\) => \{/.test(panel) && /await nextTask\(\);\s*const built = await buildAlignedSheet\(/.test(align));
  check('Undo restores the exact earlier source image and frame URLs', /before: \{ sourceImage: sheet\.sourceImage, urls: frameDataUrls \}/.test(align) && /return stillCurrent\(\) \? undo\.before : null;/.test(undoPress));
  check('Undo closes when the sheet changed, pixel edits included', /undo\.version === sheetVersion && undo\.urls === frameDataUrls/.test(panel) && /disabled=\{!undoOpen\}/.test(panel) && /Undo is no longer available: the sheet changed\./.test(panel));
  check('Align is not offered when refused', /\{!plan\.refused && \(\s*<Button\s*size="sm"/.test(panel) && /if \(!ready \|\| plan\.refused\) return;/.test(align));
  check('reduced motion shows the first frame still', /stepRef\.current = reducedMotion \? 0 :/.test(loop) && /if \(reducedMotion \|\| steps < 2\) return;/.test(loop));
  check('the previews are pixelated canvases at the group fps, 8 for All frames', /imageRendering: 'pixelated'/.test(panel) && /ALL_FRAMES_FPS = 8/.test(panel) && /group\?\.fps \?\? ALL_FRAMES_FPS/.test(panel));
  check('only a rect-sized frame goes back on the sheet', /if \(pixels\.width === frame\.width && pixels\.height === frame\.height\) \{\s*sheetContext\.putImageData\(image, frame\.x, frame\.y\);/.test(build));
  check('the library has no React and no DOM calls', !/from 'react'|document\.|window\.|getContext/.test(lib));
  check('no em dashes in the new files', ![panel, lib].some((text) => text.includes('\u2014')));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
