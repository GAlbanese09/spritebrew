'use client';

import { useEffect, useState } from 'react';
import { useSpriteStore, type PendingReward } from '@/stores/spriteStore';
import CoinIcon from './CoinIcon';
import FlameIcon from './FlameIcon';

const AUTO_DISMISS_MS = 5000;

/**
 * Mounted globally in AppShell. Watches the pendingRewards queue and shows
 * one modal at a time, advancing through the queue as each is dismissed.
 *
 * Tonight: clean baseline animation (S16 Part 2 will polish further).
 */
export default function RewardModal() {
  const pendingRewards = useSpriteStore((s) => s.pendingRewards);
  const dequeueReward = useSpriteStore((s) => s.dequeueReward);
  const [current, setCurrent] = useState<PendingReward | null>(null);

  // When the queue has work and nothing is showing, pull the next reward.
  useEffect(() => {
    if (!current && pendingRewards.length > 0) {
      const next = dequeueReward();
      if (next) setCurrent(next);
    }
  }, [pendingRewards, current, dequeueReward]);

  // Auto-dismiss timer. Resets per reward.
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;

  const copy = getRewardCopy(current);
  const handleDismiss = () => setCurrent(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reward-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        backgroundColor: 'rgba(20, 12, 4, 0.6)',
        animation: 'rewardBackdropFadeIn 220ms ease-out',
      }}
      onClick={handleDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-sm w-[90%] rounded-xl border-2 border-accent-amber bg-bg-surface px-6 py-7 text-center shadow-2xl"
        style={{
          animation: 'rewardCardPopIn 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          boxShadow: '0 0 40px rgba(212, 135, 28, 0.35), 0 8px 32px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Coin */}
        <div
          className="mx-auto mb-4 flex items-center justify-center"
          style={{ animation: 'rewardCoinBounce 700ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        >
          <CoinIcon size={72} />
        </div>

        {/* +amount */}
        <p
          id="reward-modal-title"
          className="font-display text-accent-amber leading-tight mb-3"
          style={{
            fontSize: '22px',
            animation: 'rewardAmountGlow 1.6s ease-in-out infinite',
          }}
        >
          +{current.amount}
        </p>

        {/* Headline + sub */}
        <h2 className="text-sm font-mono font-semibold text-text-primary mb-2">
          {copy.headline}
        </h2>
        <p className="text-xs font-mono text-text-secondary leading-relaxed mb-5 flex items-center justify-center gap-1.5 flex-wrap">
          {copy.beforeFlame && <span>{copy.beforeFlame}</span>}
          {copy.flame && <FlameIcon size={14} />}
          {copy.afterFlame && <span>{copy.afterFlame}</span>}
          {!copy.flame && copy.body && <span>{copy.body}</span>}
        </p>

        <button
          type="button"
          onClick={handleDismiss}
          className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-md
            bg-accent-amber text-bg-primary text-xs font-mono font-semibold
            hover:bg-accent-amber-strong cursor-pointer transition-colors"
        >
          Awesome, let me brew →
        </button>
      </div>
    </div>
  );
}

interface RewardCopy {
  headline: string;
  body?: string;
  flame?: boolean;
  beforeFlame?: string;
  afterFlame?: string;
}

function getRewardCopy(r: PendingReward): RewardCopy {
  switch (r.type) {
    case 'signup':
      return {
        headline: 'Welcome to SpriteBrew!',
        body: `Here's ${r.amount} tokens to get you brewing. 🍺`,
      };
    case 'early_adopter':
      return {
        headline: 'Early Adopter Bonus',
        body: `Thanks for sticking around. ${r.amount} tokens, on the house.`,
      };
    case 'email_list':
      return {
        headline: 'Newsletter signup confirmed!',
        body: `+${r.amount} tokens. Updates inbound — we don't spam. 📬`,
      };
    case 'daily_login':
      return {
        headline: `Day ${r.streakDay} of your streak!`,
        flame: true,
        beforeFlame: `+${r.amount} tokens.`,
        afterFlame: `Come back tomorrow to keep it alive.`,
      };
    case 'streak_bonus':
      return {
        headline: `${r.streakDay}-DAY STREAK!`,
        flame: true,
        beforeFlame: 'Bonus',
        afterFlame: `+${r.amount} tokens.`,
      };
  }
}
