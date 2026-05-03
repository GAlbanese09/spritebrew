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
}

export async function POST(request: Request): Promise<Response> {
  const auth = getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const rewards: RewardPayload[] = [];

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

  const balance = await getTokenBalance(userId);
  const streak = await getStreakSnapshot(userId);
  const emailListClaimed = await hasClaimedEmailList(userId);

  const body: DailyRewardResponse = {
    success: true,
    rewards,
    balance,
    streak: { count: streak.count, lifetimeMax: streak.lifetimeMax },
    emailListClaimed,
  };
  return Response.json(body);
}
