/**
 * Auth-side allowlist for the generation pipeline: queue-path beta cohorts
 * (routing-only opt-in, no admin privileges). SpriteBrew admins are read
 * server-side from the ADMIN_USER_IDS secret (src/lib/adminIds.ts).
 * Also houses the legacy FREE_DAILY_LIMIT constant, used solely by the
 * @deprecated serverRateLimit.ts; safe to retire once that helper is gone.
 */

export const FREE_DAILY_LIMIT = 3;

/**
 * Queue-path beta testers. Users in this list route to the NEW queue-and-poll
 * path even when QUEUE_KICKOFF_ENABLED='false', but get NO other admin
 * privileges (no cap bypass, no cost visibility, normal counter increments).
 * Use for staged rollout cohorts. See Confluence 87490562 §14.
 *
 * Add users as separate commits to keep cohort changes auditable and rollback-safe.
 */
export const QUEUE_BETA_USER_IDS: readonly string[] = [
  // Intentionally empty in this commit. Day-2 staging users added in follow-up.
];

/**
 * Is this user in the queue-path beta cohort? Routing-only opt-in.
 * Does NOT grant cap bypass, cost visibility, or any admin privilege.
 */
export function isQueueBetaUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return QUEUE_BETA_USER_IDS.includes(userId);
}
