export const runtime = 'edge';

// Stripe's webhook on the D1 ledger (n1-release-2-spec.md revision 9, 4.13,
// 4.14; A6, S-1, O15). Order, after the signature check:
//   1. The fail-closed pause read. Paused, or a failed read: the refusal row
//      (recorded only when the pause row says paused, its r1_keys from
//      legacy_idem), then 503, unmarked.
//   2. Money open: application evidence first. The event's `stripe:` ledger
//      row, or live legacy evidence, answers replayed; the one resolution
//      resolves its pending row, if any.
//   3. A recorded 'none' (either reason) is honored before any admission:
//      no movement, the one resolution, 200, marked.
//   4. A pre-switch money event moves only when 4.13 (a) or (b) admits it
//      (its vetoes clear), or on George's 'apply'; with no disposition yet:
//      the pending row, the alarm, and 500, unmarked.
//   5. A refund or dispute finds its purchase by `purchase:{charge}` in KV,
//      else `ledger_purchase_pi`, else a `charge_recovered` row; none found:
//      the pending row ('mapping_missing'), the alarm after the first
//      attempt, and 500, unmarked.
//   6. The movement (4.1, `stripe:{event.id}`, :floor NULL), branched on its
//      verified outcome: applied or replayed, the one resolution, then 200,
//      marked; refused by decision, the one resolution, 200, marked; paused,
//      the refusal row and 503; error or uncertain, 500, unmarked.
// Any failed read answers 500, unmarked, never taken as absence.
//
// `webhook:stripe:{event.id}` in KV stays the mark for the non-money side
// effects (refund counters, the account status, Radar lists, evidence): they
// run when the event is not yet marked, and a failed account-status write
// answers 500, unmarked, so Stripe's retry sets it after a replayed
// movement, never a second debit. The mark never replaces D1's money
// classification (O15). Release 2 writes no admission record.

import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { setUserPaid } from '@/lib/tokenBalance';
import { setAccountStatus } from '@/lib/accountLock';
import { recordEvidenceSnapshot, loadConsentSnapshot } from '@/lib/disputeEvidence';
import { isMoneyPaused } from '@/lib/moneyPause';
import * as L from '@/lib/ledger';
import { ledgerCtx, move } from '@/lib/money';
import { purchasesByPaymentIntent, purchasesRecovered, readPending, type PurchaseRow } from '@/lib/ledgerReads';
import { recordLedgerAlarm } from '@/lib/eventsRow';

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

// ── Purchase record for linking charges to users/tokens ──

interface PurchaseRecord {
  userId: string;
  tokens: number;
  packId: string;
  sessionId: string;
  chargeId: string;
  amount: number; // cents
  createdAt: string;
}

/** The purchase a refund or dispute takes back from. */
interface Purchase {
  userId: string;
  tokens: number;
  sessionId: string | null;
}

const PAUSED_ANSWER = { error: 'Money writes are paused. Retry later.' };
const FAILED_ANSWER = { error: 'Webhook handler failed.' };

const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : null);
const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === 'string' ? v : v?.id ?? null;

// ── POST /api/stripe/webhook ──

export async function POST(request: Request) {
  // Read raw body FIRST, before any JSON parsing.
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return Response.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown';
    console.error('[Stripe Webhook] Signature verification failed:', msg);
    return Response.json({ error: `Webhook signature verification failed: ${msg}` }, { status: 400 });
  }

  const log = (outcome: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ source: 'stripe-webhook', event_id: event.id, event_type: event.type, outcome, ...extra }));

  // 1. The fail-closed pause read.
  if (await isMoneyPaused()) return refuse(event, log);

  let ctx: L.LedgerCtx;
  try {
    ctx = ledgerCtx();
  } catch {
    log('ledger unbound (500, unmarked)');
    return Response.json(FAILED_ANSWER, { status: 500 });
  }
  try {
    return await handle(ctx, event, getKV(), log);
  } catch (err) {
    log('failed (500, unmarked)', { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
    return Response.json(FAILED_ANSWER, { status: 500 });
  }
}

/** 4.14 step 1: the refusal row (release 2's statement), then 503. A failed
 *  write still answers 503; Stripe's retry writes it again. */
async function refuse(event: Stripe.Event, log: (o: string, e?: Record<string, unknown>) => void): Promise<Response> {
  try {
    await L.recordRefusal(ledgerCtx(), { event: event.id, type: event.type, createdMs: event.created * 1000 });
    log('paused (503, refusal recorded)');
  } catch (err) {
    log('paused (503, refusal row not written)', { error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
  }
  return Response.json(PAUSED_ANSWER, { status: 503 });
}

type Kind = 'purchase' | 'refund' | 'dispute' | 'invalid_checkout' | 'unhandled';

function kindOf(event: Stripe.Event): Kind {
  if (event.type === 'checkout.session.completed') {
    const m = (event.data.object as Stripe.Checkout.Session).metadata;
    const tokens = m?.tokens ? parseInt(m.tokens, 10) : NaN;
    return m?.userId && m?.packId && Number.isSafeInteger(tokens) && tokens > 0 ? 'purchase' : 'invalid_checkout';
  }
  if (event.type === 'charge.refunded') return 'refund';
  if (event.type === 'charge.dispute.created') return 'dispute';
  return 'unhandled';
}

async function handle(
  ctx: L.LedgerCtx,
  event: Stripe.Event,
  kv: KV | null,
  log: (o: string, e?: Record<string, unknown>) => void
): Promise<Response> {
  const createdMs = event.created * 1000;
  const legacy1 = `token_idempotency:${event.id}`;
  const legacy2 = `webhook:stripe:${event.id}`;
  const done = async (outcome: string, extra: Record<string, unknown> = {}): Promise<Response> => {
    await mark(kv, event.id);
    log(outcome, extra);
    return Response.json({ received: true });
  };

  // 2 and 3: the evidence, the disposition and the admission, in one read.
  const adm = await L.readAdmission(ctx, { event: event.id, createdMs, legacy1, legacy2 });
  const row = adm.row ?? {};
  const evidence = row.applied != null || num(row.legacy) === 1;
  if (!evidence && row.disposition === 'none') {
    await L.resolvePending(ctx, event.id);
    return done("recorded 'none' (200, resolved)");
  }

  const kind = kindOf(event);
  if (kind === 'invalid_checkout') {
    const m = (event.data.object as Stripe.Checkout.Session).metadata;
    console.error('[Stripe Webhook] Missing or invalid metadata:', { userId: m?.userId, packId: m?.packId, tokens: m?.tokens });
    return done('invalid metadata (200, nothing moved)');
  }
  if (kind === 'unhandled') return done('unhandled type (200)');

  // 4. A pre-switch event (until the unpause, the sentinel makes every event
  //    pre-switch; an unreadable switch time counts as pre-switch).
  if (!evidence) {
    const switchAt = num(row.switch_at_ms);
    const preSwitch = switchAt === null || createdMs < switchAt;
    if (preSwitch && !adm.decision.admitted && row.disposition !== 'apply') {
      await L.recordPending(ctx, { event: event.id, reason: 'no_evidence' });
      await recordLedgerAlarm({ kind: 'stripe_no_evidence', subject: event.id, subjectKind: 'event', fields: { eventType: event.type, why: adm.decision.why ?? null } });
      log('pre-switch, no evidence (500, unmarked, pending)', { why: adm.decision.why });
      return Response.json(FAILED_ANSWER, { status: 500 });
    }
  }

  // 5 and 6.
  if (kind === 'purchase') return purchaseCredit(ctx, event, kv, log, { legacy1, legacy2 });

  const charge = kind === 'refund' ? (event.data.object as Stripe.Charge) : null;
  const dispute = kind === 'dispute' ? (event.data.object as Stripe.Dispute) : null;
  const chargeId = charge ? charge.id : idOf(dispute?.charge);
  const pi = idOf(charge ? charge.payment_intent : dispute?.payment_intent);
  const purchase = await findPurchase(ctx, kv, chargeId, pi);
  if (!purchase) {
    if (evidence) {
      // Applied already (its mapping since lost): nothing to compute again.
      await L.resolvePending(ctx, event.id);
      return done('replayed, no mapping now (200, resolved)');
    }
    const before = await readPending(ctx, event.id);
    await L.recordPending(ctx, { event: event.id, reason: 'mapping_missing' });
    if (before) {
      await recordLedgerAlarm({ kind: 'stripe_mapping_missing', subject: event.id, subjectKind: 'event', fields: { eventType: event.type, charge: chargeId } });
    }
    log('no purchase mapping (500, unmarked, pending)', { charge: chargeId, alarmed: !!before });
    return Response.json(FAILED_ANSWER, { status: 500 });
  }

  let amount: number;
  let meta: Record<string, unknown>;
  if (charge) {
    // RULE 6 (n1-ledger-05 002): the amount release 1 takes back. 4.1's SQL
    // as written cannot net out what earlier refunds on this charge took
    // (`amount_refunded` is the charge's running total), so a second partial
    // refund still takes the first back again; HQ's ruling A (one refund per
    // payment, `2026-10-04-001`) holds it to one refund until Second and HQ
    // rule. A retry of this event cannot debit twice: its key is
    // `stripe:{event.id}`.
    const refundRatio = charge.amount > 0 ? charge.amount_refunded / charge.amount : 0;
    amount = Math.ceil(purchase.tokens * refundRatio);
    meta = { charge: charge.id, payment_intent: pi, refund_amount_cents: charge.amount_refunded, refund_ratio: refundRatio };
  } else {
    // Debit 100% of tokens (regardless of dispute amount: adversarial signal).
    amount = purchase.tokens;
    meta = { charge: chargeId, payment_intent: pi, dispute: dispute?.id ?? null };
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    await L.resolvePending(ctx, event.id);
    return done('nothing to take back (200)', { amount });
  }

  const reason = charge ? 'refund_debit' : 'dispute_debit';
  const r = await move(ctx, {
    uid: purchase.userId, type: 'debit', amount, reason, source: reason, idem: `stripe:${event.id}`,
    event: event.id, legacy1, legacy2, meta: JSON.stringify(meta),
  }, 'zero');
  if (r.outcome === 'paused') return refuse(event, log);
  if (r.outcome === 'refused_by_decision') {
    await L.resolvePending(ctx, event.id);
    return done("refused by decision (200, resolved)");
  }
  if (r.outcome !== 'applied' && r.outcome !== 'replayed') {
    log(`debit ${r.outcome} (500, unmarked)`);
    return Response.json(FAILED_ANSWER, { status: 500 });
  }
  await L.resolvePending(ctx, event.id);
  if (!(await isMarked(kv, event.id))) {
    if (charge) await refundSideEffects(event, charge, purchase, kv, r, amount);
    else if (dispute) await disputeSideEffects(event, dispute, chargeId ?? '', purchase, kv, r);
  }
  return done(`debit ${r.outcome} (200)`, { amount, balance: r.balance });
}

// ── The purchase credit ──

async function purchaseCredit(
  ctx: L.LedgerCtx,
  event: Stripe.Event,
  kv: KV | null,
  log: (o: string, e?: Record<string, unknown>) => void,
  keys: { legacy1: string; legacy2: string }
): Promise<Response> {
  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata!.userId as string;
  const packId = session.metadata!.packId as string;
  const tokens = parseInt(session.metadata!.tokens as string, 10);
  const pi = idOf(session.payment_intent);

  // The charge lookup runs before the credit, best effort: a paid purchase is
  // never declined or delayed (A6(b)); a later refund then finds the
  // purchase by `ledger_purchase_pi`.
  let chargeId: string | null = null;
  if (pi) {
    try {
      const intent = await stripe.paymentIntents.retrieve(pi);
      chargeId = idOf(intent.latest_charge);
    } catch (err) {
      console.error('[Stripe Webhook] Charge lookup failed; crediting with charge NULL:', err instanceof Error ? err.message : err);
    }
  }

  const r = await move(ctx, {
    uid: userId, type: 'credit', amount: tokens, reason: 'token_pack_purchase', source: 'token_pack_purchase',
    idem: `stripe:${event.id}`, event: event.id, legacy1: keys.legacy1, legacy2: keys.legacy2,
    meta: JSON.stringify({ payment_intent: pi, charge: chargeId, pack_id: packId, session_id: session.id, amount_cents: session.amount_total ?? null }),
  }, 'user');
  const done = async (outcome: string): Promise<Response> => {
    await mark(kv, event.id);
    log(outcome, { amount: tokens });
    return Response.json({ received: true });
  };
  if (r.outcome === 'paused') return refuse(event, log);
  if (r.outcome === 'refused_by_decision') {
    await L.resolvePending(ctx, event.id);
    return done('refused by decision (200, resolved)');
  }
  if (r.outcome !== 'applied' && r.outcome !== 'replayed') {
    log(`credit ${r.outcome} (500, unmarked)`);
    return Response.json(FAILED_ANSWER, { status: 500 });
  }
  await L.resolvePending(ctx, event.id);

  if (!(await isMarked(kv, event.id))) {
    // Mark the user as paid: bypasses free-tier lifetime caps from this point on.
    await setUserPaid(userId);
    // The purchase record for refund and dispute lookups (6.3: unchanged).
    if (kv && chargeId) {
      const record: PurchaseRecord = {
        userId, tokens, packId, sessionId: session.id, chargeId,
        amount: session.amount_total ?? 0, createdAt: new Date().toISOString(),
      };
      try {
        await kv.put(`purchase:${chargeId}`, JSON.stringify(record));
      } catch (err) {
        console.error('[Stripe Webhook] Failed to store purchase record:', err);
      }
    }
  }
  return done(`credit ${r.outcome} (200)`);
}

// ── The purchase mapping (4.14 step 5) ──

function pick(rows: PurchaseRow[]): Purchase | null {
  if (rows.length === 0) return null;
  if (new Set(rows.map((r) => r.userId)).size > 1) throw new Error('purchase mapping names two users');
  const r = rows[0];
  if (!Number.isSafeInteger(r.tokens) || r.tokens <= 0) throw new Error('purchase row without tokens');
  return { userId: r.userId, tokens: r.tokens, sessionId: typeof r.meta.session_id === 'string' ? r.meta.session_id : null };
}

/** `purchase:{charge}` in KV, else `ledger_purchase_pi`, else `charge_recovered`.
 *  A failed read throws (500): never taken as absence. */
async function findPurchase(ctx: L.LedgerCtx, kv: KV | null, chargeId: string | null, pi: string | null): Promise<Purchase | null> {
  if (!kv) throw new Error('SPRITEBREW_KV unbound');
  if (chargeId) {
    const raw = await kv.get(`purchase:${chargeId}`);
    if (raw) {
      const rec = JSON.parse(raw) as Partial<PurchaseRecord>;
      if (typeof rec.userId !== 'string' || !Number.isSafeInteger(rec.tokens) || (rec.tokens as number) <= 0) {
        throw new Error('purchase record unreadable');
      }
      return { userId: rec.userId, tokens: rec.tokens as number, sessionId: rec.sessionId ?? null };
    }
  }
  if (pi) {
    const found = pick(await purchasesByPaymentIntent(ctx, pi));
    if (found) return found;
  }
  if (chargeId) return pick(await purchasesRecovered(ctx, chargeId));
  return null;
}

// ── The mark and the non-money side effects ──

async function isMarked(kv: KV | null, eventId: string): Promise<boolean> {
  try {
    return !!(await kv?.get(`webhook:stripe:${eventId}`));
  } catch {
    return false;
  }
}

async function mark(kv: KV | null, eventId: string): Promise<void> {
  try {
    await kv?.put(`webhook:stripe:${eventId}`, '1', { expirationTtl: 604800 }); // 7 days
  } catch { /* best effort */ }
}

async function refundSideEffects(
  event: Stripe.Event,
  charge: Stripe.Charge,
  purchase: Purchase,
  kv: KV | null,
  r: L.MovementResult,
  tokensDebited: number
): Promise<void> {
  const userId = purchase.userId;
  const newBalance = r.balance ?? 0;
  let refundCount = 0;
  try {
    // Velocity checks (informational, not blocking)
    const refundCountRaw = await kv?.get(`refund_count:${userId}`);
    refundCount = refundCountRaw ? parseInt(refundCountRaw, 10) : 0;
    if (refundCount >= 2) {
      console.warn(`[Stripe Webhook] LIFETIME REFUND CAP EXCEEDED for user ${userId}; refund is still being applied because Stripe already approved it, but flag for review`);
    }
    const lastRefundRaw = await kv?.get(`last_refund_at:${userId}`);
    if (lastRefundRaw && Date.now() - new Date(lastRefundRaw).getTime() < 180 * 24 * 60 * 60 * 1000) {
      console.warn(`[Stripe Webhook] REFUND COOLDOWN VIOLATED for user ${userId}; flag for review`);
    }
  } catch { /* informational */ }

  // The account status, inside the keyed refund path: a failure throws to a
  // 500, unmarked, and Stripe's retry replays the debit and sets it then.
  if (r.balance !== null && r.balance < 0) {
    await setAccountStatus(userId, 'refund_locked', {
      reason: 'negative_balance_after_refund',
      stripe_charge_id: charge.id,
    });
    console.warn(`[Stripe Webhook] Account ${userId} locked: negative balance ${newBalance} after refund`);
  }

  // Update refund tracking
  try {
    await kv?.put(`refund_count:${userId}`, String(refundCount + 1));
    await kv?.put(`last_refund_at:${userId}`, new Date().toISOString());
  } catch { /* best effort */ }

  // Record evidence snapshot
  try {
    const consentSnapshot = purchase.sessionId ? await loadConsentSnapshot(purchase.sessionId) : null;
    await recordEvidenceSnapshot('refund', charge.id, {
      userId,
      eventType: 'charge.refunded',
      stripeEventId: event.id,
      consentSnapshot,
      currentBalance: newBalance,
      refundCount: refundCount + 1,
      tokensDebited,
      refundRatio: charge.amount > 0 ? charge.amount_refunded / charge.amount : 0,
      rawStripeEvent: { id: event.id, type: event.type, created: event.created },
    });
  } catch { /* best effort */ }

  // Populate Stripe Radar lists (best-effort, lists may not exist yet)
  try {
    const email = charge.billing_details?.email;
    const cardFingerprint = (charge.payment_method_details?.card as { fingerprint?: string } | undefined)?.fingerprint;
    const ip = charge.metadata?.consent_ip;
    if (email) {
      await stripe.radar.valueListItems.create({ value_list: 'refunded_emails', value: email }).catch(() => {});
    }
    if (cardFingerprint) {
      await stripe.radar.valueListItems.create({ value_list: 'refunded_cards', value: cardFingerprint }).catch(() => {});
    }
    if (ip && ip !== 'unknown') {
      await stripe.radar.valueListItems.create({ value_list: 'refunded_ips', value: ip }).catch(() => {});
    }
  } catch {
    console.warn('[Stripe Webhook] Radar list update failed (lists may not exist yet)');
  }
}

async function disputeSideEffects(
  event: Stripe.Event,
  dispute: Stripe.Dispute,
  chargeId: string,
  purchase: Purchase,
  kv: KV | null,
  r: L.MovementResult
): Promise<void> {
  const userId = purchase.userId;
  const newBalance = r.balance ?? 0;
  console.warn(`[DISPUTE_ALERT] User ${userId} filed chargeback on charge ${chargeId}. Debited ${purchase.tokens} tokens. Balance: ${newBalance}`);

  // Permanent account lock, inside the keyed path (a failure: 500, unmarked).
  await setAccountStatus(userId, 'disputed', {
    reason: 'chargeback_filed',
    stripe_charge_id: chargeId,
    stripe_dispute_id: dispute.id,
  });

  // Permanent dispute record (no TTL)
  try {
    await kv?.put(`disputed:${userId}`, JSON.stringify({
      charge_id: chargeId,
      dispute_id: dispute.id,
      filed_at: new Date().toISOString(),
    }));
  } catch { /* best effort */ }

  // Record evidence snapshot
  try {
    const refundCountRaw = await kv?.get(`refund_count:${userId}`);
    const refundCount = refundCountRaw ? parseInt(refundCountRaw, 10) : 0;
    const consentSnapshot = purchase.sessionId ? await loadConsentSnapshot(purchase.sessionId) : null;
    await recordEvidenceSnapshot('dispute', chargeId, {
      userId,
      eventType: 'charge.dispute.created',
      stripeEventId: event.id,
      stripeDisputeId: dispute.id,
      consentSnapshot,
      currentBalance: newBalance,
      refundCount,
      tokensDebited: purchase.tokens,
      disputeAmount: dispute.amount,
      disputeReason: dispute.reason,
      rawStripeEvent: { id: event.id, type: event.type, created: event.created },
    });
  } catch { /* best effort */ }

  // Populate Stripe Radar lists (best-effort)
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    const email = charge.billing_details?.email;
    const cardFingerprint = (charge.payment_method_details?.card as { fingerprint?: string } | undefined)?.fingerprint;
    const ip = charge.metadata?.consent_ip;
    if (email) {
      await stripe.radar.valueListItems.create({ value_list: 'refunded_emails', value: email }).catch(() => {});
      await stripe.radar.valueListItems.create({ value_list: 'disputed_accounts', value: email }).catch(() => {});
    }
    if (cardFingerprint) {
      await stripe.radar.valueListItems.create({ value_list: 'refunded_cards', value: cardFingerprint }).catch(() => {});
    }
    if (ip && ip !== 'unknown') {
      await stripe.radar.valueListItems.create({ value_list: 'refunded_ips', value: ip }).catch(() => {});
    }
  } catch {
    console.warn('[Stripe Webhook] Radar list update failed (lists may not exist yet)');
  }
}
