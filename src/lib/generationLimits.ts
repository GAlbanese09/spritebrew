/**
 * Auth-side allowlists for the generation pipeline: SpriteBrew admins
 * (queue-path routing + free-tier cap bypass + cost visibility) and
 * queue-path beta cohorts (routing-only opt-in, no admin privileges).
 * Also houses the legacy FREE_DAILY_LIMIT constant, used solely by the
 * @deprecated serverRateLimit.ts; safe to retire once that helper is gone.
 */

export const FREE_DAILY_LIMIT = 3;

/**
 * Admin user IDs — grants ALL admin privileges (queue-path routing,
 * free-tier lifetime cap bypass at /api/generate, ~$cost visibility on
 * the GenerationForm). Add users sparingly; non-admin routing-only opt-in
 * lives in QUEUE_BETA_USER_IDS below.
 */
export const ADMIN_USER_IDS: readonly string[] = [
  'user_3C34WAUmVRoHvKiyhYSNrMt4dvT', // George (Clerk Production)
  'user_3BtzTR8gHfGDiNXd1G8WFLQvEf2', // George (Clerk Development — for dev-env queue-kickoff smoke testing)
];

/** Is this user a SpriteBrew admin? Grants: queue-path routing, free-tier cap bypass, cost visibility. NOT for routing-only beta cohorts — use isQueueBetaUser for those. */
export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return ADMIN_USER_IDS.includes(userId);
}

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
