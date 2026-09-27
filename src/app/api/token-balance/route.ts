export const runtime = 'edge';

import { getAuthedUserId, type AuthMessages } from '@/lib/edgeAuth';
import { getTokenBalance } from '@/lib/tokenBalance';

// This route's wording for the shared helper's four failure cases.
const AUTH_MESSAGES: AuthMessages = {
  missing: 'Not signed in.',
  empty: 'Invalid session.',
  invalid: 'Invalid token.',
  expired: 'Session expired.',
};

// ── GET /api/token-balance ──

export async function GET(request: Request) {
  const authResult = await getAuthedUserId(request, AUTH_MESSAGES);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }

  const balance = await getTokenBalance(authResult.userId);
  return Response.json({
    success: true,
    balance,
    tokenCosts: { fast: 3, plus: 10, pro: 40, animStandard: 15, animExpensive: 50 },
  });
}
