/**
 * Edge-runtime helpers for authenticating Clerk session tokens.
 *
 * Used by the JSON-only API routes that don't already inline this logic.
 * `/api/generate` keeps its own copy because it predates this module — both
 * implementations are intentionally identical so behavior matches.
 */

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

export type AuthResult = { userId: string } | { error: string; status: number };

/**
 * Decode the Clerk session JWT from the Authorization Bearer header.
 * Returns either { userId } or { error, status } so the caller can return
 * a `Response.json` directly.
 */
export function getAuthedUserId(request: Request): AuthResult {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Please sign in to continue.', status: 401 };
  }
  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') {
    return { error: 'Invalid session. Please sign in again.', status: 401 };
  }
  const payload = decodeJwtPayload(token);
  if (!payload?.sub) {
    return { error: 'Invalid token. Please sign in again.', status: 401 };
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { error: 'Your session expired. Please sign in again.', status: 401 };
  }
  return { userId: payload.sub };
}
