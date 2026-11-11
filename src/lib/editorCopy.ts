/**
 * Words the modal Pixel Editor shows that depend on where it was opened
 * from: its Save changes the result card, a Sheet Tools frame, or the image
 * the caller holds. Pure; tested in scripts/edit-save-test.mjs.
 */

import type { SpriteProjectSource } from '@/lib/spriteProject';

export type SaveTarget = 'card' | 'frame' | 'image';

/** What Save changes: the result card for a generation, the frame for a
 *  sheet's frame, the caller's image otherwise (or when unknown). */
export function saveTargetOf(source: SpriteProjectSource | null | undefined): SaveTarget {
  if (source?.kind === 'generation') return 'card';
  if (source?.kind === 'sheet-import') return 'frame';
  return 'image';
}

/** The visible label of the header's download button, and its short form. */
export const DOWNLOAD_PNG_LABEL = 'Download PNG';
export const DOWNLOAD_PNG_SHORT = 'PNG';

/** The download button's tooltip and description: it saves a file and
 *  leaves the caller's image alone. */
export function downloadPngHint(source: SpriteProjectSource | null | undefined): string {
  const target = saveTargetOf(source);
  const subject = target === 'card' ? 'The card' : target === 'frame' ? 'The frame' : 'Your image';
  return `Download a PNG of this edit. ${subject} changes only when you Save.`;
}

/** The "Unsaved changes" dialog's text. */
export function unsavedEditsText(source: SpriteProjectSource | null | undefined): string {
  const target = saveTargetOf(source);
  if (target === 'card') return 'Your edits are not on the card yet. Save and close to use them.';
  if (target === 'frame') return 'Your edits are not on the frame yet. Save and close to use them.';
  return 'Your edits are not saved yet. Save and close to use them.';
}
