'use client';

/**
 * Pixel-art potion brewing loading animation for the Generate page.
 *
 * A pixel-art cauldron bubbles with amber/gold potion, with small pixel
 * bubbles rising upward and fading out. Text below shows the action being
 * generated, the elapsed time, the job stage from the status poll, and a
 * per-mode expectation from GENERATION_WAIT_COPY. Pure CSS animation, no
 * canvas, no external libraries.
 *
 * IMPORTANT: Bubble/steam animations use inline `style.animation` instead of
 * Tailwind arbitrary syntax because each element has a unique duration that
 * Tailwind's `animate-[...]` can't handle dynamically (it doesn't resolve
 * CSS custom properties like `var(--dur)`).
 */

import { useEffect, useState } from 'react';
import { GENERATION_WAIT_COPY } from '@/lib/constants';

interface BrewingLoaderProps {
  /** e.g., "attack", "walk". If null, shows a generic message. */
  action?: string | null;
  /** Client start time persisted with the active job. Null until the poll
   *  starts; the loader's mount time stands in until then. */
  startedAt?: number | null;
  /** Last in-flight status from the poll. Null shows no stage. */
  serverStatus?: 'pending' | 'running' | null;
  /** The job's own mode. Falls back to `action ? 'animate' : 'create'`,
   *  which misreads a resumed animation whose action was not restored. */
  mode?: 'create' | 'animate' | null;
}

// The status route reads the job record from R2 first, which is strongly
// consistent, so the stage is current to within one poll. Set this to false
// if the route ever serves stage from KV alone again (KV lags up to 60s).
const SHOW_STAGE = true;

const STAGE_LABELS: Record<'pending' | 'running', string> = {
  pending: 'Queued',
  running: 'Painting frames',
};

/** 7s -> "0:07", 83s -> "1:23", 725s -> "12:05". */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

export default function BrewingLoader({
  action,
  startedAt = null,
  serverStatus = null,
  mode = null,
}: BrewingLoaderProps) {
  const label = action ? ACTION_LABELS[action] ?? action : null;
  const headline = label
    ? `Brewing your ${label} animation...`
    : mode === 'animate'
      ? 'Brewing your animation...'
      : 'Brewing your sprites...';

  // The loader mounts at the click, a moment before the poll's persisted
  // start lands, so the earlier of the two is the start: the counter never
  // steps back on a fresh job, and a resumed job keeps its original start.
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const origin = startedAt !== null ? Math.min(startedAt, mountedAt) : mountedAt;
  const elapsedMs = Math.max(0, now - origin);
  const stage = serverStatus ? STAGE_LABELS[serverStatus] : null;
  const waitCopy = GENERATION_WAIT_COPY[mode ?? (action ? 'animate' : 'create')];
  const expectation = waitCopy
    ? elapsedMs > waitCopy.longAfterMs
      ? waitCopy.long
      : waitCopy.usual
    : null;

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
          <rect x="5" y="8" width="22" height="14" fill="#2a2420" />
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

        {/* Bubbles — absolutely positioned, animated via inline style */}
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
            className="absolute rounded-sm"
            style={{
              left: b.left,
              bottom: 45,
              width: b.size,
              height: b.size,
              backgroundColor: '#d4871c',
              animation: `brewBubble ${b.dur}s ease-out ${b.delay}s infinite`,
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
            className="absolute w-2 h-2 rounded-full"
            style={{
              left: s.left,
              bottom: 70,
              backgroundColor: '#e8991f',
              animation: `brewSteam ${s.dur}s ease-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Status text */}
      <div className="text-center space-y-1">
        <p className="text-sm font-mono text-accent-amber font-semibold animate-pulse">
          {headline}
        </p>
        <p className="text-[10px] font-mono text-text-muted">
          <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>
          {SHOW_STAGE && stage && ` · ${stage}`}
        </p>
        {expectation && (
          <p className="text-[10px] font-mono text-text-muted">{expectation}</p>
        )}
      </div>
    </div>
  );
}
