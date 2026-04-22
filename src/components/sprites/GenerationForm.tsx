'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Sparkles, X, Check, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import {
  GENERATION_STYLES,
  getStyleById,
  getTierLabel,
  type GenerationStyle,
  type StyleCategory,
} from '@/lib/styleRegistry';
import { isAdminUser } from '@/lib/generationLimits';

const EXAMPLE_PROMPTS = [
  'pixel art knight with sword',
  'small goblin with wooden club',
  'wizard with blue robe and staff',
  'skeleton warrior with shield',
  'cute slime monster',
  'robot with laser gun',
];

const CATEGORY_LABELS: Record<StyleCategory, string> = {
  characters: 'Characters',
  items: 'Items',
  animations: 'Animations',
  tiles: 'Tiles',
  ui: 'UI',
  environments: 'Environments',
};

// Group styles by category for the picker
const GROUPED_STYLES = (() => {
  const groups: Partial<Record<StyleCategory, GenerationStyle[]>> = {};
  for (const style of GENERATION_STYLES) {
    (groups[style.category] ??= []).push(style);
  }
  return groups;
})();

const TIER_COLORS: Record<string, string> = {
  pro: 'text-purple-400 border-purple-400/30',
  plus: 'text-accent-amber border-accent-amber/30',
  fast: 'text-green-400 border-green-400/30',
  animation: 'text-accent-teal border-accent-teal/30',
};

interface GenerationFormProps {
  onGenerated: (imageUrl: string, prompt: string, style: string) => void;
}

export default function GenerationForm({ onGenerated }: GenerationFormProps) {
  const { userId, getToken } = useAuth();
  const setGenerating = useSpriteStore((s) => s.setGenerating);
  const setGeneratingAction = useSpriteStore((s) => s.setGeneratingAction);
  const setGenerationError = useSpriteStore((s) => s.setGenerationError);
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setTokenBalance = useSpriteStore((s) => s.setTokenBalance);
  const tokenBalance = useSpriteStore((s) => s.tokenBalance);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generationError = useSpriteStore((s) => s.generationError);

  // Fetch token balance from server
  const fetchBalance = useCallback(async () => {
    if (!userId) return;
    try {
      const token = await getToken();
      const res = await fetch('/api/token-balance', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setTokenBalance(data.balance);
        try {
          localStorage.setItem(`spritebrew_tokens_${userId}`, String(data.balance));
        } catch { /* localStorage unavailable */ }
      }
    } catch { /* network error — keep cached value */ }
  }, [userId, getToken, setTokenBalance]);

  // On mount: show cached balance immediately, then fetch server truth
  useEffect(() => {
    if (userId) {
      try {
        const cached = localStorage.getItem(`spritebrew_tokens_${userId}`);
        if (cached) setTokenBalance(parseInt(cached, 10));
      } catch { /* ignore */ }
      fetchBalance();
    }
  }, [userId, setTokenBalance, fetchBalance]);

  const isAdmin = isAdminUser(userId);

  const [prompt, setPrompt] = useState('');
  const [selectedStyleId, setSelectedStyleId] = useState('plus-classic');
  const [customWidth, setCustomWidth] = useState(128);
  const [customHeight, setCustomHeight] = useState(128);
  const [removeBg, setRemoveBg] = useState(true);

  const selectedStyle = useMemo(
    () => getStyleById(selectedStyleId) ?? GENERATION_STYLES[0],
    [selectedStyleId]
  );

  const tokenCost = selectedStyle.tokenCost;
  const insufficientTokens = tokenBalance < tokenCost;
  const tokensNeeded = tokenCost - tokenBalance;

  // Update dimensions when style changes
  useEffect(() => {
    setCustomWidth(selectedStyle.defaultWidth);
    setCustomHeight(selectedStyle.defaultHeight);
    // Default remove_bg: on for character/item styles, off for tiles/spritesheets
    setRemoveBg(selectedStyle.supportsRemoveBg && selectedStyle.category !== 'tiles');
  }, [selectedStyle]);

  const effectiveWidth = selectedStyle.fixedSize ? selectedStyle.defaultWidth : customWidth;
  const effectiveHeight = selectedStyle.fixedSize ? selectedStyle.defaultHeight : customHeight;

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    setGenerating(true);
    setGeneratingAction(null);
    setGenerationError(null);

    try {
      const body: Record<string, unknown> = {
        prompt: prompt.trim(),
        promptStyle: selectedStyle.promptStyle,
        width: effectiveWidth,
        height: effectiveHeight,
      };

      if (removeBg && selectedStyle.supportsRemoveBg) {
        body.removeBg = true;
      }

      const sessionToken = await getToken();
      const { fetchGenerationSSE } = await import('@/lib/sseClient');
      const data = await fetchGenerationSSE(body, sessionToken);

      if (!data.success) {
        setGenerationError(String(data.error ?? 'Generation failed — try a different prompt.'));
        return;
      }

      // RD returns data URLs directly — no URL-to-blob conversion needed
      const dataUrl = data.imageUrl!;

      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(selectedStyleId);
      // Refresh token balance from server (tokens were already debited server-side)
      await fetchBalance();
      onGenerated(dataUrl, prompt.trim(), selectedStyleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const errObj = err as Error & { balance?: number; required?: number };
      if (errObj.balance !== undefined && errObj.required !== undefined) {
        setGenerationError(
          `You need ${errObj.required} tokens for this style, but you have ${errObj.balance}. Try a cheaper style or buy more tokens!`
        );
        setTokenBalance(errObj.balance);
        return;
      }
      setGenerationError(`Connection failed — ${msg}`);
    } finally {
      setGenerating(false);
      setGeneratingAction(null);
    }
  }, [
    prompt, selectedStyle, selectedStyleId, effectiveWidth, effectiveHeight,
    removeBg, isGenerating, tokenCost, getToken, setGenerating, setGeneratingAction,
    setGenerationError, setGeneratedImage, setGenerationStyle, setTokenBalance, fetchBalance, onGenerated,
  ]);

  return (
    <div className="space-y-6">
      {/* Prompt */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          {selectedStyle.isAnimation ? 'Describe the character to animate' : 'Describe what to generate'}
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            selectedStyle.isAnimation
              ? "Describe the character. Keep it simple — 'knight with sword', 'goblin with club'."
              : "Describe what you want to generate. Be specific about style and details."
          }
          rows={3}
          className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3
            text-sm font-mono text-text-primary placeholder:text-text-muted resize-none
            focus:outline-none focus:border-accent-amber"
        />
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="px-2.5 py-1 rounded text-[10px] font-mono bg-bg-elevated text-text-muted
                border border-border-subtle hover:bg-bg-hover hover:text-text-secondary cursor-pointer
                transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Style picker — grouped by category */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Style
          <span className="text-text-muted font-normal ml-2">
            ({GENERATION_STYLES.length} styles across {Object.keys(GROUPED_STYLES).length} categories)
          </span>
        </label>
        <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
          {(Object.entries(GROUPED_STYLES) as [StyleCategory, GenerationStyle[]][]).map(
            ([category, styles]) => (
              <div key={category}>
                <p className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-1.5">
                  {CATEGORY_LABELS[category]}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {styles.map((style) => {
                    const active = selectedStyleId === style.id;
                    return (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStyleId(style.id)}
                        className={`text-left rounded-lg border px-3 py-2 transition-all duration-150 cursor-pointer
                          ${active
                            ? 'border-accent-amber bg-accent-amber-glow'
                            : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                          }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <h3 className={`text-[11px] font-mono font-semibold truncate ${active ? 'text-accent-amber' : 'text-text-primary'}`}>
                            {style.label}
                          </h3>
                          {active && <Check size={10} className="text-accent-amber flex-shrink-0" />}
                          <span className={`ml-auto text-[8px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${TIER_COLORS[style.tier] ?? 'text-text-muted border-border-subtle'}`}>
                            {getTierLabel(style.tier)}
                          </span>
                        </div>
                        <p className="text-[9px] font-mono text-text-muted mt-0.5 truncate">
                          {style.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
        <p className="text-[9px] font-mono text-text-muted mt-2">
          For animating an existing character, use the Animate My Character tab.
        </p>
      </div>

      {/* Size controls — only if not fixed */}
      <div>
        <label className="block text-[10px] font-mono text-text-muted mb-1">
          Size: {effectiveWidth}x{effectiveHeight}
          {selectedStyle.fixedSize && (
            <span className="ml-2 text-text-muted/60">(fixed for this style)</span>
          )}
        </label>
        {!selectedStyle.fixedSize ? (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[9px] font-mono text-text-muted mb-1">Width</label>
              <input
                type="number"
                min={selectedStyle.minSize}
                max={selectedStyle.maxSize}
                value={customWidth}
                onChange={(e) => setCustomWidth(Math.max(selectedStyle.minSize, Math.min(selectedStyle.maxSize, Number(e.target.value))))}
                className="w-full rounded bg-bg-elevated border border-border-default px-3 py-1.5
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[9px] font-mono text-text-muted mb-1">Height</label>
              <input
                type="number"
                min={selectedStyle.minSize}
                max={selectedStyle.maxSize}
                value={customHeight}
                onChange={(e) => setCustomHeight(Math.max(selectedStyle.minSize, Math.min(selectedStyle.maxSize, Number(e.target.value))))}
                className="w-full rounded bg-bg-elevated border border-border-default px-3 py-1.5
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
            </div>
          </div>
        ) : (
          <p className="text-[9px] font-mono text-text-muted">
            This style uses fixed {effectiveWidth}x{effectiveHeight} dimensions.
          </p>
        )}
      </div>

      {/* Remove Background toggle */}
      {selectedStyle.supportsRemoveBg && (
        <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={removeBg}
            onChange={(e) => setRemoveBg(e.target.checked)}
            className="accent-[var(--accent-amber)] cursor-pointer"
          />
          Remove background (transparent output)
        </label>
      )}

      {/* Error */}
      {generationError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-red-400">
            {generationError.includes('buy more tokens') ? (
              <>
                {generationError.replace('buy more tokens!', '')}
                <Link href="/buy-tokens" className="underline hover:text-red-300">buy more tokens</Link>!
              </>
            ) : generationError}
          </p>
          <button
            onClick={() => setGenerationError(null)}
            className="ml-auto text-red-400 hover:text-red-300 cursor-pointer flex-shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Generate button */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-text-muted">
          {effectiveWidth}x{effectiveHeight}px &middot; {tokenCost} tokens
          {isAdmin && (
            <span> &middot; ~${selectedStyle.costPerGeneration.toFixed(2)}</span>
          )}
          {userId && (
            <span className={`ml-2 ${insufficientTokens ? 'text-red-400' : 'text-accent-amber'}`}>
              &middot; Balance: {tokenBalance} 🪙
            </span>
          )}
        </p>
        <Button
          size="lg"
          onClick={handleGenerate}
          disabled={!prompt.trim() || isGenerating || insufficientTokens}
          className={!isGenerating && prompt.trim() && !insufficientTokens ? 'animate-pulse' : ''}
          title={insufficientTokens ? `Need ${tokensNeeded} more tokens` : undefined}
        >
          {isGenerating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Brewing...
            </>
          ) : insufficientTokens ? (
            <>
              <Sparkles size={16} />
              Need {tokensNeeded} more 🪙
            </>
          ) : (
            <>
              <Sparkles size={16} />
              {selectedStyle.isAnimation ? 'Generate Animation' : 'Generate Sprite'} ({tokenCost} 🪙)
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
