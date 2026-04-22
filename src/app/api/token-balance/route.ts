export const runtime = 'edge';

import { getTokenBalance } from '@/lib/tokenBalance';

// ── JWT helpers (same lightweight decode as /api/generate) ──

interface ClerkJwtPayload {
  sub?: string;
  exp?: number;
  [key: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

function decodeJwtPayload(token: string): ClerkJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as ClerkJwtPayload;
  } catch {
    return null;
  }
}

function getAuthedUserId(request: Request): { userId: string } | { error: string } {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { error: 'Not signed in.' };
  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') return { error: 'Invalid session.' };
  const payload = decodeJwtPayload(token);
  if (!payload?.sub) return { error: 'Invalid token.' };
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return { error: 'Session expired.' };
  return { userId: payload.sub };
}

// ── GET /api/token-balance ──

export async function GET(request: Request) {
  const authResult = getAuthedUserId(request);
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
