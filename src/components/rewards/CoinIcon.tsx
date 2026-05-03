/**
 * Pixel-art coin. Inline SVG so it stays crisp at any scale and doesn't get
 * swapped to the OS emoji 🪙. 12×12 source grid.
 */
interface CoinIconProps {
  size?: number;
  className?: string;
}

export default function CoinIcon({ size = 64, className }: CoinIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      xmlns="http://www.w3.org/2000/svg"
      className={`pixel-art-render ${className ?? ''}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Outer ring (dark amber) */}
      <rect x="3" y="0" width="6" height="1" fill="#7a3f1a" />
      <rect x="1" y="1" width="2" height="1" fill="#7a3f1a" />
      <rect x="9" y="1" width="2" height="1" fill="#7a3f1a" />
      <rect x="0" y="2" width="1" height="2" fill="#7a3f1a" />
      <rect x="11" y="2" width="1" height="2" fill="#7a3f1a" />
      <rect x="0" y="8" width="1" height="2" fill="#7a3f1a" />
      <rect x="11" y="8" width="1" height="2" fill="#7a3f1a" />
      <rect x="1" y="10" width="2" height="1" fill="#7a3f1a" />
      <rect x="9" y="10" width="2" height="1" fill="#7a3f1a" />
      <rect x="3" y="11" width="6" height="1" fill="#7a3f1a" />

      {/* Coin body (mid amber) */}
      <rect x="3" y="1" width="6" height="1" fill="#d4871c" />
      <rect x="2" y="2" width="8" height="1" fill="#d4871c" />
      <rect x="1" y="3" width="10" height="1" fill="#d4871c" />
      <rect x="1" y="4" width="10" height="1" fill="#d4871c" />
      <rect x="1" y="5" width="10" height="1" fill="#d4871c" />
      <rect x="1" y="6" width="10" height="1" fill="#d4871c" />
      <rect x="1" y="7" width="10" height="1" fill="#d4871c" />
      <rect x="2" y="8" width="8" height="1" fill="#d4871c" />
      <rect x="3" y="9" width="6" height="1" fill="#d4871c" />
      <rect x="3" y="10" width="6" height="1" fill="#d4871c" />

      {/* Highlight (bright amber) */}
      <rect x="2" y="3" width="3" height="1" fill="#ffd97a" />
      <rect x="2" y="4" width="1" height="1" fill="#ffd97a" />

      {/* Center symbol — stylized "B" for Brew */}
      <rect x="5" y="3" width="3" height="1" fill="#7a3f1a" />
      <rect x="5" y="4" width="1" height="4" fill="#7a3f1a" />
      <rect x="5" y="5" width="3" height="1" fill="#7a3f1a" />
      <rect x="5" y="7" width="3" height="1" fill="#7a3f1a" />
      <rect x="7" y="4" width="1" height="1" fill="#7a3f1a" />
      <rect x="7" y="6" width="1" height="1" fill="#7a3f1a" />
    </svg>
  );
}
