import type { CSSProperties } from 'react';

/**
 * One still frame from an animated style's example sheet, shown in the style
 * picker and the style field with a Play badge. These styles have no
 * examplePaths, so the examples lightbox never opens for them.
 * Frames count from 0, left to right, then top to bottom.
 */
export interface AnimatedStill {
  file: string;
  cols: number;
  rows: number;
  frame: number;
}

export const ANIMATED_STILLS: Readonly<Record<string, AnimatedStill>> = {
  // Frame 8 is the front view; frame 0 is the back.
  'anim-4angle-walking': { file: '/style-examples/anim-4angle-walking-1.png', cols: 4, rows: 4, frame: 8 },
  'anim-small-sprites': { file: '/style-examples/anim-small-sprites-1.png', cols: 5, rows: 4, frame: 0 },
  'anim-any': { file: '/style-examples/anim-any-1.png', cols: 4, rows: 4, frame: 0 },
};

/** A position along one axis, in percent, for cell `index` of `count`. */
function axisPercent(index: number, count: number): number {
  return count > 1 ? Number(((index / (count - 1)) * 100).toFixed(4)) : 0;
}

/** The CSS that shows one frame of the still's sheet, filling its box. */
export function stillFrameStyle({ file, cols, rows, frame }: AnimatedStill): CSSProperties {
  const col = frame % cols;
  const row = Math.floor(frame / cols);
  return {
    backgroundImage: `url(${file})`,
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${axisPercent(col, cols)}% ${axisPercent(row, rows)}%`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
  };
}
