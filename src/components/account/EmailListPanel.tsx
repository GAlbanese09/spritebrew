'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, Check, AlertCircle } from 'lucide-react';
import { useAuth, useUser } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import { EMAIL_LIST_BONUS_TOKENS } from '@/lib/constants';

interface EmailListPanelProps {
  /** 'full' = card-style on /buy-tokens. 'compact' = inline pill for the sidebar. */
  variant?: 'full' | 'compact';
}

/**
 * Newsletter signup CTA. Earn-back panel — POSTs to /api/account/email-list
 * which adds the user's primary email (read from Clerk server-side) to the
 * Resend audience and credits EMAIL_LIST_BONUS_TOKENS.
 *
 * Hides itself entirely once the user has claimed (server is the source of
 * truth via the daily-reward endpoint that hydrates `emailListClaimed`).
 */
export default function EmailListPanel({ variant = 'full' }: EmailListPanelProps) {
  const { userId, getToken } = useAuth();
  const { user } = useUser();
  const emailListClaimed = useSpriteStore((s) => s.emailListClaimed);
  const setEmailListClaimed = useSpriteStore((s) => s.setEmailListClaimed);
  const setTokenBalance = useSpriteStore((s) => s.setTokenBalance);
  const enqueueRewards = useSpriteStore((s) => s.enqueueRewards);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For users who land on /buy-tokens without going through Generate first,
  // hydrate the claim flag silently from the daily-reward endpoint.
  useEffect(() => {
    if (!userId) return;
    if (emailListClaimed) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch('/api/account/daily-reward', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.success && typeof data.emailListClaimed === 'boolean') {
          setEmailListClaimed(data.emailListClaimed);
          if (typeof data.balance === 'number') setTokenBalance(data.balance);
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [userId, emailListClaimed, getToken, setEmailListClaimed, setTokenBalance]);

  const handleSubscribe = useCallback(async () => {
    if (!userId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Sign-in required.');
        return;
      }
      const res = await fetch('/api/account/email-list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subscribe: true }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error ?? 'Subscription failed. Try again.');
        return;
      }
      // Already-claimed path: just hide the panel silently.
      if (data.alreadyClaimed) {
        setEmailListClaimed(true);
        return;
      }
      // Newly granted: hide panel, push reward, update balance.
      setEmailListClaimed(true);
      if (typeof data.balance === 'number') setTokenBalance(data.balance);
      enqueueRewards([{ type: 'email_list', amount: data.granted ?? EMAIL_LIST_BONUS_TOKENS }]);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [userId, submitting, getToken, setEmailListClaimed, setTokenBalance, enqueueRewards]);

  if (!userId || emailListClaimed) return null;

  const email = user?.primaryEmailAddress?.emailAddress ?? '';

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleSubscribe}
        disabled={submitting}
        className="w-full mt-2 inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded
          border border-accent-amber/30 bg-accent-amber-glow text-[10px] font-mono
          text-accent-amber hover:bg-accent-amber/20 transition-colors cursor-pointer
          disabled:cursor-wait disabled:opacity-60"
        title="Subscribe to the SpriteBrew newsletter and earn 5 tokens"
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <Mail size={11} />
          {submitting ? 'Subscribing…' : 'Newsletter'}
        </span>
        <span className="font-semibold">+{EMAIL_LIST_BONUS_TOKENS} 🪙</span>
      </button>
    );
  }

  // Full panel
  return (
    <div className="rounded-lg border border-accent-amber/40 bg-accent-amber-glow px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-md bg-accent-amber/20 flex items-center justify-center">
          <Mail size={16} className="text-accent-amber" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-mono font-semibold text-accent-amber">
            Join the SpriteBrew newsletter — get {EMAIL_LIST_BONUS_TOKENS} tokens
          </h3>
          <p className="text-xs font-mono text-text-secondary mt-0.5">
            Product updates, new styles, launch news. We don&apos;t spam.
          </p>
          {email && (
            <div className="mt-3">
              <input
                type="email"
                value={email}
                readOnly
                aria-label="Your email address (locked to your account)"
                className="w-full rounded bg-bg-elevated border border-border-subtle px-3 py-2
                  text-xs font-mono text-text-primary cursor-not-allowed"
              />
              <p className="text-[10px] font-mono text-text-muted mt-1">
                Locked to your account email — bonus credits this address only.
              </p>
            </div>
          )}
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] font-mono text-red-400">{error}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleSubscribe}
            disabled={submitting || !email}
            className="mt-3 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md
              bg-accent-amber text-bg-primary text-xs font-mono font-semibold
              hover:bg-accent-amber-strong cursor-pointer transition-colors
              disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? (
              <><Loader2 size={14} className="animate-spin" /> Subscribing…</>
            ) : (
              <><Check size={14} /> Subscribe & claim {EMAIL_LIST_BONUS_TOKENS} tokens</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
