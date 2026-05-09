import { isAdminUser, isQueueBetaUser } from './generationLimits';

/**
 * Returns true if the queue-kickoff path should be used for this user.
 * Day-1 rollout: env var stays 'false' globally; admin auto-included.
 * Day-2: add staged-rollout users to QUEUE_BETA_USER_IDS in generationLimits.ts (separate from admin allowlist).
 * Day-4: flip env var to 'true' globally.
 * Day-11: delete this helper, delete the conditional in /api/generate.
 *
 * Per Confluence 87490562 §14.
 */
export function isQueueKickoffEnabled(userId: string, env: Record<string, unknown>): boolean {
  if (env.QUEUE_KICKOFF_ENABLED === 'true') return true;
  if (isAdminUser(userId)) return true;
  if (isQueueBetaUser(userId)) return true;
  return false;
}
