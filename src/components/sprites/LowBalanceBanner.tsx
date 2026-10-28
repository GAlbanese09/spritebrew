'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import {
  LOW_BALANCE_BUTTON,
  LOW_BALANCE_DISMISS,
  dismissedAfter,
  initialDismissed,
  lowBalanceDismissKey,
  lowBalanceLine,
  showLowBalance,
} from '@/lib/lowBalance';

function readDismissed(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(lowBalanceDismissKey(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * The low-balance banner on /generate (HQ 2026-10-27-021, George's words in
 * -023; rules in src/lib/lowBalance.ts). It reads the balance once for each
 * visit of a signed-in account, for its hasPaid (has-paid 001) and a fresh
 * balance, then follows the store's balance from the server, which both forms
 * refresh after every job; this device's cached copy, which the Sidebar and
 * the forms show at mount, never drives it. Its read is published to the
 * store only if no newer balance was published while it was in flight
 * (Second 099). It sits inside the page's signed-in Show, so it renders only
 * in the browser.
 */
export default function LowBalanceBanner() {
  const { userId, getToken } = useAuth();
  const serverTokenBalance = useSpriteStore((s) => s.serverTokenBalance);
  const setTokenBalanceIfUnchanged = useSpriteStore((s) => s.setTokenBalanceIfUnchanged);

  // This account visit's hasPaid, once its own balance read has answered.
  const [read, setRead] = useState<{ userId: string; hasPaid: boolean } | null>(null);
  // This account's dismissal: its kept "Not now", or a return from Checkout
  // for this page view, whose tokens may still be on their way. The page's
  // query is read here, at mount, before the purchase banner's effect
  // rewrites the URL.
  const [dismissUser, setDismissUser] = useState(userId);
  const [dismissed, setDismissed] = useState(() =>
    initialDismissed(readDismissed(userId), typeof window === 'undefined' ? '' : window.location.search)
  );

  // A change of account starts a new visit: that account's kept dismissal,
  // and no read until this visit's own read answers, so a read from an
  // earlier visit, even of the same account, never lets the store's balance
  // act for it (Second 099). This pass acts on nothing; React renders again
  // at once.
  const accountChanged = dismissUser !== userId;
  if (accountChanged) {
    setDismissUser(userId);
    setDismissed(readDismissed(userId));
    setRead(null);
  }

  // The balance this banner may act on: the store's balance from the server,
  // once this visit's own read has answered, so neither the store's starting
  // 0, nor a cached copy, nor another account's balance shows it.
  const visitRead = !accountChanged && read !== null && read.userId === userId ? read : null;
  const balance = visitRead ? serverTokenBalance : null;

  // A dismissal lasts until the balance is seen at or above the threshold.
  const stillDismissed = dismissedAfter(dismissed, balance);
  if (stillDismissed !== dismissed) {
    setDismissed(stillDismissed);
  }

  useEffect(() => {
    if (!userId || dismissed) return;
    try {
      localStorage.removeItem(lowBalanceDismissKey(userId));
    } catch { /* storage unavailable; the dismissal was never kept */ }
  }, [userId, dismissed]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // The store's balance version as this read begins: its answer is
    // published only if no balance was published meanwhile (a job's
    // refresh, the purchase watcher), so it never replaces a newer one.
    const startVersion = useSpriteStore.getState().tokenBalanceVersion;
    void (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/token-balance', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.success || typeof data.balance !== 'number') return;
        setTokenBalanceIfUnchanged(data.balance, startVersion);
        setRead({ userId, hasPaid: data.hasPaid === true });
      } catch { /* no banner without a read */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, getToken, setTokenBalanceIfUnchanged]);

  const hasPaid = visitRead !== null && visitRead.hasPaid;
  if (!showLowBalance({ hasPaid, balance, dismissed }) || balance === null || !userId) return null;

  const dismiss = (): void => {
    try {
      localStorage.setItem(lowBalanceDismissKey(userId), '1');
    } catch { /* kept for this page view only */ }
    setDismissed(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-amber/40 bg-accent-amber-glow px-4 py-2.5">
      <p className="flex-1 min-w-[12rem] text-xs font-mono text-accent-amber">{lowBalanceLine(balance)}</p>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href="/buy-tokens"
          className="rounded-md bg-accent-amber px-3 py-1.5 text-xs font-mono font-semibold text-bg-primary hover:bg-accent-amber-strong transition-colors"
        >
          {LOW_BALANCE_BUTTON}
        </a>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md px-2 py-1.5 text-xs font-mono text-accent-amber/80 hover:text-accent-amber hover:bg-accent-amber/10 cursor-pointer"
        >
          {LOW_BALANCE_DISMISS}
        </button>
      </div>
    </div>
  );
}
