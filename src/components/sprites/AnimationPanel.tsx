'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  Wand2,
  Check,
} from 'lucide-react';
import { ANIMATION_TYPES } from '@/lib/constants';
import { generateAnimationId } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteAnimation, SpriteFrame } from '@/lib/types';
import type { SlicerHints } from '@/lib/generationHistory';
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
  advanced_animation_walking: ['Walk'],
  advanced_animation_idle: ['Idle'],
  advanced_animation_attack: ['Attack'],
  advanced_animation_jump: ['Jump'],
  advanced_animation_crouch: ['Crouch'],
  advanced_animation_destroy: ['Death'],
  advanced_animation_subtle_motion: ['Subtle Motion'],
  advanced_animation_custom_action: ['Animation'],
};

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
  advanced_animation_crouch: ['crouch'],
  advanced_animation_destroy: ['death'],
  advanced_animation_subtle_motion: ['subtle'],
  advanced_animation_custom_action: ['custom'],
};

// ── Auto-assign helpers ──

type LayoutMode = 'directional' | 'single';

interface ProposedAnimation {
  name: string;
  type: string;
  fps: number;
  frameCount: number;
  frameIndices: [number, number]; // [startIdx, endIdx] into allFrames
}

/**
 * Compute proposed animation labels and frame splits.
 * Priority: sheetMetadata (when no layoutOverride) > any_animation_* > STYLE_ROW_NAMES >
 *           layoutOverride > selectedType default > heuristic.
 */
function computeAutoAssignProposal(
  allFrames: SpriteFrame[],
  columns: number,
  selectedTypeId: string,
  layoutOverride: LayoutMode | null,
  generationStyle: string | null,
  sheetMetadata: SlicerHints | null,
): ProposedAnimation[] {
  const rowCount = Math.ceil(allFrames.length / columns);
  const selectedType = ANIMATION_TYPES.find((t) => t.id === selectedTypeId);
  const typeLabel = selectedType?.label ?? selectedTypeId;

  // Priority 0: explicit sheet metadata from gallery handoff.
  // If the sheet carries a known animationType, use it to label the proposal,
  // regardless of what the Type dropdown currently shows.
  // User can still override via layoutOverride toggle.
  if (sheetMetadata?.animationType && !layoutOverride) {
    const metaType = ANIMATION_TYPES.find((t) => t.id === sheetMetadata.animationType);
    if (metaType) {
      if (!sheetMetadata.directional) {
        return [{
          name: metaType.label.toUpperCase(),
          type: metaType.id,
          fps: metaType.defaultFps,
          frameCount: allFrames.length,
          frameIndices: [0, allFrames.length],
        }];
      } else {
        const directions = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
        const result: ProposedAnimation[] = [];
        for (let r = 0; r < rowCount; r++) {
          const start = r * columns;
          const end = Math.min(start + columns, allFrames.length);
          if (end <= start) continue;
          const dir = r < directions.length ? directions[r] : `ROW ${r + 1}`;
          result.push({
            name: `${metaType.label.toUpperCase()} ${dir}`,
            type: metaType.id,
            fps: metaType.defaultFps,
            frameCount: end - start,
            frameIndices: [start, end],
          });
        }
        return result;
      }
    }
  }

  // Special case: known RD "Animate My Character" single-animation results
  if (generationStyle && generationStyle.startsWith('any_animation_')) {
    const action = generationStyle.replace('any_animation_', '');
    const nameMap: Record<string, { name: string; type: string; fps: number }> = {
      walking: { name: 'WALK', type: 'walk', fps: 8 },
      idle: { name: 'IDLE', type: 'idle', fps: 6 },
      attack: { name: 'ATTACK', type: 'attack', fps: 12 },
      jump: { name: 'JUMP', type: 'jump', fps: 10 },
      crouch: { name: 'CROUCH', type: 'crouch', fps: 6 },
      destroy: { name: 'DEATH', type: 'death', fps: 8 },
      subtle_motion: { name: 'SUBTLE MOTION', type: 'subtle', fps: 4 },
      custom_action: { name: 'ANIMATION', type: 'custom', fps: 8 },
    };
    const info = nameMap[action] ?? { name: 'ANIMATION', type: 'custom', fps: 8 };
    return [{
      name: info.name,
      type: info.type,
      fps: ANIMATION_TYPES.find((t) => t.id === info.type)?.defaultFps ?? info.fps,
      frameCount: allFrames.length,
      frameIndices: [0, allFrames.length],
    }];
  }

  // Known style row names take precedence (for Create New tab outputs)
  if (generationStyle && STYLE_ROW_NAMES[generationStyle]) {
    const rowNames = STYLE_ROW_NAMES[generationStyle];
    const rowTypes = STYLE_ROW_TYPES[generationStyle] ?? [];
    const result: ProposedAnimation[] = [];
    for (let r = 0; r < rowCount; r++) {
      const start = r * columns;
      const end = Math.min(start + columns, allFrames.length);
      if (end <= start) continue;
      const name = r < rowNames.length ? rowNames[r].toUpperCase() : `ROW ${r + 1}`;
      const type = r < rowTypes.length ? rowTypes[r] : 'walk';
      result.push({
        name,
        type,
        fps: ANIMATION_TYPES.find((t) => t.id === type)?.defaultFps ?? 8,
        frameCount: end - start,
        frameIndices: [start, end],
      });
    }
    return result;
  }

  // Determine layout: override > type default > heuristic
  let layout: LayoutMode;
  if (layoutOverride) {
    layout = layoutOverride;
  } else if (selectedType) {
    layout = selectedType.defaultDirectional ? 'directional' : 'single';
  } else {
    layout = (rowCount === 4 && allFrames.length % 4 === 0) ? 'directional' : 'single';
  }

  if (layout === 'single') {
    return [{
      name: typeLabel.toUpperCase(),
      type: selectedTypeId,
      fps: selectedType?.defaultFps ?? 8,
      frameCount: allFrames.length,
      frameIndices: [0, allFrames.length],
    }];
  }

  // Directional: split into 4 rows
  const directions = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
  const result: ProposedAnimation[] = [];
  for (let r = 0; r < rowCount; r++) {
    const start = r * columns;
    const end = Math.min(start + columns, allFrames.length);
    if (end <= start) continue;
    const dir = r < directions.length ? directions[r] : `ROW ${r + 1}`;
    result.push({
      name: `${typeLabel.toUpperCase()} ${dir}`,
      type: selectedTypeId,
      fps: selectedType?.defaultFps ?? 8,
      frameCount: end - start,
      frameIndices: [start, end],
    });
  }
  return result;
}

export default function AnimationPanel({ frameDataUrls }: AnimationPanelProps) {
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);
  const animations = useSpriteStore((s) => s.animations);
  const selectedFrames = useSpriteStore((s) => s.selectedFrames);
  const generationStyle = useSpriteStore((s) => s.generationStyle);
  const currentSheetMetadata = useSpriteStore((s) => s.currentSheetMetadata);
  const addAnimation = useSpriteStore((s) => s.addAnimation);
  const removeAnimation = useSpriteStore((s) => s.removeAnimation);
  const assignFramesToAnimation = useSpriteStore((s) => s.assignFramesToAnimation);
  const updateAnimationFps = useSpriteStore((s) => s.updateAnimationFps);
  const updateFrameOrder = useSpriteStore((s) => s.updateFrameOrder);

  const [selectedType, setSelectedType] = useState<string>(
    currentSheetMetadata?.animationType ?? ANIMATION_TYPES[0].id
  );
  const [customName, setCustomName] = useState('');
  const [layoutOverride, setLayoutOverride] = useState<LayoutMode | null>(null);
  const [autoAssignPreview, setAutoAssignPreview] = useState<ProposedAnimation[] | null>(null);
  const [nameManuallyEdited, setNameManuallyEdited] = useState<boolean[]>([]);

  // When sheet metadata arrives (gallery handoff), pre-select type and layout
  useEffect(() => {
    if (currentSheetMetadata) {
      const matchingType = ANIMATION_TYPES.find((t) => t.id === currentSheetMetadata.animationType);
      if (matchingType) {
        setSelectedType(matchingType.id);
      } else {
        console.warn(
          '[Slicer] Unknown animationType from gallery metadata:',
          currentSheetMetadata.animationType,
          '— Type dropdown unchanged. User can select manually or override in preview.'
        );
      }
      setLayoutOverride(currentSheetMetadata.directional ? 'directional' : 'single');
    }
  }, [currentSheetMetadata]);

  // When user changes Type dropdown, update layout to the type's default
  const handleTypeChange = useCallback((typeId: string) => {
    setSelectedType(typeId);
    const type = ANIMATION_TYPES.find((t) => t.id === typeId);
    if (type) {
      setLayoutOverride(type.defaultDirectional ? 'directional' : 'single');
    }
  }, []);

  // Compute effective layout for display
  const effectiveLayout: LayoutMode = (() => {
    if (layoutOverride) return layoutOverride;
    if (currentSheetMetadata) return currentSheetMetadata.directional ? 'directional' : 'single';
    const type = ANIMATION_TYPES.find((t) => t.id === selectedType);
    return type?.defaultDirectional ? 'directional' : 'single';
  })();

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

  // Show editable preview
  const handleAutoAssign = useCallback(() => {
    if (!spriteSheet) return;

    const allFrames = spriteSheet.animations.flatMap((a) => a.frames);
    const proposal = computeAutoAssignProposal(
      allFrames,
      spriteSheet.columns,
      selectedType,
      layoutOverride,
      generationStyle,
      currentSheetMetadata,
    );
    setAutoAssignPreview(proposal);
    setNameManuallyEdited(new Array(proposal.length).fill(false));
  }, [spriteSheet, selectedType, layoutOverride, generationStyle, currentSheetMetadata]);

  // Apply the preview
  const handleApplyAutoAssign = useCallback(() => {
    if (!spriteSheet || !autoAssignPreview) return;

    const allFrames = spriteSheet.animations.flatMap((a) => a.frames);
    for (const proposed of autoAssignPreview) {
      const frames = allFrames.slice(proposed.frameIndices[0], proposed.frameIndices[1]);
      const preset = ANIMATION_TYPES.find((t) => t.id === proposed.type);
      const anim: SpriteAnimation = {
        id: generateAnimationId(),
        name: proposed.name,
        type: preset?.id ?? proposed.type,
        frames,
        fps: proposed.fps,
        loop: true,
      };
      addAnimation(anim);
    }
    setAutoAssignPreview(null);
    setNameManuallyEdited([]);
  }, [spriteSheet, autoAssignPreview, addAnimation]);

  const handleCancelPreview = useCallback(() => {
    setAutoAssignPreview(null);
    setNameManuallyEdited([]);
  }, []);

  // ── Preview row editors ──

  const handlePreviewTypeChange = useCallback((rowIdx: number, newTypeId: string) => {
    setAutoAssignPreview((prev) => {
      if (!prev) return prev;
      const newPreview = [...prev];
      const currentRow = newPreview[rowIdx];
      const newType = ANIMATION_TYPES.find((t) => t.id === newTypeId);
      if (!newType) return prev;

      let newName = currentRow.name;
      if (!nameManuallyEdited[rowIdx]) {
        const directionMatch = currentRow.name.match(/\s(UP|RIGHT|DOWN|LEFT)$/);
        const suffix = directionMatch ? directionMatch[0] : '';
        newName = newType.label.toUpperCase() + suffix;
      }

      newPreview[rowIdx] = {
        ...currentRow,
        type: newTypeId,
        name: newName,
        fps: newType.defaultFps,
      };
      return newPreview;
    });
  }, [nameManuallyEdited]);

  const handlePreviewNameChange = useCallback((rowIdx: number, newName: string) => {
    setAutoAssignPreview((prev) => {
      if (!prev) return prev;
      const newPreview = [...prev];
      newPreview[rowIdx] = { ...newPreview[rowIdx], name: newName };
      return newPreview;
    });
    setNameManuallyEdited((prev) => {
      const updated = [...prev];
      updated[rowIdx] = true;
      return updated;
    });
  }, []);

  // ── Frame manipulation ──

  const handleRemoveFrame = useCallback(
    (animId: string, positionIdx: number) => {
      const anim = animations.find((a) => a.id === animId);
      if (!anim) return;
      const newFrames = anim.frames.filter((_, i) => i !== positionIdx);
      updateFrameOrder(animId, newFrames);
    },
    [animations, updateFrameOrder]
  );

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
      {/* Header row with Auto-assign + Layout toggle */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-xs font-mono text-text-secondary uppercase tracking-wider">
          Animations
        </label>
        {animations.length === 0 && !autoAssignPreview && (
          <div className="flex items-center gap-2">
            {/* Layout toggle */}
            <div className="flex gap-0.5 rounded bg-bg-elevated p-0.5">
              <button
                onClick={() => setLayoutOverride('directional')}
                className={`px-2 py-1 rounded text-[9px] font-mono cursor-pointer transition-colors ${
                  effectiveLayout === 'directional'
                    ? 'bg-accent-amber text-bg-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                4-Directional
              </button>
              <button
                onClick={() => setLayoutOverride('single')}
                className={`px-2 py-1 rounded text-[9px] font-mono cursor-pointer transition-colors ${
                  effectiveLayout === 'single'
                    ? 'bg-accent-amber text-bg-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                Single Animation
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={handleAutoAssign}>
              <Wand2 size={14} />
              Auto-assign
            </Button>
          </div>
        )}
      </div>

      {/* Auto-assign preview — editable */}
      {autoAssignPreview && (
        <div className="rounded-lg border border-accent-amber/30 bg-accent-amber-glow/30 p-4 space-y-3">
          <p className="text-[10px] font-mono text-text-secondary uppercase tracking-wider">
            Auto-assign will create these animations:
          </p>
          <div className="space-y-2">
            {autoAssignPreview.map((proposed, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 flex-wrap bg-bg-surface/50 rounded px-2 py-1.5 border border-border-subtle"
              >
                <span className="w-1 h-1 rounded-full bg-accent-amber flex-shrink-0" />
                <select
                  value={proposed.type}
                  onChange={(e) => handlePreviewTypeChange(idx, e.target.value)}
                  className="rounded bg-bg-elevated border border-border-default px-2 py-1
                    text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber cursor-pointer"
                  title="Animation type"
                >
                  {ANIMATION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={proposed.name}
                  onChange={(e) => handlePreviewNameChange(idx, e.target.value)}
                  className="flex-1 min-w-[100px] rounded bg-bg-elevated border border-border-default px-2 py-1
                    text-xs font-mono text-text-primary placeholder:text-text-muted
                    focus:outline-none focus:border-accent-amber"
                  title="Animation name"
                />
                <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
                  {proposed.frameCount} frame{proposed.frameCount !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={handleApplyAutoAssign}>
              <Check size={12} />
              Apply
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancelPreview}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Add animation form */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] font-mono text-text-muted mb-1">Type</label>
          <select
            value={selectedType}
            onChange={(e) => handleTypeChange(e.target.value)}
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

      {/* Empty state */}
      {animations.length === 0 && !autoAssignPreview && (
        <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-8 text-center">
          <p className="text-xs font-mono text-text-muted">
            No animation groups yet. Add one above, or use &quot;Auto-assign&quot; to
            create groups from sprite sheet rows.
          </p>
        </div>
      )}

      {/* Animation groups */}
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

                      <span className="absolute -bottom-1.5 left-0.5 text-[7px] font-mono text-text-muted leading-none">
                        {idx + 1}
                      </span>

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
