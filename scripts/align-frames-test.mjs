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
  entryPoints: [path.join(ROOT, 'src/lib/alignFrames.ts'), path.join(ROOT, 'src/lib/headTrack.ts')],
  bundle: true, format: 'esm', platform: 'node', outdir: OUT_DIR, outExtension: { '.js': '.mjs' }, logLevel: 'silent',
  alias: { '@': path.join(ROOT, 'src') },
});
const {
  planAlignment, shiftFrame, applyAlignment, moveWords, alignmentSummary, measureFrame, solidBackground, walkLike, fillsCell, heldWords,
} = await import(pathToFileURL(path.join(OUT_DIR, 'alignFrames.mjs')).href);
const { trackHeads } = await import(pathToFileURL(path.join(OUT_DIR, 'headTrack.mjs')).href);

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

// A 12 x 20 figure in boots: 12 rows of torso, 6 of legs, 2 of boots, each
// boot 5 px wide, so its feet row (oy + 19) is 10 px wide. Centered on ox + 5.5.
function booted(frame, ox, oy) {
  paint(frame, ox, oy, 12, 12);
  paint(frame, ox + 1, oy + 12, 2, 6);
  paint(frame, ox + 9, oy + 12, 2, 6);
  paint(frame, ox, oy + 18, 5, 2);
  paint(frame, ox + 7, oy + 18, 5, 2);
  return frame;
}
// The lowest row of a frame with at least `min` painted pixels.
function rowWith(frame, min) {
  for (let y = frame.height - 1; y >= 0; y--) {
    let n = 0;
    for (let x = 0; x < frame.width; x++) if (frame.data[(y * frame.width + x) * 4 + 3] > 0) n++;
    if (n >= min) return y;
  }
  return -1;
}
const withBody = (offsets) => offsets.map((o) => figureAt(o));

// The two fields measureFrame has always returned: the feet row and the legs' center.
const legsOf = (m) => m && ({ feetRow: m.feetRow, centerCol: m.centerCol });

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
  // Audit r1: a spark before the body in reading order (top left). The body
  // is the largest box, not the first one.
  const frames = withBody([[0, 0], [0, 0], [0, 0]]);
  paint(frames[1], 1, 1, 4, 4);
  const plan = planAlignment(frames);
  check('a spark first in reading order does not steer the frame: the largest box wins', noMoves(plan) && same(plan.target, { feetRow: 25, centerCol: 14.5 }), plan);
}
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
{
  // Documented limit (audit r1, the sith sheet; HQ 2026-11-07-007): a weapon
  // reaching below the feet counts as the feet, thin or thick. A rule that
  // skipped thin rows was tried and dropped: on real sheets it moved sandals
  // by a pixel and did not fix a low saber. A 2 px saber held at the right
  // side reaches 6 px below the boots in every frame, with the feet jittering:
  // the saber tips land on one line.
  const saber = (o) => paint(booted(blank(40, 40), 10 + o[0], 6 + o[1]), 22 + o[0], 8 + o[1], 2, 24);
  const { frames: out, plan } = applyAlignment(JITTER.map(saber));
  check('limit: a thin saber below the feet counts as the feet', plan.target.feetRow === 31 && out.every((f) => feetOf(f) === 31), out.map(feetOf));
  // When its reach below the boots changes from frame to frame (1, 3, 4, 6
  // px), the tips line up and the boots move off the line.
  const swung = [1, 3, 4, 6].map((reach) => paint(booted(blank(40, 40), 10, 6), 22, 8, 2, 18 + reach));
  const still = planAlignment(swung);
  check('limit: a thin saber whose reach changes moves the boots', same(still.moves.map((m) => m.dy), [2, 0, -1, -3]) && still.target.feetRow === 28, still.moves);
  // A thick blade (6 px) and a weapon as wide as the feet count the same way.
  const thick = [0, 0, 0, 0].map(() => booted(blank(40, 40), 10, 6));
  paint(thick[3], 22, 8, 6, 22);
  check('limit: a thick weapon below the feet counts as the feet', planAlignment(thick).moves[3].dy === -4, planAlignment(thick).moves[3]);
  const wide = [0, 0, 0, 0].map(() => booted(blank(40, 40), 10, 6));
  paint(wide[3], 8, 26, 16, 2);
  check('limit: a wide weapon at foot level counts as the feet', planAlignment(wide).moves[3].dy === -2, planAlignment(wide).moves[3]);
}

// ── HQ 2026-11-07-005: a small side-view walk with a 1 px toe ──

// A 24 x 32 side-view walker, ground on row oy + 27. Poses: 'contact' (both
// feet flat), 'passing' (one foot flat, one lifted), 'toe' (the back foot on
// its toe: the lowest row is one pixel, the rest of that foot a row higher;
// the front foot swings clear).
function walker(frame, pose, ox, oy) {
  const g = oy + 27;
  paint(frame, ox + 3, oy, 6, 7); // head
  paint(frame, ox + 4, oy + 7, 5, 10); // torso
  if (pose === 'contact') {
    paint(frame, ox + 7, oy + 17, 2, 10); paint(frame, ox + 7, g, 4, 1);
    paint(frame, ox + 3, oy + 17, 2, 10); paint(frame, ox + 1, g, 4, 1);
  } else if (pose === 'passing') {
    paint(frame, ox + 5, oy + 17, 2, 10); paint(frame, ox + 5, g, 4, 1);
    paint(frame, ox + 3, oy + 17, 2, 7); paint(frame, ox + 3, oy + 24, 3, 1);
  } else {
    paint(frame, ox + 3, oy + 17, 2, 9); paint(frame, ox + 2, g - 1, 3, 1); paint(frame, ox + 1, g, 1, 1);
    paint(frame, ox + 8, oy + 17, 2, 8); paint(frame, ox + 8, oy + 25, 4, 1);
  }
  return frame;
}
const WALK = ['contact', 'passing', 'toe', 'passing', 'contact', 'passing', 'toe', 'passing'];
const WALK_DRIFT = [[0, 0], [1, -1], [0, 1], [-1, 0], [0, 0], [1, 1], [-1, -1], [0, 0]];
const walk = () => WALK.map((pose, i) => walker(blank(24, 32), pose, 6 + WALK_DRIFT[i][0], 2 + WALK_DRIFT[i][1]));
{
  const frames = walk();
  const { frames: out, plan } = applyAlignment(frames);
  const lowest = out.map(feetOf);
  const soles = out.map((f) => rowWith(f, 2));
  // The feet are the lowest row, so a 1 px toe counts: every frame's lowest
  // row lands on one line, and on a toe frame the rest of that foot sits a
  // row above it, as drawn.
  check('HQ toe walk: the target is the ground row', plan.target.feetRow === 29, plan.target);
  check('HQ toe walk: the lowest row of every frame lands on one line, toe frames included', lowest.every((row) => row === 29), lowest);
  check('HQ toe walk: on a toe frame the foot sits a row above the toe', WALK.every((pose, i) => soles[i] === (pose === 'toe' ? 28 : 29)), soles);
  check('HQ toe walk: a second pass moves nothing', noMoves(planAlignment(out)));
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
  const words = alignmentSummary(plan, [1, 2, 3, 4, 5]);
  check('L4: a held frame is named, and never "already aligned"', words === 'Aligned 0 of 5 frames. 4 were already in place. Frame 3 could not move without cutting something off.', words);
  check('P3: the list names a held frame', moveWords(plan.moves[2]) === "Can't move without cutting pixels" && moveWords(plan.moves[0]) === 'No move');
}
{
  // One frame held, one moved part of the way, one moved in full.
  const frames = withBody([[0, 0], [0, 0], [-8, 0], [0, -4], [3, 0]]);
  paint(frames[2], 39, 3, 1, 1);
  paint(frames[3], 3, 36, 1, 1, 3);
  const plan = planAlignment(frames);
  const words = alignmentSummary(plan, [2, 4, 6, 8, 10]);
  check('L4: held and shortened frames each get their own line', words === 'Aligned 2 of 5 frames. 2 were already in place. Frame 6 could not move without cutting something off. Frame 8 moved as far as it could without cutting anything off.', words);
  check('L4: a frame shortened part of the way keeps its move words', moveWords(plan.moves[3]) === 'Down 3', plan.moves[3]);
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
  // The third body is 3 px off, so the set is not steady (a body 1 px off
  // would be: see the walk-fix cases). Its legs center on 13 + 17/3.
  const { moves } = planAlignment([legs(10, 2), legs(10, 2), legs(13, 1)]);
  check('the first pass rounds the distance to the target', moves[2].dx === -4 && moves[0].dx === 0, moves);
  const close = planAlignment([legs(10, 3), legs(10, 3), legs(9, 1)]);
  check('centers that fit in one pixel count as aligned', noMoves(close) && close.alreadyInPlace === 3, close.moves);
  const given = planAlignment([legs(9, 1)], { target: close.target });
  check('that does not soften a given target', given.moves[0].dx === -1, given.moves);
}

// ── Refused ──

{
  // L2a: the half-border test from sheetAlpha.ts.
  const opaque = () => paint(blank(40, 40), 0, 0, 40, 40);
  const plan = planAlignment([opaque(), opaque()]);
  check('L2: fully painted frames are refused, with no moves', plan.refused === 'opaque' && noMoves(plan) && plan.target === null && plan.aligned === 0 && same(plan.filled, [0, 1]), plan);
  const pinhole = opaque();
  pinhole.data[(20 * 40 + 20) * 4 + 3] = 0;
  check('L2: an opaque frame with one clear pixel is refused', planAlignment([pinhole]).refused === 'opaque');
  const corner = opaque();
  corner.data[3] = 0;
  check('L2: an opaque frame with one clear border pixel is refused', planAlignment([corner]).refused === 'opaque');
  const faint = paint(blank(16, 16), 0, 0, 16, 16, 9);
  check('L2: a faint wash over the whole frame is refused: the border must be clear', planAlignment([faint]).refused === 'opaque');
  // Ring of 60; the top and bottom rows (32) are clear, the side columns not.
  const half = paint(blank(16, 16), 0, 1, 16, 14);
  check('L2: half the border clear is not refused', planAlignment([half]).refused === null);
  const out = planAlignment([...withBody([[0, 0], [3, 3]]), opaque()], { leaveOut: [false, false, true] });
  check('a left out opaque frame does not refuse', out.refused === null && out.moves[1].dx === -3 && out.target !== null && same(out.filled, []), out);
}
{
  // D3: a frame that fills its cell is skipped, not a refusal of the scope.
  const opaque = () => paint(blank(40, 40), 0, 0, 40, 40);
  const bodies = () => withBody([[0, 0], [0, 0], [3, 3], [3, 3]]);
  const alone = planAlignment(bodies());
  const plan = planAlignment([...bodies(), opaque()]);
  check('D3: one filled frame among transparent frames is skipped and listed', plan.refused === null && same(plan.filled, [4]) && same(plan.moves[4], { dx: 0, dy: 0, shortened: false }) && same(plan.moves.slice(0, 4), alone.moves), plan);
  // Measured, the filled frame (feet 39) would make the target 28.
  check('D3: a filled frame does not steer the target or count', same(plan.target, { feetRow: 25, centerCol: 14.5 }) && plan.aligned === 2 && plan.alreadyInPlace === 2, plan);
  const pinhole = opaque();
  pinhole.data[(20 * 40 + 20) * 4 + 3] = 0;
  check('D3: a nearly opaque frame among others is filled too', same(planAlignment([...withBody([[0, 0]]), pinhole]).filled, [1]));
  const every = planAlignment([opaque(), blank(40, 40), opaque()]);
  check('D3: every painted frame filled refuses opaque; an empty one does not save it', every.refused === 'opaque' && same(every.filled, [0, 2]) && noMoves(every), every);
  const empty = planAlignment([blank(40, 40), ...withBody([[0, 0], [2, 0]])]);
  const hollow = planAlignment([blank(40, 40), blank(40, 40)]);
  check('D3: an empty frame is neither filled nor refusing', empty.refused === null && same(empty.filled, []) && hollow.refused === null && same(hollow.filled, []), { empty, hollow });
  // A faint pixel is paint: a frame with only that is not empty.
  const speck = blank(40, 40);
  speck.data[(20 * 40 + 20) * 4 + 3] = 3;
  check('D3: a frame with any paint keeps a filled frame from refusing', planAlignment([opaque(), speck]).refused === null);
  check('D3: the status names a filled frame', alignmentSummary(plan, [1, 2, 3, 4, 7]) === 'Aligned 2 of 4 frames. 2 were already in place. Frame 7 fills its cell, so it stays as it is.', alignmentSummary(plan, [1, 2, 3, 4, 7]));
  const still = planAlignment([...withBody([[0, 0], [0, 0]]), opaque(), opaque()]);
  const words = alignmentSummary(still, [1, 2, 3, 4]);
  check('D3: nothing moved with a filled frame says the filled lines, never already aligned', words === 'Frame 3 fills its cell, so it stays as it is. Frame 4 fills its cell, so it stays as it is.', words);
  check('D3: a refused scope keeps the refusal line', alignmentSummary(every, [1, 2, 3]) === 'Remove the background first, then align.');
}
{
  // D3: Remove background only for a solid background.
  const solid = (r, g, b) => {
    const f = blank(8, 8);
    for (let i = 0; i < f.data.length; i += 4) f.data.set([r, g, b, 255], i);
    return f;
  };
  check('D3: opaque corners within 15 of one color read as solid', solidBackground([solid(200, 40, 200), solid(215, 25, 185)]));
  check('D3: corners 16 apart in one channel are not solid', !solidBackground([solid(200, 40, 200), solid(200, 56, 200)]));
  const soft = solid(200, 40, 200);
  soft.data[(7 * 8 + 7) * 4 + 3] = 254;
  check('D3: a corner that is not fully opaque is not solid', !solidBackground([solid(200, 40, 200), soft]));
  const cleared = paint(blank(40, 40), 0, 1, 40, 38);
  check('D3: transparent corners are not solid, nor are no frames', !solidBackground([cleared]) && !solidBackground([]));
}
{
  // L2b.
  const sizes = planAlignment([...withBody([[0, 0], [3, 3]]), figure(blank(40, 48), 10, 6)]);
  check('L2: frames of two sizes are refused with sizes, with no moves', sizes.refused === 'sizes' && noMoves(sizes) && sizes.target === null && sizes.aligned === 0, sizes);
  check('L2: two widths are refused too', planAlignment([figure(blank(40, 40), 10, 6), figure(blank(44, 40), 10, 6)]).refused === 'sizes');
  const out = planAlignment([...withBody([[0, 0], [3, 3]]), figure(blank(40, 48), 10, 6)], { leaveOut: [false, false, true] });
  check('L2: a left out frame of another size does not refuse', out.refused === null && out.moves[1].dx === -3, out);
  check('L4: sizes says what to do', alignmentSummary(sizes, [1, 2, 3]) === 'Align needs frames of one size. Extract them with padding on, then align.', alignmentSummary(sizes, [1, 2, 3]));
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

// ── The walk fix (HQ room 2026-11-11-098, 2026-11-14-053) ──
// A walk moves its legs on purpose. Centered from its legs it shakes; centered
// from its head and torso it does not; steady frames get no moves; and a plan
// says when it would make the heads move more than they do now.
{
  // A 10 x 20 walker: 12 rows of torso at ox, and two 2 px legs at ox + a and
  // ox + b. Its head and torso center on ox + 4.5, its legs on ox + (a + b) / 2 + 0.5.
  const walker = (ox, oy, a, b, legRows = 8) => {
    const f = blank(40, 40);
    paint(f, ox, oy, 10, 12);
    paint(f, ox + a, oy + 12, 2, legRows);
    paint(f, ox + b, oy + 12, 2, legRows);
    return f;
  };
  const STRIDE = [[0, 8], [4, 8], [0, 4], [2, 6]];
  const spreadOf = (values) => Math.max(...values) - Math.min(...values);
  const upper = (frames) => frames.map(() => 'upper');

  const one = measureFrame(walker(10, 6, 0, 8));
  check('walk: measureFrame also reads the top row and the centers of the head and torso and of the head',
    same(one, { feetRow: 25, centerCol: 14.5, topRow: 6, upperCol: 14.5, headCol: 14.5 }), one);
  {
    const weapon = figureAt([0, 0]);
    paint(weapon, 20, 11, 12, 2);
    const m = measureFrame(weapon);
    check('walk: a weapon out at the hips moves the head-and-torso center, not the legs or the head',
      m.centerCol === 14.5 && m.headCol === 14.5 && m.upperCol > 15, m);
  }

  // In place: the body never moves, the legs swing 4 px, the feet are level.
  const inPlace = STRIDE.map(([a, b]) => walker(10, 6, a, b));
  const legsSpread = spreadOf(inPlace.map((f) => measureFrame(f).centerCol));
  for (const [name, options] of [['legs', {}], ['head and torso', { anchors: upper(inPlace) }]]) {
    const plan = planAlignment(inPlace, options);
    check(`walk: steady already (feet level, body still, legs ${legsSpread} px apart): no moves, anchor ${name}`,
      legsSpread === 4 && plan.steady === true && noMoves(plan) && plan.aligned === 0 && plan.alreadyInPlace === 4 &&
      alignmentSummary(plan, [1, 2, 3, 4]) === 'These frames are already aligned.', plan);
  }
  {
    // The same walk with a body 1 px off is still steady; 1.5 px off is not.
    const oneOff = [...inPlace.slice(0, 3), walker(11, 6, 2, 6)];
    const wide = [...inPlace.slice(0, 3), walker(12, 6, 2, 6, 8)];
    paint(wide[3], 12, 6, 1, 12, 0); // clear the torso's first column: its center moves by half a pixel
    const upperOf = (f) => measureFrame(f).upperCol;
    check('walk: the steady rule holds at 1 px and ends above it',
      planAlignment(oneOff, { anchors: upper(oneOff) }).steady === true &&
      spreadOf(wide.map(upperOf)) > 1 && planAlignment(wide, { anchors: upper(wide) }).steady === false,
      { oneOff: oneOff.map(upperOf), wide: wide.map(upperOf) });
    // Feet 2 px apart end it too.
    const feet = [...inPlace.slice(0, 3), walker(10, 8, 2, 6)];
    check('walk: feet 2 px apart are not steady', planAlignment(feet).steady === false && planAlignment(feet).moves[3].dy === -2);
  }

  // Drifting: the body drifts 2 px each way while the legs happen to stay put.
  const drift = [walker(10, 6, 0, 8), walker(12, 6, 0, 4), walker(8, 6, 4, 8), walker(10, 6, 2, 6)];
  {
    const byLegs = planAlignment(drift);
    const byUpper = planAlignment(drift, { anchors: upper(drift) });
    const after = applyAlignment(drift, { anchors: upper(drift) }).frames;
    check('walk: centered from the legs, a drifting body is left drifting', noMoves(byLegs) && byLegs.steady === false, byLegs.moves);
    check('walk: centered from the head and torso, the body lands on one column',
      same(byUpper.moves.map((m) => m.dx), [0, -2, 2, 0]) && byUpper.moves.every((m) => m.dy === 0) &&
      spreadOf(after.map((f) => measureFrame(f).upperCol)) === 0 && byUpper.target.feetRow === 25, byUpper.moves);
    check('walk: aligning twice from the head and torso moves nothing', noMoves(planAlignment(after, { anchors: upper(after) })));
  }
  {
    // 200 fuzzed walks: drift, stride and height all vary.
    let nudged = 0, shaky = 0;
    let seed = 7;
    const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 200; run++) {
      const frames = Array.from({ length: 4 + next(5) }, () => {
        const [a, b] = STRIDE[next(4)];
        return walker(8 + next(7), 4 + next(5), a, b);
      });
      const options = { anchors: upper(frames) };
      const first = planAlignment(frames, options);
      const out = applyAlignment(frames, options).frames;
      if (!noMoves(planAlignment(out, options))) nudged++;
      if (!first.steady && spreadOf(out.map((f) => measureFrame(f).upperCol)) > 0) shaky++;
    }
    check('walk: 200 fuzzed walks land on one column from the head and torso, and a second pass moves nothing', nudged === 0 && shaky === 0, { nudged, shaky });
  }

  // Never worse, sideways: a walk in place whose feet are not level. From the
  // legs the heads end 4 px apart; from the head and torso they stay put.
  const uneven = STRIDE.map(([a, b], i) => walker(10, [6, 8, 6, 9][i], a, b));
  {
    const byLegs = planAlignment(uneven);
    const byUpper = planAlignment(uneven, { anchors: upper(uneven) });
    const heightOnly = planAlignment(uneven, { parts: 'height' });
    check('walk: from the legs the plan would move the heads more sideways, and says so',
      same(byLegs.moves.map((m) => m.dx), [0, -2, 2, 0]) && byLegs.worse.sideways === true && byLegs.worse.height === false, byLegs);
    check('walk: from the head and torso it does not', byUpper.moves.every((m) => m.dx === 0) && same(byUpper.worse, { sideways: false, height: false }) &&
      same(byUpper.moves.map((m) => m.dy), [0, -2, 0, -3]), byUpper);
    check('walk: the up-and-down part alone keeps every frame on its column', heightOnly.moves.every((m) => m.dx === 0) &&
      same(heightOnly.moves.map((m) => m.dy), [0, -2, 0, -3]) && same(heightOnly.worse, { sideways: false, height: false }), heightOnly);
  }
  {
    // Never worse, in height: the heads are level, one frame crouches (legs 2
    // rows long). Feet on one line would throw that head 6 rows down.
    const crouch = [walker(10, 6, 0, 8), walker(10, 6, 0, 8), walker(13, 6, 0, 8, 2), walker(10, 6, 0, 8)];
    const fullPlan = planAlignment(crouch);
    const sideways = planAlignment(crouch, { parts: 'sideways' });
    check('walk: feet on one line would move the heads more in height, and the plan says so',
      fullPlan.moves[2].dy === 6 && fullPlan.worse.height === true && fullPlan.worse.sideways === false, fullPlan);
    check('walk: the sideways part alone moves no frame up or down', sideways.moves.every((m) => m.dy === 0) &&
      sideways.moves[2].dx === -3 && same(sideways.worse, { sideways: false, height: false }), sideways);
    check('walk: a part that is left out is not counted as shortened', sideways.shortenedFrames.length === 0 && planAlignment(crouch, { parts: 'height' }).shortenedFrames.length === 0);
  }
  {
    // Two anchors in one plan (AUDIT align-walk-r1, F3): one column for the
    // whole scope, each frame brought to it by its own anchor, and one feet
    // row. A character must not jump sideways when it changes animation.
    const mixed = [walker(10, 6, 0, 8), walker(13, 6, 0, 8), figureAt([5, 0]), figureAt([8, 0])];
    const anchors = ['upper', 'upper', 'legs', 'legs'];
    const plan = planAlignment(mixed, { anchors });
    const after = mixed.map((f, i) => measureFrame(shiftFrame(f, plan.moves[i])));
    const cols = after.map((m, i) => (anchors[i] === 'upper' ? m.upperCol : m.centerCol));
    check('walk: with two anchors in one plan every frame lands on one shared column, each by its own anchor',
      same(plan.moves.map((m) => m.dx), [3, 0, -2, -5]) && plan.moves.every((m) => m.dy === 0) &&
      Math.max(...cols) - Math.min(...cols) < 1 && plan.target.centerCol !== null, { moves: plan.moves, cols });
    // The gap between a walk and an idle drawn 10 px apart goes, as on main.
    const apart = [walker(4, 6, 0, 8), walker(4, 6, 0, 8), figureAt([14, 0]), figureAt([14, 0])];
    const gone = planAlignment(apart, { anchors });
    const afterGap = apart.map((f, i) => measureFrame(shiftFrame(f, gone.moves[i])));
    const colsGap = afterGap.map((m, i) => (anchors[i] === 'upper' ? m.upperCol : m.centerCol));
    const before = apart.map((f, i) => { const m = measureFrame(f); return anchors[i] === 'upper' ? m.upperCol : m.centerCol; });
    check('walk: a walk and an idle drawn apart are brought together, not left each on its own column',
      Math.max(...before) - Math.min(...before) > 5 && Math.max(...colsGap) - Math.min(...colsGap) < 1 && gone.moves.some((m) => m.dx !== 0), { before, colsGap, moves: gone.moves });
    // A second pass on the result moves nothing.
    const again = planAlignment(apart.map((f, i) => shiftFrame(f, gone.moves[i])), { anchors });
    check('walk: a mixed scope aligned once is settled: a second pass moves nothing', again.moves.every((m) => m.dx === 0 && m.dy === 0), again.moves);
    // Legs only: exactly the plan with no anchors at all (main's).
    const idle = [figureAt([5, 0]), figureAt([8, 0]), figureAt([2, 1])];
    check('walk: a scope with no head-and-torso frame is planned exactly as with no anchors',
      same(planAlignment(idle, { anchors: ['legs', 'legs', 'legs'] }).moves, planAlignment(idle).moves));
  }
  {
    // AUDIT align-walk-r1, L3: centers are fractions, and a widening of
    // exactly 1 px must not read as more than 1 through rounding.
    const pair = [figureAt([5, 0]), figureAt([6, 0])];
    const three = [figureAt([6, 0]), figureAt([6, 0]), figureAt([5, 0])];
    // The head-and-torso centers are 2 px apart, so the set is not steady already.
    const body = (centerCol) => ({ feetRow: 30, centerCol, topRow: 6, upperCol: 2 * centerCol, headCol: 15.594594594594595 });
    const plan = planAlignment(three, { measured: [body(11), body(11), body(10)] });
    const two = planAlignment(pair, { measured: [body(10), body(12.2)] });
    check('walk: a head made exactly 1 px wider is not called worse; 2 px is',
      same(plan.moves.map((m) => m.dx), [0, 0, 1]) && (15.594594594594595 + 1) - 15.594594594594595 > 1 && plan.worse.sideways === false &&
      Math.abs(two.moves[0].dx - two.moves[1].dx) >= 2 && two.worse.sideways === true, { plan: plan.moves, two: two.moves, worse: [plan.worse, two.worse] });
  }
  {
    // AUDIT align-walk-r1, F1: the head is followed by matching its pixels,
    // which a plume, a cape or hair that swings with the stride cannot pull.
    // 64 px cells. A 12 x 12 head, an 8 x 14 torso, two legs that step, and a
    // part that swings: a plume above the head, or a cape beside it.
    // Each part is drawn with a busy texture of its own, as real art is:
    // a neighbouring pixel is another colour, so a shifted patch does not
    // match by accident (the file's `paint` is a smooth ramp).
    const tex = (f, x0, y0, w, h, seed) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const u = x - x0, v = y - y0;
        f.data.set([(u * 97 + v * 61 + seed * 53) % 200 + 40, (u * 41 + v * 113 + seed * 29) % 200 + 40, (u * 71 + v * 23 + seed * 89) % 200 + 40, 255], (y * f.width + x) * 4);
      }
      return f;
    };
    const body = (f, ox, oy, a, b) => { tex(f, ox, oy, 12, 12, 1); tex(f, ox + 2, oy + 12, 8, 14, 2); tex(f, ox + 2 + a, oy + 26, 3, 10, 3); tex(f, ox + 7 + b, oy + 26, 3, 10, 4); return f; };
    const plumed = (swing, a, b, head = 0, pw = 6, ph = 5, oy = 14) => body(tex(blank(64, 64), 25 + swing + head, oy - ph, pw, ph, 5), 22 + head, oy, a, b);
    const caped = (swing, a, b, oy = 10) => { const f = body(blank(64, 64), 20, oy, a, b); tex(f, 32 + swing, oy + 2, 6, 18, 6); return f; };
    const STEP = [[-1, -2, 2], [0, 0, 0], [1, 2, -2], [0, 0, 0]];
    const asWalk = (frames) => ({ anchors: frames.map(() => 'upper'), groups: frames.map(() => 0) });
    // As the card plans: an untracked walk's centering held, the part the
    // measures call worse left out.
    const preselected = (frames) => {
      const full = planAlignment(frames, { ...asWalk(frames), holdUntracked: true });
      const parts = full.worse.sideways && full.worse.height ? 'none' : full.worse.height ? 'sideways' : full.worse.sideways ? 'height' : 'both';
      return { full, parts, plan: parts === 'both' ? full : planAlignment(frames, { ...asWalk(frames), parts, holdUntracked: true }) };
    };
    const bodiesOf = (frames) => frames.map((f) => measureFrame(f));

    // A small plume: the head is followed, the walk is steady, nothing moves,
    // though the paint-weighted head sways.
    const small = STEP.map(([s, a, b]) => plumed(3 * s, a, b));
    const smallTrack = trackHeads(small, bodiesOf(small));
    const smallPlan = preselected(small);
    check('F1: a walk with a still head and a plume that swings is followed by its head: steady, no frame moves',
      smallTrack.sure && same(smallTrack.offsets.map((o) => [o.dx, o.dy]), [[0, 0], [0, 0], [0, 0], [0, 0]]) &&
      spreadOf(bodiesOf(small).map((m) => m.headCol)) > 1 && smallPlan.full.steady && smallPlan.plan.moves.every((m) => m.dx === 0 && m.dy === 0),
      { track: smallTrack, moves: smallPlan.plan.moves });

    // A cape beside the head. By paint the head and torso sway (the cape
    // pulls their center), so the audited rule did not call this walk steady
    // and centered it, which made the still head sway. Followed, the head is
    // still: steady, nothing moves.
    const cape = STEP.map(([s, a, b]) => caped(3 * s, a, b));
    const capePlan = preselected(cape);
    check('F1: a still head beside a swinging cape: not steady by its paint, steady by its followed head; no frame moves',
      spreadOf(bodiesOf(cape).map((m) => m.upperCol)) > 1 && capePlan.full.steady && capePlan.plan.moves.every((m) => m.dx === 0 && m.dy === 0),
      { upper: bodiesOf(cape).map((m) => m.upperCol), steady: capePlan.full.steady, moves: capePlan.plan.moves });
    // The same walk with one frame drawn 2 rows lower is not steady, so a
    // plan is made. Its sideways moves come from the paint, and the
    // paint-weighted guard would let them pass (the fault AUDIT found); the
    // followed head says they would make it sway. The feet are still lined up.
    const stepped = STEP.map(([s, a, b], k) => caped(3 * s, a, b, k === 2 ? 12 : 10));
    const steppedPlan = preselected(stepped);
    const paintHeads = bodiesOf(stepped).map((m) => m.headCol);
    const byPaint = spreadOf(paintHeads.map((head, k) => head + steppedPlan.full.moves[k].dx)) - spreadOf(paintHeads);
    check('F1: where the paint-weighted head would let a centering pass, the followed head does not: the centering is left out, with a measured reason, and the feet are lined up',
      !steppedPlan.full.steady && steppedPlan.full.moves.some((m) => m.dx !== 0) && byPaint <= 1 && steppedPlan.full.worse.sideways && !steppedPlan.full.unsure &&
      steppedPlan.parts === 'height' && steppedPlan.plan.moves.every((m) => m.dx === 0) && steppedPlan.plan.moves.some((m) => m.dy !== 0),
      { full: steppedPlan.full.moves, byPaint, worse: steppedPlan.full.worse, plan: steppedPlan.plan.moves });

    // A plume as big as the head: the head's own patch follows the plume, and
    // the taller patch (head and shoulders) shows it. Not sure, so not centered.
    const big = STEP.map(([s, a, b]) => plumed(5 * s, a, b, 0, 10, 8));
    const bigTrack = trackHeads(big, bodiesOf(big));
    const bigAlone = trackHeads(big, bodiesOf(big), { twin: 0 });
    const bigPlan = preselected(big);
    check('F1: a plume as big as the head fools the head patch alone; the second opinion catches it, and the walk is not centered unasked',
      bigAlone.sure && bigAlone.offsets.some((o) => Math.abs(o.dx) >= 4) && !bigTrack.sure && bigTrack.doubt === 'split' &&
      bigPlan.full.unsure && !bigPlan.full.worse.sideways && bigPlan.parts === 'both' && bigPlan.plan.moves.every((m) => m.dx === 0) &&
      planAlignment(big, asWalk(big)).moves.some((m) => m.dx !== 0), { alone: bigAlone, both: bigTrack.doubt, worse: bigPlan.full.worse });

    // The second opinion counts even when it is not sure of the whole set.
    // The same big plume drawn as smooth ramps (the file's `paint`): the head
    // patch alone follows the plume surely; the taller patch loses its way at
    // the edge of its search, and where it did find the head it disagrees.
    const ramp = (swing, a, b) => { const f = blank(64, 64); paint(f, 25 + swing, 6, 10, 8); paint(f, 22, 14, 12, 12); paint(f, 24, 26, 8, 14); paint(f, 24 + a, 40, 3, 10); paint(f, 29 + b, 40, 3, 10); return f; };
    const ramps = [[-5, -2, 2], [0, 0, 0], [5, 2, -2], [0, 0, 0]].map(([s, a, b]) => ramp(s, a, b));
    const rampAlone = trackHeads(ramps, bodiesOf(ramps), { twin: 0 });
    const rampTaller = trackHeads(ramps, bodiesOf(ramps), { patchTo: 0.4, twin: 0 });
    const rampBoth = trackHeads(ramps, bodiesOf(ramps));
    check('F1: an unsure second opinion still counts where it found the head: the two disagree, so the head is not followed',
      rampAlone.sure && rampAlone.offsets.some((o) => Math.abs(o.dx) >= 4) && !rampTaller.sure && !rampBoth.sure && rampBoth.doubt === 'split',
      { alone: rampAlone.offsets.map((o) => o && o.dx), taller: [rampTaller.doubt, rampTaller.offsets.map((o) => o && o.dx)], both: rampBoth.doubt });

    // A head that changes between frames (drawn as a smooth ramp in one
    // frame) matches too little of the patch anywhere: not followed.
    const turned = STEP.map(([, a, b], k) => { const f = plumed(0, a, b, 0, 0, 0); if (k === 2) paint(f, 22, 14, 8, 12); return f; });
    const turnedTrack = trackHeads(turned, bodiesOf(turned));
    check('F1: a head that changes shape or colour in a frame is not followed', !turnedTrack.sure && turnedTrack.doubt === 'shape', turnedTrack);

    // The head and torso are the body's top 60%, not its top half: an arm out
    // at rows 10 and 11 of a 20-row figure pulls that center; one at rows 12
    // and 13 does not.
    const armAt = (row) => { const f = figureAt([0, 0]); paint(f, 20, 6 + row, 8, 2); return measureFrame(f).upperCol; };
    check('walk: the head and torso are the top 60% of the body: an arm in rows 10 and 11 pulls their center, one in rows 12 and 13 does not',
      armAt(10) > measureFrame(figureAt([0, 0])).upperCol + 0.5 && armAt(12) === measureFrame(figureAt([0, 0])).upperCol, [armAt(10), armAt(12), measureFrame(figureAt([0, 0])).upperCol]);

    // One flat colour: every offset matches about as well, so the head cannot
    // be followed. As a Walk it is not centered unasked, and the plan says it
    // only could not tell; from the legs the same frames align as on main.
    const flat = (ox, a, b) => { const f = blank(64, 64); const fill = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f.data.set([200, 200, 200, 255], (y * 64 + x) * 4); }; fill(ox, 14, 12, 12); fill(ox + 2, 26, 8, 14); fill(ox + 2 + a, 40, 3, 10); fill(ox + 7 + b, 40, 3, 10); return f; };
    const mono = [flat(20, -2, 2), flat(23, 0, 0), flat(20, 2, -2), flat(23, 0, 0)];
    const monoTrack = trackHeads(mono, bodiesOf(mono));
    const monoPlan = preselected(mono);
    const monoLegs = planAlignment(mono, { anchors: mono.map(() => 'legs'), groups: mono.map(() => 0) });
    check('F1: a figure of one flat colour cannot be followed: as a Walk it is not centered unasked and the plan says it only could not tell; from the legs it aligns as before',
      !monoTrack.sure && !monoPlan.full.worse.sideways && monoPlan.full.unsure && monoPlan.parts === 'both' && monoPlan.plan.moves.every((m) => m.dx === 0) &&
      !monoLegs.unsure && same(monoLegs.moves.map((m) => m.dx), planAlignment(mono).moves.map((m) => m.dx)) && monoLegs.moves.some((m) => m.dx !== 0),
      { doubt: monoTrack.doubt, worse: monoPlan.full.worse, legs: monoLegs.moves });

    // A head that truly sways with its body, no swinging part: followed, and
    // centered, and the head ends steadier.
    const sway = [[-2, -2, 2], [0, 0, 0], [2, 2, -2], [0, 0, 0]].map(([h, a, b]) => plumed(0, a, b, h, 0, 0));
    const swayTrack = trackHeads(sway, bodiesOf(sway));
    const swayPlan = preselected(sway);
    check('F1: a head that truly sways is followed, and the walk is centered as before',
      swayTrack.sure && same(swayTrack.offsets.map((o) => o.dx), [0, 2, 4, 2]) && swayPlan.parts === 'both' && !swayPlan.full.unsure &&
      spreadOf(swayTrack.offsets.map((o, k) => o.dx + swayPlan.plan.moves[k].dx)) <= 1, { track: swayTrack.offsets, moves: swayPlan.plan.moves });

    // Steady at a feet row spread of 1, not at 2, for a followed walk.
    const lift = (rows) => STEP.map(([s, a, b], k) => plumed(3 * s, a, b, 0, 6, 5, 14 + (k === 2 ? rows : 0)));
    check('F1: a followed walk is steady with its feet rows 1 px apart, and not with them 2 px apart',
      preselected(lift(1)).full.steady === true && preselected(lift(2)).full.steady === false);

    // The shape rule at its edge: legs spread exactly twice the upper body's is not a walk; just over is.
    const shape = (legs, upper) => [{ feetRow: 30, centerCol: 10, topRow: 6, upperCol: 20, headCol: 20 }, { feetRow: 30, centerCol: 10 + legs, topRow: 6, upperCol: 20 + upper, headCol: 20 }];
    check('walk: the shape rule at its edge: legs spread exactly twice the upper body\'s is not walk-like, just over twice is',
      walkLike(shape(4, 2)) === false && walkLike(shape(4.01, 2)) === true && walkLike(shape(2, 0)) === true && walkLike(shape(0, 0)) === false);

    // AUDIT align-walk-r1, L1: the height guard reads the followed head too.
    // A blade above the head in one frame, and a second frame whose feet sit
    // 6 rows lower under a level head: lining up the feet lifts that head by
    // 6, and the top rows alone would call it an improvement.
    const blade = body(blank(64, 64), 22, 14, 0, 0); tex(blade, 27, 8, 2, 6, 7);
    const tall = body(blank(64, 64), 22, 14, 0, 0); tex(tall, 24, 50, 3, 6, 3); tex(tall, 29, 50, 3, 6, 4);
    const pair = [blade, tall];
    const height = planAlignment(pair, { anchors: ['legs', 'legs'], groups: [0, 0] });
    const tops = pair.map((f) => measureFrame(f).topRow);
    check('L1: a raised blade does not hide a bob: the height part is called worse by the followed head when the top rows alone would not',
      height.moves.some((m) => m.dy !== 0) && spreadOf(tops.map((top, k) => top + height.moves[k].dy)) - spreadOf(tops) <= 1 && height.worse.height === true,
      { moves: height.moves, tops, worse: height.worse });

    // AUDIT align-walk-r2, M2-B: a head and torso that sit to one side of the
    // legs (a cape, a pack, a side view). The scope's column is the legs', as
    // on main; the frames centered from their head and torso keep one column
    // among themselves and move as a block, so their legs sit on it too. A
    // walk beside an idle then stands where the idle stands, by the legs and
    // by the head, and its head does not sway.
    const leaning = (ox, a, b) => { const f = blank(64, 64); tex(f, ox + 8, 14, 12, 12, 1); tex(f, ox + 10, 26, 8, 14, 2); tex(f, ox + 2 + a, 40, 3, 10, 3); tex(f, ox + 7 + b, 40, 3, 10, 4); return f; };
    const beside = [...STEP.map(([, a, b]) => leaning(20, a, b)), ...[0, 0, 0, 0].map(() => leaning(27, 0, 0))];
    const besideOptions = { anchors: [...'uuuu'].map(() => 'upper').concat([...'llll'].map(() => 'legs')), groups: [0, 0, 0, 0, 1, 1, 1, 1] };
    const besidePlan = planAlignment(beside, besideOptions);
    const besideAfter = beside.map((f, i) => measureFrame(shiftFrame(f, besidePlan.moves[i])));
    const mid = (values) => [...values].sort((x, y) => x - y)[(values.length - 1) >> 1];
    const gapOf = (key) => Math.abs(mid(besideAfter.slice(0, 4).map((m) => m[key])) - mid(besideAfter.slice(4).map((m) => m[key])));
    const lean = measureFrame(beside[5]).upperCol - measureFrame(beside[5]).centerCol;
    check('M2-B: a walk whose head and torso sit more than 5 px to one side of its legs, beside an idle 7 px away: they end in one place by the legs and by the head, and the walk moves as a block',
      lean > 5 && gapOf('centerCol') <= 1 && gapOf('upperCol') <= 1 && new Set(besidePlan.moves.slice(0, 4).map((m) => m.dx)).size === 1 &&
      besidePlan.moves.some((m) => m.dx !== 0) && same(besidePlan.worse, { sideways: false, height: false }),
      { lean, legs: gapOf('centerCol'), upper: gapOf('upperCol'), moves: besidePlan.moves.map((m) => m.dx), worse: besidePlan.worse });
    check('M2-B: the scope\'s column is the legs\' middle one, as on main, whatever the anchors',
      besidePlan.target.centerCol === planAlignment(beside).target.centerCol && besidePlan.target.centerCol === mid(bodiesOf(beside).map((m) => m.centerCol)), besidePlan.target);
    const besideAgain = planAlignment(beside.map((f, i) => shiftFrame(f, besidePlan.moves[i])), besideOptions);
    check('M2-B: that scope aligned once is settled: a second pass moves nothing', besideAgain.moves.every((m) => m.dx === 0 && m.dy === 0), besideAgain.moves);
    // Settled, with two columns in the scope: each frame within a pixel of
    // its own column is aligned already. The second idle's legs sit 0.6 px
    // off the scope's column and would be nudged a pixel.
    const part = (centerCol, upperCol) => ({ feetRow: 25, centerCol, topRow: 6, upperCol, headCol: upperCol });
    const five = [0, 0, 0, 0, 0].map(() => figureAt([0, 0]));
    const fiveOptions = { anchors: ['upper', 'upper', 'upper', 'legs', 'legs'], groups: [0, 0, 0, 1, 1],
      measured: [part(9.5, 16), part(10, 16), part(10.5, 16), part(10, 22), part(10.6, 22.6)] };
    const fivePlan = planAlignment(five, fiveOptions);
    check('M2-B: a mixed scope whose frames each sit within a pixel of their own column is settled: no frame is nudged',
      fivePlan.steady === false && fivePlan.target.centerCol === 10 && fivePlan.moves.every((m) => m.dx === 0 && m.dy === 0), { steady: fivePlan.steady, target: fivePlan.target, moves: fivePlan.moves });
    // Walk frames only: the block is the scope, its shift is nothing, and
    // every frame goes to the middle head-and-torso column, as before.
    const leanWalk = [0, 3, -2, 1].map((dx, k) => leaning(20 + dx, STEP[k][1], STEP[k][2]));
    const leanPlan = planAlignment(leanWalk, asWalk(leanWalk));
    const uppers = bodiesOf(leanWalk).map((m) => m.upperCol);
    check('M2-B: a scope of walk frames only is its own block: each frame goes to the middle head-and-torso column',
      same(leanPlan.moves.map((m) => m.dx), uppers.map((u) => Math.round(mid(uppers) - u) + 0)) && leanPlan.moves.some((m) => m.dx !== 0), { moves: leanPlan.moves.map((m) => m.dx), uppers });

    // AUDIT align-walk-r2, M2-A: a small character's head is a dozen pixels
    // or so. It is tracked, so a 16 px walk that drifts is centered, with no
    // note; the pixel minimum falls with the body's height, and not under 8.
    const tiny = (ox, a, b, oy = 1) => { const f = blank(16, 16); tex(f, ox + 1, oy, 4, 4, 1); tex(f, ox, oy + 4, 6, 5, 2); tex(f, ox + 1 + a, oy + 9, 1, 5, 3); tex(f, ox + 4 + b, oy + 9, 1, 5, 4); return f; };
    const tinyWalk = [[0, -1, 1], [2, 0, 0], [-1, 1, -1], [1, 0, 0]].map(([dx, a, b]) => tiny(5 + dx, a, b));
    const tinyTrack = trackHeads(tinyWalk, bodiesOf(tinyWalk));
    const tinyPlan = preselected(tinyWalk);
    const tinyAfter = tinyWalk.map((f, i) => measureFrame(shiftFrame(f, tinyPlan.plan.moves[i])).upperCol);
    check('M2-A: a 16 px walk\'s head (16 pixels) is tracked, so a drifting one is centered with no note',
      tinyTrack.sure && same(tinyTrack.offsets.map((o) => o.dx), [0, 2, -1, 1]) && tinyPlan.parts === 'both' && tinyPlan.full.unsure === false &&
      spreadOf(tinyAfter) <= 1 && tinyPlan.plan.moves.some((m) => m.dx !== 0), { track: tinyTrack, parts: tinyPlan.parts, after: tinyAfter });
    // The minimum scales: half the body's height, never under 8, never over 24.
    const thin = (headW, height) => { const f = blank(48, 48); const legs = height - 8 - Math.floor(height / 3); tex(f, 20, 4, headW, 5, 1); tex(f, 20, 9, 1, 3, 1); tex(f, 18, 12, 6, Math.floor(height / 3), 2); tex(f, 19, 12 + Math.floor(height / 3), 1, legs, 3); tex(f, 22, 12 + Math.floor(height / 3), 1, legs, 4); return f; };
    const doubtOf = (frame) => { const pair = [frame, frame]; return trackHeads(pair, bodiesOf(pair)).doubt; };
    const heightOf = (frame) => { const m = measureFrame(frame); return m.feetRow - m.topRow + 1; };
    // 10 px tall, a head of 6 pixels: half the height is 5, the floor is 8.
    const mini = () => { const f = blank(16, 16); tex(f, 6, 3, 2, 3, 1); tex(f, 5, 6, 4, 4, 2); tex(f, 5, 10, 1, 3, 3); tex(f, 8, 10, 1, 3, 4); return f; };
    // 60 px tall, a head patch of 26 pixels: half the height is 30, the cap is 24.
    const pole = () => { const f = blank(64, 64); tex(f, 30, 2, 2, 11, 1); tex(f, 30, 13, 1, 4, 1); tex(f, 28, 17, 6, 20, 2); tex(f, 29, 37, 1, 25, 3); tex(f, 32, 37, 1, 25, 4); return f; };
    check('M2-A: the fewest pixels a head patch may have is half the body\'s height, never under 8 and never over 24',
      heightOf(thin(2, 32)) === 32 && doubtOf(thin(2, 32)) === 'few' && doubtOf(thin(3, 32)) === null &&          // 13 pixels under 16; 18 not
      heightOf(thin(1, 14)) === 14 && doubtOf(thin(1, 14)) === 'few' && doubtOf(thin(2, 14)) === null &&          // 5 under 8; 8 not
      heightOf(mini()) === 10 && doubtOf(mini()) === 'few' &&                                                       // 6 is over half of 10, under the floor
      heightOf(pole()) === 60 && doubtOf(pole()) === null,                                                          // 26 is under half of 60, over the cap
      { h32: [heightOf(thin(2, 32)), doubtOf(thin(2, 32)), doubtOf(thin(3, 32))], h14: [heightOf(thin(1, 14)), doubtOf(thin(1, 14)), doubtOf(thin(2, 14))], mini: [heightOf(mini()), doubtOf(mini())], pole: [heightOf(pole()), doubtOf(pole())] });

    // AUDIT align-walk-r2, M2-A: one animation whose head cannot be tracked
    // holds its own centering only. Two walks in one scope: a flat-colour one
    // (untracked) and a textured one (tracked), both drifting. The textured
    // walk is centered; the flat one keeps its columns; anyway centers both.
    const flatOne = mono.map((f) => f);
    const textured = [[0, -1, 1], [3, 0, 0], [-2, 1, -1], [1, 0, 0]].map(([dx, a, b]) => body(blank(64, 64), 22 + dx, 14, a, b));
    const two = [...flatOne, ...textured];
    const twoOptions = { anchors: two.map(() => 'upper'), groups: [0, 0, 0, 0, 1, 1, 1, 1] };
    const held = planAlignment(two, { ...twoOptions, holdUntracked: true });
    const freed = planAlignment(two, twoOptions);
    check('M2-A: one walk that cannot be tracked holds only its own centering; the walk beside it is centered, and without the hold both are',
      held.unsure && same(held.heldGroups, [0]) && same(freed.heldGroups, []) && held.moves.slice(0, 4).every((m) => m.dx === 0) && held.moves.slice(4).some((m) => m.dx !== 0) &&
      !freed.unsure && freed.moves.slice(0, 4).some((m) => m.dx !== 0) && same(held.moves.slice(4), freed.moves.slice(4)),
      { held: held.moves.map((m) => m.dx), freed: freed.moves.map((m) => m.dx), unsure: [held.unsure, freed.unsure] });

    // Which animations were held, in scope order, by their group numbers.
    const three = [...textured, ...flatOne, ...flatOne.map((f) => f)];
    const threeHeld = planAlignment(three, { anchors: three.map(() => 'upper'), groups: [5, 5, 5, 5, 2, 2, 2, 2, 7, 7, 7, 7], holdUntracked: true });
    check('M2-A: the plan names the held animations by their group numbers, in scope order',
      same(threeHeld.heldGroups, [2, 7]) && threeHeld.unsure, threeHeld.heldGroups);

    // A held walk does not count for "aligned already": the tracked walk
    // beside it stands on one column, so it is not nudged toward the held
    // walk's columns.
    const stillWalk = [0, 0, 0, 0].map(() => body(blank(64, 64), 24, 14, 0, 0));
    const heldBeside = planAlignment([...flatOne, ...stillWalk], { ...twoOptions, holdUntracked: true });
    check('M2-A: a held walk does not count for "aligned already": the steady walk beside it is not nudged',
      heldBeside.unsure && heldBeside.moves.every((m) => m.dx === 0), heldBeside.moves.map((m) => m.dx));
    // Heads are tracked once per set of frames and measures: the same frames
    // read with other measures are tracked again. Measures that put the head
    // patch on empty rows leave too few pixels, so that walk is held.
    const texturedOptions = { anchors: textured.map(() => 'upper'), groups: textured.map(() => 0), holdUntracked: true };
    const sureFirst = planAlignment(textured, { ...texturedOptions, measured: bodiesOf(textured) });
    const emptyTop = bodiesOf(textured).map((m) => ({ ...m, topRow: 0, feetRow: 3 }));
    const thenEmpty = planAlignment(textured, { ...texturedOptions, measured: emptyTop });
    check('L2-2-d: heads are tracked once per set of frames and measures: other measures of the same frames are tracked again',
      sureFirst.unsure === false && thenEmpty.unsure === true, [sureFirst.unsure, thenEmpty.unsure]);

    // AUDIT align-walk-r2, L2-2-c: the second opinion's threshold is 2 px.
    // A big plume that swings 1 px each way: the head patch follows it 2 px
    // from the first frame, the head and shoulders stay put.
    const twoApart = STEP.map(([s, a, b]) => plumed(s, a, b, 0, 10, 8));
    check('L2-2-c: the head and the head and shoulders 2 px apart is a doubt; it takes 2, not 3',
      trackHeads(twoApart, bodiesOf(twoApart)).doubt === 'split' && trackHeads(twoApart, bodiesOf(twoApart), { twinApart: 3 }).doubt === null &&
      same(trackHeads(twoApart, bodiesOf(twoApart), { twin: 0 }).offsets.map((o) => o.dx), [0, 1, 2, 1]),
      { two: trackHeads(twoApart, bodiesOf(twoApart)).doubt, three: trackHeads(twoApart, bodiesOf(twoApart), { twinApart: 3 }).doubt });
  }
  {
    // AUDIT align-walk-r1, L4: a frame that fills its cell is told apart by
    // the same rule the plan uses.
    const full = blank(40, 40); paint(full, 0, 0, 40, 40);
    check('walk: fillsCell names the frames the plan leaves out', fillsCell(full) === true && fillsCell(figureAt([5, 0])) === false &&
      same(planAlignment([full, figureAt([5, 0]), figureAt([8, 0])]).filled, [0]));
  }
  {
    // A caller's older measures (feet row and legs center only) still work.
    const frames = withBody(JITTER);
    const old = frames.map((f) => legsOf(measureFrame(f)));
    const plan = planAlignment(frames, { measured: old, anchors: upper(frames) });
    check('walk: measures without the new fields fall back to the legs and skip the two checks',
      same(plan.moves, planAlignment(frames).moves) && plan.steady === false && same(plan.worse, { sideways: false, height: false }), plan.moves);
  }
  {
    // Two animations in one plan: bodies of two heights (two directions), each
    // level in itself, feet 4 rows apart between them. The feet target is the
    // short pair's row, so the tall pair moves up 4. As one set the top rows
    // then spread 4 rows; read per animation, nothing gets worse.
    const tall = () => walker(10, 6, 0, 8);
    const short = () => walker(10, 6, 0, 8, 4);
    const sheet = [tall(), tall(), short(), short()];
    const asOne = planAlignment(sheet);
    const perAnimation = planAlignment(sheet, { groups: [0, 0, 1, 1] });
    check('walk: the never-worse check reads each animation on its own when the caller names them',
      asOne.worse.height === true && same(perAnimation.worse, { sideways: false, height: false }) &&
      same(perAnimation.moves, asOne.moves) && asOne.moves[0].dy === -4 && asOne.moves[2].dy === 0, { asOne: asOne.worse, per: perAnimation.worse });
    const none = planAlignment(sheet, { parts: 'none' });
    check("walk: parts 'none' keeps every frame as drawn and counts nothing as shortened",
      noMoves(none) && none.aligned === 0 && none.shortenedFrames.length === 0 && none.steady === false);
  }
  check('walk: walkLike is true when the legs spread more than twice as far as the head and torso',
    walkLike(inPlace.map(measureFrame)) === true && walkLike(withBody(JITTER).map(measureFrame)) === false &&
    walkLike([measureFrame(inPlace[0])]) === false && walkLike([null, null]) === false);
  check('walk: a refused plan carries the two new fields', (() => {
    const p = planAlignment([blank(8, 8), blank(9, 9)]);
    return p.refused === 'sizes' && p.steady === false && same(p.worse, { sideways: false, height: false });
  })());
}

// ── Measure once (C4) ──

{
  const weapon = withBody([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
  for (const i of [1, 4]) paint(weapon[i], 20, 11, 12, 2);
  const fixtures = { synthetic: withBody(JITTER), weapon };
  for (const [name, frames] of Object.entries(fixtures)) {
    // A plan over one frame targets that frame's own measurement.
    const own = frames.map((f) => planAlignment([f]).target);
    check(`C4: measureFrame matches the plan's own measurement, ${name} fixture`, same(frames.map(measureFrame).map(legsOf), own), frames.map(measureFrame));
  }
  check('C4: measureFrame reads the feet row and the legs center', same(legsOf(measureFrame(figureAt([0, 0]))), { feetRow: 25, centerCol: 14.5 }) && same(legsOf(measureFrame(weapon[1])), { feetRow: 25, centerCol: 14.5 }), measureFrame(weapon[1]));
  check('C4: measureFrame is null for an empty frame', measureFrame(blank(16, 16)) === null);

  const sets = {
    jitter: [withBody(JITTER), {}],
    weapon: [weapon, {}],
    walk: [walk(), {}],
    'crop guard': [(() => { const f = withBody([[0, 0], [0, 0], [-8, 0], [0, -4], [3, 0]]); paint(f[2], 39, 3, 1, 1); paint(f[3], 3, 36, 1, 1, 3); return f; })(), {}],
    'leave out': [withBody([[0, 0], [0, 0], [0, 0], [9, 9], [9, 9]]), { leaveOut: [false, false, true, true, false] }],
    'given target': [withBody([[0, 0], [2, 1]]), { target: { feetRow: 28, centerCol: 12.5 } }],
    empty: [[blank(40, 40), ...withBody([[0, 0], [2, 0]])], {}],
  };
  for (const [name, [frames, options]] of Object.entries(sets)) {
    const plain = planAlignment(frames, options);
    const cached = planAlignment(frames, { ...options, measured: frames.map(measureFrame) });
    check(`C4: options.measured gives the same plan, ${name}`, same(plain, cached), { plain, cached });
  }
  // The cache is used in place of measuring: told every frame already sits
  // on the target, nothing moves; told a frame has no body, it stays still.
  const frames = withBody(JITTER);
  const told = planAlignment(frames, { measured: frames.map(() => ({ feetRow: 25, centerCol: 14.5 })) });
  check('C4: options.measured is used in place of measuring', noMoves(told) && told.alreadyInPlace === 6, told.moves);
  const none = planAlignment(frames, { measured: frames.map((f, i) => (i === 3 ? null : measureFrame(f))) });
  check('C4: a null measurement is a frame with no body', same(none.moves[3], { dx: 0, dy: 0, shortened: false }) && none.aligned === 4, none.moves);
}

// ── The center column (REV's surviving mutants) ──

{
  // The left leg at alpha 51, the right at 255: the center leans right. At
  // full alpha both legs weigh the same and the center is ox + 4.5.
  const full = figureAt([0, 0]);
  const faint = figureAt([0, 0]);
  paint(faint, 10, 18, 2, 8, 51);
  const leaning = measureFrame(faint).centerCol;
  check('D6: the center is alpha-weighted: a faint leg on one side moves it', measureFrame(full).centerCol === 14.5 && Math.abs(leaning - centerOf(faint, 5)) < 1e-9 && leaning > 16, { full: measureFrame(full), leaning });
  // Below alpha 10 a pixel is background and does not count at all.
  const ghost = figureAt([0, 0]);
  paint(ghost, 10, 18, 2, 8, 9);
  check('D6: pixels below alpha 10 do not steer the center', measureFrame(ghost).centerCol === 18.5, measureFrame(ghost));
}
{
  // A 4 px tall body (detectSprites drops anything shorter): 6 px wide on its
  // three top rows, 2 px at the right on its feet row. A 1 row band centers
  // on 14.5; the 2 row band on 13.
  const small = paint(paint(blank(24, 24), 10, 10, 6, 3), 14, 13, 2, 1);
  check('D6: a body 4 px tall or less reads a band of 2 rows', same(legsOf(measureFrame(small)), { feetRow: 13, centerCol: 13 }) && centerOf(small, 1) === 14.5 && centerOf(small, 2) === 13, measureFrame(small));
}
{
  // The settled bound is under one pixel: centers 1.5 px apart still move on
  // the first pass. A whole body 1 px off with level feet is steady and stays
  // (HQ room 2026-11-11-098, point 1).
  const legs = (ox, width) => figure(blank(40, 40), ox, 6, width);
  const one = planAlignment([legs(10, 2), legs(10, 2), legs(11, 2)]);
  const oneHalf = planAlignment([legs(10, 2), legs(10, 2), legs(12, 3)]);
  check('D6: centers 1.5 px apart still move on the first pass; a body 1 px off is steady and stays', one.steady === true && noMoves(one) && one.aligned === 0 && oneHalf.steady === false && oneHalf.moves[2].dx === -1 && oneHalf.aligned === 1, { one: one.moves, oneHalf: oneHalf.moves });
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
  check('L3: a moved output is a new frame; an unmoved one is the input itself', out.every((f, i) => (i === 0 || i === 1 ? f === frames[i] : f !== frames[i] && f.data !== frames[i].data)));
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
  const copy = [...frame.data];
  const zero = shiftFrame(frame, { dx: 0, dy: 0, shortened: false });
  check('L3: a zero move returns the same object, unchanged', zero === frame && same([...frame.data], copy));
  const gone = shiftFrame(frame, { dx: 40, dy: 0, shortened: false });
  check('a move past the frame leaves it clear, with no throw', gone.data.every((v) => v === 0));
  let far = null;
  try {
    far = shiftFrame(frame, { dx: 41, dy: 0, shortened: false });
  } catch {
    far = null;
  }
  check('shiftFrame with dx 41 on a 40 px frame returns an empty frame, with no throw', far !== null && far.data.length === frame.data.length && far.data.every((v) => v === 0));
  // An ImageData from a canvas has this same shape.
  check('a Uint8ClampedArray view works', shiftFrame({ data: frame.data.subarray(0), width: 40, height: 40 }, moved).data.length === frame.data.length);
}

// ── Words ──

check('the words for a move', moveWords({ dx: -1, dy: -2 }) === 'Up 2, left 1' && moveWords({ dx: 3, dy: 4 }) === 'Down 4, right 3');
check('one direction reads alone', moveWords({ dx: -1, dy: 0 }) === 'Left 1' && moveWords({ dx: 0, dy: 2 }) === 'Down 2');
check('no move', moveWords({ dx: 0, dy: 0 }) === 'No move');
{
  const n = (aligned, alreadyInPlace) => ({ moves: [], refused: null, aligned, alreadyInPlace, shortenedFrames: [], filled: [] });
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
  // The same text without comments, for pins a comment may sit inside.
  const stripped = panel.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
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
  const undoPress = between(panel, 'const handleUndo = useCallback(', 'return (\n    <div ref={cardRef} className="space-y-4">');
  const loop = between(panel, '// One timer steps both loops together.', 'const changeScope = useCallback(');
  const alignButton = between(panel, '{!plan.refused && (\n          <Button', '</Button>');
  const undoButton = between(panel, '{undo && (\n          <Button', '</Button>');
  const decode = between(panel, '// Decode each frame', '// Track prefers-reduced-motion.');
  const watch = between(panel, '// Wait for the card to come into view', '// Decode each frame');
  const groupRow = between(panel, '{!plan.refused && !group && groups.length >= 2 && (', '{showsJumpsLine && (');
  const frameList = between(panel, '<ul className="max-h-64', '</ul>');
  const decodeSkip = between(panel, '// Decode each frame', 'let cancelled = false;');
  const scopeChange = between(panel, 'const changeScope = useCallback(', 'const toggleLeaveOut = useCallback(');
  const leaveOutToggle = between(panel, 'const toggleLeaveOut = useCallback(', '/** Leaves out every frame of a group');
  const alignDone = between(align, "if (!applied) {", 'return alignmentSummary(plan, numbers);\n    });');
  const undoDone = between(undoPress, "if (!applied) {", "return 'Align undone.';");
  const toggleGroup = between(panel, 'const toggleGroup = useCallback(', 'const runPress = useCallback(');
  const showBanner = between(page, 'const handleShowBgBanner = useCallback(', 'const sliceGrid = useCallback(');
  const build = between(panel, 'async function buildAlignedSheet(', 'function paint(');

  check('the commit goes through replaceSheetSource with the version guard', /ownership\.bump\(\);\s*const token = ownership\.capture\(\);\s*const next = await prepare\(\);/.test(commit) && /!ownership\.isCurrent\(token\) \|\| !replaceSheetSource\(next\.sourceImage, next\.urls, token\.sheetVersion\)/.test(commit));
  check('a dropped commit reports false and notes it', /noteStale\('align'\);\s*return false;/.test(commit) && /return true;/.test(commit));
  check('only the commit writes: the panel never calls the store setters', !/replaceSheetSource|setFrameDataUrls|updateFrameData|setSpriteSheet/.test(panel));
  check('Align and Undo both go through the page commit', /await onCommit\(/.test(align) && /await onCommit\(/.test(undoPress));
  check('the card sits between the frame grid and the animations, once a sheet is set', /<FrameGrid frameDataUrls=\{frameDataUrls\} \/>\s*<\/div>\s*\)\}\s*\{\/\* Align frames, shown after slicing \*\/\}\s*\{spriteSheet && \(\s*<div className="rounded-lg border border-border-default bg-bg-surface p-6">\s*<AlignFramesPanel[\s\S]*?\/>\s*<\/div>\s*\)\}\s*\{\/\* Animation panel/.test(alignCard));
  check('the page hands the panel its commit, keyed to the sheet', /key=\{spriteSheet\.id\}/.test(alignCard) && /onCommit=\{handleAlignCommit\}/.test(alignCard));

  check('jump, death and destroy start left out', /LEFT_OUT_TYPES = \['jump', 'death', 'destroy'\]/.test(panel) && /animations\.filter\(\(a\) => LEFT_OUT_TYPES\.includes\(a\.type\)\)/.test(panel) && /toggled\.get\(id\) \?\? startLeftOut\.has\(id\)/.test(panel) && /scopeFrames\.map\(\(f\) => isLeftOut\(f\.id\)\)/.test(panel));
  check('the jumps line is the approved copy', /Jumps and falls are left out: aligning their feet would flatten them\./.test(panel));
  check('Leave out is a real toggle with a name', /<Button[^>]*aria-pressed=\{leftOut\}\s*aria-label=\{`Leave out frame \$\{numbers\[i\]\}`\}/.test(panel));
  check('the status line is always rendered, once, beside the one note', panel.match(/role="status"/g)?.length === 2 && /<div className="flex flex-wrap items-center gap-3">\s*\{\/\* Always rendered, so each result is announced once\. \*\/\}\s*<p role="status"[^>]*>\s*\{line\}\s*<\/p>/.test(panel));
  check('the status clears before each press, so a repeat is announced', /setBusy\(true\);\s*setStatus\(''\);/.test(press));
  check('a second press while working does nothing', /if \(busyRef\.current\) return;\s*busyRef\.current = true;/.test(press) && /finally \{\s*busyRef\.current = false;/.test(press));
  check('decoding yields first', /useEffect\(\(\) => \{\s*if \(!seen\) return;\s*if \(committedRef\.current === frameDataUrls\) \{\s*committedRef\.current = null;\s*return;\s*\}\s*let cancelled = false;\s*const timer = setTimeout\(async \(\) => \{/.test(decode) && /await nextTask\(\);\s*const built = await buildAlignedSheet\(/.test(align));
  check('Align prepare returns null when the frames changed since the press', /return stillCurrent\(\) \? built : null;/.test(align) && /useSpriteStore\.getState\(\)\.frameDataUrls === frameDataUrls/.test(panel));
  check('Undo restores the exact earlier source image and frame URLs', /before: \{ sourceImage: sheet\.sourceImage, urls: frameDataUrls \}/.test(align) && /return stillCurrent\(\) \? undo\.before : null;/.test(undoPress));
  check('Undo closes when the sheet changed, pixel edits included', /undo\.version === sheetVersion && undo\.urls === frameDataUrls/.test(panel) && /aria-disabled=\{busy \|\| !undoOpen \|\| undefined\}/.test(undoButton) && /Undo is no longer available: the sheet changed\./.test(panel));
  check('Align is not offered when refused', /<Button\s*ref=\{alignRef\}\s*size="sm"/.test(alignButton) && /if \(reading \|\| decoded\?\.urls !== frameDataUrls \|\| plan\.refused \|\| nothingKept\) return;/.test(align));

  // P1: Undo keeps focus.
  check('P1: when Undo completes, focus moves to Align, then Undo goes', /\(alignRef\.current \?\? selectRef\.current\)\?\.focus\(\);\s*setUndo\(null\);/.test(undoPress) && /ref=\{selectRef\}/.test(panel));
  check('P1: a stale Undo is a real focusable button: no native disabled, the note linked, the press ignored', !/\sdisabled=/.test(panel) && /aria-describedby=\{undoOpen \? undefined : undoNoteId\}/.test(undoButton) && /<p id=\{undoNoteId\}/.test(panel) && /if \(!undo \|\| !undoOpen\) return;/.test(undoPress));
  // P2: Align cannot look pressable while it cannot act.
  check('P2: while frames are read, the status says Reading frames...', /const line = status \|\| \(reading \? 'Reading frames\.\.\.' :/.test(panel));
  check('P2: Align is aria-disabled while reading or busy, and while nothing is selected', /aria-disabled=\{busy \|\| reading \|\| nothingKept \|\| undefined\}/.test(alignButton));
  // D1: a real reading state, and the card's own commit is never read.
  check('D1: reading is true from the moment a decode starts until it ends', /const \[reading, setReading\] = useState\(true\);/.test(panel) && /const timer = setTimeout\(async \(\) => \{\s*setReading\(true\);\s*try \{/.test(decode) && /\} finally \{\s*if \(!cancelled\) setReading\(false\);\s*\}/.test(decode) && panel.match(/setReading\(/g)?.length === 2);
  check('D1: the card\'s own commit counts as ready: the skip never sets reading, and nothing else gates the line or Align', !/setReading/.test(decodeSkip) && !/\bready\b/.test(panel.replace(/counts as ready|is ready/g, '')));
  check('P2: Align and Undo both get the dimmed aria-disabled style', /const DIMMED = 'aria-disabled:opacity-40 aria-disabled:cursor-not-allowed';/.test(panel) && /className=\{`\$\{DIMMED\} \$\{TOUCH\}`\}/.test(alignButton) && /className=\{`\$\{DIMMED\} \$\{TOUCH\}`\}/.test(undoButton));
  // P3: the frame list passes the whole move, so a held frame is named.
  check('P3: the frame list words come from the whole move, the applied one after Align', /: moveWords\(shown\?\.moves\.get\(frame\.id\) \?\? plan\.moves\[i\]\)\}/.test(frameList));
  check('D3: a filled frame\'s row reads Fills its cell and keeps its Leave out', /\{filledIds\.has\(frame\.id\) \? 'Fills its cell' : moveWords\(/.test(frameList) && /aria-label=\{`Leave out frame/.test(frameList) && /const filledIds = shown\?\.filled \?\? plannedFilled;/.test(panel) && /new Set\(plan\.filled\.map\(\(i\) => scopeIds\[i\]\)\)/.test(panel));
  // P4: an opaque sheet offers Remove background.
  check('P4, D3: Remove background shows only on the opaque refusal, for a solid background, with the callback', /const offersRemoveBackground = !status && !reading && plan\.refused === 'opaque' && solid && !!onRemoveBackground;/.test(panel) && /plan\.refused === 'opaque' && solidBackground\(current\.filter\(\(_, i\) => !leaveOut\[i\]\)\)/.test(panel) && /\{offersRemoveBackground && \(\s*<Button[^>]*onClick=\{onRemoveBackground\}>\s*Remove background\s*<\/Button>/.test(panel));
  check('P4: the page callback un-dismisses the banner and scrolls its wrapper into view', /flushSync\(\(\) => setBgBannerDismissed\(false\)\);/.test(showBanner) && /bgBannerRef\.current\?\.scrollIntoView\(/.test(showBanner) && /<div ref=\{bgBannerRef\} className="empty:mb-0">\s*<BgRemovalBanner/.test(page) && /onRemoveBackground=\{handleShowBgBanner\}/.test(alignCard));
  // P5: whole groups can be left out.
  check('P5: Leave out a group shows for All frames with two or more groups', /const groups = useMemo\(\(\) => animations\.filter\(\(a\) => a\.frames\.length > 0\), \[animations\]\);/.test(panel) && /Leave out a group:/.test(groupRow) && /role="group" aria-labelledby=\{groupsLabelId\}/.test(groupRow));
  check('P5: each group toggle is a real button with aria-pressed and the group name', /const leftOut = g\.frames\.every\(\(f\) => isLeftOut\(f\.id\)\);/.test(groupRow) && /<Button[^>]*aria-pressed=\{leftOut\}\s*onClick=\{\(\) => toggleGroup\(g\.frames, leftOut\)\}\s*>\s*\{g\.name\}/.test(groupRow));
  check('P5: a group toggle sets every frame of the group', /for \(const frame of frames\) next\.set\(frame\.id, !leftOut\);/.test(toggleGroup));
  // P6: reduced motion steps instead of looping.
  check('P6: under reduced motion nothing loops; both previews show the stepped frame', /stepRef\.current = reducedMotion \? stillStep :/.test(loop) && /if \(reducedMotion \|\| steps < 2\) return;/.test(loop) && /reducedMotion, stillStep,/.test(loop));
  check('P6: Previous frame and Next frame, with Frame n of m', /\{reducedMotion && before\.length > 1 && \(/.test(panel) && /setStill\(\(stillStep \+ before\.length - 1\) % before\.length\)\}>\s*Previous frame/.test(panel) && /setStill\(\(stillStep \+ 1\) % before\.length\)\}>\s*Next frame/.test(panel) && /Frame \{stillStep \+ 1\} of \{before\.length\}/.test(panel));
  check('P6: the labels drop looping under reduced motion', /aria-label=\{looping \? `\$\{label\} aligning, frames looping` : `\$\{label\} aligning`\}/.test(panel) && /const looping = !reducedMotion && before\.length > 1;/.test(panel) && panel.match(/looping=\{looping\}/g)?.length === 2);
  // P7: frames are read when the card comes into view.
  check('P7: decoding waits for the card to come into view, at once without IntersectionObserver', /useState\(\(\) => typeof IntersectionObserver === 'undefined'\)/.test(panel) && /new IntersectionObserver\(/.test(watch) && /observer\.observe\(card\);/.test(watch) && /if \(entries\.some\(\(entry\) => entry\.isIntersecting\)\) setSeen\(true\);/.test(watch) && /<div ref=\{cardRef\}/.test(panel) && /\[allFrames, frameDataUrls, seen\]/.test(decode));
  // C1: after Align, Before keeps the original, After the result, and each
  // row the applied move, until the scope, a Leave out, Undo or the sheet change.
  check('C1: the applied view is kept only while the sheet and its frame map are the ones Align made', /const shown = result !== null && result\.version === sheetVersion && result\.urls === frameDataUrls\s*&&/.test(panel) && /version: now\.sheetVersion,\s*urls: committed,\s*ids: scopeIds,\s*leaveOut,\s*before: current,\s*after,\s*moves: new Map\(scopeFrames\.map\(\(frame, i\) => \[frame\.id, plan\.moves\[i\]\]\)\),/.test(alignDone));
  // D4: Undo and the applied view record the Map the card committed.
  check('D4: Undo and the applied view record the committed Map, and neither when the store moved on', /if \(now\.frameDataUrls === committed\) \{\s*setUndo\(\{[\s\S]*?urls: committed,\s*\}\);\s*setResult\(\{\s*version: now\.sheetVersion,\s*urls: committed,/.test(alignDone) && !/now\.frameDataUrls,/.test(align) && /committed = built\.urls;/.test(align));
  // D5: the applied view is tied to the scope's frames and its leave-outs.
  check('D5: the applied view hides when the scope\'s frame ids or the leave-outs differ', /&& sameList\(result\.ids, scopeIds\) && sameList\(result\.leaveOut, leaveOut\) \? result : null;/.test(panel) && /const sameList = <T,>\(a: T\[\], b: T\[\]\) => a\.length === b\.length && a\.every\(\(value, i\) => value === b\[i\]\);/.test(panel) && /const scopeIds = useMemo\(\(\) => scopeFrames\.map\(\(f\) => f\.id\), \[scopeFrames\]\);/.test(panel));
  check('C1: the previews show the applied frames, the planned ones otherwise', /const before = shown\?\.before \?\? current;/.test(panel) && /\(i: number\) => \(shown \? shown\.after\[i\] : current\[i\] && shiftedOnce\(current\[i\], plan\.moves\[i\]\)\)/.test(panel) && /paint\(beforeRef\.current, before\[stepRef\.current\]\);\s*paint\(afterRef\.current, afterAt\(stepRef\.current\)\);/.test(loop) && panel.match(/feetRow=\{feetRow\}/g)?.length === 2 && /const feetRow = shown \? shown\.feetRow :/.test(panel));
  check('C1: a scope change, a Leave out toggle, a group toggle and Undo each end the applied view', /setResult\(null\);/.test(scopeChange) && /setResult\(null\);/.test(leaveOutToggle) && /setResult\(null\);/.test(toggleGroup) && /setUndo\(null\);\s*setResult\(null\);/.test(undoDone));
  // C2: a refused scope shows only what helps.
  check('C2: the frame list, the group row and the jumps line are not rendered when refused', /\{!plan\.refused && \(\s*<ul className="max-h-64/.test(panel) && /^\{!plan\.refused && !group && groups\.length >= 2 && \(/.test(groupRow) && /const showsJumpsLine = !plan\.refused\s*&& groupFrames\.some\(/.test(panel));
  check('C2: the previews stay when refused', /<div className="grid grid-cols-2 gap-4 max-w-md">\s*<PreviewLoop label="Before"/.test(panel) && !/refused[^\n]*\(\s*<div className="grid grid-cols-2/.test(panel));
  // C3: the card keeps the pixels its own commit wrote.
  check('C3: Align sets the decoded frames and the Map it committed, with no decode', /committed = built\.urls;\s*committedRef\.current = built\.urls;\s*return stillCurrent\(\) \? built : null;/.test(align) && /frames\.set\(frame\.id, pixels\);\s*bodies\.set\(frame\.id, measureFrame\(pixels\)\);\s*\}\s*setDecoded\(\{ urls: committed, frames, measured: bodies \}\);/.test(alignDone) && !/decodeFrame|loadImage/.test(align));
  check('C3: Undo sets the earlier frames and the earlier Map, with no decode', /decoded: earlier,/.test(align) && /committedRef\.current = undo\.before\.urls;\s*return stillCurrent\(\) \? undo\.before : null;/.test(undoPress) && /setDecoded\(undo\.decoded\);/.test(undoDone) && !/decodeFrame|loadImage/.test(undoPress));
  check('C3: the decode skips only the card\'s own commit, and a refused commit clears the mark', /if \(committedRef\.current === frameDataUrls\) \{\s*committedRef\.current = null;\s*return;\s*\}/.test(decodeSkip) && /if \(!applied\) \{\s*committedRef\.current = null;\s*return 'The sheet changed/.test(align) && /if \(!applied\) \{\s*committedRef\.current = null;\s*return 'Undo is no longer available/.test(undoPress));
  // C4: each frame is measured once, when read.
  check('C4: the card passes cached measurements to the plan', /planAlignment\(current, \{ leaveOut, measured, anchors, groups: plays \}\)/.test(panel) && /scopeFrames\.map\(\(f\) => decoded!\.measured\.get\(f\.id\) \?\? null\)/.test(panel) && /setDecoded\(\{ urls: frameDataUrls, frames, measured: measureAll\(frames\) \}\);/.test(decode) && panel.match(/measureFrame\(/g)?.length === 2);
  // D2: a toggle only plans; the After preview shifts a frame as it draws it.
  check('D2: a scope or Leave out change only plans: nothing in render shifts a frame', /const fullPlan = useMemo\(\s*\(\) => planAlignment\(current, \{ leaveOut, measured, anchors, groups: plays, holdUntracked: true \}\),\s*\[current, leaveOut, measured, anchors, plays\]\s*\);/.test(panel) && /: planAlignment\(current, \{ leaveOut, measured, anchors, groups: plays, parts, holdUntracked: true \}\)\),\s*\[parts, anyway, fullPlan, current, leaveOut, measured, anchors, plays\]/.test(panel) && panel.match(/planAlignment\(/g)?.length === 3 && !/applyAlignment/.test(panel) && panel.match(/shiftFrame\(/g)?.length === 1 && !/shift/i.test(leaveOutToggle + scopeChange + toggleGroup));
  check('D2: the preview shifts lazily and keeps each shift per frame and move', /const kept = shifts\.get\(frame\);\s*if \(kept && kept\.dx === move\.dx && kept\.dy === move\.dy\) return kept\.frame;\s*const moved = shiftFrame\(frame, move\);\s*shifts\.set\(frame, \{ dx: move\.dx, dy: move\.dy, frame: moved \}\);/.test(panel) && /\[before, afterAt, fps,/.test(loop));
  check('D2: the previews paint ImageData built once per frame', /let image = images\.get\(frame\);\s*if \(!image\) \{\s*image = toImageData\(frame\);\s*images\.set\(frame, image\);/.test(panel) && /context\.putImageData\(imageOf\(frame\), 0, 0\);/.test(panel) && !/putImageData\(toImageData/.test(panel));
  check('D2: Align shifts the moved frames when it builds the sheet', /const after = current\.map\(\(frame, i\) => shiftedOnce\(frame, plan\.moves\[i\]\)\);/.test(align) && /\[\{ frame, pixels: after\[i\] \}\]/.test(align));
  check('the previews are pixelated canvases at the group fps, 8 for All frames', /imageRendering: 'pixelated'/.test(panel) && /ALL_FRAMES_FPS = 8/.test(panel) && /group\?\.fps \?\? ALL_FRAMES_FPS/.test(panel));
  check('only a rect-sized frame goes back on the sheet', /if \(pixels\.width === frame\.width && pixels\.height === frame\.height\) \{\s*sheetContext\.putImageData\(image, frame\.x, frame\.y\);/.test(build));
  // The walk fix in the card (HQ room 2026-11-11-098, 2026-11-14-053; words DESIGN 2026-11-14-057).
  check('walk: a Walk or a Run is centered from its head and torso, an unlabelled set by its own shape, the rest from the legs',
    /const WALK_TYPES = \['walk', 'run'\];/.test(panel) && /const UNLABELLED = 'custom';/.test(panel) &&
    /const typeOf = \(index: number\) => \(index >= 0 \? groups\[index\]\.type : UNLABELLED\);/.test(panel) &&
    /if \(typeOf\(index\) !== UNLABELLED\) continue;\s*byShape\.set\(index, walkLike\(measured\.filter\(\(_, i\) => plays\[i\] === index && !leaveOut\[i\] && !fillsCell\(current\[i\]\)\)\)\);/.test(stripped) &&
    /\(WALK_TYPES\.includes\(typeOf\(index\)\) \|\| byShape\.get\(index\) \? 'upper' : 'legs'\)/.test(panel));
  check('walk: a frame plays in the scope\'s own group, else the first group that holds it, else none',
    /const plays = scopeFrames\.map\(\(f\) => \(group \? scopeIndex : first\.get\(f\.id\) \?\? -1\)\);/.test(panel));
  check('walk: the part that would make the head move more is left out to start',
    /const parts: AlignParts = fullPlan\.worse\.sideways && fullPlan\.worse\.height \? 'none'\s*: fullPlan\.worse\.height \? 'sideways' : fullPlan\.worse\.sideways \? 'height' : 'both';/.test(panel) &&
    /\(\) => \(anyway \? \(fullPlan\.unsure \? planAlignment\(current, \{ leaveOut, measured, anchors, groups: plays \}\) : fullPlan\)\s*: parts === 'both' \? fullPlan/.test(panel));
  check('walk: "anyway" holds only for the plan it was pressed on',
    /const \[anywayFor, setAnywayFor\] = useState<object \| null>\(null\);\s*const anyway = anywayFor === fullPlan;/.test(panel) &&
    panel.match(/setAnywayFor\(/g)?.length === 1);
  check('walk (F2): a press on "... anyway" drops an earlier Align\'s result, so the rows and the After preview show what Align will do',
    /onClick=\{\(\) => \{\s*setAnywayFor\(anyway \? null : fullPlan\);\s*setStatus\(''\);\s*setResult\(null\);\s*\}\}/.test(stripped));
  check('walk: the three notes and their buttons, word for word',
    ['Feet left as drawn: lining them up would make the head bob more.', 'Line up feet anyway', 'Feet lined up. The head will bob more than before.', 'Leave feet as drawn',
      'Not centered: centering would make the head sway more.', 'Center anyway', 'Centered. The head will sway more than before.', "Don't center",
      'Left as drawn: aligning would make the head move more.', 'Align anyway', 'Aligned. The head will move more than before.', 'Leave as drawn',
    ].every((words) => panel.split(words).length === 2));
  check('walk: the note is a status that stays in the page (only its words change), with an icon; both notes share one cell (the swap keeps its height); its button is 44 px tall on touch and changes its name, not a pressed state',
    /<div className=\{worseWords && !reading \? 'space-y-1\.5' : 'contents'\}>\s*<p\s*id=\{worseNoteId\}\s*role="status"\s*className=\{worseWords && !reading \? 'flex items-start gap-1\.5 text-\[13px\] font-mono text-text-secondary' : undefined\}\s*>/.test(panel) &&
    !/hidden=\{!worseWords/.test(panel) && !/aria-pressed=\{anyway\}/.test(panel) &&
    /<Info size=\{14\} aria-hidden="true" className="mt-0\.5 flex-shrink-0" \/>/.test(panel) &&
    /<span className="grid">\s*<span className="col-start-1 row-start-1">\{anyway \? worseWords\.after : worseWords\.before\}<\/span>\s*<span aria-hidden="true" className="col-start-1 row-start-1 invisible">\s*\{anyway \? worseWords\.before : worseWords\.after\}\s*<\/span>\s*<\/span>/.test(panel) &&
    /className=\{TOUCH\}\s*onClick=\{\(\) => \{/.test(stripped) && /\{anyway \? worseWords\.back : worseWords\.go\}/.test(panel));
  check('walk: every button in the card is 44 px tall on touch at any width (DESIGN 2026-11-14-065)',
    /const TOUCH = 'pointer-coarse:min-h-11';/.test(panel) &&
    panel.match(/<Button\b/g)?.length === 8 && panel.match(/className=\{TOUCH\}/g)?.length === 6 && panel.match(/className=\{`\$\{DIMMED\} \$\{TOUCH\}`\}/g)?.length === 2);
  check('walk: Align with nothing selected points at the note, so a screen reader says why',
    /aria-disabled=\{busy \|\| reading \|\| nothingKept \|\| undefined\}\s*aria-describedby=\{nothingKept \? worseNoteId : undefined\}/.test(panel) &&
    /const worseNoteId = useId\(\);/.test(panel));
  check('walk: no note on a refused plan, and nothing to align until "Align anyway" when both parts are left out',
    /const worseWords = fullPlan\.refused \? null\s*: parts !== 'both' \? WORSE_WORDS\[parts\]\s*: fullPlan\.unsure \? \(heldNames/.test(panel) &&
    /const nothingKept = parts === 'none' && !anyway;/.test(panel));
  check('walk (F1): when the centering is left out only because the head could not be followed, the note says "might", with case 2\'s buttons (DESIGN 2026-11-14-156)',
    /const UNSURE_WORDS = \{\s*\.\.\.WORSE_WORDS\.height,\s*before: 'Not centered: the head could not be tracked, so centering might make it sway more\.',\s*after: 'Centered\. The head may sway more than before\.',\s*\};/.test(panel));
  check('walk (DESIGN 2026-11-14-220): a held walk beside aligned ones is named: one or two by name, more by count, word for word (HQ 2026-11-14-222)',
    same(heldWords(['Walk 2']), { before: 'Walk 2 not centered: its head could not be tracked, so centering it might make it sway more.', after: 'Walk 2 centered. Its head may sway more than before.' }) &&
    same(heldWords(['Walk', 'Run']), { before: 'Walk and Run not centered: their heads could not be tracked, so centering them might make them sway more.', after: 'Walk and Run centered. Their heads may sway more than before.' }) &&
    same(heldWords(['Walk', 'Run', 'Walk 2']), { before: '3 animations not centered: their heads could not be tracked, so centering them might make them sway more.', after: '3 animations centered. Their heads may sway more than before.' }));
  check('walk (DESIGN 2026-11-14-220): the card names the held groups only beside animations that are aligned, and never a frame in no group',
    /const playing = new Set\(plays\.filter\(\(_, i\) => !leaveOut\[i\]\)\);\s*const held = fullPlan\.heldGroups;\s*return held\.length === 0 \|\| held\.length >= playing\.size \|\| held\.some\(\(index\) => index < 0\) \? null\s*: held\.map\(\(index\) => groups\[index\]\.name\);/.test(panel) &&
    /: fullPlan\.unsure \? \(heldNames \? \{ \.\.\.UNSURE_WORDS, \.\.\.heldWords\(heldNames\) \} : UNSURE_WORDS\) : null;/.test(panel));
  check('walk: steady frames say so without a press',
    /: plan\.refused \|\| plan\.steady \? alignmentSummary\(plan, numbers\) : ''\);/.test(panel));
  check('walk: the card keeps the fuller measure', /measured: Map<string, BodyMeasure \| null>;/.test(panel));
  check('the library has no React and no DOM calls', !/from 'react'|document\.|window\.|getContext/.test(lib));
  check('no em dashes in the new files', ![panel, lib].some((text) => text.includes('\u2014')));
  check('no em dashes in the page lines this change wrote', !/\u2014/.test(showBanner + between(page, '{/* The wrapper is Align', '{/* Mode tabs')));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
