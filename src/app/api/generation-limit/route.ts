export const runtime = 'edge';

import { getAuthedUserId, type AuthMessages } from '@/lib/edgeAuth';
import { getGenerationLimitStatus } from '@/lib/serverRateLimit';

// This route's wording for the shared helper's four failure cases.
const AUTH_MESSAGES: AuthMessages = {
  missing: 'Not signed in.',
  empty: 'Invalid session.',
  invalid: 'Invalid token.',
  expired: 'Session expired.',
};

// ── GET /api/generation-limit ──

export async function GET(request: Request) {
  const authResult = await getAuthedUserId(request, AUTH_MESSAGES);
  if ('error' in authResult) {
    return Response.json({ success: false, error: authResult.error }, { status: 401 });
  }

  const status = await getGenerationLimitStatus(authResult.userId);
  return Response.json({ success: true, ...status });
}
