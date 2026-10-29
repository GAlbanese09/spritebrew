/**
 * editorRecovery / drafts.ts: which saved editor drafts to offer, and how to
 * name them (BUILD 2026-10-29, after a modal session was lost on an iPhone
 * reload). Pure, so the rules are tested offline.
 *
 * Every editor session, on the modal or the full page, saves under its own
 * draft key, so a new session never overwrites an older one. MAX_DRAFTS are
 * kept, the work a crash left behind longest. A draft an account made is
 * offered only to that account. The Editor lists an account's drafts,
 * newest first; Generate offers the newest one whose session did not end
 * the way the user chose (a reload or a crash).
 */

import type { SpriteProjectSource } from '@/lib/spriteProject';
import type { RecoveryManifestV1 } from './types';

export type DraftSurface = 'modal' | 'page';

/** How many drafts are kept on a device. */
export const MAX_DRAFTS = 5;

/** A new session's draft key: its surface, then a time and random part. */
export function newDraftKey(surface: DraftSurface): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${surface}:${Date.now().toString(36)}-${rand}`;
}

/** Whether `owner` (the signed-in user id, or null when signed out) may see,
 *  restore or discard the draft: its own, or one no account owns. */
export function draftVisibleTo(m: Pick<RecoveryManifestV1, 'owner'>, owner: string | null): boolean {
  return m.owner === undefined || m.owner === null || m.owner === owner;
}

/** The drafts this account may see, newest first, at most MAX_DRAFTS: its
 *  own, plus the device's drafts that no account owns, which are shown to
 *  anyone, as the Editor did before: drafts made signed out (owner null; so
 *  signing in does not hide them) and drafts saved before owners were
 *  recorded (no owner field). Another account's drafts never. `owner` is
 *  the signed-in user id, or null when signed out. */
export function draftsFor(manifests: readonly RecoveryManifestV1[], owner: string | null): RecoveryManifestV1[] {
  return manifests
    .filter((m) => draftVisibleTo(m, owner))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFTS);
}

/** The draft Generate offers: this account's own newest draft whose session
 *  did not end by the user's choice. Drafts no account owns are listed on
 *  the Editor only: a draft saved before owners were recorded may well have
 *  ended normally, and a signed-out one may be someone else's on a shared
 *  device. */
export function unfinishedDraft(manifests: readonly RecoveryManifestV1[], owner: string | null): RecoveryManifestV1 | null {
  return draftsFor(manifests, owner).find((m) => m.owner === owner && m.closedAt === undefined) ?? null;
}

/** True for a draft Generate could offer: a session a reload or a crash
 *  interrupted (owned, not closed). */
function interrupted(m: RecoveryManifestV1): boolean {
  return m.owner !== undefined && m.closedAt === undefined;
}

/** The drafts to delete so that at most `keep` stay on the device. Drafts
 *  whose session ended by choice and drafts from before owners were
 *  recorded go first, oldest first; a draft a reload or a crash interrupted
 *  goes only after all of those, so new sessions do not push out the work
 *  a crash left behind. `protectDraftId` (the session saving now) stays. */
export function draftsToPrune(
  manifests: readonly RecoveryManifestV1[],
  keep: number,
  protectDraftId?: string,
): RecoveryManifestV1[] {
  let excess = manifests.length - keep;
  if (excess <= 0) return [];
  const order = manifests
    .filter((m) => m.draftId !== protectDraftId)
    .sort((a, b) => Number(interrupted(a)) - Number(interrupted(b)) || a.updatedAt - b.updatedAt);
  const out: RecoveryManifestV1[] = [];
  for (const m of order) {
    if (excess <= 0) break;
    out.push(m);
    excess--;
  }
  return out;
}

/** Where the draft's image came from, as the restore messages say it. */
export function draftSourceLabel(source: SpriteProjectSource | undefined): string {
  switch (source?.kind) {
    case 'generation': return 'from a generated sheet';
    case 'sheet-import': return 'from a Slicer frame';
    case 'upload': return 'from an uploaded image';
    case 'blank': return 'from a blank canvas';
    case 'gallery': return 'from your Gallery';
    default: return 'from the editor';
  }
}

/** "just now", "5 minutes ago", "2 hours ago", "1 day ago". */
export function formatDraftAge(updatedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - updatedAt);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The clock time on the same day ("9:42 AM"), else the date ("Oct 19"). */
export function formatDraftClock(updatedAt: number, now: number = Date.now()): string {
  const at = new Date(updatedAt);
  const today = new Date(now);
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
  return sameDay
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const TIMES = String.fromCharCode(0xd7);
const DOT = String.fromCharCode(0xb7);

/** The restore message for a draft (George's copy, BUILD 2026-10-29): "A
 *  512 x 512 draft from 10 minutes ago (9:42 AM), from a generated sheet, is
 *  saved on this device." (with the multiplication sign). */
export function draftSentence(m: RecoveryManifestV1, now: number = Date.now()): string {
  const { width, height } = m.summary;
  return `A ${width}${TIMES}${height} draft from ${formatDraftAge(m.updatedAt, now)} (${formatDraftClock(m.updatedAt, now)}), ${draftSourceLabel(m.project.source)}, is saved on this device.`;
}

/** One line of the Editor's older drafts: "512 x 512 . from a Slicer frame .
 *  2 days ago" (with the multiplication sign and middle dots). */
export function draftListLine(m: RecoveryManifestV1, now: number = Date.now()): string {
  const { width, height } = m.summary;
  return `${width}${TIMES}${height} ${DOT} ${draftSourceLabel(m.project.source)} ${DOT} ${formatDraftAge(m.updatedAt, now)}`;
}
