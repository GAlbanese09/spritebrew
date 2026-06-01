/**
 * Animate form config — auto-save / auto-restore (v0.5.11 Piece A) +
 * named templates (v0.5.12 Piece B).
 *
 * Piece A — persists the user's last-used Animate config to localStorage so
 * a refresh, navigation away, or tab switch doesn't reset their frame count /
 * action / background color / etc. back to defaults (the bug Ryvandal
 * documented Day-13). Backed by KEY = 'spritebrew:animate:latest'.
 *
 * Piece B — adds a named-template layer on top: the user can save the
 * current 7 config fields under a name, list saved templates, click to
 * load, and delete. Backed by TEMPLATES_KEY = 'spritebrew:animate:templates',
 * capped at MAX_TEMPLATES.
 *
 * NOT persisted (either store): the character image itself (per-use input,
 * not config), the pending-dataUrl pipeline state, or any handoff one-shots
 * from spriteStore. Templates are character-agnostic by design.
 *
 * Persistence shape is the readActiveJob() idiom from useGenerationPoll.ts:
 * typed object, JSON.stringify on save, JSON.parse + per-field validation on
 * load, returns null only when the record is unrecoverable. Per-field
 * validation falls back to defaults for individual stale values (rather than
 * rejecting the whole record) so one removed action ID doesn't nuke the
 * user's frame count too. Both loaders share the same validateConfig() path.
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
const DEFAULT_BG_COLOR = '#ff00ff';
const DEFAULT_CHARACTER_SIZE_PCT = 75;
const MIN_CHARACTER_SIZE_PCT = 50;
const MAX_CHARACTER_SIZE_PCT = 95;
const MAX_MOTION_PROMPT_LEN = 500;

const KEY = 'spritebrew:animate:latest';

// ── Template layer (Piece B) ─────────────────────────────────────────────────

const TEMPLATES_KEY = 'spritebrew:animate:templates';

/** Hard cap on saved templates. UI is responsible for the user-facing "limit
 *  reached" message — saveTemplate just returns null when the cap is hit. */
export const MAX_TEMPLATES = 20;

/** Max template-name length after trim. Names longer than this are truncated
 *  on save (defensive — UI also caps via maxLength). */
export const MAX_TEMPLATE_NAME_LEN = 60;

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

export interface AnimateTemplate {
  id: string;
  name: string;
  /** Unix ms timestamp. Plain number is simpler than ISO string for sorting. */
  createdAt: number;
  config: SavedAnimateConfig;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strict 6-digit hex (matches what <input type="color"> emits). */
function isValidHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Per-field validation for a parsed config record. Shared between
 * loadLatestConfig (Piece A) and loadTemplates (Piece B) so both loaders
 * accept/reject the same shapes.
 *
 * Returns null only when the record is fundamentally unrecoverable:
 * non-object, or v !== 1 (schema version mismatch). Individual stale
 * fields fall back to defaults — graceful degradation.
 */
function validateConfig(obj: unknown): SavedAnimateConfig | null {
  if (!obj || typeof obj !== 'object' || (obj as { v?: unknown }).v !== 1) {
    return null;
  }

  const o = obj as Record<string, unknown>;

  const selectedAction =
    typeof o.selectedAction === 'string' && VALID_ACTION_IDS.includes(o.selectedAction)
      ? o.selectedAction
      : DEFAULT_ACTION;

  const frameCount =
    typeof o.frameCount === 'number' && VALID_FRAME_COUNTS.includes(o.frameCount)
      ? o.frameCount
      : DEFAULT_FRAME_COUNT;

  const motionPrompt =
    typeof o.motionPrompt === 'string'
      ? o.motionPrompt.slice(0, MAX_MOTION_PROMPT_LEN)
      : '';

  const selectedResolution =
    typeof o.selectedResolution === 'number' &&
    (ADVANCED_ANIM_RESOLUTION_PRESETS as readonly number[]).includes(o.selectedResolution)
      ? o.selectedResolution
      : ADVANCED_ANIM_DEFAULT_RESOLUTION;

  const bgColor = isValidHexColor(o.bgColor) ? o.bgColor : DEFAULT_BG_COLOR;

  const paddingEnabled = typeof o.paddingEnabled === 'boolean' ? o.paddingEnabled : false;

  const characterSizePct =
    typeof o.characterSizePct === 'number' && Number.isFinite(o.characterSizePct)
      ? clamp(Math.round(o.characterSizePct), MIN_CHARACTER_SIZE_PCT, MAX_CHARACTER_SIZE_PCT)
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

/** crypto.randomUUID() with a same-shape fallback for older runtimes. */
function newTemplateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Save / Load (Piece A) ────────────────────────────────────────────────────

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

  return validateConfig(parsed);
}

// ── Templates (Piece B) ──────────────────────────────────────────────────────

/**
 * Load all saved templates, newest first (by createdAt desc).
 *
 * Per-template: if the outer wrapper is malformed (missing id/name/createdAt
 * or wrong types) OR the nested config fails validateConfig, the template is
 * silently dropped from the returned list. The persisted list is NOT
 * rewritten — a stale entry that's invalid today might become valid again
 * after a schema bump, and the user can manually delete bad entries.
 */
export function loadTemplates(): AnimateTemplate[] {
  if (typeof window === 'undefined') return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TEMPLATES_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const out: AnimateTemplate[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id) continue;
    if (typeof e.name !== 'string' || !e.name) continue;
    if (typeof e.createdAt !== 'number' || !Number.isFinite(e.createdAt)) continue;
    const cfg = validateConfig(e.config);
    if (!cfg) continue;
    out.push({
      id: e.id,
      name: e.name.slice(0, MAX_TEMPLATE_NAME_LEN),
      createdAt: e.createdAt,
      config: cfg,
    });
  }

  // Newest first — most recently saved templates rise to the top of the list.
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/**
 * Persist a new template. Returns the updated list on success, null on
 * failure (cap reached, empty name after trim, or localStorage error).
 *
 * The component is responsible for the user-facing distinction between
 * "cap reached" and "name required" — it can pre-flight check both before
 * calling. A null return here signals an unexpected failure (or a race) and
 * should surface a generic "couldn't save" message.
 */
export function saveTemplate(
  name: string,
  config: SavedAnimateConfig
): AnimateTemplate[] | null {
  if (typeof window === 'undefined') return null;

  const trimmed = name.trim().slice(0, MAX_TEMPLATE_NAME_LEN);
  if (!trimmed) return null;

  const existing = loadTemplates();
  if (existing.length >= MAX_TEMPLATES) return null;

  const next: AnimateTemplate = {
    id: newTemplateId(),
    name: trimmed,
    createdAt: Date.now(),
    config,
  };

  // newest-first ordering, mirrors loadTemplates' sort.
  const updated = [next, ...existing];

  try {
    window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  } catch {
    return null;
  }

  return updated;
}

/**
 * Delete a template by id. Returns the updated list on success, null on
 * persistence failure. Deleting a non-existent id is a no-op (returns the
 * unchanged list).
 */
export function deleteTemplate(id: string): AnimateTemplate[] | null {
  if (typeof window === 'undefined') return null;

  const existing = loadTemplates();
  const updated = existing.filter((t) => t.id !== id);

  try {
    window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(updated));
  } catch {
    return null;
  }

  return updated;
}
