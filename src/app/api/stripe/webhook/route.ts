export const runtime = 'edge';

import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { creditTokens } from '@/lib/tokenBalance';

// ── KV binding (same pattern as tokenBalance.ts) ──

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
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
      // KV check failed — continue processing (better to double-credit than miss)
    }
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const packId = session.metadata?.packId;
    const tokensStr = session.metadata?.tokens;

    if (!userId || !packId || !tokensStr) {
      console.error('[Stripe Webhook] Missing metadata:', { userId, packId, tokensStr });
      // Still return 200 — don't retry for bad metadata
      return Response.json({ received: true, error: 'Missing metadata' });
    }

    const tokens = parseInt(tokensStr, 10);
    if (isNaN(tokens) || tokens <= 0) {
      console.error('[Stripe Webhook] Invalid token amount:', tokensStr);
      return Response.json({ received: true, error: 'Invalid token amount' });
    }

    try {
      await creditTokens(userId, tokens, `token_pack_purchase:${packId}`, event.id);
      console.log(`[Stripe Webhook] Credited ${tokens} tokens to ${userId} (pack: ${packId})`);
    } catch (err) {
      console.error('[Stripe Webhook] Credit failed:', err);
      // Still return 200 — the idempotency key in creditTokens protects against double-credit on retry
    }

    // Mark event as processed
    if (kv) {
      try {
        await kv.put(eventKey, '1', { expirationTtl: 604800 }); // 7 days
      } catch {
        // Best effort
      }
    }
  }

  return Response.json({ received: true });
}
