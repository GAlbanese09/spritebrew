/**
 * A question's destructive button acts only on a press that began at least
 * FRESH_PRESS_MS after the question opened (AUDIT data-loss r1, M1: a double
 * tap or double click on Discard opened the question and hit its Discard,
 * which opened under the pointer, so the second press deleted the draft).
 * A keyboard press (a click with detail 0) always counts: the question
 * opens with the focus on the safe button, so a second Enter lands there.
 * Pure; tested in scripts/editor-draft-safety-test.mjs.
 */
export const FRESH_PRESS_MS = 400;

/** Whether a click counts: `openedAt` is when the question opened and
 *  `pressedAt` when the pointer pressed the button (null if no press began
 *  on it), both on the same clock; `detail` is the click's detail. */
export function freshPress(openedAt: number | null, pressedAt: number | null, detail: number): boolean {
  if (detail === 0) return true;
  if (openedAt === null || pressedAt === null) return false;
  return pressedAt - openedAt >= FRESH_PRESS_MS;
}
