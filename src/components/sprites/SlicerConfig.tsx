'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Grid3X3, Scan, Scissors, AlertTriangle, Lock, X } from 'lucide-react';
import { SLICER_FRAME_PRESETS } from '@/lib/constants';
import { detectFrameGrid, loadImage, imageToCanvas } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import { useCanvasFitScale } from '@/lib/useCanvasFitScale';
import Button from '@/components/ui/Button';

interface SanityWarning {
  message: string;
  suggestion: string;
}

interface SlicerConfigProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onSlice: (config: SliceConfig) => void;
  /** Pre-populate frame dimensions (from FrameSizeResizer). Skips auto-detect. */
  initialFrameWidth?: number;
  initialFrameHeight?: number;
}

export interface SliceConfig {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  padding: number;
  offsetX: number;
  offsetY: number;
}

export default function SlicerConfig({
  imageUrl,
  imageWidth,
  imageHeight,
  onSlice,
  initialFrameWidth,
  initialFrameHeight,
}: SlicerConfigProps) {
  const generationStyle = useSpriteStore((s) => s.generationStyle);
  const [frameWidth, setFrameWidth] = useState(initialFrameWidth ?? 32);
  const [frameHeight, setFrameHeight] = useState(initialFrameHeight ?? 32);
  const [padding, setPadding] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [sanityWarning, setSanityWarning] = useState<SanityWarning | null>(null);
  // Local override gate: when true, the user has bypassed the any_animation_*
  // 64x64 lock and can edit dimensions freely. Does NOT modify generationStyle
  // in the store — purely a UI gate.
  const [overrideAnyAnimationLock, setOverrideAnyAnimationLock] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Wave M2: measure the canvas wrapper's actual width so mobile-portrait
  // (~270-300px) doesn't paint a 600px canvas that then needs horizontal
  // scroll inside its overflow-auto wrapper. Legacy maxWidth: 600 preserves
  // desktop pixel-identical output.
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const previewScale = useCanvasFitScale(imageWidth, previewWrapperRef, { maxWidth: 600 });

  // Live frame count — uses safe Math.max(0, ...) so an oversized frame width
  // produces 0 columns instead of negative numbers.
  const safeStep = (size: number) => (size > 0 ? size + padding : 1);
  const columns = Math.max(0, Math.floor((imageWidth - offsetX) / safeStep(frameWidth)));
  const rows = Math.max(0, Math.floor((imageHeight - offsetY) / safeStep(frameHeight)));
  const totalFrames = columns * rows;

  const isAnyAnimationStyle = !!(generationStyle && generationStyle.startsWith('any_animation_'));
  const isAnyAnimationLockActive = isAnyAnimationStyle && !overrideAnyAnimationLock;

  // Auto-detect on mount — unless the caller pre-populated frame dimensions
  // (e.g. from FrameSizeResizer), in which case trust those and skip detect.
  useEffect(() => {
    if (initialFrameWidth && initialFrameHeight) {
      setFrameWidth(initialFrameWidth);
      setFrameHeight(initialFrameHeight);
      setPadding(0);
      setOffsetX(0);
      setOffsetY(0);
      return;
    }
    handleAutoDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, initialFrameWidth, initialFrameHeight]);

  const handleAutoDetect = useCallback(async () => {
    setDetecting(true);
    setSanityWarning(null);
    try {
      // Animate My Character results use rd_advanced_animation__* styles which
      // output 64x64 frames in a 2-row grid (cols = frames/2). Force 64x64
      // unless the user has explicitly overridden the lock.
      if (isAnyAnimationStyle && !overrideAnyAnimationLock) {
        setFrameWidth(64);
        setFrameHeight(64);
        setPadding(0);
        setOffsetX(0);
        setOffsetY(0);
        return;
      }

      const img = await loadImage(imageUrl);
      const canvas = imageToCanvas(img);
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = detectFrameGrid(imgData);
      if (!result) {
        setSanityWarning({
          message: 'Auto-detect could not determine frame size.',
          suggestion: 'Try entering values manually or pick a preset below.',
        });
        return;
      }

      // Apply the detection
      setFrameWidth(result.width);
      setFrameHeight(result.height);
      setPadding(0);
      setOffsetX(0);
      setOffsetY(0);

      // Sanity-check the result. Don't block the user — apply and warn so they
      // can sanity-check what was picked.
      const detectedFrameCount = result.columns * result.rows;
      const isAbsurd =
        detectedFrameCount > 256 ||
        result.width < 16 || result.height < 16 ||
        result.width > imageWidth / 2 ||
        result.height > imageHeight / 2;

      if (isAbsurd) {
        setSanityWarning({
          message: `Auto-detect found ${detectedFrameCount} frames at ${result.width}×${result.height}. This is unusual.`,
          suggestion: "If this isn't a sprite sheet, try entering frame size manually below.",
        });
      }
    } catch {
      // Detection failed — keep defaults
      setSanityWarning({
        message: 'Auto-detect failed unexpectedly.',
        suggestion: 'Try entering values manually below.',
      });
    } finally {
      setDetecting(false);
    }
  }, [imageUrl, isAnyAnimationStyle, overrideAnyAnimationLock, imageWidth, imageHeight]);

  // Draw preview with grid overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      // Wave M2: container-aware scale via useCanvasFitScale — clamped by the
      // wrapper's clientWidth so mobile-portrait paints a canvas that fits
      // its container instead of overflowing the overflow-auto wrapper.
      const scale = previewScale;
      const displayW = Math.floor(imageWidth * scale);
      const displayH = Math.floor(imageHeight * scale);

      canvas.width = displayW;
      canvas.height = displayH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;

      // Draw sprite sheet
      ctx.drawImage(img, 0, 0, displayW, displayH);

      // Draw grid overlay
      ctx.strokeStyle = 'rgba(212, 135, 28, 0.7)';
      ctx.lineWidth = 1;
      ctx.font = `${Math.max(8, Math.floor(10 * scale))}px JetBrains Mono, monospace`;
      ctx.fillStyle = 'rgba(212, 135, 28, 0.9)';

      let frameNum = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const x = (offsetX + c * (frameWidth + padding)) * scale;
          const y = (offsetY + r * (frameHeight + padding)) * scale;
          const w = frameWidth * scale;
          const h = frameHeight * scale;

          ctx.strokeRect(x + 0.5, y + 0.5, w, h);

          // Frame number
          const label = String(frameNum);
          ctx.save();
          ctx.globalAlpha = 0.8;
          const textW = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
          ctx.fillRect(x + 1, y + 1, textW + 4, Math.max(10, Math.floor(12 * scale)));
          ctx.fillStyle = 'rgba(212, 135, 28, 0.9)';
          ctx.fillText(label, x + 3, y + Math.max(9, Math.floor(11 * scale)));
          ctx.restore();

          frameNum++;
        }
      }
    };
    img.src = imageUrl;
  }, [imageUrl, imageWidth, imageHeight, frameWidth, frameHeight, columns, rows, padding, offsetX, offsetY, previewScale]);

  const handleSlice = () => {
    onSlice({ frameWidth, frameHeight, columns, rows, padding, offsetX, offsetY });
  };

  /** Compute how many frames a given preset would produce on the current image. */
  const presetFrameCount = useCallback(
    (presetW: number, presetH: number): number => {
      const cols = Math.max(0, Math.floor((imageWidth - offsetX) / (presetW + padding)));
      const rowsCount = Math.max(0, Math.floor((imageHeight - offsetY) / (presetH + padding)));
      return cols * rowsCount;
    },
    [imageWidth, imageHeight, offsetX, offsetY, padding]
  );

  /** Wrap a setter so manual edits clear the sanity warning. */
  const setSizeAndClearWarning = useCallback(
    (next: () => void) => {
      next();
      if (sanityWarning) setSanityWarning(null);
    },
    [sanityWarning]
  );

  return (
    <div className="space-y-6">
      {/* any_animation_* lock banner — surfaces the implicit 64x64 override */}
      {isAnyAnimationStyle && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-amber/30 bg-accent-amber-glow px-4 py-3">
          <Lock size={14} className="text-accent-amber flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs font-mono text-accent-amber leading-relaxed">
            {isAnyAnimationLockActive ? (
              <>
                <strong>Locked to 64×64</strong> because this came from an &ldquo;Any
                Animation&rdquo; generation. Retro Diffusion&apos;s{' '}
                <code className="bg-bg-primary/40 px-1 rounded">animation__any_animation</code>{' '}
                style always produces 64×64 frames.
                <button
                  onClick={() => setOverrideAnyAnimationLock(true)}
                  className="block mt-1 underline hover:text-accent-amber-strong cursor-pointer"
                >
                  Override and edit manually
                </button>
              </>
            ) : (
              <>
                <strong>Lock overridden.</strong> You can edit frame size below.
                <button
                  onClick={() => setOverrideAnyAnimationLock(false)}
                  className="block mt-1 underline hover:text-accent-amber-strong cursor-pointer"
                >
                  Re-enable 64×64 lock
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Frame size */}
      <div>
        <label className="flex items-center gap-2 text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          <Grid3X3 size={14} />
          Frame Size
        </label>

        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <label className="block text-[10px] font-mono text-text-muted mb-1">Width</label>
            <input
              type="number"
              min={1}
              max={imageWidth}
              value={frameWidth}
              disabled={isAnyAnimationLockActive}
              onChange={(e) => setSizeAndClearWarning(() => setFrameWidth(Math.max(1, Number(e.target.value))))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber
                disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-mono text-text-muted mb-1">Height</label>
            <input
              type="number"
              min={1}
              max={imageHeight}
              value={frameHeight}
              disabled={isAnyAnimationLockActive}
              onChange={(e) => setSizeAndClearWarning(() => setFrameHeight(Math.max(1, Number(e.target.value))))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber
                disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Quick-select sizes — disabled while any_animation lock is active */}
        <div className="flex flex-wrap gap-1.5">
          {SLICER_FRAME_PRESETS.map((s) => {
            const count = presetFrameCount(s.width, s.height);
            const lockedTip = isAnyAnimationLockActive
              ? 'Locked to 64×64 — click "Override and edit manually" above to change.'
              : `→ ${count} frame${count !== 1 ? 's' : ''} at ${s.label}`;
            return (
              <button
                key={s.label}
                onClick={() => {
                  if (isAnyAnimationLockActive) return;
                  setSizeAndClearWarning(() => {
                    setFrameWidth(s.width);
                    setFrameHeight(s.height);
                  });
                }}
                title={lockedTip}
                disabled={isAnyAnimationLockActive}
                className={`px-2 py-1 rounded text-[10px] font-mono transition-colors
                  ${isAnyAnimationLockActive
                    ? 'bg-bg-elevated text-text-muted/50 cursor-not-allowed border border-border-subtle/50'
                    : frameWidth === s.width && frameHeight === s.height
                      ? 'bg-accent-amber text-bg-primary cursor-pointer'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-border-subtle cursor-pointer'
                  }
                `}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Auto-detect sanity warning — non-blocking, dismissible */}
      {sanityWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-mono text-amber-400">{sanityWarning.message}</p>
            <p className="text-[10px] font-mono text-amber-400/70 mt-1">{sanityWarning.suggestion}</p>
          </div>
          <button
            onClick={() => setSanityWarning(null)}
            className="text-amber-400 hover:text-amber-300 cursor-pointer flex-shrink-0"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Auto-detect */}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleAutoDetect}
        disabled={detecting}
      >
        <Scan size={14} />
        {detecting ? 'Detecting...' : 'Auto-detect'}
      </Button>

      {/* Grid settings */}
      <div>
        <label className="text-xs font-mono text-text-secondary uppercase tracking-wider mb-3 block">
          Grid Settings
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-mono text-text-muted mb-1">Columns</label>
            <input
              type="number"
              min={1}
              value={columns}
              readOnly
              className="w-full rounded bg-bg-elevated border border-border-subtle px-3 py-2
                text-sm font-mono text-text-muted"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-text-muted mb-1">Rows</label>
            <input
              type="number"
              min={1}
              value={rows}
              readOnly
              className="w-full rounded bg-bg-elevated border border-border-subtle px-3 py-2
                text-sm font-mono text-text-muted"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-text-muted mb-1">Padding (px)</label>
            <input
              type="number"
              min={0}
              max={4}
              value={padding}
              onChange={(e) => setPadding(Math.min(4, Math.max(0, Number(e.target.value))))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-text-muted mb-1">Offset X</label>
            <input
              type="number"
              min={0}
              value={offsetX}
              onChange={(e) => setOffsetX(Math.max(0, Number(e.target.value)))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-text-muted mb-1">Offset Y</label>
            <input
              type="number"
              min={0}
              value={offsetY}
              onChange={(e) => setOffsetY(Math.max(0, Number(e.target.value)))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
        </div>
      </div>

      {/* Grid overlay preview */}
      <div>
        <label className="text-xs font-mono text-text-secondary uppercase tracking-wider mb-3 block">
          Preview
        </label>
        <div
          ref={previewWrapperRef}
          className="rounded-lg border border-border-default bg-bg-elevated p-3 overflow-auto"
        >
          <canvas
            ref={canvasRef}
            className="block mx-auto pixel-art-render"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      </div>

      {/* Slice button — live frame count + zero-frame warning. flex-wrap
          keeps the primary "Slice into Frames" button reachable on portrait
          where the label + button together exceed the card content width. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {totalFrames === 0 ? (
          <p className="text-xs font-mono text-amber-400">
            0 frames &mdash; frame size doesn&apos;t fit your image
          </p>
        ) : (
          <p className="text-xs font-mono text-text-muted">
            &rarr; <span className="text-accent-amber font-semibold">{totalFrames}</span> frames
            <span className="text-text-muted/70"> ({columns} cols × {rows} rows)</span>
          </p>
        )}
        <Button size="lg" onClick={handleSlice} disabled={totalFrames === 0}>
          <Scissors size={16} />
          Slice into Frames
        </Button>
      </div>
    </div>
  );
}
