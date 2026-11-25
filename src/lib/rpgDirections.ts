/**
 * RPG Maker's direction mapping on /export (external audit SB-02). A
 * direction may use only an animation that is checked and has frames; a
 * direction set to one that is then unchecked reads as none. The sheet is
 * worth downloading only when at least one direction has an animation. Rows
 * left as none are kept on purpose: they export empty.
 */

interface MappableAnimation {
  id: string;
  frames: readonly unknown[];
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
