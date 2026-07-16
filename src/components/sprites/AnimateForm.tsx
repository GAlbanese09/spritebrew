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
import { loadImage, imageToCanvas, despillChromaEdges } from '@/lib/spriteUtils';
import {
  getTokenCost,
  getResolutionMode,
  ADVANCED_ANIM_RESOLUTION_PRESETS,
  ADVANCED_ANIM_DEFAULT_RESOLUTION,
} from '@/lib/styleRegistry';
import { fetchGeneration, consumeSSEStream, type Payload } from '@/lib/sseClient';
import { useGenerationPoll } from '@/hooks/useGenerationPoll';
import { ANIMATE_INPUT_B64_CLIENT_MAX } from '@/lib/constants';
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

/**
 * Fixed fill color for the RGB-encode step. RD requires opaque input; the
 * choice of fill is invisible in the output now that we always request
 * remove_bg (RD strips its baked matte server-side) and unconditionally
 * despill the returned sheet (magenta is what despillChromaEdges is
 * calibrated against per the July-8 dev-smoke pixel analysis).
 * Formerly user-configurable via a swatch row; removed July 15 — the
 * transparency toggle went with it since RD now default-strips.
 */
const DEFAULT_BG_COLOR = '#ff00ff';

/**
 * fix-a follow-up: decode → check-for-alpha → despill → re-encode.
 * Called UNCONDITIONALLY on animate-result base64 the first time it lands on
 * the client (July 14: RD default-strips animation backgrounds even without
 * remove_bg; we always send remove_bg anyway as belt-and-suspenders). Two
 * internal safety gates keep this safe on the exceptional inputs:
 *   (a) Corner-sample alpha check — if all four corners are opaque, RD
 *       returned an opaque sheet (rare, e.g. RD reverting the default). We
 *       short-circuit and return the input unchanged; no cleanup runs.
 *   (b) fillHex classification inside despillChromaEdges — neutral fills
 *       (black/white/gray/other hues) short-circuit with no work. Only
 *       magenta/green fills trigger the actual dilation + subtract pass.
 * Silent-fail on decode errors → returns the input dataUrl. The despill is
 * a quality-of-life step; a broken pass must never break the pipeline.
 */
async function despillIfTransparent(dataUrl: string, fillHex: string): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const canvas = imageToCanvas(img);
    const W = canvas.width;
    const H = canvas.height;
    if (W === 0 || H === 0) return dataUrl;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    // Corner alpha sample — cheap check to skip the full despill pass on
    // opaque sheets (fix-a-legacy or an RD miss).
    const a0 = ctx.getImageData(0, 0, 1, 1).data[3];
    const a1 = ctx.getImageData(W - 1, 0, 1, 1).data[3];
    const a2 = ctx.getImageData(0, H - 1, 1, 1).data[3];
    const a3 = ctx.getImageData(W - 1, H - 1, 1, 1).data[3];
    if (a0 === 255 && a1 === 255 && a2 === 255 && a3 === 255) return dataUrl;
    despillChromaEdges(canvas, fillHex);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

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
  // bgColor is now the fixed DEFAULT_BG_COLOR module constant (the toggle
  // went away July 15) but still travels through this ref so the despill
  // in the poll-success handler sees a stable request-time fill regardless
  // of any future changes to the flatten default.
  const inFlightRef = useRef<{
    action: string;
    motionPrompt: string;
    bgColor: string;
  } | null>(null);

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
  // Captured from spriteStore.pendingAnimatorSkipBgRemoval at handoff-consume
  // time, forwarded to CharacterAutoPrep as initialSkipBgRemoval. Reset to
  // false on manual file upload so the handoff preference only applies to
  // handoff-sourced characters.
  const [handoffSkipBgRemoval, setHandoffSkipBgRemoval] = useState(false);
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [pendingWidth, setPendingWidth] = useState(0);
  const [pendingHeight, setPendingHeight] = useState(0);
  // bgColor + transparentBg state, refs, effects, and UI removed July 15.
  // Fill is now the DEFAULT_BG_COLOR module constant; remove_bg is
  // unconditional on every animate request. SavedAnimateConfig still
  // carries a bgColor field for schema stability (see saveLatestConfig
  // calls below, which now always pass DEFAULT_BG_COLOR).
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
    // saved.bgColor intentionally ignored — bgColor state was removed
    // July 15 (fill is now DEFAULT_BG_COLOR). Field still lives on
    // SavedAnimateConfig for schema stability with older writes.
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

  // transparentBg hydration / persistence / ref-sync effects and the
  // matching bgColor ref-sync — all removed July 15 along with the toggle
  // UI. Fill is now DEFAULT_BG_COLOR (module constant); remove_bg is
  // unconditional on every animate request; despill runs unconditionally
  // on every animate result (alpha-gated internally). Legacy
  // TRANSPARENT_BG_STORAGE_KEY entries in users' localStorage are simply
  // ignored — no cleanup needed (the toggle can't be surfaced anyway).

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
        bgColor: DEFAULT_BG_COLOR,
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
      // Re-show the pending image so Auto-Prep can re-run at new size
      // (only if we still have the original upload)
    }
  }, [selectedResolution, characterDataUrl, charWidth, charHeight]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // Widened format allowlist (build #2025-06). Downstream canvas re-encode
    // normalizes everything to PNG, so JPG/WebP/GIF flow through unchanged.
    // For GIFs only the first frame is used (native Image decode). Empty
    // file.type means the Files app didn't supply a MIME — let decode decide.
    const ACCEPTED_TYPES = new Set([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ]);
    if (file.type && !ACCEPTED_TYPES.has(file.type)) {
      // HEIC/HEIF: iOS-photo-library special case (the user almost certainly
      // got here by picking from the Files app rather than the Photos app).
      const lowerName = file.name.toLowerCase();
      const isHeic =
        file.type === 'image/heic' ||
        file.type === 'image/heif' ||
        lowerName.endsWith('.heic') ||
        lowerName.endsWith('.heif');
      const msg = isHeic
        ? "iPhone HEIC photos aren't supported directly. Pick the photo from your Photos library instead (iOS converts it automatically) or export it as JPG or PNG first."
        : "Couldn't read that image file. Please try a PNG or JPG.";
      useSpriteStore.getState().setGenerationError(msg);
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
      };
      img.onerror = () => {
        const lowerName = file.name.toLowerCase();
        const isHeic =
          file.type === 'image/heic' ||
          file.type === 'image/heif' ||
          lowerName.endsWith('.heic') ||
          lowerName.endsWith('.heif');
        const msg = isHeic
          ? "iPhone HEIC photos aren't supported directly. Pick the photo from your Photos library instead (iOS converts it automatically) or export it as JPG or PNG first."
          : "Couldn't read that image file. Please try a PNG or JPG.";
        useSpriteStore.getState().setGenerationError(msg);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveChar = useCallback(() => {
    setCharacterDataUrl(null);
    setCharWidth(0);
    setCharHeight(0);
    setPendingDataUrl(null);
    setPendingWidth(0);
    setPendingHeight(0);
  }, []);

  const handleAutoPrepAccept = useCallback(
    (preparedDataUrl: string, w: number, h: number) => {
      setCharacterDataUrl(preparedDataUrl);
      setCharWidth(w);
      setCharHeight(h);
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
    // c.bgColor intentionally ignored — bgColor state was removed
    // July 15. Field is still on AnimateTemplate for schema stability.
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
      bgColor: DEFAULT_BG_COLOR,
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

  /**
   * Convert the uploaded RGBA image to a base64-encoded RGB PNG, compositing
   * onto DEFAULT_BG_COLOR and budget-aware-encoded so the result fits the
   * Cloudflare Queues 128 KB message cap (queue-kickoff path).
   *
   * Returns `{ primary, fallback64 }`:
   *   - primary: the size-adaptive encoding (rungs 1-4 below) used as the
   *     RD prompt-style input at the user's selected resolution.
   *   - fallback64: an ALWAYS-64×64 nearest-neighbor render of the SAME
   *     flattened source, used consumer-side as the input to the
   *     `animation__any_animation` fallback style (which is 64-locked and
   *     400s on any non-64 primary). Rendered off the ORIGINAL flatten
   *     (before any posterize / collapse rung is applied) so quality is
   *     stable regardless of which primary rung wins. Typically 1-2KB
   *     base64.
   *
   * Budget ladder for primary — each rung re-encodes and returns if the
   * base64 length is <= ANIMATE_INPUT_B64_CLIENT_MAX:
   *   1. straight PNG of the composited canvas
   *   2. posterize to 32 levels per channel (drop low 3 bits)
   *   3. half-res nearest-neighbor round-trip + posterize
   *   4. quarter-res nearest-neighbor round-trip + posterize
   *   5. give up (caller surfaces a friendly error and aborts pre-debit)
   *
   * Also awaits img.decode() to kill the silent drawImage-on-undecoded-image
   * race that could composite a flat bg-color square.
   */
  const convertToRgbBase64 = useCallback(async (): Promise<
    { primary: string; fallback64: string } | null
  > => {
    if (!characterDataUrl) return null;

    const img = new Image();
    img.src = characterDataUrl;
    try {
      await img.decode();
    } catch {
      useSpriteStore.getState().setGenerationError(
        "Couldn't read your character image. Please re-upload it."
      );
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = charWidth;
    canvas.height = charHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = DEFAULT_BG_COLOR;
    ctx.fillRect(0, 0, charWidth, charHeight);
    ctx.drawImage(img, 0, 0);

    // Snapshot the fresh full-res flatten BEFORE any rung mutates the
    // primary canvas — the fallback must always be a nearest-neighbor of
    // the true source, not of a posterized / collapsed intermediate.
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = 64;
    fallbackCanvas.height = 64;
    const fctx = fallbackCanvas.getContext('2d')!;
    fctx.imageSmoothingEnabled = false;
    fctx.fillStyle = DEFAULT_BG_COLOR;
    fctx.fillRect(0, 0, 64, 64);
    fctx.drawImage(canvas, 0, 0, charWidth, charHeight, 0, 0, 64, 64);
    const fallback64 = fallbackCanvas
      .toDataURL('image/png')
      .replace(/^data:image\/png;base64,/, '');

    const encode = (): string =>
      canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

    // Posterize the canvas in place: r/g/b &= 0xF8 → 32 levels per channel.
    // Alpha untouched. Cuts PNG entropy substantially for detailed photos.
    const posterize = () => {
      const data = ctx.getImageData(0, 0, charWidth, charHeight);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = px[i] & 0xF8;
        px[i + 1] = px[i + 1] & 0xF8;
        px[i + 2] = px[i + 2] & 0xF8;
      }
      ctx.putImageData(data, 0, 0);
    };

    // Half/quarter-res nearest-neighbor round-trip: shrink to (w/divisor)
    // with high-quality smoothing, then upscale back to native with nearest
    // neighbor. Net effect: pixel-art-style detail collapse → much smaller
    // PNG. Then posterize for an additional entropy win.
    const collapse = (divisor: number) => {
      const sw = Math.max(1, Math.floor(charWidth / divisor));
      const sh = Math.max(1, Math.floor(charHeight / divisor));
      const tmp = document.createElement('canvas');
      tmp.width = sw;
      tmp.height = sh;
      const tctx = tmp.getContext('2d')!;
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(canvas, 0, 0, sw, sh);
      ctx.clearRect(0, 0, charWidth, charHeight);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = DEFAULT_BG_COLOR;
      ctx.fillRect(0, 0, charWidth, charHeight);
      ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, charWidth, charHeight);
      posterize();
    };

    // Rung 1: straight PNG.
    let out = encode();
    if (out.length <= ANIMATE_INPUT_B64_CLIENT_MAX) {
      console.debug('[animate encode]', { rung: 1, chars: out.length });
      return { primary: out, fallback64 };
    }

    // Rung 2: posterize.
    posterize();
    out = encode();
    if (out.length <= ANIMATE_INPUT_B64_CLIENT_MAX) {
      console.debug('[animate encode]', { rung: 2, chars: out.length });
      return { primary: out, fallback64 };
    }

    // Rung 3: half-res collapse + posterize.
    collapse(2);
    out = encode();
    if (out.length <= ANIMATE_INPUT_B64_CLIENT_MAX) {
      console.debug('[animate encode]', { rung: 3, chars: out.length });
      return { primary: out, fallback64 };
    }

    // Rung 4: quarter-res collapse + posterize.
    collapse(4);
    out = encode();
    if (out.length <= ANIMATE_INPUT_B64_CLIENT_MAX) {
      console.debug('[animate encode]', { rung: 4, chars: out.length });
      return { primary: out, fallback64 };
    }

    // Rung 5: give up — caller surfaces the friendly error and aborts before
    // any network call (no debit ever happens).
    console.debug('[animate encode]', { rung: 5, chars: out.length });
    return null;
  }, [characterDataUrl, charWidth, charHeight]);

  const handleGenerate = useCallback(async () => {
    if (!characterDataUrl || isGenerating) return;

    // 1s click-debounce.
    const clickedAt = Date.now();
    if (clickedAt - lastGenerateAtRef.current < 1_000) return;
    lastGenerateAtRef.current = clickedAt;

    const encoded = await convertToRgbBase64();
    if (!encoded) {
      // convertToRgbBase64 already set a specific error for the decode-failure
      // path. The other null case is rung-5 "couldn't fit under the queue
      // budget" — only surface that message if no error was set above.
      if (!useSpriteStore.getState().generationError) {
        setGenerationError(
          `This image is too detailed to send at ${selectedResolution}x${selectedResolution}. Try the 128 resolution or a simpler image.`
        );
      }
      return;
    }
    const { primary: rgbBase64, fallback64 } = encoded;

    setGenerating(true);
    setGeneratingAction(selectedAction);
    setGenerationError(null);
    setOriginalCharacter(characterDataUrl);
    poll.reset();

    // Click-time context for both branches (SSE and poll). bgColor is
    // now the fixed DEFAULT_BG_COLOR module constant (the toggle went
    // away July 15) but still travels through reqCtx so the despill
    // step in both SSE-success and poll-success paths sees a stable
    // fill regardless of any future changes to the flatten default.
    const reqCtx = {
      action: selectedAction,
      motionPrompt: motionPrompt.trim(),
      bgColor: DEFAULT_BG_COLOR,
    };

    let tookPollPath = false;

    try {
      const body: Payload = {
        mode: 'animate',
        inputImage: rgbBase64,
        action: reqCtx.action,
        width: selectedResolution,
        height: selectedResolution,
        framesDuration: frameCount,
      };

      if (reqCtx.motionPrompt) {
        body.motionPrompt = reqCtx.motionPrompt;
      }

      // Always request remove_bg. RD default-strips animation backgrounds
      // as of July 14, but sending remove_bg: true explicitly is
      // belt-and-suspenders against a future default flip — observed
      // billing is flat $0.14 either way. Companion despill call in the
      // success paths handles the chroma rim regardless. `if
      // (reqCtx.transparentBg)` gate removed July 15 with the toggle.
      body.removeBg = true;

      // Consumer-side envelope-only field: 64×64 opaque PNG the RD
      // consumer feeds into the animation__any_animation fallback when
      // the primary times out or errors. Never forwarded to RD in the
      // primary submit; the producer route.ts budgets against the
      // Cloudflare Queues 128KB cap and omits this on the rare oversized
      // envelope (consumer degrades gracefully — the fallback simply
      // becomes unavailable for those requests).
      body.fallbackInputImage = fallback64;

      // Per-attempt UUID — required by the queue-kickoff path; legacy SSE ignores it.
      const idempotencyKey = crypto.randomUUID();
      body.idempotencyKey = idempotencyKey;

      const sessionToken = await getToken();
      const result = await fetchGeneration(body, sessionToken);

      if (result.mode === 'poll') {
        tookPollPath = true;
        inFlightRef.current = reqCtx;
        poll.startPolling(result.jobId, idempotencyKey, 'animate');
        return;
      }

      // Legacy SSE path — byte-identical to pre-refactor behavior.
      const data = await consumeSSEStream(result.response);

      if (!data.success) {
        setGenerationError(String(data.error ?? 'Animation failed — try again.'));
        return;
      }

      // Despill chroma-fill residue on silhouette edges. Called
      // UNCONDITIONALLY on animate results — RD default-strips animation
      // backgrounds server-side and we always request remove_bg on top of
      // that, so sheets consistently come back transparent with a chroma
      // rim from the DEFAULT_BG_COLOR flatten. Two internal safety gates
      // keep this safe on the exceptional inputs: (1) 4-corner alpha check
      // no-ops on opaque sheets (defensive if RD reverts default-strip),
      // (2) despillChromaEdges no-ops on neutral fills (only magenta /
      // green fills trigger the dilation + subtract pass).
      const dataUrl = await despillIfTransparent(data.imageUrl!, reqCtx.bgColor);

      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(`any_animation_${reqCtx.action}`);
      await fetchBalance();
      onGenerated(dataUrl, reqCtx.motionPrompt || reqCtx.action, `any_animation_${reqCtx.action}`);
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
          `You need ${errObj.required} tokens for this animation, but you have ${errObj.balance}. Try a cheaper action or buy more tokens!`
        );
        setTokenBalance(errObj.balance);
        return;
      }
      if (errObj.error === 'submission_failed') {
        // Server already refunded — surface its message verbatim, do NOT
        // append the generic "(your tokens are safe)" copy.
        setGenerationError(msg);
        // Refresh balance so the user sees the refund landed.
        void fetchBalance();
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
      // Same despill wire as the SSE-success path — see that branch's
      // comment for the RD default-strip context and the two internal
      // safety gates that make unconditional calls safe. bgColor is now
      // the DEFAULT_BG_COLOR module constant (post-July-15) but still
      // travels via inFlightRef so a stale ref (mount-race edge case)
      // falls through to '#000000' — that neutral fill is classified as
      // non-chroma inside despillChromaEdges and no-ops the pass, so it's
      // a safe fallback. Wrapped in an IIFE because useEffect callbacks
      // can't be async themselves.
      const rawDataUrl = `data:image/png;base64,${poll.result.resultBase64}`;
      const reqCtx = inFlightRef.current;
      (async () => {
        const dataUrl = await despillIfTransparent(rawDataUrl, reqCtx?.bgColor ?? '#000000');
        setGeneratedImage(dataUrl, dataUrl);
        if (reqCtx) {
          setGenerationStyle(`any_animation_${reqCtx.action}`);
          void fetchBalance();
          onGenerated(
            dataUrl,
            reqCtx.motionPrompt || reqCtx.action,
            `any_animation_${reqCtx.action}`
          );
          inFlightRef.current = null;
        }
        setGenerating(false);
        setGeneratingAction(null);
        poll.reset();
      })();
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
              PNG, JPG, or WebP &middot; any size, we&apos;ll auto-crop and resize
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
          accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
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
        {/* Reliability warning — static copy, no network call. Larger
            RD animation sizes (128 / 256) have been timing out more often
            than 64 across the last few days; 16-frame at those sizes is
            the worst combination. Refunds fire automatically on failure
            (see consumer classifyError paths), so this is purely a "set
            your expectations" notice, not a hard block. */}
        {currentMode.kind !== 'locked' && (selectedResolution === 128 || selectedResolution === 256) && (
          <p className="text-[10px] font-mono text-amber-400/90 mt-2 leading-snug">
            Heads up: larger animations are timing out more often than usual with our AI provider. 64px is currently the most reliable. Failed generations auto-refund.
            {frameCount === 16 && ' 16 frames at this size is the most likely to fail — consider 8.'}
          </p>
        )}
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

      {/* Transparent-background toggle + BG_COLORS swatch row removed
          July 15 (see DEFAULT_BG_COLOR docstring above). RD default-strips
          animation backgrounds, we always send remove_bg on top of that,
          and despillIfTransparent runs unconditionally on every result —
          the fill choice is now invisible in the output, so the picker
          would just be confusing. */}

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
      className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-width)] z-40 px-4 py-3 backdrop-blur-md border-t isolate transform-gpu overscroll-none"
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
