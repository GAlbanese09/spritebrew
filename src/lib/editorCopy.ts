/**
 * Words the modal Pixel Editor shows that depend on where it was opened
 * from: its Save changes the result card, a Sheet Tools frame, or the image
 * the caller holds. Pure; tested in scripts/edit-save-test.mjs. Also the
 * full-page editor's leave question and the question before a draft is
 * discarded (scripts/editor-draft-safety-test.mjs).
 */

import type { SpriteProjectSource } from '@/lib/spriteProject';
import { draftListLine } from '@/lib/editorRecovery/drafts';
import type { RecoveryManifestV1 } from '@/lib/editorRecovery/types';

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

/** How the full-page editor's work is kept when its leave question shows:
 *  the write of what is on screen has landed (or there is nothing to keep),
 *  is still on its way, or failed or cannot be made in this browser (SB-25,
 *  the outside audit of Nov 24, 2026). */
export type LeaveSaveState = 'saved' | 'saving' | 'unsaved';

/** The leave question's text for each state. Only "saved" says the edits
 *  are on this device; "unsaved" points to the download instead. */
export function leaveEditorText(state: LeaveSaveState): string {
  if (state === 'saved') return 'Your edits are saved on this device. You can restore them from the Editor.';
  if (state === 'saving') return 'Saving your edits on this device\u2026';
  return `Your edits could not be saved on this device. Use ${DOWNLOAD_PNG_LABEL} to keep a copy, or keep editing.`;
}

/** The leave question's way out when the edits are not saved. */
export const LEAVE_ANYWAY_LABEL = 'Leave anyway';

/** What the leave question shows for a save state, once it has or has not
 *  waited its while for the save (EditorLeaveDialog): a save still on its
 *  way after that wait counts as not saved. Download PNG only when the
 *  edits are not saved; Leave waits while they are being saved. `quiet`:
 *  a save on its way that has not yet taken `savingShown`'s while says
 *  nothing, so a quick save never reads saving and then saved (DESIGN
 *  2026-11-25-067). */
export function leaveDialogView(state: LeaveSaveState, waitedOut: boolean, savingShown = true): {
  state: LeaveSaveState; text: string; download: boolean; leaveLabel: string; leaveEnabled: boolean; quiet: boolean;
} {
  const shown: LeaveSaveState = state === 'saving' && waitedOut ? 'unsaved' : state;
  return {
    state: shown,
    text: leaveEditorText(shown),
    download: shown === 'unsaved',
    leaveLabel: shown === 'unsaved' ? LEAVE_ANYWAY_LABEL : 'Leave',
    leaveEnabled: shown !== 'saving',
    quiet: shown === 'saving' && !savingShown,
  };
}

/** The question before a draft is deleted (SB-04): which draft, and that
 *  it cannot be brought back. */
export const DISCARD_DRAFT_TITLE = 'Discard this draft?';
export function discardDraftSentence(what: string): string {
  return `${what}. Discarding deletes it from this device, and it can't be undone.`;
}
export function discardDraftText(m: RecoveryManifestV1, now: number = Date.now()): string {
  return discardDraftSentence(draftListLine(m, now));
}
/** The same question on the screen of a draft that could not be opened. */
export function discardBrokenDraftText(width: number, height: number): string {
  return discardDraftSentence(`A ${width}\u00d7${height} draft that could not be opened`);
}
export const KEEP_DRAFT_LABEL = 'Keep draft';
export const DISCARD_DRAFT_LABEL = 'Discard';

/** See-through paint from the eyedropper (SB-28, the outside audit of Nov
 *  24, 2026; DESIGN 2026-11-25-034): its opacity as a whole percent, never
 *  0 or 100 while the paint is see-through. */
export function opacityPercent(alpha: number): number {
  if (alpha >= 255) return 100;
  return Math.min(99, Math.max(1, Math.round((alpha * 100) / 255)));
}
/** The line under the swatch while the paint is see-through. */
export function opacityLine(alpha: number): string {
  return `Opacity ${opacityPercent(alpha)}%`;
}
export const MAKE_OPAQUE_LABEL = 'Make opaque';
/** A colour control's name, with the opacity added while it is see-through. */
export function colorControlName(name: string, alpha: number): string {
  return alpha < 255 ? `${name}, opacity ${opacityPercent(alpha)}%` : name;
}
