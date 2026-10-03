// Daily-login reward endpoint. Called from the Generate page on mount.
//
// In one round-trip we:
//   1. Consume the unacknowledged signup-bonus modal (if any) — this reads
//      `signup_grant:{userId}` and atomically marks `signup_bonus_modal_shown:{userId}`.
//   2. Grant the daily-login reward via checkAndGrantDailyReward(), which
//      handles the streak update + every-7-days doubled bonus.
// Returns a single `rewards` array so the client can fire the modal queue
// without making a second call.

export const runtime = 'edge';

import { getAuthedUserId } from '@/lib/edgeAuth';
import { consumeSignupGrant, getTokenBalance, hasClaimedEmailList } from '@/lib/tokenBalance';
import { checkAndGrantDailyReward, getStreakSnapshot } from '@/lib/dailyReward';
import { MoneyPausedError, UPDATING_MESSAGE } from '@/lib/moneyPause';
import { admitMoney } from '@/lib/moneyAdmission';

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

export async function POST(request: Request): Promise<Response> {
  const auth = await getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const rewards: RewardPayload[] = [];

  // While money is paused neither step runs: step 2 is a credit, and step 1
  // would mark a not-yet-opened account's celebration as shown. Both stay
  // claimable once money reopens (the daily reward on the same UTC day).
  // S0's admission record replaces the pause read (n1-release-2-spec.md 6.2,
  // R5-1): zero rows is the paused answer, and the record is completed in the
  // finally, after the reward, its streak writes and the balance read.
  const rewardKey = `daily_login:${userId}:${new Date().toISOString().split('T')[0]}`;
  const admission = await admitMoney({
    route: 'daily_reward',
    kind: 'user',
    subject: userId,
    userId,
    ids: { user_id: userId, reward_key: rewardKey },
  });
  let outcome = 'exception';
  try {
    const paused = !admission.admitted;
    if (!paused) {
      // 1. Signup-bonus celebration (one-shot)
      try {
        const signup = await consumeSignupGrant(userId);
        if (signup && signup.amount > 0) {
          rewards.push({
            type: signup.source === 'early_adopter' ? 'early_adopter' : 'signup',
            amount: signup.amount,
          });
        }
      } catch { /* non-fatal */ }

      // 2. Daily login + streak
      try {
        const daily = await checkAndGrantDailyReward(userId);
        if (daily) {
          rewards.push({
            type: daily.isStreakBonus ? 'streak_bonus' : 'daily_login',
            amount: daily.granted,
            streakDay: daily.streakDay,
          });
        }
      } catch { /* non-fatal */ }
    }

    let balance: number;
    try {
      balance = await getTokenBalance(userId);
    } catch (err) {
      if (err instanceof MoneyPausedError) {
        outcome = 'paused (no balance to open)';
        return Response.json({ success: false, error: UPDATING_MESSAGE, paused: true }, { status: 503 });
      }
      throw err;
    }
    const streak = await getStreakSnapshot(userId);
    const emailListClaimed = await hasClaimedEmailList(userId);

    const body: DailyRewardResponse = {
      success: true,
      rewards,
      balance,
      streak: { count: streak.count, lifetimeMax: streak.lifetimeMax },
      emailListClaimed,
      ...(paused ? { paused: true as const } : {}),
    };
    outcome = paused ? 'paused' : rewards.length ? `rewarded (${rewards.map((r) => r.type).join(',')})` : 'no reward due';
    return Response.json(body);
  } finally {
    await admission.complete(outcome);
  }
}
