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
import { checkAndGrantDailyReward, getStreakSnapshot, type DailyRewardTrace } from '@/lib/dailyReward';
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
  // The admission line names today's key only as a candidate: the helper picks
  // its own day, so a request crossing UTC midnight credits the next day's key.
  // The end line names, from the helper, the key whose credit wrote the
  // balance (`reward_key`, null for none), and a key whose credit was tried
  // but is not known to have written (`reward_key_tried`) (Second's 040).
  const rewardKeyCandidate = `daily_login:${userId}:${new Date().toISOString().split('T')[0]}`;
  const admission = await admitMoney({
    route: 'daily_reward',
    kind: 'user',
    subject: userId,
    userId,
    ids: { user_id: userId, reward_key_candidate: rewardKeyCandidate },
  });
  let outcome = 'exception';
  const trace: DailyRewardTrace = {};
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
        const daily = await checkAndGrantDailyReward(userId, trace);
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
    // The daily credit's own status, kept beside any signup celebration in
    // the same request, so a partial credit is never folded into 'rewarded'.
    const dailyGranted = rewards.some((r) => r.type === 'daily_login' || r.type === 'streak_bonus');
    const dailyIssue = dailyGranted || !trace.rewardKey ? null
      : trace.balanceWritten ? 'reward incomplete (balance written)'
      : trace.balanceWritten === false ? 'reward failed (nothing written)'
      : 'reward uncertain';
    outcome = paused ? 'paused'
      : [rewards.length ? `rewarded (${rewards.map((r) => r.type).join(',')})` : null, dailyIssue]
        .filter(Boolean).join('; ') || 'no reward due';
    return Response.json(body);
  } finally {
    // The helper's own record of its credit, kept even when it answered null
    // after the balance write (the ruling F window, a failed streak write).
    const rewardKey = trace.balanceWritten && trace.rewardKey ? trace.rewardKey : null;
    const tried = !rewardKey && trace.rewardKey ? { reward_key_tried: trace.rewardKey } : {};
    await admission.complete(outcome, { reward_key: rewardKey, ...tried });
  }
}
