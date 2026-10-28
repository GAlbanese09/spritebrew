export const runtime = 'edge';

import { getAuthedUserId, type AuthMessages } from '@/lib/edgeAuth';
import { getTokenBalance, hasUserPaid, readBalanceStrict } from '@/lib/tokenBalance';
import { getAccountStatus } from '@/lib/accountLock';
import { MoneyPausedError, UPDATING_MESSAGE, isMoneyPaused } from '@/lib/moneyPause';
import { isAdminUserServer } from '@/lib/adminIds';

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
// the route answers the balance, the caller's admin flag and `hasPaid`.

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
  // Whether the account has ever paid, for the low-balance prompt (has-paid 001).
  // Read-only. A refund-locked or disputed account answers false, and so does a
  // failed flag read; a failed status read answers `active`, accountLock's default.
  const [paid, status] = await Promise.all([
    hasUserPaid(authResult.userId),
    getAccountStatus(authResult.userId),
  ]);
  return Response.json({
    success: true,
    balance,
    // The caller's own admin flag (cost visibility); no id reaches the client.
    isAdmin: isAdminUserServer(authResult.userId),
    hasPaid: paid && status === 'active',
  });
}
