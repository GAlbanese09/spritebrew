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
 */

/** ImageData fits this type; the editor keeps plain arrays. */
export type AlignFrame = { data: Uint8ClampedArray; width: number; height: number };

/** Whole pixels. `shortened` means the crop guard cut the move. */
export type FrameMove = { dx: number; dy: number; shortened: boolean };

export type AlignTarget = { feetRow: number; centerCol: number };

export interface AlignOptions {
  /** True at an index keeps that frame still and out of the target. */
  leaveOut?: boolean[];
  /** Align to this instead of the median, for "Align to this frame". */
  target?: AlignTarget;
}

export interface AlignmentPlan {
  /** One per frame, in order. */
  moves: FrameMove[];
  /** Null when refused, or when nothing in scope has a body and no target was given. */
  target: AlignTarget | null;
  /** 'opaque': a frame's background is still there. 'sizes': the frames are
   *  not all one width and height. */
  refused: 'opaque' | 'sizes' | null;
  /** Frames that move. */
  aligned: number;
  /** Frames with a body that were on the target already. */
  alreadyInPlace: number;
  /** Indexes into `frames` (0-based) of the frames the crop guard cut. */
  shortenedFrames: number[];
}

/** Below this alpha a pixel is background, as in detectSprites. */
const CONTENT_ALPHA = 10;

const noMove = (): FrameMove => ({ dx: 0, dy: 0, shortened: false });

/** The feet row and center column of a frame's body, or null if it has none. */
function measureBody(frame: AlignFrame): AlignTarget | null {
  const { sprites } = detectSprites(frame as unknown as ImageData);
  if (sprites.length === 0) return null;
  const body = sprites.reduce((best, s) => (s.width * s.height > best.width * best.height ? s : best));

  const feetRow = body.y + body.height - 1;
  const bandRows = Math.min(body.height, Math.max(2, Math.ceil(body.height / 4)));
  let weight = 0;
  let weightedX = 0;
  for (let y = feetRow - bandRows + 1; y <= feetRow; y++) {
    for (let x = body.x; x < body.x + body.width; x++) {
      const alpha = frame.data[(y * frame.width + x) * 4 + 3];
      if (alpha < CONTENT_ALPHA) continue;
      weight += alpha;
      weightedX += alpha * x;
    }
  }
  return { feetRow, centerCol: weightedX / weight };
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

/** The lower middle value when the count is even. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** How far to move each frame, without moving anything. */
export function planAlignment(frames: AlignFrame[], options: AlignOptions = {}): AlignmentPlan {
  const inScope = (index: number) => !options.leaveOut?.[index];
  const moves = frames.map(noMove);

  const scope = frames.filter((_, i) => inScope(i));
  const refused =
    scope.some((frame) => frame.width !== scope[0].width || frame.height !== scope[0].height) ? 'sizes'
    : scope.some((frame) => !borderMostlyTransparent(frame.data, frame.width, frame.height)) ? 'opaque'
    : null;
  if (refused) {
    return { moves, target: null, refused, aligned: 0, alreadyInPlace: 0, shortenedFrames: [] };
  }

  const bodies = frames.map((frame, i) => (inScope(i) ? measureBody(frame) : null));
  const measured = bodies.filter((body) => body !== null);
  const target =
    options.target ??
    (measured.length > 0
      ? { feetRow: median(measured.map((b) => b.feetRow)), centerCol: median(measured.map((b) => b.centerCol)) }
      : null);

  const wanted = bodies.flatMap((body, i) => {
    if (!body || !target) return [];
    const frame = frames[i];
    // A body always has painted pixels. The `+ 0` turns -0 into 0.
    const box = paintedBox(frame)!;
    const wantX = Math.round(target.centerCol - body.centerCol) + 0;
    const wantY = Math.round(target.feetRow - body.feetRow) + 0;
    const dx = clamp(wantX, -box.minX, frame.width - 1 - box.maxX) + 0;
    const dy = clamp(wantY, -box.minY, frame.height - 1 - box.maxY) + 0;
    return [{ i, centerCol: body.centerCol, wantX, wantY, dx, dy }];
  });

  // Centers are fractional and moves are whole, so a pass leaves them up to a
  // pixel apart, and the median of those can differ from the one just aligned
  // to. Centers that fit in one pixel are aligned already; without this a
  // second Align would nudge frames. Frames the crop guard holds do not count.
  const free = wanted.filter((w) => w.dx === w.wantX).map((w) => w.centerCol);
  const settled = !options.target && free.length > 0 && Math.max(...free) - Math.min(...free) < 1;

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

  return { moves, target, refused: null, aligned, alreadyInPlace, shortenedFrames };
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
  if (plan.aligned === 0 && stuck === 0) return 'These frames are already aligned.';
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
  return lines.join(' ');
}
