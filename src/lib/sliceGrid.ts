/**
 * How many frames fit along one side of a sprite sheet: frames `frame` px
 * wide (or tall), `padding` px between neighbours, starting `offset` px in.
 * One calculation for the slicer's count, its grid overlay, its size presets
 * and the slice itself (external audit SB-01).
 *
 * Padding sits only between frames, never after the last one, as
 * SpriteBrew's own exporter writes sheets (downloadUtils.assembleGridSheet):
 * n frames take n * frame + (n - 1) * padding pixels.
 */
export function framesAlong(sheet: number, frame: number, padding: number, offset: number): number {
  if (!(frame > 0)) return 0;
  const gap = Math.max(0, padding);
  return Math.max(0, Math.floor((sheet - offset + gap) / (frame + gap)));
}
