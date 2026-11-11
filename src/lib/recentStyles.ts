/**
 * Recent styles on /generate's Create form: the last styles the field moved
 * away from, newest first. Pure: the storage is passed in, so node can test it
 * (scripts/generate-picker-test.mjs). Persists per account in this browser
 * (accountRecentStorage).
 */

export const RECENT_STYLES_KEY = 'spritebrew_recent_styles';
export const MAX_RECENT = 3;

/** The part of Storage this needs. */
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One account's key: RECENT_STYLES_KEY, then _ and the userId. */
export function recentStylesKey(userId: string): string {
  return `${RECENT_STYLES_KEY}_${userId}`;
}

/**
 * `storage` seen through one account's key, for readRecent and writeRecent:
 * every read and write goes to recentStylesKey(userId). Null without a
 * userId or a storage, so nothing is read or written. The old key without a
 * userId is never read, copied or deleted.
 */
export function accountRecentStorage(
  storage: RecentStorage | null | undefined,
  userId: string | null | undefined,
): RecentStorage | null {
  if (!storage || !userId) return null;
  const key = recentStylesKey(userId);
  return {
    getItem: () => storage.getItem(key),
    setItem: (_key, value) => storage.setItem(key, value),
  };
}

/** Keeps known ids only, once each, at most MAX_RECENT. */
function clean(ids: readonly unknown[], validIds: ReadonlySet<string> | null): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    if (validIds && !validIds.has(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

/** The saved list. Missing storage, a throwing storage, bad JSON or a non-array give []. */
export function readRecent(
  storage: RecentStorage | null | undefined,
  validIds: Iterable<string>,
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_STYLES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return clean(parsed, new Set(validIds));
  } catch {
    return [];
  }
}

/** previousId goes to the front; currentId is left out; no repeats; at most MAX_RECENT. */
export function pushRecent(list: readonly string[], previousId: string, currentId: string): string[] {
  return clean([previousId, ...list].filter((id) => id !== currentId), null);
}

/** Saves the list. Never throws. */
export function writeRecent(storage: RecentStorage | null | undefined, list: readonly string[]): void {
  if (!storage) return;
  try {
    storage.setItem(RECENT_STYLES_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable: Recent lasts this visit only */
  }
}

/** What the Recent row shows: the list without the current style, at most MAX_RECENT. */
export function visibleRecent(list: readonly string[], currentId: string): string[] {
  return clean(list.filter((id) => id !== currentId), null);
}
