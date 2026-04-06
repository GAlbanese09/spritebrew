'use client';

/**
 * Pixel-art potion brewing loading animation for the Generate page.
 *
 * A pixel-art cauldron bubbles with amber/gold potion, with small pixel
 * bubbles rising upward and fading out. Text below shows the action being
 * generated. Pure CSS animation — no canvas, no external libraries.
 */

interface BrewingLoaderProps {
  /** e.g., "attack", "walk". If null, shows a generic message. */
  action?: string | null;
}

/** Map action IDs to human-readable labels for the loading message. */
const ACTION_LABELS: Record<string, string> = {
  walking: 'walk',
  idle: 'idle',
  attack: 'attack',
  jump: 'jump',
  crouch: 'crouch',
  destroy: 'destroy',
  subtle_motion: 'subtle motion',
  custom_action: 'custom',
};

export default function BrewingLoader({ action }: BrewingLoaderProps) {
  const label = action ? ACTION_LABELS[action] ?? action : null;

  return (
    <div className="flex flex-col items-center justify-center py-10 space-y-5">
      {/* Pixel art cauldron with bubbles */}
      <div className="relative w-[120px] h-[140px]">
        {/* Cauldron body (SVG pixel art) */}
        <svg
          viewBox="0 0 32 28"
          width="120"
          height="105"
          className="absolute bottom-0 left-0"
          style={{ imageRendering: 'pixelated' }}
        >
          {/* Cauldron rim */}
          <rect x="4" y="6" width="24" height="2" fill="#5c5550" />
          <rect x="3" y="7" width="1" height="2" fill="#5c5550" />
          <rect x="28" y="7" width="1" height="2" fill="#5c5550" />
          {/* Cauldron body */}
          <rect x="5" y="8" width="22" height="14" rx="0" fill="#2a2420" />
          <rect x="6" y="22" width="20" height="2" fill="#2a2420" />
          <rect x="8" y="24" width="16" height="2" fill="#2a2420" />
          <rect x="10" y="26" width="12" height="2" fill="#1e1a16" />
          {/* Cauldron highlight (left edge) */}
          <rect x="5" y="9" width="1" height="10" fill="#3a3430" />
          {/* Potion liquid surface */}
          <rect x="6" y="10" width="20" height="2" fill="#e8991f" />
          {/* Potion body */}
          <rect x="6" y="12" width="20" height="10" fill="#d4871c" />
          <rect x="7" y="22" width="18" height="1" fill="#b07018" />
          {/* Liquid shimmer */}
          <rect x="10" y="11" width="4" height="1" fill="#f0b040" opacity="0.7" />
          <rect x="18" y="11" width="3" height="1" fill="#f0b040" opacity="0.5" />
          {/* Legs */}
          <rect x="8" y="26" width="2" height="2" fill="#3a3430" />
          <rect x="22" y="26" width="2" height="2" fill="#3a3430" />
        </svg>

        {/* Bubbles — absolutely positioned, animated */}
        {[
          { left: 30, size: 6, delay: 0, dur: 2.2 },
          { left: 55, size: 8, delay: 0.6, dur: 2.5 },
          { left: 75, size: 5, delay: 1.2, dur: 2.0 },
          { left: 42, size: 7, delay: 1.8, dur: 2.8 },
          { left: 65, size: 4, delay: 0.3, dur: 1.9 },
          { left: 48, size: 6, delay: 2.4, dur: 2.3 },
          { left: 85, size: 5, delay: 1.0, dur: 2.1 },
        ].map((b, i) => (
          <div
            key={i}
            className="absolute rounded-sm animate-[brewBubble_var(--dur)_ease-out_infinite]"
            style={{
              left: b.left,
              bottom: 45,
              width: b.size,
              height: b.size,
              backgroundColor: 'var(--accent-amber)',
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.dur}s`,
            }}
          />
        ))}

        {/* Steam / sparkle particles */}
        {[
          { left: 35, delay: 0.5, dur: 3.0 },
          { left: 60, delay: 1.5, dur: 3.5 },
          { left: 80, delay: 2.5, dur: 3.2 },
        ].map((s, i) => (
          <div
            key={`s${i}`}
            className="absolute w-2 h-2 rounded-full animate-[brewSteam_var(--dur)_ease-out_infinite]"
            style={{
              left: s.left,
              bottom: 70,
              backgroundColor: 'var(--accent-amber)',
              opacity: 0,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.dur}s`,
            }}
          />
        ))}
      </div>

      {/* Status text */}
      <div className="text-center space-y-1">
        <p className="text-sm font-mono text-accent-amber font-semibold animate-pulse">
          {label
            ? `Brewing your ${label} animation...`
            : 'Brewing your sprites...'}
        </p>
        <p className="text-[10px] font-mono text-text-muted">
          This usually takes 15-30 seconds
        </p>
      </div>
    </div>
  );
}
