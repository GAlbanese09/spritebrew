/**
 * Style registry — single source of truth for all generation styles on the
 * Create New tab. Each entry maps to a Retro Diffusion prompt_style value.
 */

export type StyleCategory = 'characters' | 'items' | 'environments' | 'animations' | 'tiles' | 'ui';
export type StyleTier = 'fast' | 'plus' | 'pro' | 'animation';

/**
 * Resolution constraint metadata for animation styles.
 *
 *   variable          — Family B (rd_advanced_animation__*): 32-256, picker presets
 *   variable_special  — animation__vfx: bespoke 24-96 range with explicit presets
 *   locked            — Family A locked styles (animation__any_animation, etc.)
 *                       picker is NOT rendered; size is fixed by RD's model
 */
export type ResolutionMode =
  | { kind: 'variable'; min: 32; max: 256; default: number }
  | { kind: 'variable_special'; min: number; max: number; default: number; presets: number[] }
  | { kind: 'locked'; size: number };

export interface GenerationStyle {
  id: string;
  label: string;
  description: string;
  promptStyle: string;
  tier: StyleTier;
  category: StyleCategory;
  defaultWidth: number;
  defaultHeight: number;
  minSize: number;
  maxSize: number;
  fixedSize: boolean;
  costPerGeneration: number;
  tokenCost: number;
  isAnimation: boolean;
  supportsRemoveBg: boolean;
  /** Whether RD's `reference_images` parameter is honoured for this style.
   *  Only the rd_pro__* family supports references per RD docs. */
  supportsReferenceImages?: boolean;
  resolutionMode?: ResolutionMode;
}

export const GENERATION_STYLES: GenerationStyle[] = [
  // ── RD PRO ($0.22/image, 96-256px) — 40 tokens ──
  {
    id: 'pro-default', label: 'Character (Pro)', description: 'Clean modern pixel art with detailed prompting',
    promptStyle: 'rd_pro__default', tier: 'pro', category: 'characters',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: true,
    supportsReferenceImages: true,
  },
  {
    id: 'pro-fantasy', label: 'Fantasy', description: 'Fantasy-themed characters and scenes',
    promptStyle: 'rd_pro__fantasy', tier: 'pro', category: 'characters',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: true,
    supportsReferenceImages: true,
  },
  {
    id: 'pro-platformer', label: 'Platformer', description: 'Side-scrolling platformer characters',
    promptStyle: 'rd_pro__platformer', tier: 'pro', category: 'characters',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: true,
    supportsReferenceImages: true,
  },
  {
    id: 'pro-spritesheet', label: 'Sprite Collection', description: 'Multiple assets in the same style on one sheet',
    promptStyle: 'rd_pro__spritesheet', tier: 'pro', category: 'characters',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: false,
    supportsReferenceImages: true,
  },
  {
    id: 'pro-inventory', label: 'Inventory Items', description: 'RPG-style inventory item grids',
    promptStyle: 'rd_pro__inventory_items', tier: 'pro', category: 'items',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: false,
    supportsReferenceImages: true,
  },
  {
    id: 'pro-fps-weapon', label: 'FPS Weapon', description: 'First-person perspective weapons and items',
    promptStyle: 'rd_pro__fps_weapon', tier: 'pro', category: 'items',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: true,
    supportsReferenceImages: true,
  },
  {
    id: 'pro-hex-tiles', label: 'Hexagonal Tiles', description: 'Hexagonal tiles for game maps',
    promptStyle: 'rd_pro__hexagonal_tiles', tier: 'pro', category: 'tiles',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: false,
    supportsReferenceImages: true,
  },
  {
    id: 'pro-typography', label: 'Typography', description: 'Pixel art logos, buttons, and text elements',
    promptStyle: 'rd_pro__typography', tier: 'pro', category: 'ui',
    defaultWidth: 256, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, tokenCost: 40, isAnimation: false, supportsRemoveBg: true,
    supportsReferenceImages: true,
  },

  // ── RD PLUS ($0.025-0.06/image, 16-192px) — 10 tokens ──
  {
    id: 'plus-classic', label: 'Classic Pixel Art', description: 'Strongly outlined, simple shading, clear design',
    promptStyle: 'rd_plus__classic', tier: 'plus', category: 'characters',
    defaultWidth: 192, defaultHeight: 192, minSize: 32, maxSize: 192,
    fixedSize: false, costPerGeneration: 0.06, tokenCost: 10, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-low-res', label: 'Low Resolution', description: 'High quality low-res pixel art (16-128px)',
    promptStyle: 'rd_plus__low_res', tier: 'plus', category: 'characters',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, tokenCost: 10, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-skill-icon', label: 'Skill / Spell Icon', description: 'Icons for skills, abilities, or spells',
    promptStyle: 'rd_plus__skill_icon', tier: 'plus', category: 'ui',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, tokenCost: 10, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-topdown-item', label: 'Top-Down Item', description: 'Items and objects from a top-down view',
    promptStyle: 'rd_plus__topdown_item', tier: 'plus', category: 'items',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, tokenCost: 10, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-mc-item', label: 'Minecraft Item', description: 'Minecraft-styled items and game assets',
    promptStyle: 'rd_plus__mc_item', tier: 'plus', category: 'items',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, tokenCost: 10, isAnimation: false, supportsRemoveBg: true,
  },

  // ── RD FAST ($0.015-0.02/image, 64-384px) — 3 tokens ──
  {
    id: 'fast-retro', label: 'Retro Arcade', description: 'Fast retro arcade style pixel art',
    promptStyle: 'rd_fast__retro', tier: 'fast', category: 'characters',
    defaultWidth: 256, defaultHeight: 256, minSize: 64, maxSize: 384,
    fixedSize: false, costPerGeneration: 0.02, tokenCost: 3, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'fast-no-style', label: 'No Style (Fast)', description: 'Fast generation with no style influence',
    promptStyle: 'rd_fast__no_style', tier: 'fast', category: 'characters',
    defaultWidth: 256, defaultHeight: 256, minSize: 64, maxSize: 384,
    fixedSize: false, costPerGeneration: 0.02, tokenCost: 3, isAnimation: false, supportsRemoveBg: true,
  },

  // ── STANDARD ANIMATION ($0.07/image, fixed sizes) — 15 tokens ──
  {
    id: 'anim-4angle-walking', label: '4-Angle Walking', description: '4-direction walk cycle (16 frames)',
    promptStyle: 'animation__four_angle_walking', tier: 'animation', category: 'animations',
    defaultWidth: 48, defaultHeight: 48, minSize: 48, maxSize: 48,
    fixedSize: true, costPerGeneration: 0.07, tokenCost: 15, isAnimation: true, supportsRemoveBg: false,
    resolutionMode: { kind: 'locked', size: 48 },
  },
  {
    id: 'anim-walking-idle', label: 'Walking & Idle', description: 'Walking + idle animation combined',
    promptStyle: 'animation__walking_and_idle', tier: 'animation', category: 'animations',
    defaultWidth: 48, defaultHeight: 48, minSize: 48, maxSize: 48,
    fixedSize: true, costPerGeneration: 0.07, tokenCost: 15, isAnimation: true, supportsRemoveBg: false,
    resolutionMode: { kind: 'locked', size: 48 },
  },
  {
    id: 'anim-small-sprites', label: 'Small Sprites', description: 'Multi-action small character sprite sheet',
    promptStyle: 'animation__small_sprites', tier: 'animation', category: 'animations',
    defaultWidth: 32, defaultHeight: 32, minSize: 32, maxSize: 32,
    fixedSize: true, costPerGeneration: 0.07, tokenCost: 15, isAnimation: true, supportsRemoveBg: false,
    resolutionMode: { kind: 'locked', size: 32 },
  },
  {
    id: 'anim-vfx', label: 'VFX Effects', description: 'Looping visual effects (fire, explosions, magic)',
    promptStyle: 'animation__vfx', tier: 'animation', category: 'animations',
    defaultWidth: 64, defaultHeight: 64, minSize: 24, maxSize: 96,
    fixedSize: false, costPerGeneration: 0.07, tokenCost: 15, isAnimation: true, supportsRemoveBg: false,
    resolutionMode: { kind: 'variable_special', min: 24, max: 96, default: 64, presets: [24, 48, 64, 96] },
  },
  {
    id: 'anim-any', label: 'Custom Animation', description: 'Open-ended animation — AI decides the layout',
    promptStyle: 'animation__any_animation', tier: 'animation', category: 'animations',
    defaultWidth: 64, defaultHeight: 64, minSize: 64, maxSize: 64,
    fixedSize: true, costPerGeneration: 0.07, tokenCost: 15, isAnimation: true, supportsRemoveBg: false,
    resolutionMode: { kind: 'locked', size: 64 },
  },
  {
    id: 'anim-8dir', label: '8-Direction Rotation', description: 'Character from 8 rotational angles',
    promptStyle: 'animation__8_dir_rotation', tier: 'animation', category: 'animations',
    defaultWidth: 80, defaultHeight: 80, minSize: 80, maxSize: 80,
    fixedSize: true, costPerGeneration: 0.07, tokenCost: 15, isAnimation: true, supportsRemoveBg: false,
    resolutionMode: { kind: 'locked', size: 80 },
  },
];

export function getStyleById(id: string): GenerationStyle | undefined {
  return GENERATION_STYLES.find((s) => s.id === id);
}

const TIER_LABELS: Record<StyleTier, string> = {
  pro: 'Pro',
  plus: 'Plus',
  fast: 'Fast',
  animation: 'Anim',
};

export function getTierLabel(tier: StyleTier): string {
  return TIER_LABELS[tier];
}

/**
 * Resolution presets for rd_advanced_animation__* styles (Animate tab).
 * These styles support variable per-frame resolution from 32 to 256.
 * Cost is flat regardless of resolution.
 */
export const ADVANCED_ANIM_RESOLUTION_PRESETS = [32, 64, 128, 256] as const;
export const ADVANCED_ANIM_DEFAULT_RESOLUTION = 128;
export const ADVANCED_ANIM_MIN_SIZE = 32;
export const ADVANCED_ANIM_MAX_SIZE = 256;

/** The Family B (rd_advanced_animation__*) shared resolution mode. */
const ADVANCED_ANIM_VARIABLE_MODE: ResolutionMode = {
  kind: 'variable',
  min: 32,
  max: 256,
  default: ADVANCED_ANIM_DEFAULT_RESOLUTION,
};

/**
 * Look up the resolution mode for a given prompt_style.
 *
 * - `rd_advanced_animation__*` (Family B): always variable 32–256, default 128.
 * - `animation__*` (Family A): mode comes from the registry entry.
 * - Any other style without explicit resolutionMode: returns `null` (caller
 *   should fall back to the registry's minSize/maxSize fields if needed).
 */
export function getResolutionMode(promptStyle: string): ResolutionMode | null {
  if (promptStyle.startsWith('rd_advanced_animation__')) {
    return ADVANCED_ANIM_VARIABLE_MODE;
  }
  const style = GENERATION_STYLES.find((s) => s.promptStyle === promptStyle);
  return style?.resolutionMode ?? null;
}

/**
 * Look up the token cost for a given prompt_style string.
 * Handles both Create New styles (in the registry) and Animate tab styles
 * (rd_advanced_animation__* which aren't in the registry).
 */
const EXPENSIVE_ANIM_STYLES = new Set([
  'rd_advanced_animation__custom_action',
  'rd_advanced_animation__subtle_motion',
]);

export function getTokenCost(promptStyle: string): number {
  // Check the registry first (Create New styles + standard animations)
  const style = GENERATION_STYLES.find((s) => s.promptStyle === promptStyle);
  if (style) return style.tokenCost;

  // Advanced animation styles (Animate tab) — not in the registry
  if (EXPENSIVE_ANIM_STYLES.has(promptStyle)) return 50;
  if (promptStyle.startsWith('rd_advanced_animation__')) return 15;
  if (promptStyle.startsWith('animation__')) return 15;

  // Unknown style — default to Plus tier
  return 10;
}

/**
 * Map a prompt_style → free-tier counter bucket. Fast styles use the `fast`
 * counter; everything else (Plus, Pro, Animation) rolls up under `pro`.
 */
export function getFreeTierBucket(promptStyle: string): 'pro' | 'fast' {
  const style = GENERATION_STYLES.find((s) => s.promptStyle === promptStyle);
  if (style?.tier === 'fast') return 'fast';
  return 'pro';
}
