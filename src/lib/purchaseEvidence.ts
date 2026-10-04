/**
 * The purchase banner's evidence on the D1 ledger (n1-release-2-spec.md
 * revision 9, S4; R9-8, HQ `2026-10-03-005` decision 2). Stripe's checkout
 * returns with its Checkout Session id; the session's payment intent finds
 * the purchase credit through `ledger_purchase_pi`, and the credit counts
 * only when it is this user's and names this session (4.14's purchase
 * `meta_json`: `payment_intent`, `session_id`). This replaces S0's
 * balance-rise evidence, which another credit landing during checkout could
 * also satisfy (`L3 017` rule 6 item 2).
 *
 * Answers true (credited), false (read, not credited yet) or null (no
 * evidence either way: a malformed id, another user's session, a session
 * with no payment intent, or a failed read). Only true shows 'added'.
 */

import { stripe } from '@/lib/stripe';
import { ledgerCtx } from '@/lib/money';
import { purchasesByPaymentIntent } from '@/lib/ledgerReads';

const SESSION_ID = /^cs_[A-Za-z0-9_]{1,250}$/;

export async function checkoutCredited(userId: string, sessionId: string): Promise<boolean | null> {
  if (!SESSION_ID.test(sessionId)) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.userId !== userId) return null;
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!pi) return null;
    const rows = await purchasesByPaymentIntent(ledgerCtx(), pi);
    return rows.some((r) => r.userId === userId && r.meta.session_id === sessionId);
  } catch {
    return null;
  }
}
