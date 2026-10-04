// Daily-login reward endpoint. Called from the Generate page on mount.
//
// In one round-trip we:
//   1. Grant the daily-login reward via checkAndGrantDailyReward(), which
//      handles the streak update + every-7-days doubled bonus.
//   2. Consume the unacknowledged signup-bonus modal (if any): this reads
//      `signup_grant:{userId}` and marks `signup_bonus_modal_shown:{userId}`.
// Returns a single `rewards` array so the client can fire the modal queue
// without making a second call.
//
// Release 2 (n1-release-2-spec.md revision 9, 6.2): the reward is one D1
// movement, and only `applied` shows a reward. Its errors surface as a 500
// (the client shows nothing then). The pause read stays: while paused
// neither step runs, so the signup celebration is not marked shown for an
// account that cannot be opened (`L2 001` section 2 item 1). Release 2 writes
// no admission record.

export const runtime = 'edge';

import { getAuthedUserId } from '@/lib/edgeAuth';
import { consumeSignupGrant, getTokenBalance, hasClaimedEmailList } from '@/lib/tokenBalance';
import { checkAndGrantDailyReward, getStreakSnapshot, type DailyRewardOutcome } from '@/lib/dailyReward';
import { isMoneyPaused, MoneyPausedError, UPDATING_MESSAGE } from '@/lib/moneyPause';

export type RewardPayload =
  | { type: 'signup'; amount: number }
  | { type: 'early_adopter'; amount: number }
  | { type: 'daily_login'; amount: number; streakDay: number }
  | { type: 'streak_bonus'; amount: number; streakDay: number };

interface DailyRewardResponse {
  success: true;
  rewards: RewardPayload[];
  balance: number;
  streak: { count: number; lifetimeMax: number };
  emailListClaimed: boolean;
  paused?: true;
}

function line(userId: string, outcome: string, rewardKey?: string): void {
  console.log(JSON.stringify({ source: 'daily-reward', user_id: userId, reward_key: rewardKey ?? null, outcome }));
}

export async function POST(request: Request): Promise<Response> {
  const auth = await getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const rewards: RewardPayload[] = [];

  // The fail-closed pause read (6.2): paused, neither step runs.
  let daily: DailyRewardOutcome | null = null;
  if (!(await isMoneyPaused())) {
    daily = await checkAndGrantDailyReward(userId);
    if (daily.kind === 'error') {
      line(userId, `reward error (${daily.movement ?? 'read'})`, daily.rewardKey);
      return Response.json({ success: false, error: 'reward_unconfirmed' }, { status: 500 });
    }
  }
  const paused = daily === null || daily.kind === 'paused';

  if (!paused) {
    // The signup-bonus celebration (one-shot).
    try {
      const signup = await consumeSignupGrant(userId);
      if (signup && signup.amount > 0) {
        rewards.push({
          type: signup.source === 'early_adopter' ? 'early_adopter' : 'signup',
          amount: signup.amount,
        });
      }
    } catch { /* non-fatal */ }
  }
  if (daily?.kind === 'applied') {
    rewards.push({
      type: daily.reward.isStreakBonus ? 'streak_bonus' : 'daily_login',
      amount: daily.reward.granted,
      streakDay: daily.reward.streakDay,
    });
  }

  let balance: number;
  try {
    balance = await getTokenBalance(userId);
  } catch (err) {
    if (err instanceof MoneyPausedError) {
      line(userId, 'paused (no balance to open)', daily?.rewardKey);
      return Response.json({ success: false, error: UPDATING_MESSAGE, paused: true }, { status: 503 });
    }
    line(userId, 'balance unavailable', daily?.rewardKey);
    return Response.json({ success: false, error: 'balance_unavailable' }, { status: 500 });
  }
  const streak = await getStreakSnapshot(userId);
  const emailListClaimed = await hasClaimedEmailList(userId);

  line(userId, paused ? 'paused' : daily?.kind ?? 'paused', daily?.rewardKey);
  const body: DailyRewardResponse = {
    success: true,
    rewards,
    balance,
    streak: { count: streak.count, lifetimeMax: streak.lifetimeMax },
    emailListClaimed,
    ...(paused ? { paused: true as const } : {}),
  };
  return Response.json(body);
}
