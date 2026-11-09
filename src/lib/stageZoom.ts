// Whole-number zoom math for the /preview stages (the Demo Area and the
// Animation Player): where a pinch lands, one wheel notch, and the scale a
// stage opens at. Pure: no React, no DOM, so the offline test runs it in node.
// Every function returns a value from `allowed`, so pixel art stays sharp.

const isPositive = (n: number) => Number.isFinite(n) && n > 0;

const low = (allowed: readonly number[]) => Math.min(...allowed);
const high = (allowed: readonly number[]) => Math.max(...allowed);

/** The allowed value nearest to startScale * gestureScale in log space (so 3
 *  and 6 are equally far from 4.24), clamped to the list's ends. A pinch
 *  reports gestureScale from the start of the gesture. Bad input, or an empty
 *  list, returns startScale. */
export function snapZoom(startScale: number, gestureScale: number, allowed: readonly number[]): number {
  if (!isPositive(startScale) || !isPositive(gestureScale) || allowed.length === 0) return startScale;
  const target = startScale * gestureScale;
  if (target <= low(allowed)) return low(allowed);
  if (target >= high(allowed)) return high(allowed);
  const t = Math.log(target);
  let best = allowed[0];
  for (const value of allowed) {
    if (Math.abs(Math.log(value) - t) < Math.abs(Math.log(best) - t)) best = value;
  }
  return best;
}

/** The next allowed value up (1) or down (-1) from current, for one wheel
 *  notch; stays at the end when there is none further. */
export function stepZoom(current: number, direction: 1 | -1, allowed: readonly number[]): number {
  if (allowed.length === 0) return current;
  const sorted = [...allowed].sort((a, b) => a - b);
  if (direction === 1) return sorted.find((value) => value > current) ?? sorted[sorted.length - 1];
  return [...sorted].reverse().find((value) => value < current) ?? sorted[0];
}

/** The allowed scale that draws a sprite of spriteHeight nearest to
 *  share * stageHeight tall, never more than half the stage height. The
 *  smallest allowed value when none fits (or the input is bad). */
export function fitScale(
  spriteHeight: number,
  stageHeight: number,
  allowed: readonly number[],
  share = 0.35,
): number {
  if (allowed.length === 0) return 1;
  if (!isPositive(spriteHeight) || !isPositive(stageHeight)) return low(allowed);
  const target = share * stageHeight;
  const fits = allowed.filter((value) => spriteHeight * value <= stageHeight / 2);
  if (fits.length === 0) return low(allowed);
  let best = fits[0];
  for (const value of fits) {
    const gap = Math.abs(spriteHeight * value - target);
    const bestGap = Math.abs(spriteHeight * best - target);
    if (gap < bestGap || (gap === bestGap && value < best)) best = value;
  }
  return best;
}

/** The largest allowed zoom whose frame fits inside the box, else the
 *  smallest. */
export function fitZoomToBox(
  frameWidth: number,
  frameHeight: number,
  boxWidth: number,
  boxHeight: number,
  allowed: readonly number[],
): number {
  if (allowed.length === 0) return 1;
  const fits = allowed.filter((value) => frameWidth * value <= boxWidth && frameHeight * value <= boxHeight);
  return fits.length > 0 ? high(fits) : low(allowed);
}
