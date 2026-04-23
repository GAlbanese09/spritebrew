/**
 * Refund/dispute token debit — allows negative balances.
 *
 * Unlike the generation debit in tokenBalance.ts (which blocks on insufficient
 * balance), this debit always succeeds and MAY push the balance below zero.
 * Negative balance is the feature: it triggers account locking.
 *
 * Idempotency is NOT handled here — it is enforced at the webhook layer
 * via event_id deduplication in KV.
 */

const TX_TTL = 7_776_000; // 90 days

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

interface BalanceRecord {
  balance: number;
  created_at: string;
  last_updated: string;
}

export type DebitReason = 'refund_debit' | 'dispute_debit' | 'manual_admin_debit';

export interface RefundDebitMetadata {
  stripe_charge_id?: string;
  stripe_event_id?: string;
  stripe_dispute_id?: string;
  refund_amount?: number;
  refund_ratio?: number;
  [key: string]: unknown;
}

/**
 * Debit tokens from a user's balance. Balance MAY go negative.
 * Returns the new balance (which may be < 0).
 */
export async function debitTokensForRefund(
  userId: string,
  amount: number,
  reason: DebitReason,
  metadata: RefundDebitMetadata
): Promise<number> {
  const kv = getKV();
  if (!kv) {
    console.error('[TokenDebit] KV unavailable, cannot debit');
    return 0;
  }

  const raw = await kv.get(`token_balance:${userId}`);
  let record: BalanceRecord;
  if (!raw) {
    // No balance record — create one at 0 so the debit goes negative
    record = { balance: 0, created_at: new Date().toISOString(), last_updated: new Date().toISOString() };
  } else {
    record = JSON.parse(raw) as BalanceRecord;
  }

  const balanceBefore = record.balance;
  const newBalance = balanceBefore - amount;
  const now = new Date().toISOString();

  record.balance = newBalance;
  record.last_updated = now;

  await kv.put(`token_balance:${userId}`, JSON.stringify(record));

  // Write transaction log
  const ts = Date.now();
  const uid = Math.random().toString(36).slice(2, 8);
  const txKey = `token_tx:${userId}:${ts}:${uid}`;
  try {
    await kv.put(
      txKey,
      JSON.stringify({
        type: 'debit',
        reason,
        amount,
        balance_before: balanceBefore,
        balance_after: newBalance,
        metadata,
        timestamp: now,
      }),
      { expirationTtl: TX_TTL }
    );
  } catch {
    // Transaction logging is best-effort
  }

  return newBalance;
}
