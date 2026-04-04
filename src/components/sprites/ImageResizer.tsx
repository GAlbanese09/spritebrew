'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Maximize2, Check, Lock, Unlock, AlertCircle } from 'lucide-react';
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
  /** Default target size (e.g., 64 for AnimateForm, 128 for Upload). */
  defaultTarget?: number;
  /** Called when the user accepts the resized image. */
  onAccept: (resizedDataUrl: string, width: number, height: number) => void;
  /** Called if the user cancels/uploads a different image. */
  onCancel?: () => void;
  /** Called when the user chooses to keep the original (only if allowKeepOriginal). */
  onKeepOriginal?: () => void;
  /** Allow the user to skip resizing and proceed with the original image. */
  allowKeepOriginal?: boolean;
  /** Warning text shown next to the "Keep Original Size" button. */
  keepOriginalWarning?: string;
  /** Highlighted/required size; shown with a note and preset emphasized. */
  recommendedSize?: number;
  /** Optional headline that overrides the default "Pixel-Perfect Resize" title. */
  title?: string;
  /** Optional description sentence shown under the title. */
  description?: string;
  /** If true, show a note that the source is a GIF and resizing may affect frames. */
  isGif?: boolean;
}

export default function ImageResizer({
  sourceDataUrl,
  sourceWidth,
  sourceHeight,
  defaultTarget = 64,
  onAccept,
  onCancel,
  onKeepOriginal,
  allowKeepOriginal = false,
  keepOriginalWarning,
  recommendedSize,
  title = 'Pixel-Perfect Resize',
  description,
  isGif = false,
}: ImageResizerProps) {
  const aspectRatio = useMemo(
    () => (sourceHeight > 0 ? sourceWidth / sourceHeight : 1),
    [sourceWidth, sourceHeight]
  );
  const isSquareSource = sourceWidth === sourceHeight;

  const [targetW, setTargetW] = useState(defaultTarget);
  const [targetH, setTargetH] = useState(() =>
    isSquareSource ? defaultTarget : Math.max(1, Math.round(defaultTarget / aspectRatio))
  );
  const [lockAspect, setLockAspect] = useState(true);
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

  const handleWidthChange = useCallback((val: number) => {
    const clamped = Math.max(1, Math.min(1024, val));
    setTargetW(clamped);
    if (lockAspect) {
      setTargetH(Math.max(1, Math.round(clamped / aspectRatio)));
    }
  }, [lockAspect, aspectRatio]);

  const handleHeightChange = useCallback((val: number) => {
    const clamped = Math.max(1, Math.min(1024, val));
    setTargetH(clamped);
    if (lockAspect) {
      setTargetW(Math.max(1, Math.round(clamped * aspectRatio)));
    }
  }, [lockAspect, aspectRatio]);

  const handlePreset = useCallback((w: number, h: number) => {
    // Presets are always square — explicit user intent overrides aspect lock
    setTargetW(w);
    setTargetH(h);
  }, []);

  const handleAccept = useCallback(() => {
    if (!resizedDataUrl) return;
    onAccept(resizedDataUrl, targetW, targetH);
  }, [resizedDataUrl, targetW, targetH, onAccept]);

  const handleKeepOriginal = useCallback(() => {
    onKeepOriginal?.();
  }, [onKeepOriginal]);

  // Display scale — render the target at a comfortable visible size
  const previewScale = useMemo(() => {
    const maxPx = 256;
    return Math.max(1, Math.floor(maxPx / Math.max(targetW, targetH)));
  }, [targetW, targetH]);

  return (
    <div className="rounded-lg border border-accent-amber/30 bg-bg-surface p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Maximize2 size={16} className="text-accent-amber mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-xs font-mono font-semibold text-text-primary uppercase tracking-wider mb-1">
            {title}
          </h3>
          <p className="text-[10px] font-mono text-text-muted leading-relaxed">
            {description ?? (
              <>Your image is {sourceWidth}x{sourceHeight}. For best results with pixel art,
              images should be 128x128 or smaller. Resizing uses nearest-neighbor interpolation
              (no blurring).</>
            )}
          </p>
          {isGif && (
            <p className="text-[10px] font-mono text-amber-400 mt-1">
              Note: GIF resizing may affect animation frames.
            </p>
          )}
        </div>
      </div>

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
                  width: targetW * previewScale,
                  height: targetH * previewScale,
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
                    : recommended
                      ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/40 hover:bg-accent-amber/30'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {p.w}x{p.h}
                {recommended && !active && <span>*</span>}
                {active && <Check size={10} />}
              </button>
            );
          })}
        </div>
        {recommendedSize && (
          <p className="text-[9px] font-mono text-accent-amber mt-1.5">
            * {recommendedSize}x{recommendedSize} required for Animate My Character
          </p>
        )}
      </div>

      {/* Custom size inputs + aspect lock toggle */}
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-1">Width</label>
          <input
            type="number"
            min={1}
            max={1024}
            value={targetW}
            onChange={(e) => handleWidthChange(Number(e.target.value))}
            className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
              text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
          />
        </div>
        <button
          onClick={() => setLockAspect((v) => !v)}
          title={lockAspect ? 'Aspect ratio locked — click to unlock' : 'Aspect ratio unlocked — click to lock'}
          className={`mb-1 p-1.5 rounded border cursor-pointer transition-colors
            ${lockAspect
              ? 'border-accent-amber/40 bg-accent-amber-glow text-accent-amber'
              : 'border-border-default bg-bg-elevated text-text-muted hover:text-text-primary'
            }`}
        >
          {lockAspect ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-1">Height</label>
          <input
            type="number"
            min={1}
            max={1024}
            value={targetH}
            onChange={(e) => handleHeightChange(Number(e.target.value))}
            className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
              text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
          />
        </div>
        <p className="text-[9px] font-mono text-text-muted mb-2 ml-1">
          {lockAspect ? 'Aspect locked' : 'Free ratio'}
        </p>
      </div>

      {/* Keep original warning */}
      {allowKeepOriginal && keepOriginalWarning && (
        <div className="flex items-start gap-2 rounded bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <AlertCircle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] font-mono text-amber-400">{keepOriginalWarning}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Upload Different
            </Button>
          )}
          {allowKeepOriginal && onKeepOriginal && (
            <Button variant="secondary" size="sm" onClick={handleKeepOriginal}>
              Keep Original Size
            </Button>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={handleAccept} disabled={!resizedDataUrl}>
          <Check size={14} />
          Use Resized
        </Button>
      </div>
    </div>
  );
}
