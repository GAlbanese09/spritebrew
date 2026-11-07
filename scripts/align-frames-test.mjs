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
  planAlignment, shiftFrame, applyAlignment, moveWords, alignmentSummary, measureFrame,
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
  const { moves } = planAlignment([legs(10, 2), legs(10, 2), legs(11, 1)]);
  check('the first pass rounds the distance to the target', moves[2].dx === -2 && moves[0].dx === 0, moves);
  const close = planAlignment([legs(10, 3), legs(10, 3), legs(9, 1)]);
  check('centers that fit in one pixel count as aligned', noMoves(close) && close.alreadyInPlace === 3, close.moves);
  const given = planAlignment([legs(9, 1)], { target: close.target });
  check('that does not soften a given target', given.moves[0].dx === -1, given.moves);
}

// ── Refused ──

{
  // L2a: the half-border test from sheetAlpha.ts.
  const opaque = () => paint(blank(40, 40), 0, 0, 40, 40);
  const plan = planAlignment([...withBody([[0, 0], [3, 3]]), opaque()]);
  check('L2: a fully painted frame is refused, with no moves', plan.refused === 'opaque' && noMoves(plan) && plan.target === null && plan.aligned === 0, plan);
  const pinhole = opaque();
  pinhole.data[(20 * 40 + 20) * 4 + 3] = 0;
  check('L2: an opaque frame with one clear pixel is refused', planAlignment([...withBody([[0, 0]]), pinhole]).refused === 'opaque');
  const corner = opaque();
  corner.data[3] = 0;
  check('L2: an opaque frame with one clear border pixel is refused', planAlignment([corner]).refused === 'opaque');
  const faint = paint(blank(16, 16), 0, 0, 16, 16, 9);
  check('L2: a faint wash over the whole frame is refused: the border must be clear', planAlignment([faint]).refused === 'opaque');
  // Ring of 60; the top and bottom rows (32) are clear, the side columns not.
  const half = paint(blank(16, 16), 0, 1, 16, 14);
  check('L2: half the border clear is not refused', planAlignment([half]).refused === null);
  const out = planAlignment([...withBody([[0, 0], [3, 3]]), opaque()], { leaveOut: [false, false, true] });
  check('a left out opaque frame does not refuse', out.refused === null && out.moves[1].dx === -3 && out.target !== null, out);
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

// ── Measure once (C4) ──

{
  const weapon = withBody([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
  for (const i of [1, 4]) paint(weapon[i], 20, 11, 12, 2);
  const fixtures = { synthetic: withBody(JITTER), weapon };
  for (const [name, frames] of Object.entries(fixtures)) {
    // A plan over one frame targets that frame's own measurement.
    const own = frames.map((f) => planAlignment([f]).target);
    check(`C4: measureFrame matches the plan's own measurement, ${name} fixture`, same(frames.map(measureFrame), own), frames.map(measureFrame));
  }
  check('C4: measureFrame reads the feet row and the legs center', same(measureFrame(figureAt([0, 0])), { feetRow: 25, centerCol: 14.5 }) && same(measureFrame(weapon[1]), { feetRow: 25, centerCol: 14.5 }), measureFrame(weapon[1]));
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
  check('the status line is always rendered, once', panel.match(/role="status"/g)?.length === 1 && /<div className="flex flex-wrap items-center gap-3">\s*\{\/\* Always rendered, so each result is announced once\. \*\/\}\s*<p role="status"[^>]*>\s*\{line\}\s*<\/p>/.test(panel));
  check('the status clears before each press, so a repeat is announced', /setBusy\(true\);\s*setStatus\(''\);/.test(press));
  check('a second press while working does nothing', /if \(busyRef\.current\) return;\s*busyRef\.current = true;/.test(press) && /finally \{\s*busyRef\.current = false;/.test(press));
  check('decoding yields first', /useEffect\(\(\) => \{\s*if \(!seen\) return;\s*if \(committedRef\.current === frameDataUrls\) \{\s*committedRef\.current = null;\s*return;\s*\}\s*let cancelled = false;\s*const timer = setTimeout\(async \(\) => \{/.test(decode) && /await nextTask\(\);\s*const built = await buildAlignedSheet\(/.test(align));
  check('Align prepare returns null when the frames changed since the press', /return stillCurrent\(\) \? built : null;/.test(align) && /useSpriteStore\.getState\(\)\.frameDataUrls === frameDataUrls/.test(panel));
  check('Undo restores the exact earlier source image and frame URLs', /before: \{ sourceImage: sheet\.sourceImage, urls: frameDataUrls \}/.test(align) && /return stillCurrent\(\) \? undo\.before : null;/.test(undoPress));
  check('Undo closes when the sheet changed, pixel edits included', /undo\.version === sheetVersion && undo\.urls === frameDataUrls/.test(panel) && /aria-disabled=\{busy \|\| !undoOpen \|\| undefined\}/.test(undoButton) && /Undo is no longer available: the sheet changed\./.test(panel));
  check('Align is not offered when refused', /<Button\s*ref=\{alignRef\}\s*size="sm"/.test(alignButton) && /if \(!ready \|\| plan\.refused\) return;/.test(align));

  // P1: Undo keeps focus.
  check('P1: when Undo completes, focus moves to Align, then Undo goes', /\(alignRef\.current \?\? selectRef\.current\)\?\.focus\(\);\s*setUndo\(null\);/.test(undoPress) && /ref=\{selectRef\}/.test(panel));
  check('P1: a stale Undo is a real focusable button: no native disabled, the note linked, the press ignored', !/\sdisabled=/.test(panel) && /aria-describedby=\{undoOpen \? undefined : undoNoteId\}/.test(undoButton) && /<p id=\{undoNoteId\}/.test(panel) && /if \(!undo \|\| !undoOpen\) return;/.test(undoPress));
  // P2: Align cannot look pressable while it cannot act.
  check('P2: while frames are read, the status says Reading frames...', /const line = status \|\| \(!ready \? 'Reading frames\.\.\.' :/.test(panel));
  check('P2: Align is aria-disabled while reading or busy', /aria-disabled=\{busy \|\| !ready \|\| undefined\}/.test(alignButton));
  check('P2: Align and Undo both get the dimmed aria-disabled style', /const DIMMED = 'aria-disabled:opacity-40 aria-disabled:cursor-not-allowed';/.test(panel) && /className=\{DIMMED\}/.test(alignButton) && /className=\{DIMMED\}/.test(undoButton));
  // P3: the frame list passes the whole move, so a held frame is named.
  check('P3: the frame list words come from the whole move, the applied one after Align', /\{moveWords\(shown\?\.moves\.get\(frame\.id\) \?\? plan\.moves\[i\]\)\}/.test(frameList));
  // P4: an opaque sheet offers Remove background.
  check('P4: Remove background shows only on the opaque refusal and only with the callback', /const offersRemoveBackground = !status && ready && plan\.refused === 'opaque' && !!onRemoveBackground;/.test(panel) && /\{offersRemoveBackground && \(\s*<Button[^>]*onClick=\{onRemoveBackground\}>\s*Remove background\s*<\/Button>/.test(panel));
  check('P4: the page callback un-dismisses the banner and scrolls its wrapper into view', /flushSync\(\(\) => setBgBannerDismissed\(false\)\);/.test(showBanner) && /bgBannerRef\.current\?\.scrollIntoView\(/.test(showBanner) && /<div ref=\{bgBannerRef\} className="empty:mb-0">\s*<BgRemovalBanner/.test(page) && /onRemoveBackground=\{handleShowBgBanner\}/.test(alignCard));
  // P5: whole groups can be left out.
  check('P5: Leave out a group shows for All frames with two or more groups', /const groups = animations\.filter\(\(a\) => a\.frames\.length > 0\);/.test(panel) && /Leave out a group:/.test(groupRow) && /role="group" aria-labelledby=\{groupsLabelId\}/.test(groupRow));
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
  check('C1: the applied view is kept only while the sheet and its frame map are the ones Align made', /const shown = result !== null && result\.version === sheetVersion && result\.urls === frameDataUrls \? result : null;/.test(panel) && /version: now\.sheetVersion,\s*urls: now\.frameDataUrls,\s*before: current,\s*after: next,\s*moves: new Map\(scopeFrames\.map\(\(frame, i\) => \[frame\.id, plan\.moves\[i\]\]\)\),/.test(alignDone));
  check('C1: the previews show the applied frames, the planned ones otherwise', /const before = shown\?\.before \?\? current;\s*const after = shown\?\.after \?\? next;/.test(panel) && /paint\(beforeRef\.current, before\[stepRef\.current\]\);\s*paint\(afterRef\.current, after\[stepRef\.current\]\);/.test(loop) && panel.match(/feetRow=\{feetRow\}/g)?.length === 2 && /const feetRow = shown \? shown\.feetRow :/.test(panel));
  check('C1: a scope change, a Leave out toggle, a group toggle and Undo each end the applied view', /setResult\(null\);/.test(scopeChange) && /setResult\(null\);/.test(leaveOutToggle) && /setResult\(null\);/.test(toggleGroup) && /setUndo\(null\);\s*setResult\(null\);/.test(undoDone));
  // C2: a refused scope shows only what helps.
  check('C2: the frame list, the group row and the jumps line are not rendered when refused', /\{!plan\.refused && \(\s*<ul className="max-h-64/.test(panel) && /^\{!plan\.refused && !group && groups\.length >= 2 && \(/.test(groupRow) && /const showsJumpsLine = !plan\.refused\s*&& groupFrames\.some\(/.test(panel));
  check('C2: the previews stay when refused', /<div className="grid grid-cols-2 gap-4 max-w-md">\s*<PreviewLoop label="Before"/.test(panel) && !/refused[^\n]*\(\s*<div className="grid grid-cols-2/.test(panel));
  // C3: the card keeps the pixels its own commit wrote.
  check('C3: Align sets the decoded frames and the Map it committed, with no decode', /committed = built\.urls;\s*committedRef\.current = built\.urls;\s*return stillCurrent\(\) \? built : null;/.test(align) && /frames\.set\(frame\.id, pixels\);\s*bodies\.set\(frame\.id, measureFrame\(pixels\)\);\s*\}\s*setDecoded\(\{ urls: committed, frames, measured: bodies \}\);/.test(alignDone) && !/decodeFrame|loadImage/.test(align));
  check('C3: Undo sets the earlier frames and the earlier Map, with no decode', /decoded: earlier,/.test(align) && /committedRef\.current = undo\.before\.urls;\s*return stillCurrent\(\) \? undo\.before : null;/.test(undoPress) && /setDecoded\(undo\.decoded\);/.test(undoDone) && !/decodeFrame|loadImage/.test(undoPress));
  check('C3: the decode skips only the card\'s own commit, and a refused commit clears the mark', /if \(committedRef\.current === frameDataUrls\) \{\s*committedRef\.current = null;\s*return;\s*\}/.test(decodeSkip) && /if \(!applied\) \{\s*committedRef\.current = null;\s*return 'The sheet changed/.test(align) && /if \(!applied\) \{\s*committedRef\.current = null;\s*return 'Undo is no longer available/.test(undoPress));
  // C4: each frame is measured once, when read.
  check('C4: the card passes cached measurements to the plan', /applyAlignment\(current, \{ leaveOut, measured \}\)/.test(panel) && /scopeFrames\.map\(\(f\) => decoded!\.measured\.get\(f\.id\) \?\? null\)/.test(panel) && /setDecoded\(\{ urls: frameDataUrls, frames, measured: measureAll\(frames\) \}\);/.test(decode) && panel.match(/measureFrame\(/g)?.length === 2);
  check('the previews are pixelated canvases at the group fps, 8 for All frames', /imageRendering: 'pixelated'/.test(panel) && /ALL_FRAMES_FPS = 8/.test(panel) && /group\?\.fps \?\? ALL_FRAMES_FPS/.test(panel));
  check('only a rect-sized frame goes back on the sheet', /if \(pixels\.width === frame\.width && pixels\.height === frame\.height\) \{\s*sheetContext\.putImageData\(image, frame\.x, frame\.y\);/.test(build));
  check('the library has no React and no DOM calls', !/from 'react'|document\.|window\.|getContext/.test(lib));
  check('no em dashes in the new files', ![panel, lib].some((text) => text.includes('\u2014')));
  check('no em dashes in the page lines this change wrote', !/\u2014/.test(showBanner + between(page, '{/* The wrapper is Align', '{/* Mode tabs')));
}

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall pass');
