/**
 * One step of the Animation Player (external product audit r2, SB-09).
 *
 * `dir` is 1 going forward and -1 going back; it only matters with
 * Ping-pong on. The caller keeps the returned direction for the next step,
 * so a turn at either end holds until the next turn: four frames play
 * 0,1,2,3,2,1,0,1. Without Loop, Ping-pong plays there and back once and
 * holds the first frame; forward play holds the last.
 */
export interface PlaybackStep {
  frame: number;
  dir: 1 | -1;
  /** Without Loop, the step that lands on a pass's last frame (AUDIT
   *  ext-mediums r1 L8): the player stops there, so its button shows Play. */
  done?: boolean;
}

export function stepPlayback(
  frame: number,
  dir: number,
  total: number,
  pingPong: boolean,
  loop: boolean,
): PlaybackStep {
  if (total <= 1) return { frame: 0, dir: 1 };
  const at = Math.min(Math.max(0, Math.floor(frame) || 0), total - 1);
  if (!pingPong) {
    const next = at + 1;
    if (next < total) return { frame: next, dir: 1, done: !loop && next === total - 1 };
    return loop ? { frame: 0, dir: 1 } : { frame: total - 1, dir: 1, done: true };
  }
  const d: 1 | -1 = dir < 0 ? -1 : 1;
  const next = at + d;
  if (next >= total) return { frame: total - 2, dir: -1, done: !loop && total - 2 === 0 };
  if (next < 0) return loop ? { frame: 1, dir: 1 } : { frame: 0, dir: -1, done: true };
  return { frame: next, dir: d, done: !loop && d === -1 && next === 0 };
}
