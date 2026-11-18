'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, Film, Loader2, Sparkles, X } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import PixelCoin from '@/components/ui/PixelCoin';
import { getStyleById } from '@/lib/styleRegistry';
import {
  badgeStates,
  barRow,
  DIMMED_GENERATE,
  GUIDE_HINT,
  isTextAnimationId,
  PAUSED_HINT,
  TEXT_ANIMATIONS,
  textAnimationGate,
  textDescribeWords,
  VFX_ID,
} from '@/lib/generateTabs';
import { createBody } from '@/lib/createBody';
import { fetchGeneration, consumeSSEStream, type Payload } from '@/lib/sseClient';
import { GENERATION_PAUSED, GENERATION_PAUSED_MESSAGE, isUpstreamFailure, providerFailureMessage } from '@/lib/generationPause';
import { useGenerationPoll } from '@/hooks/useGenerationPoll';
import { type FinishedJob } from '@/lib/pollResume';
import { finishJob, type JobResultIO } from '@/lib/jobResult';
import { despillIfTransparent, decodedSize } from '@/lib/spriteUtils';
import { ANIMATED_STILLS, stillFrameStyle } from './animatedStills';
import StepBadge, { StepWord } from './StepBadge';

/**
 * Animate from Text (DESIGN, design/generate-pass/generate-pass.md section 3;
 * ticket G1): a moving sprite sheet from a description. Steps: 1 Describe it,
 * 2 Pick an animation, 3 Generate (the bar).
 *
 * Its jobs are `create` jobs with an animation style, sent with the same body
 * the Create form sent for these styles (src/lib/createBody.ts), so the
 * server, the poll, the result card and the Gallery see what they saw
 * before. The request, the poll and the error words follow the Create form
 * (GenerationForm.tsx) line for line; GenerationForm is frozen, so they are
 * kept here beside it rather than moved out of it.
 *
 * The card chosen lives on the page (it tells the result card's tips which
 * card is chosen, and a page request can set it).
 */

const JOB_RESULT_IO: JobResultIO = { despill: despillIfTransparent, decodedSize };
const formatCount = (n: number) => n.toLocaleString('en-US');
/** The short-balance refusal in this tab's words, which the box follows with "Get tokens". */
const SHORT_FOR_ANIMATION = /^You need [\d,]+ more tokens? for this animation\.$/;
const tokensWord = (n: number) => (n === 1 ? 'token' : 'tokens');

interface TextAnimationFormProps {
  onGenerated: (imageUrl: string, prompt: string, style: string, animateContext?: FinishedJob['animate'], jobId?: string) => void;
  guideShowing?: boolean;
  /** The card chosen, one of TEXT_ANIMATION_IDS; kept by the page. */
  styleId: string;
  onStyleChange: (id: string) => void;
}

export default function TextAnimationForm({ onGenerated, guideShowing = false, styleId, onStyleChange }: TextAnimationFormProps) {
  const { userId, getToken } = useAuth();
  const setGenerating = useSpriteStore((s) => s.setGenerating);
  const setGeneratingAction = useSpriteStore((s) => s.setGeneratingAction);
  const setGenerationProgress = useSpriteStore((s) => s.setGenerationProgress);
  const setGenerationError = useSpriteStore((s) => s.setGenerationError);
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setCurrentSheetMetadata = useSpriteStore((s) => s.setCurrentSheetMetadata);
  const setRescueInfo = useSpriteStore((s) => s.setRescueInfo);
  const setOriginalCharacter = useSpriteStore((s) => s.setOriginalCharacter);
  const setTokenBalance = useSpriteStore((s) => s.setTokenBalance);
  const restoreTokenBalance = useSpriteStore((s) => s.restoreTokenBalance);
  const tokenBalance = useSpriteStore((s) => s.tokenBalance);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generationError = useSpriteStore((s) => s.generationError);
  const textAnimationRequest = useSpriteStore((s) => s.textAnimationRequest);
  const clearTextAnimationRequest = useSpriteStore((s) => s.clearTextAnimationRequest);

  const [isAdmin, setIsAdmin] = useState(false);

  // The balance, as the Create form reads it: the cached copy at once, then
  // the server's.
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
        setIsAdmin(data.isAdmin === true);
        try {
          localStorage.setItem(`spritebrew_tokens_${userId}`, String(data.balance));
        } catch { /* localStorage unavailable */ }
      }
    } catch { /* network error: keep the cached value */ }
  }, [userId, getToken, setTokenBalance]);

  useEffect(() => {
    if (userId) {
      try {
        const cached = localStorage.getItem(`spritebrew_tokens_${userId}`);
        if (cached) restoreTokenBalance(parseInt(cached, 10));
      } catch { /* ignore */ }
      void fetchBalance();
    }
  }, [userId, restoreTokenBalance, fetchBalance]);

  const poll = useGenerationPoll({
    onDrop: () => {
      setGenerating(false);
      setGeneratingAction(null);
    },
  });
  const lastGenerateAtRef = useRef<number>(0);

  const [prompt, setPrompt] = useState('');
  // VFX Effects' size and the Background switch are the person's for the
  // visit: a card change keeps them (AUDIT g1-tabs-r1 L8). All five cards
  // take a transparent background; VFX starts at its own default size.
  const vfxDefault = getStyleById(VFX_ID);
  const [customWidth, setCustomWidth] = useState(vfxDefault?.defaultWidth ?? 64);
  const [customHeight, setCustomHeight] = useState(vfxDefault?.defaultHeight ?? 64);
  const [removeBg, setRemoveBg] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);

  // A page request (src/stores/spriteStore.ts, G0; "Open 4-Angle Walking"):
  // the card it names and its subject, or an empty description. Consumed once.
  useEffect(() => {
    if (!textAnimationRequest) return;
    clearTextAnimationRequest();
    if (isTextAnimationId(textAnimationRequest.styleId)) onStyleChange(textAnimationRequest.styleId);
    setPrompt(textAnimationRequest.subject ?? '');
  }, [textAnimationRequest, clearTextAnimationRequest, onStyleChange]);

  // The gate: the cost shown is the cost sent, a short balance, the size
  // sent, and whether Generate may be pressed (generateTabs.ts, tested).
  const gate = textAnimationGate({
    styleId, tokenBalance, prompt, generating: isGenerating, paused: GENERATION_PAUSED, width: customWidth, height: customHeight,
  });
  const { style, tokenCost, shortBy: tokensNeeded, canGenerate } = gate;
  const insufficientTokens = tokensNeeded > 0;
  const effectiveWidth = gate.width;
  const effectiveHeight = gate.height;
  const words = textDescribeWords(style.id);

  const handleGenerate = useCallback(async () => {
    if (GENERATION_PAUSED || !prompt.trim() || isGenerating) return;
    // A short balance sends nothing either (the gate).
    if (!canGenerate) return;
    // One request for a double press: the 1 s guard, beside isGenerating.
    const now = Date.now();
    if (now - lastGenerateAtRef.current < 1_000) return;
    lastGenerateAtRef.current = now;

    setGenerating(true);
    setGeneratingAction(null);
    setGenerationError(null);
    poll.reset();

    const capturedPrompt = prompt.trim();
    const capturedStyleId = style.id;
    let tookPollPath = false;

    try {
      // No reference images: none of the five takes them.
      const body: Payload = createBody({
        prompt: capturedPrompt,
        style,
        width: effectiveWidth,
        height: effectiveHeight,
        removeBg,
        referenceImages: [],
      });
      const idempotencyKey = crypto.randomUUID();
      body.idempotencyKey = idempotencyKey;

      const sessionToken = await getToken();
      const result = await fetchGeneration(body, sessionToken);

      if (result.mode === 'poll') {
        tookPollPath = true;
        poll.startPolling(result.jobId, idempotencyKey, 'create', { prompt: capturedPrompt, styleId: capturedStyleId });
        return;
      }

      const data = await consumeSSEStream(result.response);
      if (!data.success) {
        setGenerationError(String(data.error ?? 'Generation failed. Try a different prompt.'));
        return;
      }
      const dataUrl = data.imageUrl!;
      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(capturedStyleId);
      await fetchBalance();
      onGenerated(dataUrl, capturedPrompt, capturedStyleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const errObj = err as Error & { balance?: number; required?: number; code?: string; tier?: 'pro' | 'fast'; error?: string };
      if (errObj.code === 'free_tier_cap_reached') {
        const tierLabel = errObj.tier === 'fast' ? 'Fast' : 'Pro';
        setGenerationError(
          `You've used all free ${tierLabel} generations on this account. Token packs start at $4.99. Top up to keep brewing.`
        );
        return;
      }
      if (errObj.balance !== undefined && errObj.required !== undefined) {
        // This tab's own noun, in the bar's row 7 words (DESIGN room
        // 2026-11-18-097; AUDIT g1-tabs-r1 L10); the box adds "Get tokens".
        const more = Math.max(1, errObj.required - errObj.balance);
        setGenerationError(`You need ${formatCount(more)} more ${tokensWord(more)} for this animation.`);
        setTokenBalance(errObj.balance);
        return;
      }
      if (errObj.error === 'submission_failed' || errObj.error === 'money_paused') {
        // The server's words say what happened to the tokens: shown as sent.
        setGenerationError(msg);
        void fetchBalance();
        return;
      }
      setGenerationError(`Generation failed: ${msg} (your tokens are safe)`);
    } finally {
      if (!tookPollPath) {
        setGenerating(false);
        setGeneratingAction(null);
      }
    }
  }, [
    prompt, style, effectiveWidth, effectiveHeight, removeBg, isGenerating, canGenerate, getToken,
    setGenerating, setGeneratingAction, setGenerationError, setGeneratedImage,
    setGenerationStyle, setTokenBalance, fetchBalance, onGenerated, poll,
  ]);

  // The poll's end, as on Create: the result by its own mode, or the words.
  useEffect(() => {
    if (poll.status === 'polling') {
      setGenerating(true);
      return;
    }
    if (poll.status === 'success' && poll.result) {
      const job = { result: poll.result, mode: poll.mode, context: poll.context, jobId: poll.jobId };
      void finishJob(job, JOB_RESULT_IO, {
        setRescueInfo, setOriginalCharacter, setGeneratedImage, setGenerationStyle, setCurrentSheetMetadata,
        fetchBalance: () => { void fetchBalance(); },
        onGenerated,
      }).finally(() => {
        setGenerating(false);
        setGeneratingAction(null);
        poll.reset();
      });
      return;
    }
    if (poll.status === 'error' || poll.status === 'abandoned') {
      const rawMessage = poll.error?.message ?? 'Generation failed.';
      const refundedNote = poll.error?.refunded ? ' Your tokens have been refunded.' : '';
      // The provider's failures in Animate from Text's own words, as the other
      // two forms word theirs (generationPause.ts; DESIGN failure-lines.md;
      // AUDIT g1-tabs-r1 M2).
      const isUpstreamError = isUpstreamFailure(rawMessage, poll.error?.errorCode);
      const customerMessage = isUpstreamError
        ? providerFailureMessage('text-animation', refundedNote, poll.error?.errorCode)
        : `${rawMessage}${refundedNote}`;
      console.error('[generation error]', { rawMessage, errorCode: poll.error?.errorCode });
      setGenerationError(customerMessage);
      void fetchBalance();
      setGenerating(false);
      setGeneratingAction(null);
      poll.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.status, poll.result, poll.error]);

  useEffect(() => {
    setGenerationProgress(poll.startedAt, poll.serverStatus, poll.mode, poll.pausedMessage);
  }, [poll.startedAt, poll.serverStatus, poll.mode, poll.pausedMessage, setGenerationProgress]);
  useEffect(() => () => setGenerationProgress(null, null, null, null), [setGenerationProgress]);

  // Steps: 1 Describe it (required), 2 Pick an animation (a card is always
  // chosen, so done); Generate is the bar's step 3.
  const [describeBadge, pickBadge] = badgeStates(
    [{ required: true, done: prompt.trim() !== '' }, { required: true, done: true }],
    guideShowing,
  );
  const row = barRow({
    generating: isGenerating,
    paused: GENERATION_PAUSED,
    guideShowing,
    requiredMissing: !prompt.trim(),
    shortBy: insufficientTokens ? tokensNeeded : 0,
  });
  const reasonId = GENERATION_PAUSED ? 'text-paused-reason' : 'text-reason';
  let hint: ReactNode = null;
  if (row === 'paused') {
    hint = (
      <>
        <span aria-hidden="true">{PAUSED_HINT}</span>
        <span className="sr-only">{GENERATION_PAUSED_MESSAGE}</span>
      </>
    );
  } else if (row === 'guide') {
    hint = GUIDE_HINT;
  } else if (row === 'required') {
    hint = words.hint;
  } else if (row === 'short') {
    hint = (
      <>
        You need {formatCount(tokensNeeded)} more {tokensWord(tokensNeeded)} for this animation.{' '}
        <a
          href="/buy-tokens"
          className="inline-flex items-center pointer-coarse:min-h-11 lg:pointer-coarse:-my-3 text-accent-amber underline hover:text-accent-amber-strong"
        >
          Get tokens
        </a>
      </>
    );
  } else if (row === 'ready') {
    hint = 'Step 3: Generate.';
  }

  const sizeLabel = effectiveWidth === effectiveHeight ? `${effectiveWidth}` : `${effectiveWidth}×${effectiveHeight}`;
  const summaryCostText = insufficientTokens
    ? `${formatCount(tokenCost)} tokens · you have ${formatCount(tokenBalance)}`
    : `${formatCount(tokenCost)} of ${formatCount(tokenBalance)} tokens`;
  const summaryHead = style.id === VFX_ID ? `${style.label} · ${sizeLabel} px` : style.label;
  const summaryText = `${summaryHead} · ${summaryCostText}${isAdmin ? ` · ~$${style.costPerGeneration.toFixed(2)}` : ''}`;

  const pickLabelId = useId();
  const moreId = useId();
  const bgLabelId = useId();
  const bgValueId = useId();
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosenIndex = Math.max(0, TEXT_ANIMATIONS.findIndex((a) => a.id === style.id));
  // The cards are one radio group: arrow keys move and choose.
  const onCardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (chosenIndex + step + TEXT_ANIMATIONS.length) % TEXT_ANIMATIONS.length;
    onStyleChange(TEXT_ANIMATIONS[next].id);
    cardRefs.current[next]?.focus();
  };

  const summaryCost = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap align-middle">
      <PixelCoin />
      <span>
        {formatCount(tokenCost)}
        {insufficientTokens ? (
          <>
            {' '}tokens &middot;{' '}
            <span className="text-red-400">you have {formatCount(tokenBalance)}</span>
          </>
        ) : (
          <span> of {formatCount(tokenBalance)} tokens</span>
        )}
      </span>
    </span>
  );

  return (
    <>
    <div className="space-y-6">
      {/* 1 Describe it */}
      <div>
        <label
          htmlFor="text-prompt"
          className="flex items-center gap-2 text-xs font-mono text-text-secondary uppercase tracking-wider mb-2"
        >
          <StepBadge n={1} state={describeBadge} />
          <span>
            <StepWord n={1} />
            {words.label}
          </span>
        </label>
        <textarea
          id="text-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={words.placeholder}
          rows={3}
          className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3
            text-sm font-mono text-text-primary placeholder:text-text-secondary resize-none
            focus:outline-none focus:border-accent-amber"
        />
      </div>

      {/* 2 Pick an animation */}
      <div>
        <p id={pickLabelId} className="flex items-center gap-2 text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          <StepBadge n={2} state={pickBadge} />
          <span>
            <StepWord n={2} />
            Pick an animation
          </span>
        </p>
        <div role="radiogroup" aria-labelledby={pickLabelId} onKeyDown={onCardKey} className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {TEXT_ANIMATIONS.map((card, i) => {
            const s = getStyleById(card.id);
            if (!s) return null;
            const chosen = s.id === style.id;
            const still = ANIMATED_STILLS[s.id];
            return (
              <button
                key={s.id}
                ref={(el) => { cardRefs.current[i] = el; }}
                type="button"
                role="radio"
                aria-checked={chosen}
                tabIndex={chosen ? 0 : -1}
                onClick={() => onStyleChange(s.id)}
                className={`flex items-center gap-3 min-h-11 rounded-xl border p-2.5 text-left cursor-pointer transition-colors
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber
                  ${chosen ? 'border-accent-amber bg-accent-amber-glow/40' : 'border-border-strong hover:bg-bg-hover'}`}
              >
                <span className="flex-shrink-0 w-14 h-14 rounded-lg bg-[#151311] overflow-hidden flex items-center justify-center" aria-hidden="true">
                  {still ? <span className="block w-full h-full" style={stillFrameStyle(still)} /> : <Film size={22} className="text-text-secondary" />}
                </span>
                <span className="min-w-0 flex-1">
                  {/* The cost wraps under the name where the card is narrow (AUDIT g1-tabs-r1 M5). */}
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="min-w-0 text-[13px] font-mono text-text-primary">{s.label}</span>
                    <span className="inline-flex items-center gap-1 text-xs font-mono text-text-secondary tabular-nums whitespace-nowrap">
                      <PixelCoin />
                      {formatCount(s.tokenCost)}
                      <span className="sr-only"> tokens</span>
                    </span>
                  </span>
                  <span className="block text-xs font-mono text-text-secondary mt-0.5">{card.line}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* VFX Effects takes a size, as Create took it. */}
        {!style.fixedSize && (
          <div className="flex items-center gap-1.5 mt-3" role="group" aria-label="Size in pixels">
            <span className="text-xs font-mono text-text-secondary mr-1" aria-hidden="true">Size</span>
            <input
              type="number"
              aria-label="Width in pixels"
              min={style.minSize}
              max={style.maxSize}
              value={customWidth}
              onChange={(e) => setCustomWidth(Number(e.target.value))}
              onBlur={() => setCustomWidth(effectiveWidth)}
              className="w-[88px] rounded bg-bg-elevated border border-border-default px-3 py-1.5 pointer-coarse:min-h-11
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
            <span className="text-xs font-mono text-text-secondary" aria-hidden="true">×</span>
            <input
              type="number"
              aria-label="Height in pixels"
              min={style.minSize}
              max={style.maxSize}
              value={customHeight}
              onChange={(e) => setCustomHeight(Number(e.target.value))}
              onBlur={() => setCustomHeight(effectiveHeight)}
              className="w-[88px] rounded bg-bg-elevated border border-border-default px-3 py-1.5 pointer-coarse:min-h-11
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
        )}
      </div>

      {/* More settings: background (closed) */}
      {style.supportsRemoveBg && (
        <div>
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 min-h-8 pointer-coarse:min-h-11 text-xs font-mono text-text-secondary hover:text-text-primary cursor-pointer"
          >
            <ChevronDown size={14} aria-hidden="true" className={moreOpen ? 'rotate-180' : ''} />
            More settings: background
          </button>
          <div id={moreId} hidden={!moreOpen} className="mt-2">
            <div className="flex items-center gap-2">
              <span id={bgLabelId} className="text-xs font-mono text-text-secondary">Background</span>
              <button
                type="button"
                role="switch"
                aria-checked={removeBg}
                aria-labelledby={`${bgLabelId} ${bgValueId}`}
                onClick={() => setRemoveBg((v) => !v)}
                className="inline-flex items-center gap-2 min-h-8 pointer-coarse:min-h-11 px-1 rounded cursor-pointer
                  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber"
              >
                <span
                  aria-hidden="true"
                  className={`relative inline-block w-8 h-[18px] rounded-full border ${
                    removeBg ? 'bg-accent-amber border-accent-amber' : 'bg-bg-elevated border-border-strong'
                  }`}
                >
                  <span
                    className={`absolute top-[2px] w-3 h-3 rounded-full ${
                      removeBg ? 'left-[16px] bg-bg-primary' : 'left-[2px] bg-text-secondary'
                    }`}
                  />
                </span>
                <span id={bgValueId} className="text-xs font-mono text-text-primary">Transparent</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error, as on Create */}
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
              ) : SHORT_FOR_ANIMATION.test(generationError) ? (
                <>
                  {generationError}{' '}
                  <a href="/buy-tokens" className="inline-flex items-center pointer-coarse:min-h-11 underline hover:text-red-300">Get tokens</a>
                </>
              ) : generationError}
            </p>
            <button
              onClick={() => setGenerationError(null)}
              aria-label="Dismiss"
              className="ml-auto inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:-m-3 text-red-400 hover:text-red-300 cursor-pointer flex-shrink-0"
            >
              <X size={12} />
            </button>
          </div>
          {/top up/i.test(generationError) && (
            <a
              href="/buy-tokens"
              className="inline-block mt-2 ml-6 px-3 py-1.5 rounded text-xs font-mono
                bg-accent-amber text-bg-primary hover:bg-accent-amber/90 transition-colors"
            >
              Buy Tokens
            </a>
          )}
        </div>
      )}

      <div className="h-32" aria-hidden="true" />
    </div>

    {/* The Generate bar, as on Create. */}
    <div
      data-generate-bar=""
      className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-width)] z-40 px-4 py-3 backdrop-blur-md border-t isolate transform-gpu overscroll-none"
      style={{
        backgroundColor: 'rgba(20, 18, 16, 0.92)',
        borderColor: '#3a3430',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Below 1100 px the bar stacks as on a phone: the summary, then the
            button, then the hint, each on its own row; from 1100 px one row.
            "Generate animation" is the wider button, so its hint was squeezed
            beside it from 1024 px (DESIGN room 2026-11-18-097; AUDIT g1-tabs-r1 L6, L7). */}
        <div className="flex flex-col min-[1100px]:flex-row min-[1100px]:items-center min-[1100px]:justify-between gap-2 min-[1100px]:gap-3">
          <p
            className="min-w-0 min-[1100px]:min-w-[300px] min-[1100px]:flex-1 truncate text-[13px] font-mono text-text-secondary tabular-nums"
            title={summaryText}
          >
            <span className="sm:hidden">
              {summaryCost} &middot; {summaryHead}
            </span>
            <span className="max-sm:hidden inline-flex max-w-full items-center gap-[1ch] align-bottom">
              <span className="min-w-0 shrink-[99999] truncate">{summaryHead} &middot;</span>{' '}
              <span className="flex-shrink-0">{summaryCost}</span>
            </span>
            {isAdmin && <span> &middot; ~${style.costPerGeneration.toFixed(2)}</span>}
          </p>
          <div className="flex flex-col-reverse items-stretch gap-1 min-[1100px]:flex-row min-[1100px]:items-center min-[1100px]:gap-3">
            {hint && (
              <p id={reasonId} className="text-[13px] font-mono text-text-secondary text-center text-balance min-[1100px]:text-right">
                {hint}
              </p>
            )}
            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`w-full min-[1100px]:w-auto whitespace-nowrap pointer-coarse:min-h-11 ${canGenerate ? 'animate-pulse motion-reduce:animate-none' : ''}`}
              // When it cannot be pressed its fill dims and its label stays at
              // full strength (DESIGN generate-pass.md section 1; AUDIT g1-tabs-r1 M4).
              style={canGenerate ? undefined : DIMMED_GENERATE}
              title={GENERATION_PAUSED ? GENERATION_PAUSED_MESSAGE : insufficientTokens ? `Need ${tokensNeeded} more ${tokensWord(tokensNeeded)}` : undefined}
              aria-describedby={hint ? reasonId : undefined}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Brewing...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Generate animation
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    &middot; <PixelCoin /> {formatCount(tokenCost)}
                    <span className="sr-only"> tokens</span>
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
