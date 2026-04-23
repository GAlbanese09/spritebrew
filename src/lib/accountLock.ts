/**
 * Account lock/status management.
 *
 * KV key: account_status:{userId}
 * Valid statuses: "active" (default, no key), "refund_locked", "disputed"
 */

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

export type AccountStatus = 'active' | 'refund_locked' | 'disputed';

interface AccountStatusRecord {
  status: AccountStatus;
  reason: string;
  locked_at: string;
  stripe_charge_id?: string;
  stripe_dispute_id?: string;
}

export async function getAccountStatus(userId: string): Promise<AccountStatus> {
  const kv = getKV();
  if (!kv) return 'active';

  try {
    const raw = await kv.get(`account_status:${userId}`);
    if (!raw) return 'active';
    const record = JSON.parse(raw) as AccountStatusRecord;
    return record.status;
  } catch {
    return 'active';
  }
}

export async function setAccountStatus(
  userId: string,
  status: AccountStatus,
  details: { reason: string; stripe_charge_id?: string; stripe_dispute_id?: string }
): Promise<void> {
  const kv = getKV();
  if (!kv) return;

  const record: AccountStatusRecord = {
    status,
    reason: details.reason,
    locked_at: new Date().toISOString(),
    stripe_charge_id: details.stripe_charge_id,
    stripe_dispute_id: details.stripe_dispute_id,
  };

  // No TTL — account locks are permanent until manually cleared
  await kv.put(`account_status:${userId}`, JSON.stringify(record));
}
