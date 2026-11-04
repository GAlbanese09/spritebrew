/**
 * Engine presets for the Export page (W3 of the competitive push, HQ
 * 2026-11-04-026 and -028): one pick per engine that chooses the format
 * the engine imports and the settings that suit it, with a short note on
 * how to bring the files in. The formats themselves are the existing
 * exporters in exportEngine.ts; a preset only chooses among them.
 *
 * - Godot 4: the SpriteFrames .tres with its PNG.
 * - Unity: the .aseprite file, which Unity's free 2D Aseprite Importer
 *   turns into clips; the PNG grid, sliced by cell size, is the fallback.
 * - GameMaker: one name_stripN.png per animation. GameMaker reads the
 *   frame count from the name, so there is no data file.
 *
 * Also the whole-number rule for the page's number fields and the tag
 * ranges the sheet exporters write. Pure, so it is tested offline
 * (scripts/export-presets-test.mjs).
 */

/** The export targets a preset can choose (ids in constants.ts ENGINE_TARGETS). */
export type PresetTarget = 'godot-tres' | 'aseprite' | 'gamemaker';

export type EnginePresetId = 'godot' | 'unity' | 'gamemaker';

export interface EnginePreset {
  id: EnginePresetId;
  /** The button's label. */
  label: string;
  target: PresetTarget;
  /** Settings the preset sets: no padding (cells sit edge to edge, so a
   *  grid sliced by cell size lines up), no power-of-two canvas, and the
   *  data file included. */
  padding: number;
  powerOfTwo: boolean;
  includeMetadata: boolean;
  /** How to import, shown under the row while the preset is chosen. */
  note: string;
}

export const ENGINE_PRESETS: readonly EnginePreset[] = [
  {
    id: 'godot',
    label: 'Godot 4',
    target: 'godot-tres',
    padding: 0,
    powerOfTwo: false,
    includeMetadata: true,
    note:
      'You get a PNG and a SpriteFrames .tres in one zip. Put both in your project folder, then choose the .tres as the Sprite Frames of an AnimatedSprite2D. Each animation keeps its name and speed.',
  },
  {
    id: 'unity',
    label: 'Unity',
    target: 'aseprite',
    padding: 0,
    powerOfTwo: false,
    includeMetadata: true,
    note:
      "You get an .aseprite file with its PNG and JSON. In Unity's Package Manager, add the free 2D Aseprite Importer (com.unity.2d.aseprite), then drop the .aseprite file into Assets: each animation becomes a clip. Without the package, slice the PNG by cell size in the Sprite Editor.",
  },
  {
    id: 'gamemaker',
    label: 'GameMaker',
    target: 'gamemaker',
    padding: 0,
    powerOfTwo: false,
    includeMetadata: true,
    note:
      'You get one PNG strip per animation, named like walk_strip8.png. Import each one as a sprite: GameMaker reads the frame count from the _strip8 ending and removes it from the name.',
  },
];

/** The preset with this id, or undefined. */
export function enginePreset(id: string): EnginePreset | undefined {
  return ENGINE_PRESETS.find((p) => p.id === id);
}

/**
 * A number field's value as a whole number between min and max. Canvases
 * have whole-pixel sizes, so a fractional size or padding (32.5) made every
 * format's frame rects disagree with the image by half a pixel (BUILD-2's
 * audit, HQ 2026-11-04-004). Rounds to the nearest whole number; an empty
 * or unreadable entry becomes min.
 */
export function wholeNumberIn(raw: string | number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export interface TagRange {
  /** Index of the animation in the list the exporter was given. */
  index: number;
  from: number;
  to: number;
}

/**
 * The frame range of each animation on a sheet laid out animation by
 * animation, from the number of frames actually written for each (a frame
 * with no image is skipped by the exporters' loader, so the animation's own
 * frame count can be larger). Animations with no frames written get no
 * range, and the next one starts where the last one ended.
 */
export function tagRanges(writtenCounts: readonly number[]): TagRange[] {
  const out: TagRange[] = [];
  let offset = 0;
  writtenCounts.forEach((count, index) => {
    if (!Number.isInteger(count) || count <= 0) return;
    out.push({ index, from: offset, to: offset + count - 1 });
    offset += count;
  });
  return out;
}
