import { trackHeads } from '@/lib/headTrack';
import { borderMostlyTransparent } from '@/lib/sheetAlpha';
import { detectSprites } from '@/lib/spriteUtils';

/**
 * Align frames: puts every frame's feet on one line and centers the character
 * by its legs and feet, so an animation stops drifting. Pure: no React and no
 * DOM, so the upload page and the editor's timeline can share it. Moves are
 * whole pixels, nothing is resampled, nothing is cropped, and inputs are never
 * changed.
 *
 * The anchor is bottom center. A weapon or shadow touching the body counts as
 * the body, so one reaching below the feet counts as the feet: the preview
 * shows that, and the frame can be left out. A sword or arm reaching out above
 * the hips does not move the frame, because the center is read from the
 * body's lowest quarter only.
 *
 * A walk or a run moves its legs on purpose, so centering on them makes a
 * steady body shake. Those frames take the 'upper' anchor instead: the center
 * of the body's top 60%, the head and torso. Frames that are steady already
 * get no moves, and a plan says when it would make the heads move more than
 * they do now (HQ room 2026-11-11-098, 2026-11-14-053). Where the head can
 * be tracked by matching pixels (headTrack.ts), which a swinging plume, cape
 * or hair cannot pull, steady reads that head for a walk or a run, and that
 * check reads it beside the paint-weighted head for every animation; a walk
 * or a run whose head cannot be tracked is not centered unasked (AUDIT
 * align-walk round 1, F1).
 */

/** ImageData fits this type; the editor keeps plain arrays. */
export type AlignFrame = { data: Uint8ClampedArray; width: number; height: number };

/** Whole pixels. `shortened` means the crop guard cut the move. */
export type FrameMove = { dx: number; dy: number; shortened: boolean };

/** A feet row and a column. The column is the legs': frames centered from
 *  their head and torso are brought to it as a block (see planAlignment). */
export type AlignTarget = { feetRow: number; centerCol: number };
/** Where a frame is centered from: its legs and feet (the lowest quarter),
 *  or its head and torso (the top 60%), for a walk or a run. */
export type AlignAnchor = 'legs' | 'upper';
/** What measureFrame reads from a body. `centerCol` is the legs' column;
 *  `upperCol` the head and torso's; `headCol` the top quarter's, which the
 *  never-worse check reads; `topRow` the body's first row. */
export type BodyMeasure = AlignTarget & { topRow: number; upperCol: number; headCol: number };
/** Which part of a plan to keep: both, only the sideways moves, only the
 *  up-and-down moves, or neither (every frame as drawn). */
export type AlignParts = 'both' | 'sideways' | 'height' | 'none';

export interface AlignOptions {
  /** True at an index keeps that frame still and out of the target. */
  leaveOut?: boolean[];
  /** Align to this instead of the median, for "Align to this frame". */
  target?: AlignTarget;
  /** One entry per frame, as measureFrame returns, used in place of measuring:
   *  a caller that keeps these measures each frame once. An entry with only a
   *  feet row and a center column still works: that frame is centered from
   *  its legs and takes no part in the steady and never-worse checks. */
  measured?: ((AlignTarget & Partial<BodyMeasure>) | null)[];
  /** One entry per frame: where that frame is centered from. Legs when absent. */
  anchors?: AlignAnchor[];
  /** Keep only the sideways or only the up-and-down moves, or neither. Both
   *  when absent. */
  parts?: AlignParts;
  /** True: a walk or a run whose head cannot be tracked is not centered:
   *  that animation's sideways moves are held (its only), and `unsure` says
   *  so. The card asks for this; its "Center anyway" leaves it off. */
  holdUntracked?: boolean;
  /** One entry per frame: frames with the same number play together (one
   *  animation). The never-worse check then reads each animation on its own,
   *  so a sheet of four directions with bodies of four heights is not held to
   *  one head line. All frames as one when absent. */
  groups?: number[];
}

export interface AlignmentPlan {
  /** One per frame, in order. */
  moves: FrameMove[];
  /** Null when refused, or when nothing in scope has a body and no target was given. */
  target: AlignTarget | null;
  /** 'opaque': every frame in scope with any paint fills its cell, so the
   *  background is still there. 'sizes': the frames are not all one width and
   *  height. */
  refused: 'opaque' | 'sizes' | null;
  /** Frames that move. */
  aligned: number;
  /** Frames with a body that were on the target already. */
  alreadyInPlace: number;
  /** Indexes into `frames` (0-based) of the frames the crop guard cut. */
  shortenedFrames: number[];
  /** Indexes into `frames` (0-based) of the frames in scope that paint half
   *  their cell's ring or more: they get no move and do not steer the target. */
  filled: number[];
  /** True when the frames were steady already (feet rows within 1 px and
   *  the head-and-torso centers within 1 px, the tracked head for a walk or a
   *  run the tracker is sure of): no frame moves. */
  steady: boolean;
  /** Whether these moves would make the heads move more than they do now, by
   *  more than 1 px, in any one animation: `sideways` by the heads' centers
   *  or, where the tracker is sure of that animation, by the tracked heads;
   *  `height` by the bodies' top rows or the tracked heads. A caller should
   *  not offer such a part unasked. */
  worse: { sideways: boolean; height: boolean };
  /** True when a walk's or a run's sideways moves were held because its head
   *  could not be tracked: centering it might make it sway more, and nothing
   *  measured says it would. Only that animation is held; the rest of the
   *  scope is aligned. Only with `holdUntracked`. */
  unsure: boolean;
  /** The held animations, by their `groups` number, in scope order (empty
   *  when none was held). */
  heldGroups: number[];
}

/** Below this alpha a pixel is background, as in detectSprites. */
const CONTENT_ALPHA = 10;

const noMove = (): FrameMove => ({ dx: 0, dy: 0, shortened: false });

/** The feet row and center column of a frame's body, with its top row and
 *  the centers of its head and torso and of its head, or null if it has none. */
export function measureFrame(frame: AlignFrame): BodyMeasure | null {
  const { sprites } = detectSprites(frame as unknown as ImageData);
  if (sprites.length === 0) return null;
  const body = sprites.reduce((best, s) => (s.width * s.height > best.width * best.height ? s : best));

  const topRow = body.y;
  const feetRow = body.y + body.height - 1;
  /** The alpha-weighted center column of the body's rows `from` to `to`. */
  const center = (from: number, to: number): number | null => {
    let weight = 0;
    let weightedX = 0;
    for (let y = from; y <= to; y++) {
      for (let x = body.x; x < body.x + body.width; x++) {
        const alpha = frame.data[(y * frame.width + x) * 4 + 3];
        if (alpha < CONTENT_ALPHA) continue;
        weight += alpha;
        weightedX += alpha * x;
      }
    }
    return weight > 0 ? weightedX / weight : null;
  };
  const quarter = Math.min(body.height, Math.max(2, Math.ceil(body.height / 4)));
  const upperRows = Math.min(body.height, Math.max(2, Math.floor(body.height * 0.6)));
  // The lowest quarter always holds paint: the feet row is the body's last.
  const centerCol = center(feetRow - quarter + 1, feetRow)!;
  // A body's first row holds paint too; the fallback is for safety only.
  const upperCol = center(topRow, topRow + upperRows - 1) ?? centerCol;
  const headCol = center(topRow, topRow + quarter - 1) ?? upperCol;
  return { feetRow, centerCol, topRow, upperCol, headCol };
}

/** The box of every pixel with any alpha at all, or null for an empty frame.
 *  Faint pixels count: the crop guard must not lose them either. */
function paintedBox(frame: AlignFrame) {
  let minX = frame.width, minY = frame.height, maxX = -1, maxY = -1;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (frame.data[(y * frame.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Whether any pixel has any alpha at all. */
function hasPaint(frame: AlignFrame): boolean {
  for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i] !== 0) return true;
  return false;
}

/** Heads tracked once per set of frames (the same frame objects with the
 *  same measures), so the card's second plan, its "anyway" plan and a Leave
 *  out press elsewhere in the scope do not track again (AUDIT align-walk-r2,
 *  L2-2-d). Keyed on the frames themselves: a new frame map starts afresh,
 *  and the entries go with the frames. */
const frameIds = new WeakMap<AlignFrame, number>();
let nextFrameId = 1;
const trackCache = new WeakMap<AlignFrame, Map<string, { dx: number; dy: number }[] | null>>();
function trackedOnce(frames: AlignFrame[], bodies: BodyMeasure[]): { dx: number; dy: number }[] | null {
  const key = frames.map((frame, k) => {
    let id = frameIds.get(frame);
    if (id === undefined) { id = nextFrameId++; frameIds.set(frame, id); }
    return `${id}:${bodies[k].topRow}:${bodies[k].feetRow}:${bodies[k].headCol}`;
  }).join(',');
  let known = trackCache.get(frames[0]);
  if (!known) { known = new Map(); trackCache.set(frames[0], known); }
  if (!known.has(key)) {
    const track = trackHeads(frames, bodies);
    known.set(key, track.sure ? track.offsets.map((offset) => offset!) : null);
  }
  return known.get(key)!;
}

/** The lower middle value when the count is even. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** How far to move each frame, without moving anything. */
/** Whether a frame paints half its cell's ring or more (a big effect, or a
 *  background that is still there). Such a frame gets no move, steers no
 *  target, and is not read for the shape of a set. */
export function fillsCell(frame: AlignFrame): boolean {
  return !borderMostlyTransparent(frame.data, frame.width, frame.height);
}

export function planAlignment(frames: AlignFrame[], options: AlignOptions = {}): AlignmentPlan {
  const inScope = (index: number) => !options.leaveOut?.[index];
  const moves = frames.map(noMove);

  const scope = frames.filter((_, i) => inScope(i));
  if (scope.some((frame) => frame.width !== scope[0].width || frame.height !== scope[0].height)) {
    return { moves, target: null, refused: 'sizes', aligned: 0, alreadyInPlace: 0, shortenedFrames: [], filled: [], steady: false, worse: { sideways: false, height: false }, unsure: false, heldGroups: [] };
  }

  // A frame that paints half its cell's ring (a big effect, say) stays as it
  // is. Only when every frame with paint does is the background still there;
  // an empty frame is neither.
  const filled = frames.flatMap((frame, i) => (inScope(i) && fillsCell(frame) ? [i] : []));
  const isFilled = (i: number) => filled.includes(i);
  if (filled.length > 0 && frames.every((frame, i) => !inScope(i) || isFilled(i) || !hasPaint(frame))) {
    return { moves, target: null, refused: 'opaque', aligned: 0, alreadyInPlace: 0, shortenedFrames: [], filled, steady: false, worse: { sideways: false, height: false }, unsure: false, heldGroups: [] };
  }

  const measure = (frame: AlignFrame, i: number) => (options.measured ? options.measured[i] : measureFrame(frame));
  const bodies = frames.map((frame, i) => (inScope(i) && !isFilled(i) ? measure(frame, i) : null));
  const withBody = bodies.flatMap((body, i) => (body ? [i] : []));
  const full = withBody.filter((i) => bodies[i]!.upperCol !== undefined);
  const usesUpper = (i: number) => options.anchors?.[i] === 'upper' && bodies[i]?.upperCol !== undefined;
  // Each animation's frames, and its heads tracked by matching pixels (null
  // where the tracker is not sure), tracked once and only when read.
  const sets = new Map<number, number[]>();
  for (const i of full) {
    const key = options.groups?.[i] ?? 0;
    sets.set(key, [...(sets.get(key) ?? []), i]);
  }
  const headsOf = (set: number[]) => trackedOnce(set.map((i) => frames[i]), set.map((i) => bodies[i] as BodyMeasure));
  // Where a walk's or a run's head is, for steady, when the tracker is sure:
  // the animation's typical head-and-torso column, moved as the head moves.
  const trackedCol = new Map<number, number>();
  for (const set of sets.values()) {
    if (!set.some(usesUpper)) continue;
    const heads = headsOf(set);
    if (!heads) continue;
    const base = median(set.map((i, k) => bodies[i]!.upperCol! - heads[k].dx));
    set.forEach((i, k) => trackedCol.set(i, base + heads[k].dx));
  }
  const upperOf = (i: number) => (usesUpper(i) && trackedCol.has(i) ? trackedCol.get(i)! : bodies[i]!.upperCol!);
  // The column a frame is centered from: its head and torso for the 'upper'
  // anchor (when it was measured), else its legs.
  const colOf = (i: number) => (usesUpper(i) ? bodies[i]!.upperCol! : bodies[i]!.centerCol);
  // One feet row and one center column for the whole scope, and the column
  // is the legs', as on main. A head and torso can sit well to one side of
  // the legs (a cape), so the two centers are not one line. The frames
  // centered from their head and torso are brought to one column among
  // themselves, their middle one, and that column is moved as a block, by
  // as much as brings the middle of their legs' centers onto the scope's
  // column. A walk and the idle beside it then stand in one place, and a
  // character does not jump sideways when it changes animation (AUDIT
  // align-walk-r1 F3, r2 M2-B). A scope of such frames only is its own
  // block: the shift is exactly 0 and its column is their middle one.
  const upperFrames = withBody.filter(usesUpper);
  const feetTarget = options.target?.feetRow ?? (withBody.length > 0 ? median(withBody.map((i) => bodies[i]!.feetRow)) : null);
  const colTarget = options.target?.centerCol ?? (withBody.length > 0 ? median(withBody.map((i) => bodies[i]!.centerCol)) : null);
  const target = feetTarget === null ? null : { feetRow: feetTarget, centerCol: colTarget! };
  const upperGoal = upperFrames.length === 0 || colTarget === null ? null
    : median(upperFrames.map(colOf)) + (colTarget - median(upperFrames.map((i) => bodies[i]!.centerCol)));
  /** Where a frame's own column should land. */
  const goal = (i: number) => (usesUpper(i) ? upperGoal! : colTarget!);

  // Steady already: the feet rows within 1 px and the head-and-torso centers
  // (a tracked walk's or run's heads) within 1 px. Nothing moves, whatever
  // the legs do (HQ 2026-11-11-098).
  const spread = (values: number[]) => (values.length > 0 ? Math.max(...values) - Math.min(...values) : 0);
  const steady =
    !options.target && full.length > 0 && full.length === withBody.length &&
    spread(full.map((i) => bodies[i]!.feetRow)) <= 1 && spread(full.map(upperOf)) <= 1;
  if (steady) {
    return {
      moves, target, refused: null, aligned: 0, alreadyInPlace: withBody.length, shortenedFrames: [], filled,
      steady: true, worse: { sideways: false, height: false }, unsure: false, heldGroups: [],
    };
  }

  const parts = options.parts ?? 'both';
  const wanted = withBody.map((i) => {
    const frame = frames[i];
    // A body always has painted pixels. The `+ 0` turns -0 into 0.
    const box = paintedBox(frame)!;
    const wantX = parts === 'height' || parts === 'none' ? 0 : Math.round(goal(i) - colOf(i)) + 0;
    const wantY = parts === 'sideways' || parts === 'none' ? 0 : Math.round(target!.feetRow - bodies[i]!.feetRow) + 0;
    const dx = clamp(wantX, -box.minX, frame.width - 1 - box.maxX) + 0;
    const dy = clamp(wantY, -box.minY, frame.height - 1 - box.maxY) + 0;
    return { i, col: colOf(i), goal: goal(i), wantX, wantY, dx, dy, held: false };
  });

  // A walk or a run whose head cannot be tracked is not centered unasked: its
  // paint-weighted head is what a plume, cape or hair pulls. Its sideways
  // moves are held, that animation's only, so one untracked row does not
  // hold a whole scope (AUDIT align-walk-r2, M2-A).
  const at = new Map(wanted.map((w) => [w.i, w]));
  const heldGroups: number[] = [];
  for (const [key, set] of sets) {
    if (!options.holdUntracked || !set.some(usesUpper) || !set.some((i) => at.get(i)!.dx !== 0) || headsOf(set)) continue;
    heldGroups.push(key);
    for (const i of set) Object.assign(at.get(i)!, { wantX: 0, dx: 0, held: true });
  }

  // Centers are fractional and moves are whole, so a pass leaves them up to a
  // pixel apart, and the median of those can differ from the one just aligned
  // to. Centers that fit in one pixel are aligned already; without this a
  // second Align would nudge frames. Frames the crop guard holds do not count.
  // With two columns in the scope (the legs' and the block's) it is each
  // frame's distance from its own column that must fit in one pixel. A held
  // walk does not count.
  const free = wanted.filter((w) => w.dx === w.wantX && !w.held);
  const off = free.map((w) => w.col - w.goal);
  const settled = !options.target && off.length > 0 && Math.max(...off) - Math.min(...off) < 1;

  let aligned = 0;
  let alreadyInPlace = 0;
  const shortenedFrames: number[] = [];

  for (const { i, wantX, wantY, dx: cutX, dy } of wanted) {
    const dx = settled && cutX === wantX ? 0 : cutX;
    const shortened = cutX !== wantX || dy !== wantY;
    moves[i] = { dx, dy, shortened };
    if (shortened) shortenedFrames.push(i);
    if (dx !== 0 || dy !== 0) aligned++;
    else if (!shortened) alreadyInPlace++;
  }

  // Never worse: would these moves spread the heads further than they are
  // now, in any one animation? By the paint-weighted center and the top row
  // as before, or by the tracked head where the tracker is sure. An
  // animation with no move cannot spread, so it is not tracked for this.
  // Centers are fractions: a widening of exactly 1 px must not read as more
  // than 1 through rounding.
  const widened = (before: number[], after: number[]) => spread(after) - spread(before) > 1 + 1e-6;
  const moving = (set: number[]) => set.some((i) => moves[i].dx !== 0 || moves[i].dy !== 0);
  const tracked = (set: number[]) => (moving(set) ? headsOf(set) : null);
  const worseBy = (set: number[], values: number[], axis: 'dx' | 'dy') =>
    widened(values, values.map((value, k) => value + moves[set[k]][axis]));
  const anySet = (test: (indexes: number[]) => boolean) => [...sets.values()].some(test);
  const worse = {
    sideways: anySet((set) => worseBy(set, set.map((i) => bodies[i]!.headCol!), 'dx')
      || (!!tracked(set) && worseBy(set, tracked(set)!.map((head) => head.dx), 'dx'))),
    height: anySet((set) => worseBy(set, set.map((i) => bodies[i]!.topRow!), 'dy')
      || (!!tracked(set) && worseBy(set, tracked(set)!.map((head) => head.dy), 'dy'))),
  };

  return { moves, target, refused: null, aligned, alreadyInPlace, shortenedFrames, filled, steady: false, worse, unsure: heldGroups.length > 0, heldGroups };
}

/** Whether a set of bodies moves like a walk: the legs' centers spread more
 *  than twice as far as the head-and-torso centers. For frames with no
 *  animation type; a labelled Walk or Run needs no guess. */
export function walkLike(bodies: (BodyMeasure | null)[]): boolean {
  const found = bodies.filter((body) => body !== null);
  if (found.length < 2) return false;
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  return spread(found.map((b) => b.centerCol)) > 2 * spread(found.map((b) => b.upperCol));
}

/** Whether the frames look like a solid background the page's banner can
 *  remove: every frame's four corner pixels are opaque and within 15 of one
 *  color in each channel (the first frame's top left). False with no frames. */
export function solidBackground(frames: AlignFrame[]): boolean {
  if (frames.length === 0) return false;
  const first = frames[0].data;
  return frames.every(({ data, width, height }) =>
    width > 0 && height > 0 && [0, width - 1, (height - 1) * width, height * width - 1].every((pixel) =>
      data[pixel * 4 + 3] === 255
      && [0, 1, 2].every((channel) => Math.abs(data[pixel * 4 + channel] - first[channel]) <= 15)));
}

/** A new frame with every pixel moved by (dx, dy); vacated pixels are fully
 *  transparent. A zero move returns `frame` itself. Never changes `frame`.
 *  Apply the same move to every layer of a frame. */
export function shiftFrame(frame: AlignFrame, move: FrameMove): AlignFrame {
  if (move.dx === 0 && move.dy === 0) return frame;
  const { width, height, data } = frame;
  const moved = new Uint8ClampedArray(data.length);
  const columns = width - Math.abs(move.dx);
  for (let y = Math.max(0, -move.dy); columns > 0 && y < Math.min(height, height - move.dy); y++) {
    const fromX = Math.max(0, -move.dx);
    const start = (y * width + fromX) * 4;
    moved.set(data.subarray(start, start + columns * 4), ((y + move.dy) * width + fromX + move.dx) * 4);
  }
  return { data: moved, width, height };
}

/** The moved frames and the plan that moved them. */
export function applyAlignment(frames: AlignFrame[], options: AlignOptions = {}) {
  const plan = planAlignment(frames, options);
  return { frames: frames.map((frame, i) => shiftFrame(frame, plan.moves[i])), plan };
}

/** A frame held still by the crop guard: it wanted to move and could not. */
const held = (move: FrameMove) => move.shortened && move.dx === 0 && move.dy === 0;

/** The note's words when some walks' centering is held because their heads
 *  could not be tracked, named by their groups, while the rest of the scope
 *  is aligned (DESIGN 2026-11-14-220, HQ -222): one or two by name, more
 *  by count. */
export function heldWords(names: string[]): { before: string; after: string } {
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.length} animations`;
  return names.length === 1
    ? { before: `${who} not centered: its head could not be tracked, so centering it might make it sway more.`, after: `${who} centered. Its head may sway more than before.` }
    : { before: `${who} not centered: their heads could not be tracked, so centering them might make them sway more.`, after: `${who} centered. Their heads may sway more than before.` };
}

/** A frame's move for the preview list: "Up 2, left 1", "No move", or, for a
 *  frame the crop guard held, "Can't move without cutting pixels". */
export function moveWords({ dx, dy, shortened = false }: Pick<FrameMove, 'dx' | 'dy'> & Partial<FrameMove>): string {
  if (held({ dx, dy, shortened })) return "Can't move without cutting pixels";
  const parts: string[] = [];
  if (dy !== 0) parts.push(`${dy < 0 ? 'up' : 'down'} ${Math.abs(dy)}`);
  if (dx !== 0) parts.push(`${dx < 0 ? 'left' : 'right'} ${Math.abs(dx)}`);
  if (parts.length === 0) return 'No move';
  const words = parts.join(', ');
  return words[0].toUpperCase() + words.slice(1);
}

/** What Align did, in one status line. `frameNumbers` holds each plan index's
 *  number as the user sees it on the frame grid (1-based). */
export function alignmentSummary(plan: AlignmentPlan, frameNumbers: number[]): string {
  if (plan.refused === 'sizes') return 'Align needs frames of one size. Extract them with padding on, then align.';
  if (plan.refused) return 'Remove the background first, then align.';
  const stuck = plan.shortenedFrames.filter((i) => held(plan.moves[i])).length;
  const filled = plan.filled.map((i) => `Frame ${frameNumbers[i]} fills its cell, so it stays as it is.`);
  if (plan.aligned === 0 && stuck === 0) {
    return filled.length > 0 ? filled.join(' ') : 'These frames are already aligned.';
  }
  const total = plan.aligned + plan.alreadyInPlace + stuck;
  const lines = [`Aligned ${plan.aligned} of ${total} ${total === 1 ? 'frame' : 'frames'}.`];
  if (plan.alreadyInPlace > 0) {
    lines.push(`${plan.alreadyInPlace} ${plan.alreadyInPlace === 1 ? 'was' : 'were'} already in place.`);
  }
  for (const i of plan.shortenedFrames) {
    lines.push(held(plan.moves[i])
      ? `Frame ${frameNumbers[i]} could not move without cutting something off.`
      : `Frame ${frameNumbers[i]} moved as far as it could without cutting anything off.`);
  }
  return [...lines, ...filled].join(' ');
}
