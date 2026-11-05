/**
 * Whether a sheet's background is already gone, read from its outer one-pixel
 * ring. Art can touch the border and a corner can be erased, so one pixel
 * proves nothing either way; half the ring does.
 *
 * Pure, so it is tested offline (scripts/played-sheet-test.mjs).
 */

/** True when at least half the ring's pixels, each counted once, have alpha 0. */
export function borderMostlyTransparent(px: Uint8ClampedArray | Uint8Array, W: number, H: number): boolean {
  if (W === 0 || H === 0) return false;
  let ring = 0;
  let clear = 0;
  const count = (x: number, y: number) => {
    ring++;
    if (px[(y * W + x) * 4 + 3] === 0) clear++;
  };
  for (let x = 0; x < W; x++) {
    count(x, 0);
    if (H > 1) count(x, H - 1);
  }
  for (let y = 1; y < H - 1; y++) {
    count(0, y);
    if (W > 1) count(W - 1, y);
  }
  return clear * 2 >= ring;
}
