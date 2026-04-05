/**
 * Per-user daily generation limit — client-side soft limit.
 *
 * Stored in localStorage under `spritebrew_gen_${userId}` as
 * `{ count: number, date: "YYYY-MM-DD" }`. Counts reset automatically
 * when the stored date doesn't match today.
 *
 * This will move to server-side tracking (Cloudflare KV / database) in a
 * future update — for now this is a soft limit that advanced users can bypass.
 */

export const FREE_DAILY_LIMIT = 5;

/**
 * Admin user IDs — bypass the daily generation limit.
 *
 * To find your Clerk userId: sign in on spritebrew.com, open the browser
 * console, and look for the `userId:` log printed by the Generate page.
 * Paste the value here and redeploy.
 */
export const ADMIN_USER_IDS: readonly string[] = [
  'user_3BtzTR8gHfGDiNXd1G8WFLQvEf2', // George
  'user_3Bu4G35OOLgpdDmYxtqsnoZfui2', // Admin #2
];

/** Is this user an admin with unlimited generations? */
export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const result = ADMIN_USER_IDS.includes(userId);
  if (typeof window !== 'undefined') {
    console.log('Admin check:', userId, ADMIN_USER_IDS, result);
  }
  return result;
}

interface CountRecord {
  count: number;
  date: string;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function storageKey(userId: string): string {
  return `spritebrew_gen_${userId}`;
}

/** Read today's generation count for a user. Auto-resets if the date rolled over. */
export function getGenerationCount(userId: string | null | undefined): number {
  if (!userId || typeof window === 'undefined') return 0;

  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return 0;

    const parsed = JSON.parse(raw) as CountRecord;
    if (!parsed || typeof parsed.count !== 'number') return 0;

    const today = todayKey();
    if (parsed.date !== today) {
      // Date rolled over — reset
      return 0;
    }
    return parsed.count;
  } catch {
    return 0;
  }
}

/** Increment today's count and return the new value. */
export function incrementGenerationCount(userId: string | null | undefined): number {
  if (!userId || typeof window === 'undefined') return 0;

  const today = todayKey();
  const current = getGenerationCount(userId);
  const next: CountRecord = { count: current + 1, date: today };

  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // localStorage unavailable — soft limit silently skips
  }

  return next.count;
}

/** Is the user at or above the daily limit? Admins always return false. */
export function isAtDailyLimit(userId: string | null | undefined): boolean {
  if (isAdminUser(userId)) return false;
  return getGenerationCount(userId) >= FREE_DAILY_LIMIT;
}

/**
 * How many generations remaining today.
 * Returns `Infinity` for admin users — forms should check `isAdminUser()` and
 * render an unlimited label instead of a numeric counter.
 */
export function remainingGenerations(userId: string | null | undefined): number {
  if (isAdminUser(userId)) return Infinity;
  return Math.max(0, FREE_DAILY_LIMIT - getGenerationCount(userId));
}
