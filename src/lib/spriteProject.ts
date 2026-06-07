/**
 * SpriteProjectV1 — the Pixel Editor's document model.
 *
 * Wave 1b foundation (Confluence 100466699, §3 AD #29 + §4). Introduces the
 * frame-aware DOCUMENT format that Wave 3 will persist and Wave 4's sheet-
 * import will write, WITHOUT introducing the multi-frame RUNTIME (Wave 5):
 *
 *   - Document: frames[] (frame-aware, layer-aware seam, no layers array)
 *   - Runtime:  one active buffer in editorStore (single-frame editor today)
 *
 * The document materializes via editorStore.loadProject; the runtime
 * serializes back via editorStore.toProject. Every editor open runs this
 * code path, so the model is exercised continuously rather than dead code.
 *
 * Pure module — no React, no Zustand. Safe to call from any context.
 */

import { EDITOR_MAX_DIMENSION, EDITOR_MAX_PIXELS } from '@/lib/editorConstants';
import { hexToRgb } from '@/lib/colorUtils';

// ── Constants ────────────────────────────────────────────────────────────────

/** Stable identifier for the project envelope's `schema` field. */
export const SPRITE_PROJECT_SCHEMA = 'spritebrew.project' as const;

/** Current schema version. A bump here is a coordinated change with the
 *  validator + any persisted import paths. Today we only ever produce v1. */
export const SPRITE_PROJECT_SCHEMA_VERSION = 1 as const;

/** Default playback rate for newly created projects. Matches the existing
 *  `frameCount` semantics in the Animate flow — 12 fps is roughly the
 *  retro-game baseline. */
const DEFAULT_FPS = 12;

// ── PixelRef — how a frame's bytes are addressed ────────────────────────────

/**
 * Reference to a frame's pixel data. Wave 1b produces only `memory` (live in
 * editorStore). Wave 3 storage persistence will use `indexeddb` or `r2`. The
 * runtime resolves via editorStore.getFramePixels(frameId) → Uint8ClampedArray.
 */
export type PixelRef =
  | { kind: 'memory'; key: string }
  | { kind: 'indexeddb'; key: string }
  | { kind: 'r2'; key: string; contentType: string };

// ── Source lineage — where the project originated ───────────────────────────

/** Identifies where this project came from. Carried for analytics + future
 *  "back to source" UX (e.g., "edited from gallery item #abc → reopen in
 *  gallery"). All fields besides `kind` are optional and informational. */
export type SpriteProjectSource =
  | { kind: 'blank' }
  | { kind: 'upload' }
  | { kind: 'generation'; generationId?: string; promptPreview?: string }
  | { kind: 'gallery'; galleryImageId?: string }
  | { kind: 'sheet-import' };

// ── Frame — one cell in the animation strip ─────────────────────────────────

export interface SpriteFrameV1 {
  /** Stable opaque id. Used by getFramePixels and as React keys. */
  id: string;
  /** 0-based position in frames[]. Must match the array index (validator
   *  enforces this — it's redundant on disk but reading-friendly). */
  index: number;
  /** Optional human label. Future Wave 5 frame UI surfaces this. */
  name?: string;
  /** Per-frame duration in milliseconds. Wave 5 animation timeline uses
   *  this; today we just default 1000/fps and round-trip it. */
  durationMs: number;
  /** How to fetch this frame's bytes at materialization time. */
  pixelRef: PixelRef;
}

// ── Color state — palette + active swatches ─────────────────────────────────

export interface SpriteProjectColorV1 {
  /** Color space. Locked to 'rgba' for now; future indexed-color projects
   *  would extend this. */
  mode: 'rgba';
  /** Reusable palette swatches (user-saved + auto-extracted). Hex strings. */
  palette: string[];
  /** Most-recently-used colors (capped, FIFO). Distinct from palette so the
   *  user's saved palette isn't churned by every brush click. */
  recentColors: string[];
  /** Active foreground (paint) color. Hex. */
  foreground: string;
  /** Background fill sentinel. `'none'` means transparent (no fill); a hex
   *  string means that color fills the bg layer (not yet surfaced in UI). */
  background: string;
}

// ── Canvas + animation envelope ─────────────────────────────────────────────

export interface SpriteProjectCanvasV1 {
  width: number;
  height: number;
  /** When true, frames are RGBA with alpha respected. We always create
   *  transparent today; surfaced in the envelope for future opaque-canvas
   *  projects. */
  transparent: boolean;
}

export interface SpriteProjectAnimationV1 {
  fps: number;
  playback: 'loop' | 'once' | 'ping-pong';
}

/** Reserved for Wave 4 — sheet-import metadata (origin sheet dims, slice
 *  config, etc.). Defined so the envelope shape is stable; left undefined
 *  by Wave 1b producers. */
export interface SpriteProjectSheetImportV1 {
  /** Source sheet dimensions, pre-slice. */
  sheetWidth: number;
  sheetHeight: number;
  /** Per-frame slice rect in the original sheet. */
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
}

/** Reserved for Wave 3 — persistence metadata (last save time, server
 *  revision id, dirty-since-save flag, etc.). Defined for envelope
 *  stability; left undefined by Wave 1b producers. */
export interface SpriteProjectSaveStateV1 {
  lastSavedAt?: number;
  remoteRevisionId?: string;
  dirtySinceSave?: boolean;
}

// ── Top-level envelope ──────────────────────────────────────────────────────

/**
 * The full SpriteProjectV1 envelope. Every persisted/imported project on
 * disk takes this exact shape. The runtime materializes one frame's worth
 * of pixels at a time (editor is still single-frame in Wave 1b).
 *
 * Keep this stable — every additive change is forward-compatible with prior
 * v1 documents; any breaking change requires bumping schemaVersion + a
 * coordinated validator + migration story.
 */
export interface SpriteProjectV1 {
  readonly schema: typeof SPRITE_PROJECT_SCHEMA;
  readonly schemaVersion: typeof SPRITE_PROJECT_SCHEMA_VERSION;

  /** Stable server-side identifier (KV / R2). Unset for in-memory documents
   *  that haven't been saved yet. */
  projectId?: string;
  /** Optimistic-concurrency token used by Wave 3 server saves. Unset until
   *  the project has been persisted at least once. */
  revisionId?: string;

  name: string;
  createdAt: number;
  updatedAt: number;

  canvas: SpriteProjectCanvasV1;
  color: SpriteProjectColorV1;
  frames: SpriteFrameV1[];
  animation: SpriteProjectAnimationV1;

  source?: SpriteProjectSource;
  sheetImport?: SpriteProjectSheetImportV1;
  saveState?: SpriteProjectSaveStateV1;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** crypto.randomUUID with a same-shape fallback for older runtimes. */
function newId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable in-memory key for the "active runtime frame" PixelRef. Wave 1b's
 *  editorStore exposes exactly one frame; this is the key getFramePixels
 *  recognizes. */
export const ACTIVE_FRAME_MEMORY_KEY = 'active' as const;

/** Default project name — humans can rename via the (future) Save dialog. */
function defaultProjectName(): string {
  return 'Untitled project';
}

function defaultColorState(foreground = '#d4871c'): SpriteProjectColorV1 {
  return {
    mode: 'rgba',
    palette: [],
    recentColors: [],
    foreground,
    background: 'none',
  };
}

function defaultAnimationState(): SpriteProjectAnimationV1 {
  return { fps: DEFAULT_FPS, playback: 'loop' };
}

// ── Factories ───────────────────────────────────────────────────────────────

/**
 * Create a blank project with one transparent frame at the given size.
 * Used by the EditorLanding "blank canvas" entry point.
 */
export function createBlankProject(input: {
  width: number;
  height: number;
  name?: string;
  source?: SpriteProjectSource;
}): SpriteProjectV1 {
  const now = Date.now();
  return {
    schema: SPRITE_PROJECT_SCHEMA,
    schemaVersion: SPRITE_PROJECT_SCHEMA_VERSION,
    name: input.name ?? defaultProjectName(),
    createdAt: now,
    updatedAt: now,
    canvas: { width: input.width, height: input.height, transparent: true },
    color: defaultColorState(),
    frames: [
      {
        id: newId('frame'),
        index: 0,
        durationMs: Math.round(1000 / DEFAULT_FPS),
        pixelRef: { kind: 'memory', key: ACTIVE_FRAME_MEMORY_KEY },
      },
    ],
    animation: defaultAnimationState(),
    source: input.source ?? { kind: 'blank' },
  };
}

/**
 * Create a single-frame project from a decoded ImageData. The pixels are
 * NOT embedded in the project — the runtime (editorStore.loadProject)
 * resolves frames[0].pixelRef = {kind:'memory', key:'active'} to the active
 * buffer it just materialized. The ImageData here is the validator's hint
 * about what those bytes will look like.
 *
 * The caller is responsible for making sure editorStore.loadProject is
 * given access to the same ImageData (i.e., loadFrame's existing pipeline).
 */
export function createProjectFromImageData(
  imageData: ImageData,
  input: {
    name?: string;
    source?: SpriteProjectSource;
    palette?: string[];
    foreground?: string;
  } = {},
): SpriteProjectV1 {
  const now = Date.now();
  return {
    schema: SPRITE_PROJECT_SCHEMA,
    schemaVersion: SPRITE_PROJECT_SCHEMA_VERSION,
    name: input.name ?? defaultProjectName(),
    createdAt: now,
    updatedAt: now,
    canvas: {
      width: imageData.width,
      height: imageData.height,
      transparent: true,
    },
    color: {
      ...defaultColorState(input.foreground ?? '#d4871c'),
      palette: input.palette ?? [],
    },
    frames: [
      {
        id: newId('frame'),
        index: 0,
        durationMs: Math.round(1000 / DEFAULT_FPS),
        pixelRef: { kind: 'memory', key: ACTIVE_FRAME_MEMORY_KEY },
      },
    ],
    animation: defaultAnimationState(),
    source: input.source,
  };
}

// ── Validator ───────────────────────────────────────────────────────────────

export type ValidateProjectResult =
  | { ok: true; project: SpriteProjectV1 }
  | { ok: false; error: string };

/** Type guard for the PixelRef discriminator without trusting unknown input. */
function isValidPixelRef(value: unknown): value is PixelRef {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'memory' || v.kind === 'indexeddb') {
    return typeof v.key === 'string' && v.key.length > 0;
  }
  if (v.kind === 'r2') {
    return (
      typeof v.key === 'string' &&
      v.key.length > 0 &&
      typeof v.contentType === 'string'
    );
  }
  return false;
}

function isFinitePositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && Number.isInteger(n);
}

function isValidHexColor(s: unknown): s is string {
  return typeof s === 'string' && hexToRgb(s) !== null;
}

function isValidPlayback(s: unknown): s is SpriteProjectAnimationV1['playback'] {
  return s === 'loop' || s === 'once' || s === 'ping-pong';
}

/**
 * Validate an unknown value as a SpriteProjectV1. This is the boundary
 * validator from the Plan ("validate every project load at the boundary").
 * Wave 3 will call this on untrusted persisted documents; Wave 1b calls it
 * on the in-memory documents loadFrame produces, which exercises the path
 * on every editor open and catches regressions immediately.
 *
 * Checks:
 *   - schema string + schemaVersion === 1
 *   - canvas dims finite/positive/integer AND within EDITOR_MAX_DIMENSION /
 *     EDITOR_MAX_PIXELS (the Wave 1a constants are imported, never hardcoded)
 *   - frames non-empty, unique ids, indices match array position
 *   - each frame has a valid pixelRef + finite positive durationMs
 *   - colors valid (hexToRgb-parseable) — empty palette is fine
 *
 * On failure: returns a `{ok:false, error}` with a single concise sentence.
 */
export function validateProject(input: unknown): ValidateProjectResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Project must be an object.' };
  }
  const p = input as Record<string, unknown>;

  if (p.schema !== SPRITE_PROJECT_SCHEMA) {
    return { ok: false, error: `Unknown schema (expected "${SPRITE_PROJECT_SCHEMA}").` };
  }
  if (p.schemaVersion !== SPRITE_PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported schema version ${String(p.schemaVersion)} (expected ${SPRITE_PROJECT_SCHEMA_VERSION}).`,
    };
  }

  if (typeof p.name !== 'string' || p.name.length === 0) {
    return { ok: false, error: 'Project name must be a non-empty string.' };
  }
  if (typeof p.createdAt !== 'number' || typeof p.updatedAt !== 'number') {
    return { ok: false, error: 'Project timestamps must be numbers.' };
  }

  // Canvas
  const canvas = p.canvas as Record<string, unknown> | undefined;
  if (!canvas || typeof canvas !== 'object') {
    return { ok: false, error: 'Project canvas is missing.' };
  }
  if (!isFinitePositiveInt(canvas.width) || !isFinitePositiveInt(canvas.height)) {
    return { ok: false, error: 'Canvas width/height must be positive integers.' };
  }
  const cw = canvas.width as number;
  const ch = canvas.height as number;
  if (cw > EDITOR_MAX_DIMENSION || ch > EDITOR_MAX_DIMENSION) {
    return {
      ok: false,
      error: `Canvas ${cw}×${ch} exceeds the editor's ${EDITOR_MAX_DIMENSION}-per-side limit.`,
    };
  }
  if (cw * ch > EDITOR_MAX_PIXELS) {
    return {
      ok: false,
      error: `Canvas ${cw}×${ch} exceeds the editor's ${EDITOR_MAX_PIXELS.toLocaleString()}-total-pixel limit.`,
    };
  }
  if (typeof canvas.transparent !== 'boolean') {
    return { ok: false, error: 'Canvas transparent flag must be a boolean.' };
  }

  // Color
  const color = p.color as Record<string, unknown> | undefined;
  if (!color || typeof color !== 'object') {
    return { ok: false, error: 'Project color state is missing.' };
  }
  if (color.mode !== 'rgba') {
    return { ok: false, error: `Unsupported color mode "${String(color.mode)}" (expected "rgba").` };
  }
  if (!isValidHexColor(color.foreground)) {
    return { ok: false, error: 'Foreground color must be a valid hex string.' };
  }
  // background may be 'none' OR a valid hex
  if (color.background !== 'none' && !isValidHexColor(color.background)) {
    return { ok: false, error: 'Background color must be "none" or a valid hex string.' };
  }
  if (!Array.isArray(color.palette) || !color.palette.every(isValidHexColor)) {
    return { ok: false, error: 'Palette must be an array of valid hex strings.' };
  }
  if (!Array.isArray(color.recentColors) || !color.recentColors.every(isValidHexColor)) {
    return { ok: false, error: 'Recent colors must be an array of valid hex strings.' };
  }

  // Animation
  const animation = p.animation as Record<string, unknown> | undefined;
  if (!animation || typeof animation !== 'object') {
    return { ok: false, error: 'Project animation state is missing.' };
  }
  if (typeof animation.fps !== 'number' || animation.fps <= 0 || !Number.isFinite(animation.fps)) {
    return { ok: false, error: 'Animation fps must be a positive number.' };
  }
  if (!isValidPlayback(animation.playback)) {
    return { ok: false, error: 'Animation playback must be one of "loop" / "once" / "ping-pong".' };
  }

  // Frames
  if (!Array.isArray(p.frames) || p.frames.length === 0) {
    return { ok: false, error: 'Project must have at least one frame.' };
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < p.frames.length; i++) {
    const f = p.frames[i] as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object') {
      return { ok: false, error: `Frame ${i} is not an object.` };
    }
    if (typeof f.id !== 'string' || f.id.length === 0) {
      return { ok: false, error: `Frame ${i} has an invalid id.` };
    }
    if (seenIds.has(f.id)) {
      return { ok: false, error: `Frame ${i} duplicates id "${f.id}".` };
    }
    seenIds.add(f.id);
    if (f.index !== i) {
      return { ok: false, error: `Frame at position ${i} has index ${String(f.index)} (must match position).` };
    }
    if (typeof f.durationMs !== 'number' || f.durationMs <= 0 || !Number.isFinite(f.durationMs)) {
      return { ok: false, error: `Frame ${i} has invalid durationMs.` };
    }
    if (!isValidPixelRef(f.pixelRef)) {
      return { ok: false, error: `Frame ${i} has invalid pixelRef.` };
    }
    if (f.name !== undefined && typeof f.name !== 'string') {
      return { ok: false, error: `Frame ${i} name must be a string when present.` };
    }
  }

  // Optional fields — type-check only when present.
  if (p.projectId !== undefined && typeof p.projectId !== 'string') {
    return { ok: false, error: 'projectId must be a string when present.' };
  }
  if (p.revisionId !== undefined && typeof p.revisionId !== 'string') {
    return { ok: false, error: 'revisionId must be a string when present.' };
  }

  // Made it through — the unknown is structurally a SpriteProjectV1.
  return { ok: true, project: input as SpriteProjectV1 };
}
