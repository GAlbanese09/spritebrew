/**
 * Animate form config — auto-save / auto-restore (v0.5.11 Piece A).
 *
 * Persists the user's last-used Animate config to localStorage so a refresh,
 * navigation away, or tab switch doesn't reset their frame count / action /
 * background color / etc. back to defaults — the bug Ryvandal documented
 * Day-13.
 *
 * NOT persisted: the character image itself (per-use input, not config),
 * the pending-dataUrl pipeline state, or any handoff one-shots from spriteStore.
 *
 * Persistence shape is the readActiveJob() idiom from useGenerationPoll.ts:
 * typed object, JSON.stringify on save, JSON.parse + per-field validation on
 * load, returns null only when the record is unrecoverable. Per-field
 * validation falls back to defaults for individual stale values (rather than
 * rejecting the whole record) so one removed action ID doesn't nuke the
 * user's frame count too.
 */

import {
  ADVANCED_ANIM_RESOLUTION_PRESETS,
  ADVANCED_ANIM_DEFAULT_RESOLUTION,
} from '@/lib/styleRegistry';

// ── Validation lists ─────────────────────────────────────────────────────────
// Keep in sync with AnimateForm.tsx (ACTIONS, FRAME_COUNTS). Intentional
// duplication: importing them from AnimateForm.tsx would create a circular
// import (AnimateForm also imports from here). These primitive lists are
// stable across releases; drift is low-risk and easy to spot in PR diffs.

const VALID_ACTION_IDS: readonly string[] = [
  'walking',
  'idle',
  'attack',
  'jump',
  'crouch',
  'destroy',
  'subtle_motion',
  'custom_action',
];

const VALID_FRAME_COUNTS: readonly number[] = [4, 6, 8, 10, 12, 16];

// Defaults — used as the fallback when a stale field can't be validated.
// Must match AnimateForm.tsx's useState defaults.
const DEFAULT_ACTION = 'walking';
const DEFAULT_FRAME_COUNT = 4;
const DEFAULT_BG_COLOR = '#000000';
const DEFAULT_CHARACTER_SIZE_PCT = 75;
const MIN_CHARACTER_SIZE_PCT = 50;
const MAX_CHARACTER_SIZE_PCT = 95;
const MAX_MOTION_PROMPT_LEN = 500;

const KEY = 'spritebrew:animate:latest';

// ── Public shape ─────────────────────────────────────────────────────────────

export interface SavedAnimateConfig {
  v: 1;
  selectedAction: string;
  frameCount: number;
  motionPrompt: string;
  selectedResolution: number;
  bgColor: string;
  paddingEnabled: boolean;
  characterSizePct: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strict 6-digit hex (matches what <input type="color"> emits). */
function isValidHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ── Save ─────────────────────────────────────────────────────────────────────

export function saveLatestConfig(config: SavedAnimateConfig): void {
  if (typeof window === 'undefined') return;
  try {
    // Truncate motionPrompt on save as well (defensive — same cap as on load).
    const safe: SavedAnimateConfig = {
      ...config,
      motionPrompt: config.motionPrompt.slice(0, MAX_MOTION_PROMPT_LEN),
    };
    window.localStorage.setItem(KEY, JSON.stringify(safe));
  } catch {
    // Quota exceeded or localStorage disabled — silently drop. The form
    // continues to work; the user just won't get auto-restore next visit.
  }
}

// ── Load ─────────────────────────────────────────────────────────────────────

export function loadLatestConfig(): SavedAnimateConfig | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { v?: unknown }).v !== 1
  ) {
    // Schema-version mismatch or non-object → unrecoverable.
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Per-field validation with fallback to defaults. A single stale field
  // doesn't void the whole record — graceful degradation.
  const selectedAction =
    typeof obj.selectedAction === 'string' && VALID_ACTION_IDS.includes(obj.selectedAction)
      ? obj.selectedAction
      : DEFAULT_ACTION;

  const frameCount =
    typeof obj.frameCount === 'number' && VALID_FRAME_COUNTS.includes(obj.frameCount)
      ? obj.frameCount
      : DEFAULT_FRAME_COUNT;

  const motionPrompt =
    typeof obj.motionPrompt === 'string'
      ? obj.motionPrompt.slice(0, MAX_MOTION_PROMPT_LEN)
      : '';

  const selectedResolution =
    typeof obj.selectedResolution === 'number' &&
    (ADVANCED_ANIM_RESOLUTION_PRESETS as readonly number[]).includes(obj.selectedResolution)
      ? obj.selectedResolution
      : ADVANCED_ANIM_DEFAULT_RESOLUTION;

  const bgColor = isValidHexColor(obj.bgColor) ? obj.bgColor : DEFAULT_BG_COLOR;

  const paddingEnabled = typeof obj.paddingEnabled === 'boolean' ? obj.paddingEnabled : false;

  const characterSizePct =
    typeof obj.characterSizePct === 'number' && Number.isFinite(obj.characterSizePct)
      ? clamp(Math.round(obj.characterSizePct), MIN_CHARACTER_SIZE_PCT, MAX_CHARACTER_SIZE_PCT)
      : DEFAULT_CHARACTER_SIZE_PCT;

  return {
    v: 1,
    selectedAction,
    frameCount,
    motionPrompt,
    selectedResolution,
    bgColor,
    paddingEnabled,
    characterSizePct,
  };
}
