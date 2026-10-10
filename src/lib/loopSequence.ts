// Frame order, speed and ping-pong for the playing loop on an Animate
// result. Pure, no React: every function returns a new object and never
// mutates its input. Entries in `order` are sheet frame indexes, row-major.

export interface LoopSequence {
  order: number[];
  fps: number;
  pingPong: boolean;
}

export const LOOP_FPS_MIN = 4;
export const LOOP_FPS_MAX = 24;
export const LOOP_FPS_DEFAULT = 8;

/** Every frame once, in sheet order, at the default speed. */
export function createSequence(frameCount: number): LoopSequence {
  const n = Number.isFinite(frameCount) ? Math.max(0, Math.floor(frameCount)) : 0;
  return {
    order: Array.from({ length: n }, (_, i) => i),
    fps: LOOP_FPS_DEFAULT,
    pingPong: false,
  };
}

function copy(seq: LoopSequence): LoopSequence {
  return { ...seq, order: [...seq.order] };
}

function validPos(seq: LoopSequence, pos: number): boolean {
  return Number.isInteger(pos) && pos >= 0 && pos < seq.order.length;
}

/** Swaps the entry at `pos` with its neighbor in the direction of `delta`.
 *  A no-op (still a new object) at either end or for a bad position. */
export function move(seq: LoopSequence, pos: number, delta: number): LoopSequence {
  const next = copy(seq);
  const target = pos + Math.sign(delta);
  if (!validPos(seq, pos) || target === pos || !validPos(seq, target)) return next;
  [next.order[pos], next.order[target]] = [next.order[target], next.order[pos]];
  return next;
}

/** Drops the entry at `pos`, but never below one frame. */
export function remove(seq: LoopSequence, pos: number): LoopSequence {
  const next = copy(seq);
  if (!validPos(seq, pos) || seq.order.length <= 1) return next;
  next.order.splice(pos, 1);
  return next;
}

/** Inserts a copy of the entry at `pos` right after it. */
export function duplicate(seq: LoopSequence, pos: number): LoopSequence {
  const next = copy(seq);
  if (!validPos(seq, pos)) return next;
  next.order.splice(pos + 1, 0, seq.order[pos]);
  return next;
}

/** Rounds and clamps to LOOP_FPS_MIN..LOOP_FPS_MAX. A non-number keeps the
 *  current speed. */
export function setFps(seq: LoopSequence, fps: number): LoopSequence {
  const next = copy(seq);
  if (!Number.isFinite(fps)) return next;
  next.fps = Math.min(LOOP_FPS_MAX, Math.max(LOOP_FPS_MIN, Math.round(fps)));
  return next;
}

export function togglePingPong(seq: LoopSequence): LoopSequence {
  return { ...copy(seq), pingPong: !seq.pingPong };
}

/** The frames as they play. With ping-pong on, the order runs forward then
 *  back without repeating either end, so [0,1,2,3] plays [0,1,2,3,2,1].
 *  One or two frames play as the order. */
export function playback(seq: LoopSequence): number[] {
  const order = [...seq.order];
  if (!seq.pingPong || order.length <= 2) return order;
  return [...order, ...order.slice(1, -1).reverse()];
}
