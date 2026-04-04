'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Maximize2, Check } from 'lucide-react';
import { loadImage, resizePixelArt } from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';

const PRESETS = [
  { w: 16, h: 16 },
  { w: 32, h: 32 },
  { w: 48, h: 48 },
  { w: 64, h: 64 },
  { w: 128, h: 128 },
] as const;

interface ImageResizerProps {
  sourceDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Default target size (e.g., 64 for AnimateForm). */
  defaultTarget?: number;
  /** Called when the user accepts the resized image. */
  onAccept: (resizedDataUrl: string, width: number, height: number) => void;
  /** Called if the user cancels/uploads a different image. */
  onCancel?: () => void;
  /** Only highlight this size as recommended. */
  recommendedSize?: number;
}

export default function ImageResizer({
  sourceDataUrl,
  sourceWidth,
  sourceHeight,
  defaultTarget = 64,
  onAccept,
  onCancel,
  recommendedSize = 64,
}: ImageResizerProps) {
  const [targetW, setTargetW] = useState(defaultTarget);
  const [targetH, setTargetH] = useState(defaultTarget);
  const [resizedDataUrl, setResizedDataUrl] = useState<string | null>(null);

  // Re-resize whenever target changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(sourceDataUrl);
        if (cancelled) return;
        const result = resizePixelArt(img, targetW, targetH);
        if (!cancelled) setResizedDataUrl(result);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [sourceDataUrl, targetW, targetH]);

  const handlePreset = useCallback((w: number, h: number) => {
    setTargetW(w);
    setTargetH(h);
  }, []);

  const handleAccept = useCallback(() => {
    if (!resizedDataUrl) return;
    onAccept(resizedDataUrl, targetW, targetH);
  }, [resizedDataUrl, targetW, targetH, onAccept]);

  // Display scale — render the target at a comfortable visible size
  const previewScale = useMemo(() => {
    const maxPx = 256;
    return Math.max(1, Math.floor(maxPx / Math.max(targetW, targetH)));
  }, [targetW, targetH]);

  const displaySize = targetW * previewScale;

  return (
    <div className="rounded-lg border border-border-default bg-bg-surface p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Maximize2 size={14} className="text-accent-amber" />
        <h3 className="text-xs font-mono font-semibold text-text-primary uppercase tracking-wider">
          Pixel-Perfect Resize
        </h3>
      </div>

      <p className="text-[10px] font-mono text-text-muted">
        Your image is {sourceWidth}x{sourceHeight}. Resize it using nearest-neighbor interpolation
        (the correct method for pixel art — no blurring).
      </p>

      {/* Before / After preview */}
      <div className="flex items-center gap-6 justify-center py-2">
        {/* Original */}
        <div className="text-center">
          <p className="text-[9px] font-mono text-text-muted mb-1.5 uppercase tracking-wider">
            Original ({sourceWidth}x{sourceHeight})
          </p>
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
              src={sourceDataUrl}
              alt="Original"
              className="block"
              style={{
                imageRendering: 'pixelated',
                maxWidth: 128,
                maxHeight: 128,
              }}
            />
          </div>
        </div>

        <span className="text-text-muted text-lg font-mono">&rarr;</span>

        {/* Resized */}
        <div className="text-center">
          <p className="text-[9px] font-mono text-accent-amber mb-1.5 uppercase tracking-wider">
            Resized ({targetW}x{targetH})
          </p>
          <div
            className="inline-block rounded border border-accent-amber/40 overflow-hidden"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
              backgroundSize: '6px 6px',
              backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
            }}
          >
            {resizedDataUrl && (
              <img
                src={resizedDataUrl}
                alt="Resized"
                className="block"
                style={{
                  imageRendering: 'pixelated',
                  width: displaySize,
                  height: displaySize,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Preset sizes */}
      <div>
        <label className="block text-[10px] font-mono text-text-muted mb-2 uppercase tracking-wider">
          Target size
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const active = targetW === p.w && targetH === p.h;
            const recommended = p.w === recommendedSize && p.h === recommendedSize;
            return (
              <button
                key={`${p.w}x${p.h}`}
                onClick={() => handlePreset(p.w, p.h)}
                className={`px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors flex items-center gap-1
                  ${active
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {p.w}x{p.h}
                {recommended && !active && (
                  <span className="text-accent-amber">*</span>
                )}
                {active && <Check size={10} />}
              </button>
            );
          })}
        </div>
        {recommendedSize === 64 && (
          <p className="text-[9px] font-mono text-text-muted mt-1">
            * 64x64 is required for Animate My Character
          </p>
        )}
      </div>

      {/* Custom size inputs */}
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-1">Width</label>
          <input
            type="number"
            min={1}
            max={1024}
            value={targetW}
            onChange={(e) => setTargetW(Math.max(1, Number(e.target.value)))}
            className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
              text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-1">Height</label>
          <input
            type="number"
            min={1}
            max={1024}
            value={targetH}
            onChange={(e) => setTargetH(Math.max(1, Number(e.target.value)))}
            className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
              text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Upload Different Image
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" size="sm" onClick={handleAccept} disabled={!resizedDataUrl}>
          <Check size={14} />
          Use Resized
        </Button>
      </div>
    </div>
  );
}
