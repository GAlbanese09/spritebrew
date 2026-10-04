'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Grid3X3, Scan, Scissors, AlertTriangle, X } from 'lucide-react';
import { SLICER_FRAME_PRESETS } from '@/lib/constants';
import { detectFrameGrid, loadImage, imageToCanvas } from '@/lib/spriteUtils';
import { sheetGeometry, galleryFrameSizeGuess, type SheetGeometry } from '@/lib/animationGeometry';
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
  /** Keep only the first maxFrames cells, read row-major (a generated sheet
   *  whose last row is part empty). Undefined keeps every cell. */
  maxFrames?: number;
}

/** One-tap sizes for a gallery animation, whose entry records no frame size. */
const GALLERY_FRAME_SIZES = [128, 64] as const;

export default function SlicerConfig({
  imageUrl,
  imageWidth,
  imageHeight,
  onSlice,
  initialFrameWidth,
  initialFrameHeight,
}: SlicerConfigProps) {
  const currentSheetMetadata = useSpriteStore((s) => s.currentSheetMetadata);
  const [frameWidth, setFrameWidth] = useState(initialFrameWidth ?? 32);
  const [frameHeight, setFrameHeight] = useState(initialFrameHeight ?? 32);
  const [padding, setPadding] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [sanityWarning, setSanityWarning] = useState<SanityWarning | null>(null);
  // Frame cap from a generated sheet's geometry (trailing empty cells are
  // dropped). Null keeps every cell; a manual size edit clears it.
  const [frameLimit, setFrameLimit] = useState<number | null>(null);
  // True once the size in the fields came from the generation, until the
  // user edits it. Drives the note under the Frame Size label.
  const [fromGeneration, setFromGeneration] = useState(false);
  // Gallery animations: true after the user taps Other in the frame-size row.
  const [otherSizeChosen, setOtherSizeChosen] = useState(false);
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
  const totalFrames = frameLimit !== null ? Math.min(columns * rows, frameLimit) : columns * rows;

  // Generated animations carry their geometry in the sheet hints. The result
  // card sets frameSize; a gallery entry has none, so its size is guessed
  // and the user picks from the frame-size row. Its frameCount is a
  // placeholder and is not trusted. Anything else auto-detects.
  const isAnimateSheet = currentSheetMetadata?.source === 'animate';
  const hintedFrameSize = isAnimateSheet ? currentSheetMetadata?.frameSize : undefined;
  const showFrameSizeRow = isAnimateSheet && hintedFrameSize === undefined;

  const applyGeometry = useCallback((g: SheetGeometry) => {
    setFrameWidth(g.frameW);
    setFrameHeight(g.frameH);
    setPadding(0);
    setOffsetX(0);
    setOffsetY(0);
    setFrameLimit(g.frames);
    setFromGeneration(true);
  }, []);

  // Auto-detect on mount — unless the caller pre-populated frame dimensions
  // (e.g. from FrameSizeResizer), in which case trust those and skip detect.
  useEffect(() => {
    if (initialFrameWidth && initialFrameHeight) {
      setFrameWidth(initialFrameWidth);
      setFrameHeight(initialFrameHeight);
      setFrameLimit(null);
      setFromGeneration(false);
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
      // Generated animations: slice at the size the sheet was generated with
      // (result card) or the guessed size (gallery). Skips KNOWN_LAYOUTS and
      // gutter detection, which guess wrong for these sheets.
      if (isAnimateSheet) {
        const size = hintedFrameSize ?? galleryFrameSizeGuess(imageWidth, imageHeight);
        const g = size
          ? sheetGeometry({
              imageW: imageWidth,
              imageH: imageHeight,
              frameSize: size,
              frameCount: hintedFrameSize !== undefined ? currentSheetMetadata?.frameCount : undefined,
            })
          : null;
        if (g) {
          applyGeometry(g);
          setOtherSizeChosen(false);
          return;
        }
      }

      setFrameLimit(null);
      setFromGeneration(false);
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
  }, [imageUrl, isAnimateSheet, hintedFrameSize, currentSheetMetadata, applyGeometry, imageWidth, imageHeight]);

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
          if (frameNum >= totalFrames) break;
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
  }, [imageUrl, imageWidth, imageHeight, frameWidth, frameHeight, columns, rows, totalFrames, padding, offsetX, offsetY, previewScale]);

  const handleSlice = () => {
    onSlice({
      frameWidth,
      frameHeight,
      columns,
      rows,
      padding,
      offsetX,
      offsetY,
      ...(frameLimit !== null ? { maxFrames: totalFrames } : {}),
    });
  };

  /** Gallery frame-size row: geometry for a one-tap size, or null when the
   *  image does not split evenly at it. */
  const galleryGeometry = useCallback(
    (size: number) => sheetGeometry({ imageW: imageWidth, imageH: imageHeight, frameSize: size }),
    [imageWidth, imageHeight]
  );

  /** Compute how many frames a given preset would produce on the current image. */
  const presetFrameCount = useCallback(
    (presetW: number, presetH: number): number => {
      const cols = Math.max(0, Math.floor((imageWidth - offsetX) / (presetW + padding)));
      const rowsCount = Math.max(0, Math.floor((imageHeight - offsetY) / (presetH + padding)));
      return cols * rowsCount;
    },
    [imageWidth, imageHeight, offsetX, offsetY, padding]
  );

  /** Wrap a setter so manual size edits clear the sanity warning and drop
   *  the generated geometry's frame cap. */
  const setSizeAndClearWarning = useCallback(
    (next: () => void) => {
      next();
      setFrameLimit(null);
      setFromGeneration(false);
      if (sanityWarning) setSanityWarning(null);
    },
    [sanityWarning]
  );

  return (
    <div className="space-y-6">
      {/* Frame size */}
      <div>
        <label className="flex items-center gap-2 text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          <Grid3X3 size={14} />
          Frame Size
        </label>
        {fromGeneration && hintedFrameSize !== undefined && (
          <p className="text-[10px] font-mono text-text-muted -mt-2 mb-3">
            Set from this generation.
          </p>
        )}

        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <label className="block text-[10px] font-mono text-text-muted mb-1">Width</label>
            <input
              type="number"
              min={1}
              max={imageWidth}
              value={frameWidth}
              onChange={(e) => setSizeAndClearWarning(() => setFrameWidth(Math.max(1, Number(e.target.value))))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-mono text-text-muted mb-1">Height</label>
            <input
              type="number"
              min={1}
              max={imageHeight}
              value={frameHeight}
              onChange={(e) => setSizeAndClearWarning(() => setFrameHeight(Math.max(1, Number(e.target.value))))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
        </div>

        {/* Quick-select sizes */}
        <div className="flex flex-wrap gap-1.5">
          {SLICER_FRAME_PRESETS.map((s) => {
            const count = presetFrameCount(s.width, s.height);
            return (
              <button
                key={s.label}
                onClick={() => {
                  setSizeAndClearWarning(() => {
                    setFrameWidth(s.width);
                    setFrameHeight(s.height);
                  });
                }}
                title={`→ ${count} frame${count !== 1 ? 's' : ''} at ${s.label}`}
                className={`px-2 py-1 rounded text-[10px] font-mono transition-colors cursor-pointer
                  ${frameWidth === s.width && frameHeight === s.height
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-border-subtle'
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

      {/* Gallery animations: one-tap frame size. The gallery entry records
          no size, so the guess may be wrong (a 256x256 sheet is 4 frames of
          128 or 16 of 64). Other leaves the fields above to edit by hand. */}
      {showFrameSizeRow && (
        <div>
          <label className="text-xs font-mono text-text-secondary uppercase tracking-wider mb-3 block">
            Animation frame size
          </label>
          <div className="flex flex-wrap gap-1.5">
            {GALLERY_FRAME_SIZES.map((size) => {
              const g = galleryGeometry(size);
              const active = !otherSizeChosen && frameWidth === size && frameHeight === size;
              return (
                <button
                  key={size}
                  onClick={() => {
                    if (!g) return;
                    applyGeometry(g);
                    setOtherSizeChosen(false);
                    setSanityWarning(null);
                  }}
                  disabled={!g}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-colors
                    ${!g
                      ? 'bg-bg-elevated text-text-muted/50 cursor-not-allowed border border-border-subtle/50'
                      : active
                        ? 'bg-accent-amber text-bg-primary cursor-pointer'
                        : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-border-subtle cursor-pointer'
                    }
                  `}
                >
                  {size} px
                </button>
              );
            })}
            <button
              onClick={() => setOtherSizeChosen(true)}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-colors cursor-pointer
                ${otherSizeChosen ||
                  !GALLERY_FRAME_SIZES.some((size) => frameWidth === size && frameHeight === size)
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-border-subtle'
                }
              `}
            >
              Other
            </button>
          </div>
        </div>
      )}

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
