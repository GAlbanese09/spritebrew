'use client';

import { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Scissors, Trash2, Images, Sparkles, Play, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/react';
import JSZip from 'jszip';
import { type GalleryEntryV1, deriveSlicerHints } from '@/lib/galleryTypes';
import { loadHistory, type GenerationHistoryEntry } from '@/lib/generationHistory';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import SheetLoop from '@/components/sprites/SheetLoop';
import { sheetGeometry, galleryFrameSizeGuess } from '@/lib/animationGeometry';
import { cleanGallerySheet } from '@/lib/spriteUtils';
import { jobGuards } from '@/lib/jobGuards';
import { createGalleryOwnership } from '@/lib/galleryOwnership';
import { dropKept, keepGallery, quietMerge, takeKept, type KeptGallery, type KeptPage } from '@/lib/galleryKeep';
import {
  END_LINE,
  GALLERY_PAGE_SIZE,
  clearCountingLine,
  clearDeletingLine,
  clearUnconfirmedLine,
  deleteEntry,
  deleteOutcome,
  DELETE_FAILED_LINE,
  clearFailedLine,
  clearGallery,
  clearKeptLine,
  clearStaleLine,
  clearLabel,
  clearNoneLine,
  clearedLine,
  CLEARED_HEADING,
  countLine,
  matchesFilter,
  entryKind,
  noneAtEndLine,
  noneYetLine,
  noneNextLine,
  newAtTopLine,
  showNewLabel,
  showNewName,
  newWaitingLine,
  passEndLine,
  passGoal,
  runGalleryPass,
  type GalleryFilter,
  type GalleryListPage,
} from '@/lib/galleryPaging';

type FilterMode = GalleryFilter;

/** One page of the list: the first for a null cursor. Rejects when the read
 *  fails. */
async function readListPage(token: string, cursor: string | null): Promise<GalleryListPage> {
  const after = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
  const resp = await fetch(`/api/gallery?limit=${GALLERY_PAGE_SIZE}${after}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`gallery list ${resp.status}`);
  const body = (await resp.json()) as { entries: GalleryEntryV1[]; cursor?: string | null };
  return { entries: body.entries, cursor: body.cursor ?? null };
}

/** The pictures of a page's entries, read in parallel. A picture that fails
 *  is skipped: its card shows the placeholder. */
async function readPictures(
  token: string,
  entries: GalleryEntryV1[]
): Promise<{ urls: Record<string, string>; stored: Record<string, Blob>; blobs: Record<string, Blob> }> {
  const urls: Record<string, string> = {};
  const stored: Record<string, Blob> = {};
  // Every picture's bytes, so a return to the Gallery can show it again
  // without reading it (galleryKeep.ts).
  const blobs: Record<string, Blob> = {};
  await Promise.all(
    entries.map(async (e) => {
      try {
        const imgResp = await fetch(`/api/gallery/image/${e.jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (imgResp.ok) {
          const blob = await imgResp.blob();
          urls[e.jobId] = URL.createObjectURL(blob);
          blobs[e.jobId] = blob;
          if (e.mode === 'animate') stored[e.jobId] = blob;
        }
      } catch {
        // A picture that fails is skipped: its entry still shows, with the placeholder.
      }
    })
  );
  return { urls, stored, blobs };
}

// Phase 2 (server-side gallery writes) shipped May 20, 2026 ~14:00 UTC.
// Conservative cutoff at 12:00 UTC catches all entries that definitively pre-date
// server-side persistence. A few hours of overlap means some Day-9 morning entries
// may show as both "legacy" (in the banner) and "server" (in the synced grid) —
// harmless; the customer just gets a backup copy.
const PHASE_2_SHIP_TS = new Date('2026-05-20T12:00:00Z').getTime();

// Banner self-removes after this date. Code stays for Phase 5+ cleanup commit.
const LEGACY_BANNER_SUNSET_TS = new Date('2026-06-05T00:00:00Z').getTime();

const LEGACY_BANNER_DISMISSED_KEY = 'spritebrew_legacy_banner_dismissed';

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
}

export default function GalleryPage() {
  const { userId, getToken } = useAuth();
  const router = useRouter();
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setCurrentSheetMetadata = useSpriteStore((s) => s.setCurrentSheetMetadata);

  const [entries, setEntries] = useState<GalleryEntryV1[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  // Paging (HQ room 2026-11-11-013; DESIGN 2026-11-14-074). The list API
  // answers 50 at a time: cursor is where the next page starts, null once
  // the last page is in. A pass reads one page or more (galleryPaging.ts).
  const [cursor, setCursor] = useState<string | null>(null);
  const [paging, setPaging] = useState<'idle' | 'loading' | 'failed'>('idle');
  // The last pass stopped at its page cap with more to read: nothing loads
  // by itself again until a press, or a scroll away and back.
  const [capped, setCapped] = useState(false);
  // More than the first page was read in this visit: the end gets its line.
  const [paged, setPaged] = useState(false);
  // What a screen reader hears once when a pass ends.
  const [announce, setAnnounce] = useState('');
  // "Clear" reads the rest of the list before it asks, and deletes only
  // after the answer (HQ 2026-11-14-075; galleryPaging.ts, clearGallery).
  // clearing: what the button shows while one runs, and for which filter.
  // clearNote: what the last one said when it ended without deleting all.
  const [clearing, setClearing] = useState<{ phase: 'reading' | 'deleting'; filter: FilterMode; count: number } | null>(null);
  const [clearNote, setClearNote] = useState('');
  // The kinds a Clear has emptied after reading the whole list: for this
  // visit no unread page holds one, so that filter reads no further.
  const [emptied, setEmptied] = useState<readonly FilterMode[]>([]);
  // How many generations the account holds, once a Clear has counted the
  // whole list; null until then.
  const [total, setTotal] = useState<number | null>(null);
  const [legacyEntries, setLegacyEntries] = useState<GenerationHistoryEntry[]>([]);
  const [legacyBannerDismissed, setLegacyBannerDismissed] = useState(false);
  const [legacyBackupBusy, setLegacyBackupBusy] = useState(false);

  // Ref tracks blob URLs for cleanup. We avoid revoking on unmount (Slicer handoff
  // needs them to survive); we revoke on individual delete, clear-all, and when
  // a fresh fetch supersedes an entry's previous URL.
  const urlsRef = useRef<Record<string, string>>({});
  // What the async paths read: the latest list, cursor and filter, the ids
  // this visit has shown (a page can repeat an entry), the visit's number
  // (a new account or leaving the page ends it), and whether a pass runs.
  const entriesRef = useRef<GalleryEntryV1[]>([]);
  const cursorRef = useRef<string | null>(null);
  const filterRef = useRef<FilterMode>('all');
  const knownRef = useRef<Set<string>>(new Set());
  // The ids deleted in this visit, shown or unread: a page read while they
  // are being deleted must not bring them back as cards.
  const goneRef = useRef<Set<string>>(new Set());
  const visitRef = useRef(0);
  const passRef = useRef(false);
  // Resolves when the pass on its way has ended (Clear waits for it).
  const passEndRef = useRef<Promise<void>>(Promise.resolve());
  // The last read failed: only "Try again" or "Load more" reads again.
  const failedRef = useRef(false);
  // One Clear at a time. clearRunRef numbers them: a filter change or the
  // visit's end drops the one that is counting, with its question.
  const clearBusyRef = useRef(false);
  const clearRunRef = useRef(0);
  const clearDeletingRef = useRef(false);
  const emptiedRef = useRef<readonly FilterMode[]>([]);
  const totalRef = useRef<number | null>(null);
  // A card whose own Delete is waiting for the server, or was refused.
  const [cardState, setCardState] = useState<Record<string, 'busy' | 'failed'>>({});
  const cardBusyRef = useRef(new Set<string>());
  // After a delete whose outcome could not be confirmed the gallery is read
  // again from the top; the line to show once it is back.
  const [reloads, setReloads] = useState(0);
  const reloadNoteRef = useRef('');
  // The generation the newest Send to Slicer was pressed on.
  const slicerJobRef = useRef<string | null>(null);
  // Keep the place (HQ 2026-11-14-077, DESIGN -230): each picture's bytes,
  // the pages read with the cursor after each, and the page area's scroll
  // position, kept when the Gallery is left and restored on a return.
  const blobsRef = useRef<Record<string, Blob>>({});
  const pagesRef = useRef<KeptPage[]>([]);
  const scrollTopRef = useRef(0);
  // A kept scroll position to restore once the kept list is on screen.
  const restoreRef = useRef<number | null>(null);
  // New generations a return found while the page was scrolled down: they
  // wait behind "Show 2 new" in the app's top bar, so nothing on screen
  // moves (DESIGN 2026-11-14-278; AUDIT keep-place r1, M4). Newest first.
  const pendingRef = useRef<GalleryEntryV1[]>([]);
  const [pending, setPending] = useState<GalleryEntryV1[]>([]);
  // After a press of "Show 2 new": the page goes to the top.
  const toTopRef = useRef(false);
  // Where the button goes: the top bar's slot (Header.tsx).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  // A Send to Slicer a Clear or a Delete set aside at its yes: sent again
  // if its generation was not deleted (AUDIT gallery-paging-r2, G2-11).
  const heldSlicerRef = useRef<GalleryEntryV1 | null>(null);
  // How many the server says Clear all deleted.
  const deletedAllRef = useRef<number | null>(null);
  // Settles when the running Clear ends: a lost Delete answer waits for it
  // before the gallery is read again (AUDIT gallery-paging-r3, L3-1).
  const clearEndRef = useRef<Promise<void>>(Promise.resolve());
  // Under a filter with cards showing: the last pass found none of the kind.
  const [noneNext, setNoneNext] = useState('');
  // After Clear all emptied the Gallery in this visit: the line that takes
  // the place of the usual empty words (DESIGN 2026-11-14-243).
  const [cleared, setCleared] = useState('');
  // A return lands at the kept place, and landing is not the person
  // scrolling: no read starts by itself (the scroll-in read, or a filter
  // reading on) until the person's own first scroll or a tab (DESIGN
  // 2026-11-14-243). "Load more" works as ever.
  const [landingHeld, setLandingHeld] = useState(false);
  // The account the list on screen was read for, and whether the page is
  // loading or showing its error: a keep is taken only for the account the
  // list belongs to, never while loading or on the error screen (AUDIT
  // keep-place r1, C1).
  const listOwnerRef = useRef<string | null>(null);
  // The same, for the render: a list read for another account is never
  // drawn, not even for the one render between an account change and the
  // effect that empties it.
  const [listOwner, setListOwner] = useState<string | null>(null);
  const loadingRef = useRef(true);
  const errorRef = useRef<string | null>(null);
  // A return's quiet read of the first page, while it is on its way or once
  // it ended: a Clear waits for it, and reads the page itself if it failed
  // (AUDIT keep-place r1, M3). null on a fresh read.
  const quietRef = useRef<Promise<'ok' | 'failed' | 'gap'> | null>(null);
  const quietReadRef = useRef<() => Promise<'ok' | 'failed' | 'gap'>>(async () => 'failed');
  // After a press of "Load more" or "Try again": the first new card takes
  // the focus. Loading by scrolling never moves it (DESIGN 2026-11-14-126,
  // -134).
  const pressedRef = useRef(false);
  const focusCardRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const endLineRef = useRef<HTMLParagraphElement>(null);
  const focusEndRef = useRef(false);
  useLayoutEffect(() => {
    entriesRef.current = entries;
    filterRef.current = filter;
  }, [entries, filter]);
  useLayoutEffect(() => {
    loadingRef.current = loading;
    errorRef.current = error;
  }, [loading, error]);

  // The pink cleanup of each animation (HQ 2026-10-28-005), made after the
  // first paint so the page never waits on it: the stored copy shows first,
  // and the clean copy replaces it when ready. Download and Send to Slicer
  // use cleanedUrl, which waits for an entry's clean copy and starts it if
  // the background pass has not reached it yet.
  // storedRef: an animation's stored copy, until its cleanup runs.
  // cleaningRef: jobId -> the URL its cleanup settles on.
  // keptRef: a stored copy's URL that a clean copy replaced, kept alive as
  // every URL here is (Download or the Slicer may hold it) until the entry
  // is deleted.
  const storedRef = useRef<Record<string, Blob>>({});
  const cleaningRef = useRef<Record<string, Promise<string | undefined>>>({});
  const keptRef = useRef<Record<string, string>>({});
  // A Download or Send to Slicer waiting for its clean copy acts only if it
  // still belongs to this visit and, for the Slicer, is still the newest
  // choice (Second 118; src/lib/galleryOwnership.ts).
  const [ownership] = useState(createGalleryOwnership);
  // The visit ends when the page unmounts or its account changes, in the
  // commit that makes the change. A layout cleanup runs there, before any
  // waiting action can resume; a passive one (useEffect) may run later, so
  // an action clicked in the old visit could act first (Second 119).
  useLayoutEffect(() => () => ownership.endVisit(), [userId, ownership]);
  // The paging visit and a Clear that is still counting end in that commit
  // too: a count whose last answer comes in before the passive cleanups
  // must not ask its question on the next page.
  useLayoutEffect(() => () => {
    visitRef.current += 1;
    clearRunRef.current += 1;
  }, [userId]);
  // Leaving the Gallery, or its account: what is loaded is kept for a
  // return in this tab. Not while a Clear or a Delete is on its way (the
  // server may be part way), not with nothing loaded, not while loading or
  // on the error screen, and only when the list was read for the account
  // that is leaving (AUDIT keep-place r1, C1).
  useLayoutEffect(() => () => {
    if (!userId || listOwnerRef.current !== userId || loadingRef.current || errorRef.current !== null
      || clearBusyRef.current || cardBusyRef.current.size > 0 || entriesRef.current.length === 0) {
      dropKept();
      return;
    }
    const pictures: Record<string, Blob> = {};
    for (const e of entriesRef.current) if (blobsRef.current[e.jobId]) pictures[e.jobId] = blobsRef.current[e.jobId];
    keepGallery({
      userId,
      entries: entriesRef.current,
      pictures,
      cursor: cursorRef.current,
      paged: pagesRef.current.length > 1,
      total: totalRef.current,
      filter: filterRef.current,
      scrollTop: scrollTopRef.current,
      pages: pagesRef.current,
      gone: [...goneRef.current],
      emptied: [...emptiedRef.current],
    });
  }, [userId]);

  // A return in this tab: what was kept for this account goes on screen in
  // the same commit, before the browser paints, so no skeleton shows and no
  // focus moves (DESIGN 2026-11-14-230). The load effect then reads the
  // first page quietly (restoredRef).
  const restoredRef = useRef<KeptGallery | null>(null);
  useLayoutEffect(() => {
    if (!userId) return;
    const kept = takeKept(userId);
    if (!kept) return;
    // At once, at the kept place, with no skeletons; no focus moves.
    const urls: Record<string, string> = {};
    const stored: Record<string, Blob> = {};
    for (const e of kept.entries) {
      const blob = kept.pictures[e.jobId];
      if (!blob) continue;
      urls[e.jobId] = URL.createObjectURL(blob);
      if (e.mode === 'animate') stored[e.jobId] = blob;
    }
    Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    Object.values(keptRef.current).forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = urls;
    keptRef.current = {};
    storedRef.current = stored;
    cleaningRef.current = {};
    blobsRef.current = { ...kept.pictures };
    pagesRef.current = kept.pages.map((page) => ({ ids: [...page.ids], cursor: page.cursor }));
    knownRef.current = new Set(kept.entries.map((e) => e.jobId));
    goneRef.current = new Set(kept.gone);
    emptiedRef.current = kept.emptied;
    setEmptied(kept.emptied);
    listOwnerRef.current = kept.userId;
    setListOwner(kept.userId);
    // What this sets is current at once: a cleanup before the next commit
    // (React's development double run) keeps it again.
    loadingRef.current = false;
    errorRef.current = null;
    cursorRef.current = kept.cursor;
    entriesRef.current = kept.entries;
    filterRef.current = kept.filter;
    totalRef.current = kept.total;
    restoreRef.current = kept.scrollTop;
    scrollTopRef.current = kept.scrollTop;
    setEntries(kept.entries);
    setImageUrls(urls);
    setCursor(kept.cursor);
    setPaged(kept.paged);
    setTotal(kept.total);
    setFilter(kept.filter);
    setLoading(false);
    const visit = visitRef.current;
    const queue = kept.entries.filter((e) => stored[e.jobId]).map((e) => e.jobId);
    const worker = async (): Promise<void> => {
      for (let jobId = queue.shift(); jobId !== undefined && visitRef.current === visit; jobId = queue.shift()) {
        await cleanedUrl(jobId);
      }
    };
    void Promise.all([worker(), worker()]);
    restoredRef.current = kept;
    setLandingHeld(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // The person's own first scroll ends the landing: a wheel, a touch drag,
  // a scrolling key, or a press on the page area's own scroll bar. A scroll
  // set by the page (the landing, a card held in view) is none of these.
  useEffect(() => {
    if (!landingHeld) return;
    const main = endRef.current?.closest('main');
    if (!main) return;
    const keys = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
    const release = () => setLandingHeld(false);
    const onKey = (e: KeyboardEvent) => { if (keys.has(e.key)) release(); };
    const onPointer = (e: PointerEvent) => { if (e.target === main) release(); };
    main.addEventListener('wheel', release, { passive: true });
    main.addEventListener('touchmove', release, { passive: true });
    window.addEventListener('keydown', onKey);
    main.addEventListener('pointerdown', onPointer);
    return () => {
      main.removeEventListener('wheel', release);
      main.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', onKey);
      main.removeEventListener('pointerdown', onPointer);
    };
  }, [landingHeld, loading]);

  // The waiting new generations go on top of the list: on a press of
  // "Show 2 new", at the very top of the page, on a tab, or before a Clear
  // counts. The count line counts them only from then (DESIGN
  // 2026-11-14-278).
  const flushPending = useCallback((): GalleryEntryV1[] => {
    const add = pendingRef.current;
    if (add.length === 0) return add;
    pendingRef.current = [];
    setPending([]);
    entriesRef.current = [...add, ...entriesRef.current];
    setEntries((prev) => [...add, ...prev]);
    if (totalRef.current !== null) {
      totalRef.current += add.length;
      setTotal(totalRef.current);
    }
    return add;
  }, []);

  // Where the page area is scrolled, for a return. The page's scroller is
  // the shell's <main>. Scrolled to the very top, the waiting new
  // generations go in, as at the top.
  useEffect(() => {
    if (loading) return;
    const main = endRef.current?.closest('main');
    if (!main) return;
    const onScroll = () => {
      scrollTopRef.current = main.scrollTop;
      if (main.scrollTop > 0 || pendingRef.current.length === 0) return;
      const shown = flushPending().filter((e) => matchesFilter(e, filterRef.current)).length;
      if (shown > 0) setAnnounce(newAtTopLine(shown));
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [loading, flushPending]);

  // The top bar's slot for "Show 2 new", once the shell is on screen.
  useEffect(() => {
    setHeaderSlot(document.getElementById?.('header-actions') ?? null);
  }, []);

  // A return: once the kept list is on screen, the kept place. The router
  // may bring the new page into view after this commit, so the place is put
  // back once more on the next frame if it moved.
  useLayoutEffect(() => {
    const want = restoreRef.current;
    if (want === null || loading) return;
    const main = endRef.current?.closest('main');
    if (!main) return;
    restoreRef.current = null;
    main.scrollTop = want;
    requestAnimationFrame(() => {
      if (main.isConnected && Math.abs(main.scrollTop - want) > 1) main.scrollTop = want;
    });
  }, [loading, entries]);

  const cleanedUrl = useCallback((jobId: string): Promise<string | undefined> => {
    const started = cleaningRef.current[jobId];
    if (started) return started;
    const stored = storedRef.current[jobId];
    const storedUrl = urlsRef.current[jobId];
    if (!stored || !storedUrl) return Promise.resolve(storedUrl);
    const run = (async () => {
      try {
        const cleaned = await cleanGallerySheet(stored, jobGuards(jobId));
        if (storedRef.current[jobId] === stored) delete storedRef.current[jobId];
        // Nothing needed cleaning, or the entry was deleted or fetched again
        // meanwhile.
        if (!cleaned || urlsRef.current[jobId] !== storedUrl) return urlsRef.current[jobId];
        const url = URL.createObjectURL(cleaned);
        // A new object: the first fetch hands the same one to imageUrls.
        urlsRef.current = { ...urlsRef.current, [jobId]: url };
        keptRef.current[jobId] = storedUrl;
        setImageUrls((prev) => (prev[jobId] === storedUrl ? { ...prev, [jobId]: url } : prev));
        return url;
      } catch {
        return urlsRef.current[jobId];
      }
    })();
    cleaningRef.current[jobId] = run;
    return run;
  }, []);

  // The list for the current account. Until its first answer the grid shows
  // skeletons: Clerk can load after the first render (userId undefined), and
  // a new account or a new fetch starts loading again, so "No generations
  // yet" shows only for a real empty answer.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (userId === undefined) return; // Clerk still loading: keep the skeletons.
      if (!userId) {
        dropKept();
        // Nothing of the last account stays on the page (AUDIT keep-place r1, C1).
        listOwnerRef.current = null;
        setListOwner(null);
        entriesRef.current = [];
        setEntries([]);
        pendingRef.current = [];
        setPending([]);
        setImageUrls({});
        setError('Please sign in to view your gallery.');
        setLoading(false);
        return;
      }
      // A return in this tab: the layout effect below has already put what
      // was kept on screen; this reads the first page quietly. A reload reads
      // from the top.
      const kept = reloads === 0 ? restoredRef.current : null;
      restoredRef.current = null;
      if (kept) {
        // Then the first page, quietly (quietRead): new generations go on
        // top, generations the server no longer has go, and what is on
        // screen does not move. A failed read is tried once more after a
        // few seconds; a Clear reads it itself (AUDIT keep-place r1, M3).
        const afterQuiet = async (outcome: 'ok' | 'failed' | 'gap', retry: boolean): Promise<void> => {
          if (cancelled) return;
          if (outcome === 'gap') {
            // More new ones than a page: the kept list may not follow on,
            // so the gallery is read from the top, after a running Clear.
            if (clearBusyRef.current) await clearEndRef.current;
            if (!cancelled) reload(reloadNoteRef.current);
            return;
          }
          if (outcome === 'failed' && retry) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            if (cancelled || clearBusyRef.current) return;
            const again = quietReadRef.current();
            quietRef.current = again;
            await afterQuiet(await again, false);
          }
        };
        const quiet = quietReadRef.current();
        quietRef.current = quiet;
        await afterQuiet(await quiet, true);
        return;
      }
      // A new account, or a fresh read: the paging starts over with it, and
      // nothing of the last list stays on the page (AUDIT keep-place r1, C1).
      listOwnerRef.current = null;
      setListOwner(null);
      quietRef.current = null;
      entriesRef.current = [];
      setEntries([]);
      pendingRef.current = [];
      setPending([]);
      setImageUrls({});
      storedRef.current = {};
      setCursor(null);
      cursorRef.current = null;
      knownRef.current = new Set();
      goneRef.current = new Set();
      setPaging('idle');
      setCapped(false);
      setPaged(false);
      setAnnounce('');
      setClearing(null);
      setClearNote(reloadNoteRef.current);
      reloadNoteRef.current = '';
      setCleared('');
      setLandingHeld(false);
      setEmptied([]);
      emptiedRef.current = [];
      setTotal(null);
      totalRef.current = null;
      setCardState({});
      cardBusyRef.current = new Set();
      clearBusyRef.current = false;
      clearDeletingRef.current = false;
      failedRef.current = false;
      setNoneNext('');
      blobsRef.current = {};
      pagesRef.current = [];
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setError('Please sign in to view your gallery.');
            setLoading(false);
          }
          return;
        }

        // 1. The first page of the list, then its pictures in parallel.
        const first = await readListPage(token, null);
        const fetched = first.entries;
        const { urls: newUrls, stored, blobs } = await readPictures(token, fetched);

        if (cancelled) {
          // Cancelled during fetch — release any URLs we created
          Object.values(newUrls).forEach(URL.revokeObjectURL);
          return;
        }

        // Revoke obsoleted URLs (defensive — initial mount, urlsRef should be empty)
        Object.entries(urlsRef.current).forEach(([jobId, url]) => {
          if (!newUrls[jobId]) URL.revokeObjectURL(url);
        });
        urlsRef.current = newUrls;
        // The stored copies that clean copies replaced: nothing shows or
        // holds them once a fresh fetch replaces every entry's URL.
        Object.values(keptRef.current).forEach((url) => URL.revokeObjectURL(url));
        keptRef.current = {};
        storedRef.current = stored;
        cleaningRef.current = {};
        blobsRef.current = blobs;
        pagesRef.current = [{ ids: fetched.map((e) => e.jobId), cursor: first.cursor }];

        knownRef.current = new Set(fetched.map((e) => e.jobId));
        cursorRef.current = first.cursor;
        entriesRef.current = fetched;
        listOwnerRef.current = userId;
        setListOwner(userId);
        loadingRef.current = false;
        setEntries(fetched);
        setImageUrls(newUrls);
        setCursor(first.cursor);
        setLoading(false);

        // 3. The clean copies of the animations, two at a time after the
        // first paint, in the order the entries show (a Create sheet is
        // used as stored).
        const queue = fetched.filter((e) => stored[e.jobId]).map((e) => e.jobId);
        const worker = async (): Promise<void> => {
          for (let jobId = queue.shift(); jobId !== undefined && !cancelled; jobId = queue.shift()) {
            await cleanedUrl(jobId);
          }
        };
        void Promise.all([worker(), worker()]);
      } catch {
        if (!cancelled) {
          setError('Could not load your gallery. Please try again.');
          setLoading(false);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
      // The visit's paging ends with it: a pass still reading drops its page.
      visitRef.current += 1;
      passRef.current = false;
      clearRunRef.current += 1;
      // Intentionally NOT revoking urlsRef on unmount — Slicer handoff needs them
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reloads]);

  // One pass (galleryPaging.ts): the next page, and under a filter the
  // pages after it. Started by the grid's end coming near, by "Load more"
  // or "Try again", and by a filter that shows less than a screenful.
  const runPass = useCallback(async (trigger: 'more' | 'filter', pressed = false) => {
    // Never while a Clear runs (its count must not move under it), never
    // by itself after a failed read, and never under a filter whose kind a
    // Clear has emptied.
    if (passRef.current || clearBusyRef.current || cursorRef.current === null) return;
    if (trigger === 'filter' && failedRef.current) return;
    if (emptiedRef.current.includes(filterRef.current)) return;
    const shown = () => entriesRef.current.filter((e) => matchesFilter(e, filterRef.current)).length;
    // A kind a Clear has emptied has nothing more to find: a pass on its
    // way when the person comes back to that filter ends with its page.
    const kindDone = () => emptiedRef.current.includes(filterRef.current);
    if (passGoal(trigger, shown()) === 0) return;
    const visit = visitRef.current;
    const current = () => visitRef.current === visit;
    passRef.current = true;
    pressedRef.current = pressed;
    let ended: () => void = () => {};
    passEndRef.current = new Promise<void>((resolve) => { ended = resolve; });
    setPaging('loading');
    setAnnounce('');
    try {
      setNoneNext('');
      const result = await runGalleryPass<{ urls: Record<string, string>; stored: Record<string, Blob>; blobs: Record<string, Blob> }>(trigger, {
        cursor: () => cursorRef.current,
        known: () => knownRef.current,
        matches: (e) => matchesFilter(e, filterRef.current),
        shown: () => (kindDone() ? Number.MAX_SAFE_INTEGER : shown()),
        // A token for each read: a pass can outlast one.
        read: async (after) => {
          const token = await getToken();
          if (!token) throw new Error('signed out');
          return readListPage(token, after);
        },
        pictures: async (fresh) => {
          const token = await getToken();
          return readPictures(token ?? '', fresh);
        },
        current,
        // A kind a Clear has emptied: no further read (AUDIT r3, L3-2).
        stop: kindDone,
        drop: ({ urls }) => Object.values(urls).forEach(URL.revokeObjectURL),
        // The page is in: its entries after the ones shown, never over them.
        commit: ({ fresh: read, cursor: next, pictures: { urls: readUrls, stored: readStored, blobs: readBlobs } }) => {
          // An entry deleted while its page was on the way stays deleted.
          const fresh = read.filter((e) => !goneRef.current.has(e.jobId));
          const urls: Record<string, string> = {};
          const stored: Record<string, Blob> = {};
          for (const e of read) {
            const url = readUrls[e.jobId];
            if (goneRef.current.has(e.jobId)) {
              if (url) URL.revokeObjectURL(url);
              continue;
            }
            if (url) urls[e.jobId] = url;
            if (readStored[e.jobId]) stored[e.jobId] = readStored[e.jobId];
            if (readBlobs[e.jobId]) blobsRef.current[e.jobId] = readBlobs[e.jobId];
          }
          pagesRef.current = [...pagesRef.current, { ids: read.map((e) => e.jobId), cursor: next }];
          read.forEach((e) => knownRef.current.add(e.jobId));
          urlsRef.current = { ...urlsRef.current, ...urls };
          Object.assign(storedRef.current, stored);
          // The list and its cursor move together, here, so nothing that
          // reads both between this commit and the next render sees one
          // without the other.
          entriesRef.current = [...entriesRef.current, ...fresh];
          cursorRef.current = next;
          // A press of the button, or a page that arrives while the button
          // holds the focus (a keyboard user who tabbed to it): the first
          // new card that shows takes the focus (DESIGN 2026-11-14-147).
          // Otherwise, the list ending under a focused button hands the
          // focus to the end line.
          const atButton = pressedRef.current || (moreRef.current !== null && document.activeElement === moreRef.current);
          const firstShown = atButton ? fresh.find((e) => matchesFilter(e, filterRef.current)) : undefined;
          if (firstShown) {
            pressedRef.current = false;
            focusCardRef.current = firstShown.jobId;
          } else if (next === null && focusCardRef.current === null && document.activeElement === moreRef.current) {
            focusEndRef.current = true;
          }
          setEntries((prev) => [...prev, ...fresh]);
          setImageUrls((prev) => ({ ...prev, ...urls }));
          setCursor(next);
          setPaged(true);
          // The clean copies of this page's animations, two at a time.
          const queue = fresh.filter((e) => stored[e.jobId]).map((e) => e.jobId);
          const worker = async (): Promise<void> => {
            for (let jobId = queue.shift(); jobId !== undefined && current(); jobId = queue.shift()) {
              await cleanedUrl(jobId);
            }
          };
          void Promise.all([worker(), worker()]);
        },
      });
      if (!current()) return;
      passRef.current = false;
      if (result.state === 'failed') {
        // What is loaded stays; nothing loads by itself until "Try again".
        failedRef.current = true;
        setPaging('failed');
        return;
      }
      failedRef.current = false;
      setCapped(result.capped);
      // Said once: the cards that came, or the line now standing in their place.
      const endState = {
        added: result.added,
        filter: filterRef.current,
        shown: shown(),
        read: entriesRef.current.length,
        more: cursorRef.current !== null && !kindDone(),
        readThisPass: result.read,
      };
      const endLine = passEndLine(endState);
      setAnnounce(endLine);
      // Cards of the kind show and none came: the line stands beside "Load
      // more" until the next pass or tab (DESIGN 2026-11-14-230).
      setNoneNext(endState.filter !== 'all' && endState.shown > 0 && endState.more && endState.added === 0 && result.read > 0
        ? noneNextLine(endState.filter, result.read) : '');
      setPaging('idle');
    } finally {
      ended();
    }
  }, [getToken, cleanedUrl]);

  // The next page starts loading when the grid's end is about one screen
  // away. The page's scroller is <main>, so that is the root. After a
  // failure nothing is watched (only "Try again" reads again); after a
  // capped pass the end has to leave and come back first.
  useEffect(() => {
    const end = endRef.current;
    if (!end || loading || landingHeld || cursor === null || paging !== 'idle' || clearing || emptied.includes(filter)
      || typeof IntersectionObserver === 'undefined') return;
    let armed = !capped;
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (!record.isIntersecting) armed = true;
          else if (armed) void runPass('more');
        }
      },
      { root: end.closest('main'), rootMargin: '0px 0px 100% 0px' }
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [loading, landingHeld, cursor, paging, capped, filter, clearing, emptied, runPass]);

  // A filter that shows less than a screenful reads on until it has one.
  useEffect(() => {
    if (loading || landingHeld) return;
    void runPass('filter');
  }, [filter, loading, landingHeld, runPass]);

  // The list ended while "Load more" had the focus: the end line takes it,
  // so the keyboard is not dropped at the top of the page.
  useLayoutEffect(() => {
    if (cursor === null && focusEndRef.current) {
      focusEndRef.current = false;
      endLineRef.current?.focus();
    }
  }, [cursor]);

  // After a press of "Show 2 new": the page goes to the top, where the new
  // generations are; the effect below then moves the focus to the first.
  useLayoutEffect(() => {
    if (!toTopRef.current) return;
    toTopRef.current = false;
    const main = endRef.current?.closest('main');
    if (main) main.scrollTop = 0;
  }, [entries]);

  // After a press of "Load more" or "Try again": the first new card itself
  // takes the focus and comes into view, so the keyboard is at the new
  // cards, not below them. The card, not a control in it: its first
  // control is Delete (DESIGN 2026-11-14-134).
  useLayoutEffect(() => {
    const jobId = focusCardRef.current;
    if (jobId === null) return;
    focusCardRef.current = null;
    const card = endRef.current?.parentElement?.querySelector<HTMLElement>(`[data-gallery-card="${CSS.escape(jobId)}"]`);
    if (!card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest' });
  }, [entries]);

  // Detect pre-Phase-2 localStorage entries for the backup banner.
  // Self-contained: doesn't touch the server gallery fetch or its state.
  useEffect(() => {
    // Sunset short-circuit
    if (Date.now() >= LEGACY_BANNER_SUNSET_TS) return;

    // Dismissed-state read
    if (typeof window !== 'undefined') {
      const dismissed = window.localStorage.getItem(LEGACY_BANNER_DISMISSED_KEY);
      if (dismissed === '1') {
        setLegacyBannerDismissed(true);
        return;
      }
    }

    if (!userId) return;

    // Read all localStorage entries, filter to pre-Phase-2 AND downloadable
    try {
      const all = loadHistory(userId);
      const legacy = all.filter(
        (e) => e.timestamp < PHASE_2_SHIP_TS && !!e.fullImageDataUrl
      );
      setLegacyEntries(legacy);
    } catch {
      // localStorage parse failure — silently ignore, banner won't render
    }
  }, [userId]);

  const handleLegacyBackup = useCallback(async () => {
    if (legacyEntries.length === 0 || legacyBackupBusy) return;
    setLegacyBackupBusy(true);

    try {
      const zip = new JSZip();
      legacyEntries.forEach((entry, idx) => {
        const dataUrl = entry.fullImageDataUrl;
        if (!dataUrl) return;
        // Strip the data URL prefix to get the base64 payload
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const filename = `spritebrew_${entry.mode}_${idx + 1}_${entry.id}.png`;
        zip.file(filename, base64, { base64: true });
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spritebrew_legacy_backup_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Auto-dismiss on successful download — they got what they came for
      window.localStorage.setItem(LEGACY_BANNER_DISMISSED_KEY, '1');
      setLegacyBannerDismissed(true);
    } catch (err) {
      console.error('Legacy backup failed:', err);
    } finally {
      setLegacyBackupBusy(false);
    }
  }, [legacyEntries, legacyBackupBusy]);

  const handleLegacyDismiss = useCallback(() => {
    window.localStorage.setItem(LEGACY_BANNER_DISMISSED_KEY, '1');
    setLegacyBannerDismissed(true);
  }, []);

  const showLegacyBanner =
    !legacyBannerDismissed &&
    legacyEntries.length > 0 &&
    Date.now() < LEGACY_BANNER_SUNSET_TS;

  const legacyBanner = showLegacyBanner ? (
    <div className="mb-6 p-4 bg-bg-elevated border border-accent-amber/40 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex-1 text-sm">
        <p className="text-text-primary font-medium">
          We found {legacyEntries.length} older generation{legacyEntries.length === 1 ? '' : 's'} in your browser
        </p>
        <p className="text-text-secondary mt-1">
          These were saved locally before gallery sync went live, and aren&apos;t in your synced gallery above. Download a backup zip to keep them. This banner disappears June 5.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          onClick={handleLegacyBackup}
          disabled={legacyBackupBusy}
          variant="primary"
          size="sm"
        >
          {legacyBackupBusy ? (
            <><Loader2 size={14} className="mr-2 animate-spin" /> Preparing…</>
          ) : (
            <><Download size={14} className="mr-2" /> Download backup</>
          )}
        </Button>
        <Button
          onClick={handleLegacyDismiss}
          variant="ghost"
          size="sm"
          className="text-text-secondary hover:text-text-primary"
        >
          Dismiss
        </Button>
      </div>
    </div>
  ) : null;

  // Both wait for an animation's clean copy, and act only if the click still
  // owns it then (whenCurrent).
  const handleDownload = useCallback((entry: GalleryEntryV1) => ownership.whenCurrent(
    'download',
    () => (entry.mode === 'animate' ? cleanedUrl(entry.jobId) : imageUrls[entry.jobId]),
    (url) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `spritebrew_${entry.mode}_${entry.jobId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
  ), [imageUrls, cleanedUrl, ownership]);

  const handleSendToSlicer = useCallback((entry: GalleryEntryV1) => ownership.whenCurrent(
    'slicer',
    () => (entry.mode === 'animate' ? cleanedUrl(entry.jobId) : imageUrls[entry.jobId]),
    (url) => {
      setGeneratedImage(url, url);
      setGenerationStyle(entry.style);
      setCurrentSheetMetadata(deriveSlicerHints(entry));
      router.push('/upload');
    },
  ), [imageUrls, cleanedUrl, ownership, setGeneratedImage, setGenerationStyle, setCurrentSheetMetadata, router]);

  // A Send to Slicer still waiting on a generation about to be deleted is
  // set aside at the yes, and sent again if that generation was not deleted
  // (DESIGN 2026-11-14-230; AUDIT gallery-paging-r2, G2-11).
  const setSlicerAside = useCallback(() => {
    const id = slicerJobRef.current;
    heldSlicerRef.current = id ? entriesRef.current.find((e) => e.jobId === id) ?? null : null;
    slicerJobRef.current = null;
    ownership.slicer();
  }, [ownership]);
  const sendSlicerAgain = useCallback(() => {
    const entry = heldSlicerRef.current;
    heldSlicerRef.current = null;
    if (!entry || goneRef.current.has(entry.jobId) || slicerJobRef.current !== null) return;
    slicerJobRef.current = entry.jobId;
    void handleSendToSlicer(entry);
  }, [handleSendToSlicer]);

  // The known total follows every delete.
  const lowerTotal = useCallback((by: number) => {
    if (totalRef.current === null || by === 0) return;
    totalRef.current = Math.max(0, totalRef.current - by);
    setTotal(totalRef.current);
  }, []);

  // The server has deleted these: they leave the page, shown or unread, and
  // no later page brings one back. Each lowers the known total once.
  const dropCards = useCallback((ids: readonly string[]) => {
    const gone = new Set(ids);
    // A waiting new generation is not counted yet: it only leaves the wait.
    const waiting = new Set(pendingRef.current.filter((e) => gone.has(e.jobId)).map((e) => e.jobId));
    lowerTotal(ids.filter((id) => !goneRef.current.has(id) && !waiting.has(id)).length);
    if (waiting.size > 0) {
      pendingRef.current = pendingRef.current.filter((e) => !waiting.has(e.jobId));
      setPending(pendingRef.current);
    }
    ids.forEach((id) => {
      goneRef.current.add(id);
      knownRef.current.add(id);
      const url = urlsRef.current[id];
      if (url) URL.revokeObjectURL(url);
      delete urlsRef.current[id];
      if (keptRef.current[id]) URL.revokeObjectURL(keptRef.current[id]);
      delete keptRef.current[id];
      delete storedRef.current[id];
      delete blobsRef.current[id];
    });
    entriesRef.current = entriesRef.current.filter((e) => !gone.has(e.jobId));
    setEntries((prev) => prev.filter((e) => !gone.has(e.jobId)));
    setImageUrls((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });
  }, [lowerTotal]);

  // A delete whose outcome could not be confirmed: the gallery is read
  // again from the top, so the page shows what is there, and says why.
  const reload = useCallback((note: string) => {
    reloadNoteRef.current = note;
    Object.values(urlsRef.current).forEach(URL.revokeObjectURL);
    Object.values(keptRef.current).forEach(URL.revokeObjectURL);
    urlsRef.current = {};
    keptRef.current = {};
    storedRef.current = {};
    cleaningRef.current = {};
    blobsRef.current = {};
    pagesRef.current = [];
    entriesRef.current = [];
    setEntries([]);
    setImageUrls({});
    setReloads((n) => n + 1);
  }, []);

  // A return's quiet read of the first page against the kept list (AUDIT
  // keep-place r1, M1, M2, M4): what stands before the first kept
  // generation goes on top; kept generations the page covers but no longer
  // holds go. At the very top of the page they go in; scrolled down they
  // wait behind "Show 2 new" (DESIGN 2026-11-14-278). 'gap' when the page
  // holds nothing kept: the caller reads from the top.
  const quietRead = useCallback(async (): Promise<'ok' | 'failed' | 'gap'> => {
    const visit = visitRef.current;
    const alive = () => visitRef.current === visit;
    try {
      const token = await getToken();
      if (!token) return 'failed';
      const first = await readListPage(token, null);
      if (!alive()) return 'ok';
      const { fresh, removed, gap } = quietMerge(entriesRef.current, first.entries, goneRef.current, first.cursor === null);
      if (gap) return 'gap';
      if (removed.length > 0) dropCards(removed);
      // The first page is the whole list: nothing is left to read, so no
      // "Load more" (AUDIT keep-place r2, N2).
      if (first.cursor === null && cursorRef.current !== null) {
        cursorRef.current = null;
        setCursor(null);
      }
      const candidates = fresh.filter((e) => !knownRef.current.has(e.jobId));
      if (candidates.length === 0) return 'ok';
      const read = await readPictures(token, candidates);
      if (!alive() || clearDeletingRef.current) {
        Object.values(read.urls).forEach(URL.revokeObjectURL);
        return 'ok';
      }
      const add = candidates.filter((e) => !knownRef.current.has(e.jobId) && !goneRef.current.has(e.jobId));
      add.forEach((e) => knownRef.current.add(e.jobId));
      for (const e of candidates) if (!add.includes(e) && read.urls[e.jobId]) URL.revokeObjectURL(read.urls[e.jobId]);
      if (add.length === 0) return 'ok';
      urlsRef.current = { ...urlsRef.current, ...read.urls };
      Object.assign(storedRef.current, read.stored);
      Object.assign(blobsRef.current, read.blobs);
      setImageUrls((prev) => ({ ...prev, ...read.urls }));
      const shown = add.filter((e) => matchesFilter(e, filterRef.current)).length;
      if (scrollTopRef.current > 0 && (shown > 0 || pendingRef.current.length > 0)) {
        // Scrolled down: they wait behind "Show 2 new", and nothing on
        // screen moves (DESIGN 2026-11-14-278).
        pendingRef.current = [...add, ...pendingRef.current];
        setPending(pendingRef.current);
        setAnnounce(newWaitingLine(pendingRef.current.filter((e) => matchesFilter(e, filterRef.current)).length));
      } else {
        // At the very top, or none of the kind shown: they go in at once.
        entriesRef.current = [...add, ...entriesRef.current];
        setEntries((prev) => [...add, ...prev]);
        if (totalRef.current !== null) {
          totalRef.current += add.length;
          setTotal(totalRef.current);
        }
        if (shown > 0) setAnnounce(newAtTopLine(shown));
      }
      const animations = add.filter((e) => read.stored[e.jobId]).map((e) => e.jobId);
      void Promise.all(animations.map((jobId) => cleanedUrl(jobId)));
      return 'ok';
    } catch {
      return 'failed';
    }
  }, [getToken, dropCards, cleanedUrl]);
  useLayoutEffect(() => {
    quietReadRef.current = quietRead;
  }, [quietRead]);

  // A single Delete, whole, is deleteEntry (galleryPaging.ts): the card
  // waits, and leaves only when the server has deleted it.
  const handleDelete = useCallback(async (jobId: string) => {
    if (!jobId || cardBusyRef.current.has(jobId)) return;
    const visit = visitRef.current;
    const alive = () => visitRef.current === visit;
    const mark = (state: 'busy' | 'failed' | null) => setCardState((prev) => {
      const next = { ...prev };
      if (state) next[jobId] = state;
      else delete next[jobId];
      return next;
    });
    const outcome = await deleteEntry({
      // On a yes, a Send to Slicer still waiting on this generation is
      // dropped, as it was when the card left at the yes.
      ask: () => {
        const yes = confirm('Delete this generation? This cannot be undone.');
        if (yes && slicerJobRef.current === jobId) setSlicerAside();
        return yes;
      },
      current: alive,
      busy: (on) => {
        if (on) cardBusyRef.current.add(jobId);
        else cardBusyRef.current.delete(jobId);
        if (alive()) mark(on ? 'busy' : null);
      },
      send: async () => {
        const token = await getToken();
        if (!token) return 'refused';
        const resp = await fetch(`/api/gallery/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        return deleteOutcome({ ok: resp.ok, status: resp.status, body: resp.ok ? null : await resp.json().catch(() => null) }, true);
      },
      removed: () => dropCards([jobId]),
    });
    if (!alive()) return;
    if (outcome === 'refused') {
      mark('failed');
      setAnnounce(DELETE_FAILED_LINE);
      sendSlicerAgain();
    } else if (outcome === 'unknown' || outcome === 'stale') {
      heldSlicerRef.current = null;
      // A Clear on its way first gets its last answer (AUDIT r3, L3-1).
      if (clearBusyRef.current) await clearEndRef.current;
      if (alive()) reload(clearUnconfirmedLine());
    } else {
      sendSlicerAgain();
    }
  }, [getToken, dropCards, reload, setSlicerAside, sendSlicerAgain]);

  // "Clear" means what it says (HQ 2026-11-14-075). The whole of it is
  // clearGallery (galleryPaging.ts): it waits for a page on its way, reads
  // the rest of the list, asks with the true count, and deletes only after
  // the answer, with a sign-in token fetched for each call. A card leaves
  // the page when the server has deleted it, never before.
  const handleClearAll = useCallback(async () => {
    if (clearBusyRef.current) return;
    clearBusyRef.current = true;
    clearDeletingRef.current = false;
    const kind = filter;
    const visit = visitRef.current;
    const run = (clearRunRef.current += 1);
    const alive = () => visitRef.current === visit;
    let ended: () => void = () => {};
    clearEndRef.current = new Promise<void>((resolve) => { ended = resolve; });
    deletedAllRef.current = null;
    setClearNote('');
    setCleared('');
    // Busy from the press: the count may first wait for a page on its way.
    if (passRef.current || cursorRef.current !== null || quietRef.current) setClearing({ phase: 'reading', filter: kind, count: 0 });
    try {
      // After a return the count waits for the quiet read of the first
      // page, and reads it itself if that failed: generations made while
      // away are counted, and none is said to be made after the press
      // (AUDIT keep-place r1, M3).
      if (quietRef.current) {
        let quiet = await quietRef.current;
        if (quiet === 'failed' && alive()) {
          const again = quietRead();
          quietRef.current = again;
          quiet = await again;
        }
        // Left, or dropped by a filter change while it waited.
        if (!alive() || clearRunRef.current !== run) return;
        if (quiet !== 'ok') {
          setClearNote(clearFailedLine(kind));
          // A gap reads the gallery again from the top, which starts with a
          // clean line: the line is said after that read (AUDIT keep-place
          // r2, N3).
          if (quiet === 'gap') reloadNoteRef.current = clearFailedLine(kind);
          return;
        }
      }
      // Waiting new generations go in first, so the count is of all of them.
      flushPending();
      const result = await clearGallery({
        filter: kind,
        settled: () => passEndRef.current,
        snapshot: () => ({ entries: entriesRef.current, cursor: cursorRef.current }),
        gone: () => goneRef.current,
        read: async (after) => {
          const token = await getToken();
          if (!token) throw new Error('signed out');
          return readListPage(token, after);
        },
        // On a yes, a Send to Slicer that still waits for its clean copy is
        // dropped if its own generation is among those about to go; one
        // waiting on a generation that stays still goes (DESIGN
        // 2026-11-14-126). The base dropped it by removing the cards.
        // and comes back if its generation was not deleted (DESIGN
        // 2026-11-14-230).
        ask: (question, ids) => {
          const yes = confirm(question);
          if (yes && slicerJobRef.current !== null && ids.includes(slicerJobRef.current)) setSlicerAside();
          return yes;
        },
        counted: (count) => {
          if (!alive()) return;
          totalRef.current = count;
          setTotal(count);
        },
        // Dropped by the visit's end, or by another filter chosen while it counted.
        current: () => alive() && clearRunRef.current === run,
        deleteAll: async () => {
          const token = await getToken();
          if (!token) return 'refused';
          const resp = await fetch('/api/gallery', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
          // How many it deleted: more than were counted when generations
          // were made after the press (AUDIT r1, L1).
          if (resp.ok) {
            const body: unknown = await resp.json().catch(() => null);
            const deleted = body && typeof body === 'object' ? (body as { deleted?: unknown }).deleted : undefined;
            if (typeof deleted === 'number' && Number.isInteger(deleted) && deleted >= 0) deletedAllRef.current = deleted;
          }
          return deleteOutcome({ ok: resp.ok, status: resp.status, body: null }, false);
        },
        deleteOne: async (jobId, kind) => {
          // An empty id, or "." or "..", would address "delete everything"
          // (AUDIT ext-mediums r2 L7).
          if (!jobId || jobId === '.' || jobId === '..') return 'refused';
          const token = await getToken();
          if (!token) return 'refused';
          // With the kind this Clear counted it as: the server refuses an
          // entry of another kind (HQ 2026-11-25-079).
          const resp = await fetch(`/api/gallery/${encodeURIComponent(jobId)}?kind=${encodeURIComponent(kind)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
          return deleteOutcome({ ok: resp.ok, status: resp.status, body: resp.ok ? null : await resp.json().catch(() => null) }, true);
        },
        removed: (ids, all) => {
          if (!alive()) return;
          dropCards(ids);
          if (all) {
            // Everything went, the unread pages too: nothing is left to read.
            cursorRef.current = null;
            setCursor(null);
            setPaged(false);
            setPaging('idle');
            setCapped(false);
            setAnnounce('');
            failedRef.current = false;
          }
        },
        phase: (phase, count) => {
          clearDeletingRef.current = phase === 'deleting';
          if (alive()) setClearing({ phase, filter: kind, count });
        },
      });
      if (!alive()) return;
      if (result.state === 'count-failed') setClearNote(clearFailedLine(kind));
      else if (result.state === 'none') setClearNote(clearNoneLine(kind));
      else if (result.state === 'partial' || result.state === 'failed') setClearNote(clearKeptLine(result.kept, result.asked, kind));
      else if (result.state === 'stale') setClearNote(clearStaleLine(result, kind));
      // An answer was lost: "nothing was deleted" would be a guess. Read
      // the gallery again and show what is there.
      else if (result.state === 'unconfirmed') {
        heldSlicerRef.current = null;
        reload(clearUnconfirmedLine());
      } else if (result.state === 'done' && kind === 'all') {
        const deleted = deletedAllRef.current ?? result.asked;
        if (deleted > 0) setCleared(clearedLine(deleted, result.asked));
      } else if (result.state === 'done' && kind !== 'all') {
        // The whole list was read for the count and every one of that kind
        // is deleted: no unread page holds one.
        emptiedRef.current = [...emptiedRef.current, kind];
        setEmptied(emptiedRef.current);
        if (filterRef.current === kind) setAnnounce(noneAtEndLine(kind));
      }
    } finally {
      // A dropped Clear has already handed the button and its flags back,
      // and a newer one may hold them now.
      if (clearRunRef.current === run) {
        clearBusyRef.current = false;
        clearDeletingRef.current = false;
        if (alive()) setClearing(null);
      }
      ended();
      if (alive()) sendSlicerAgain();
    }
  }, [filter, getToken, dropCards, reload, setSlicerAside, sendSlicerAgain, quietRead, flushPending]);

  // "Show 2 new": the new generations go in on top, the page goes to the
  // top, and the first of them takes the focus, as on any press (DESIGN
  // 2026-11-14-278, -134).
  const showNew = useCallback(() => {
    const add = flushPending();
    const first = add.find((e) => matchesFilter(e, filterRef.current));
    setAnnounce('');
    toTopRef.current = true;
    focusCardRef.current = first ? first.jobId : null;
  }, [flushPending]);

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter((e) => matchesFilter(e, filter));
  }, [entries, filter]);

  // Render: loading. Today's grid with skeleton cards, so the page shows its
  // shape at once; no animation.
  // A list read for another account is never drawn (AUDIT keep-place r1, C1).
  // Not even for the one frame before a sign-out's effect runs (AUDIT
  // keep-place r2, N1).
  if (loading || (userId !== undefined && listOwner !== (userId ?? null) && !error)) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Your Gallery</h1>
          <p className="text-sm text-text-secondary mt-1" aria-hidden="true">&nbsp;</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" aria-busy="true">
          <p className="sr-only" role="status">Loading your gallery</p>
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden flex flex-col"
            >
              <div className="aspect-square bg-bg-primary" />
              <div className="p-3 flex flex-col gap-3">
                <div className="h-4 w-3/4 rounded bg-bg-hover" />
                <div className="h-3 w-1/3 rounded bg-bg-hover" />
                <div className="flex gap-2">
                  <div className="h-8 flex-1 rounded-md bg-bg-hover" />
                  <div className="h-8 flex-1 rounded-md bg-bg-hover" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render: error
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-text-secondary">
        <p className="text-sm">{error}</p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </div>
    );
  }

  // Render: empty
  // Only when nothing is loaded and nothing is unread: with pages unread
  // the grid's own end offers them.
  if (entries.length === 0 && cursor === null) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {legacyBanner}
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4 text-center">
          <Images size={48} className="text-text-muted" />
          <div className="space-y-2">
            {cleared ? (
              <>
                <h2 className="text-xl font-semibold text-text-primary">{CLEARED_HEADING}</h2>
                <p role="status" className="text-sm text-text-secondary max-w-md">{cleared}</p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-text-primary">No generations yet</h2>
                <p className="text-sm text-text-secondary max-w-md">
                  Head to Generate to create your first sprite. Your gallery syncs across devices. Sign in anywhere and your work is here.
                </p>
              </>
            )}
            {/* After a delete that could not be confirmed and a fresh read that
                found nothing: the line that says why the gallery was read again. */}
            {clearNote && <p role="status" className="text-[13px] text-text-secondary max-w-md">{clearNote}</p>}
          </div>
          <Link href="/generate">
            <Button>
              <Sparkles size={16} className="mr-2" /> Go to Generate
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // What Clear says while it counts, and when it could not or found nothing.
  const clearLine = clearing ? (clearing.phase === 'reading' ? clearCountingLine(clearing.filter) : clearDeletingLine(clearing.filter, clearing.count)) : clearNote;
  // Under a filter with no card to show: none of that kind once the list
  // has ended or a Clear has emptied the kind; how far the list has been
  // read while pages are unread.
  const kindDone = filter !== 'all' && (cursor === null || emptied.includes(filter));
  const noneLine = filter === 'all' || filteredEntries.length > 0 ? ''
    : kindDone ? noneAtEndLine(filter)
    : paging === 'idle' && !clearing ? noneYetLine(filter, entries.length)
    : '';
  // "Load more" stands while pages are unread, except under a filter whose
  // kind is known to have none left.
  // While a Clear runs no page is read, so the button would do nothing.
  const offersMore = cursor !== null && !clearing && !(filter !== 'all' && emptied.includes(filter));
  const nothingToClear = filteredEntries.length === 0 && (cursor === null || emptied.includes(filter));

  // "Show 2 new" in the app's top bar while new generations wait: it never
  // covers a card and moves nothing when it appears (DESIGN 2026-11-14-278).
  const waitingShown = listOwner === userId ? pending.filter((e) => matchesFilter(e, filter)).length : 0;
  const showNewButton = waitingShown > 0 ? (
    <Button
      variant="secondary"
      size="sm"
      onClick={showNew}
      aria-label={showNewName(waitingShown)}
      className="whitespace-nowrap"
    >
      {showNewLabel(waitingShown)}
    </Button>
  ) : null;

  // Render: gallery grid
  return (
    <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
      <div className="mb-6">
        {/* Under 640 px Clear sits on its own row under the count line, so its
            label never wraps (DESIGN 2026-11-14-086). */}
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Your Gallery</h1>
            <p className="text-sm text-text-secondary mt-1">
              {countLine(entries.length, cursor !== null, total)}
            </p>
            {/* In the top bar; here only if the bar has no slot. */}
            {showNewButton && (headerSlot ? createPortal(showNewButton, headerSlot) : showNewButton)}
          </div>
          <Button
            variant="ghost"
            // Never the disabled attribute: with nothing to clear the button
            // is dimmed and does nothing, and it keeps the focus.
            onClick={() => {
              if (!nothingToClear) void handleClearAll();
            }}
            aria-disabled={clearing || nothingToClear ? true : undefined}
            aria-busy={clearing ? true : undefined}
            className="-ml-4 sm:ml-0 flex-shrink-0 whitespace-nowrap pointer-coarse:min-h-11 text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
          >
            {clearing
              ? <Loader2 className="mr-2 h-4 w-4 sm:h-3.5 sm:w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <Trash2 className="mr-2 h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />} {clearLabel(filter)}
          </Button>
        </div>
        {/* Always rendered, so each line is said once. Its own row under the
            title, so a long line never squeezes the header on a phone. */}
        <p role="status" className={`text-[13px] text-text-secondary sm:text-right ${clearLine ? 'mt-1 sm:mt-2' : ''}`}>
          {clearLine}
        </p>
      </div>

      {/* Legacy localStorage backup banner — sunsets June 5, 2026 */}
      {legacyBanner}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        {(['all', 'create', 'animate'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => {
              // A tab shows another list: the waiting new generations go in.
              flushPending();
              setFilter(mode);
              setLandingHeld(false);
              setCapped(false);
              setAnnounce('');
              setNoneNext('');
              setClearNote('');
              // A Clear that is still counting is dropped, with its
              // question. One that is deleting goes on to its last answer.
              if (clearBusyRef.current && !clearDeletingRef.current) {
                // The count is dropped: the button is free at once, and
                // the new filter may read on.
                clearRunRef.current += 1;
                clearBusyRef.current = false;
                setClearing(null);
              }
            }}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              filter === mode
                ? 'bg-accent-amber text-bg-primary font-medium'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            {mode === 'all' ? 'All' : mode === 'create' ? 'Created' : 'Animated'}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredEntries.map((entry) => (
          <GalleryCard
            key={entry.jobId}
            entry={entry}
            imageUrl={imageUrls[entry.jobId]}
            onDownload={() => handleDownload(entry)}
            onSendToSlicer={() => {
              slicerJobRef.current = entry.jobId;
              return handleSendToSlicer(entry);
            }}
            onDelete={() => handleDelete(entry.jobId)}
            state={cardState[entry.jobId]}
          />
        ))}
        {/* A page on its way: four cards' worth of shape at the grid's end. */}
        {paging === 'loading' && Array.from({ length: 4 }, (_, i) => (
          <div
            key={`more-${i}`}
            aria-hidden="true"
            className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden flex flex-col"
          >
            <div className="aspect-square bg-bg-primary" />
            <div className="p-3 flex flex-col gap-3">
              <div className="h-4 w-3/4 rounded bg-bg-hover" />
              <div className="h-3 w-1/3 rounded bg-bg-hover" />
            </div>
          </div>
        ))}
      </div>

      {/* The grid's end. While pages are unread: "Load more", the keyboard
          and retry path (the next page also starts by itself as this comes
          near). After a failure: the line and "Try again"; nothing loads by
          itself until it is pressed. Once a paged list is all in: one quiet
          line. `relative` keeps the hidden status line inside the page. */}
      <div ref={endRef} className="relative mt-6 flex flex-wrap items-center justify-center gap-3 min-h-11">
        {/* Always rendered, so each line is said once. */}
        <p role="status" className="sr-only">
          {paging === 'loading' ? 'Loading more' : paging === 'failed' ? 'Could not load more.' : announce}
        </p>
        {offersMore && paging === 'failed' && (
          <p aria-hidden="true" className="text-[13px] text-text-secondary">Could not load more.</p>
        )}
        {noneLine && offersMore && (
          <p className="basis-full text-center text-[13px] text-text-secondary">{noneLine}</p>
        )}
        {!noneLine && noneNext && offersMore && paging === 'idle' && (
          <p aria-hidden="true" className="basis-full text-center text-[13px] text-text-secondary">{noneNext}</p>
        )}
        {offersMore && (
          <Button
            ref={moreRef}
            variant="secondary"
            size="sm"
            className="pointer-coarse:min-h-11 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
            aria-disabled={paging === 'loading' || undefined}
            aria-busy={paging === 'loading' || undefined}
            onClick={() => {
              if (paging !== 'loading') void runPass('more', true);
            }}
          >
            {paging === 'loading' ? 'Loading...' : paging === 'failed' ? 'Try again' : 'Load more'}
          </Button>
        )}
        {!offersMore && (noneLine || (cursor === null && paged && filteredEntries.length > 0)) && (
          <p ref={endLineRef} tabIndex={-1} className="text-[13px] text-text-secondary outline-none">
            {noneLine || END_LINE}
          </p>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
//  GalleryCard sub-component
// ──────────────────────────────────────────────────────────────────────────────

interface GalleryCardProps {
  entry: GalleryEntryV1;
  imageUrl: string | undefined;
  onDownload: () => void;
  onSendToSlicer: () => void;
  onDelete: () => void;
  /** Its own Delete is waiting for the server, or was refused. */
  state?: 'busy' | 'failed';
}

function GalleryCard({ entry, imageUrl, onDownload, onSendToSlicer, onDelete, state }: GalleryCardProps) {
  // Created or Animated by what the card holds (external audit SB-24).
  const kind = entryKind(entry);
  const ready = !!imageUrl;
  // Waiting for its own Delete: the card is dimmed and its controls do
  // nothing, but keep the focus (DESIGN 2026-11-14-147).
  const busy = state === 'busy';

  // Animated entries loop on the card once the image has loaded and its
  // size gives a sheet geometry (the entry records no frame size, so it is
  // guessed as the slicer does). Fine pointers play on hover; coarse
  // pointers toggle with a tap on the image. Otherwise the plain img shows.
  const [loadedDims, setLoadedDims] = useState<{ src: string; w: number; h: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [finePointer] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: fine)').matches
  );
  const loopGeometry = useMemo(() => {
    if (entry.mode !== 'animate' || !imageUrl || loadedDims?.src !== imageUrl) return null;
    const size = galleryFrameSizeGuess(loadedDims.w, loadedDims.h);
    return size ? sheetGeometry({ imageW: loadedDims.w, imageH: loadedDims.h, frameSize: size }) : null;
  }, [entry.mode, imageUrl, loadedDims]);

  return (
    <div
      data-gallery-card={entry.jobId}
      // The card can take the focus (never by Tab): after a press of "Load
      // more" the first new card gets it, named by its prompt. A card does
      // nothing when activated, so a repeated Enter is harmless.
      tabIndex={-1}
      role="group"
      aria-label={`${entry.prompt}, ${kind === 'create' ? 'Created' : 'Animated'}`}
      aria-busy={busy || undefined}
      className={`group bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden flex flex-col focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-amber ${busy ? 'opacity-60' : ''}`}
    >
      <div className="relative aspect-square bg-bg-primary flex items-center justify-center">
        {/* Mode badge */}
        <Badge
          className={`absolute top-2 left-2 z-10 ${
            kind === 'create' ? 'bg-accent-amber text-bg-primary' : 'bg-accent-teal text-bg-primary'
          }`}
        >
          {kind === 'create' ? 'Created' : (
            <>
              {/* The play mark only where the card plays: an animate job.
                  Animate from Text cards show the sheet (AUDIT ext-mediums r1
                  L5; DESIGN 2026-11-25-074 (a)). */}
              {entry.mode === 'animate' && <Play size={10} className="inline mr-1" aria-hidden="true" />}
              Animated
            </>
          )}
        </Badge>

        {/* Delete button — visible by default on touch, hover-revealed on
            fine pointers. Base `opacity-100` is the touch state; `pointer-fine`
            variants flip it back to opacity-0 unless the card is hovered.
            focus-visible keeps keyboard reveal. min-h-11 min-w-11 gives the
            44px tap area on mobile; md:min-h-0 md:min-w-0 restores the compact
            desktop visual. flex-centered so the icon stays centered when the
            mobile floor makes the button taller. */}
        <button
          onClick={busy ? undefined : onDelete}
          aria-disabled={busy || undefined}
          className="absolute top-2 right-2 z-10 p-1.5 bg-bg-primary/80 hover:bg-bg-primary rounded flex items-center justify-center min-h-11 min-w-11 md:min-h-0 md:min-w-0 opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label="Delete"
        >
          {busy
            ? <Loader2 size={14} className="text-text-secondary animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <Trash2 size={14} className="text-text-secondary" />}
        </button>

        {/* Image OR loading placeholder */}
        {imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={entry.prompt}
              className={loopGeometry ? 'hidden' : 'max-w-full max-h-full object-contain pixel-art-render'}
              style={{ imageRendering: 'pixelated' }}
              onLoad={(e) => {
                if (entry.mode !== 'animate') return;
                setLoadedDims({
                  src: imageUrl,
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                });
              }}
            />
            {loopGeometry && (
              <div
                className="w-full h-full"
                onMouseEnter={finePointer ? () => setHovered(true) : undefined}
                onMouseLeave={finePointer ? () => setHovered(false) : undefined}
                onClick={
                  finePointer
                    ? undefined
                    : (e) => {
                        e.stopPropagation();
                        setTapped((t) => !t);
                      }
                }
                role={finePointer ? undefined : 'button'}
                aria-pressed={finePointer ? undefined : tapped}
                aria-label={finePointer ? entry.prompt : 'Play or pause animation'}
              >
                <SheetLoop
                  src={imageUrl}
                  geometry={loopGeometry}
                  fps={8}
                  playing={finePointer ? hovered : tapped}
                  className="w-full h-full"
                />
              </div>
            )}
          </>
        ) : (
          <Loader2 size={16} className="animate-spin text-text-muted" />
        )}
      </div>

      <div className="p-3 flex flex-col gap-3 flex-1">
        <p className="text-sm text-text-primary line-clamp-2" title={entry.prompt}>
          {entry.prompt}
        </p>
        {state === 'failed'
          ? <p className="text-xs text-accent-amber">{DELETE_FAILED_LINE}</p>
          : <p className="text-xs text-text-muted">{relativeTime(entry.createdAt)}</p>}

        <div className="flex gap-2 mt-auto">
          <Button
            onClick={busy ? undefined : onSendToSlicer}
            disabled={!ready}
            aria-disabled={busy || undefined}
            variant="primary"
            className="flex-1"
            size="sm"
          >
            <Scissors size={14} className="mr-2" /> Slicer
          </Button>
          <Button
            onClick={busy ? undefined : onDownload}
            disabled={!ready}
            aria-disabled={busy || undefined}
            variant="secondary"
            className="flex-1"
            size="sm"
          >
            <Download size={14} className="mr-2" /> Download
          </Button>
        </div>
      </div>
    </div>
  );
}
