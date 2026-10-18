'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  Wand2,
  Check,
  Pencil,
} from 'lucide-react';
import { ANIMATION_TYPES } from '@/lib/constants';
import { generateAnimationId } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteAnimation, SpriteFrame } from '@/lib/types';
import type { SlicerHints } from '@/lib/generationHistory';
import { resolveStyleRowKey } from '@/lib/styleRowKey';
import Button from '@/components/ui/Button';
import {
  DRAG_TILE_STYLE,
  FrameDragLayer,
  startFrameDrag,
  useFrameDrag,
  useLastFrameDrop,
} from './frameDrag';
import { animationPreset, defaultAnimationType, nextAnimationName } from '@/lib/animationNames';

// Per-frame move and remove buttons in a group's strip.
const FRAME_CONTROL_CLASS =
  'w-5 h-5 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded border border-border-default bg-bg-primary text-text-muted cursor-pointer disabled:opacity-30 disabled:cursor-default';

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
  const styleRowKey = generationStyle ? resolveStyleRowKey(generationStyle) : null;
  if (styleRowKey && STYLE_ROW_NAMES[styleRowKey]) {
    const rowNames = STYLE_ROW_NAMES[styleRowKey];
    const rowTypes = STYLE_ROW_TYPES[styleRowKey] ?? [];
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

/** A grid frame is being dragged, so the new-animation zone can take it. */
function canTargetNew(drag: ReturnType<typeof useFrameDrag>): boolean {
  return drag?.source.kind === 'grid';
}

/** The card can take the current drag: any grid frame, or a reorder of its
 *  own frames. */
function canTargetCard(drag: ReturnType<typeof useFrameDrag>, animId: string): boolean {
  if (!drag) return false;
  return drag.source.kind === 'grid' || drag.source.animId === animId;
}

/** Border and glow for the new-animation zone: lit while a grid frame is
 *  dragged anywhere, solid under the pointer, dashed and quiet at rest. */
function newZoneClass(drag: ReturnType<typeof useFrameDrag>, isOver: boolean): string {
  if (isOver) return 'border-accent-amber bg-accent-amber-glow/40 ring-2 ring-accent-amber/40';
  if (canTargetNew(drag)) return 'border-dashed border-accent-amber/70 bg-accent-amber-glow/20 shadow-[0_0_12px_var(--accent-amber-glow)]';
  return 'border-dashed border-border-default bg-bg-surface';
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

  const updateAnimationMeta = useSpriteStore((s) => s.updateAnimationMeta);
  const setSelectedFrames = useSpriteStore((s) => s.setSelectedFrames);

  // The type a new animation gets: the sheet's own type when the slicer was
  // handed one, else Idle. Each animation's type is edited on its card.
  const selectedType = useMemo(() => defaultAnimationType(currentSheetMetadata), [currentSheetMetadata]);
  const [layoutOverride, setLayoutOverride] = useState<LayoutMode | null>(null);
  const [autoAssignPreview, setAutoAssignPreview] = useState<ProposedAnimation[] | null>(null);
  const [nameManuallyEdited, setNameManuallyEdited] = useState<boolean[]>([]);
  const drag = useFrameDrag();
  const lastDrop = useLastFrameDrop();
  // The animation whose name is being edited, and the text so far.
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  // Sheet metadata (gallery handoff) with a type the slicer does not know:
  // new animations default to Idle, and each card has its own type.
  useEffect(() => {
    if (currentSheetMetadata && !ANIMATION_TYPES.some((t) => t.id === currentSheetMetadata.animationType)) {
      console.warn(
        '[Slicer] Unknown animationType from gallery metadata:',
        currentSheetMetadata.animationType,
        '. New animations default to Idle; each card has its own type.'
      );
    }
  }, [currentSheetMetadata]);

  // Layout for Auto-assign: the toggle, else the sheet's own layout, else
  // the default type's.
  const effectiveLayout: LayoutMode = (() => {
    if (layoutOverride) return layoutOverride;
    if (currentSheetMetadata) return currentSheetMetadata.directional ? 'directional' : 'single';
    return animationPreset(selectedType).defaultDirectional ? 'directional' : 'single';
  })();

  const allFrames = useMemo(
    () => spriteSheet?.animations.flatMap((a) => a.frames) ?? [],
    [spriteSheet]
  );

  /** A new animation of the default type, named "Idle", "Idle 2", ... */
  const makeAnimation = useCallback(
    (frames: SpriteFrame[]): SpriteAnimation => {
      const preset = animationPreset(selectedType);
      return {
        id: generateAnimationId(),
        name: nextAnimationName(preset.label, animations.map((a) => a.name)),
        type: selectedType,
        frames,
        fps: preset.defaultFps,
        loop: true,
      };
    },
    [selectedType, animations]
  );

  const handleNewAnimation = useCallback(() => {
    addAnimation(makeAnimation([]));
  }, [addAnimation, makeAnimation]);

  const handleUseAllFrames = useCallback(() => {
    if (allFrames.length === 0) return;
    addAnimation(makeAnimation([...allFrames]));
  }, [allFrames, addAnimation, makeAnimation]);

  const handleNewFromSelection = useCallback(() => {
    const picked = allFrames.filter((f) => selectedFrames.includes(f.id));
    if (picked.length === 0) return;
    addAnimation(makeAnimation(picked));
    setSelectedFrames([]);
  }, [allFrames, selectedFrames, addAnimation, makeAnimation, setSelectedFrames]);

  const startRename = useCallback((anim: SpriteAnimation) => {
    setRenaming({ id: anim.id, value: anim.name });
  }, []);

  const commitRename = useCallback(() => {
    if (!renaming) return;
    const name = renaming.value.trim();
    if (name) updateAnimationMeta(renaming.id, { name });
    setRenaming(null);
  }, [renaming, updateAnimationMeta]);

  // What screen readers hear after the last drop: the frame's grid number
  // and the animation. Derived, so each drop changes the live region once.
  const announcement = useMemo(() => {
    if (!lastDrop) return '';
    const anim = animations.find((a) => a.id === lastDrop.animId);
    if (!anim) return '';
    const n = allFrames.findIndex((f) => f.id === lastDrop.frameId) + 1;
    return lastDrop.created
      ? `Created ${anim.name} with frame ${n}.`
      : `Added frame ${n} to ${anim.name}. ${anim.frames.length} frame${anim.frames.length === 1 ? '' : 's'}.`;
  }, [lastDrop, animations, allFrames]);

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

  const dragging = drag !== null;
  const isOverNew = drag?.target?.kind === 'new';

  return (
    <div className="space-y-6">
      {/* Header row: label and New animation */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="text-xs font-mono text-text-secondary uppercase tracking-wider">
          Animations
        </label>
        <Button variant="secondary" size="sm" onClick={handleNewAnimation}>
          <Plus size={14} />
          New animation
        </Button>
      </div>

      {/* Auto-assign preview, editable */}
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

      {/* Empty state: the first animation's drop zone, with the one-click
          ways to start. A grid frame dropped here starts an animation. */}
      {animations.length === 0 && !autoAssignPreview && (
        <div
          data-frame-drop-new
          className={`rounded-lg border p-6 text-center space-y-4 transition-colors ${newZoneClass(drag, isOverNew)}`}
        >
          <p className="text-xs font-mono text-text-secondary">
            {isOverNew
              ? `Release to create ${animationPreset(selectedType).label}`
              : dragging
                ? 'Drop to start a new animation'
                : 'Drag frames here to make your first animation'}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={handleUseAllFrames} disabled={allFrames.length === 0}>
              Use all {allFrames.length} frame{allFrames.length === 1 ? '' : 's'}
            </Button>
            {selectedFrames.length > 0 && (
              <Button variant="secondary" size="sm" onClick={handleNewFromSelection}>
                New animation from {selectedFrames.length} selected
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleAutoAssign} title="Make one animation per row">
              <Wand2 size={14} />
              Auto-assign
            </Button>
            {/* Layout toggle for Auto-assign */}
            <div className="flex gap-0.5 rounded bg-bg-elevated p-0.5">
              <button
                type="button"
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
                type="button"
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
          </div>
          <p className="text-[10px] font-mono text-text-muted">
            You can rename it and change its type any time.
          </p>
        </div>
      )}

      {/* Animation cards */}
      <div className="space-y-3">
        {animations.map((anim) => {
          const isTarget = drag?.target?.kind === 'anim' && drag.target.animId === anim.id;
          const dropHere = lastDrop && lastDrop.animId === anim.id ? lastDrop : null;
          const isRenaming = renaming?.id === anim.id;
          return (
          // The whole card is a drop target for frames dragged from the
          // Frames grid, and for reordering this group's own frames.
          <div
            key={anim.id}
            data-frame-drop-anim={anim.id}
            className={`relative rounded-lg border bg-bg-surface p-4 transition-colors ${
              isTarget
                ? 'border-accent-amber ring-2 ring-accent-amber/40'
                : dragging && canTargetCard(drag, anim.id)
                  ? 'border-dashed border-accent-amber/70 shadow-[0_0_12px_var(--accent-amber-glow)]'
                  : 'border-border-default'
            } ${dropHere?.created ? 'motion-safe:animate-[frameDropIn_150ms_ease-out]' : ''}`}
          >
            {/* One flash per drop, restarted by its timestamp */}
            {dropHere && !dropHere.created && (
              <div
                key={dropHere.at}
                aria-hidden="true"
                className="absolute inset-0 rounded-[inherit] pointer-events-none motion-safe:animate-[frameDropFlash_600ms_ease-out_forwards]"
              />
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isRenaming ? (
                  <input
                    type="text"
                    autoFocus
                    value={renaming.value}
                    aria-label={`Rename ${anim.name}`}
                    onChange={(e) => setRenaming({ id: anim.id, value: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="min-w-0 w-40 rounded bg-bg-elevated border border-accent-amber px-2 py-1
                      text-sm font-mono text-text-primary focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startRename(anim)}
                    aria-label={`Rename ${anim.name}`}
                    title={`Rename ${anim.name}`}
                    className="group/name flex items-center gap-1.5 min-w-0 rounded px-1 -mx-1 cursor-text hover:bg-bg-hover"
                  >
                    <span className="text-sm font-mono font-semibold text-text-primary truncate">{anim.name}</span>
                    <Pencil size={11} className="text-text-muted group-hover/name:text-text-secondary flex-shrink-0" />
                  </button>
                )}
                <select
                  value={anim.type}
                  aria-label="Animation type"
                  title="Animation type"
                  onChange={(e) => updateAnimationMeta(anim.id, { type: e.target.value })}
                  className="rounded bg-bg-elevated border border-border-default px-1.5 py-0.5
                    text-[10px] font-mono text-text-secondary focus:outline-none focus:border-accent-amber cursor-pointer"
                >
                  {ANIMATION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] font-mono text-text-muted whitespace-nowrap">
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
                  type="button"
                  onClick={() => removeAnimation(anim.id)}
                  className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-400/10 cursor-pointer"
                  title="Delete animation"
                  aria-label="Delete animation"
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
                Drag frames here, or select them above and press Assign.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {anim.frames.map((frame, idx) => {
                  const dataUrl = frameDataUrls.get(frame.id);
                  const isDragSource =
                    drag?.source.kind === 'group' &&
                    drag.source.animId === anim.id &&
                    drag.source.index === idx;
                  const justDropped = dropHere && !dropHere.created && dropHere.index === idx;
                  return (
                    <div
                      key={`${idx}-${frame.id}`}
                      data-frame-drop-index={idx}
                      onPointerDown={(e) =>
                        startFrameDrag(e, { kind: 'group', animId: anim.id, index: idx, frameId: frame.id })
                      }
                      style={DRAG_TILE_STYLE}
                      className={`flex flex-col items-center gap-1.5 rounded border border-border-subtle bg-bg-elevated p-0.5 cursor-grab ${
                        isDragSource ? 'opacity-40' : ''
                      } ${justDropped ? 'motion-safe:animate-[frameDropIn_150ms_ease-out]' : ''}`}
                    >
                      <div className="relative">
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
                              alt={`Frame ${idx + 1}`}
                              draggable={false}
                              className="w-full h-full object-contain"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          )}
                        </div>

                        <span className="absolute -bottom-1.5 left-0.5 text-[7px] font-mono text-text-muted leading-none">
                          {idx + 1}
                        </span>
                      </div>

                      {/* Always visible (no hover gate): compact on a mouse,
                          44 px touch targets on a coarse pointer. Left and
                          right arrows match the left-to-right strip. They
                          stay the keyboard path; presses here never start a
                          drag. */}
                      <div className="flex gap-0.5" data-frame-drag-ignore>
                        <button
                          type="button"
                          onClick={() => handleMoveFrame(anim.id, idx, -1)}
                          disabled={idx === 0}
                          aria-label={`Move frame ${idx + 1} earlier`}
                          className={`${FRAME_CONTROL_CLASS} enabled:hover:text-text-primary`}
                        >
                          <ChevronLeft size={12} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveFrame(anim.id, idx, 1)}
                          disabled={idx === anim.frames.length - 1}
                          aria-label={`Move frame ${idx + 1} later`}
                          className={`${FRAME_CONTROL_CLASS} enabled:hover:text-text-primary`}
                        >
                          <ChevronRight size={12} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveFrame(anim.id, idx)}
                          aria-label={`Remove frame ${idx + 1}`}
                          className={`${FRAME_CONTROL_CLASS} hover:text-red-400`}
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}

        {/* With animations present: a slim zone for the next one */}
        {animations.length > 0 && (
          <div
            data-frame-drop-new
            className={`rounded-lg border p-3 text-center transition-colors ${newZoneClass(drag, isOverNew)}`}
          >
            <p className="text-[10px] font-mono text-text-muted">
              {isOverNew
                ? `Release to create ${animationPreset(selectedType).label}`
                : dragging
                  ? 'Drop to start a new animation'
                  : 'Drop a frame here for another animation'}
            </p>
          </div>
        )}
      </div>

      {/* Screen readers hear each drop; sighted users see the pop-in. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <FrameDragLayer frameDataUrls={frameDataUrls} />
    </div>
  );
}
