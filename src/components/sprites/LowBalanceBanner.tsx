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
 * -023; rules in src/lib/lowBalance.ts). It reads the balance once for the
 * signed-in account, for its hasPaid (has-paid 001) and a fresh balance, then
 * follows the store's balance, which both forms refresh after every job. It
 * sits inside the page's signed-in Show, so it renders only in the browser.
 */
export default function LowBalanceBanner() {
  const { userId, getToken } = useAuth();
  const tokenBalance = useSpriteStore((s) => s.tokenBalance);
  const setTokenBalance = useSpriteStore((s) => s.setTokenBalance);

  // This account's hasPaid, once its balance read has answered.
  const [read, setRead] = useState<{ userId: string; hasPaid: boolean } | null>(null);
  // This account's dismissal: its kept "Not now", or a return from Checkout
  // for this page view, whose tokens may still be on their way. The page's
  // query is read here, at mount, before the purchase banner's effect
  // rewrites the URL.
  const [dismissUser, setDismissUser] = useState(userId);
  const [dismissed, setDismissed] = useState(() =>
    initialDismissed(readDismissed(userId), typeof window === 'undefined' ? '' : window.location.search)
  );

  if (dismissUser !== userId) {
    setDismissUser(userId);
    setDismissed(readDismissed(userId));
  }

  // The balance this banner may act on: the store's, once this account's
  // own read has answered, so neither the store's starting 0 nor another
  // account's cached balance shows it.
  const balance = read && read.userId === userId ? tokenBalance : null;

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
    void (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/token-balance', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.success || typeof data.balance !== 'number') return;
        setTokenBalance(data.balance);
        setRead({ userId, hasPaid: data.hasPaid === true });
      } catch { /* no banner without a read */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, getToken, setTokenBalance]);

  const hasPaid = read !== null && read.userId === userId && read.hasPaid;
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
