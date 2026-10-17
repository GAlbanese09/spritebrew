import { useSpriteStore, type PendingReward } from '@/stores/spriteStore';
import { createDailyRewardClaimer } from '@/lib/dailyRewardClaim';

// The app's one daily-reward claimer (see dailyRewardClaim.ts). It lives for
// the page load, so remounts and the second caller share the first attempt.
const claimer = createDailyRewardClaimer({
  post: (token) =>
    fetch('/api/account/daily-reward', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
  apply: (data) => {
    const s = useSpriteStore.getState();
    if (data.streak) s.setStreak(data.streak.count, data.streak.lifetimeMax);
    if (typeof data.balance === 'number') s.setTokenBalance(data.balance);
    if (typeof data.emailListClaimed === 'boolean') s.setEmailListClaimed(data.emailListClaimed);
    if (Array.isArray(data.rewards) && data.rewards.length > 0) {
      s.enqueueRewards(data.rewards as Omit<PendingReward, 'id'>[]);
    }
  },
});

/** Claims today's reward for this user, at most one attempt per page load;
 *  see dailyRewardClaim.ts. */
export function claimDailyRewardOnce(
  userId: string,
  getToken: () => Promise<string | null>
): Promise<void> {
  return claimer.claimOnce(userId, getToken);
}

/** Call on sign-out, before signOut() settles: this account's claim that has
 *  not been sent is never sent, and its late answer is not applied. Another
 *  account still gets its own attempt; this one waits for a full page load. */
export function resetDailyRewardClaim(): void {
  claimer.reset();
}
