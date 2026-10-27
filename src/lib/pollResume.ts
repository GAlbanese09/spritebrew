/**
 * When the generation poll (src/hooks/useGenerationPoll.ts) resumes a saved
 * job. Pure, so it is tested offline (scripts/poll-resume-test.mjs).
 */

/** A saved job from an earlier page load, older than this, is dropped. */
export const STALE_THRESHOLD_MS = 10 * 60 * 1_000;

/**
 * Whether a mounted poll hook should resume the saved job. A job saved
 * before this page loaded is from an earlier visit and is dropped once it is
 * older than STALE_THRESHOLD_MS ('drop'). A job started since is always
 * resumed, however long the user spent on other pages: the form that
 * started it is gone, and nothing else will finish it ('resume'). With
 * nothing saved: 'none'.
 */
export function resumeDecision(
  saved: { startedAt: number } | null,
  now: number,
  pageLoadedAt: number
): 'none' | 'drop' | 'resume' {
  if (!saved) return 'none';
  if (saved.startedAt < pageLoadedAt && now - saved.startedAt > STALE_THRESHOLD_MS) return 'drop';
  return 'resume';
}
