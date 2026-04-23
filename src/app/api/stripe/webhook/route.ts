export const runtime = 'edge';

import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { creditTokens, getTokenBalance } from '@/lib/tokenBalance';
import { debitTokensForRefund } from '@/lib/tokenDebit';
import { setAccountStatus } from '@/lib/accountLock';
import { recordEvidenceSnapshot, loadConsentSnapshot } from '@/lib/disputeEvidence';

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

// ── POST /api/stripe/webhook ──

export async function POST(request: Request) {
  // Read raw body FIRST — before any JSON parsing
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

  // Idempotency check
  const kv = getKV();
  const eventKey = `webhook:stripe:${event.id}`;
  if (kv) {
    try {
      const existing = await kv.get(eventKey);
      if (existing) {
        return Response.json({ received: true, deduplicated: true });
      }
    } catch {
      // KV check failed — continue processing
    }
  }

  // ── checkout.session.completed ──
  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(event, kv);
  }

  // ── charge.refunded ──
  if (event.type === 'charge.refunded') {
    await handleChargeRefunded(event, kv);
  }

  // ── charge.dispute.created ──
  if (event.type === 'charge.dispute.created') {
    await handleDisputeCreated(event, kv);
  }

  // Mark event as processed
  if (kv) {
    try {
      await kv.put(eventKey, '1', { expirationTtl: 604800 }); // 7 days
    } catch { /* best effort */ }
  }

  return Response.json({ received: true });
}

// ── checkout.session.completed ──

async function handleCheckoutCompleted(event: Stripe.Event, kv: KV | null): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata?.userId;
  const packId = session.metadata?.packId;
  const tokensStr = session.metadata?.tokens;

  if (!userId || !packId || !tokensStr) {
    console.error('[Stripe Webhook] Missing metadata:', { userId, packId, tokensStr });
    return;
  }

  const tokens = parseInt(tokensStr, 10);
  if (isNaN(tokens) || tokens <= 0) {
    console.error('[Stripe Webhook] Invalid token amount:', tokensStr);
    return;
  }

  try {
    await creditTokens(userId, tokens, `token_pack_purchase:${packId}`, event.id);
    console.log(`[Stripe Webhook] Credited ${tokens} tokens to ${userId} (pack: ${packId})`);
  } catch (err) {
    console.error('[Stripe Webhook] Credit failed:', err);
  }

  // Store purchase record for refund/dispute lookups
  if (kv && session.payment_intent) {
    const piId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent.id;

    try {
      // Retrieve the PaymentIntent to get the charge ID
      const pi = await stripe.paymentIntents.retrieve(piId);
      const chargeId = typeof pi.latest_charge === 'string'
        ? pi.latest_charge
        : pi.latest_charge?.id ?? '';

      if (chargeId) {
        const purchaseRecord: PurchaseRecord = {
          userId,
          tokens,
          packId,
          sessionId: session.id,
          chargeId,
          amount: session.amount_total ?? 0,
          createdAt: new Date().toISOString(),
        };
        // Store by charge ID for refund/dispute lookups (no TTL — permanent)
        await kv.put(`purchase:${chargeId}`, JSON.stringify(purchaseRecord));
      }
    } catch (err) {
      console.error('[Stripe Webhook] Failed to store purchase record:', err);
    }
  }
}

// ── charge.refunded ──

async function handleChargeRefunded(event: Stripe.Event, kv: KV | null): Promise<void> {
  const charge = event.data.object as Stripe.Charge;

  if (!kv) {
    console.error('[Stripe Webhook] KV unavailable for refund processing');
    return;
  }

  // Look up original purchase
  const purchaseRaw = await kv.get(`purchase:${charge.id}`);
  if (!purchaseRaw) {
    console.warn(`[Stripe Webhook] No purchase record for charge ${charge.id} — not our charge`);
    return;
  }

  const purchase = JSON.parse(purchaseRaw) as PurchaseRecord;
  const userId = purchase.userId;

  // Velocity checks (informational, not blocking)
  const refundCountRaw = await kv.get(`refund_count:${userId}`);
  const refundCount = refundCountRaw ? parseInt(refundCountRaw, 10) : 0;

  if (refundCount >= 2) {
    console.warn(`[Stripe Webhook] LIFETIME REFUND CAP EXCEEDED for user ${userId}; refund is still being applied because Stripe already approved it, but flag for review`);
  }

  const lastRefundRaw = await kv.get(`last_refund_at:${userId}`);
  if (lastRefundRaw) {
    const lastRefundAt = new Date(lastRefundRaw).getTime();
    const cooldownMs = 180 * 24 * 60 * 60 * 1000; // 180 days
    if (Date.now() - lastRefundAt < cooldownMs) {
      console.warn(`[Stripe Webhook] REFUND COOLDOWN VIOLATED for user ${userId}; flag for review`);
    }
  }

  // Compute refund ratio and tokens to debit
  const refundRatio = charge.amount_refunded / charge.amount;
  const tokensToDebit = Math.ceil(purchase.tokens * refundRatio);

  // Debit tokens (may go negative)
  const newBalance = await debitTokensForRefund(userId, tokensToDebit, 'refund_debit', {
    stripe_charge_id: charge.id,
    stripe_event_id: event.id,
    refund_amount: charge.amount_refunded,
    refund_ratio: refundRatio,
  });

  console.log(`[Stripe Webhook] Debited ${tokensToDebit} tokens from ${userId} (refund). New balance: ${newBalance}`);

  // Lock account if balance went negative
  if (newBalance < 0) {
    await setAccountStatus(userId, 'refund_locked', {
      reason: 'negative_balance_after_refund',
      stripe_charge_id: charge.id,
    });
    console.warn(`[Stripe Webhook] Account ${userId} locked — negative balance ${newBalance} after refund`);
  }

  // Update refund tracking
  try {
    await kv.put(`refund_count:${userId}`, String(refundCount + 1));
    await kv.put(`last_refund_at:${userId}`, new Date().toISOString());
  } catch { /* best effort */ }

  // Record evidence snapshot
  try {
    const consentSnapshot = purchase.sessionId
      ? await loadConsentSnapshot(purchase.sessionId)
      : null;

    await recordEvidenceSnapshot('refund', charge.id, {
      userId,
      eventType: 'charge.refunded',
      stripeEventId: event.id,
      consentSnapshot,
      currentBalance: newBalance,
      refundCount: refundCount + 1,
      tokensDebited: tokensToDebit,
      refundRatio,
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

// ── charge.dispute.created ──

async function handleDisputeCreated(event: Stripe.Event, kv: KV | null): Promise<void> {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id ?? '';

  if (!kv) {
    console.error('[Stripe Webhook] KV unavailable for dispute processing');
    return;
  }

  // Look up original purchase
  const purchaseRaw = chargeId ? await kv.get(`purchase:${chargeId}`) : null;
  if (!purchaseRaw) {
    console.warn(`[Stripe Webhook] No purchase record for charge ${chargeId} — not our charge`);
    return;
  }

  const purchase = JSON.parse(purchaseRaw) as PurchaseRecord;
  const userId = purchase.userId;

  // Debit 100% of tokens (regardless of dispute amount — adversarial signal)
  const newBalance = await debitTokensForRefund(userId, purchase.tokens, 'dispute_debit', {
    stripe_charge_id: chargeId,
    stripe_dispute_id: dispute.id,
    stripe_event_id: event.id,
  });

  console.warn(`[DISPUTE_ALERT] User ${userId} filed chargeback on charge ${chargeId}. Debited ${purchase.tokens} tokens. Balance: ${newBalance}`);

  // Permanent account lock
  await setAccountStatus(userId, 'disputed', {
    reason: 'chargeback_filed',
    stripe_charge_id: chargeId,
    stripe_dispute_id: dispute.id,
  });

  // Permanent dispute record (no TTL)
  try {
    await kv.put(`disputed:${userId}`, JSON.stringify({
      charge_id: chargeId,
      dispute_id: dispute.id,
      filed_at: new Date().toISOString(),
    }));
  } catch { /* best effort */ }

  // Get refund count for evidence
  const refundCountRaw = await kv.get(`refund_count:${userId}`);
  const refundCount = refundCountRaw ? parseInt(refundCountRaw, 10) : 0;

  // Record evidence snapshot
  try {
    const consentSnapshot = purchase.sessionId
      ? await loadConsentSnapshot(purchase.sessionId)
      : null;

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
    // Retrieve charge for billing details
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
