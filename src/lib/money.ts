/**
 * Release 2's Pages money calls (n1-release-2-spec.md revision 9, S4: 4.1 to
 * 4.3, 4.8's 'pages' fence, 5.1, 6.2). Every movement is one guarded D1 batch
 * of the shared library (src/lib/ledger.ts); this file adds what the routes
 * share around it:
 *   - the context: LEDGER_DB, the dev faults on dev only (10.3), a bound;
 *   - the opening (4.2): today's initBalance decision, a legacy signup key
 *     opening at 0 with its alarm, KV's grant record only on `opened`;
 *   - the balance read, failing closed: never a guessed number;
 *   - a movement whose balance row is missing opens it, then runs once more
 *     with a fresh :id (4.1's last rows).
 * Release 2 writes no admission record (6.2) and no `token_tx:` row (009 A).
 */

import * as L from '@/lib/ledger';
import { EARLY_ADOPTER_BONUS_TOKENS, SIGNUP_BONUS_TOKENS } from '@/lib/constants';
import { recordLedgerAlarm } from '@/lib/eventsRow';
import { legacySignupLive, readBalance } from '@/lib/ledgerReads';
import { MoneyPausedError } from '@/lib/moneyPause';

/** A money statement that could not be confirmed either way, or a store
 *  that could not be read: the caller answers an error, never a guess. */
export class MoneyUnavailableError extends Error {
  constructor(message = 'money state unavailable') {
    super(message);
    this.name = 'MoneyUnavailableError';
  }
}

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

export function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  return kv && typeof (kv as KV).put === 'function' ? (kv as KV) : null;
}

const LEDGER_TIMEOUT_MS = 10_000;

/** The library's context. A missing binding throws MoneyUnavailableError. */
export function ledgerCtx(): L.LedgerCtx {
  const env = process.env as Record<string, unknown>;
  const db = env.LEDGER_DB as L.LedgerDb | undefined;
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new MoneyUnavailableError('LEDGER_DB binding missing');
  }
  return { db, appEnv: typeof env.APP_ENV === 'string' ? env.APP_ENV : undefined, timeoutMs: LEDGER_TIMEOUT_MS };
}

// ── 4.2 The opening ──

export interface OpeningPlan {
  via: 'signup' | 'early_adopter' | 'disposable' | 'zero_alarm';
  amount: number;
  reason: string;
  source: string | null;
}

/**
 * Who opens, at what amount (4.2): a legacy `token_idempotency:signup:{uid}`
 * with no balance opens at 0 with an alarm (`L 004` ruling 5); `disposable` at
 * 0 when `disposable_blocked:{uid}` is 'true'; `early_adopter` when a
 * `gen_count:{uid}:` key exists; else `signup`. A failed read throws: the
 * opening is never decided on a guess.
 */
export async function openingPlan(ctx: L.LedgerCtx, uid: string, now: number = Date.now()): Promise<OpeningPlan> {
  if (await legacySignupLive(ctx, uid, now)) {
    return { via: 'zero_alarm', amount: 0, reason: 'legacy_signup_no_balance', source: null };
  }
  const kv = getKV();
  if (!kv) throw new MoneyUnavailableError('SPRITEBREW_KV binding missing');
  if ((await kv.get(`disposable_blocked:${uid}`)) === 'true') {
    return { via: 'disposable', amount: 0, reason: 'disposable_email_no_bonus', source: null };
  }
  const existing = await kv.list({ prefix: `gen_count:${uid}:`, limit: 1 });
  if (existing.keys.length > 0) {
    return { via: 'early_adopter', amount: EARLY_ADOPTER_BONUS_TOKENS, reason: 'early_adopter_bonus', source: 'early_adopter' };
  }
  return { via: 'signup', amount: SIGNUP_BONUS_TOKENS, reason: 'signup_bonus', source: 'signup' };
}

export type OpenOutcome = 'opened' | 'already_open' | 'paused' | 'error';

async function runOpening(ctx: L.LedgerCtx, uid: string, plan: OpeningPlan): Promise<{ outcome: OpenOutcome; balance: number | null }> {
  const o = await L.openBalance(ctx, { uid, amount: plan.amount, reason: plan.reason, source: plan.source, via: plan.via });
  if (o.outcome === 'opened') {
    if (plan.via === 'zero_alarm') {
      await recordLedgerAlarm({ kind: 'zero_alarm', subject: uid, subjectKind: 'user', userId: uid, fields: { reason: plan.reason } });
    }
    if (plan.amount > 0 && plan.source) {
      // The celebration modal's record, written only on `opened` (4.2).
      try {
        await getKV()?.put(`signup_grant:${uid}`, JSON.stringify({ amount: plan.amount, source: plan.source, granted_at: new Date().toISOString() }));
      } catch { /* best effort */ }
    }
  }
  return { outcome: o.outcome, balance: o.balance };
}

/** A user's opening by today's policy. Never throws for a store failure. */
export async function openForUser(ctx: L.LedgerCtx, uid: string): Promise<{ outcome: OpenOutcome; balance: number | null }> {
  let plan: OpeningPlan;
  try {
    plan = await openingPlan(ctx, uid);
  } catch {
    return { outcome: 'error', balance: null };
  }
  return runOpening(ctx, uid, plan);
}

/** A Stripe refund or dispute debit, or any other debit, that finds no
 *  balance: opened at 0 with `zero_alarm` and its alarm (4.2). */
export async function openAtZero(ctx: L.LedgerCtx, uid: string, reason: string): Promise<{ outcome: OpenOutcome; balance: number | null }> {
  return runOpening(ctx, uid, { via: 'zero_alarm', amount: 0, reason, source: null });
}

/**
 * The balance, opening it by policy when the user has none. Paused:
 * MoneyPausedError; anything unconfirmed: MoneyUnavailableError. Never a
 * guessed number (6.2).
 */
export async function getBalance(uid: string): Promise<number> {
  const ctx = ledgerCtx();
  let balance: number | null;
  try {
    balance = await readBalance(ctx, uid);
  } catch {
    throw new MoneyUnavailableError('balance read failed');
  }
  if (balance !== null) return balance;
  const o = await openForUser(ctx, uid);
  if (o.outcome === 'paused') throw new MoneyPausedError();
  if (o.outcome === 'error' || o.balance === null) throw new MoneyUnavailableError('opening not confirmed');
  return o.balance;
}

/** The stored balance only: no opening, null when unknown (the banner). */
export async function readBalanceStrict(uid: string): Promise<number | null> {
  try {
    return await readBalance(ledgerCtx(), uid);
  } catch {
    return null;
  }
}

// ── 4.1 A movement, with the no-balance rerun ──

export type MovementArgs = Omit<L.MovementInput, 'floor'>;

/**
 * 4.1 with `:floor` NULL (A6). `no balance row`: open it (`opening` 'user' by
 * policy, 'zero' at 0 with its alarm), then run once more with a fresh :id. A
 * `unique_mismatch` raises its alarm.
 */
export async function move(ctx: L.LedgerCtx, m: MovementArgs, opening: 'user' | 'zero'): Promise<L.MovementResult> {
  let r = await L.movement(ctx, { ...m, floor: null });
  if (r.outcome === 'no_balance') {
    const o = opening === 'zero' ? await openAtZero(ctx, m.uid, `${m.reason}_no_balance`) : await openForUser(ctx, m.uid);
    if (o.outcome === 'paused') return { ...r, outcome: 'paused' };
    if (o.outcome === 'error') return { ...r, outcome: 'error' };
    r = await L.movement(ctx, { ...m, floor: null });
    if (r.outcome === 'no_balance') r = { ...r, outcome: 'error' };
  }
  if (r.alarm === 'unique_mismatch') {
    await recordLedgerAlarm({
      kind: 'unique_mismatch', subject: m.event ?? m.idem, subjectKind: m.event ? 'event' : 'user', userId: m.uid,
      fields: { idem: m.idem, reason: m.reason },
    });
  }
  return r;
}

// ── 4.3 The generation debit, with the no-balance rerun ──

export async function chargeGeneration(ctx: L.LedgerCtx, d: L.DebitInput): Promise<L.DebitResult> {
  let r = await L.generationDebit(ctx, d);
  if (r.outcome === 'no_balance') {
    const o = await openForUser(ctx, d.uid);
    if (o.outcome === 'paused') return { ...r, outcome: 'paused' };
    if (o.outcome === 'error') return { ...r, outcome: 'error' };
    r = await L.generationDebit(ctx, d);
    if (r.outcome === 'no_balance') r = { ...r, outcome: 'error' };
  }
  return r;
}
