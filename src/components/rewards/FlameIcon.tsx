/**
 * Pixel-art flame icon. Inline SVG so it inherits `pixel-art-render` and
 * doesn't get replaced by the OS emoji renderer (which would look like Slack).
 *
 * 8×10 source grid; size prop scales the SVG box but the rects stay integer-pixel.
 */
interface FlameIconProps {
  size?: number;
  className?: string;
  /** Slightly desaturated palette for muted/streak-broken display. */
  muted?: boolean;
}

export default function FlameIcon({ size = 12, className, muted = false }: FlameIconProps) {
  const outer = muted ? '#7a3f1a' : '#e8991f';
  const middle = muted ? '#a8521e' : '#ff6b1a';
  const inner = muted ? '#d4871c' : '#ffcc33';
  const tip = muted ? '#fff5dd' : '#fff5b8';

  return (
    <svg
      width={size}
      height={Math.round(size * 1.25)}
      viewBox="0 0 8 10"
      xmlns="http://www.w3.org/2000/svg"
      className={`pixel-art-render inline-block ${className ?? ''}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Outer flame outline */}
      <rect x="3" y="0" width="2" height="1" fill={outer} />
      <rect x="2" y="1" width="4" height="1" fill={outer} />
      <rect x="1" y="2" width="6" height="1" fill={outer} />
      <rect x="1" y="3" width="6" height="1" fill={outer} />
      <rect x="0" y="4" width="8" height="1" fill={outer} />
      <rect x="0" y="5" width="8" height="1" fill={outer} />
      <rect x="0" y="6" width="8" height="1" fill={outer} />
      <rect x="1" y="7" width="6" height="1" fill={outer} />
      <rect x="1" y="8" width="6" height="1" fill={outer} />
      <rect x="2" y="9" width="4" height="1" fill={outer} />

      {/* Middle warmth */}
      <rect x="3" y="2" width="2" height="1" fill={middle} />
      <rect x="2" y="3" width="4" height="1" fill={middle} />
      <rect x="1" y="4" width="6" height="1" fill={middle} />
      <rect x="1" y="5" width="6" height="1" fill={middle} />
      <rect x="2" y="6" width="4" height="1" fill={middle} />
      <rect x="2" y="7" width="4" height="1" fill={middle} />
      <rect x="3" y="8" width="2" height="1" fill={middle} />

      {/* Inner core */}
      <rect x="3" y="4" width="2" height="1" fill={inner} />
      <rect x="2" y="5" width="4" height="1" fill={inner} />
      <rect x="3" y="6" width="2" height="1" fill={inner} />

      {/* Hottest tip highlight */}
      <rect x="3" y="5" width="2" height="1" fill={tip} />
    </svg>
  );
}
