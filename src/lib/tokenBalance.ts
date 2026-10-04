/**
 * Token balances on the D1 ledger, `spritebrew-ledger` (n1-release-2-spec.md
 * revision 9, S4; 6.2: "4.1, 4.2 behind the same names"). Money truth is the
 * ledger: every credit is one guarded batch (src/lib/money.ts, src/lib/ledger.ts),
 * and the balance is read from `balances`, failing closed: never
 * SIGNUP_BONUS_TOKENS as a guess and never a fail-open debit. Release 2 writes
 * no `token_balance:`, `token_idempotency:` or `token_tx:` key (009 A).
 *
 * KV keys that stay (6.3), all gates or records, none of them money:
 *   bonus_discord_joined:{userId}, bonus_first_share:{userId} (TTL 50 days)
 *   lifetime_free_pro:{userId}, lifetime_free_fast:{userId}
 *   purchase:{userId}:has_paid, disposable_blocked:{userId}
 *   signup_grant:{userId}, signup_bonus_modal_shown:{userId}
 *   bonus_email_list:{userId}
 */

import {
  EARN_BACK_DISCORD_JOINED_TOKENS,
  EARN_BACK_FIRST_SHARE_TOKENS,
  EARN_BACK_FLAG_TTL_SECONDS,
} from '@/lib/constants';
import type { MovementResult } from '@/lib/ledger';
import { getBalance, ledgerCtx, move, MoneyUnavailableError, readBalanceStrict as readStrict } from '@/lib/money';

// S16: email_verified removed (bot-passable). Discord / first_share remain
// wired via grantEarnBackBonus but lack a UI trigger.
export type EarnBackType = 'discord_joined' | 'first_share';
export type FreeTierBucket = 'pro' | 'fast';

const EARN_BACK_FLAG: Record<EarnBackType, string> = {
  discord_joined: 'bonus_discord_joined',
  first_share: 'bonus_first_share',
};

const EARN_BACK_AMOUNT: Record<EarnBackType, number> = {
  discord_joined: EARN_BACK_DISCORD_JOINED_TOKENS,
  first_share: EARN_BACK_FIRST_SHARE_TOKENS,
};

const LIFETIME_COUNTER_KEY: Record<FreeTierBucket, string> = {
  pro: 'lifetime_free_pro',
  fast: 'lifetime_free_fast',
};

// ── KV binding (the gates) ──

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

export type TransactionSource =
  | 'signup'
  | 'early_adopter'
  | 'email_list'
  | 'daily_login'
  | 'streak_bonus'
  | 'discord_joined'
  | 'first_share'
  | 'token_pack_purchase'
  | 'generation_failed_refund'
  | 'refund_debit'
  | 'dispute_debit'
  | 'generation';

// ── Balances and credits ──

/**
 * The user's balance, opened by policy on first use (4.2). Paused:
 * MoneyPausedError; unconfirmed: MoneyUnavailableError.
 */
export async function getTokenBalance(userId: string): Promise<number> {
  return getBalance(userId);
}

/** The stored balance only, no opening; null when it cannot be known. */
export async function readBalanceStrict(userId: string): Promise<number | null> {
  return readStrict(userId);
}

/**
 * A credit (4.1) under its key from 4.13's table, with its legacy evidence.
 * Answers the movement's verified outcome; the caller acts only on `applied`
 * (and, where the spec says so, `replayed`). A missing binding answers
 * `error`, never a credit.
 */
export async function creditTokens(
  userId: string,
  amount: number,
  reason: string,
  idem: string,
  opts: { source: TransactionSource | null; legacy?: string | null; meta?: string | null }
): Promise<MovementResult> {
  let ctx;
  try {
    ctx = ledgerCtx();
  } catch (err) {
    if (err instanceof MoneyUnavailableError) return { outcome: 'error', id: '', balance: null };
    throw err;
  }
  return move(ctx, {
    uid: userId, type: 'credit', amount, reason, source: opts.source, idem,
    legacy1: opts.legacy ?? null, legacy2: null, meta: opts.meta ?? null,
  }, 'user');
}

// ── Earn-back bonuses ──

/**
 * Grant a one-time earn-back bonus if the corresponding flag is unset. No
 * caller today; ported to 4.1 (`L 004` ruling 5): `earnback:{type}:{userId}`,
 * its legacy `token_idempotency:` key the evidence. The flag is written only
 * after `applied` or `replayed`. True only when this call applied the credit.
 */
export async function grantEarnBackBonus(
  userId: string,
  type: EarnBackType
): Promise<boolean> {
  const kv = getKV();
  if (!kv) return false;

  const flagKey = `${EARN_BACK_FLAG[type]}:${userId}`;

  try {
    const existing = await kv.get(flagKey);
    if (existing) return false;

    const key = `earnback:${type}:${userId}`;
    const result = await creditTokens(userId, EARN_BACK_AMOUNT[type], `earn_back_${type}`, key, {
      source: type,
      legacy: `token_idempotency:${key}`,
    });
    if (result.outcome !== 'applied' && result.outcome !== 'replayed') return false;

    await kv.put(flagKey, '1', { expirationTtl: EARN_BACK_FLAG_TTL_SECONDS });
    return result.outcome === 'applied';
  } catch {
    return false;
  }
}

// ── Free-tier lifetime counters ──

/** Read the lifetime free-tier counter (defaults to 0). */
export async function getLifetimeFreeCount(
  userId: string,
  bucket: FreeTierBucket
): Promise<number> {
  const kv = getKV();
  if (!kv) return 0;
  try {
    const raw = await kv.get(`${LIFETIME_COUNTER_KEY[bucket]}:${userId}`);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Increment the lifetime free-tier counter. Best-effort; not atomic. */
export async function incrementLifetimeFreeCount(
  userId: string,
  bucket: FreeTierBucket
): Promise<number> {
  const kv = getKV();
  if (!kv) return 0;
  try {
    const current = await getLifetimeFreeCount(userId, bucket);
    const next = current + 1;
    await kv.put(`${LIFETIME_COUNTER_KEY[bucket]}:${userId}`, String(next));
    return next;
  } catch {
    return 0;
  }
}

// ── has_paid flag ──

/** True if the user has completed at least one Stripe checkout. */
export async function hasUserPaid(userId: string): Promise<boolean> {
  const kv = getKV();
  if (!kv) return false;
  try {
    const v = await kv.get(`purchase:${userId}:has_paid`);
    return v === 'true';
  } catch {
    return false;
  }
}

/** Set the persistent has_paid flag — called from the Stripe webhook handler. */
export async function setUserPaid(userId: string): Promise<void> {
  const kv = getKV();
  if (!kv) return;
  try {
    await kv.put(`purchase:${userId}:has_paid`, 'true');
  } catch {
    // best effort
  }
}

// ── Disposable email block ──

/** Set the disposable_blocked flag for a userId — called from the Clerk webhook. */
export async function setDisposableBlocked(userId: string): Promise<void> {
  const kv = getKV();
  if (!kv) return;
  try {
    await kv.put(`disposable_blocked:${userId}`, 'true');
  } catch {
    // best effort
  }
}

// ── Signup-bonus modal claim ──

export interface SignupGrantRecord {
  amount: number;
  source: TransactionSource;
  granted_at?: string;
}

/**
 * If the user has an unacknowledged signup grant, return its amount and atomically
 * mark it shown. Returns null if no grant or already acknowledged.
 */
export async function consumeSignupGrant(userId: string): Promise<SignupGrantRecord | null> {
  const kv = getKV();
  if (!kv) return null;
  try {
    const shown = await kv.get(`signup_bonus_modal_shown:${userId}`);
    if (shown === '1') return null;

    const raw = await kv.get(`signup_grant:${userId}`);
    if (!raw) {
      // No record (older signups before S16 — mark shown so we don't keep checking)
      await kv.put(`signup_bonus_modal_shown:${userId}`, '1');
      return null;
    }

    const grant = JSON.parse(raw) as SignupGrantRecord;
    await kv.put(`signup_bonus_modal_shown:${userId}`, '1');
    return grant;
  } catch {
    return null;
  }
}

// ── Email-list earn-back ──

/** True if the user has already claimed the newsletter signup bonus. */
export async function hasClaimedEmailList(userId: string): Promise<boolean> {
  const kv = getKV();
  if (!kv) return false;
  try {
    const v = await kv.get(`bonus_email_list:${userId}`);
    return v === '1';
  } catch {
    return false;
  }
}

/**
 * Mark the email-list bonus as claimed. The actual token credit happens via
 * creditTokens(); this only sets the idempotency flag.
 */
export async function markEmailListClaimed(userId: string): Promise<void> {
  const kv = getKV();
  if (!kv) return;
  try {
    await kv.put(`bonus_email_list:${userId}`, '1');
  } catch {
    // best effort
  }
}
