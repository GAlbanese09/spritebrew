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

// Animation type presets
export const ANIMATION_TYPES = [
  { id: 'idle', label: 'Idle', defaultFrames: 4, defaultFps: 6, description: 'Breathing/subtle movement' },
  { id: 'walk', label: 'Walk', defaultFrames: 6, defaultFps: 8, description: 'Standard walk cycle' },
  { id: 'run', label: 'Run', defaultFrames: 8, defaultFps: 10, description: 'Fast movement' },
  { id: 'attack', label: 'Attack', defaultFrames: 6, defaultFps: 12, description: 'Melee attack swing' },
  { id: 'hurt', label: 'Hurt', defaultFrames: 3, defaultFps: 8, description: 'Taking damage flinch' },
  { id: 'death', label: 'Death', defaultFrames: 6, defaultFps: 8, description: 'Death animation' },
  { id: 'jump', label: 'Jump', defaultFrames: 6, defaultFps: 10, description: 'Jump arc phases' },
  { id: 'cast', label: 'Cast/Magic', defaultFrames: 6, defaultFps: 8, description: 'Spell casting' },
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

// Demo area keyboard controls
export const DEMO_CONTROLS = {
  move: { keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], alt: ['a', 'd', 'w', 's'], description: 'Move character' },
  run: { keys: ['Shift'], description: 'Hold to run (with arrow keys)' },
  attack: { keys: ['Space'], description: 'Attack animation' },
  jump: { keys: ['z', 'Z'], description: 'Jump animation' },
  hurt: { keys: ['x', 'X'], description: 'Trigger hurt animation' },
  reset: { keys: ['r', 'R'], description: 'Reset position to center' },
} as const;
