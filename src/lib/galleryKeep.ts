/**
 * What the Gallery keeps when the person leaves it, so a return in the same
 * visit lands where they were (HQ room 2026-11-14-077, DESIGN -074, -230):
 * the loaded list, its pictures, where paging stands, the filter tab and
 * the scroll position. In memory only, never written to the device: it ends
 * with a reload or a closed tab, and an account change or a sign-out drops
 * it. Pictures for at most KEEP_CAP generations are kept between visits.
 *
 * Pure but for one module-level slot: no React, no DOM, no fetch.
 */
import type { GalleryEntryV1 } from '@/lib/galleryTypes';
import type { GalleryFilter } from '@/lib/galleryPaging';

/** Generations whose pictures are kept between visits (DESIGN -230). */
export const KEEP_CAP = 200;

/** One list page as it was read: its entries, and the cursor after it. */
export interface KeptPage {
  ids: string[];
  cursor: string | null;
}

export interface KeptGallery {
  userId: string;
  /** The loaded list, in the order shown. */
  entries: GalleryEntryV1[];
  /** Each kept entry's picture. */
  pictures: Record<string, Blob>;
  /** The cursor after the last kept page; null when the list was read to its end. */
  cursor: string | null;
  /** More than the first page was read. */
  paged: boolean;
  /** The true total, when it was known. */
  total: number | null;
  filter: GalleryFilter;
  /** The ids deleted in the visit that kept this: a return's first page
   *  read must not bring them back (AUDIT keep-place r1, M2). */
  gone: string[];
  /** The kinds a Clear emptied in that visit (AUDIT keep-place r1, L2). */
  emptied: GalleryFilter[];
  /** The page area's scroll position, in CSS pixels. */
  scrollTop: number;
  /** The pages read, in order. Entries in none of them (new ones a return
   *  put on top) always stay. */
  pages: KeptPage[];
}

/**
 * The state cut to at most `cap` entries at a page boundary, so its cursor
 * reads on from the first entry that was let go. Entries in no page stay
 * whatever the cap. Pictures go with their entries.
 */
export function capKept(state: KeptGallery, cap = KEEP_CAP): KeptGallery {
  const inPage = new Set(state.pages.flatMap((page) => page.ids));
  let keep = state.entries.filter((e) => !inPage.has(e.jobId)).length;
  let pages = 0;
  for (const page of state.pages) {
    const ids = new Set(page.ids);
    const count = state.entries.filter((e) => ids.has(e.jobId)).length;
    if (keep + count > cap && pages > 0) break;
    keep += count;
    pages += 1;
  }
  if (pages === state.pages.length) return state;
  const kept = new Set(state.pages.slice(0, pages).flatMap((page) => page.ids));
  const entries = state.entries.filter((e) => !inPage.has(e.jobId) || kept.has(e.jobId));
  const pictures: Record<string, Blob> = {};
  for (const e of entries) if (state.pictures[e.jobId]) pictures[e.jobId] = state.pictures[e.jobId];
  // Every page was read, so the whole count is known: the line keeps saying
  // it ("260 generations"), not "200+", though fewer are kept.
  const total = state.total === null && state.cursor === null ? state.entries.length : state.total;
  return { ...state, entries, pictures, total, cursor: state.pages[pages - 1].cursor, pages: state.pages.slice(0, pages) };
}

/**
 * The quiet read on a return: the first list page against what was kept
 * (AUDIT keep-place r1, M1 and M2).
 * - `fresh`: the new generations, newest first, to go on top: only what
 *   stands on the page before the first kept generation. One further down
 *   is older and comes with paging.
 * - `removed`: kept generations the server no longer has: those the page
 *   covers (every kept one down to the last kept one on the page, or all of
 *   them when the page is the whole list) but does not hold. An empty page
 *   is an empty list.
 * - `gap`: the page holds nothing that was kept (more new generations than
 *   a page): the kept list may not follow on from it, so read from the top.
 */
export function quietMerge(
  kept: readonly GalleryEntryV1[],
  first: readonly GalleryEntryV1[],
  gone: ReadonlySet<string> = new Set(),
  whole = false,
): { fresh: GalleryEntryV1[]; removed: string[]; gap: boolean } {
  if (first.length === 0) return { fresh: [], removed: kept.map((e) => e.jobId), gap: false };
  const known = new Set(kept.map((e) => e.jobId));
  const at = first.findIndex((e) => known.has(e.jobId));
  if (at < 0) {
    if (whole) return { fresh: first.filter((e) => !gone.has(e.jobId)), removed: kept.map((e) => e.jobId), gap: false };
    return { fresh: [], removed: [], gap: kept.length > 0 };
  }
  const fresh = first.slice(0, at).filter((e) => !gone.has(e.jobId));
  const onPage = new Set(first.map((e) => e.jobId));
  let last = -1;
  kept.forEach((e, i) => { if (onPage.has(e.jobId)) last = i; });
  const covered = whole ? kept : kept.slice(0, last + 1);
  const removed = covered.filter((e) => !onPage.has(e.jobId)).map((e) => e.jobId);
  return { fresh, removed, gap: false };
}

let slot: KeptGallery | null = null;

/** Keeps the Gallery as it is now, cut to the cap. */
export function keepGallery(state: KeptGallery, cap = KEEP_CAP): void {
  slot = capKept(state, cap);
}

/** What was kept for this account, or null. A state kept for another
 *  account, or for none, is dropped. */
export function takeKept(userId: string | null | undefined): KeptGallery | null {
  if (!slot) return null;
  if (!userId || slot.userId !== userId) {
    slot = null;
    return null;
  }
  return slot;
}

/** Drops what was kept (a sign-out, or a visit that must not be kept). */
export function dropKept(): void {
  slot = null;
}
