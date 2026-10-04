// Newsletter signup endpoint — opt-in earn-back.
//
// Reads the user's primary email from Clerk (no client-supplied email — that
// would let bots farm tokens against arbitrary inboxes). Adds the contact to
// the Resend audience configured via RESEND_AUDIENCE_ID. On success, credits
// EMAIL_LIST_BONUS_TOKENS and sets the bonus_email_list:{userId} flag.
//
// Idempotent: a second call returns alreadyClaimed=true without touching Resend.
//
// Release 2 (n1-release-2-spec.md revision 9, 6.2): the pause read before
// Resend stays (O9); the credit is one D1 movement under `email_list:{userId}`,
// its release 1 `token_idempotency:` key the legacy evidence (4.13). The flag
// is written only after `applied` or `replayed` (equal identity, or the
// legacy evidence), never after `paused`, `declined` or `error`, so a paused
// or failed credit leaves it unset and the user can retry, and a release 1
// credit whose flag write failed gets its flag on the retry. Release 2 writes
// no admission record.

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
import { isMoneyPaused, MoneyPausedError, UPDATING_MESSAGE } from '@/lib/moneyPause';

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
  const auth = await getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const balanceOrAnswer = async (): Promise<number | Response> => {
    try {
      return await getTokenBalance(userId);
    } catch (err) {
      if (err instanceof MoneyPausedError) {
        return Response.json({ success: false, error: UPDATING_MESSAGE, paused: true }, { status: 503 });
      }
      return Response.json({ success: false, error: 'balance_unavailable' }, { status: 500 });
    }
  };

  // Idempotency check first: bail before touching Resend or Clerk.
  if (await hasClaimedEmailList(userId)) {
    const balance = await balanceOrAnswer();
    if (balance instanceof Response) return balance;
    return Response.json({
      success: true,
      alreadyClaimed: true,
      claimed: true,
      balance,
    });
  }

  // A credit follows the subscription, so neither happens while money is
  // paused (O9). The read narrows the race; a pause that starts after it
  // leaves the credit paused and the flag unset, and the user retries.
  if (await isMoneyPaused()) {
    return Response.json({ success: false, error: UPDATING_MESSAGE, paused: true }, { status: 503 });
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
  // simplest path; Resend's docs still support it.
  try {
    const resend = new Resend(apiKey);
    const result = await resend.contacts.create({
      audienceId,
      email,
      unsubscribed: false,
    });
    // Resend's SDK returns { data, error }: treat a truthy `error` as failure.
    const errPayload = (result as { error?: { message?: string } | null }).error;
    if (errPayload && errPayload.message && !/already exists/i.test(errPayload.message)) {
      console.error('[Email List] Resend create failed:', errPayload.message);
      return Response.json(
        { success: false, error: 'Newsletter signup failed. Try again in a moment.' },
        { status: 500 }
      );
    }
    // "already exists" is fine: we still credit the bonus once (idempotency
    // is the ledger's key, not the Resend response).
  } catch (err) {
    console.error('[Email List] Resend exception:', err);
    return Response.json(
      { success: false, error: 'Newsletter signup failed. Try again in a moment.' },
      { status: 500 }
    );
  }

  // Resend success: the credit, then the flag.
  const key = `email_list:${userId}`;
  const credit = await creditTokens(userId, EMAIL_LIST_BONUS_TOKENS, 'earn_back_email_list', key, {
    source: 'email_list',
    legacy: `token_idempotency:${key}`,
  });
  console.log(JSON.stringify({ source: 'email-list', user_id: userId, reward_key: key, outcome: credit.outcome }));
  if (credit.outcome === 'paused') {
    return Response.json({ success: false, error: UPDATING_MESSAGE, paused: true }, { status: 503 });
  }
  if (credit.outcome !== 'applied' && credit.outcome !== 'replayed') {
    return Response.json(
      { success: false, error: 'Could not credit tokens. Contact support.' },
      { status: 500 }
    );
  }

  await markEmailListClaimed(userId);

  if (credit.outcome === 'replayed') {
    const balance = credit.balance ?? (await balanceOrAnswer());
    if (balance instanceof Response) return balance;
    return Response.json({ success: true, alreadyClaimed: true, claimed: true, balance });
  }
  return Response.json({
    success: true,
    granted: EMAIL_LIST_BONUS_TOKENS,
    balance: credit.balance,
    claimed: true,
  });
}
