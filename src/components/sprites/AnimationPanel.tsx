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
  four_angle_walking: ['Walk Up', 'Walk Right', 'Walk Down', 'Walk Left'],
  walking_and_idle: ['Walk Down', 'Walk Left', 'Walk Right', 'Walk Up', 'Idle Down', 'Idle Left', 'Idle Right', 'Idle Up'],
  small_sprites: ['Idle', 'Walk', 'Attack', 'Hurt'],
  any_animation: ['Animation'],
  '8_dir_rotation': ['Down', 'Down-Left', 'Left', 'Up-Left', 'Up', 'Up-Right', 'Right', 'Down-Right'],
  vfx: ['Effect'],
  // Advanced animation styles — single-direction strips
  advanced_animation_walking: ['Walk'],
  advanced_animation_idle: ['Idle'],
  advanced_animation_attack: ['Attack'],
  advanced_animation_jump: ['Jump'],
  advanced_animation_crouch: ['Crouch'],
  advanced_animation_destroy: ['Death'],
  advanced_animation_subtle_motion: ['Subtle Motion'],
  advanced_animation_custom_action: ['Animation'],
};

// Row type mappings for styles
const STYLE_ROW_TYPES: Record<string, string[]> = {
  four_angle_walking: ['walk', 'walk', 'walk', 'walk'],
  walking_and_idle: ['walk', 'walk', 'walk', 'walk', 'idle', 'idle', 'idle', 'idle'],
  small_sprites: ['idle', 'walk', 'attack', 'hurt'],
  any_animation: ['idle'],
  '8_dir_rotation': ['walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'walk'],
  vfx: ['idle'],
  advanced_animation_walking: ['walk'],
  advanced_animation_idle: ['idle'],
  advanced_animation_attack: ['attack'],
  advanced_animation_jump: ['jump'],
  advanced_animation_crouch: ['idle'],
  advanced_animation_destroy: ['death'],
  advanced_animation_subtle_motion: ['idle'],
  advanced_animation_custom_action: ['idle'],
};

// Default row names by row count for user-uploaded sheets
function getDefaultRowNames(rowCount: number): string[] {
  switch (rowCount) {
    case 1: return ['Walk'];
    case 2: return ['Idle', 'Walk'];
    case 3: return ['Idle', 'Walk', 'Run'];
    case 4: return ['Walk Up', 'Walk Right', 'Walk Down', 'Walk Left'];
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

    // Special case: "Animate My Character" results (any_animation_{action}) are
    // a single-animation sheet. Put ALL frames into one group named after the action.
    if (generationStyle && generationStyle.startsWith('any_animation_')) {
      const action = generationStyle.replace('any_animation_', '');
      const nameMap: Record<string, { name: string; type: string; fps: number }> = {
        walking: { name: 'Walking', type: 'walk', fps: 8 },
        idle: { name: 'Idle', type: 'idle', fps: 6 },
        attack: { name: 'Attack', type: 'attack', fps: 12 },
        jump: { name: 'Jump', type: 'jump', fps: 10 },
        crouch: { name: 'Crouch', type: 'idle', fps: 6 },
        destroy: { name: 'Death', type: 'death', fps: 8 },
        subtle_motion: { name: 'Subtle Motion', type: 'idle', fps: 4 },
        custom_action: { name: 'Animation', type: 'idle', fps: 8 },
      };
      const info = nameMap[action] ?? { name: 'Animation', type: 'idle', fps: 8 };
      const preset = ANIMATION_TYPES.find((t) => t.id === info.type);

      const anim: SpriteAnimation = {
        id: generateAnimationId(),
        name: info.name,
        type: preset?.id ?? info.type,
        frames: allFrames,
        fps: preset?.defaultFps ?? info.fps,
        loop: true,
      };
      addAnimation(anim);
      return;
    }

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

  // Remove by position index (not by frame ID) so removing one instance of a
  // duplicated frame doesn't remove all instances.
  const handleRemoveFrame = useCallback(
    (animId: string, positionIdx: number) => {
      const anim = animations.find((a) => a.id === animId);
      if (!anim) return;
      const newFrames = anim.frames.filter((_, i) => i !== positionIdx);
      updateFrameOrder(animId, newFrames);
    },
    [animations, updateFrameOrder]
  );

  // Swap by position index — works correctly even with duplicate frame IDs.
  const handleMoveFrame = useCallback(
    (animId: string, frameIdx: number, direction: -1 | 1) => {
      const anim = animations.find((a) => a.id === animId);
      if (!anim) return;
      const newFrames = [...anim.frames];
      const targetIdx = frameIdx + direction;
      if (targetIdx < 0 || targetIdx >= newFrames.length) return;
      [newFrames[frameIdx], newFrames[targetIdx]] = [newFrames[targetIdx], newFrames[frameIdx]];
      updateFrameOrder(animId, newFrames);
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
                      key={`${idx}-${frame.id}`}
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

                      {/* Position number (visible when duplicates exist or always for clarity) */}
                      <span className="absolute -bottom-1.5 left-0.5 text-[7px] font-mono text-text-muted leading-none">
                        {idx + 1}
                      </span>

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
                          onClick={() => handleRemoveFrame(anim.id, idx)}
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
