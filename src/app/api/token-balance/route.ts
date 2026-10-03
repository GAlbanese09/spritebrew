export const runtime = 'edge';

import { getAuthedUserId, type AuthMessages } from '@/lib/edgeAuth';
import { getTokenBalance, readBalanceStrict } from '@/lib/tokenBalance';
import { MoneyPausedError, UPDATING_MESSAGE, isMoneyPaused } from '@/lib/moneyPause';

// This route's wording for the shared helper's four failure cases.
const AUTH_MESSAGES: AuthMessages = {
  missing: 'Not signed in.',
  empty: 'Invalid session.',
  invalid: 'Invalid token.',
  expired: 'Session expired.',
};

// ── GET /api/token-balance ──
//
// The purchase banner's two reads (HQ-14, n1-ledger-03 016) carry a flag:
// `?purchase=baseline` just before checkout and `?purchase=1` on the return.
// Both read the balance strictly: no opening, and `balance: null` when it
// cannot be known, never a guessed number. Only `?purchase=1` also reads the
// money pause, as `moneyPaused`, failing closed (a failed read answers true).
// Neither changes anything, and no money path reads them. Without the flag
// the route is unchanged.

export async function GET(request: Request) {
  const authResult = await getAuthedUserId(request, AUTH_MESSAGES);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }

  const purchase = new URL(request.url).searchParams.get('purchase');
  if (purchase === '1' || purchase === 'baseline') {
    const known = await readBalanceStrict(authResult.userId);
    return Response.json({
      success: true,
      balance: known,
      ...(purchase === '1' ? { moneyPaused: await isMoneyPaused() } : {}),
    });
  }

  let balance: number;
  try {
    balance = await getTokenBalance(authResult.userId);
  } catch (err) {
    // Only a first-ever balance (an opening) is refused while money is paused.
    if (err instanceof MoneyPausedError) {
      return Response.json({ success: false, error: UPDATING_MESSAGE, paused: true }, { status: 503 });
    }
    throw err;
  }
  return Response.json({
    success: true,
    balance,
    tokenCosts: { fast: 3, plus: 10, pro: 40, animStandard: 15, animExpensive: 50 },
  });
}
