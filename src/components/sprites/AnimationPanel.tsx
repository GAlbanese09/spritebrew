'use client';

import { useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  Wand2,
} from 'lucide-react';
import { ANIMATION_TYPES } from '@/lib/constants';
import { generateAnimationId } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteAnimation } from '@/lib/types';
import Button from '@/components/ui/Button';

interface AnimationPanelProps {
  frameDataUrls: Map<string, string>;
}

// Known Retro Diffusion style → row name mappings
const STYLE_ROW_NAMES: Record<string, string[]> = {
  four_angle_walking: ['Walk Down', 'Walk Up', 'Walk Right', 'Walk Left'],
  walking_and_idle: ['Walk Down', 'Walk Left', 'Walk Right', 'Walk Up', 'Idle Down', 'Idle Left', 'Idle Right', 'Idle Up'],
  small_sprites: ['Idle', 'Walk', 'Attack', 'Hurt'],
  any_animation: ['Animation'],
  '8_dir_rotation': ['Down', 'Down-Left', 'Left', 'Up-Left', 'Up', 'Up-Right', 'Right', 'Down-Right'],
  vfx: ['Effect'],
};

// Row type mappings for styles
const STYLE_ROW_TYPES: Record<string, string[]> = {
  four_angle_walking: ['walk', 'walk', 'walk', 'walk'],
  walking_and_idle: ['walk', 'walk', 'walk', 'walk', 'idle', 'idle', 'idle', 'idle'],
  small_sprites: ['idle', 'walk', 'attack', 'hurt'],
  any_animation: ['idle'],
  '8_dir_rotation': ['walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'walk'],
  vfx: ['idle'],
};

// Default row names by row count for user-uploaded sheets
function getDefaultRowNames(rowCount: number): string[] {
  switch (rowCount) {
    case 1: return ['Walk'];
    case 2: return ['Idle', 'Walk'];
    case 3: return ['Idle', 'Walk', 'Run'];
    case 4: return ['Walk Down', 'Walk Left', 'Walk Right', 'Walk Up'];
    case 8: return ['Walk Down', 'Walk Down-Left', 'Walk Left', 'Walk Up-Left', 'Walk Up', 'Walk Up-Right', 'Walk Right', 'Walk Down-Right'];
    default: return Array.from({ length: rowCount }, (_, i) => `Row ${i + 1}`);
  }
}

function getDefaultRowTypes(rowCount: number): string[] {
  switch (rowCount) {
    case 1: return ['walk'];
    case 2: return ['idle', 'walk'];
    case 3: return ['idle', 'walk', 'run'];
    case 4: return ['walk', 'walk', 'walk', 'walk'];
    case 8: return ['walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'walk'];
    default: return Array.from({ length: rowCount }, () => 'walk');
  }
}

export default function AnimationPanel({ frameDataUrls }: AnimationPanelProps) {
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);
  const animations = useSpriteStore((s) => s.animations);
  const selectedFrames = useSpriteStore((s) => s.selectedFrames);
  const generationStyle = useSpriteStore((s) => s.generationStyle);
  const addAnimation = useSpriteStore((s) => s.addAnimation);
  const removeAnimation = useSpriteStore((s) => s.removeAnimation);
  const assignFramesToAnimation = useSpriteStore((s) => s.assignFramesToAnimation);
  const updateAnimationFps = useSpriteStore((s) => s.updateAnimationFps);
  const updateFrameOrder = useSpriteStore((s) => s.updateFrameOrder);

  const [selectedType, setSelectedType] = useState<string>(ANIMATION_TYPES[0].id);
  const [customName, setCustomName] = useState('');

  const handleAddAnimation = useCallback(() => {
    const preset = ANIMATION_TYPES.find((t) => t.id === selectedType);
    const name = customName.trim() || preset?.label || selectedType;
    const fps = preset?.defaultFps ?? 8;

    const anim: SpriteAnimation = {
      id: generateAnimationId(),
      name,
      type: selectedType,
      frames: [],
      fps,
      loop: true,
    };

    addAnimation(anim);
    setCustomName('');
  }, [selectedType, customName, addAnimation]);

  const handleAutoAssign = useCallback(() => {
    if (!spriteSheet) return;

    const allFrames = spriteSheet.animations.flatMap((a) => a.frames);
    const { columns } = spriteSheet;
    const rowCount = Math.ceil(allFrames.length / columns);

    // Determine row names and types based on generation style or row count
    let rowNames: string[];
    let rowTypes: string[];

    if (generationStyle && STYLE_ROW_NAMES[generationStyle]) {
      rowNames = STYLE_ROW_NAMES[generationStyle];
      rowTypes = STYLE_ROW_TYPES[generationStyle] ?? getDefaultRowTypes(rowCount);
    } else {
      rowNames = getDefaultRowNames(rowCount);
      rowTypes = getDefaultRowTypes(rowCount);
    }

    for (let r = 0; r < rowCount; r++) {
      const rowFrames = allFrames.slice(r * columns, (r + 1) * columns);
      if (rowFrames.length === 0) continue;

      const name = r < rowNames.length ? rowNames[r] : `Row ${r + 1}`;
      const type = r < rowTypes.length ? rowTypes[r] : 'walk';
      const preset = ANIMATION_TYPES.find((t) => t.id === type);

      const anim: SpriteAnimation = {
        id: generateAnimationId(),
        name,
        type: preset?.id ?? type,
        frames: rowFrames,
        fps: preset?.defaultFps ?? 8,
        loop: true,
      };
      addAnimation(anim);
    }
  }, [spriteSheet, generationStyle, addAnimation]);

  const handleRemoveFrame = useCallback(
    (animId: string, frameId: string) => {
      const anim = animations.find((a) => a.id === animId);
      if (!anim) return;
      const newOrder = anim.frames.filter((f) => f.id !== frameId).map((f) => f.id);
      updateFrameOrder(animId, newOrder);
    },
    [animations, updateFrameOrder]
  );

  const handleMoveFrame = useCallback(
    (animId: string, frameIdx: number, direction: -1 | 1) => {
      const anim = animations.find((a) => a.id === animId);
      if (!anim) return;
      const ids = anim.frames.map((f) => f.id);
      const targetIdx = frameIdx + direction;
      if (targetIdx < 0 || targetIdx >= ids.length) return;
      [ids[frameIdx], ids[targetIdx]] = [ids[targetIdx], ids[frameIdx]];
      updateFrameOrder(animId, ids);
    },
    [animations, updateFrameOrder]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <label className="text-xs font-mono text-text-secondary uppercase tracking-wider">
          Animations
        </label>
        {animations.length === 0 && (
          <Button variant="ghost" size="sm" onClick={handleAutoAssign}>
            <Wand2 size={14} />
            Auto-assign rows
          </Button>
        )}
      </div>

      {/* Add animation form */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] font-mono text-text-muted mb-1">Type</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
              text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber cursor-pointer"
          >
            {ANIMATION_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} — {t.description}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] font-mono text-text-muted mb-1">
            Custom name (optional)
          </label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="e.g. Walk Left"
            className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
              text-sm font-mono text-text-primary placeholder:text-text-muted
              focus:outline-none focus:border-accent-amber"
          />
        </div>
        <Button variant="secondary" size="md" onClick={handleAddAnimation}>
          <Plus size={14} />
          Add
        </Button>
      </div>

      {/* Animation groups */}
      {animations.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-8 text-center">
          <p className="text-xs font-mono text-text-muted">
            No animation groups yet. Add one above, or use &quot;Auto-assign rows&quot; to
            create groups from sprite sheet rows.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {animations.map((anim) => (
          <div
            key={anim.id}
            className="rounded-lg border border-border-default bg-bg-surface p-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-mono font-semibold text-text-primary">
                  {anim.name}
                </h3>
                <span className="text-[10px] font-mono text-text-muted">
                  {anim.frames.length} frame{anim.frames.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selectedFrames.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => assignFramesToAnimation(anim.id, selectedFrames)}
                  >
                    Assign {selectedFrames.length}
                  </Button>
                )}
                <button
                  onClick={() => removeAnimation(anim.id)}
                  className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-400/10 cursor-pointer"
                  title="Delete group"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* FPS control */}
            <div className="flex items-center gap-3 mb-3">
              <label className="text-[10px] font-mono text-text-muted">FPS</label>
              <input
                type="range"
                min={1}
                max={30}
                value={anim.fps}
                onChange={(e) => updateAnimationFps(anim.id, Number(e.target.value))}
                className="flex-1 accent-[var(--accent-amber)]"
              />
              <input
                type="number"
                min={1}
                max={30}
                value={anim.fps}
                onChange={(e) =>
                  updateAnimationFps(anim.id, Math.min(30, Math.max(1, Number(e.target.value))))
                }
                className="w-14 rounded bg-bg-elevated border border-border-default px-2 py-1
                  text-xs font-mono text-text-primary text-center focus:outline-none focus:border-accent-amber"
              />
            </div>

            {/* Frame thumbnails */}
            {anim.frames.length === 0 ? (
              <p className="text-[10px] font-mono text-text-muted py-2">
                Select frames in the grid above, then click &quot;Assign&quot;.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {anim.frames.map((frame, idx) => {
                  const dataUrl = frameDataUrls.get(frame.id);
                  return (
                    <div
                      key={frame.id}
                      className="group relative rounded border border-border-subtle bg-bg-elevated"
                    >
                      <div
                        className="w-10 h-10 overflow-hidden rounded"
                        style={{
                          backgroundImage:
                            'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
                          backgroundSize: '6px 6px',
                          backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
                          backgroundColor: '#fff',
                        }}
                      >
                        {dataUrl && (
                          <img
                            src={dataUrl}
                            alt={`Frame ${idx}`}
                            className="w-full h-full object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        )}
                      </div>

                      {/* Reorder + remove controls (visible on hover) */}
                      <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5">
                        {idx > 0 && (
                          <button
                            onClick={() => handleMoveFrame(anim.id, idx, -1)}
                            className="w-4 h-4 flex items-center justify-center rounded-full bg-bg-primary border border-border-default text-text-muted hover:text-text-primary cursor-pointer"
                          >
                            <ChevronUp size={10} />
                          </button>
                        )}
                        {idx < anim.frames.length - 1 && (
                          <button
                            onClick={() => handleMoveFrame(anim.id, idx, 1)}
                            className="w-4 h-4 flex items-center justify-center rounded-full bg-bg-primary border border-border-default text-text-muted hover:text-text-primary cursor-pointer"
                          >
                            <ChevronDown size={10} />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveFrame(anim.id, frame.id)}
                          className="w-4 h-4 flex items-center justify-center rounded-full bg-bg-primary border border-border-default text-text-muted hover:text-red-400 cursor-pointer"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
