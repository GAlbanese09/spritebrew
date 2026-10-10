'use client';

import { useEffect, useRef, useState } from 'react';
import type { SheetLoopGeometry } from './SheetLoop';
import {
  createSequence,
  duplicate,
  move,
  remove,
  setFps,
  togglePingPong,
  LOOP_FPS_MAX,
  LOOP_FPS_MIN,
  type LoopSequence,
} from '@/lib/loopSequence';

/** Tile edge in CSS px; the frame is drawn at native size and scaled by CSS
 *  with nearest-neighbor rendering. */
const TILE_PX = 40;

// 44 px tap target on touch, compact from md up (the editor toolbar pattern).
const TAP = 'min-h-11 min-w-11 md:min-h-0 md:min-w-0';

const CHECKER = {
  backgroundImage:
    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
  backgroundSize: '6px 6px',
  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
};

interface LoopFrameStripProps {
  /** The sheet the loop plays (data URL or object URL). */
  src: string;
  geometry: SheetLoopGeometry;
  sequence: LoopSequence;
  onChange: (next: LoopSequence) => void;
}

/** One sheet frame on a canvas the size of the frame, scaled by CSS. */
function FrameTile({ img, geometry, index }: { img: HTMLImageElement | null; geometry: SheetLoopGeometry; index: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { frameW, frameH, cols } = geometry;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, frameW, frameH);
    if (!img) return;
    ctx.drawImage(img, (index % cols) * frameW, Math.floor(index / cols) * frameH, frameW, frameH, 0, 0, frameW, frameH);
  }, [img, index, frameW, frameH, cols]);

  return (
    <canvas
      ref={canvasRef}
      width={frameW}
      height={frameH}
      className="block pixel-art-render"
      style={{ width: TILE_PX, height: TILE_PX, imageRendering: 'pixelated', objectFit: 'contain', ...CHECKER }}
    />
  );
}

/**
 * Edits the playing loop of an Animate result: reorder, duplicate and
 * remove frames, set the speed, turn on ping-pong. Local to the result
 * card; the parent holds the sequence and passes it to SheetLoop.
 */
export default function LoopFrameStrip({ src, geometry, sequence, onChange }: LoopFrameStripProps) {
  const [loadedImg, setLoadedImg] = useState<{ src: string; img: HTMLImageElement } | null>(null);
  const img = loadedImg?.src === src ? loadedImg.img : null;

  // The selection belongs to the sequence object it was made on, so a reset
  // or a new generation (a new object from the parent) clears it.
  const [selection, setSelection] = useState<{ seq: LoopSequence; pos: number } | null>(null);
  const selected =
    selection && selection.seq === sequence && selection.pos < sequence.order.length ? selection.pos : null;

  useEffect(() => {
    let cancelled = false;
    const el = new Image();
    el.onload = () => {
      if (!cancelled) setLoadedImg({ src, img: el });
    };
    el.src = src;
    return () => {
      cancelled = true;
      el.onload = null;
    };
  }, [src]);

  const apply = (next: LoopSequence, pos: number | null) => {
    onChange(next);
    setSelection(pos === null ? null : { seq: next, pos });
  };

  const count = sequence.order.length;
  const n = selected === null ? null : selected + 1;
  const canEarlier = selected !== null && selected > 0;
  const canLater = selected !== null && selected < count - 1;
  const canDuplicate = selected !== null;
  const canRemove = selected !== null && count > 1;

  const actionClass = `${TAP} inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono
    bg-bg-elevated text-text-secondary border border-border-subtle hover:bg-bg-hover cursor-pointer transition-colors
    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-bg-elevated`;

  return (
    <div className="rounded border border-border-default bg-bg-elevated/50 p-3 space-y-3 min-w-0">
      {/* Tiles wrap so a long loop never widens the page. */}
      <div className="flex flex-wrap gap-1">
        {sequence.order.map((frame, pos) => {
          const isSelected = pos === selected;
          return (
            <button
              key={pos}
              type="button"
              onClick={() => setSelection(isSelected ? null : { seq: sequence, pos })}
              aria-pressed={isSelected}
              aria-label={`Frame ${pos + 1}`}
              className={`${TAP} inline-flex items-center justify-center p-0.5 rounded border cursor-pointer transition-colors
                ${isSelected
                  ? 'border-accent-amber bg-accent-amber/10'
                  : 'border-border-subtle hover:border-accent-amber/40'
                }`}
            >
              <FrameTile img={img} geometry={geometry} index={frame} />
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!canEarlier}
          onClick={() => selected !== null && apply(move(sequence, selected, -1), selected - 1)}
          aria-label={n === null ? undefined : `Move frame ${n} earlier`}
          className={actionClass}
        >
          Earlier
        </button>
        <button
          type="button"
          disabled={!canLater}
          onClick={() => selected !== null && apply(move(sequence, selected, 1), selected + 1)}
          aria-label={n === null ? undefined : `Move frame ${n} later`}
          className={actionClass}
        >
          Later
        </button>
        <button
          type="button"
          disabled={!canDuplicate}
          onClick={() => selected !== null && apply(duplicate(sequence, selected), selected + 1)}
          aria-label={n === null ? undefined : `Duplicate frame ${n}`}
          className={actionClass}
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={!canRemove}
          onClick={() =>
            selected !== null && apply(remove(sequence, selected), Math.min(selected, count - 2))
          }
          aria-label={n === null ? undefined : `Remove frame ${n}`}
          className={actionClass}
        >
          Remove
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label className={`${TAP} flex items-center gap-2 flex-1 min-w-[10rem]`}>
          <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Speed</span>
          <input
            type="range"
            min={LOOP_FPS_MIN}
            max={LOOP_FPS_MAX}
            step={1}
            value={sequence.fps}
            onChange={(e) => apply(setFps(sequence, Number(e.target.value)), selected)}
            className="flex-1 min-w-0 h-11 md:h-auto accent-[var(--accent-amber)] cursor-pointer"
          />
          <span className="text-[10px] font-mono text-text-secondary tabular-nums w-12 text-right">
            {sequence.fps} fps
          </span>
        </label>
        <button
          type="button"
          onClick={() => apply(togglePingPong(sequence), selected)}
          aria-pressed={sequence.pingPong}
          className={`${TAP} inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
            ${sequence.pingPong
              ? 'bg-accent-amber text-bg-primary'
              : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
            }`}
        >
          Ping-pong
        </button>
        <button
          type="button"
          onClick={() => apply(createSequence(geometry.frames), null)}
          className={actionClass}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
