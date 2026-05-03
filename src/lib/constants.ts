// Standard pixel art sprite sizes
export const SPRITE_SIZES = [
  { label: '16x16', width: 16, height: 16, description: 'Minimalist (Celeste, Shovel Knight)' },
  { label: '24x32', width: 24, height: 32, description: 'Classic RPG (early Final Fantasy)' },
  { label: '32x32', width: 32, height: 32, description: 'Sweet spot (Stardew Valley)' },
  { label: '48x48', width: 48, height: 48, description: 'RPG Maker MV/MZ default' },
  { label: '48x64', width: 48, height: 64, description: 'Detailed RPG characters' },
  { label: '64x64', width: 64, height: 64, description: 'Hi-bit (Dead Cells, Hyper Light Drifter)' },
  { label: '128x128', width: 128, height: 128, description: 'Large/detailed sprites' },
] as const;

/**
 * Canonical slicer frame size presets — single source of truth.
 *
 * Add a new preset HERE, and all slicer UIs (SlicerConfig pills, FrameSizeResizer
 * size buttons, SpriteDetector target-size pills, ImageResizer presets) pick it
 * up automatically.
 */
export const SLICER_FRAME_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: '16×16',   width: 16,  height: 16  },
  { label: '24×32',   width: 24,  height: 32  },
  { label: '32×32',   width: 32,  height: 32  },
  { label: '48×48',   width: 48,  height: 48  },
  { label: '48×64',   width: 48,  height: 64  },
  { label: '64×64',   width: 64,  height: 64  },
  { label: '128×128', width: 128, height: 128 },
  { label: '256×256', width: 256, height: 256 },
];

/**
 * Square-only sizes used by `detectFrameGrid`'s iterative fallback.
 * Kept ascending — order can matter inside the detector's iteration.
 */
export const SLICER_DETECT_TRY_SIZES: number[] = [16, 24, 32, 48, 64, 80, 96, 128, 256];

// Animation type presets
export const ANIMATION_TYPES = [
  { id: 'idle', label: 'Idle', defaultFrames: 4, defaultFps: 6, description: 'Breathing/subtle movement', defaultDirectional: false },
  { id: 'walk', label: 'Walk', defaultFrames: 6, defaultFps: 8, description: 'Standard walk cycle', defaultDirectional: true },
  { id: 'run', label: 'Run', defaultFrames: 8, defaultFps: 10, description: 'Fast movement', defaultDirectional: true },
  { id: 'attack', label: 'Attack', defaultFrames: 6, defaultFps: 12, description: 'Melee attack swing', defaultDirectional: false },
  { id: 'hurt', label: 'Hurt', defaultFrames: 3, defaultFps: 8, description: 'Taking damage flinch', defaultDirectional: false },
  { id: 'death', label: 'Death', defaultFrames: 6, defaultFps: 8, description: 'Death animation', defaultDirectional: false },
  { id: 'jump', label: 'Jump', defaultFrames: 6, defaultFps: 10, description: 'Jump arc phases', defaultDirectional: false },
  { id: 'cast', label: 'Cast/Magic', defaultFrames: 6, defaultFps: 8, description: 'Spell casting', defaultDirectional: false },
  { id: 'crouch', label: 'Crouch', defaultFrames: 4, defaultFps: 6, description: 'Crouch/duck', defaultDirectional: false },
  { id: 'destroy', label: 'Destroy', defaultFrames: 6, defaultFps: 8, description: 'Death/destruction', defaultDirectional: false },
  { id: 'subtle', label: 'Subtle Motion', defaultFrames: 4, defaultFps: 4, description: 'Wind, cape flutter', defaultDirectional: false },
  { id: 'custom', label: 'Custom Action', defaultFrames: 4, defaultFps: 8, description: 'Describe any action', defaultDirectional: false },
] as const;

// Export engine targets
export const ENGINE_TARGETS = [
  { id: 'texturepacker', label: 'TexturePacker JSON', engines: ['Unity', 'Godot', 'Phaser', 'PixiJS'] },
  { id: 'gamemaker', label: 'GameMaker Strip', engines: ['GameMaker Studio 2'] },
  { id: 'rpgmaker', label: 'RPG Maker MV/MZ', engines: ['RPG Maker MV', 'RPG Maker MZ'] },
  { id: 'aseprite', label: 'Aseprite JSON', engines: ['Aseprite', 'Phaser 3'] },
  { id: 'godot-tres', label: 'Godot SpriteFrames', engines: ['Godot 4'] },
  { id: 'raw-frames', label: 'Individual Frames (PNG)', engines: ['Any'] },
] as const;

// ── Free-tier lifetime caps (S15 anti-farming) ──
// Apply only to users who have not yet purchased tokens (no purchase:{userId}:has_paid flag).
// Plus / Pro / Animation all roll up under the Pro counter; Fast has its own counter.
// Admin user IDs (see generationLimits.ts) bypass these caps.
export const FREE_TIER_LIFETIME_PRO_CAP = 10;
export const FREE_TIER_LIFETIME_FAST_CAP = 30;

// ── Signup / earn-back bonuses (S16 — engagement-driven rewards) ──
// Email-verify earn-back removed: bots can pass OTP trivially, so it added no
// real signal. Replaced with newsletter signup (real engagement) + daily login
// streak (bot-resistant via the open-the-app gate).
export const SIGNUP_BONUS_TOKENS = 5;            // was 30 — theater reduction
export const EARLY_ADOPTER_BONUS_TOKENS = 200;   // grandfather clause — unchanged
export const EMAIL_LIST_BONUS_TOKENS = 5;        // newsletter subscribe — real signal
export const DAILY_LOGIN_TOKENS = 3;             // per-day visit reward
export const STREAK_WEEKLY_BONUS_TOKENS = 6;     // every 7th consecutive day → doubled
export const STREAK_INTERVAL_DAYS = 7;
// Earn-back KV flags retained for analytics — no longer written for email_verified.
// Discord / first-share remain wired but unused (no UI trigger yet).
export const EARN_BACK_DISCORD_JOINED_TOKENS = 40;
export const EARN_BACK_FIRST_SHARE_TOKENS = 20;
export const EARN_BACK_FLAG_TTL_SECONDS = 50 * 24 * 60 * 60; // 50 days

// Demo area keyboard controls
export const DEMO_CONTROLS = {
  move: { keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], alt: ['a', 'd', 'w', 's'], description: 'Move character' },
  run: { keys: ['Shift'], description: 'Hold to run (with arrow keys)' },
  attack: { keys: ['Space'], description: 'Attack animation' },
  jump: { keys: ['z', 'Z'], description: 'Jump animation' },
  hurt: { keys: ['x', 'X'], description: 'Trigger hurt animation' },
  reset: { keys: ['r', 'R'], description: 'Reset position to center' },
} as const;
