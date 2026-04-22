/**
 * Token balance system — KV-backed economy for generation credits.
 *
 * KV schema:
 *   token_balance:{userId}       → JSON { balance, created_at, last_updated }
 *   token_tx:{userId}:{ts}:{uid} → JSON { type, amount, reason, balance_after, style?, timestamp } — TTL 90 days
 *   token_idempotency:{key}      → "1" — TTL 7 days
 *
 * New users get 100 signup tokens. Existing users (have gen_count: keys) get 200.
 *
 * // TODO: Migrate to Durable Objects when Stripe integration ships (Phase 2) for true atomicity
 */

const SIGNUP_BONUS = 100;
const EARLY_ADOPTER_BONUS = 200;
const TX_TTL = 7_776_000; // 90 days
const IDEMPOTENCY_TTL = 604_800; // 7 days

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

interface TransactionRecord {
  type: 'credit' | 'debit';
  amount: number;
  reason: string;
  balance_after: number;
  style?: string;
  timestamp: string;
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
 * (has gen_count: keys) and grants the appropriate bonus.
 */
async function initBalance(kv: KV, userId: string): Promise<number> {
  // Idempotency: prevent double-init
  const idemKey = idempotencyKey(`signup:${userId}`);
  const existing = await kv.get(idemKey);
  if (existing) {
    // Already initialized — read current balance
    const raw = await kv.get(`token_balance:${userId}`);
    if (raw) return (JSON.parse(raw) as BalanceRecord).balance;
    return SIGNUP_BONUS; // shouldn't happen, but safe fallback
  }

  const isExisting = await isExistingUser(kv, userId);
  const bonus = isExisting ? EARLY_ADOPTER_BONUS : SIGNUP_BONUS;
  const reason = isExisting ? 'early_adopter_bonus' : 'signup_bonus';
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
    balance_after: bonus,
    timestamp: now,
  });

  return bonus;
}

// ── Public API ──

/**
 * Get the user's current token balance. Auto-creates balance on first use.
 */
export async function getTokenBalance(userId: string): Promise<number> {
  const kv = getKV();
  if (!kv) return SIGNUP_BONUS; // Fail open with default

  try {
    const raw = await kv.get(`token_balance:${userId}`);
    if (raw) return (JSON.parse(raw) as BalanceRecord).balance;
    return await initBalance(kv, userId);
  } catch {
    return SIGNUP_BONUS;
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
 * Credit tokens back (refund on failure, future: purchases, daily brew).
 */
export async function creditTokens(
  userId: string,
  amount: number,
  reason: string,
  idempotencyKeyValue: string
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
      balance_after: newBalance,
      timestamp: now,
    });

    return { success: true, balance: newBalance };
  } catch {
    return { success: false, balance: 0 };
  }
}
