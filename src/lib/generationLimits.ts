/**
 * Per-user daily generation limit — shared constants and admin helpers.
 *
 * Server-side enforcement lives in serverRateLimit.ts (Cloudflare KV).
 * The forms use localStorage as a display cache only — the server is the
 * source of truth via GET /api/generation-limit.
 */

export const FREE_DAILY_LIMIT = 5;

/**
 * Admin user IDs — bypass the daily generation limit.
 *
 * To find your Clerk userId: sign in on spritebrew.com, open the browser
 * console, and look for the `userId:` log printed by the Generate page.
 * Paste the value here and redeploy.
 */
export const ADMIN_USER_IDS: readonly string[] = [
  'user_3BtzTR8gHfGDiNXd1G8WFLQvEf2', // George
  'user_3Bu4G35OOLgpdDmYxtqsnoZfui2', // Admin #2
];

/** Is this user an admin with unlimited generations? */
export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return ADMIN_USER_IDS.includes(userId);
}
