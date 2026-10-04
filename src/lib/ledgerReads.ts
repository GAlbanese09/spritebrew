/**
 * S4's own reads of `spritebrew-ledger` (n1-release-2-spec.md revision 9).
 * The spec names each of these lookups but writes no SQL for them, so they
 * live here, beside the shared library (src/lib/ledger.ts), whose statements
 * are the spec's text and are checked against it. Every one is a single
 * SELECT: none moves money or settles an outcome.
 *
 *   BALANCE_READ      a user's balance (the token-balance route, 6.2)
 *   LEGACY_SIGNUP     4.2's legacy opening evidence in `legacy_idem`
 *   PURCHASE_BY_PI    4.14 step 5's `ledger_purchase_pi` lookup, and R9-8's
 *                     purchase row for the banner (its partial index needs
 *                     `source = 'token_pack_purchase'` in the WHERE)
 *   PURCHASE_RECOVERED 4.14 step 5's `charge_recovered` lookup, joined to the
 *                     purchase it names (`stripe:{event.id}`, 4.18)
 *   PENDING_ROW       whether an event already has its pending row, so the
 *                     mapping alarm comes after the first attempt (4.13)
 *
 * A failed read throws: it is never taken as absence (4.13, `L 004` ruling 3).
 */

import type { LedgerCtx } from '@/lib/ledger';

export const BALANCE_READ = 'SELECT balance FROM balances WHERE user_id = ?1';

export const LEGACY_SIGNUP =
  "SELECT 1 AS present FROM legacy_idem WHERE key = 'token_idempotency:signup:' || ?1 AND keep_until_ms > ?2";

export const PURCHASE_BY_PI =
  `SELECT user_id, amount, meta_json, idem_key FROM ledger
    WHERE source = 'token_pack_purchase' AND json_extract(meta_json, '$.payment_intent') = ?1
    ORDER BY seq LIMIT 2`;

export const PURCHASE_RECOVERED =
  `SELECT l.user_id, l.amount, l.meta_json, l.idem_key
     FROM charge_recovered AS c JOIN ledger AS l ON l.idem_key = 'stripe:' || c.stripe_event_id
    WHERE c.charge = ?1 AND l.source = 'token_pack_purchase'
    ORDER BY l.seq LIMIT 2`;

export const PENDING_ROW =
  'SELECT reason, disposition, resolved_at_ms FROM stripe_pending WHERE event_id = ?1';

export const LEDGER_READS: Readonly<Record<string, string>> = {
  BALANCE_READ, LEGACY_SIGNUP, PURCHASE_BY_PI, PURCHASE_RECOVERED, PENDING_ROW,
};

type Row = Record<string, unknown>;

async function read(ctx: LedgerCtx, sql: string, values: unknown[]): Promise<Row[]> {
  const work = ctx.db.batch([ctx.db.prepare(sql).bind(...values)]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [r] = ctx.timeoutMs
      ? await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('ledger read timed out')), ctx.timeoutMs);
          }),
        ])
      : await work;
    return (r?.results ?? []) as Row[];
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);

/** The stored balance, or null when the user has none. */
export async function readBalance(ctx: LedgerCtx, uid: string): Promise<number | null> {
  return num((await read(ctx, BALANCE_READ, [uid]))[0]?.balance);
}

export async function legacySignupLive(ctx: LedgerCtx, uid: string, now: number): Promise<boolean> {
  return (await read(ctx, LEGACY_SIGNUP, [uid, now])).length > 0;
}

/** A D1 purchase credit (4.14): its user, its tokens and its meta_json. */
export interface PurchaseRow {
  userId: string;
  tokens: number;
  meta: Record<string, unknown>;
  idem: string;
}

function purchaseRows(rows: Row[]): PurchaseRow[] {
  return rows.map((r) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = r.meta_json ? (JSON.parse(String(r.meta_json)) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }
    return { userId: String(r.user_id), tokens: num(r.amount) ?? 0, meta, idem: String(r.idem_key) };
  });
}

export async function purchasesByPaymentIntent(ctx: LedgerCtx, pi: string): Promise<PurchaseRow[]> {
  return purchaseRows(await read(ctx, PURCHASE_BY_PI, [pi]));
}

export async function purchasesRecovered(ctx: LedgerCtx, charge: string): Promise<PurchaseRow[]> {
  return purchaseRows(await read(ctx, PURCHASE_RECOVERED, [charge]));
}

export interface PendingRow {
  reason: string;
  disposition: string | null;
  resolvedAtMs: number | null;
}

export async function readPending(ctx: LedgerCtx, event: string): Promise<PendingRow | null> {
  const r = (await read(ctx, PENDING_ROW, [event]))[0];
  return r ? { reason: String(r.reason), disposition: (r.disposition as string | null) ?? null, resolvedAtMs: num(r.resolved_at_ms) } : null;
}
