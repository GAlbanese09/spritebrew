/**
 * The one place an API route learns who is calling (auth-verify.md 003).
 *
 * Verifies the Clerk session token in the Authorization Bearer header:
 * `@clerk/backend` verifyToken checks the RS256 signature against this
 * environment's PEM public key (networkless, `CLERK_JWT_KEY`), `exp`, `nbf`
 * and `iat` with 5 s of skew, and `azp` against the allowlist. On top of that
 * this module pins what the library leaves open: RS256 only, the key id when
 * `CLERK_JWT_KID` is set, the issuer, a non-empty `sub` and `sid`, numeric
 * `exp` and `nbf`, and a non-empty `azp` that is one of this environment's
 * origins. The environment is chosen by APP_ENV, never NODE_ENV (both
 * environments set NODE_ENV to "production"). Missing or bad configuration
 * rejects every request: there is no decode-only fallback.
 */

import { verifyToken } from '@clerk/backend';

type AppEnv = 'production' | 'dev';

/** Pinned per environment. Public values; never taken from the request or the token. */
const PINS: Record<AppEnv, { issuer: string; origins: readonly string[] }> = {
  production: {
    issuer: 'https://clerk.spritebrew.com',
    origins: ['https://spritebrew.com', 'https://www.spritebrew.com'],
  },
  dev: {
    issuer: 'https://needed-blowfish-74.clerk.accounts.dev',
    origins: ['https://dev.spritebrew.pages.dev'],
  },
};

const CLOCK_SKEW_MS = 5_000;

export type AuthFailureReason = 'missing' | 'empty' | 'invalid' | 'expired';

/** Each route keeps its own wording for these four cases. */
export type AuthMessages = Record<AuthFailureReason, string>;

const DEFAULT_MESSAGES: AuthMessages = {
  missing: 'Please sign in to continue.',
  empty: 'Invalid session. Please sign in again.',
  invalid: 'Invalid token. Please sign in again.',
  expired: 'Your session expired. Please sign in again.',
};

export type AuthResult =
  | { userId: string }
  | { error: string; status: number; reason: AuthFailureReason };

/** Reason codes only; never token content. `azp_missing` is counted for a
 *  week (auth-verify.md 003) to learn whether real sessions arrive without it. */
function logReject(event: string): void {
  console.warn(JSON.stringify({ source: 'edge-auth', event }));
}

function base64UrlToString(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

/** One unverified segment of the token, parsed only to refuse early or to
 *  pick a log counter; nothing in it is ever trusted. */
function readSegment(token: string, index: 0 | 1): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const value = JSON.parse(base64UrlToString(parts[index]));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function finiteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export async function getAuthedUserId(
  request: Request,
  messages: AuthMessages = DEFAULT_MESSAGES
): Promise<AuthResult> {
  const fail = (reason: AuthFailureReason): AuthResult => ({ error: messages[reason], status: 401, reason });

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return fail('missing');
  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') return fail('empty');

  const env = process.env as Record<string, unknown>;
  const appEnv = env.APP_ENV;
  const jwtKey = env.CLERK_JWT_KEY;
  const expectedKid = env.CLERK_JWT_KID;
  if ((appEnv !== 'production' && appEnv !== 'dev') || !nonEmptyString(jwtKey)) {
    console.error(JSON.stringify({ source: 'edge-auth', event: 'config_missing' }));
    return fail('invalid');
  }
  const pins = PINS[appEnv];

  const header = readSegment(token, 0);
  if (!header || header.alg !== 'RS256') return fail('invalid');
  if (nonEmptyString(expectedKid) && header.kid !== expectedKid) return fail('invalid');

  // The package's exported verifyToken returns the verified payload and
  // throws a TokenVerificationError (with a `reason`) on any failure.
  let payload: Record<string, unknown>;
  try {
    const verified = await verifyToken(token, {
      jwtKey,
      authorizedParties: [...pins.origins],
      clockSkewInMs: CLOCK_SKEW_MS,
    });
    payload = verified as unknown as Record<string, unknown>;
  } catch (err) {
    const reason = (err as { reason?: unknown } | null)?.reason;
    // With an allowlist, @clerk/backend 3.x also rejects a missing azp here,
    // before the check below. Count that case for the one-week watch; the
    // token is rejected either way.
    if (reason === 'token-invalid-authorized-parties' && !nonEmptyString(readSegment(token, 1)?.azp)) {
      logReject('azp_missing');
    }
    return fail(reason === 'token-expired' ? 'expired' : 'invalid');
  }

  if (payload.iss !== pins.issuer) return fail('invalid');
  if (!nonEmptyString(payload.sub) || !nonEmptyString(payload.sid)) return fail('invalid');
  if (!finiteNumber(payload.exp) || !finiteNumber(payload.nbf)) return fail('invalid');
  if (!nonEmptyString(payload.azp)) {
    logReject('azp_missing');
    return fail('invalid');
  }
  if (!pins.origins.includes(payload.azp)) return fail('invalid');

  return { userId: payload.sub };
}
