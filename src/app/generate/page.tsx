'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Play, LogIn, X } from 'lucide-react';
import { Show, SignInButton, useAuth } from '@clerk/react';
import GenerationForm from '@/components/sprites/GenerationForm';
import AnimateForm from '@/components/sprites/AnimateForm';
import GenerationResult from '@/components/sprites/GenerationResult';
import { addToHistory } from '@/lib/generationHistory';
import { useSpriteStore } from '@/stores/spriteStore';

const EARLY_ACCESS_DISMISS_KEY = 'spritebrew_early_access_dismissed';

function EarlyAccessBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const dismissed = localStorage.getItem(EARLY_ACCESS_DISMISS_KEY);
      setVisible(!dismissed);
    } catch {
      setVisible(true);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(EARLY_ACCESS_DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-accent-amber/30 bg-accent-amber-glow px-4 py-2.5">
      <p className="flex-1 text-xs font-mono text-accent-amber">
        🧪 Early Access — Free users get 5 generations per day. Pro plan coming soon.
      </p>
      <button
        onClick={handleDismiss}
        className="p-1 rounded text-accent-amber/70 hover:text-accent-amber hover:bg-accent-amber/10 cursor-pointer"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

type GenerateTab = 'create' | 'animate';

export default function GeneratePage() {
  const { userId } = useAuth();
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);
  const setAnimateMode = useSpriteStore((s) => s.setAnimateMode);

  const [tab, setTab] = useState<GenerateTab>('create');
  const [showForm, setShowForm] = useState(true);
  const prevDataUrl = useRef(generatedImageDataUrl);

  useEffect(() => {
    if (generatedImageDataUrl && generatedImageDataUrl !== prevDataUrl.current) {
      setShowForm(false);
    }
    prevDataUrl.current = generatedImageDataUrl;
  }, [generatedImageDataUrl]);

  const handleTabChange = useCallback(
    (newTab: GenerateTab) => {
      setTab(newTab);
      setAnimateMode(newTab);
    },
    [setAnimateMode]
  );

  const handleGenerated = useCallback(async (dataUrl: string, prompt: string, style: string) => {
    // Determine mode + action from the style key
    const isAnimate = style.startsWith('any_animation_');
    const action = isAnimate ? style.replace('any_animation_', '') : undefined;
    await addToHistory({
      userId,
      prompt,
      style,
      mode: isAnimate ? 'animate' : 'create',
      action,
      fullImageDataUrl: dataUrl,
    });
  }, [userId]);

  const handleReset = useCallback(() => {
    setShowForm(true);
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">AI Generate</h1>
        <p className="text-sm font-mono text-text-secondary">
          Create new pixel art characters from text, or animate your own existing
          character art with AI.
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
            Upload, slice, preview, and export are always free — no login needed.
          </p>
          <SignInButton mode="modal">
            <button className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md
              bg-accent-amber text-bg-primary text-sm font-mono font-semibold
              hover:bg-accent-amber-strong cursor-pointer transition-colors animate-pulse">
              <LogIn size={16} />
              Sign In — It&apos;s Free
            </button>
          </SignInButton>
          <p className="mt-4 text-[10px] font-mono text-text-muted">
            Google, GitHub, or email — takes 10 seconds
          </p>
        </div>
      </Show>

      {/* Two-column layout — signed-in only */}
      <Show when="signed-in">
      <EarlyAccessBanner />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form — left 3/5 */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tab switcher */}
          <div className="flex gap-1 rounded-lg bg-bg-secondary p-1 w-fit">
            <button
              onClick={() => handleTabChange('create')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono cursor-pointer transition-colors
                ${tab === 'create'
                  ? 'bg-accent-amber text-bg-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
            >
              <Sparkles size={14} />
              Create New
            </button>
            <button
              onClick={() => handleTabChange('animate')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono cursor-pointer transition-colors
                ${tab === 'animate'
                  ? 'bg-accent-amber text-bg-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
            >
              <Play size={14} />
              Animate My Character
            </button>
          </div>

          {/* Form content */}
          <div className="rounded-lg border border-border-default bg-bg-surface p-6">
            {showForm || !generatedImageDataUrl ? (
              tab === 'create' ? (
                <GenerationForm onGenerated={handleGenerated} />
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
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-border-default bg-bg-surface p-6">
            <GenerationResult onReset={handleReset} />
          </div>
        </div>
      </div>
      </Show>
    </div>
  );
}
