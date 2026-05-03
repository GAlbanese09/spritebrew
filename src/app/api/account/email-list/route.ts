// Newsletter signup endpoint — opt-in earn-back.
//
// Reads the user's primary email from Clerk (no client-supplied email — that
// would let bots farm tokens against arbitrary inboxes). Adds the contact to
// the Resend audience configured via RESEND_AUDIENCE_ID. On success, credits
// EMAIL_LIST_BONUS_TOKENS and sets the bonus_email_list:{userId} flag.
//
// Idempotent: a second call returns alreadyClaimed=true without touching Resend.

export const runtime = 'edge';

import { Resend } from 'resend';
import { getAuthedUserId } from '@/lib/edgeAuth';
import {
  creditTokens,
  getTokenBalance,
  hasClaimedEmailList,
  markEmailListClaimed,
} from '@/lib/tokenBalance';
import { EMAIL_LIST_BONUS_TOKENS } from '@/lib/constants';

interface ClerkUser {
  primary_email_address_id?: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
}

async function fetchClerkPrimaryEmail(userId: string): Promise<string | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as ClerkUser;
    const primary = user.email_addresses?.find(
      (e) => e.id === user.primary_email_address_id
    );
    return primary?.email_address ?? user.email_addresses?.[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  // Idempotency check first — bail before touching Resend or Clerk
  if (await hasClaimedEmailList(userId)) {
    const balance = await getTokenBalance(userId);
    return Response.json({
      success: true,
      alreadyClaimed: true,
      claimed: true,
      balance,
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    console.error('[Email List] RESEND_API_KEY or RESEND_AUDIENCE_ID not configured');
    return Response.json(
      { success: false, error: 'Newsletter signup is temporarily unavailable. Try again later.' },
      { status: 500 }
    );
  }

  const email = await fetchClerkPrimaryEmail(userId);
  if (!email) {
    return Response.json(
      { success: false, error: 'Could not read your email. Try again or contact support.' },
      { status: 400 }
    );
  }

  // Add to the Resend audience. The legacy { audienceId, email } form is the
  // simplest path — Resend's docs still support it.
  try {
    const resend = new Resend(apiKey);
    const result = await resend.contacts.create({
      audienceId,
      email,
      unsubscribed: false,
    });
    // Resend's SDK returns { data, error } — treat truthy `error` as failure.
    const errPayload = (result as { error?: { message?: string } | null }).error;
    if (errPayload && errPayload.message && !/already exists/i.test(errPayload.message)) {
      console.error('[Email List] Resend create failed:', errPayload.message);
      return Response.json(
        { success: false, error: 'Newsletter signup failed. Try again in a moment.' },
        { status: 500 }
      );
    }
    // "already exists" is fine — we still credit the bonus once (idempotency
    // is gated by the bonus_email_list flag, not the Resend response).
  } catch (err) {
    console.error('[Email List] Resend exception:', err);
    return Response.json(
      { success: false, error: 'Newsletter signup failed. Try again in a moment.' },
      { status: 500 }
    );
  }

  // Resend success → credit + flag
  const credit = await creditTokens(
    userId,
    EMAIL_LIST_BONUS_TOKENS,
    'earn_back_email_list',
    `email_list:${userId}`,
    { source: 'email_list' }
  );
  if (!credit.success) {
    return Response.json(
      { success: false, error: 'Could not credit tokens. Contact support.' },
      { status: 500 }
    );
  }

  await markEmailListClaimed(userId);

  return Response.json({
    success: true,
    granted: EMAIL_LIST_BONUS_TOKENS,
    balance: credit.balance,
    claimed: true,
    email,
  });
}
