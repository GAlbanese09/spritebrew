// One daily-reward claim per user per page load, shared by every caller.
//
// POST /api/account/daily-reward credits the daily login. Two components
// asked for it on every page load (the sidebar streak and the newsletter
// panel), and each asked again whenever it remounted, so one visit could send
// several concurrent claims; the server's check-then-write guard can let two
// of them both credit. This module allows one attempt per signed-in user per
// page load, whoever asks first, and never makes a second: not after a
// refusal (a 401 included) or an error, not after another user's claim, and
// not after a sign-out. A fresh attempt needs a full page load.
//
// Pure, no React and no store: the caller supplies `post` and `apply`, so the
// offline test can drive it. An attempt may POST and apply only while it is
// still authorized: its user is the one the claimer last served and no
// reset() (sign-out) has happened since it started. That is checked after
// the token arrives, before the POST, and again after the answer is read.

export interface DailyRewardData {
  success?: boolean;
  streak?: { count: number; lifetimeMax: number };
  balance?: number;
  emailListClaimed?: boolean;
  rewards?: unknown[];
}

export interface DailyRewardResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export interface DailyRewardClaimer {
  /** Starts this user's one attempt for the page load, or returns the
   *  attempt already made. Never rejects. */
  claimOnce(userId: string, getToken: () => Promise<string | null>): Promise<void>;
  /** On sign-out: an attempt that has not sent its POST yet never sends it,
   *  and an answer still in flight is not applied. Does not re-arm anyone. */
  reset(): void;
}

export function createDailyRewardClaimer(deps: {
  post: (token: string) => Promise<DailyRewardResponse>;
  apply: (data: DailyRewardData) => void;
}): DailyRewardClaimer {
  // Every user's attempt this page load, kept even after it fails, after
  // another user is served and after a sign-out.
  const attempts = new Map<string, Promise<void>>();
  // The user the claimer last served, and a counter bumped by reset().
  let owner: string | null = null;
  let epoch = 0;

  return {
    claimOnce(userId, getToken) {
      owner = userId;
      const existing = attempts.get(userId);
      if (existing) return existing;
      const startedEpoch = epoch;
      const authorized = () => owner === userId && epoch === startedEpoch;
      const attempt = (async () => {
        try {
          const token = await getToken();
          if (!token || !authorized()) return;
          const res = await deps.post(token);
          if (!res.ok) return;
          const data = (await res.json()) as DailyRewardData | null;
          if (!authorized()) return;
          if (!data || data.success !== true) return;
          deps.apply(data);
        } catch {
          // Silent, as before: the next full page load tries again.
        }
      })();
      attempts.set(userId, attempt);
      return attempt;
    },
    reset() {
      owner = null;
      epoch += 1;
    },
  };
}
