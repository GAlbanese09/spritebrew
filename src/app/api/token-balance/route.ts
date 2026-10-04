export const runtime = 'edge';

import { getAuthedUserId, type AuthMessages } from '@/lib/edgeAuth';
import { getTokenBalance, readBalanceStrict } from '@/lib/tokenBalance';
import { MoneyPausedError, UPDATING_MESSAGE, isMoneyPaused } from '@/lib/moneyPause';
import { checkoutCredited } from '@/lib/purchaseEvidence';

// This route's wording for the shared helper's four failure cases.
const AUTH_MESSAGES: AuthMessages = {
  missing: 'Not signed in.',
  empty: 'Invalid session.',
  invalid: 'Invalid token.',
  expired: 'Session expired.',
};

// ── GET /api/token-balance ──
//
// The D1 balance (n1-release-2-spec.md revision 9, 6.2): opened per 4.2 on
// first use; paused, the paused answer; anything unconfirmed, an error,
// never a guessed number.
//
// The purchase banner's read (HQ-14, R9-8) carries `?purchase=1` and, on a
// return from Stripe, `&session={CHECKOUT_SESSION_ID}`: the balance read
// strictly (no opening, `balance: null` when unknown), the money pause failing
// closed (a failed read answers true), and `credited`, this checkout's own
// credit (src/lib/purchaseEvidence.ts): true, false, or null for no evidence.
// Neither changes anything, and no money path reads them.

export async function GET(request: Request) {
  const authResult = await getAuthedUserId(request, AUTH_MESSAGES);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }
  const userId = authResult.userId;

  const params = new URL(request.url).searchParams;
  if (params.get('purchase') === '1') {
    const session = params.get('session');
    return Response.json({
      success: true,
      balance: await readBalanceStrict(userId),
      moneyPaused: await isMoneyPaused(),
      credited: session ? await checkoutCredited(userId, session) : null,
    });
  }

  let balance: number;
  try {
    balance = await getTokenBalance(userId);
  } catch (err) {
    // Only a first-ever balance (an opening) is refused while money is paused.
    if (err instanceof MoneyPausedError) {
      return Response.json({ success: false, error: UPDATING_MESSAGE, paused: true }, { status: 503 });
    }
    return Response.json({ success: false, error: 'balance_unavailable' }, { status: 500 });
  }
  return Response.json({
    success: true,
    balance,
    tokenCosts: { fast: 3, plus: 10, pro: 40, animStandard: 15, animExpensive: 50 },
  });
}
