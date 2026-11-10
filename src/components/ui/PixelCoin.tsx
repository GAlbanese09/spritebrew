/**
 * The pixel coin: SpriteBrew's token mark, drawn on a 16 x 16 grid (DESIGN
 * ticket pr2-generate-picker.md). Decorative: the words beside it carry the
 * meaning, so it is hidden from screen readers.
 */

const PALETTE: Record<string, string> = {
  O: '#6b4308',
  Y: '#f2c14e',
  D: '#d39a1d',
  H: '#fff3b0',
  B: '#a8690c',
};

// One row per string, row 0 at the top; "." is empty.
const ROWS = [
  '................',
  '.....OOOOOO.....',
  '...OOYYYYYYOO...',
  '..OYYYYYYYYYDO..',
  '.OYYHHYYYYYYYDO.',
  '.OYHHYYBBYYYYDO.',
  '.OYYHYYBBYYYYDO.',
  '.OYYYYYBBYYYYDO.',
  '.OYYYYYBBYYYYDO.',
  '.OYYYYYBBYYYYDO.',
  '.OYYYYYBBYYYYDO.',
  '.OYYYYYYYYYYYDO.',
  '..ODDDDDDDDDDO..',
  '...OOYYYYYYOO...',
  '.....OOOOOO.....',
  '................',
];

interface Run { x: number; y: number; w: number; fill: string }

// One rect per run of one color in a row.
const RUNS: Run[] = (() => {
  const runs: Run[] = [];
  ROWS.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') runs.push({ x, y, w: end - x, fill: PALETTE[ch] });
      x = end;
    }
  });
  return runs;
})();

interface PixelCoinProps {
  /** Rendered size in px: a multiple of 16, rounded to the nearest one, at least 16. */
  size?: number;
  className?: string;
}

export default function PixelCoin({ size = 16, className = '' }: PixelCoinProps) {
  const px = Math.max(16, Math.round(size / 16) * 16);
  return (
    <svg
      viewBox="0 0 16 16"
      width={px}
      height={px}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className={`inline-block flex-shrink-0 align-middle ${className}`}
    >
      {RUNS.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
