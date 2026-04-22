/**
 * @deprecated — Replaced by tokenBalance.ts (token economy).
 *
 * This file is kept temporarily because:
 * 1. The old gen_count:{userId}:{date} KV keys are used by tokenBalance.ts
 *    to detect existing users for the lazy migration (early adopter bonus).
 * 2. The generation-limit API route still imports from here (deprecated).
 *
 * Safe to delete once all users have been migrated (visited at least once
 * after the token economy launch) and the generation-limit route is removed.
 */

import { FREE_DAILY_LIMIT } from './generationLimits';

// ── KV binding ──

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function kvKey(userId: string, date: string): string {
  return `gen_count:${userId}:${date}`;
}

/** @deprecated — Use getTokenBalance() from tokenBalance.ts instead. */
export async function getGenerationLimitStatus(
  userId: string
): Promise<{ used: number; limit: number; remaining: number }> {
  const kv = getKV();
  if (!kv) {
    return { used: 0, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
  }

  const today = todayKey();
  const key = kvKey(userId, today);

  try {
    const raw = await kv.get(key);
    const current = raw ? parseInt(raw, 10) : 0;
    return {
      used: current,
      limit: FREE_DAILY_LIMIT,
      remaining: Math.max(0, FREE_DAILY_LIMIT - current),
    };
  } catch {
    return { used: 0, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
  }
}
