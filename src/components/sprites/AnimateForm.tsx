'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  UploadCloud,
  X,
  Check,
  Loader2,
  AlertCircle,
  Play,
  Lock,
  Save,
} from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import CharacterAutoPrep from './CharacterAutoPrep';
import {
  getTokenCost,
  getResolutionMode,
  ADVANCED_ANIM_RESOLUTION_PRESETS,
  ADVANCED_ANIM_DEFAULT_RESOLUTION,
} from '@/lib/styleRegistry';
import { fetchGeneration, consumeSSEStream, type Payload } from '@/lib/sseClient';
import { useGenerationPoll } from '@/hooks/useGenerationPoll';
import {
  loadLatestConfig,
  saveLatestConfig,
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  MAX_TEMPLATES,
  MAX_TEMPLATE_NAME_LEN,
  type AnimateTemplate,
} from '@/lib/animateConfig';

const ACTIONS = [
  { id: 'walking', name: 'Walk', desc: 'Walking cycle animation' },
  { id: 'idle', name: 'Idle', desc: 'Breathing/subtle idle loop' },
  { id: 'attack', name: 'Attack', desc: 'Melee attack swing' },
  { id: 'jump', name: 'Jump', desc: 'Jump arc animation' },
  { id: 'crouch', name: 'Crouch', desc: 'Crouch/duck animation' },
  { id: 'destroy', name: 'Destroy', desc: 'Death/destruction animation' },
  { id: 'subtle_motion', name: 'Subtle Motion', desc: 'Wind, cape flutter, ambient' },
  { id: 'custom_action', name: 'Custom Action', desc: 'Describe any action' },
] as const;

/** Actions where the character needs margin for weapon swings / motion FX. */
const PADDING_ON_ACTIONS = new Set([
  'attack',
  'jump',
  'destroy',
  'custom_action',
]);

/** Map action id to the RD prompt_style for token cost lookup. */
const ACTION_STYLE_MAP: Record<string, string> = {
  walking: 'rd_advanced_animation__walking',
  idle: 'rd_advanced_animation__idle',
  attack: 'rd_advanced_animation__attack',
  jump: 'rd_advanced_animation__jump',
  crouch: 'rd_advanced_animation__crouch',
  destroy: 'rd_advanced_animation__destroy',
  subtle_motion: 'rd_advanced_animation__subtle_motion',
  custom_action: 'rd_advanced_animation__custom_action',
};

const FRAME_COUNTS = [4, 6, 8, 10, 12, 16] as const;

const BG_COLORS = [
  { id: 'black', label: 'Black', color: '#000000' },
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'green', label: 'Green', color: '#00ff00' },
  { id: 'magenta', label: 'Magenta', color: '#ff00ff' },
] as const;

interface AnimateFormProps {
  onGenerated: (dataUrl: string, prompt: string, style: string) => void;
}

export default function AnimateForm({ onGenerated }: AnimateFormProps) {
  const { userId, getToken } = useAuth();
  const setGenerating = useSpriteStore((s) => s.setGenerating);
  const setGeneratingAction = useSpriteStore((s) => s.setGeneratingAction);
  const setGenerationError = useSpriteStore((s) => s.setGenerationError);
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setOriginalCharacter = useSpriteStore((s) => s.setOriginalCharacter);
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

  // Queue-and-poll integration. Auto-resumes from localStorage on mount
  // when a fresh-enough activeJob entry exists.
  const poll = useGenerationPoll();

  // Send-to-Animator handoff consumers. Reactive subscriptions (not getState()
  // on mount) because GenerationResult lives on the same /generate route —
  // GeneratePage flips the tab, AnimateForm mounts, AND THEN this effect
  // fires to consume the flag. The decode-and-preload path mirrors
  // handleFileUpload exactly so the flow downstream (AutoPrep modal →
  // accept → "Character ready") is identical to a manual upload.
  const pendingAnimatorHandoff = useSpriteStore((s) => s.pendingAnimatorHandoff);
  const pendingAnimatorSkipBgRemoval = useSpriteStore((s) => s.pendingAnimatorSkipBgRemoval);
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);
  const clearPendingAnimatorHandoff = useSpriteStore((s) => s.clearPendingAnimatorHandoff);
  const clearPendingAnimatorSkipBgRemoval = useSpriteStore((s) => s.clearPendingAnimatorSkipBgRemoval);

  // Captures click-time action/motion so the poll-success effect can write
  // history with the right context. Null on resume.
  const inFlightRef = useRef<{ action: string; motionPrompt: string } | null>(null);

  // 1s click-debounce (one-render race window beyond isGenerating).
  const lastGenerateAtRef = useRef<number>(0);

  // Snap-effect guards for the auto-restore flow. Two existing useEffects
  // (PADDING_ON_ACTIONS auto-toggle and the resolution snap) watch action /
  // currentMode changes and overwrite paddingEnabled / selectedResolution
  // with the action's defaults. Without these guards, auto-restore would
  // set selectedAction to the saved value, then the snap effects would
  // fire in the next commit and clobber paddingEnabled / selectedResolution
  // back to the action's defaults — half-fixed bug.
  //
  // Strategy: TWO refs, one per snap effect, each consumed by its own
  // effect (so neither steals the other's skip). Refs are set to true
  // INSIDE the auto-restore effect AFTER all setters fire, so the snap
  // effects in the post-restore commit see them as true and skip exactly
  // once. The auto-restore effect is placed AFTER the snap effects in
  // source order so commit-1 (initial-mount, default deps) snap effects
  // fire BEFORE the refs get set — those no-op default snaps don't
  // consume the refs.
  const restoringPaddingRef = useRef(false);
  const restoringResolutionRef = useRef(false);

  // Character state
  const [characterDataUrl, setCharacterDataUrl] = useState<string | null>(null);
  const [charWidth, setCharWidth] = useState(0);
  const [charHeight, setCharHeight] = useState(0);
  const [hasAlpha, setHasAlpha] = useState(false);
  // Captured from spriteStore.pendingAnimatorSkipBgRemoval at handoff-consume
  // time, forwarded to CharacterAutoPrep as initialSkipBgRemoval. Reset to
  // false on manual file upload so the handoff preference only applies to
  // handoff-sourced characters.
  const [handoffSkipBgRemoval, setHandoffSkipBgRemoval] = useState(false);
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [pendingWidth, setPendingWidth] = useState(0);
  const [pendingHeight, setPendingHeight] = useState(0);
  const [bgColor, setBgColor] = useState('#ff00ff');
  const [paddingEnabled, setPaddingEnabled] = useState(false);
  const [characterSizePct, setCharacterSizePct] = useState(75);
  const [selectedAction, setSelectedAction] = useState('walking');
  const [frameCount, setFrameCount] = useState<number>(4);
  const [motionPrompt, setMotionPrompt] = useState('');
  const [selectedResolution, setSelectedResolution] = useState<number>(ADVANCED_ANIM_DEFAULT_RESOLUTION);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Named templates (v0.5.12 Piece B). Backed by spritebrew:animate:templates.
  // Templates are character-agnostic — only the 7 config fields are persisted.
  const [templates, setTemplates] = useState<AnimateTemplate[]>([]);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveInputValue, setSaveInputValue] = useState('');
  const [templateError, setTemplateError] = useState<string | null>(null);

  // Token cost depends on selected action
  const actionPromptStyle = ACTION_STYLE_MAP[selectedAction] ?? 'rd_advanced_animation__walking';
  const tokenCost = getTokenCost(actionPromptStyle);
  const insufficientTokens = tokenBalance < tokenCost;
  const tokensNeeded = tokenCost - tokenBalance;

  // Resolution mode for the currently selected action's prompt style.
  // Family B (rd_advanced_animation__*) always returns a 'variable' mode 32–256.
  // If a future action ever maps to a Family A style, the mode adapts.
  const currentMode = useMemo(
    () => getResolutionMode(actionPromptStyle) ?? { kind: 'variable' as const, min: 32 as const, max: 256 as const, default: ADVANCED_ANIM_DEFAULT_RESOLUTION },
    [actionPromptStyle]
  );

  // Auto-toggle animation padding based on selected action.
  // Skip exactly once when auto-restore set selectedAction — the saved
  // paddingEnabled should win over the action's default.
  useEffect(() => {
    if (restoringPaddingRef.current) {
      restoringPaddingRef.current = false;
      return;
    }
    setPaddingEnabled(PADDING_ON_ACTIONS.has(selectedAction));
  }, [selectedAction]);

  // When the selected action's mode changes, snap selectedResolution to its default/locked size.
  // Same one-shot skip pattern as the padding snap above.
  useEffect(() => {
    if (restoringResolutionRef.current) {
      restoringResolutionRef.current = false;
      return;
    }
    const newSize = currentMode.kind === 'locked' ? currentMode.size : currentMode.default;
    setSelectedResolution((prev) => (prev === newSize ? prev : newSize));
  }, [currentMode]);

  // Auto-restore last-used config on mount. Placed AFTER the snap effects
  // in source order so the initial-mount snap effects fire FIRST with
  // default deps (those default snaps are no-ops and don't consume the
  // skip refs). When this effect runs, it sets the refs to true AFTER
  // calling the setters; the post-restore commit's snap effects then
  // consume the refs and skip, preserving the restored paddingEnabled /
  // selectedResolution.
  //
  // Read inside useEffect (never during render) — no SSR hydration risk
  // and no first-paint flash because the effect fires after first commit.
  useEffect(() => {
    const saved = loadLatestConfig();
    if (!saved) return;
    setSelectedAction(saved.selectedAction);
    setFrameCount(saved.frameCount);
    setMotionPrompt(saved.motionPrompt);
    setSelectedResolution(saved.selectedResolution);
    setBgColor(saved.bgColor);
    setPaddingEnabled(saved.paddingEnabled);
    setCharacterSizePct(saved.characterSizePct);
    // Tell the snap effects to skip their next fire (the post-restore
    // commit). Set AFTER the setters so the refs aren't consumed by
    // commit-1's no-op default snaps.
    restoringPaddingRef.current = true;
    restoringResolutionRef.current = true;
  }, []);

  // Mount-only: hydrate templates list from localStorage. Read inside
  // useEffect (never during render) — no SSR hydration mismatch.
  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  // Auto-save (debounced 200ms) — writes the seven form-config fields on
  // every change. NOT included: character image, pendingDataUrl, handoff
  // one-shots, or any AutoPrep companion state. Persists the user's
  // last-used config indefinitely (no clear-on-generation-success — least
  // surprising behavior).
  useEffect(() => {
    const t = setTimeout(() => {
      saveLatestConfig({
        v: 1,
        selectedAction,
        frameCount,
        motionPrompt,
        selectedResolution,
        bgColor,
        paddingEnabled,
        characterSizePct,
      });
    }, 200);
    return () => clearTimeout(t);
  }, [
    selectedAction,
    frameCount,
    motionPrompt,
    selectedResolution,
    bgColor,
    paddingEnabled,
    characterSizePct,
  ]);

  // Consume the Send-to-Animator handoff. When the flag is set AND a
  // generated image is available, clear any existing character state
  // (mirrors handleRemoveChar) so the AutoPrep modal doesn't race a
  // stale "Character ready" card, then decode the data URL to extract
  // dimensions and feed pendingDataUrl exactly the way handleFileUpload
  // does. The flag is consumed here (not in GeneratePage's tab-flip
  // effect) — single-consumer to avoid double-fire.
  useEffect(() => {
    if (!pendingAnimatorHandoff || !generatedImageDataUrl) return;

    // Capture the skip-bg preference BEFORE clearing the flag — otherwise
    // the AutoPrep modal would mount with the default (false) and ignore
    // the user's result-side choice.
    setHandoffSkipBgRemoval(pendingAnimatorSkipBgRemoval);

    // Consume both flags immediately, before the async image decode, so a
    // re-render mid-load can't trigger this effect a second time.
    clearPendingAnimatorHandoff();
    clearPendingAnimatorSkipBgRemoval();

    // Clear stale character state (mirrors handleRemoveChar's character
    // half — but keep selected action / frame count / resolution so the
    // user's form selections survive the handoff).
    setCharacterDataUrl(null);
    setCharWidth(0);
    setCharHeight(0);
    setHasAlpha(false);

    const img = new Image();
    img.onload = () => {
      setPendingDataUrl(generatedImageDataUrl);
      setPendingWidth(img.naturalWidth);
      setPendingHeight(img.naturalHeight);
    };
    img.onerror = () => {
      console.error('[animator handoff] Failed to decode preloaded character');
    };
    img.src = generatedImageDataUrl;
  }, [pendingAnimatorHandoff, pendingAnimatorSkipBgRemoval, generatedImageDataUrl, clearPendingAnimatorHandoff, clearPendingAnimatorSkipBgRemoval]);

  // When resolution changes after a character is already prepped, invalidate it
  // so the user re-runs Auto-Prep at the new size. This is simpler and more
  // reliable than trying to silently re-resize the prepped image.
  const handleResolutionChange = useCallback((newRes: number) => {
    if (newRes === selectedResolution) return;
    setSelectedResolution(newRes);
    // If character was already prepped at a different size, clear it
    if (characterDataUrl && (charWidth !== newRes || charHeight !== newRes)) {
      setCharacterDataUrl(null);
      setCharWidth(0);
      setCharHeight(0);
      setHasAlpha(false);
      // Re-show the pending image so Auto-Prep can re-run at new size
      // (only if we still have the original upload)
    }
  }, [selectedResolution, characterDataUrl, charWidth, charHeight]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type !== 'image/png') {
      useSpriteStore.getState().setGenerationError('Please upload a PNG file.');
      return;
    }

    // Manual upload — reset any lingering handoff preference so it only
    // applies to the original handoff-sourced character.
    setHandoffSkipBgRemoval(false);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setPendingDataUrl(dataUrl);
        setPendingWidth(img.naturalWidth);
        setPendingHeight(img.naturalHeight);
        setCharacterDataUrl(null);
        setCharWidth(0);
        setCharHeight(0);
        setHasAlpha(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveChar = useCallback(() => {
    setCharacterDataUrl(null);
    setCharWidth(0);
    setCharHeight(0);
    setHasAlpha(false);
    setPendingDataUrl(null);
    setPendingWidth(0);
    setPendingHeight(0);
  }, []);

  const handleAutoPrepAccept = useCallback(
    (preparedDataUrl: string, w: number, h: number) => {
      setCharacterDataUrl(preparedDataUrl);
      setCharWidth(w);
      setCharHeight(h);
      setHasAlpha(true);
      setPendingDataUrl(null);
      setPendingWidth(0);
      setPendingHeight(0);
    },
    []
  );

  const handleAutoPrepCancel = useCallback(() => {
    setPendingDataUrl(null);
    setPendingWidth(0);
    setPendingHeight(0);
  }, []);

  // Template handlers (v0.5.12 Piece B).
  //
  // Load: writes all 7 config fields from the template, then sets BOTH
  // snap-effect-guard refs to true — same pattern as the Piece A
  // auto-restore effect. Without this, the post-load commit's padding /
  // resolution snap effects would clobber the just-loaded paddingEnabled
  // and selectedResolution back to the action's defaults.
  //
  // The auto-save cascade is automatic: the seven setters change the
  // Piece A auto-save effect's deps, which then writes the loaded values
  // to spritebrew:animate:latest after the 200ms debounce. No special
  // wiring needed.
  const handleLoadTemplate = useCallback((tpl: AnimateTemplate) => {
    const c = tpl.config;
    setSelectedAction(c.selectedAction);
    setFrameCount(c.frameCount);
    setMotionPrompt(c.motionPrompt);
    setSelectedResolution(c.selectedResolution);
    setBgColor(c.bgColor);
    setPaddingEnabled(c.paddingEnabled);
    setCharacterSizePct(c.characterSizePct);
    restoringPaddingRef.current = true;
    restoringResolutionRef.current = true;
    setTemplateError(null);
  }, []);

  // Save: pre-flight validates name and cap so we can surface specific
  // errors. saveTemplate returns null on cap/empty-name/persistence
  // failure; UI already gated the first two so a null here means
  // localStorage rejected the write (quota, disabled).
  const handleSaveTemplate = useCallback(() => {
    const name = saveInputValue.trim();
    if (!name) {
      setTemplateError('Name required.');
      return;
    }
    if (templates.length >= MAX_TEMPLATES) {
      setTemplateError(`Template limit reached (${MAX_TEMPLATES}). Delete some to save more.`);
      return;
    }
    const updated = saveTemplate(name, {
      v: 1,
      selectedAction,
      frameCount,
      motionPrompt,
      selectedResolution,
      bgColor,
      paddingEnabled,
      characterSizePct,
    });
    if (!updated) {
      setTemplateError("Couldn't save template — storage may be full.");
      return;
    }
    setTemplates(updated);
    setShowSaveInput(false);
    setSaveInputValue('');
    setTemplateError(null);
  }, [
    saveInputValue,
    templates.length,
    selectedAction,
    frameCount,
    motionPrompt,
    selectedResolution,
    bgColor,
    paddingEnabled,
    characterSizePct,
  ]);

  const handleDeleteTemplate = useCallback((id: string) => {
    const updated = deleteTemplate(id);
    if (!updated) {
      setTemplateError("Couldn't delete template.");
      return;
    }
    setTemplates(updated);
    setTemplateError(null);
  }, []);

  const handleCancelSaveInput = useCallback(() => {
    setShowSaveInput(false);
    setSaveInputValue('');
    setTemplateError(null);
  }, []);

  /** Convert the uploaded RGBA image to RGB by compositing onto bgColor */
  const convertToRgbBase64 = useCallback((): string | null => {
    if (!characterDataUrl) return null;

    const img = new Image();
    img.src = characterDataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = charWidth;
    canvas.height = charHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, charWidth, charHeight);
    ctx.drawImage(img, 0, 0);

    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  }, [characterDataUrl, charWidth, charHeight, bgColor]);

  const handleGenerate = useCallback(async () => {
    if (!characterDataUrl || isGenerating) return;

    // 1s click-debounce.
    const clickedAt = Date.now();
    if (clickedAt - lastGenerateAtRef.current < 1_000) return;
    lastGenerateAtRef.current = clickedAt;

    const rgbBase64 = convertToRgbBase64();
    if (!rgbBase64) return;

    setGenerating(true);
    setGeneratingAction(selectedAction);
    setGenerationError(null);
    setOriginalCharacter(characterDataUrl);
    poll.reset();

    // Click-time context for the poll-success effect.
    const capturedAction = selectedAction;
    const capturedMotion = motionPrompt.trim();

    let tookPollPath = false;

    try {
      const body: Payload = {
        mode: 'animate',
        inputImage: rgbBase64,
        action: capturedAction,
        width: selectedResolution,
        height: selectedResolution,
        framesDuration: frameCount,
      };

      if (capturedMotion) {
        body.motionPrompt = capturedMotion;
      }

      // Per-attempt UUID — required by the queue-kickoff path; legacy SSE ignores it.
      const idempotencyKey = crypto.randomUUID();
      body.idempotencyKey = idempotencyKey;

      const sessionToken = await getToken();
      const result = await fetchGeneration(body, sessionToken);

      if (result.mode === 'poll') {
        tookPollPath = true;
        inFlightRef.current = { action: capturedAction, motionPrompt: capturedMotion };
        poll.startPolling(result.jobId, idempotencyKey, 'animate');
        return;
      }

      // Legacy SSE path — byte-identical to pre-refactor behavior.
      const data = await consumeSSEStream(result.response);

      if (!data.success) {
        setGenerationError(String(data.error ?? 'Animation failed — try again.'));
        return;
      }

      const dataUrl = data.imageUrl!;

      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(`any_animation_${capturedAction}`);
      await fetchBalance();
      onGenerated(dataUrl, capturedMotion || capturedAction, `any_animation_${capturedAction}`);
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
          `You need ${errObj.required} tokens for this animation, but you have ${errObj.balance}. Try a cheaper action or buy more tokens!`
        );
        setTokenBalance(errObj.balance);
        return;
      }
      setGenerationError(`Generation failed: ${msg} (your tokens are safe)`);
    } finally {
      // Poll path keeps generating state alive until the poll-effect terminates.
      if (!tookPollPath) {
        setGenerating(false);
        setGeneratingAction(null);
      }
    }
  }, [
    characterDataUrl, isGenerating, selectedAction, selectedResolution, charWidth, charHeight,
    frameCount, motionPrompt, convertToRgbBase64, tokenCost, getToken,
    setGenerating, setGeneratingAction, setGenerationError, setGeneratedImage,
    setGenerationStyle, setOriginalCharacter, setTokenBalance, fetchBalance, onGenerated, poll,
  ]);

  // Poll-effect: react to terminal states from the queue path.
  useEffect(() => {
    if (poll.status === 'polling') {
      // Resume — mirror to global isGenerating so the UI shows "Brewing…".
      setGenerating(true);
      return;
    }
    if (poll.status === 'success' && poll.result) {
      const dataUrl = `data:image/png;base64,${poll.result.resultBase64}`;
      setGeneratedImage(dataUrl, dataUrl);
      const ctx = inFlightRef.current;
      if (ctx) {
        setGenerationStyle(`any_animation_${ctx.action}`);
        void fetchBalance();
        onGenerated(
          dataUrl,
          ctx.motionPrompt || ctx.action,
          `any_animation_${ctx.action}`
        );
        inFlightRef.current = null;
      }
      setGenerating(false);
      setGeneratingAction(null);
      poll.reset();
      return;
    }
    if (poll.status === 'error' || poll.status === 'abandoned') {
      const rawMessage = poll.error?.message ?? 'Animation failed.';
      const refundedNote = poll.error?.refunded ? ' Your tokens have been refunded.' : '';

      // Friendly error wrapping: convert technical upstream errors to
      // customer-facing copy. Keep raw error in console for diagnostics.
      const isUpstreamError =
        rawMessage.startsWith('RD ') ||
        rawMessage.includes('inference_failed') ||
        rawMessage.includes('Unexpected response') ||
        rawMessage.includes('timed out');

      const customerMessage = isUpstreamError
        ? `Animation failed due to a temporary issue with the AI service.${refundedNote} Please try again in a few minutes, or try a smaller frame count (6 or 8) if the issue persists.`
        : `${rawMessage}${refundedNote}`;

      console.error('[generation error]', { rawMessage, errorCode: poll.error?.errorCode });
      setGenerationError(customerMessage);

      // Refresh token balance to reflect any refund that fired server-side
      void fetchBalance();

      setGenerating(false);
      setGeneratingAction(null);
      inFlightRef.current = null;
      poll.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.status, poll.result, poll.error]);

  const sizeWarning = charWidth > 0 && (charWidth !== selectedResolution || charHeight !== selectedResolution);
  const isCustomAction = selectedAction === 'custom_action';
  const canGenerate = characterDataUrl && !sizeWarning && (!isCustomAction || motionPrompt.trim()) && !insufficientTokens;

  return (
    <>
    <div className="space-y-6">
      {/* Character upload */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          Your Character
        </label>

        {characterDataUrl ? (
          <div className="rounded-lg border border-border-default bg-bg-surface p-4">
            <div className="flex items-start gap-4">
              <div
                className="flex-shrink-0 rounded border border-border-subtle overflow-hidden"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                }}
              >
                <img
                  src={characterDataUrl}
                  alt="Character"
                  className="block max-w-[128px] max-h-[128px]"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-text-primary">Character ready</p>
                <p className="text-[10px] font-mono text-text-muted mt-1">
                  {charWidth}x{charHeight} · transparent background
                </p>
                <p className="text-[10px] font-mono text-green-400 mt-1">
                  Ready for animation
                </p>
              </div>
              <button
                onClick={handleRemoveChar}
                className="flex-shrink-0 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : pendingDataUrl ? null : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed
              border-border-default bg-bg-surface py-12 px-8 cursor-pointer transition-all duration-200
              hover:border-border-strong hover:bg-bg-elevated"
          >
            <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-bg-elevated mb-4">
              <UploadCloud size={28} className="text-text-muted" />
            </div>
            <p className="text-sm font-mono text-text-secondary mb-1">
              Drop your pixel art character here
            </p>
            <p className="text-[10px] font-mono text-text-muted mb-3">
              PNG only &middot; any size — we&apos;ll auto-crop and resize
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse files
            </Button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".png"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Resolution picker — placed before Auto-Prep so users choose size first.
          Picker rendering depends on the selected style's resolutionMode:
          - locked  → non-editable label
          - variable / variable_special → preset buttons */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          Resolution
        </label>
        {currentMode.kind === 'locked' ? (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded bg-bg-elevated border border-border-default text-xs font-mono text-text-secondary">
            <Lock size={12} className="text-text-muted" />
            {currentMode.size}&times;{currentMode.size}
            <span className="text-[10px] text-text-muted">(locked for this style by Retro Diffusion)</span>
          </div>
        ) : (
          <div className="flex gap-1.5">
            {(currentMode.kind === 'variable_special'
              ? currentMode.presets
              : (ADVANCED_ANIM_RESOLUTION_PRESETS as readonly number[])
            ).map((res) => (
              <button
                key={res}
                onClick={() => handleResolutionChange(res)}
                className={`px-3 py-1.5 rounded text-xs font-mono cursor-pointer transition-colors
                  ${selectedResolution === res
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {res}
              </button>
            ))}
          </div>
        )}
        <p className="text-[9px] font-mono text-text-muted/70 mt-1">
          {currentMode.kind === 'locked'
            ? 'Retro Diffusion locks this style at this resolution. For higher resolutions, choose a Walking/Idle/Attack style instead.'
            : 'Larger = more detail. Cost is flat per generation — no resolution surcharge.'}
        </p>
      </div>

      {/* Auto-prep pipeline — resizes to selectedResolution × selectedResolution */}
      {pendingDataUrl && (
        <CharacterAutoPrep
          sourceDataUrl={pendingDataUrl}
          sourceWidth={pendingWidth}
          sourceHeight={pendingHeight}
          targetSize={selectedResolution}
          onAccept={handleAutoPrepAccept}
          onCancel={handleAutoPrepCancel}
          paddingEnabled={paddingEnabled}
          characterSizePct={characterSizePct}
          onPaddingEnabledChange={setPaddingEnabled}
          onCharacterSizePctChange={setCharacterSizePct}
          initialSkipBgRemoval={handoffSkipBgRemoval}
        />
      )}

      {/* Background color for transparency */}
      {hasAlpha && characterDataUrl && (
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-2">
            Background fill for transparent areas
          </label>
          <div className="flex gap-2 items-center">
            {BG_COLORS.map((bg) => (
              <button
                key={bg.id}
                onClick={() => setBgColor(bg.color)}
                title={bg.label}
                className={`w-7 h-7 rounded border-2 cursor-pointer transition-all ${
                  bgColor === bg.color
                    ? 'border-accent-amber ring-1 ring-accent-amber'
                    : 'border-border-default hover:border-border-strong'
                }`}
                style={{ backgroundColor: bg.color }}
              />
            ))}
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0"
              title="Custom color"
            />
          </div>
        </div>
      )}

      {/* Saved templates (v0.5.12) — character-agnostic, persisted to
          spritebrew:animate:templates. Click a pill to load all 7 form
          fields; X to delete. Save current as a new template via the
          inline input below. */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          Saved Templates
        </label>

        {templates.length === 0 ? (
          <p className="text-[10px] font-mono text-text-muted/70 mb-2">
            No saved templates yet. Save the current config below to start a library.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="inline-flex items-center rounded border border-border-default bg-bg-surface hover:border-border-strong overflow-hidden transition-colors"
              >
                <button
                  onClick={() => handleLoadTemplate(tpl)}
                  className="px-2.5 py-1 text-[11px] font-mono text-text-primary hover:text-accent-amber cursor-pointer max-w-[180px] truncate"
                  title={`Load "${tpl.name}"`}
                >
                  {tpl.name}
                </button>
                <button
                  onClick={() => handleDeleteTemplate(tpl.id)}
                  className="px-1.5 py-1 text-text-muted hover:text-red-400 cursor-pointer border-l border-border-subtle"
                  title={`Delete "${tpl.name}"`}
                  aria-label={`Delete template ${tpl.name}`}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showSaveInput ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={saveInputValue}
              onChange={(e) => {
                setSaveInputValue(e.target.value);
                if (templateError) setTemplateError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveTemplate();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelSaveInput();
                }
              }}
              autoFocus
              maxLength={MAX_TEMPLATE_NAME_LEN}
              placeholder="Template name…"
              className="flex-1 min-w-0 rounded bg-bg-elevated border border-border-default px-2.5 py-1
                text-[11px] font-mono text-text-primary placeholder:text-text-muted
                focus:outline-none focus:border-accent-amber"
            />
            <button
              onClick={handleSaveTemplate}
              disabled={!saveInputValue.trim()}
              className="px-2.5 py-1 rounded text-[11px] font-mono bg-accent-amber text-bg-primary
                hover:bg-accent-amber/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleCancelSaveInput}
              className="p-1 text-text-muted hover:text-text-primary cursor-pointer"
              aria-label="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowSaveInput(true)}
            disabled={templates.length >= MAX_TEMPLATES}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono
              bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle
              disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title={templates.length >= MAX_TEMPLATES ? `Template limit reached (${MAX_TEMPLATES})` : 'Save current config as a named template'}
          >
            <Save size={11} />
            Save current as template…
          </button>
        )}

        {templateError && (
          <p className="text-[10px] font-mono text-red-400 mt-1.5">
            {templateError}
          </p>
        )}
      </div>

      {/* Action selector */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Animation Action
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map((action) => {
            const active = selectedAction === action.id;
            const actionCost = getTokenCost(ACTION_STYLE_MAP[action.id] ?? '');
            return (
              <button
                key={action.id}
                onClick={() => setSelectedAction(action.id)}
                className={`
                  text-left rounded-lg border p-3 transition-all duration-150 cursor-pointer
                  ${active
                    ? 'border-accent-amber bg-accent-amber-glow'
                    : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                  }
                `}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className={`text-xs font-mono font-semibold ${active ? 'text-accent-amber' : 'text-text-primary'}`}>
                    {action.name}
                  </h3>
                  {active && <Check size={12} className="text-accent-amber" />}
                  <span className="ml-auto text-[9px] font-mono text-text-muted">{actionCost} 🪙</span>
                </div>
                <p className="text-[10px] font-mono text-text-muted">{action.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Frame count */}
      <div>
        <label className="block text-[10px] font-mono text-text-muted mb-2">
          Frame count
        </label>
        <div className="flex gap-1.5">
          {FRAME_COUNTS.map((fc) => (
            <button
              key={fc}
              onClick={() => setFrameCount(fc)}
              className={`px-3 py-1.5 rounded text-xs font-mono cursor-pointer transition-colors
                ${frameCount === fc
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {fc}
            </button>
          ))}
        </div>
        <p className="text-[9px] font-mono text-text-muted mt-1">
          More frames = smoother animation, longer generation time
        </p>
      </div>

      {/* Motion prompt */}
      <div>
        <label className="block text-[10px] font-mono text-text-muted mb-1">
          Motion description {isCustomAction ? '(required)' : '(optional — less is more)'}
        </label>
        <textarea
          value={motionPrompt}
          onChange={(e) => setMotionPrompt(e.target.value)}
          placeholder="Keep short (2-4 words) or leave blank. e.g., walking forward, sword swing"
          rows={2}
          className="w-full rounded-lg bg-bg-elevated border border-border-default px-3 py-2
            text-xs font-mono text-text-primary placeholder:text-text-muted resize-none
            focus:outline-none focus:border-accent-amber"
        />
        <p className="text-[9px] font-mono text-text-muted/70 mt-1">
          For best character fidelity, leave blank or use minimal descriptions.
          Detailed prompts may alter your character&apos;s appearance.
        </p>
      </div>

      {/* Note about constraints */}
      <div className="text-[9px] font-mono text-text-muted/70 border-t border-border-subtle pt-3 space-y-1">
        <p>
          Generates a single-direction sprite strip — generate separately for each
          direction if you need a full 4-direction sheet.
        </p>
        <p>
          For best results, your character should be on a solid color background
          that contrasts with the character.
        </p>
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
      className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-width)] z-40 px-4 py-3 backdrop-blur-md border-t isolate"
      style={{
        backgroundColor: 'rgba(20, 18, 16, 0.92)',
        borderColor: '#3a3430',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <p className="text-[10px] font-mono text-text-muted">
            {charWidth > 0 ? `${selectedResolution}x${selectedResolution} · ${frameCount} frames · ${tokenCost} tokens` : `Upload a character to begin (${selectedResolution}x${selectedResolution})`}
            {userId && (
              <span className={`ml-2 ${insufficientTokens ? 'text-red-400' : 'text-accent-amber'}`}>
                &middot; Balance: {tokenBalance} 🪙
              </span>
            )}
          </p>
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className={`w-full sm:w-auto whitespace-nowrap ${!isGenerating && canGenerate ? 'animate-pulse' : ''}`}
            title={insufficientTokens ? `Need ${tokensNeeded} more tokens` : undefined}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Brewing...
              </>
            ) : insufficientTokens ? (
              <>
                <Play size={16} />
                Need {tokensNeeded} more 🪙
              </>
            ) : (
              <>
                <Play size={16} />
                Generate Animation ({tokenCost} 🪙)
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}
