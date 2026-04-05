'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Maximize2, Check } from 'lucide-react';
import { loadImage, fitToSquare, resizePixelArt } from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';

/**
 * Fit-and-pad resizer for the Animate My Character flow.
 *
 * Unlike `ImageResizer` (which stretches to exact dimensions), this component
 * preserves the source aspect ratio:
 *   - If the source is square → simple nearest-neighbor resize to targetSize.
 *   - If the source is non-square → scale the longest side to targetSize,
 *     center the scaled character on a targetSize × targetSize canvas, and
 *     pad the remaining area with the selected background color.
 *
 * This is critical for animation input: a 64×171 character must NOT be
 * squashed to 64×64 — the AI needs the real proportions.
 */

const BG_COLORS = [
  { id: 'black', label: 'Black', color: '#000000' },
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'green', label: 'Green', color: '#00ff00' },
  { id: 'magenta', label: 'Magenta', color: '#ff00ff' },
] as const;

interface FitPadResizerProps {
  sourceDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Target size for both width and height (e.g., 64). */
  targetSize: number;
  /** Called when the user accepts the fit-padded result. */
  onAccept: (resizedDataUrl: string, width: number, height: number) => void;
  /** Called if the user wants to upload a different image. */
  onCancel?: () => void;
  /** Initial padding color (falls back to black). */
  defaultBgColor?: string;
}

export default function FitPadResizer({
  sourceDataUrl,
  sourceWidth,
  sourceHeight,
  targetSize,
  onAccept,
  onCancel,
  defaultBgColor = '#000000',
}: FitPadResizerProps) {
  const [bgColor, setBgColor] = useState(defaultBgColor);
  const [resizedDataUrl, setResizedDataUrl] = useState<string | null>(null);
  const isSquare = sourceWidth === sourceHeight;

  // Compute scaled dimensions for display summary
  const { scaledW, scaledH } = useMemo(() => {
    const scale = Math.min(targetSize / sourceWidth, targetSize / sourceHeight);
    return {
      scaledW: Math.max(1, Math.round(sourceWidth * scale)),
      scaledH: Math.max(1, Math.round(sourceHeight * scale)),
    };
  }, [sourceWidth, sourceHeight, targetSize]);

  // Re-render the fit-padded preview whenever source or bg color changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(sourceDataUrl);
        if (cancelled) return;
        const result = isSquare
          ? resizePixelArt(img, targetSize, targetSize)
          : fitToSquare(img, targetSize, bgColor);
        if (!cancelled) setResizedDataUrl(result);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [sourceDataUrl, bgColor, targetSize, isSquare]);

  const handleAccept = useCallback(() => {
    if (!resizedDataUrl) return;
    onAccept(resizedDataUrl, targetSize, targetSize);
  }, [resizedDataUrl, targetSize, onAccept]);

  // Display scale — render the target at a comfortable visible size
  const previewScale = Math.max(1, Math.floor(256 / targetSize));

  return (
    <div className="rounded-lg border border-accent-amber/30 bg-bg-surface p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Maximize2 size={16} className="text-accent-amber mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-xs font-mono font-semibold text-text-primary uppercase tracking-wider mb-1">
            Resize Required — {targetSize}x{targetSize}
          </h3>
          <p className="text-[10px] font-mono text-text-muted leading-relaxed">
            Your character is{' '}
            <span className="text-text-primary">{sourceWidth}x{sourceHeight}</span>.
            Animate My Character requires exactly {targetSize}x{targetSize}.
            {!isSquare && (
              <>
                {' '}Your image isn&apos;t square, so we&apos;ll scale it to{' '}
                <span className="text-text-primary">{scaledW}x{scaledH}</span> and
                center it on a {targetSize}x{targetSize} canvas with background
                padding — the character is <span className="text-accent-amber">not stretched</span>.
              </>
            )}
            {isSquare && (
              <> Resizing with nearest-neighbor (no blurring).</>
            )}
          </p>
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

        {/* Fit-padded */}
        <div className="text-center">
          <p className="text-[9px] font-mono text-accent-amber mb-1.5 uppercase tracking-wider">
            Fit-padded ({targetSize}x{targetSize})
          </p>
          <div className="inline-block rounded border border-accent-amber/40 overflow-hidden">
            {resizedDataUrl && (
              <img
                src={resizedDataUrl}
                alt="Resized"
                className="block"
                style={{
                  imageRendering: 'pixelated',
                  width: targetSize * previewScale,
                  height: targetSize * previewScale,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Background color selector — only meaningful for non-square sources */}
      {!isSquare && (
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-2 uppercase tracking-wider">
            Padding color
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
          <p className="text-[9px] font-mono text-text-muted mt-1.5">
            Pick a color that contrasts with your character so the AI can tell them apart.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Upload Different
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
