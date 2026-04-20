'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  UploadCloud,
  X,
  Check,
  Loader2,
  AlertCircle,
  Play,
} from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import CharacterAutoPrep from './CharacterAutoPrep';
import {
  isAdminUser,
  FREE_DAILY_LIMIT,
} from '@/lib/generationLimits';

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
  const setGenerationCount = useSpriteStore((s) => s.setGenerationCount);
  const generationCount = useSpriteStore((s) => s.generationCount);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generationError = useSpriteStore((s) => s.generationError);

  // Fetch server-side rate limit status and cache in store + localStorage
  const fetchLimitStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const token = await getToken();
      const res = await fetch('/api/generation-limit', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setGenerationCount(data.used, new Date().toISOString().slice(0, 10));
        try {
          localStorage.setItem(
            `spritebrew_gen_${userId}`,
            JSON.stringify({ count: data.used, date: new Date().toISOString().slice(0, 10) })
          );
        } catch { /* localStorage unavailable */ }
      }
    } catch { /* network error — keep cached value */ }
  }, [userId, getToken, setGenerationCount]);

  // On mount: show cached localStorage count immediately, then fetch server truth
  useEffect(() => {
    if (userId) {
      try {
        const raw = localStorage.getItem(`spritebrew_gen_${userId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const today = new Date().toISOString().slice(0, 10);
          if (parsed?.date === today) {
            setGenerationCount(parsed.count, today);
          }
        }
      } catch { /* ignore */ }
      fetchLimitStatus();
    }
  }, [userId, setGenerationCount, fetchLimitStatus]);

  const isAdmin = isAdminUser(userId);
  const remaining = isAdmin ? Infinity : Math.max(0, FREE_DAILY_LIMIT - generationCount);
  const atLimit = !isAdmin && generationCount >= FREE_DAILY_LIMIT;

  // Final prepared 64x64 character ready for animation
  const [characterDataUrl, setCharacterDataUrl] = useState<string | null>(null);
  const [charWidth, setCharWidth] = useState(0);
  const [charHeight, setCharHeight] = useState(0);
  const [hasAlpha, setHasAlpha] = useState(false);
  // Raw upload awaiting auto-prep review (before becoming the character)
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [pendingWidth, setPendingWidth] = useState(0);
  const [pendingHeight, setPendingHeight] = useState(0);
  const [bgColor, setBgColor] = useState('#000000');
  // Animation padding — shrinks character on canvas to leave room for
  // weapon swings and motion FX. Auto-toggles based on selected action,
  // but user manual toggles stick until they pick a different action.
  const [paddingEnabled, setPaddingEnabled] = useState(false);
  const [characterSizePct, setCharacterSizePct] = useState(75);
  const [selectedAction, setSelectedAction] = useState('walking');
  const [frameCount, setFrameCount] = useState<number>(4);
  const [motionPrompt, setMotionPrompt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-toggle animation padding based on selected action.
  // User manual toggles (after this fires) stick until the next action change.
  useEffect(() => {
    setPaddingEnabled(PADDING_ON_ACTIONS.has(selectedAction));
  }, [selectedAction]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type !== 'image/png') {
      useSpriteStore.getState().setGenerationError('Please upload a PNG file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        // Upload goes into the "pending" slot — the CharacterAutoPrep panel
        // runs the detect → crop → bg-remove → resize pipeline and emits a
        // prepared 64x64 data URL via `handleAutoPrepAccept`.
        setPendingDataUrl(dataUrl);
        setPendingWidth(img.naturalWidth);
        setPendingHeight(img.naturalHeight);
        // Clear any previously confirmed character
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

  /** User approved the auto-prepped character. It's already 64x64 with
   *  transparent padding — promote it to the confirmed character slot. */
  const handleAutoPrepAccept = useCallback(
    (preparedDataUrl: string, w: number, h: number) => {
      setCharacterDataUrl(preparedDataUrl);
      setCharWidth(w);
      setCharHeight(h);
      setHasAlpha(true); // prepared image always has transparent padding
      setPendingDataUrl(null);
      setPendingWidth(0);
      setPendingHeight(0);
    },
    []
  );

  /** User rejected the auto-prepped character — return to the upload zone. */
  const handleAutoPrepCancel = useCallback(() => {
    setPendingDataUrl(null);
    setPendingWidth(0);
    setPendingHeight(0);
  }, []);

  /** Convert the uploaded RGBA image to RGB by compositing onto bgColor */
  const convertToRgbBase64 = useCallback((): string | null => {
    if (!characterDataUrl) return null;

    const img = new Image();
    img.src = characterDataUrl;
    // Image should already be loaded since we showed it as preview
    const canvas = document.createElement('canvas');
    canvas.width = charWidth;
    canvas.height = charHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Fill with background color first
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, charWidth, charHeight);

    // Draw image on top (composites alpha onto solid bg)
    ctx.drawImage(img, 0, 0);

    // Get as PNG base64 without the data URL prefix
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  }, [characterDataUrl, charWidth, charHeight, bgColor]);

  const handleGenerate = useCallback(async () => {
    if (!characterDataUrl || isGenerating) return;

    const rgbBase64 = convertToRgbBase64();
    if (!rgbBase64) return;

    setGenerating(true);
    setGeneratingAction(selectedAction);
    setGenerationError(null);
    setOriginalCharacter(characterDataUrl);

    try {
      const body: Record<string, unknown> = {
        mode: 'animate',
        inputImage: rgbBase64,
        action: selectedAction,
        width: 64,
        height: 64,
        framesDuration: frameCount,
      };

      if (motionPrompt.trim()) {
        body.motionPrompt = motionPrompt.trim();
      }

      // Get Clerk session token for Bearer auth on the API route
      const sessionToken = await getToken();

      // Use SSE streaming to avoid Cloudflare 524 timeout
      const { fetchGenerationSSE } = await import('@/lib/sseClient');
      const data = await fetchGenerationSSE(body, sessionToken);

      if (!data.success) {
        setGenerationError(String(data.error ?? 'Animation failed — try again.'));
        return;
      }

      // Retro Diffusion direct API returns a data URL directly (not a remote URL)
      const dataUrl = data.imageUrl!;

      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(`any_animation_${selectedAction}`);
      // Refresh rate limit from server (count was already incremented server-side)
      await fetchLimitStatus();
      onGenerated(dataUrl, motionPrompt.trim() || selectedAction, `any_animation_${selectedAction}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setGenerationError(`Connection failed — ${msg}`);
    } finally {
      setGenerating(false);
      setGeneratingAction(null);
    }
  }, [
    characterDataUrl, isGenerating, selectedAction, charWidth, charHeight,
    frameCount, motionPrompt, convertToRgbBase64, getToken,
    setGenerating, setGeneratingAction, setGenerationError, setGeneratedImage,
    setGenerationStyle, setOriginalCharacter, fetchLimitStatus, onGenerated,
  ]);

  const sizeWarning = charWidth > 0 && (charWidth !== 64 || charHeight !== 64);
  const isCustomAction = selectedAction === 'custom_action';
  const canGenerate = characterDataUrl && !sizeWarning && (!isCustomAction || motionPrompt.trim()) && !atLimit;

  return (
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

      {/* Auto-prep pipeline — runs detect → crop → bg-remove → fit 64x64
          on any uploaded image. User reviews the before/after and clicks
          Use This to confirm, or Upload Different to try another file.
          Animation Padding shrinks the character within the 64x64 canvas
          to leave margin for weapon swings and motion effects. */}
      {pendingDataUrl && (
        <CharacterAutoPrep
          sourceDataUrl={pendingDataUrl}
          sourceWidth={pendingWidth}
          sourceHeight={pendingHeight}
          targetSize={64}
          onAccept={handleAutoPrepAccept}
          onCancel={handleAutoPrepCancel}
          paddingEnabled={paddingEnabled}
          characterSizePct={characterSizePct}
          onPaddingEnabledChange={setPaddingEnabled}
          onCharacterSizePctChange={setCharacterSizePct}
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

      {/* Action selector */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Animation Action
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map((action) => {
            const active = selectedAction === action.id;
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
          💡 For best character fidelity, leave blank or use minimal descriptions.
          Detailed prompts may alter your character&apos;s appearance.
        </p>
      </div>

      {/* Note about constraints */}
      <div className="text-[9px] font-mono text-text-muted/70 border-t border-border-subtle pt-3 space-y-1">
        <p>
          Character animation is optimized for 64x64 sprites. Generates a
          single-direction sprite strip — generate separately for each direction
          if you need a full 4-direction sheet.
        </p>
        <p>
          For best results, your character should be on a solid color background
          that contrasts with the character.
        </p>
      </div>

      {/* Error */}
      {generationError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-red-400">{generationError}</p>
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
          {charWidth > 0 ? `64x64 · ${frameCount} frames` : 'Upload a 64x64 character to begin'}
          {userId && isAdmin && (
            <span className="ml-2 text-accent-amber">&middot; ∞ remaining (admin)</span>
          )}
          {userId && !isAdmin && (
            <span className={`ml-2 ${atLimit ? 'text-red-400' : 'text-accent-amber'}`}>
              &middot; {remaining}/{FREE_DAILY_LIMIT} remaining today
            </span>
          )}
        </p>
        <Button
          size="lg"
          onClick={handleGenerate}
          disabled={!canGenerate || isGenerating}
          className={!isGenerating && canGenerate ? 'animate-pulse' : ''}
        >
          {isGenerating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Brewing...
            </>
          ) : atLimit ? (
            <>
              <Play size={16} />
              Daily limit reached
            </>
          ) : isAdmin ? (
            <>
              <Play size={16} />
              Animate Character
            </>
          ) : (
            <>
              <Play size={16} />
              Animate ({remaining}/{FREE_DAILY_LIMIT} remaining)
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
