'use client';

export const runtime = 'edge';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { Show, SignInButton, useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import { TOKEN_PACKS } from '@/lib/tokenPacks';
import Button from '@/components/ui/Button';

export default function BuyTokensPage() {
  const { userId, getToken } = useAuth();
  const tokenBalance = useSpriteStore((s) => s.tokenBalance);
  const setTokenBalance = useSpriteStore((s) => s.setTokenBalance);
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch balance on mount
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/token-balance', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) setTokenBalance(data.balance);
      } catch { /* */ }
    })();
  }, [userId, getToken, setTokenBalance]);

  const handleBuy = useCallback(async (packId: string) => {
    setLoadingPack(packId);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to create checkout session.');
        return;
      }
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoadingPack(null);
    }
  }, [getToken]);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Get More Tokens</h1>
        <p className="text-sm font-mono text-text-secondary">
          Token packs never expire. Use them anytime.
        </p>
      </div>

      {/* Signed-out gate */}
      <Show when="signed-out">
        <div className="max-w-md mx-auto rounded-lg border-2 border-accent-amber/40 bg-bg-surface p-10 text-center">
          <p className="text-sm font-mono text-text-secondary mb-4">
            Sign in to purchase token packs.
          </p>
          <SignInButton mode="modal">
            <button className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md
              bg-accent-amber text-bg-primary text-sm font-mono font-semibold
              hover:bg-accent-amber-strong cursor-pointer transition-colors">
              <LogIn size={16} />
              Sign In
            </button>
          </SignInButton>
        </div>
      </Show>

      <Show when="signed-in">
        {/* Current balance */}
        <div className="rounded-lg border border-border-default bg-bg-surface px-5 py-4">
          <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-1">Current Balance</p>
          <p className="text-lg font-mono text-accent-amber">
            🪙 {tokenBalance} tokens
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
            <p className="text-xs font-mono text-red-400">{error}</p>
          </div>
        )}

        {/* Pack grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TOKEN_PACKS.map((pack) => {
            const perToken = (pack.priceInCents / 100 / pack.tokens).toFixed(4);
            const isLoading = loadingPack === pack.id;

            return (
              <div
                key={pack.id}
                className={`relative rounded-lg border bg-bg-surface p-5 transition-all ${
                  pack.popular
                    ? 'border-accent-amber glow-amber'
                    : 'border-border-default hover:border-border-strong'
                }`}
              >
                {pack.popular && (
                  <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded text-[9px] font-mono font-semibold
                    bg-accent-amber text-bg-primary uppercase tracking-wider">
                    Most Popular
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-mono font-semibold text-text-primary">{pack.name}</h3>
                    <p className="text-lg font-mono text-accent-amber mt-1">
                      🪙 {pack.tokens.toLocaleString()} tokens
                    </p>
                    {pack.bonus && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded text-[9px] font-mono font-semibold
                        bg-green-500/20 text-green-400 border border-green-500/30">
                        {pack.bonus} bonus
                      </span>
                    )}
                  </div>

                  <div>
                    <p className="text-lg font-mono text-text-primary">{pack.priceDisplay}</p>
                    <p className="text-[10px] font-mono text-text-muted">${perToken}/token</p>
                  </div>

                  <Button
                    size="lg"
                    onClick={() => handleBuy(pack.id)}
                    disabled={!!loadingPack}
                    className="w-full"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Processing...
                      </>
                    ) : (
                      `Buy for ${pack.priceDisplay}`
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trust line */}
        <p className="text-center text-[10px] font-mono text-text-muted">
          Tokens never expire &middot; Secure checkout by Stripe &middot; Commercial use license included
        </p>
      </Show>
    </div>
  );
}
