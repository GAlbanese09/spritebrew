'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Scissors, RefreshCw, Archive, Trash2, ArrowRight, Eraser } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import BrewingLoader from './BrewingLoader';
import { loadImage, removeBackgroundColor } from '@/lib/spriteUtils';
import {
  loadHistory,
  clearHistory,
  type GenerationHistoryEntry,
} from '@/lib/generationHistory';

const ZOOM_OPTIONS = [1, 2, 4, 8] as const;

interface GenerationResultProps {
  onReset: () => void;
}

export default function GenerationResult({ onReset }: GenerationResultProps) {
  const router = useRouter();
  const { userId } = useAuth();
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generatingAction = useSpriteStore((s) => s.generatingAction);
  const clearGeneratedImage = useSpriteStore((s) => s.clearGeneratedImage);
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const originalCharacterDataUrl = useSpriteStore((s) => s.originalCharacterDataUrl);

  const [zoom, setZoom] = useState(4);
  const [history, setHistory] = useState<GenerationHistoryEntry[]>([]);

  // TODO: remove after confirming loading state works in production
  console.log('[GenerationResult] isGenerating:', isGenerating, 'generatingAction:', generatingAction, 'hasResult:', !!generatedImageDataUrl);

  // Background removal state
  const [bgRemovalActive, setBgRemovalActive] = useState(false);
  const [bgRemovedDataUrl, setBgRemovedDataUrl] = useState<string | null>(null);
  const [bgTolerance, setBgTolerance] = useState(10);
  const [detectedBgColor, setDetectedBgColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [bgRemovalError, setBgRemovalError] = useState<string | null>(null);

  // Load history on mount and whenever a new generation arrives or user changes
  useEffect(() => {
    setHistory(loadHistory(userId));
  }, [generatedImageDataUrl, userId]);

  // Reset background removal when a new generation arrives
  useEffect(() => {
    setBgRemovalActive(false);
    setBgRemovedDataUrl(null);
    setDetectedBgColor(null);
    setBgRemovalError(null);
  }, [generatedImageDataUrl]);

  // Recompute background removal when tolerance changes
  useEffect(() => {
    if (!bgRemovalActive || !generatedImageDataUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(generatedImageDataUrl);
        if (cancelled) return;
        const result = removeBackgroundColor(img, bgTolerance);
        if (!cancelled) {
          setBgRemovedDataUrl(result.dataUrl);
          setDetectedBgColor(result.detectedColor);
          setBgRemovalError(null);
        }
      } catch {
        if (!cancelled) setBgRemovalError('Failed to process image.');
      }
    })();
    return () => { cancelled = true; };
  }, [bgRemovalActive, bgTolerance, generatedImageDataUrl]);

  /** The image currently displayed and used for download / Send to Slicer */
  const displayImageDataUrl =
    bgRemovalActive && bgRemovedDataUrl ? bgRemovedDataUrl : generatedImageDataUrl;

  const handleDownload = useCallback(() => {
    if (!displayImageDataUrl) return;
    const a = document.createElement('a');
    a.href = displayImageDataUrl;
    a.download = `spritebrew_generated_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [displayImageDataUrl]);

  const handleSendToSlicer = useCallback(() => {
    // If background removal is active, push the transparent version into the
    // store so the slicer receives the transparent sprite.
    if (bgRemovalActive && bgRemovedDataUrl) {
      setGeneratedImage(bgRemovedDataUrl, bgRemovedDataUrl);
    }
    router.push('/upload');
  }, [router, bgRemovalActive, bgRemovedDataUrl, setGeneratedImage]);

  const handleToggleBgRemoval = useCallback(() => {
    setBgRemovalActive((v) => !v);
  }, []);

  const handleGenerateAnother = useCallback(() => {
    clearGeneratedImage();
    onReset();
  }, [clearGeneratedImage, onReset]);

  const handleClearHistory = useCallback(() => {
    clearHistory(userId);
    setHistory([]);
  }, [userId]);

  // Loading overlay — shown over a previous result (dimmed) or standalone
  const loadingIndicator = isGenerating ? (
    <BrewingLoader action={generatingAction} />
  ) : null;

  // If generating AND there's a previous result, show it dimmed with the
  // loading overlay on top instead of fully replacing it
  if (isGenerating && generatedImageDataUrl) {
    return (
      <div className="relative space-y-4">
        {/* Dimmed previous result */}
        <div className="opacity-20 pointer-events-none">
          <div className="rounded-lg border border-border-default bg-bg-elevated p-4 overflow-auto">
            <div className="inline-block mx-auto">
              <img
                src={displayImageDataUrl ?? generatedImageDataUrl}
                alt="Previous result"
                style={{ imageRendering: 'pixelated' }}
                className="block max-h-48"
              />
            </div>
          </div>
        </div>
        {/* Overlay loading indicator */}
        <div className="absolute inset-0 flex items-center justify-center">
          {loadingIndicator}
        </div>
      </div>
    );
  }

  // Generating with no previous result — show standalone loading
  if (isGenerating) {
    return <>{loadingIndicator}</>;
  }

  if (!generatedImageDataUrl) {
    // Tips / empty state
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-8 text-center">
          <p className="text-sm font-mono text-text-muted mb-4">
            Your generated sprites will appear here
          </p>
          <div className="text-left max-w-xs mx-auto space-y-2">
            <p className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2">
              Tips for good prompts
            </p>
            {[
              'Be specific about colors and style',
              'Mention the action: walking, running, attacking',
              'Include equipment and accessories',
              'Specify the art style: 16-bit, 8-bit, etc.',
            ].map((tip) => (
              <div key={tip} className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-amber/40 mt-1.5 flex-shrink-0" />
                <p className="text-[10px] font-mono text-text-secondary">{tip}</p>
              </div>
            ))}
          </div>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Link
                href="/gallery"
                className="group flex items-center gap-1.5 text-[10px] font-mono text-text-muted
                  hover:text-accent-amber uppercase tracking-wider cursor-pointer transition-colors"
              >
                Recent Generations
                <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <div className="flex items-center gap-2">
                <Link
                  href="/gallery"
                  className="text-[10px] font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer"
                >
                  View all &rarr;
                </Link>
                <button
                  onClick={handleClearHistory}
                  className="text-[10px] font-mono text-text-muted hover:text-text-secondary cursor-pointer"
                >
                  <Trash2 size={10} className="inline mr-1" />
                  Clear
                </button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {history.slice(0, 5).map((entry) => (
                <Link
                  key={entry.id}
                  href="/gallery"
                  className="flex-shrink-0 rounded border border-border-subtle bg-bg-surface p-2 w-28
                    hover:border-accent-amber/40 transition-colors"
                >
                  <div
                    className="w-full aspect-square rounded overflow-hidden mb-1.5"
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                      backgroundSize: '6px 6px',
                      backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
                    }}
                  >
                    <img
                      src={entry.thumbnailDataUrl}
                      alt={entry.prompt}
                      className="w-full h-full object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <p className="text-[9px] font-mono text-text-muted truncate" title={entry.prompt}>
                    {entry.prompt}
                  </p>
                  <p className="text-[8px] font-mono text-text-muted/60">
                    {entry.style}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Original → Animated comparison */}
      {originalCharacterDataUrl && (
        <div className="flex items-center gap-3 justify-center">
          <div className="text-center">
            <p className="text-[9px] font-mono text-text-muted mb-1">Original</p>
            <div
              className="inline-block rounded border border-border-subtle overflow-hidden"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
              }}
            >
              <img
                src={originalCharacterDataUrl}
                alt="Original character"
                className="block w-16 h-16 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </div>
          <span className="text-text-muted text-xs font-mono">&rarr;</span>
          <div className="text-center">
            <p className="text-[9px] font-mono text-accent-amber mb-1">Animated</p>
          </div>
        </div>
      )}

      {/* Result image */}
      <div className="rounded-lg border border-border-default bg-bg-elevated p-4 overflow-auto">
        <div
          className="inline-block mx-auto"
          style={{
            backgroundImage:
              'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
          }}
        >
          <img
            src={displayImageDataUrl ?? generatedImageDataUrl}
            alt="Generated sprite sheet"
            style={{
              imageRendering: 'pixelated',
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>

      {/* Zoom controls */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
          Zoom
        </label>
        {ZOOM_OPTIONS.map((z) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
              ${zoom === z
                ? 'bg-accent-amber text-bg-primary'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
              }`}
          >
            {z}x
          </button>
        ))}
      </div>

      {/* Background removal */}
      <div className="rounded border border-border-default bg-bg-elevated/50 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eraser size={12} className="text-text-muted" />
            <span className="text-[11px] font-mono text-text-primary">
              Remove background
            </span>
            {bgRemovalActive && detectedBgColor && (
              <span className="flex items-center gap-1.5 text-[9px] font-mono text-text-muted">
                <span
                  className="w-3 h-3 rounded border border-border-default"
                  style={{
                    backgroundColor: `rgb(${detectedBgColor.r}, ${detectedBgColor.g}, ${detectedBgColor.b})`,
                  }}
                />
                rgb({detectedBgColor.r}, {detectedBgColor.g}, {detectedBgColor.b})
              </span>
            )}
          </div>
          <button
            onClick={handleToggleBgRemoval}
            className={`px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
              ${bgRemovalActive
                ? 'bg-accent-amber text-bg-primary'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
              }`}
          >
            {bgRemovalActive ? 'Active' : 'Off'}
          </button>
        </div>
        {bgRemovalActive && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-[9px] font-mono text-text-muted w-16">
                Tolerance
              </label>
              <input
                type="range"
                min={0}
                max={60}
                value={bgTolerance}
                onChange={(e) => setBgTolerance(Number(e.target.value))}
                className="flex-1 accent-[var(--accent-amber)]"
              />
              <span className="text-[10px] font-mono text-text-primary w-6 text-right">
                {bgTolerance}
              </span>
            </div>
            <p className="text-[9px] font-mono text-text-muted">
              Samples the corners for the dominant color. Increase tolerance if
              the background isn&apos;t fully removed.
            </p>
            {bgRemovalError && (
              <p className="text-[9px] font-mono text-red-400">{bgRemovalError}</p>
            )}
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" size="md" onClick={handleSendToSlicer}>
          <Scissors size={14} />
          Send to Slicer
        </Button>
        <Button variant="secondary" size="md" onClick={handleDownload}>
          <Download size={14} />
          Download PNG
        </Button>
        <Button variant="ghost" size="md" onClick={handleGenerateAnother}>
          <RefreshCw size={14} />
          Generate Another
        </Button>
        <Link href="/gallery" className="contents">
          <Button variant="ghost" size="md">
            <Archive size={14} />
            View Gallery
          </Button>
        </Link>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/gallery"
              className="text-[10px] font-mono text-text-muted hover:text-accent-amber uppercase tracking-wider cursor-pointer"
            >
              Recent &rarr;
            </Link>
            <button
              onClick={handleClearHistory}
              className="text-[10px] font-mono text-text-muted hover:text-text-secondary cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2">
            {history.slice(0, 5).map((entry) => (
              <Link
                key={entry.id}
                href="/gallery"
                className="flex-shrink-0 w-12 h-12 rounded border border-border-subtle overflow-hidden hover:border-accent-amber/40"
                title={entry.prompt}
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                  backgroundSize: '4px 4px',
                  backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0',
                }}
              >
                <img
                  src={entry.thumbnailDataUrl}
                  alt={entry.prompt}
                  className="w-full h-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

