/**
 * Per-user daily generation limit — shared constants and admin helpers.
 *
 * Server-side enforcement lives in serverRateLimit.ts (Cloudflare KV).
 * The forms use localStorage as a display cache only — the server is the
 * source of truth via GET /api/generation-limit.
 */

export const FREE_DAILY_LIMIT = 3;

/**
 * Admin user IDs — used for cost display visibility and future admin features.
 * Admins are subject to the same daily generation limit as everyone else.
 *
 * TODO: George — replace these with your production Clerk userIds
 * Find at: Clerk Dashboard → Users → click your account → user ID at top
 */
export const ADMIN_USER_IDS: readonly string[] = [
  'user_3C34WAUmVRoHvKiyhYSNrMt4dvT',
];

/** Is this user an admin? (used for cost visibility, not rate limit bypass) */
export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return ADMIN_USER_IDS.includes(userId);
}
