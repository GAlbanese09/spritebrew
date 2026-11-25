/**
 * The Gallery's paging (HQ room 2026-11-11-013; DESIGN 2026-11-14-074).
 *
 * The list API answers 50 entries at most, newest first, with a cursor for
 * the next page and no total. This module holds the rules that decide what
 * to read and what to say; it has no React and no DOM, and every read is
 * passed in, so the tests drive the real paths offline.
 */
import { entryKind, type GalleryEntryV1, type JobMode } from '@/lib/galleryTypes';

/** The most the list API answers in one page. */
export const GALLERY_PAGE_SIZE = 50;
/** A pass keeps reading until it has put this many more cards in view. */
export const PASS_MIN_CARDS = 12;
/** A pass never reads more than this many pages: a large gallery is never
 *  read whole without a scroll or a press. */
export const PASS_MAX_PAGES = 4;

export type GalleryFilter = 'all' | JobMode;

/** One page of the list. cursor is null on the last page. */
export interface GalleryListPage {
  entries: GalleryEntryV1[];
  cursor: string | null;
}

/** Reads the page after `cursor` (the first page for null). Rejects when the
 *  read fails. */
export type ReadGalleryPage = (cursor: string | null) => Promise<GalleryListPage>;

// entryKind lives in galleryTypes, shared with the delete route's kind check
// (HQ 2026-11-25-079); exported here too for the page and the tests.
export { entryKind };

export function matchesFilter(entry: GalleryEntryV1, filter: GalleryFilter): boolean {
  return filter === 'all' || entryKind(entry) === filter;
}

/** The entries of `page` whose ids are not in `known`, in the page's order,
 *  each once. The store pages by key, so a later page does not normally
 *  repeat an entry; this keeps the list right if one ever does. */
export function newEntries(known: ReadonlySet<string>, page: GalleryEntryV1[]): GalleryEntryV1[] {
  const seen = new Set(known);
  const fresh: GalleryEntryV1[] = [];
  for (const entry of page) {
    if (seen.has(entry.jobId)) continue;
    seen.add(entry.jobId);
    fresh.push(entry);
  }
  return fresh;
}

/** How many cards a pass should add before it stops.
 *  - A scroll to the grid's end or a press on "Load more": the next batch.
 *  - A filter with fewer cards than a screenful: enough to fill it.
 *  Zero means there is nothing to read for. */
export function passGoal(trigger: 'more' | 'filter', shown: number): number {
  return trigger === 'more' ? PASS_MIN_CARDS : Math.max(0, PASS_MIN_CARDS - shown);
}

/** Whether a pass goes on to another page. */
export function passContinues(state: { added: number; goal: number; pagesRead: number; more: boolean }): boolean {
  return state.more && state.added < state.goal && state.pagesRead < PASS_MAX_PAGES;
}

/** What a pass needs from the page. Every read and every write is passed
 *  in, so the pass runs offline in the tests exactly as it runs in the page. */
export interface PassPorts<Pictures> {
  /** Where the next page starts: null once the last page is in. */
  cursor: () => string | null;
  /** The ids this visit has shown. */
  known: () => ReadonlySet<string>;
  /** Whether an entry shows under the filter chosen right now. */
  matches: (entry: GalleryEntryV1) => boolean;
  /** How many cards show under that filter right now. */
  shown: () => number;
  read: ReadGalleryPage;
  /** The pictures of a page's new entries. */
  pictures: (entries: GalleryEntryV1[]) => Promise<Pictures>;
  /** False once the visit has ended (a new account, or the page left). */
  current: () => boolean;
  /** Puts a page in: its new entries after the ones shown. */
  commit: (page: { fresh: GalleryEntryV1[]; cursor: string | null; pictures: Pictures }) => void;
  /** Pictures read for a visit that ended meanwhile: release them. */
  drop: (pictures: Pictures) => void;
  /** True: stop before the next read (a kind a Clear has emptied). Never
   *  stops when absent. */
  stop?: () => boolean;
}

export interface PassResult {
  /** none: nothing to read for. done: the pass ended as planned. failed: a
   *  read failed; the pages before it stay. ended: the visit ended. */
  state: 'none' | 'done' | 'failed' | 'ended';
  /** Cards the pass put in view under the filter. */
  added: number;
  /** Entries the pass read and put in the list, of any kind. */
  read: number;
  pagesRead: number;
  /** Stopped at the page cap with more to read and its goal unmet. */
  capped: boolean;
}

/**
 * One pass: the next page, and under a filter the pages after it, until the
 * pass has put a screenful more in view, the list ends, or it has read its
 * cap of pages. A page is committed whole or not at all, and a failure
 * leaves the pages already in.
 */
export async function runGalleryPass<Pictures>(
  trigger: 'more' | 'filter',
  ports: PassPorts<Pictures>
): Promise<PassResult> {
  const goal = ports.cursor() === null ? 0 : passGoal(trigger, ports.shown());
  let added = 0;
  let read = 0;
  let pagesRead = 0;
  const stop = ports.stop ?? (() => false);
  if (goal === 0) return { state: 'none', added, read, pagesRead, capped: false };
  try {
    // A stop (a Clear has emptied the kind shown) is read before each list
    // page and before its pictures, so a pass on its way reads no further
    // (AUDIT gallery-paging-r3, L3-2).
    while (!stop() && passContinues({ added, goal, pagesRead, more: ports.cursor() !== null })) {
      const page = await ports.read(ports.cursor());
      if (!ports.current()) return { state: 'ended', added, read, pagesRead, capped: false };
      if (stop()) break;
      const fresh = newEntries(ports.known(), page.entries);
      const pictures = await ports.pictures(fresh);
      if (!ports.current()) {
        ports.drop(pictures);
        return { state: 'ended', added, read, pagesRead, capped: false };
      }
      ports.commit({ fresh, cursor: page.cursor, pictures });
      pagesRead += 1;
      read += fresh.length;
      added += fresh.filter(ports.matches).length;
    }
  } catch {
    return { state: ports.current() ? 'failed' : 'ended', added, read, pagesRead, capped: false };
  }
  const capped = !stop() && ports.cursor() !== null && added < goal && pagesRead >= PASS_MAX_PAGES;
  return { state: 'done', added, read, pagesRead, capped };
}

/** The line under the title. With pages unread the total is not known, so
 *  the count says "50+" until the last page is in. */
export function countLine(loaded: number, more: boolean, total: number | null = null): string {
  // Once a Clear has counted the whole list the true total is known, and it
  // is what the line says while pages are still unread.
  if (more && total !== null && total > 0 && total >= loaded) return `${total} generation${total === 1 ? '' : 's'} · synced to your account`;
  // Nothing loaded, pages unread and no total (every loaded card was
  // deleted one by one): "0+" would read as none.
  if (loaded === 0 && more) return 'Not all loaded yet · synced to your account';
  const count = more ? `${loaded}+ generations` : `${loaded} generation${loaded === 1 ? '' : 's'}`;
  return `${count} · synced to your account`;
}

/** What a screen reader hears once when a pass ends with cards. */
export function loadedLine(added: number): string {
  return added > 0 ? `Loaded ${added} more` : '';
}

/** The line at the end of a list that was read in pages and shows cards. */
export const END_LINE = "That's everything.";

/**
 * What a screen reader hears once when a pass ends: the cards it loaded,
 * or, when it put none in view, the line the page now shows in their
 * place. Empty when nothing new is on screen.
 */
export function passEndLine(state: {
  added: number;
  filter: GalleryFilter;
  /** Cards in view under the filter. */
  shown: number;
  /** Entries loaded, of any kind. */
  read: number;
  /** Pages are still unread. */
  more: boolean;
  /** Entries this pass read, of any kind (0 when absent). */
  readThisPass?: number;
}): string {
  if (state.added > 0) return loadedLine(state.added);
  if (state.filter !== 'all' && state.shown === 0) {
    return state.more ? noneYetLine(state.filter, state.read) : noneAtEndLine(state.filter);
  }
  // Cards of the kind show, the pass read some and found none of it, and
  // pages remain (AUDIT gallery-paging-r1, L3, the case logged).
  if (state.filter !== 'all' && state.more && (state.readThisPass ?? 0) > 0) return noneNextLine(state.filter, state.readThisPass!);
  return !state.more && state.shown > 0 ? END_LINE : '';
}

/** Under a filter with cards showing: a pass read `read` more and found
 *  none of the kind, and pages remain. Shown beside "Load more" and said
 *  once (DESIGN 2026-11-14-230). */
export function noneNextLine(filter: JobMode, read: number): string {
  return `None of the next ${read} were ${kindOf(filter)}. Load more looks further.`;
}

/** What a return to the Gallery says once, hidden, when its quiet read found
 *  new generations of the kind shown (DESIGN 2026-11-14-230). */
export function newAtTopLine(count: number): string {
  return count === 1 ? '1 new generation at the top.' : `${count} new generations at the top.`;
}

/**
 * Scrolled down, new generations a return found wait behind a button in the
 * app's top bar, so nothing on screen moves (DESIGN 2026-11-14-278; words HQ
 * 2026-11-14-282): its label, its accessible name, and the hidden line said
 * once when it appears.
 */
export function showNewLabel(count: number): string {
  return `Show ${count} new`;
}
export function showNewName(count: number): string {
  return count === 1 ? 'Show 1 new generation' : `Show ${count} new generations`;
}
export function newWaitingLine(count: number): string {
  return count === 1
    ? '1 new generation. Press Show 1 new at the top of the page to see it.'
    : `${count} new generations. Press Show ${count} new at the top of the page to see them.`;
}

/**
 * Every entry after `cursor`, entries only: what "Clear" reads before it
 * asks, so its question carries the true count. Rejects when any read fails
 * (never ask with a partial count), and when `alive` turns false (the visit
 * ended while reading).
 */
export async function readRest(
  read: ReadGalleryPage,
  cursor: string | null,
  known: ReadonlySet<string>,
  alive: () => boolean = () => true
): Promise<GalleryEntryV1[]> {
  const rest: GalleryEntryV1[] = [];
  const seen = new Set(known);
  let next = cursor;
  // The cursors already followed: a list that hands the same cursor back
  // would never end.
  const followed = new Set<string>();
  while (next !== null) {
    if (followed.has(next)) throw new Error('gallery list did not advance');
    followed.add(next);
    const page = await read(next);
    if (!alive()) throw new Error('gallery visit ended');
    for (const entry of newEntries(seen, page.entries)) {
      seen.add(entry.jobId);
      rest.push(entry);
    }
    next = page.cursor;
  }
  return rest;
}

/** "Created" or "Animated": a filter's kind as the page names it. */
function kindOf(filter: JobMode): string {
  return filter === 'create' ? 'Created' : 'Animated';
}

/** The Clear button's own label. */
export function clearLabel(filter: GalleryFilter): string {
  return filter === 'all' ? 'Clear all' : `Clear ${kindOf(filter)}`;
}

/** The words of the question "Clear" asks, with the true count. `others` is
 *  how many generations of another kind stay (a filter's Clear only). */
export function clearQuestion(count: number, filter: GalleryFilter, others = 0, moved = 0): string {
  const kind = filter === 'all' ? '' : `${kindOf(filter)} `;
  const all = count === 1 ? '1' : `all ${count}`;
  // Under Animated, how many of the set used to sit under Created: Animate
  // from Text results and older Creates made with an animation style. A
  // record does not say which of the two it is (both used the same styles),
  // so the combined form (HQ 2026-11-25-076 (b); DESIGN 2026-11-25-080).
  const includes = filter !== 'animate' || moved <= 0 ? ''
    // A set of one that is itself moved says what it is (AUDIT ext-mediums r2 L8).
    : count === 1 ? ' It is an Animate from Text result or an older Create made with an animation style.'
    : moved === 1 ? ' It includes 1 Animate from Text result or older Create made with an animation style.'
    : ` It includes ${moved} Animate from Text results and older Creates made with an animation style.`;
  const stay = filter === 'all' || others <= 0 ? '' : others === 1 ? ' The other 1 stays.' : ` The other ${others} stay.`;
  return `Delete ${all} ${kind}generation${count === 1 ? '' : 's'}?${includes}${stay} This cannot be undone.`;
}

/** What Clear says while it reads the rest of the list. */
export function clearCountingLine(filter: GalleryFilter): string {
  return filter === 'all' ? 'Counting your generations...' : `Counting your ${kindOf(filter)} generations...`;
}

/** What Clear says when that read failed: what is safe first, then the way on. */
export function clearFailedLine(filter: GalleryFilter): string {
  return `Nothing was deleted: we could not count your whole gallery. Press ${clearLabel(filter)} to try again.`;
}

/** What Clear says when there is nothing of its kind. */
export function clearNoneLine(filter: GalleryFilter): string {
  return filter === 'all' ? 'Nothing to clear.' : `No ${kindOf(filter)} generations to clear.`;
}

/** Under a filter with no card yet and pages unread: how far the list has
 *  been read. Shown above "Load more". */
export function noneYetLine(filter: JobMode, read: number): string {
  return `No ${kindOf(filter)} generations in your newest ${read} yet.`;
}

/** Under a filter, a list that ended with no card of that kind. */
export function noneAtEndLine(filter: JobMode): string {
  return `No ${kindOf(filter)} generations.`;
}

/** What Clear all says when the server deleted more than it counted: the
 *  generations made after the press went too (AUDIT gallery-paging-r1, L1;
 *  DESIGN 2026-11-14-230). Clear all only: a kind's Clear deletes only what
 *  it counted (HQ 2026-11-14-232). */
export function clearMoreLine(deleted: number, extra: number): string {
  return `Deleted ${deleted} generations, including ${extra} made after you pressed ${clearLabel('all')}.`;
}

/** An emptied Gallery after Clear all, this visit: its heading, and the
 *  line under it in place of the usual words (DESIGN 2026-11-14-243). The
 *  total is the server's own count; the more line when it deleted more than
 *  the press counted. */
export const CLEARED_HEADING = 'Gallery cleared';
export function clearedLine(deleted: number, asked: number): string {
  if (deleted > asked) return clearMoreLine(deleted, deleted - asked);
  return `Deleted ${deleted} generation${deleted === 1 ? '' : 's'}.`;
}

/** What Clear says while the server deletes. */
export function clearDeletingLine(filter: GalleryFilter, count: number): string {
  const kind = filter === 'all' ? '' : `${kindOf(filter)} `;
  return `Deleting ${count} ${kind}generation${count === 1 ? '' : 's'}...`;
}

/** What Clear says when not everything it was asked to delete is gone:
 *  what happened first, then what is left and the way on. A partial delete
 *  never reads as success (HQ 2026-11-14-128). */
export function clearKeptLine(kept: number, asked: number, filter: GalleryFilter): string {
  if (kept >= asked) return `Nothing was deleted: the request did not go through. Press ${clearLabel(filter)} to try again.`;
  const kind = filter === 'all' ? '' : `${kindOf(filter)} `;
  return `Deleted ${asked - kept} of ${asked} ${kind}generations. The other ${kept === 1 ? 'one is' : `${kept} are`} still here: press ${clearLabel(filter)} to try again.`;
}

/** What Clear says when the server refused some of its deletes because the
 *  page counted them by an older rule (HQ 2026-11-25-079): what happened
 *  first, then the way on, in the server's words. */
export function clearStaleLine(r: { asked: number; deleted: number; stale?: number; refused?: number }, filter: GalleryFilter): string {
  const stale = r.stale ?? 0;
  const refused = r.refused ?? 0;
  const kind = filter === 'all' ? '' : `${kindOf(filter)} `;
  const were = (n: number) => (n === 1 ? 'was' : 'were');
  // DESIGN 2026-11-25-082. With sign-in refusals among them, "out of date"
  // names only the stale ones (AUDIT ext-mediums r2 L1), in DESIGN -087's
  // words. A stale Clear is always a kind's Clear, of two or more here.
  if (refused > 0) {
    if (r.deleted === 0) return `None of the ${r.asked} ${kind}generations were deleted: ${stale} because this page is out of date, and ${refused} because the request did not go through. Reload the Gallery and try again.`;
    return `Deleted ${r.deleted} of ${r.asked} ${kind}generations. ${stale} ${were(stale)} not deleted, because this page is out of date, and ${refused} did not go through. Reload the Gallery and try again.`;
  }
  if (r.deleted === 0) return 'Nothing was deleted, because this page is out of date. Reload the Gallery and try again.';
  return `Deleted ${r.deleted} of ${r.asked} ${kind}generations. The other ${stale} ${were(stale)} not deleted, because this page is out of date. Reload the Gallery and try again.`;
}

/** What a delete call found out. deleted: the server deleted it, or says in
 *  its own words that it is not there. refused: the server said no before
 *  touching anything (the sign-in was not accepted). unknown: anything else,
 *  a 5xx, an answer that is not the route's, or no answer at all; the
 *  server may have deleted and failed to say so. stale: the single route
 *  refused an entry of another kind than the Clear's, deleting nothing. */
export type DeleteOutcome = 'deleted' | 'refused' | 'unknown' | 'stale';

/** Reads a delete's answer. A 404 counts as gone only when it is the single
 *  delete route's own (its JSON body says `deleted: false`): a 404 from
 *  anything else proves nothing. */
export function deleteOutcome(answer: { ok: boolean; status: number; body: unknown }, single: boolean): DeleteOutcome {
  if (answer.ok) return 'deleted';
  if (answer.status === 401 || answer.status === 403) return 'refused';
  // The single route refused an entry of another kind than the Clear's: the
  // page's rule is out of date; nothing was deleted (HQ 2026-11-25-079).
  // Only the route's own answer, its body marked (AUDIT ext-mediums r2 L2):
  // any other 409 proves nothing.
  const body = answer.body as { deleted?: unknown; stale?: unknown } | null;
  if (single && answer.status === 409 && typeof body === 'object' && body !== null && body.stale === true) return 'stale';
  if (single && answer.status === 404 && typeof body === 'object' && body !== null && body.deleted === false) return 'deleted';
  return 'unknown';
}

/** What Clear says when a delete's outcome could not be confirmed: the
 *  page then reads the gallery again and shows what is there. */
export function clearUnconfirmedLine(): string {
  return 'The delete may have gone through, so your gallery was loaded again to show what is there.';
}

/** What a card says when its own Delete did not go through. */
export const DELETE_FAILED_LINE = 'Not deleted. Press Delete to try again.';

/** What a single Delete needs from the page. */
export interface DeletePorts {
  /** The browser's question; true for yes. */
  ask: () => boolean;
  /** False once the visit has ended. */
  current: () => boolean;
  /** The card waits (true) or is done waiting (false). */
  busy: (on: boolean) => void;
  /** The delete call; the token is fetched inside it. */
  send: () => Promise<DeleteOutcome>;
  /** The server has deleted it: the card leaves the page. */
  removed: () => void;
}

/** A single Delete, whole: the question, the call, and the card leaving
 *  only when the server has deleted it. Anything else leaves the card. */
export async function deleteEntry(ports: DeletePorts): Promise<'declined' | 'dropped' | DeleteOutcome> {
  if (!ports.ask()) return 'declined';
  ports.busy(true);
  let outcome: DeleteOutcome;
  try {
    outcome = await ports.send();
  } catch {
    outcome = 'unknown';
  }
  if (!ports.current()) return 'dropped';
  ports.busy(false);
  if (outcome === 'deleted') ports.removed();
  return outcome;
}

/** What Clear needs from the page. Every read, every question and every
 *  delete is passed in, so the whole of Clear runs offline in the tests
 *  exactly as it runs in the page. */
export interface ClearPorts {
  /** The filter chosen when Clear was pressed. */
  filter: GalleryFilter;
  /** Resolves once no page is on its way in: a page that lands while Clear
   *  counts would be counted twice. */
  settled: () => Promise<void>;
  /** The list as shown and where its unread part starts, read at one
   *  moment. */
  snapshot: () => { entries: GalleryEntryV1[]; cursor: string | null };
  /** The ids deleted in this visit. */
  gone: () => ReadonlySet<string>;
  /** One page of the list, with a sign-in token fetched for that call. */
  read: ReadGalleryPage;
  /** Puts the question to the person; true for yes. */
  ask: (question: string, ids: readonly string[]) => boolean;
  /** False once this Clear is dropped: the visit ended, or the person
   *  chose another filter while it counted. */
  current: () => boolean;
  /** "Delete everything". The token is fetched inside, at the call, so
   *  never before the person's answer. */
  deleteAll: () => Promise<DeleteOutcome>;
  /** One generation, with the kind the Clear counted it as; the server
   *  refuses an entry of another kind (HQ 2026-11-25-079). The token is
   *  fetched inside, at each call. */
  deleteOne: (jobId: string, kind: JobMode) => Promise<DeleteOutcome>;
  /** The server has deleted these: take them off the page. */
  removed: (ids: string[], all: boolean) => void;
  /** What the button and its line show while Clear works. */
  phase: (phase: 'reading' | 'deleting', count: number) => void;
  /** The whole list is counted: how many generations the account holds now. */
  counted: (total: number) => void;
}

export interface ClearResult {
  /** none: nothing of that kind. count-failed: the rest of the list could
   *  not be read, so nothing was asked or deleted. declined: the person
   *  said no. dropped: the visit ended or the filter changed before the
   *  question, or the visit ended while the deletes ran (the rest are not
   *  sent). done: all deleted. partial: the server refused some. failed: it
   *  refused all. unconfirmed: at least one answer was lost or was not a
   *  plain yes or no, so what is left is not known. */
  state: 'none' | 'count-failed' | 'declined' | 'dropped' | 'done' | 'partial' | 'failed' | 'unconfirmed' | 'stale';
  /** Refused by the server as of another kind (the page's rule is out of date). */
  stale?: number;
  /** Refused before anything was touched (the sign-in was not accepted). */
  refused?: number;
  /** The number in the question. */
  asked: number;
  deleted: number;
  /** Asked for and still on the server, by the server's own word. */
  kept: number;
  /** Asked for, with no usable answer. */
  unknown: number;
}

/** How many deletes of a kind's Clear are on their way at once. */
export const CLEAR_WORKERS = 6;

/**
 * Clear, whole (HQ 2026-11-14-075): wait for a page on its way, take one
 * snapshot of the list, read the rest (entries only), ask with the true
 * count, and only then delete, reading every answer. Nothing leaves the
 * page until the server has deleted it, so a refused delete never shows as
 * done; what the server kept is counted and stays on the page.
 */
export async function clearGallery(ports: ClearPorts): Promise<ClearResult> {
  const result = (state: ClearResult['state'], asked = 0, deleted = 0, unknown = 0): ClearResult =>
    ({ state, asked, deleted, kept: asked - deleted - unknown, unknown });
  await ports.settled();
  if (!ports.current()) return result('dropped');
  const snap = ports.snapshot();
  let rest: GalleryEntryV1[] = [];
  if (snap.cursor !== null) {
    ports.phase('reading', 0);
    try {
      const known = new Set([...snap.entries.map((e) => e.jobId), ...ports.gone()]);
      rest = await readRest(ports.read, snap.cursor, known, ports.current);
    } catch {
      return result(ports.current() ? 'count-failed' : 'dropped');
    }
  }
  if (!ports.current()) return result('dropped');
  // One set, each generation once, without the ones deleted meanwhile.
  const gone = ports.gone();
  const everything = newEntries(gone, [...snap.entries, ...rest]);
  ports.counted(everything.length);
  const targets = everything.filter((e) => matchesFilter(e, ports.filter));
  if (targets.length === 0) return result('none');
  const asked = targets.length;
  const ids = targets.map((e) => e.jobId);
  const moved = ports.filter === 'animate' ? targets.filter((e) => e.mode === 'create').length : 0;
  if (!ports.ask(clearQuestion(asked, ports.filter, everything.length - asked, moved), ids)) return result('declined', asked);

  ports.phase('deleting', asked);
  const send = async (call: () => Promise<DeleteOutcome>): Promise<DeleteOutcome> => {
    try {
      return await call();
    } catch {
      return 'unknown';
    }
  };
  if (ports.filter === 'all') {
    const outcome = await send(ports.deleteAll);
    if (outcome === 'refused') return result('failed', asked);
    // Only a delete is done; anything else might not be (AUDIT ext-mediums r2 L4).
    if (outcome !== 'deleted') return result('unconfirmed', asked, 0, asked);
    ports.removed(ids, true);
    return result('done', asked, asked);
  }
  // A kind: one call a generation, a few at a time. Each card goes when
  // its own delete is answered. Once the visit has ended nothing more is
  // sent: the page that asked is gone, and so may be the account.
  const queue = [...ids];
  const kind = ports.filter as JobMode;
  let deleted = 0;
  let unknown = 0;
  let stale = 0;
  let refused = 0;
  let ended = false;
  const worker = async (): Promise<void> => {
    for (let jobId = queue.shift(); jobId !== undefined; jobId = queue.shift()) {
      if (!ports.current()) {
        ended = true;
        return;
      }
      const outcome = await send(() => ports.deleteOne(jobId as string, kind));
      if (outcome === 'deleted') {
        deleted += 1;
        ports.removed([jobId], false);
      } else if (outcome === 'unknown') {
        unknown += 1;
      } else if (outcome === 'stale') {
        stale += 1;
      } else {
        refused += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: CLEAR_WORKERS }, worker));
  if (ended) return result('dropped', asked, deleted, unknown);
  if (unknown > 0) return result('unconfirmed', asked, deleted, unknown);
  if (stale > 0) return { ...result('stale', asked, deleted), stale, refused };
  return result(deleted === asked ? 'done' : deleted === 0 ? 'failed' : 'partial', asked, deleted);
}
