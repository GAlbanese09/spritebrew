/**
 * Server-side generation rate limiting via Cloudflare KV.
 *
 * KV key format: `gen_count:{userId}:{YYYY-MM-DD}`
 * TTL: 48 hours (auto-cleanup after the day rolls over).
 *
 * Admin users bypass the limit. If KV is unavailable the limit fails open
 * (allows the request) so a binding misconfiguration doesn't block everyone.
 */

import { ADMIN_USER_IDS, FREE_DAILY_LIMIT } from './generationLimits';

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

// ── Helpers ──

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

function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.includes(userId);
}

// ── Public API ──

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * Check whether the user may generate, and if so atomically increment their
 * daily count. Returns the result with the NEW count (post-increment).
 *
 * Admins always pass. KV failures fail open.
 */
export async function checkAndIncrementGenerationLimit(
  userId: string
): Promise<RateLimitResult> {
  if (isAdmin(userId)) {
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, remaining: Infinity };
  }

  const kv = getKV();
  if (!kv) {
    // KV unavailable — fail open
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
  }

  const today = todayKey();
  const key = kvKey(userId, today);

  try {
    const raw = await kv.get(key);
    const current = raw ? parseInt(raw, 10) : 0;

    if (current >= FREE_DAILY_LIMIT) {
      return { allowed: false, used: current, limit: FREE_DAILY_LIMIT, remaining: 0 };
    }

    const next = current + 1;
    await kv.put(key, String(next), { expirationTtl: 172800 }); // 48 h

    return {
      allowed: true,
      used: next,
      limit: FREE_DAILY_LIMIT,
      remaining: FREE_DAILY_LIMIT - next,
    };
  } catch {
    // KV error — fail open
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT };
  }
}

/**
 * Give back a generation credit (e.g. when the RD API call fails after we
 * already incremented). Best-effort — silently ignores errors.
 */
export async function decrementGenerationCount(userId: string): Promise<void> {
  if (isAdmin(userId)) return;

  const kv = getKV();
  if (!kv) return;

  const today = todayKey();
  const key = kvKey(userId, today);

  try {
    const raw = await kv.get(key);
    const current = raw ? parseInt(raw, 10) : 0;
    if (current > 0) {
      await kv.put(key, String(current - 1), { expirationTtl: 172800 });
    }
  } catch {
    // best effort
  }
}

/**
 * Read-only status check for the GET /api/generation-limit endpoint.
 */
export async function getGenerationLimitStatus(
  userId: string
): Promise<{ used: number; limit: number; remaining: number }> {
  if (isAdmin(userId)) {
    return { used: 0, limit: FREE_DAILY_LIMIT, remaining: Infinity };
  }

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
