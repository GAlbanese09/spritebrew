/**
 * Auto-Prep's pictures (design/generate-pass/generate-pass.md 5.3, G4): each in
 * a square box at a whole-number zoom, never squashed, two side by side.
 */

/** The display size of a picture of `width` by `height` px in a square box of
 *  `box` px: a whole-number zoom when it fits, else a whole-number fraction
 *  (one half, one third...), rounded down to whole pixels, at least 1. Its
 *  shape is kept. */
export function prepPictureDims(width: number, height: number, box: number): [number, number] {
  const side = Math.max(width, height);
  if (!(width > 0) || !(height > 0) || !(box > 0)) return [0, 0];
  if (side <= box) {
    const zoom = Math.floor(box / side);
    return [width * zoom, height * zoom];
  }
  // Never 0 on a side: a very thin picture still shows a line of pixels
  // (AUDIT g4-animate-r1 L8).
  const part = Math.ceil(side / box);
  return [Math.max(1, Math.floor(width / part)), Math.max(1, Math.floor(height / part))];
}

/** The box side for two pictures in a row of `width` px with `gap` between:
 *  at most `cap`, and two must fit. */
export function prepPictureBox(width: number, gap: number, cap: number): number {
  return Math.max(0, Math.min(cap, Math.floor((width - gap) / 2)));
}
