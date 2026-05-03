/**
 * Token balance system — KV-backed economy for generation credits.
 *
 * KV schema:
 *   token_balance:{userId}              → JSON { balance, created_at, last_updated }
 *   token_tx:{userId}:{ts}:{uid}        → JSON { type, amount, reason, balance_after, style?, timestamp } — TTL 90 days
 *   token_idempotency:{key}             → "1" — TTL 7 days
 *   bonus_email_verified:{userId}       → "1" — TTL 50 days (idempotency for the earn-back grant)
 *   bonus_discord_joined:{userId}       → "1" — TTL 50 days
 *   bonus_first_share:{userId}          → "1" — TTL 50 days
 *   lifetime_free_pro:{userId}          → number-as-string (no TTL)
 *   lifetime_free_fast:{userId}         → number-as-string (no TTL)
 *   purchase:{userId}:has_paid          → "true" once user has paid via Stripe (no TTL)
 *   disposable_blocked:{userId}         → "true" if signup email matched the disposable blocklist (no TTL)
 *
 * New users get 30 signup tokens. Existing users (have gen_count: keys) get 200 — grandfather clause.
 */

import {
  SIGNUP_BONUS_TOKENS,
  EARLY_ADOPTER_BONUS_TOKENS,
  EARN_BACK_DISCORD_JOINED_TOKENS,
  EARN_BACK_FIRST_SHARE_TOKENS,
  EARN_BACK_FLAG_TTL_SECONDS,
} from '@/lib/constants';

const TX_TTL = 7_776_000; // 90 days
const IDEMPOTENCY_TTL = 604_800; // 7 days

// S16: email_verified removed (bot-passable). Discord / first_share remain
// wired via grantEarnBackBonus but lack a UI trigger — they'll be activated
// once the Discord bot ships.
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

const EARN_BACK_SOURCE: Record<EarnBackType, TransactionSource> = {
  discord_joined: 'discord_joined',
  first_share: 'first_share',
};

const LIFETIME_COUNTER_KEY: Record<FreeTierBucket, string> = {
  pro: 'lifetime_free_pro',
  fast: 'lifetime_free_fast',
};

// ── KV binding ──

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

// ── Helpers ──

interface BalanceRecord {
  balance: number;
  created_at: string;
  last_updated: string;
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

interface TransactionRecord {
  type: 'credit' | 'debit';
  amount: number;
  reason: string;
  source?: TransactionSource;
  streakDay?: number;
  balance_after: number;
  style?: string;
  timestamp: string;
}

/** Optional metadata threaded through creditTokens → writeTx. */
export interface CreditMeta {
  source?: TransactionSource;
  streakDay?: number;
}

function txKey(userId: string): string {
  const ts = Date.now();
  const uid = Math.random().toString(36).slice(2, 8);
  return `token_tx:${userId}:${ts}:${uid}`;
}

function idempotencyKey(key: string): string {
  return `token_idempotency:${key}`;
}

async function writeTx(kv: KV, userId: string, tx: TransactionRecord): Promise<void> {
  try {
    await kv.put(txKey(userId), JSON.stringify(tx), { expirationTtl: TX_TTL });
  } catch {
    // Transaction logging is best-effort
  }
}

/**
 * Check if this is an existing user by looking for any gen_count: keys.
 * Used for the lazy migration: existing users get 200 tokens, new users get 100.
 */
async function isExistingUser(kv: KV, userId: string): Promise<boolean> {
  try {
    const result = await kv.list({ prefix: `gen_count:${userId}:`, limit: 1 });
    return result.keys.length > 0;
  } catch {
    return false;
  }
}

/**
 * Initialize a new balance record. Checks if the user is an existing user
 * (has gen_count: keys) and grants the appropriate bonus. Disposable-email
 * users (flagged by Clerk webhook handler) get a zero-balance record and no
 * bonus — they can still buy tokens but can't farm the free tier.
 */
async function initBalance(kv: KV, userId: string): Promise<number> {
  // Idempotency: prevent double-init
  const idemKey = idempotencyKey(`signup:${userId}`);
  const existing = await kv.get(idemKey);
  if (existing) {
    // Already initialized — read current balance
    const raw = await kv.get(`token_balance:${userId}`);
    if (raw) return (JSON.parse(raw) as BalanceRecord).balance;
    return SIGNUP_BONUS_TOKENS; // shouldn't happen, but safe fallback
  }

  const blocked = await kv.get(`disposable_blocked:${userId}`);
  const isExisting = await isExistingUser(kv, userId);

  let bonus: number;
  let reason: string;
  let source: TransactionSource | undefined;
  if (blocked === 'true') {
    bonus = 0;
    reason = 'disposable_email_no_bonus';
    source = undefined;
  } else if (isExisting) {
    bonus = EARLY_ADOPTER_BONUS_TOKENS;
    reason = 'early_adopter_bonus';
    source = 'early_adopter';
  } else {
    bonus = SIGNUP_BONUS_TOKENS;
    reason = 'signup_bonus';
    source = 'signup';
  }

  const now = new Date().toISOString();

  const record: BalanceRecord = {
    balance: bonus,
    created_at: now,
    last_updated: now,
  };

  await kv.put(`token_balance:${userId}`, JSON.stringify(record));
  await kv.put(idemKey, '1', { expirationTtl: IDEMPOTENCY_TTL });
  await writeTx(kv, userId, {
    type: 'credit',
    amount: bonus,
    reason,
    source,
    balance_after: bonus,
    timestamp: now,
  });

  // Persist the granted amount so the celebration modal can read it without
  // scanning the tx log. No TTL — the modal might fire weeks after signup.
  if (bonus > 0 && source) {
    try {
      await kv.put(
        `signup_grant:${userId}`,
        JSON.stringify({ amount: bonus, source, granted_at: now })
      );
    } catch {
      // best effort
    }
  }

  return bonus;
}

// ── Public API ──

/**
 * Get the user's current token balance. Auto-creates balance on first use.
 */
export async function getTokenBalance(userId: string): Promise<number> {
  const kv = getKV();
  if (!kv) return SIGNUP_BONUS_TOKENS; // Fail open with default

  try {
    const raw = await kv.get(`token_balance:${userId}`);
    if (raw) return (JSON.parse(raw) as BalanceRecord).balance;
    return await initBalance(kv, userId);
  } catch {
    return SIGNUP_BONUS_TOKENS;
  }
}

export interface DebitResult {
  success: boolean;
  balance: number;
  required?: number;
}

/**
 * Debit tokens for a generation. Returns the new balance on success,
 * or the current balance + required amount on failure.
 */
export async function debitTokens(
  userId: string,
  amount: number,
  idempotencyKeyValue: string
): Promise<DebitResult> {
  const kv = getKV();
  if (!kv) return { success: true, balance: 0 }; // Fail open

  try {
    // Idempotency check
    const idemKey = idempotencyKey(idempotencyKeyValue);
    const existing = await kv.get(idemKey);
    if (existing) {
      const balance = await getTokenBalance(userId);
      return { success: true, balance };
    }

    // Ensure balance exists (lazy init)
    const raw = await kv.get(`token_balance:${userId}`);
    let record: BalanceRecord;
    if (!raw) {
      const balance = await initBalance(kv, userId);
      record = { balance, created_at: new Date().toISOString(), last_updated: new Date().toISOString() };
    } else {
      record = JSON.parse(raw) as BalanceRecord;
    }

    if (record.balance < amount) {
      return { success: false, balance: record.balance, required: amount };
    }

    const newBalance = record.balance - amount;
    const now = new Date().toISOString();
    record.balance = newBalance;
    record.last_updated = now;

    await kv.put(`token_balance:${userId}`, JSON.stringify(record));
    await kv.put(idemKey, '1', { expirationTtl: IDEMPOTENCY_TTL });
    await writeTx(kv, userId, {
      type: 'debit',
      amount,
      reason: 'generation',
      balance_after: newBalance,
      timestamp: now,
    });

    return { success: true, balance: newBalance };
  } catch {
    return { success: true, balance: 0 }; // Fail open
  }
}

export interface CreditResult {
  success: boolean;
  balance: number;
}

/**
 * Credit tokens back (refund on failure, purchases, daily/streak rewards).
 * Optional `meta` is recorded on the tx log entry for analytics.
 */
export async function creditTokens(
  userId: string,
  amount: number,
  reason: string,
  idempotencyKeyValue: string,
  meta?: CreditMeta
): Promise<CreditResult> {
  const kv = getKV();
  if (!kv) return { success: true, balance: 0 };

  try {
    // Idempotency check
    const idemKey = idempotencyKey(idempotencyKeyValue);
    const existing = await kv.get(idemKey);
    if (existing) {
      const balance = await getTokenBalance(userId);
      return { success: true, balance };
    }

    const raw = await kv.get(`token_balance:${userId}`);
    if (!raw) {
      // No balance record — init first, then credit
      await initBalance(kv, userId);
      const rawAfterInit = await kv.get(`token_balance:${userId}`);
      if (!rawAfterInit) return { success: false, balance: 0 };
    }

    const currentRaw = await kv.get(`token_balance:${userId}`);
    if (!currentRaw) return { success: false, balance: 0 };

    const record = JSON.parse(currentRaw) as BalanceRecord;
    const newBalance = record.balance + amount;
    const now = new Date().toISOString();
    record.balance = newBalance;
    record.last_updated = now;

    await kv.put(`token_balance:${userId}`, JSON.stringify(record));
    await kv.put(idemKey, '1', { expirationTtl: IDEMPOTENCY_TTL });
    await writeTx(kv, userId, {
      type: 'credit',
      amount,
      reason,
      source: meta?.source,
      streakDay: meta?.streakDay,
      balance_after: newBalance,
      timestamp: now,
    });

    return { success: true, balance: newBalance };
  } catch {
    return { success: false, balance: 0 };
  }
}

// ── Earn-back bonuses ──

/**
 * Grant a one-time earn-back bonus if the corresponding flag is unset.
 * Idempotent — granting twice is a no-op (within the 50-day flag TTL).
 * Returns true if the bonus was newly granted, false if it had already been
 * granted (or KV was unavailable, or anything went wrong).
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

    const amount = EARN_BACK_AMOUNT[type];
    const reason = `earn_back_${type}`;
    // Use the flag key as idempotency key for the credit too — guarantees the
    // credit and the flag write share the same one-shot semantics.
    const result = await creditTokens(
      userId,
      amount,
      reason,
      `earnback:${type}:${userId}`,
      { source: EARN_BACK_SOURCE[type] }
    );
    if (!result.success) return false;

    await kv.put(flagKey, '1', { expirationTtl: EARN_BACK_FLAG_TTL_SECONDS });
    return true;
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
