/**
 * Style registry — single source of truth for all generation styles on the
 * Create New tab. Each entry maps to a Retro Diffusion prompt_style value.
 */

export type StyleCategory = 'characters' | 'items' | 'environments' | 'animations' | 'tiles' | 'ui';
export type StyleTier = 'fast' | 'plus' | 'pro' | 'animation';

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
  isAnimation: boolean;
  supportsRemoveBg: boolean;
}

export const GENERATION_STYLES: GenerationStyle[] = [
  // ── RD PRO ($0.22/image, 96-256px) ──
  {
    id: 'pro-default', label: 'Character (Pro)', description: 'Clean modern pixel art with detailed prompting',
    promptStyle: 'rd_pro__default', tier: 'pro', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'pro-fantasy', label: 'Fantasy', description: 'Fantasy-themed characters and scenes',
    promptStyle: 'rd_pro__fantasy', tier: 'pro', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'pro-platformer', label: 'Platformer', description: 'Side-scrolling platformer characters',
    promptStyle: 'rd_pro__platformer', tier: 'pro', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'pro-spritesheet', label: 'Sprite Collection', description: 'Multiple assets in the same style on one sheet',
    promptStyle: 'rd_pro__spritesheet', tier: 'pro', category: 'characters',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: false,
  },
  {
    id: 'pro-inventory', label: 'Inventory Items', description: 'RPG-style inventory item grids',
    promptStyle: 'rd_pro__inventory_items', tier: 'pro', category: 'items',
    defaultWidth: 256, defaultHeight: 256, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: false,
  },
  {
    id: 'pro-fps-weapon', label: 'FPS Weapon', description: 'First-person perspective weapons and items',
    promptStyle: 'rd_pro__fps_weapon', tier: 'pro', category: 'items',
    defaultWidth: 128, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'pro-hex-tiles', label: 'Hexagonal Tiles', description: 'Hexagonal tiles for game maps',
    promptStyle: 'rd_pro__hexagonal_tiles', tier: 'pro', category: 'tiles',
    defaultWidth: 128, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: false,
  },
  {
    id: 'pro-typography', label: 'Typography', description: 'Pixel art logos, buttons, and text elements',
    promptStyle: 'rd_pro__typography', tier: 'pro', category: 'ui',
    defaultWidth: 256, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, costPerGeneration: 0.22, isAnimation: false, supportsRemoveBg: true,
  },

  // ── RD PLUS ($0.025-0.06/image, 16-192px) ──
  {
    id: 'plus-classic', label: 'Classic Pixel Art', description: 'Strongly outlined, simple shading, clear design',
    promptStyle: 'rd_plus__classic', tier: 'plus', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 32, maxSize: 192,
    fixedSize: false, costPerGeneration: 0.06, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-low-res', label: 'Low Resolution', description: 'High quality low-res pixel art (16-128px)',
    promptStyle: 'rd_plus__low_res', tier: 'plus', category: 'characters',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-skill-icon', label: 'Skill / Spell Icon', description: 'Icons for skills, abilities, or spells',
    promptStyle: 'rd_plus__skill_icon', tier: 'plus', category: 'ui',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-topdown-item', label: 'Top-Down Item', description: 'Items and objects from a top-down view',
    promptStyle: 'rd_plus__topdown_item', tier: 'plus', category: 'items',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'plus-mc-item', label: 'Minecraft Item', description: 'Minecraft-styled items and game assets',
    promptStyle: 'rd_plus__mc_item', tier: 'plus', category: 'items',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, costPerGeneration: 0.05, isAnimation: false, supportsRemoveBg: true,
  },

  // ── RD FAST ($0.015-0.02/image, 64-384px) ──
  {
    id: 'fast-retro', label: 'Retro Arcade', description: 'Fast retro arcade style pixel art',
    promptStyle: 'rd_fast__retro', tier: 'fast', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 64, maxSize: 384,
    fixedSize: false, costPerGeneration: 0.02, isAnimation: false, supportsRemoveBg: true,
  },
  {
    id: 'fast-no-style', label: 'No Style (Fast)', description: 'Fast generation with no style influence',
    promptStyle: 'rd_fast__no_style', tier: 'fast', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 64, maxSize: 384,
    fixedSize: false, costPerGeneration: 0.02, isAnimation: false, supportsRemoveBg: true,
  },

  // ── STANDARD ANIMATION ($0.07/image, fixed sizes) ──
  {
    id: 'anim-4angle-walking', label: '4-Angle Walking', description: '4-direction walk cycle (16 frames)',
    promptStyle: 'animation__four_angle_walking', tier: 'animation', category: 'animations',
    defaultWidth: 48, defaultHeight: 48, minSize: 48, maxSize: 48,
    fixedSize: true, costPerGeneration: 0.07, isAnimation: true, supportsRemoveBg: false,
  },
  {
    id: 'anim-walking-idle', label: 'Walking & Idle', description: 'Walking + idle animation combined',
    promptStyle: 'animation__walking_and_idle', tier: 'animation', category: 'animations',
    defaultWidth: 48, defaultHeight: 48, minSize: 48, maxSize: 48,
    fixedSize: true, costPerGeneration: 0.07, isAnimation: true, supportsRemoveBg: false,
  },
  {
    id: 'anim-small-sprites', label: 'Small Sprites', description: 'Multi-action small character sprite sheet',
    promptStyle: 'animation__small_sprites', tier: 'animation', category: 'animations',
    defaultWidth: 32, defaultHeight: 32, minSize: 32, maxSize: 32,
    fixedSize: true, costPerGeneration: 0.07, isAnimation: true, supportsRemoveBg: false,
  },
  {
    id: 'anim-vfx', label: 'VFX Effects', description: 'Looping visual effects (fire, explosions, magic)',
    promptStyle: 'animation__vfx', tier: 'animation', category: 'animations',
    defaultWidth: 64, defaultHeight: 64, minSize: 24, maxSize: 96,
    fixedSize: false, costPerGeneration: 0.07, isAnimation: true, supportsRemoveBg: false,
  },
  {
    id: 'anim-any', label: 'Custom Animation', description: 'Open-ended animation — AI decides the layout',
    promptStyle: 'animation__any_animation', tier: 'animation', category: 'animations',
    defaultWidth: 64, defaultHeight: 64, minSize: 64, maxSize: 64,
    fixedSize: true, costPerGeneration: 0.07, isAnimation: true, supportsRemoveBg: false,
  },
  {
    id: 'anim-8dir', label: '8-Direction Rotation', description: 'Character from 8 rotational angles',
    promptStyle: 'animation__8_dir_rotation', tier: 'animation', category: 'animations',
    defaultWidth: 80, defaultHeight: 80, minSize: 80, maxSize: 80,
    fixedSize: true, costPerGeneration: 0.07, isAnimation: true, supportsRemoveBg: false,
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
