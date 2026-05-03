/**
 * Daily login reward + streak tracking.
 *
 * KV schema (all per-user):
 *   streak:{userId}:last_reward_date  → "YYYY-MM-DD" of last reward grant
 *   streak:{userId}:count             → current consecutive-day streak (string int)
 *   streak:{userId}:lifetime_max      → highest streak ever achieved (string int)
 *
 * Strict reset: missing a single day collapses the streak to 0 (and the next
 * grant restarts it at 1). Every 7th consecutive day pays the doubled bonus.
 * Idempotency: same-day double-fire is rejected at the date check, and the
 * underlying creditTokens() also dedupes on the daily idempotency key.
 */

import {
  DAILY_LOGIN_TOKENS,
  STREAK_WEEKLY_BONUS_TOKENS,
  STREAK_INTERVAL_DAYS,
} from '@/lib/constants';
import { creditTokens } from '@/lib/tokenBalance';

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

/** UTC-ish date stamp ("YYYY-MM-DD") so streak tracking is timezone-stable. */
function dayStamp(d: Date): string {
  return d.toISOString().split('T')[0];
}

function yesterdayStamp(): string {
  const d = new Date(Date.now() - 86_400_000);
  return dayStamp(d);
}

export interface DailyRewardResult {
  granted: number;
  streakDay: number;
  isStreakBonus: boolean;
  balance: number;
}

export interface StreakSnapshot {
  count: number;
  lifetimeMax: number;
  lastRewardDate: string | null;
}

/**
 * Read-only streak snapshot for the sidebar / status displays.
 * Does NOT grant or modify anything.
 */
export async function getStreakSnapshot(userId: string): Promise<StreakSnapshot> {
  const kv = getKV();
  if (!kv) return { count: 0, lifetimeMax: 0, lastRewardDate: null };

  try {
    const [countRaw, maxRaw, lastDate] = await Promise.all([
      kv.get(`streak:${userId}:count`),
      kv.get(`streak:${userId}:lifetime_max`),
      kv.get(`streak:${userId}:last_reward_date`),
    ]);

    let count = countRaw ? parseInt(countRaw, 10) : 0;
    if (!Number.isFinite(count) || count < 0) count = 0;

    // If the user has missed a day, the *display* count should already be 0.
    // We don't write the reset here (read-only), but we render it as 0.
    if (lastDate) {
      const today = dayStamp(new Date());
      const yesterday = yesterdayStamp();
      if (lastDate !== today && lastDate !== yesterday) {
        count = 0;
      }
    }

    const lifetimeMax = maxRaw ? parseInt(maxRaw, 10) : 0;
    return {
      count,
      lifetimeMax: Number.isFinite(lifetimeMax) ? lifetimeMax : 0,
      lastRewardDate: lastDate ?? null,
    };
  } catch {
    return { count: 0, lifetimeMax: 0, lastRewardDate: null };
  }
}

/**
 * Idempotently grant the daily-login reward for `userId` (or null if already
 * claimed today / KV unavailable). Updates streak counters atomically *enough*
 * for our scale — KV has no transactions, but a same-day double-call is gated
 * by the date check on `last_reward_date`.
 */
export async function checkAndGrantDailyReward(
  userId: string
): Promise<DailyRewardResult | null> {
  const kv = getKV();
  if (!kv) return null;

  const today = dayStamp(new Date());

  try {
    const lastRewardDate = await kv.get(`streak:${userId}:last_reward_date`);
    if (lastRewardDate === today) return null; // already claimed today

    const yesterday = yesterdayStamp();
    const prevCountRaw = await kv.get(`streak:${userId}:count`);
    const prevCount = prevCountRaw ? parseInt(prevCountRaw, 10) : 0;

    const continuing = lastRewardDate === yesterday;
    const streakCount = continuing && Number.isFinite(prevCount) && prevCount > 0
      ? prevCount + 1
      : 1;

    const isStreakBonus =
      streakCount > 0 && streakCount % STREAK_INTERVAL_DAYS === 0;
    const granted = isStreakBonus ? STREAK_WEEKLY_BONUS_TOKENS : DAILY_LOGIN_TOKENS;

    // Credit tokens. The daily idempotency key prevents a same-day double-credit
    // even if this function were somehow called twice in parallel before the
    // date write below lands.
    const reason = isStreakBonus
      ? `streak_bonus:${today}:day=${streakCount}`
      : `daily_login:${today}:day=${streakCount}`;
    const creditResult = await creditTokens(
      userId,
      granted,
      reason,
      `daily_login:${userId}:${today}`,
      {
        source: isStreakBonus ? 'streak_bonus' : 'daily_login',
        streakDay: streakCount,
      }
    );

    if (!creditResult.success) return null;

    // Persist streak state
    await kv.put(`streak:${userId}:last_reward_date`, today);
    await kv.put(`streak:${userId}:count`, String(streakCount));

    const lifetimeMaxRaw = await kv.get(`streak:${userId}:lifetime_max`);
    const lifetimeMax = lifetimeMaxRaw ? parseInt(lifetimeMaxRaw, 10) : 0;
    if (streakCount > (Number.isFinite(lifetimeMax) ? lifetimeMax : 0)) {
      await kv.put(`streak:${userId}:lifetime_max`, String(streakCount));
    }

    return {
      granted,
      streakDay: streakCount,
      isStreakBonus,
      balance: creditResult.balance,
    };
  } catch {
    return null;
  }
}
