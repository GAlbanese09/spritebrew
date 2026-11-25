/**
 * RPG Maker's direction mapping on /export (external audit SB-02). A
 * direction may use only an animation that is checked and has frames; a
 * direction set to one that is then unchecked reads as none. The sheet is
 * worth downloading only when at least one direction has an animation. Rows
 * left as none are kept on purpose: they export empty.
 */

interface MappableAnimation {
  id: string;
  frames: readonly { id: string }[];
}

/** RPG Maker MV/MZ character sheets: 3 frames across, 4 directions down
 *  (Down, Left, Right, Up). */
export const RPG_COLS = 3;
export const RPG_ROWS = 4;

/** One direction's row: its animation and the frame in each of the three
 *  cells. */
export interface RpgRow {
  animId: string;
  frameIds: string[];
}

/** The animations a direction may use: the checked ones with frames. */
export function rpgChoices<A extends MappableAnimation>(active: readonly A[]): A[] {
  return active.filter((a) => a.frames.length > 0);
}

/** The direction map as it applies to the checked animations: a direction
 *  set to anything else reads as none. */
export function rpgMapInUse(map: readonly (string | null)[], active: readonly MappableAnimation[]): (string | null)[] {
  const ids = new Set(rpgChoices(active).map((a) => a.id));
  return map.map((id) => (id !== null && ids.has(id) ? id : null));
}

/** Whether at least one direction has a checked animation with frames. */
export function rpgHasRow(map: readonly (string | null)[], active: readonly MappableAnimation[]): boolean {
  return rpgMapInUse(map, active).some((id) => id !== null);
}

/**
 * The sheet's rows, the same for the preview and the download (external
 * audit SB-07): a mapped direction takes its animation's first three frames
 * that have an image, repeating them when there are fewer; an unmapped
 * direction, or one with no frame image, is an empty row.
 */
export function rpgRows(
  map: readonly (string | null)[],
  active: readonly MappableAnimation[],
  hasImage: (frameId: string) => boolean = () => true,
): (RpgRow | null)[] {
  const inUse = rpgMapInUse(map, active);
  return Array.from({ length: RPG_ROWS }, (_, row) => {
    const animId = inUse[row] ?? null;
    if (animId === null) return null;
    const anim = active.find((a) => a.id === animId);
    const ids = (anim?.frames ?? []).map((f) => f.id).filter(hasImage);
    if (ids.length === 0) return null;
    return { animId, frameIds: Array.from({ length: RPG_COLS }, (_, c) => ids[c % ids.length]) };
  });
}

/**
 * The line for an animation longer than a row (AUDIT ext-mediums r1 L9):
 * the card shows it under the direction while it is mapped, and the
 * exporter warns with it. Null when the row holds every frame.
 */
export function rpgCutNote(name: string, frames: number): string | null {
  return frames > RPG_COLS ? `"${name}" has ${frames} frames but RPG Maker uses ${RPG_COLS} per direction. Extra frames ignored.` : null;
}

/** Whether a warning is the cut line, which the card already shows under
 *  its direction (AUDIT ext-mediums r2 L9). */
export function isRpgCutNote(line: string): boolean {
  return / frames but RPG Maker uses \d+ per direction\. Extra frames ignored\.$/.test(line);
}
