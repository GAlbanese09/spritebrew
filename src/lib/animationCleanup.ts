/**
 * The whole cleanup an Animate result gets, on the result card in both forms
 * and in the Gallery: the pink cleanup (fillCleanup's cleanAnimation: the
 * fill pockets keyed when `key`, the rim despilled, its bright rule when
 * `bright`), then the purple residue cleanup (residueCleanup's cleanResidue)
 * when `bright`. Clean by default (George, Oct 31; HQ 2026-10-31-057, -059;
 * HQ 2026-11-24-012): `bright` means the character sent is known to have had
 * no mostly-magenta colours of its own (characterColours), so it has no
 * residue-coloured art to protect and every residue run on the sheet came
 * from the fill. A character with such colours of its own keeps the pink
 * cleanup only; the editor's Clean residue is the way to clean that sheet.
 * By default only residue runs that touch the outside are cleared: an
 * enclosed run may be a small violet detail the model drew itself (a gem, a
 * seam), which `bright` cannot rule out, so enclosed runs are left to the
 * editor's Clean residue, where a person sees them first (AUDIT
 * clean-default-r1 M1).
 * Pure: in place on the RGBA bytes; returns the counts, so a caller can keep
 * an untouched sheet as it was.
 */
import { cleanAnimation } from './fillCleanup';
import { cleanResidue } from './residueCleanup';

export interface AnimationCleanupCounts {
  keyed: number;
  despilled: number;
  residueCleared: number;
  residueDespilled: number;
}

export function cleanAnimationSheet(
  px: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  fillHex: string,
  opts: { key: boolean; bright: boolean }
): AnimationCleanupCounts {
  const { keyed, despilled } = cleanAnimation(px, W, H, fillHex, opts);
  const residue = opts.bright ? cleanResidue(px, W, H, [], { enclosed: false }) : { cleared: 0, despilled: 0 };
  return { keyed, despilled, residueCleared: residue.cleared, residueDespilled: residue.despilled };
}

/** Whether a cleanup changed any pixel. */
export function cleanupChanged(c: AnimationCleanupCounts): boolean {
  return c.keyed + c.despilled + c.residueCleared + c.residueDespilled > 0;
}
