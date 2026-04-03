'use client';

import { useCallback } from 'react';
import { useSpriteStore } from '@/stores/spriteStore';

interface FrameGridProps {
  /** Map from frame ID → data URL for display */
  frameDataUrls: Map<string, string>;
}

export default function FrameGrid({ frameDataUrls }: FrameGridProps) {
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);
  const selectedFrames = useSpriteStore((s) => s.selectedFrames);
  const setSelectedFrames = useSpriteStore((s) => s.setSelectedFrames);
  const toggleFrameSelection = useSpriteStore((s) => s.toggleFrameSelection);

  const allFrames = spriteSheet?.animations.flatMap((a) => a.frames) ?? [];

  const handleFrameClick = useCallback(
    (frameId: string, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && selectedFrames.length > 0) {
        // Range select
        const lastSelected = selectedFrames[selectedFrames.length - 1];
        const lastIdx = allFrames.findIndex((f) => f.id === lastSelected);
        const start = Math.min(lastIdx, index);
        const end = Math.max(lastIdx, index);
        const rangeIds = allFrames.slice(start, end + 1).map((f) => f.id);
        // Merge with existing selection
        const merged = new Set([...selectedFrames, ...rangeIds]);
        setSelectedFrames(Array.from(merged));
      } else if (e.ctrlKey || e.metaKey) {
        // Toggle individual
        toggleFrameSelection(frameId);
      } else {
        // Single select
        setSelectedFrames([frameId]);
      }
    },
    [allFrames, selectedFrames, setSelectedFrames, toggleFrameSelection]
  );

  if (allFrames.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="text-xs font-mono text-text-secondary uppercase tracking-wider">
          Frames
        </label>
        <div className="flex items-center gap-3">
          {selectedFrames.length > 0 && (
            <span className="text-xs font-mono text-accent-amber">
              {selectedFrames.length} selected
            </span>
          )}
          <button
            onClick={() => setSelectedFrames(allFrames.map((f) => f.id))}
            className="text-[10px] font-mono text-text-muted hover:text-text-primary cursor-pointer"
          >
            Select all
          </button>
          {selectedFrames.length > 0 && (
            <button
              onClick={() => setSelectedFrames([])}
              className="text-[10px] font-mono text-text-muted hover:text-text-primary cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>
        {allFrames.map((frame, idx) => {
          const selected = selectedFrames.includes(frame.id);
          const dataUrl = frameDataUrls.get(frame.id);

          return (
            <button
              key={frame.id}
              onClick={(e) => handleFrameClick(frame.id, idx, e)}
              className={`
                group flex flex-col items-center rounded p-1 transition-all duration-100 cursor-pointer
                ${
                  selected
                    ? 'ring-2 ring-accent-amber bg-accent-amber-glow'
                    : 'hover:bg-bg-hover'
                }
              `}
            >
              {/* Checkerboard + frame */}
              <div
                className="relative w-16 h-16 rounded border overflow-hidden"
                style={{
                  borderColor: selected
                    ? 'var(--accent-amber)'
                    : 'rgba(255,255,255,0.1)',
                  backgroundImage:
                    'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                  backgroundColor: '#fff',
                }}
              >
                {dataUrl && (
                  <img
                    src={dataUrl}
                    alt={`Frame ${idx}`}
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                )}
              </div>
              <span
                className={`mt-1 text-[10px] font-mono ${
                  selected ? 'text-accent-amber' : 'text-text-muted group-hover:text-text-secondary'
                }`}
              >
                {idx}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] font-mono text-text-muted">
        Click to select &middot; Shift+click for range &middot; Ctrl+click to toggle
      </p>
    </div>
  );
}
