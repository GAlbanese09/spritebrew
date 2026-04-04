'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Play } from 'lucide-react';
import GenerationForm from '@/components/sprites/GenerationForm';
import AnimateForm from '@/components/sprites/AnimateForm';
import GenerationResult from '@/components/sprites/GenerationResult';
import { addToHistory } from '@/lib/generationHistory';
import { useSpriteStore } from '@/stores/spriteStore';

type GenerateTab = 'create' | 'animate';

export default function GeneratePage() {
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
      prompt,
      style,
      mode: isAnimate ? 'animate' : 'create',
      action,
      fullImageDataUrl: dataUrl,
    });
  }, []);

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

      {/* Two-column layout */}
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
    </div>
  );
}
