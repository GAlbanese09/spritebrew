'use client';

import { useState, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Sparkles, X, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import PixelCoin from '@/components/ui/PixelCoin';
import ReferenceImagesPanel from '@/components/sprites/ReferenceImagesPanel';
import {
  GENERATION_STYLES,
  getStyleById,
  type GenerationStyle,
} from '@/lib/styleRegistry';
import { accountRecentStorage, pushRecent, readRecent, visibleRecent, writeRecent, type RecentStorage } from '@/lib/recentStyles';
import { affordableNote, DEFAULT_STYLE_ID, openingStyle } from '@/lib/affordableStyle';
import { formVisit } from '@/lib/createFormVisit';
import { fetchGeneration, consumeSSEStream, type Payload } from '@/lib/sseClient';
import { GENERATION_PAUSED, GENERATION_PAUSED_MESSAGE, upstreamFailureMessage } from '@/lib/generationPause';
import { useGenerationPoll } from '@/hooks/useGenerationPoll';
import { type FinishedJob } from '@/lib/pollResume';
import { finishJob, type JobResultIO } from '@/lib/jobResult';
import { despillIfTransparent, decodedSize } from '@/lib/spriteUtils';
import { StyleExamplesLightbox } from './StyleExamplesLightbox';
import StyleField from './StyleField';
import StylePicker from './StylePicker';

/** The browser steps for finishing a job's result (see jobResult.ts). */
const JOB_RESULT_IO: JobResultIO = { despill: despillIfTransparent, decodedSize };

/** Each chip shows one word and fills its full prompt. */
const EXAMPLE_PROMPTS = [
  { label: 'Knight', prompt: 'pixel art knight with sword' },
  { label: 'Goblin', prompt: 'small goblin with wooden club' },
  { label: 'Wizard', prompt: 'wizard with blue robe and staff' },
  { label: 'Skeleton', prompt: 'skeleton warrior with shield' },
  { label: 'Slime', prompt: 'cute slime monster' },
  { label: 'Robot', prompt: 'robot with laser gun' },
];

const STYLE_IDS = GENERATION_STYLES.map((s) => s.id);

/** This account's Recent in this browser's localStorage (recentStyles.ts),
 *  or null where it cannot be reached or no one is signed in. */
function recentStorage(userId: string | null | undefined): RecentStorage | null {
  try {
    return typeof window === 'undefined' ? null : accountRecentStorage(window.localStorage, userId);
  } catch {
    return null;
  }
}

/** Token numbers with thousands separators (10,021). */
const formatCount = (n: number) => n.toLocaleString('en-US');
/** "token" at exactly one, "tokens" otherwise. */
const tokensWord = (n: number) => (n === 1 ? 'token' : 'tokens');

interface GenerationFormProps {
  onGenerated: (imageUrl: string, prompt: string, style: string, animateContext?: FinishedJob['animate'], jobId?: string) => void;
}

export default function GenerationForm({ onGenerated }: GenerationFormProps) {
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
  const emailListClaimed = useSpriteStore((s) => s.emailListClaimed);
  const emailListClaimKnown = useSpriteStore((s) => s.emailListClaimKnown);

  // Cost visibility for admins: the server's answer on the balance fetch below.
  const [isAdmin, setIsAdmin] = useState(false);
  // True once the server has answered with this visit's balance (the cached
  // localStorage value does not count): the opening style and the note wait for it.
  const [serverBalanceKnown, setServerBalanceKnown] = useState(false);

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
        setServerBalanceKnown(true);
        setIsAdmin(data.isAdmin === true);
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
        if (cached) restoreTokenBalance(parseInt(cached, 10));
      } catch { /* ignore */ }
      fetchBalance();
    }
  }, [userId, restoreTokenBalance, fetchBalance]);

  // Queue-and-poll integration. The hook auto-resumes a poll from
  // localStorage on mount if a fresh-enough activeJob entry exists. A saved
  // job it drops instead (another account's, or one too old) ends the
  // Brewing state the form that sent it left on.
  const poll = useGenerationPoll({
    onDrop: () => {
      setGenerating(false);
      setGeneratingAction(null);
    },
  });

  // 1s click-debounce — guards against rapid double-clicks beyond the
  // existing isGenerating boolean (which has a one-render race window).
  const lastGenerateAtRef = useRef<number>(0);

  // What this visit remembers for this account (createFormVisit.ts): the
  // page rebuilds the form after every result and on every Create or Animate
  // switch, and it comes back on the same style and the same latch.
  const [visitAtMount] = useState(() => formVisit.read(userId));
  const [prompt, setPrompt] = useState('');
  const [selectedStyleId, setSelectedStyleId] = useState(() => {
    const id = visitAtMount.styleId;
    return id !== null && getStyleById(id) ? id : DEFAULT_STYLE_ID;
  });
  const [customWidth, setCustomWidth] = useState(256);
  const [customHeight, setCustomHeight] = useState(256);
  const [removeBg, setRemoveBg] = useState(true);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  // Style whose examples are open in the lightbox carousel. null = closed.
  const [lightboxStyle, setLightboxStyle] = useState<GenerationStyle | null>(null);

  // The style picker, Recent styles (per account, in this browser) and the
  // polite announcement of a style change. This form renders only inside the
  // signed-in Show on /generate, which renders nothing on the server, so
  // Recent can read localStorage on its first render.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecent(recentStorage(userId), STYLE_IDS));
  const [styleAnnouncement, setStyleAnnouncement] = useState('');
  const changeStyleRef = useRef<HTMLButtonElement>(null);

  // The latch: set by the person's first act this visit (a style chosen, the
  // current one included; a prompt typed; an example tapped), in the handler
  // that acts, never in an effect, and never cleared. Until it is set the
  // style follows the balance.
  const actedRef = useRef(visitAtMount.acted);
  const markActed = useCallback(() => {
    actedRef.current = true;
    formVisit.rememberActed(userId);
  }, [userId]);

  // Every style change goes through here: the picker, a Recent badge and the
  // lightbox's Use this style. Recent is computed from the current values, not
  // inside a state updater, so a double call in development cannot push twice.
  const chooseStyle = useCallback((id: string) => {
    markActed();
    if (id === selectedStyleId) return;
    const next = getStyleById(id);
    if (!next) return;
    const list = pushRecent(recentIds, selectedStyleId, id);
    setRecentIds(list);
    writeRecent(recentStorage(userId), list);
    formVisit.rememberStyle(userId, id);
    setSelectedStyleId(id);
    setStyleAnnouncement(`Style: ${next.label}, ${next.tokenCost} tokens`);
  }, [selectedStyleId, recentIds, markActed, userId]);

  // Until the person acts, the style follows the server's balance
  // (affordableStyle.ts) each time it changes, before paint. Not a choice:
  // Recent and the announcement stay as they are. Never once the latch is set.
  useLayoutEffect(() => {
    if (!serverBalanceKnown || actedRef.current) return;
    const id = openingStyle({ balance: tokenBalance, currentId: selectedStyleId, acted: actedRef.current });
    if (id === selectedStyleId) return;
    formVisit.rememberStyle(userId, id);
    setSelectedStyleId(id);
  }, [serverBalanceKnown, tokenBalance, selectedStyleId, userId]);

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
    if (GENERATION_PAUSED || !prompt.trim() || isGenerating) return;

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
        expectedTokenCost: selectedStyle.tokenCost,
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
        // The click-time context travels with the saved job, so whichever
        // form finishes it writes its Recent entry and style.
        poll.startPolling(result.jobId, idempotencyKey, 'create', { prompt: capturedPrompt, styleId: capturedStyleId });
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
        error?: string;
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
      if (errObj.error === 'submission_failed' || errObj.error === 'money_paused') {
        // The server's message states what happened to the tokens (refunded,
        // to be returned by hand, or never charged): surface it verbatim, do
        // NOT append the generic "(your tokens are safe)" copy.
        setGenerationError(msg);
        // Refresh balance so the user sees the refund landed.
        void fetchBalance();
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

  // Poll-effect: react to terminal states from the queue path. A job resumed
  // here (after a reload, a return to /generate or a tab switch) carries the
  // context saved with it, so it writes its Recent entry, hints and style
  // like one that never left this form; finishJob shows it by its own mode.
  useEffect(() => {
    if (poll.status === 'polling') {
      // Resume case — the hook fired startPolling on mount; mirror to the
      // global isGenerating flag so the form shows "Brewing…".
      setGenerating(true);
      return;
    }
    if (poll.status === 'success' && poll.result) {
      // The job's result by its own mode, the same in both forms (jobResult.ts):
      // a Create sheet as delivered, clearing the previous animation's notice
      // and character; an Animate job finished here (the user picked this tab
      // mid-job) despilled and with its rescue notice, as the Animate form
      // shows it. Then its Recent entry, hints and style.
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

      // Friendly error wrapping: convert technical upstream errors to
      // customer-facing copy. Keep raw error in console for diagnostics.
      const isUpstreamError =
        rawMessage.startsWith('RD ') ||
        rawMessage.includes('inference_failed') ||
        rawMessage.includes('Unexpected response') ||
        rawMessage.includes('timed out');

      const customerMessage = isUpstreamError
        ? upstreamFailureMessage('generation', refundedNote)
        : `${rawMessage}${refundedNote}`;

      console.error('[generation error]', { rawMessage, errorCode: poll.error?.errorCode });
      setGenerationError(customerMessage);

      // Refresh token balance to reflect any refund that fired server-side
      void fetchBalance();

      setGenerating(false);
      setGeneratingAction(null);
      poll.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.status, poll.result, poll.error]);

  // Mirror in-flight progress to the store so BrewingLoader can show the
  // elapsed time, the job stage and the per-mode expectation, or the paused
  // copy in its place.
  useEffect(() => {
    setGenerationProgress(poll.startedAt, poll.serverStatus, poll.mode, poll.pausedMessage);
  }, [poll.startedAt, poll.serverStatus, poll.mode, poll.pausedMessage, setGenerationProgress]);
  // Cleared when the form goes (a sign-out, a tab switch), so no message
  // outlives the form whose poll set it; the other tab's form resumes the job.
  useEffect(() => () => setGenerationProgress(null, null, null, null), [setGenerationProgress]);

  // Character and animated styles ask for a character; the others for a thing.
  const asksForCharacter = selectedStyle.category === 'characters' || selectedStyle.isAnimation;
  const recentStyles = visibleRecent(recentIds, selectedStyleId)
    .map((id) => getStyleById(id))
    .filter((s): s is GenerationStyle => !!s);
  const sizeLabel = effectiveWidth === effectiveHeight ? `${effectiveWidth}` : `${effectiveWidth}×${effectiveHeight}`;
  // The bar's summary as one string, for its title (the line itself truncates).
  // A short balance reads "16 tokens · you have 8"; one that covers the
  // cost, "16 of 10,021 tokens".
  const summaryCostText = !userId
    ? `${formatCount(tokenCost)} tokens`
    : insufficientTokens
      ? `${formatCount(tokenCost)} tokens \u00b7 you have ${formatCount(tokenBalance)}`
      : `${formatCount(tokenCost)} of ${formatCount(tokenBalance)} tokens`;
  const summaryText = `${selectedStyle.label} \u00b7 ${sizeLabel} px \u00b7 ${summaryCostText}${
    isAdmin ? ` \u00b7 ~$${selectedStyle.costPerGeneration.toFixed(2)}` : ''
  }`;
  // What the balance buys, once the server has said what it is.
  const balanceNote = serverBalanceKnown
    ? affordableNote({ balance: tokenBalance, emailListClaimed, emailListClaimKnown })
    : null;
  const bgLabelId = useId();
  const bgValueId = useId();

  // Why Generate is disabled, when the person can act on it (none while brewing).
  const reasonId = GENERATION_PAUSED ? 'generate-paused-reason' : 'generate-reason';
  let disabledReason: ReactNode = null;
  if (!isGenerating) {
    if (GENERATION_PAUSED) {
      disabledReason = GENERATION_PAUSED_MESSAGE;
    } else if (insufficientTokens) {
      disabledReason = (
        <>
          You need {formatCount(tokensNeeded)} more {tokensWord(tokensNeeded)} for this style.{' '}
          <a
            href="/buy-tokens"
            className="inline-flex items-center pointer-coarse:min-h-11 text-accent-amber underline hover:text-accent-amber-strong"
          >
            Get tokens
          </a>
        </>
      );
    } else if (!prompt.trim()) {
      disabledReason = asksForCharacter ? 'Describe a character to start.' : 'Describe what to generate to start.';
    }
  }

  // The bar's coin, cost and balance. A short balance reads "16 tokens ·
  // you have 8", the balance in red.
  const summaryCost = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap align-middle">
      <PixelCoin />
      <span>
        {formatCount(tokenCost)}
        {!userId ? (
          ' tokens'
        ) : insufficientTokens ? (
          <>
            {' '}tokens &middot;{' '}
            <span className="text-red-400">you have {formatCount(tokenBalance)}</span>
          </>
        ) : (
          <span>
            {' '}of {formatCount(tokenBalance)} tokens
          </span>
        )}
      </span>
    </span>
  );

  return (
    <>
    <div className="space-y-6">
      {/* Prompt */}
      <div>
        <label
          htmlFor="create-prompt"
          className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2"
        >
          {asksForCharacter ? 'Describe your character' : 'Describe what to generate'}
        </label>
        <textarea
          id="create-prompt"
          value={prompt}
          onChange={(e) => {
            if (e.target.value) markActed();
            setPrompt(e.target.value);
          }}
          placeholder={
            asksForCharacter
              ? 'e.g. a small knight in a blue cape, full body, facing down'
              : "Describe what you want to generate. Be specific about style and details."
          }
          rows={3}
          className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3
            text-sm font-mono text-text-primary placeholder:text-text-muted resize-none
            focus:outline-none focus:border-accent-amber"
        />
        <ExampleChips
          onPick={(example) => {
            markActed();
            setPrompt(example);
          }}
        />
      </div>

      {/* Style: the chosen style, Change style and Recent */}
      <div>
        <StyleField
          ref={changeStyleRef}
          style={selectedStyle}
          recent={recentStyles}
          pickerOpen={pickerOpen}
          onOpenPicker={() => setPickerOpen(true)}
          onViewExamples={setLightboxStyle}
          onChooseRecent={chooseStyle}
        />
        {balanceNote && (
          <p className="text-[13px] font-mono text-text-secondary mt-2">{balanceNote}</p>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {styleAnnouncement}
        </p>
      </div>

      {/* Reference Images — Pro styles only */}
      <ReferenceImagesPanel
        referenceImages={referenceImages}
        onChange={setReferenceImages}
        enabled={referencesEnabled}
      />

      {/* Size, on one line: the fields (or the fixed size), then Background. */}
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {selectedStyle.fixedSize ? (
            <p className="text-[13px] font-mono text-text-secondary">
              Size {effectiveWidth}×{effectiveHeight} (fixed for this style)
            </p>
          ) : (
            <div className="flex items-center gap-1.5" role="group" aria-label="Size in pixels">
              <span className="text-xs font-mono text-text-secondary mr-1" aria-hidden="true">Size</span>
              <input
                type="number"
                aria-label="Width in pixels"
                min={selectedStyle.minSize}
                max={selectedStyle.maxSize}
                value={customWidth}
                onChange={(e) => setCustomWidth(Math.max(selectedStyle.minSize, Math.min(selectedStyle.maxSize, Number(e.target.value))))}
                className="w-[88px] rounded bg-bg-elevated border border-border-default px-3 py-1.5 pointer-coarse:min-h-11
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
              <span className="text-xs font-mono text-text-secondary" aria-hidden="true">×</span>
              <input
                type="number"
                aria-label="Height in pixels"
                min={selectedStyle.minSize}
                max={selectedStyle.maxSize}
                value={customHeight}
                onChange={(e) => setCustomHeight(Math.max(selectedStyle.minSize, Math.min(selectedStyle.maxSize, Number(e.target.value))))}
                className="w-[88px] rounded bg-bg-elevated border border-border-default px-3 py-1.5 pointer-coarse:min-h-11
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
            </div>
          )}
          {selectedStyle.supportsRemoveBg && (
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
          )}
        </div>
        {!selectedStyle.fixedSize && (
          <p className="text-[13px] font-mono text-text-secondary mt-2">
            Larger canvas = more room for detail and extended poses.
          </p>
        )}
      </div>

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
              className="inline-block mt-2 ml-6 px-3 py-1.5 rounded text-xs font-mono
                bg-accent-amber text-bg-primary hover:bg-accent-amber/90 transition-colors"
            >
              Buy Tokens
            </a>
          )}
        </div>
      )}

      {/* Sticky-button bottom spacer — keeps the last form element clear of the fixed bar below */}
      <div className="h-32" aria-hidden="true" />
    </div>

    {/* Sticky generate bar — viewport-fixed at bottom, sidebar-offset on desktop */}
    <div
      className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-width)] z-40 px-4 py-3 backdrop-blur-md border-t isolate transform-gpu overscroll-none"
      style={{
        backgroundColor: 'rgba(20, 18, 16, 0.92)',
        borderColor: '#3a3430',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          {/* One line; the full text is in the title. The ellipsis only eats
              the style and the size: under 640 px the cost and the balance
              lead; from 640 px they come last and never shrink. */}
          <p
            className="min-w-0 sm:flex-1 truncate text-[13px] font-mono text-text-secondary tabular-nums"
            title={summaryText}
          >
            <span className="sm:hidden">
              {summaryCost} &middot; {selectedStyle.label} &middot; {sizeLabel} px
            </span>
            <span className="max-sm:hidden inline-flex max-w-full items-center gap-[1ch] align-bottom">
              <span className="min-w-0 truncate">{selectedStyle.label} &middot; {sizeLabel} px &middot;</span>{' '}
              <span className="flex-shrink-0">{summaryCost}</span>
            </span>
            {isAdmin && (
              <span> &middot; ~${selectedStyle.costPerGeneration.toFixed(2)}</span>
            )}
          </p>
          {/* The reason sits under the button, centered, below 1024 px; from
              1024 px it sits beside it on one line. */}
          <div className="flex flex-col-reverse items-stretch gap-1 flex-shrink-0 lg:flex-row lg:items-center lg:gap-3">
            {disabledReason && (
              <p id={reasonId} className="text-[13px] font-mono text-text-secondary text-center lg:text-right lg:whitespace-nowrap">
                {disabledReason}
              </p>
            )}
            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={GENERATION_PAUSED || !prompt.trim() || isGenerating || insufficientTokens}
              className={`w-full sm:w-auto whitespace-nowrap pointer-coarse:min-h-11 ${!GENERATION_PAUSED && !isGenerating && prompt.trim() && !insufficientTokens ? 'animate-pulse motion-reduce:animate-none' : ''}`}
              title={GENERATION_PAUSED ? GENERATION_PAUSED_MESSAGE : insufficientTokens ? `Need ${tokensNeeded} more ${tokensWord(tokensNeeded)}` : undefined}
              aria-describedby={disabledReason ? reasonId : undefined}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Brewing...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Generate
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    &middot; <PixelCoin /> {formatCount(tokenCost)}
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>

    {/* Style-examples lightbox carousel, opened from the style field's thumbnail. */}
    <StyleExamplesLightbox
      style={lightboxStyle}
      onClose={() => setLightboxStyle(null)}
      onUseStyle={() => {
        if (lightboxStyle) {
          chooseStyle(lightboxStyle.id);
        }
        setLightboxStyle(null);
      }}
    />

    {/* The style picker: a dialog from 768 px, a bottom sheet below. */}
    <StylePicker
      open={pickerOpen}
      currentStyleId={selectedStyleId}
      onChoose={chooseStyle}
      onClose={() => setPickerOpen(false)}
    />
    </>
  );
}

/**
 * The example chips: one row that never wraps; the chips past the row's width
 * scroll sideways inside it. A fade at the right edge shows while more chips
 * sit past it.
 */
function ExampleChips({ onPick }: { onPick: (prompt: string) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => setMoreRight(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    // A ResizeObserver reports once on observe, so this also takes the first measure.
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    row.addEventListener('scroll', measure, { passive: true });
    // Once more when the web font has loaded: the chips' width changes with it.
    let mounted = true;
    if ('fonts' in document) {
      void document.fonts.ready.then(() => {
        if (mounted) measure();
      });
    }
    return () => {
      mounted = false;
      ro.disconnect();
      row.removeEventListener('scroll', measure);
    };
  }, []);

  return (
    <div className="relative mt-3">
      <div ref={rowRef} className="flex flex-nowrap gap-1.5 overflow-x-auto overscroll-x-contain pb-1">
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onPick(ex.prompt)}
            aria-label={`Use example: ${ex.prompt}`}
            title={`Use example: ${ex.prompt}`}
            className="flex-shrink-0 whitespace-nowrap inline-flex items-center min-h-8 pointer-coarse:min-h-11 px-3 rounded-2xl text-[13px] font-mono
              bg-bg-secondary text-text-secondary border border-border-default
              hover:bg-bg-hover hover:text-text-secondary cursor-pointer transition-colors"
          >
            {ex.label}
          </button>
        ))}
      </div>
      {moreRight && (
        <div
          className="pointer-events-none absolute top-0 right-0 bottom-1 w-6 bg-linear-to-r from-transparent to-bg-surface"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
