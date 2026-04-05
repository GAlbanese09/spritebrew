'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Sparkles, UploadCloud, X, Check, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import {
  getGenerationCount,
  incrementGenerationCount,
  isAtDailyLimit,
  remainingGenerations,
  isAdminUser,
  FREE_DAILY_LIMIT,
} from '@/lib/generationLimits';

const STYLES = [
  {
    id: 'four_angle_walking',
    name: '4-Angle Walking',
    size: '48x48',
    width: 48,
    height: 48,
    desc: 'Walk cycle from 4 directions',
    layout: '4 dir x frames',
  },
  {
    id: 'walking_and_idle',
    name: 'Walking & Idle',
    size: '48x48',
    width: 48,
    height: 48,
    desc: 'Walk + idle animations combined',
    layout: 'Walk + idle rows',
  },
  {
    id: 'small_sprites',
    name: 'Small Sprites',
    size: '32x32',
    width: 32,
    height: 32,
    desc: 'Compact sprite animations',
    layout: 'Grid sheet',
  },
  {
    id: 'any_animation',
    name: 'Any Animation',
    size: '64x64',
    width: 64,
    height: 64,
    desc: 'Custom animation from your prompt',
    layout: 'Freeform',
  },
  {
    id: '8_dir_rotation',
    name: '8-Dir Rotation',
    size: '80x80',
    width: 80,
    height: 80,
    desc: 'Character from 8 rotational angles',
    layout: '8 angles strip',
  },
  {
    id: 'vfx',
    name: 'VFX',
    size: '24-96px',
    width: 48,
    height: 48,
    desc: 'Visual effects and particles',
    layout: 'Square frames',
  },
] as const;

const EXAMPLE_PROMPTS = [
  'pixel art knight with sword',
  'small goblin with wooden club',
  'wizard with blue robe and staff',
  'skeleton warrior with shield',
  'cute slime monster',
  'robot with laser gun',
];

interface GenerationFormProps {
  onGenerated: (imageUrl: string, prompt: string, style: string) => void;
}

export default function GenerationForm({ onGenerated }: GenerationFormProps) {
  const { userId, getToken } = useAuth();
  const setGenerating = useSpriteStore((s) => s.setGenerating);
  const setGenerationError = useSpriteStore((s) => s.setGenerationError);
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setGenerationCount = useSpriteStore((s) => s.setGenerationCount);
  const generationCount = useSpriteStore((s) => s.generationCount);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generationError = useSpriteStore((s) => s.generationError);

  // Sync store count from localStorage on mount / when user changes.
  useEffect(() => {
    if (userId) {
      const count = getGenerationCount(userId);
      const today = new Date().toISOString().slice(0, 10);
      setGenerationCount(count, today);
    }
  }, [userId, setGenerationCount]);

  const isAdmin = isAdminUser(userId);
  const remaining = remainingGenerations(userId);
  const atLimit = isAtDailyLimit(userId);
  // generationCount is used to force re-render when the count changes (satisfies the subscription)
  void generationCount;

  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('four_angle_walking');
  const [vfxSize, setVfxSize] = useState(48);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [refExpanded, setRefExpanded] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  const styleConfig = STYLES.find((s) => s.id === selectedStyle)!;
  const effectiveWidth = selectedStyle === 'vfx' ? vfxSize : styleConfig.width;
  const effectiveHeight = selectedStyle === 'vfx' ? vfxSize : styleConfig.height;

  const handleRefImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      setReferenceImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    // Client-side daily limit check
    if (isAtDailyLimit(userId)) {
      setGenerationError(
        `You've used all ${FREE_DAILY_LIMIT} free generations today. Your limit resets tomorrow. Pro plan with unlimited generations coming soon!`
      );
      return;
    }

    setGenerating(true);
    setGenerationError(null);

    try {
      const body: Record<string, unknown> = {
        prompt: prompt.trim(),
        style: selectedStyle,
        width: effectiveWidth,
        height: effectiveHeight,
      };

      if (referenceImage) {
        body.referenceImage = referenceImage;
      }

      // Get Clerk session token for Bearer auth on the API route
      const sessionToken = await getToken();

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!data.success) {
        if (res.status === 401) {
          setGenerationError('Your session expired. Please sign in again to continue generating.');
        } else {
          setGenerationError(data.error || 'Generation failed — try a different prompt.');
        }
        return;
      }

      // Convert the Replicate URL to a data URL before it expires
      const imageUrl = data.imageUrl;
      let dataUrl = imageUrl;

      try {
        const imgRes = await fetch(imageUrl);
        const blob = await imgRes.blob();
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        // If conversion fails, use the URL directly
      }

      setGeneratedImage(imageUrl, dataUrl);
      setGenerationStyle(selectedStyle);
      // Increment daily count (client-side soft limit)
      const newCount = incrementGenerationCount(userId);
      setGenerationCount(newCount, new Date().toISOString().slice(0, 10));
      onGenerated(dataUrl, prompt.trim(), selectedStyle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setGenerationError(`Connection failed — ${msg}`);
    } finally {
      setGenerating(false);
    }
  }, [
    prompt, selectedStyle, effectiveWidth, effectiveHeight,
    referenceImage, isGenerating, userId, getToken, setGenerating, setGenerationError,
    setGeneratedImage, setGenerationStyle, setGenerationCount, onGenerated,
  ]);

  return (
    <div className="space-y-6">
      {/* Prompt */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          Describe your character
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your pixel art character... e.g., 'knight with silver armor and red cape, holding a sword'"
          rows={3}
          className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3
            text-sm font-mono text-text-primary placeholder:text-text-muted resize-none
            focus:outline-none focus:border-accent-amber"
        />
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] font-mono text-text-muted">
            {prompt.length} characters
          </p>
        </div>

        {/* Example prompts */}
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

      {/* Style selector */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Animation Style
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {STYLES.map((style) => {
            const active = selectedStyle === style.id;
            return (
              <button
                key={style.id}
                onClick={() => setSelectedStyle(style.id)}
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
                    {style.name}
                  </h3>
                  {active && <Check size={12} className="text-accent-amber" />}
                  <span className="ml-auto text-[10px] font-mono text-text-muted">{style.size}</span>
                </div>
                <p className="text-[10px] font-mono text-text-muted">{style.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* VFX size slider */}
      {selectedStyle === 'vfx' && (
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-1">
            Size: {vfxSize}x{vfxSize}
          </label>
          <input
            type="range"
            min={24}
            max={96}
            step={8}
            value={vfxSize}
            onChange={(e) => setVfxSize(Number(e.target.value))}
            className="w-full accent-[var(--accent-amber)]"
          />
        </div>
      )}

      {/* Reference image */}
      <div>
        <button
          onClick={() => setRefExpanded(!refExpanded)}
          className="text-xs font-mono text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
        >
          {refExpanded ? '- Hide' : '+'} Reference image (optional)
        </button>
        {refExpanded && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-mono text-text-muted">
              Upload a reference image for style-consistent generation.
            </p>
            {referenceImage ? (
              <div className="flex items-center gap-3">
                <div
                  className="w-16 h-16 rounded border border-border-subtle overflow-hidden"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                    backgroundSize: '6px 6px',
                    backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
                  }}
                >
                  <img
                    src={referenceImage}
                    alt="Reference"
                    className="w-full h-full object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                <button
                  onClick={() => setReferenceImage(null)}
                  className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => refInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 rounded border border-dashed border-border-default
                  bg-bg-surface text-xs font-mono text-text-muted hover:border-border-strong hover:bg-bg-elevated
                  cursor-pointer transition-colors"
              >
                <UploadCloud size={14} />
                Upload reference
              </button>
            )}
            <input
              ref={refInputRef}
              type="file"
              accept=".png,.webp,.jpg,.jpeg"
              onChange={handleRefImage}
              className="hidden"
            />
          </div>
        )}
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
          Output: {effectiveWidth}x{effectiveHeight}px
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
          disabled={!prompt.trim() || isGenerating || atLimit}
          className={!isGenerating && prompt.trim() && !atLimit ? 'animate-pulse' : ''}
        >
          {isGenerating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Generating...
            </>
          ) : atLimit ? (
            <>
              <Sparkles size={16} />
              Daily limit reached
            </>
          ) : isAdmin ? (
            <>
              <Sparkles size={16} />
              Generate Sprite Sheet
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Generate ({remaining}/{FREE_DAILY_LIMIT} remaining)
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
