// One daily-reward claim per page load, shared by every caller.
//
// POST /api/account/daily-reward credits the daily login. Two components
// asked for it on every page load (the sidebar streak and the newsletter
// panel), and each asked again whenever it remounted, so one visit could send
// several concurrent claims; the server's check-then-write guard can let two
// of them both credit. This module makes one request per signed-in user per
// page load, whoever asks first, and never retries: a refusal (a 401 included)
// or an error waits for the next page load.
//
// Pure, no React and no store: the caller supplies `post` and `apply`, so the
// offline test can drive it. `apply` runs at most once per claim, and only if
// that claim is still the current one when its answer lands (a sign-out or a
// different user in the meantime drops it).

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
  /** Starts the claim for `userId` unless this page load already has one,
   *  and returns the shared promise. Never rejects. */
  claimOnce(userId: string, getToken: () => Promise<string | null>): Promise<void>;
  /** Forgets the current claim (sign-out), so a later sign-in claims again
   *  and an answer still in flight is dropped. */
  reset(): void;
}

export function createDailyRewardClaimer(deps: {
  post: (token: string) => Promise<DailyRewardResponse>;
  apply: (data: DailyRewardData) => void;
}): DailyRewardClaimer {
  let current: { userId: string; promise: Promise<void> } | null = null;

  return {
    claimOnce(userId, getToken) {
      if (current && current.userId === userId) return current.promise;
      const claim: { userId: string; promise: Promise<void> } = { userId, promise: Promise.resolve() };
      current = claim;
      claim.promise = (async () => {
        try {
          const token = await getToken();
          if (!token) return;
          const res = await deps.post(token);
          if (!res.ok) return;
          const data = (await res.json()) as DailyRewardData | null;
          if (current !== claim) return;
          if (!data || data.success !== true) return;
          deps.apply(data);
        } catch {
          // Silent, as before: the next page load tries again.
        }
      })();
      return claim.promise;
    },
    reset() {
      current = null;
    },
  };
}
