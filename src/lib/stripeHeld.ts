/**
 * S0's refusal row (n1-release-2-spec.md revision 9, 4.13 and 7.5, S-1,
 * HQ-8 condition 2): a Stripe event the pause refused is recorded in
 * `stripe_held` of `spritebrew-ledger` before the webhook's 503, with
 * release 1's two keys for the event read at that moment:
 *   'absent'   both reads succeeded and found nothing;
 *   'present'  either key exists;
 *   'unknown'  a read failed (or KV is unbound).
 * The row carries the pause's epoch, the pause row's `updated_at_ms`, and
 * the statement writes nothing while the pause row reads '0' or is absent.
 * It never throws, and each read and the write are bounded (2 s): a failed
 * or timed-out read is 'unknown', and a failed write still answers 503, so
 * Stripe's retry writes it again.
 */

import { withTimeout } from '@/lib/moneyPause';

interface KVRead {
  get(key: string): Promise<string | null>;
}

interface D1Like {
  prepare(sql: string): {
    bind(...v: unknown[]): {
      run(): Promise<unknown>;
    };
  };
}

export type R1Keys = 'absent' | 'present' | 'unknown';

const STRIPE_HELD_SQL =
  `INSERT INTO stripe_held (event_id, pause_epoch_ms, r1_keys, event_type, event_created_ms, refused_ms)
   SELECT ?1, c.updated_at_ms, ?2, ?3, ?4, ?5
     FROM control AS c
    WHERE c.key = 'money_pause' AND c.value <> '0'
   ON CONFLICT (event_id, pause_epoch_ms, r1_keys) DO NOTHING`;

/** Release 1's two keys for the event: the webhook's mark and the credit's idempotency key. */
export async function readR1Keys(kv: KVRead | null, eventId: string): Promise<R1Keys> {
  if (!kv) return 'unknown';
  let present = false;
  let failed = false;
  for (const key of [`webhook:stripe:${eventId}`, `token_idempotency:${eventId}`]) {
    try {
      if (await withTimeout(kv.get(key), 'release 1 key read')) present = true;
    } catch {
      failed = true;
    }
  }
  return present ? 'present' : failed ? 'unknown' : 'absent';
}

export async function recordStripeRefusal(args: {
  kv: KVRead | null;
  eventId: string;
  eventType: string;
  /** Stripe's `event.created`, in seconds. */
  eventCreatedS: number;
}): Promise<R1Keys> {
  const r1Keys = await readR1Keys(args.kv, args.eventId);
  try {
    const db = (process.env as Record<string, unknown>).LEDGER_DB as D1Like | undefined;
    if (!db || typeof db.prepare !== 'function') throw new Error('LEDGER_DB binding missing');
    await withTimeout(
      db.prepare(STRIPE_HELD_SQL)
        .bind(args.eventId, r1Keys, args.eventType, Math.round(args.eventCreatedS * 1000), Date.now())
        .run(),
      'stripe_held insert'
    );
  } catch (err) {
    console.error(JSON.stringify({
      source: 'stripe-held',
      event: 'write_failed',
      event_id: args.eventId,
      r1_keys: r1Keys,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    }));
  }
  return r1Keys;
}
