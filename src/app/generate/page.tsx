'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles, Play, Film, LogIn, X, CheckCircle } from 'lucide-react';
import { Show, SignInButton, useAuth } from '@clerk/react';
import GenerationForm from '@/components/sprites/GenerationForm';
import AnimateForm from '@/components/sprites/AnimateForm';
import TextAnimationForm from '@/components/sprites/TextAnimationForm';
import GenerationResult from '@/components/sprites/GenerationResult';
import LowBalanceBanner from '@/components/sprites/LowBalanceBanner';
import EditorDraftBanner from '@/components/sprites/EditorDraftBanner';
import { addToHistory, loadHistory, type SlicerHints } from '@/lib/generationHistory';
import {
  DEFAULT_TEXT_ANIMATION_ID,
  earlyNoticeMayShow,
  GUIDE_HEADING,
  GUIDE_KEY,
  guideRows,
  guideShows,
  PAGE_LINE,
  TAB_LABELS,
  TAB_ORDER,
  type GenerateTab,
} from '@/lib/generateTabs';
import { useSpriteStore } from '@/stores/spriteStore';
import type { AnimateGeneratedContext } from '@/components/sprites/AnimateForm';
import { useGenerateTab } from '@/hooks/useGenerateTab';
import {
  PURCHASE_BANNER_COPY,
  clearBaseline,
  readPurchaseStatus,
  shownFor,
  takeBaseline,
  watchPurchase,
  type BannerEntry,
  type PurchaseBaseline,
} from '@/lib/purchaseBanner';

const LIMIT_NOTICE_DISMISS_KEY = 'spritebrew_dismissed_limit_notice';

function LimitNoticeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Once per browser: the first render that finds no key shows the notice
    // and writes the key at once, so no later visit shows it.
    try {
      const dismissed = localStorage.getItem(LIMIT_NOTICE_DISMISS_KEY);
      if (!dismissed) {
        localStorage.setItem(LIMIT_NOTICE_DISMISS_KEY, '1');
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(LIMIT_NOTICE_DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-accent-amber/20 bg-accent-amber-glow/50 px-4 py-3">
      <p className="flex-1 text-xs font-mono text-text-secondary leading-relaxed">
        Thanks for being an early user! You received bonus tokens to get started.
        Need more?{' '}
        <a href="/buy-tokens" className="text-accent-amber hover:underline">
          Purchase token packs
        </a>. They never expire.
      </p>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function PurchaseStatusContent() {
  const searchParams = useSearchParams();
  const { userId, getToken } = useAuth();
  const setTokenBalance = useSpriteStore((s) => s.setTokenBalance);
  const [status, setStatus] = useState<'success' | 'cancelled' | null>(null);
  // HQ-14: the banner says only what the evidence shows (src/lib/purchaseBanner.ts).
  // The shown state is tagged with its user, so one user's state is never
  // shown to another (Second's 042), and the ref carries the latch (HQ
  // `2026-10-03-005`) across a restart of the watcher below.
  const [bannerEntry, setBannerEntry] = useState<BannerEntry | null>(null);
  const bannerRef = useRef<BannerEntry | null>(null);
  // The baseline is taken once per return, so a re-run of the effect below
  // keeps it rather than finding storage already emptied.
  const baselineRef = useRef<{ taken: boolean; baseline: PurchaseBaseline | null }>({ taken: false, baseline: null });
  // The return's first-read time, per user, so a restarted watcher keeps the
  // same one-minute window (Second's 044).
  const firstReadRef = useRef<{ userId: string; at: number } | null>(null);

  useEffect(() => {
    const purchase = searchParams.get('purchase');
    if (purchase === 'success' || purchase === 'cancelled') {
      setStatus(purchase);
      window.history.replaceState({}, '', '/generate');
      if (purchase === 'cancelled') clearBaseline();
    }
  }, [searchParams]);

  useEffect(() => {
    if (status !== 'success' || !userId) return;
    if (!baselineRef.current.taken) {
      baselineRef.current = { taken: true, baseline: takeBaseline(userId) };
    }
    // The late line ends this return's reads (HQ `2026-10-03-008`): no restart.
    if (shownFor(bannerRef.current, userId) === 'late') return;
    if (firstReadRef.current?.userId !== userId) firstReadRef.current = { userId, at: Date.now() };
    const controller = new AbortController();
    const baseline = baselineRef.current.baseline;
    void watchPurchase({
      read: () => readPurchaseStatus(getToken, controller.signal),
      baseline: baseline && baseline.userId === userId ? baseline : null,
      previous: shownFor(bannerRef.current, userId),
      startedAt: firstReadRef.current.at,
      onState: (state) => {
        const entry = { userId, state };
        bannerRef.current = entry;
        setBannerEntry(entry);
      },
      onBalance: setTokenBalance,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [status, userId, getToken, setTokenBalance]);

  const bannerState = shownFor(bannerEntry, userId);

  if (status === 'success') {
    if (!bannerState) return null;
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2.5">
        <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
        <p className="flex-1 text-xs font-mono text-green-400">
          {PURCHASE_BANNER_COPY[bannerState]}
        </p>
        <button onClick={() => setStatus(null)} className="p-1 rounded text-green-400/70 hover:text-green-400 cursor-pointer">
          <X size={14} />
        </button>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-surface px-4 py-2.5">
        <p className="flex-1 text-xs font-mono text-text-muted">
          Purchase cancelled. No charges were made.
        </p>
        <button onClick={() => setStatus(null)} className="p-1 rounded text-text-muted hover:text-text-primary cursor-pointer">
          <X size={14} />
        </button>
      </div>
    );
  }

  return null;
}

const TAB_ICONS = { create: Sparkles, text: Film, animate: Play } as const;

/** Whether the first-visit guide has shown in this page load (a reload starts
 *  over): the early-user notice waits for a later load (earlyNoticeMayShow). */
const guideLoad = { shown: false };

/** Whether the first-visit guide shows for this account in this browser
 *  (generateTabs.ts guideShows): null until the browser has been read. */
function readGuide(userId: string | null | undefined): boolean {
  let storageReadable = true;
  let keySet = false;
  try {
    keySet = localStorage.getItem(GUIDE_KEY) !== null;
  } catch {
    storageReadable = false;
  }
  let recentCount: number | null = null;
  try {
    recentCount = loadHistory(userId).length;
  } catch {
    recentCount = null;
  }
  return guideShows({ signedIn: !!userId, storageReadable, keySet, recentCount });
}

/** The first-visit guide (generate-pass.md section 1): three rows, each
 *  choosing its tab and closing the guide; "Got it" and the X close it. */
function FirstVisitGuide({ onChoose, onClose }: { onChoose: (tab: GenerateTab) => void; onClose: () => void }) {
  return (
    <section aria-labelledby="generate-guide-heading" className="rounded-lg border border-accent-amber/30 bg-bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 id="generate-guide-heading" className="text-[13px] font-mono text-text-primary">{GUIDE_HEADING}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the guide"
          className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 -mt-1 -mr-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {guideRows().map((row) => {
          const Icon = TAB_ICONS[row.tab];
          return (
            <li key={row.tab}>
              <button
                type="button"
                onClick={() => onChoose(row.tab)}
                className="flex w-full items-start gap-2 min-h-11 rounded-md px-2 py-2 text-left text-xs font-mono text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer"
              >
                <Icon size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0 text-accent-amber" />
                <span>{row.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center min-h-8 pointer-coarse:min-h-11 px-3 rounded-md text-xs font-mono text-accent-amber hover:bg-bg-hover cursor-pointer"
        >
          Got it
        </button>
      </div>
    </section>
  );
}

// Daily-login + signup reward claim is handled by the Sidebar's StreakIndicator
// hydration on mount, so it works on every signed-in page (not just Generate).
// Server-side flags make the POST idempotent.

export default function GeneratePage() {
  const { userId } = useAuth();
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);
  const setAnimateMode = useSpriteStore((s) => s.setAnimateMode);
  const setCurrentSheetMetadata = useSpriteStore((s) => s.setCurrentSheetMetadata);

  // The tab, and which form finishes a saved generation: the Animate form
  // despills an animation and shows its rescue notice, which the Create form
  // does not (paused-message audit; Second 073, 090). See useGenerateTab. Its
  // first value reads localStorage, so it must never meet server markup:
  // every use of `tab` stays inside the signed-in Show below, which renders
  // nothing on the server.
  const { tab, pickTab } = useGenerateTab();
  const [showForm, setShowForm] = useState(true);
  const prevDataUrl = useRef(generatedImageDataUrl);
  // Animate from Text's chosen card, kept here so the result card's tips
  // can read it; kept for the account that chose it, so another account
  // starts on the default (AUDIT g1-tabs-r1 L2).
  const [textCard, setTextCard] = useState<{ account: string | null | undefined; id: string }>({ account: null, id: DEFAULT_TEXT_ANIMATION_ID });
  const textStyleId = textCard.account === userId ? textCard.id : DEFAULT_TEXT_ANIMATION_ID;
  const setTextStyleId = useCallback((id: string) => setTextCard({ account: userId, id }), [userId]);

  // The tabs' buttons, for the arrow keys and for the focus after the guide.
  const tabRefs = useRef<Record<GenerateTab, HTMLButtonElement | null>>({ create: null, text: null, animate: null });

  // The first-visit guide: null until this account's browser is read. While
  // it shows, the early-user notice waits, its key unwritten; and in a page
  // load whose guide has shown, it waits for a later load, however the guide
  // closes (AUDIT g1-tabs-r1 M1). The guide's key is written the moment it
  // closes, and the focus goes to the tab then chosen (L1).
  const [guide, setGuide] = useState<{ userId: string | null | undefined; show: boolean } | null>(null);
  if (userId && guide?.userId !== userId) setGuide({ userId, show: readGuide(userId) });
  const guideShowing = !!userId && guide?.userId === userId && guide.show;
  useEffect(() => {
    if (guideShowing) guideLoad.shown = true;
  }, [guideShowing]);
  const closeGuide = useCallback((focusTab: GenerateTab | null) => {
    try {
      localStorage.setItem(GUIDE_KEY, '1');
    } catch { /* storage unavailable: the guide closes for this visit */ }
    setGuide((g) => (g ? { ...g, show: false } : g));
    if (focusTab) tabRefs.current[focusTab]?.focus();
  }, []);

  useEffect(() => {
    if (generatedImageDataUrl && generatedImageDataUrl !== prevDataUrl.current) {
      setShowForm(false);
    }
    prevDataUrl.current = generatedImageDataUrl;
  }, [generatedImageDataUrl]);

  // A tab press, Send to Animator or a page request: the user's pick. Every
  // tab press shows that tab's form and bar, after a result too
  // (generate-pass.md section 1).
  const handleTabChange = useCallback(
    (newTab: GenerateTab) => {
      pickTab(newTab);
      setAnimateMode(newTab === 'animate' ? 'animate' : 'create');
      setShowForm(true);
    },
    [pickTab, setAnimateMode]
  );

  // The store's mode follows the tab, including a tab opened on a saved job:
  // Animate from Text's jobs are create jobs.
  useEffect(() => {
    setAnimateMode(tab === 'animate' ? 'animate' : 'create');
  }, [tab, setAnimateMode]);

  // A guide row chooses its tab and closes the guide; Got it and the X close
  // it on the tab already chosen.
  const chooseFromGuide = useCallback(
    (next: GenerateTab) => {
      handleTabChange(next);
      closeGuide(next);
    },
    [handleTabChange, closeGuide]
  );
  const dismissGuide = useCallback(() => closeGuide(tab), [closeGuide, tab]);
  // The guide also closes, writing its key, at the person's first input in a
  // form (typing, a card, a chip, a switch) and at a press of Generate; the
  // focus stays where the person is (DESIGN room 2026-11-18-097, L5).
  const closeGuideOnInput = useCallback(() => {
    if (guideShowing) closeGuide(null);
  }, [guideShowing, closeGuide]);

  // The tabs: arrow keys move the focus; Enter, Space or a click chooses
  // (manual activation). Choosing never moves the focus into the form.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const edge = e.key === 'Home' ? 0 : e.key === 'End' ? TAB_ORDER.length - 1 : -1;
    if (!step && edge < 0) return;
    e.preventDefault();
    const at = TAB_ORDER.findIndex((t) => tabRefs.current[t] === document.activeElement);
    const from = at >= 0 ? at : TAB_ORDER.indexOf(tab);
    const next = edge >= 0 ? edge : (from + step + TAB_ORDER.length) % TAB_ORDER.length;
    tabRefs.current[TAB_ORDER[next]]?.focus();
  };

  // Send-to-Animator handoff: when GenerationResult sets the flag and pushes
  // /generate, we're already on this route so GeneratePage does NOT remount.
  // Reactive subscription watches the flag and flips the tab so AnimateForm
  // mounts. AnimateForm's own effect then consumes-and-clears the flag.
  // We deliberately do NOT clear the flag here — that's AnimateForm's job.
  const pendingAnimatorHandoff = useSpriteStore((s) => s.pendingAnimatorHandoff);
  useEffect(() => {
    if (pendingAnimatorHandoff) {
      // Force the form area open BEFORE the tab flip — otherwise the
      // "Generation complete!" placeholder keeps rendering and AnimateForm
      // never mounts, so its consume effect never fires and AutoPrep never
      // appears. See diagnostic on commit 291f228.
      setShowForm(true);
      if (tab !== 'animate') {
        handleTabChange('animate');
      }
    }
  }, [pendingAnimatorHandoff, tab, handleTabChange]);

  const handleGenerated = useCallback(async (
    dataUrl: string,
    prompt: string,
    style: string,
    animateContext?: AnimateGeneratedContext,
    jobId?: string
  ) => {
    // Determine mode + action from the style key
    const isAnimate = style.startsWith('any_animation_');
    const action = isAnimate ? style.replace('any_animation_', '') : undefined;

    // Build slicerHints for animate-mode results. Frame count comes from
    // the AnimateForm's animateContext (previously hardcoded to 4). When
    // the sheet was rescued (consumer commit 0d71a88), prefer
    // deliveredFrames — the rescue is a fixed 64×64 output whose actual
    // frame count differs from what the user requested. frameSize is the
    // delivered cell size from animateContext; rows is left unset so the
    // slicer derives the grid from frameSize and the image.
    const ANIMATE_ACTION_TO_SLICER_TYPE: Record<string, string> = {
      walking: 'walk', idle: 'idle', attack: 'attack', jump: 'jump',
      crouch: 'crouch', destroy: 'destroy', subtle_motion: 'subtle', custom_action: 'custom',
    };
    let slicerHints: SlicerHints | undefined;
    if (isAnimate && action) {
      const rescueInfo = animateContext?.rescueInfo;
      const rescuedFrames = rescueInfo?.deliveredFrames;
      const requestedFrames = animateContext?.frameCount ?? 4;
      const frameCount =
        typeof rescuedFrames === 'number' && rescuedFrames > 0
          ? rescuedFrames
          : requestedFrames;
      const frameSize = animateContext?.frameSize;
      slicerHints = {
        source: 'animate',
        animationType: ANIMATE_ACTION_TO_SLICER_TYPE[action] ?? 'custom',
        frameCount,
        directional: false,
        ...(typeof frameSize === 'number' ? { frameSize } : {}),
        ...(rescueInfo ? { rescued: true } : {}),
      };
    }

    // Carry the hints to the slicer on the result card's Send to Slicer.
    // Create results clear any hints left from an earlier animation.
    setCurrentSheetMetadata(slicerHints ?? null);

    // The job's id keeps it to one Recent entry when two tabs of this
    // browser finish the same job.
    await addToHistory({
      userId,
      prompt,
      style,
      mode: isAnimate ? 'animate' : 'create',
      action,
      fullImageDataUrl: dataUrl,
      slicerHints,
      jobId,
    });
  }, [userId, setCurrentSheetMetadata]);

  const handleReset = useCallback(() => {
    setShowForm(true);
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">AI Generate</h1>
        <p className="text-sm font-mono text-text-secondary">
          {PAGE_LINE}
        </p>
      </div>

      {/* Signed-out gate */}
      <Show when="signed-out">
        <div className="max-w-xl mx-auto rounded-lg border-2 border-accent-amber/40 bg-bg-surface p-10 text-center glow-amber">
          <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-accent-amber-glow mx-auto mb-5">
            <Sparkles size={32} className="text-accent-amber" />
          </div>
          <h2 className="font-display text-[11px] text-accent-amber mb-3 leading-relaxed">
            Sign in to Generate
          </h2>
          <p className="text-sm font-mono text-text-secondary mb-1">
            Create a free account to start generating AI pixel art sprite sheets.
          </p>
          <p className="text-xs font-mono text-text-muted mb-6">
            Upload, slice, preview, and export are always free, with no login needed.
          </p>
          <SignInButton mode="modal">
            <button className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md
              bg-accent-amber text-bg-primary text-sm font-mono font-semibold
              hover:bg-accent-amber-strong cursor-pointer transition-colors animate-pulse">
              <LogIn size={16} />
              Sign In for Free
            </button>
          </SignInButton>
          <p className="mt-4 text-[10px] font-mono text-text-muted">
            GitHub or email. Takes 10 seconds.
          </p>
        </div>
      </Show>

      {/* Two-column layout — signed-in only */}
      {/* Keep every use of `tab` inside this Show: its first value reads
          localStorage, and Show renders nothing on the server. */}
      <Show when="signed-in">
      {/* Editor work a reload or a crash interrupted (BUILD 2026-10-29). */}
      <EditorDraftBanner />
      <Suspense fallback={null}>
        <PurchaseStatusContent />
      </Suspense>
      <LowBalanceBanner />
      {/* The guide comes first: the early-user notice waits until it has closed
          on an earlier visit, and never shows beside it. */}
      {earlyNoticeMayShow({ guideKnown: guide !== null && guide.userId === userId, guideShowing, guideShownThisLoad: guideLoad.shown }) && <LimitNoticeBanner />}
      {guideShowing && <FirstVisitGuide onChoose={chooseFromGuide} onClose={dismissGuide} />}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form — left 3/5 */}
        <div className="lg:col-span-3 space-y-4 min-w-0">
          {/* The three tabs: a 3-column grid, icon over label, under 1024 px. */}
          <div
            role="tablist"
            aria-label="What to make"
            onKeyDown={onTabKey}
            className="grid grid-cols-3 gap-1 rounded-lg bg-bg-secondary p-1 lg:flex lg:w-fit"
          >
            {TAB_ORDER.map((t) => {
              const Icon = TAB_ICONS[t];
              const selected = tab === t;
              return (
                <button
                  key={t}
                  ref={(el) => { tabRefs.current[t] = el; }}
                  type="button"
                  role="tab"
                  id={`generate-tab-${t}`}
                  aria-selected={selected}
                  aria-controls="generate-tab-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => handleTabChange(t)}
                  className={`flex flex-col items-center justify-center gap-1 min-h-11 px-2 py-2 rounded-md text-xs font-mono text-center cursor-pointer transition-colors
                    lg:flex-row lg:gap-2 lg:px-4
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber
                    ${selected
                      ? 'bg-accent-amber text-bg-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                    }`}
                >
                  <Icon size={14} aria-hidden="true" />
                  {TAB_LABELS[t]}
                </button>
              );
            })}
          </div>

          {/* Form content */}
          <div
            id="generate-tab-panel"
            role="tabpanel"
            aria-labelledby={`generate-tab-${tab}`}
            className="rounded-lg border border-border-default bg-bg-surface p-6"
            onInputCapture={closeGuideOnInput}
            onClickCapture={(e) => {
              if ((e.target as Element).closest('button, a, [role=radio], [role=switch], input')) closeGuideOnInput();
            }}
          >
            {showForm || !generatedImageDataUrl ? (
              tab === 'create' ? (
                <GenerationForm onGenerated={handleGenerated} guideShowing={guideShowing} />
              ) : tab === 'text' ? (
                <TextAnimationForm
                  onGenerated={handleGenerated}
                  guideShowing={guideShowing}
                  styleId={textStyleId}
                  onStyleChange={setTextStyleId}
                />
              ) : (
                <AnimateForm onGenerated={handleGenerated} />
              )
            ) : (
              <div className="text-center py-8">
                <p className="text-sm font-mono text-text-secondary mb-3">
                  Generation complete!
                </p>
                <button
                  onClick={() => setShowForm(true)}
                  className="text-xs font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer"
                >
                  Show form to generate another
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Result — right 2/5 */}
        <div className="lg:col-span-2 min-w-0">
          <div className="rounded-lg border border-border-default bg-bg-surface p-6">
            <GenerationResult onReset={handleReset} tab={tab} textStyleId={textStyleId} />
          </div>
        </div>
      </div>
      </Show>
    </div>
  );
}
