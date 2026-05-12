'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Sparkles, X, Check, Loader2, AlertCircle, ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import ReferenceImagesPanel from '@/components/sprites/ReferenceImagesPanel';
import {
  GENERATION_STYLES,
  getStyleById,
  getTierLabel,
  type GenerationStyle,
  type StyleCategory,
} from '@/lib/styleRegistry';
import { isAdminUser } from '@/lib/generationLimits';
import { fetchGeneration, consumeSSEStream, type Payload } from '@/lib/sseClient';
import { useGenerationPoll } from '@/hooks/useGenerationPoll';
import { StyleExamplesLightbox } from './StyleExamplesLightbox';

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

  // Queue-and-poll integration. The hook auto-resumes a poll from
  // localStorage on mount if a fresh-enough activeJob entry exists.
  const poll = useGenerationPoll();

  // Captures click-time prompt/style so the poll-success effect can write
  // history with the right context (handleGenerated needs prompt + style).
  // Null on resume — we never have click context for a resumed job.
  const inFlightRef = useRef<{ prompt: string; styleId: string } | null>(null);

  // 1s click-debounce — guards against rapid double-clicks beyond the
  // existing isGenerating boolean (which has a one-render race window).
  const lastGenerateAtRef = useRef<number>(0);

  const [prompt, setPrompt] = useState('');
  const [selectedStyleId, setSelectedStyleId] = useState('plus-classic');
  const [customWidth, setCustomWidth] = useState(256);
  const [customHeight, setCustomHeight] = useState(256);
  const [removeBg, setRemoveBg] = useState(true);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  // Per-category collapse state — empty Set = all expanded (default).
  // Not persisted; resets per page load to keep discoverability.
  const [collapsedCategories, setCollapsedCategories] = useState<Set<StyleCategory>>(new Set());

  // Style whose examples are open in the lightbox carousel. null = closed.
  const [lightboxStyle, setLightboxStyle] = useState<GenerationStyle | null>(null);

  const toggleCategory = (category: StyleCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const selectedStyle = useMemo(
    () => getStyleById(selectedStyleId) ?? GENERATION_STYLES[0],
    [selectedStyleId]
  );

  const referencesEnabled = selectedStyle.supportsReferenceImages === true;

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

    // 1s click-debounce. Guards against rapid double-clicks beyond the
    // isGenerating React-state check, which has a one-render race window.
    const now = Date.now();
    if (now - lastGenerateAtRef.current < 1_000) return;
    lastGenerateAtRef.current = now;

    setGenerating(true);
    setGeneratingAction(null);
    setGenerationError(null);
    poll.reset();

    // Capture click-time context for the poll-success effect.
    const capturedPrompt = prompt.trim();
    const capturedStyleId = selectedStyleId;

    let tookPollPath = false;

    try {
      const body: Payload = {
        prompt: capturedPrompt,
        promptStyle: selectedStyle.promptStyle,
        width: effectiveWidth,
        height: effectiveHeight,
      };

      if (removeBg && selectedStyle.supportsRemoveBg) {
        body.removeBg = true;
      }

      if (referenceImages.length > 0 && referencesEnabled) {
        body.referenceImages = referenceImages;
      }

      // Per-attempt UUID — server's queue-kickoff path requires it; legacy
      // SSE path ignores it. Producer's idempotency layer dedupes if the
      // same UUID re-arrives on a network retry.
      const idempotencyKey = crypto.randomUUID();
      body.idempotencyKey = idempotencyKey;

      const sessionToken = await getToken();
      const result = await fetchGeneration(body, sessionToken);

      if (result.mode === 'poll') {
        // Queue path. The poll effect drives the rest of the lifecycle —
        // do NOT reset isGenerating here; it stays true through polling.
        tookPollPath = true;
        inFlightRef.current = { prompt: capturedPrompt, styleId: capturedStyleId };
        poll.startPolling(result.jobId, idempotencyKey, 'create');
        return;
      }

      // Legacy SSE path — byte-identical to the pre-refactor flow.
      const data = await consumeSSEStream(result.response);

      if (!data.success) {
        setGenerationError(String(data.error ?? 'Generation failed — try a different prompt.'));
        return;
      }

      // RD returns data URLs directly — no URL-to-blob conversion needed
      const dataUrl = data.imageUrl!;

      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(capturedStyleId);
      // Refresh token balance from server (tokens were already debited server-side)
      await fetchBalance();
      onGenerated(dataUrl, capturedPrompt, capturedStyleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const errObj = err as Error & {
        balance?: number;
        required?: number;
        code?: string;
        tier?: 'pro' | 'fast';
      };
      if (errObj.code === 'free_tier_cap_reached') {
        const tierLabel = errObj.tier === 'fast' ? 'Fast' : 'Pro';
        setGenerationError(
          `You've used all free ${tierLabel} generations on this account. Token packs start at $4.99 — top up to keep brewing.`
        );
        return;
      }
      if (errObj.balance !== undefined && errObj.required !== undefined) {
        setGenerationError(
          `You need ${errObj.required} tokens for this style, but you have ${errObj.balance}. Try a cheaper style or buy more tokens!`
        );
        setTokenBalance(errObj.balance);
        return;
      }
      setGenerationError(`Generation failed: ${msg} (your tokens are safe)`);
    } finally {
      // Poll path keeps isGenerating=true until the poll-effect fires terminal.
      if (!tookPollPath) {
        setGenerating(false);
        setGeneratingAction(null);
      }
    }
  }, [
    prompt, selectedStyle, selectedStyleId, effectiveWidth, effectiveHeight,
    removeBg, referenceImages, referencesEnabled, isGenerating, tokenCost, getToken,
    setGenerating, setGeneratingAction, setGenerationError, setGeneratedImage,
    setGenerationStyle, setTokenBalance, fetchBalance, onGenerated, poll,
  ]);

  // Poll-effect: react to terminal states from the queue path. On resume
  // (poll.isResume === true), inFlightRef is null so we hydrate the result
  // image but skip handleGenerated/addToHistory (no click-time context).
  useEffect(() => {
    if (poll.status === 'polling') {
      // Resume case — the hook fired startPolling on mount; mirror to the
      // global isGenerating flag so the form shows "Brewing…".
      setGenerating(true);
      return;
    }
    if (poll.status === 'success' && poll.result) {
      const dataUrl = `data:image/png;base64,${poll.result.resultBase64}`;
      setGeneratedImage(dataUrl, dataUrl);
      const ctx = inFlightRef.current;
      if (ctx) {
        setGenerationStyle(ctx.styleId);
        void fetchBalance();
        onGenerated(dataUrl, ctx.prompt, ctx.styleId);
        inFlightRef.current = null;
      }
      setGenerating(false);
      setGeneratingAction(null);
      poll.reset();
      return;
    }
    if (poll.status === 'error' || poll.status === 'abandoned') {
      const message = poll.error?.message ?? 'Generation failed.';
      const refundedNote = poll.error?.refunded ? ' (tokens refunded)' : '';
      setGenerationError(`${message}${refundedNote}`);
      setGenerating(false);
      setGeneratingAction(null);
      inFlightRef.current = null;
      poll.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.status, poll.result, poll.error]);

  return (
    <>
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
        <div className="space-y-3">
          {(Object.entries(GROUPED_STYLES) as [StyleCategory, GenerationStyle[]][]).map(
            ([category, styles]) => {
              const isCollapsed = collapsedCategories.has(category);
              return (
                <div key={category}>
                  <button
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className="flex w-full items-center justify-between py-2 text-left text-text-muted hover:text-text-default transition-colors"
                  >
                    <span className="text-[10px] font-mono uppercase tracking-wider">
                      {CATEGORY_LABELS[category]} ({styles.length})
                    </span>
                    {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {styles.map((style) => {
                        const active = selectedStyleId === style.id;
                        return (
                          <div key={style.id} className="relative group/example">
                            <button
                              onClick={() => setSelectedStyleId(style.id)}
                              className={`w-full h-full block text-left rounded-lg border px-3 py-2 transition-all duration-150 cursor-pointer
                                ${active
                                  ? 'border-accent-amber bg-accent-amber-glow'
                                  : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                                }`}
                            >
                              {style.examplePaths && style.examplePaths.length > 0 && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={style.examplePaths[0]}
                                  alt={`${style.label} example`}
                                  loading="lazy"
                                  className="w-full aspect-square mb-2 rounded-md object-contain bg-[#1a1614]"
                                  style={{ imageRendering: 'pixelated' }}
                                />
                              )}
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
                            {style.examplePaths && style.examplePaths.length > 0 && (
                              <button
                                type="button"
                                aria-label={`View ${style.label} examples`}
                                onClick={() => setLightboxStyle(style)}
                                className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-amber-400 backdrop-blur-sm transition-opacity opacity-70 group-hover/example:opacity-100 focus-visible:opacity-100"
                              >
                                <Maximize2 size={14} strokeWidth={2.5} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
          )}
        </div>
        <p className="text-[9px] font-mono text-text-muted mt-2">
          For animating an existing character, use the Animate My Character tab.
        </p>
      </div>

      {/* Reference Images — Pro styles only */}
      <ReferenceImagesPanel
        referenceImages={referenceImages}
        onChange={setReferenceImages}
        enabled={referencesEnabled}
      />

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
        {!selectedStyle.fixedSize && (
          <p className="text-[9px] font-mono text-text-muted/70 mt-1">
            Larger canvas = more room for detail and extended poses. Tokens scale with canvas size.
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
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-mono text-red-400">
              {generationError.includes('buy more tokens') ? (
                <>
                  {generationError.replace('buy more tokens!', '')}
                  <a href="/buy-tokens" className="underline hover:text-red-300">buy more tokens</a>!
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
          {generationError.includes('top up') && (
            <a
              href="/buy-tokens"
              className="inline-block mt-2 ml-6 px-3 py-1.5 rounded text-[10px] font-mono
                bg-accent-amber text-bg-primary hover:bg-accent-amber/90 transition-colors"
            >
              Buy Tokens
            </a>
          )}
        </div>
      )}

      {/* Sticky-button bottom spacer — keeps the last form element clear of the fixed bar below */}
      <div className="h-20" aria-hidden="true" />
    </div>

    {/* Sticky generate bar — viewport-fixed at bottom, sidebar-offset on desktop */}
    <div
      className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-width)] z-40 px-4 py-3 backdrop-blur-md border-t"
      style={{
        backgroundColor: 'rgba(20, 18, 16, 0.92)',
        borderColor: '#3a3430',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
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
            className={`w-full sm:w-auto whitespace-nowrap ${!isGenerating && prompt.trim() && !insufficientTokens ? 'animate-pulse' : ''}`}
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
    </div>

    {/* Style-examples lightbox carousel — opened by the ⤢ overlay on style cards. */}
    <StyleExamplesLightbox
      style={lightboxStyle}
      onClose={() => setLightboxStyle(null)}
      onUseStyle={() => {
        if (lightboxStyle) {
          setSelectedStyleId(lightboxStyle.id);
        }
        setLightboxStyle(null);
      }}
    />
    </>
  );
}
