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
 *
 * Release 2 (n1-release-2-spec.md revision 9, 6.2): the credit is one D1
 * movement (4.1) under `daily_login:{userId}:{UTC day}`, its release 1
 * `token_idempotency:` key the legacy evidence (4.13). Its outcomes stay
 * distinct, and the streak keys (which stay in KV, 6.3) are written only
 * after `applied`. Today and yesterday come from one clock read (FX-4).
 */

import {
  DAILY_LOGIN_TOKENS,
  STREAK_WEEKLY_BONUS_TOKENS,
  STREAK_INTERVAL_DAYS,
} from '@/lib/constants';
import { creditTokens } from '@/lib/tokenBalance';
import type { MovementOutcome } from '@/lib/ledger';

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

export interface DailyRewardResult {
  granted: number;
  streakDay: number;
  isStreakBonus: boolean;
  balance: number;
}

/**
 * What the helper did, for the route: `applied` carries the reward; every
 * other outcome shows none. `already` is today's streak key found;
 * `replayed` the credit found under today's key (or its legacy evidence);
 * `paused` and `error` as the movement answered (or a store that could not be
 * read: `error`, never a guess).
 */
export type DailyRewardOutcome =
  | { kind: 'applied'; reward: DailyRewardResult; rewardKey: string }
  | { kind: 'already' | 'replayed' | 'paused' | 'error'; rewardKey?: string; movement?: MovementOutcome };

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
      const nowMs = Date.now();
      const today = dayStamp(new Date(nowMs));
      const yesterday = dayStamp(new Date(nowMs - 86_400_000));
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
 * Grant today's daily-login reward for `userId`, once. Today is UTC, read
 * from one clock read with yesterday (FX-4).
 */
export async function checkAndGrantDailyReward(userId: string, nowMs: number = Date.now()): Promise<DailyRewardOutcome> {
  const kv = getKV();
  if (!kv) return { kind: 'error' };

  const today = dayStamp(new Date(nowMs));
  const yesterday = dayStamp(new Date(nowMs - 86_400_000));
  const rewardKey = `daily_login:${userId}:${today}`;

  let lastRewardDate: string | null;
  let prevCountRaw: string | null;
  try {
    lastRewardDate = await kv.get(`streak:${userId}:last_reward_date`);
    if (lastRewardDate === today) return { kind: 'already' };
    prevCountRaw = await kv.get(`streak:${userId}:count`);
  } catch {
    return { kind: 'error' };
  }
  const prevCount = prevCountRaw ? parseInt(prevCountRaw, 10) : 0;

  const continuing = lastRewardDate === yesterday;
  const streakCount = continuing && Number.isFinite(prevCount) && prevCount > 0
    ? prevCount + 1
    : 1;

  const isStreakBonus = streakCount > 0 && streakCount % STREAK_INTERVAL_DAYS === 0;
  const granted = isStreakBonus ? STREAK_WEEKLY_BONUS_TOKENS : DAILY_LOGIN_TOKENS;
  const reason = isStreakBonus
    ? `streak_bonus:${today}:day=${streakCount}`
    : `daily_login:${today}:day=${streakCount}`;

  let credit;
  try {
    credit = await creditTokens(userId, granted, reason, rewardKey, {
      source: isStreakBonus ? 'streak_bonus' : 'daily_login',
      legacy: `token_idempotency:${rewardKey}`,
    });
  } catch {
    return { kind: 'error', rewardKey };
  }
  if (credit.outcome === 'replayed') return { kind: 'replayed', rewardKey, movement: credit.outcome };
  if (credit.outcome === 'paused') return { kind: 'paused', rewardKey, movement: credit.outcome };
  if (credit.outcome !== 'applied' || credit.balance === null) return { kind: 'error', rewardKey, movement: credit.outcome };

  // The streak markers, only after `applied` (6.3). The credit stands if one
  // fails: the next day's streak then restarts, and nothing pays twice.
  try {
    await kv.put(`streak:${userId}:last_reward_date`, today);
    await kv.put(`streak:${userId}:count`, String(streakCount));
    const lifetimeMaxRaw = await kv.get(`streak:${userId}:lifetime_max`);
    const lifetimeMax = lifetimeMaxRaw ? parseInt(lifetimeMaxRaw, 10) : 0;
    if (streakCount > (Number.isFinite(lifetimeMax) ? lifetimeMax : 0)) {
      await kv.put(`streak:${userId}:lifetime_max`, String(streakCount));
    }
  } catch (err) {
    console.error(JSON.stringify({ source: 'daily-reward', event: 'streak_write_failed', reward_key: rewardKey, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' }));
  }

  return {
    kind: 'applied',
    rewardKey,
    reward: { granted, streakDay: streakCount, isStreakBonus, balance: credit.balance },
  };
}
