'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import GenerationForm from '@/components/sprites/GenerationForm';
import GenerationResult, { addToHistory } from '@/components/sprites/GenerationResult';
import { useSpriteStore } from '@/stores/spriteStore';

export default function GeneratePage() {
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);
  const [showForm, setShowForm] = useState(true);
  const prevDataUrl = useRef(generatedImageDataUrl);

  // Hide the form when a new generation completes — done in useEffect
  // so the Zustand store update settles before we trigger a React state change
  useEffect(() => {
    if (generatedImageDataUrl && generatedImageDataUrl !== prevDataUrl.current) {
      setShowForm(false);
    }
    prevDataUrl.current = generatedImageDataUrl;
  }, [generatedImageDataUrl]);

  const handleGenerated = useCallback(async (dataUrl: string, prompt: string, style: string) => {
    // Don't call setShowForm here — the useEffect above handles it after
    // the store update settles, avoiding a mid-batch component unmount.
    await addToHistory(dataUrl, prompt, style);
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
          Describe a character and generate a pixel art animation sprite sheet
          using AI. Send the result to the Slicer for frame extraction.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form — left 3/5 */}
        <div className="lg:col-span-3">
          <div className="rounded-lg border border-border-default bg-bg-surface p-6">
            {(showForm || !generatedImageDataUrl) ? (
              <GenerationForm onGenerated={handleGenerated} />
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
