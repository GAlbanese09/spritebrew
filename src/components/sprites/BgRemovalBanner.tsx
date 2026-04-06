'use client';

import { useEffect, useState, useCallback } from 'react';
import { Eraser, Check, X } from 'lucide-react';
import {
  loadImage,
  imageToCanvas,
  detectSolidBackground,
  removeBackgroundColor,
} from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';

/**
 * Non-intrusive banner shown when a sprite sheet has a solid background.
 *
 * Workflow:
 *   1. On mount, samples the image corners via `detectSolidBackground`.
 *   2. If a solid color is found, renders a compact card with two choices:
 *        "Remove Background" (shows tolerance slider + preview + Apply)
 *        "Keep" (dismisses the banner)
 *   3. On Apply, emits the cleaned data URL to the parent. The parent
 *      swaps the in-memory source image — the original upload is untouched.
 */

interface BgRemovalBannerProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** Called with the background-removed data URL on Apply. */
  onRemoved: (cleanedDataUrl: string) => void;
  /** Called when the user dismisses (clicks Keep). */
  onDismiss: () => void;
}

type BannerState = 'detecting' | 'detected' | 'adjusting' | 'none';

export default function BgRemovalBanner({
  imageUrl,
  imageWidth,
  imageHeight,
  onRemoved,
  onDismiss,
}: BgRemovalBannerProps) {
  const [state, setState] = useState<BannerState>('detecting');
  const [bgColor, setBgColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [tolerance, setTolerance] = useState(30);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Auto-detect on mount / image change
  useEffect(() => {
    let cancelled = false;
    setState('detecting');
    setBgColor(null);

    (async () => {
      try {
        const img = await loadImage(imageUrl);
        if (cancelled) return;
        const canvas = imageToCanvas(img);
        const ctx = canvas.getContext('2d')!;
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const detected = detectSolidBackground(imgData);
        if (cancelled) return;

        if (detected) {
          setBgColor(detected);
          setState('detected');
        } else {
          setState('none');
        }
      } catch {
        if (!cancelled) setState('none');
      }
    })();

    return () => { cancelled = true; };
  }, [imageUrl]);

  // Re-compute preview whenever tolerance changes while adjusting
  useEffect(() => {
    if (state !== 'adjusting' || !bgColor) return;
    let cancelled = false;

    (async () => {
      try {
        const img = await loadImage(imageUrl);
        if (cancelled) return;
        const result = removeBackgroundColor(img, tolerance, bgColor);
        if (!cancelled) setPreviewUrl(result.dataUrl);
      } catch {
        // ignore
      }
    })();

    return () => { cancelled = true; };
  }, [state, bgColor, tolerance, imageUrl]);

  const handleRemoveClick = useCallback(() => {
    setState('adjusting');
  }, []);

  const handleApply = useCallback(() => {
    if (previewUrl) {
      onRemoved(previewUrl);
    }
  }, [previewUrl, onRemoved]);

  // Don't render anything if no background detected or still detecting
  if (state === 'none' || state === 'detecting') return null;

  const colorStr = bgColor
    ? `rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`
    : '';

  // Compact "detected" banner with two action buttons
  if (state === 'detected') {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-accent-amber/30 bg-accent-amber-glow px-4 py-3">
        <Eraser size={14} className="text-accent-amber flex-shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="w-5 h-5 rounded border border-border-default flex-shrink-0"
            style={{ backgroundColor: colorStr }}
            title={colorStr}
          />
          <p className="text-xs font-mono text-accent-amber truncate">
            Solid background detected
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button variant="primary" size="sm" onClick={handleRemoveClick}>
            Remove Background
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Keep
          </Button>
        </div>
      </div>
    );
  }

  // "Adjusting" state: tolerance slider + before/after preview + Apply
  return (
    <div className="rounded-lg border border-accent-amber/30 bg-bg-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eraser size={14} className="text-accent-amber" />
          <span className="text-xs font-mono font-semibold text-text-primary">
            Remove Background
          </span>
          <span
            className="w-4 h-4 rounded border border-border-default"
            style={{ backgroundColor: colorStr }}
            title={colorStr}
          />
          <span className="text-[10px] font-mono text-text-muted">{colorStr}</span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
          title="Cancel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tolerance slider */}
      <div className="flex items-center gap-3">
        <label className="text-[10px] font-mono text-text-muted w-16">Tolerance</label>
        <input
          type="range"
          min={0}
          max={100}
          value={tolerance}
          onChange={(e) => setTolerance(Number(e.target.value))}
          className="flex-1 accent-[var(--accent-amber)]"
        />
        <span className="text-[10px] font-mono text-text-primary w-8 text-right">
          {tolerance}
        </span>
      </div>

      {/* Before / After preview */}
      <div className="flex items-center gap-4 justify-center">
        {/* Before */}
        <div className="text-center">
          <p className="text-[9px] font-mono text-text-muted mb-1 uppercase tracking-wider">
            Before
          </p>
          <div className="inline-block rounded border border-border-subtle overflow-hidden">
            <img
              src={imageUrl}
              alt="Before"
              className="block"
              style={{
                imageRendering: 'pixelated',
                maxWidth: Math.min(200, imageWidth),
                maxHeight: Math.min(150, imageHeight),
              }}
            />
          </div>
        </div>

        <span className="text-text-muted font-mono">&rarr;</span>

        {/* After */}
        <div className="text-center">
          <p className="text-[9px] font-mono text-accent-amber mb-1 uppercase tracking-wider">
            After
          </p>
          <div
            className="inline-block rounded border border-accent-amber/40 overflow-hidden"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="After removal"
                className="block"
                style={{
                  imageRendering: 'pixelated',
                  maxWidth: Math.min(200, imageWidth),
                  maxHeight: Math.min(150, imageHeight),
                }}
              />
            ) : (
              <div
                className="flex items-center justify-center text-[10px] font-mono text-text-muted"
                style={{
                  width: Math.min(200, imageWidth),
                  height: Math.min(150, imageHeight),
                }}
              >
                Processing...
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[9px] font-mono text-text-muted text-center">
        Increase tolerance if some background pixels remain. Decrease if character pixels are being removed.
      </p>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleApply} disabled={!previewUrl}>
          <Check size={14} />
          Apply
        </Button>
      </div>
    </div>
  );
}
