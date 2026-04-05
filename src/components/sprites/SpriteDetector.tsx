'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Scan, X, Merge, Scissors, Loader2, AlertCircle } from 'lucide-react';
import {
  loadImage,
  imageToCanvas,
  detectSprites,
  extractSpriteRegion,
  frameToDataURL,
  type DetectedSprite,
} from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';

/**
 * Auto-detect sprites mode for the Upload page.
 *
 * Loads the uploaded image, runs contour/blob detection on its pixel data,
 * and lets the user select / deselect / merge detected bounding boxes before
 * extracting them as individual frames.
 */

export interface ExtractedSpriteFrame {
  /** Stable id used as the key in frameDataUrls */
  id: string;
  dataUrl: string;
  /** Bounding box in the source image */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteDetectorExtractResult {
  frames: ExtractedSpriteFrame[];
  /** Uniform frame dimensions (largest bounding box), used as the sheet's frame size */
  frameWidth: number;
  frameHeight: number;
}

interface SpriteDetectorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** Called when the user clicks Extract Selected. */
  onExtract: (result: SpriteDetectorExtractResult) => void;
}

export default function SpriteDetector({
  imageUrl,
  imageWidth,
  imageHeight,
  onExtract,
}: SpriteDetectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedSprite[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [padToUniform, setPadToUniform] = useState(true);
  const [extracting, setExtracting] = useState(false);

  // Canvas display scale — cap the preview to 600px wide
  const displayScale = useMemo(() => {
    const maxW = 600;
    return Math.min(maxW / imageWidth, 1);
  }, [imageWidth]);

  const displayW = Math.floor(imageWidth * displayScale);
  const displayH = Math.floor(imageHeight * displayScale);

  // Run detection whenever the image changes
  const runDetection = useCallback(async () => {
    setDetecting(true);
    setError(null);
    try {
      const img = await loadImage(imageUrl);
      const canvas = imageToCanvas(img);
      sourceCanvasRef.current = canvas;
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Yield to the browser so the "Detecting..." indicator can paint before
      // we start the heavy pixel crunching. (requestAnimationFrame + 1 tick)
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

      const result = detectSprites(imgData);

      if (result.sprites.length === 0) {
        setError(
          'No sprites detected. Auto-detect works best with transparent or solid-color backgrounds.'
        );
      } else if (result.sprites.length === 1) {
        setError(
          'Only one region detected. If this is a single character, try the "Animate My Character" feature on the Generate page instead.'
        );
      }

      setDetected(result.sprites);
      // Select all by default
      setSelected(new Set(result.sprites.map((s) => s.id)));
    } catch {
      setError('Detection failed. The image may be too large or in an unsupported format.');
    } finally {
      setDetecting(false);
    }
  }, [imageUrl]);

  useEffect(() => {
    runDetection();
  }, [runDetection]);

  // Draw the detection overlay on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = displayW;
    canvas.height = displayH;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Checkerboard background
    const tile = 8;
    for (let y = 0; y < displayH; y += tile) {
      for (let x = 0; x < displayW; x += tile) {
        const light = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0;
        ctx.fillStyle = light ? '#2a2725' : '#1e1b18';
        ctx.fillRect(x, y, tile, tile);
      }
    }

    // Draw the sprite image
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, displayW, displayH);

      // Draw bounding boxes
      for (const sprite of detected) {
        const isSelected = selected.has(sprite.id);
        const x = sprite.x * displayScale;
        const y = sprite.y * displayScale;
        const w = sprite.width * displayScale;
        const h = sprite.height * displayScale;

        // Semi-transparent fill for selected
        if (isSelected) {
          ctx.fillStyle = 'rgba(212, 135, 28, 0.12)';
          ctx.fillRect(x, y, w, h);
        }

        // Border
        ctx.strokeStyle = isSelected
          ? 'rgba(212, 135, 28, 0.9)'
          : 'rgba(150, 140, 120, 0.5)';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);

        // ID label
        const label = String(sprite.id);
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        const textW = ctx.measureText(label).width;
        const padX = 3;
        const padY = 2;
        const labelH = 14;
        ctx.fillStyle = isSelected
          ? 'rgba(212, 135, 28, 0.9)'
          : 'rgba(60, 55, 50, 0.85)';
        ctx.fillRect(x, y, textW + padX * 2, labelH);
        ctx.fillStyle = isSelected ? '#121010' : '#a89880';
        ctx.fillText(label, x + padX, y + labelH - padY);
      }
    };
    img.src = imageUrl;
  }, [imageUrl, detected, selected, displayW, displayH, displayScale]);

  // Click-to-select: convert mouse coords to source space and hit-test
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / displayScale;
      const my = (e.clientY - rect.top) / displayScale;

      // Find the topmost sprite under the cursor (reverse iterate so later
      // drawn sprites take priority on overlap)
      for (let i = detected.length - 1; i >= 0; i--) {
        const s = detected[i];
        if (mx >= s.x && mx < s.x + s.width && my >= s.y && my < s.y + s.height) {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(s.id)) next.delete(s.id);
            else next.add(s.id);
            return next;
          });
          return;
        }
      }
    },
    [detected, displayScale]
  );

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(detected.map((s) => s.id)));
  }, [detected]);

  const handleDeselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  /** Merge all currently selected sprites into a single bounding box. */
  const handleMergeSelected = useCallback(() => {
    if (selected.size < 2) return;
    const selectedSprites = detected.filter((s) => selected.has(s.id));
    const minX = Math.min(...selectedSprites.map((s) => s.x));
    const minY = Math.min(...selectedSprites.map((s) => s.y));
    const maxX = Math.max(...selectedSprites.map((s) => s.x + s.width));
    const maxY = Math.max(...selectedSprites.map((s) => s.y + s.height));

    const mergedSprite: DetectedSprite = {
      id: Math.max(...detected.map((s) => s.id)) + 1,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    // Replace the selected sprites with the merged one, renumber
    const remaining = detected.filter((s) => !selected.has(s.id));
    const combined = [...remaining, mergedSprite];
    // Re-sort by existing order (just put the merged where its top-left fits in reading order)
    combined.sort((a, b) => {
      const ay = a.y + a.height / 2;
      const by = b.y + b.height / 2;
      if (Math.abs(ay - by) > 8) return ay - by;
      return a.x - b.x;
    });
    // Renumber sequentially
    const renumbered = combined.map((s, i) => ({ ...s, id: i + 1 }));
    setDetected(renumbered);
    // Select the merged one (it will be the last one added before re-sort)
    const mergedIdx = renumbered.findIndex(
      (s) =>
        s.x === mergedSprite.x &&
        s.y === mergedSprite.y &&
        s.width === mergedSprite.width &&
        s.height === mergedSprite.height
    );
    setSelected(mergedIdx >= 0 ? new Set([renumbered[mergedIdx].id]) : new Set());
  }, [detected, selected]);

  /** Crop every selected sprite and emit frames to the parent. */
  const handleExtract = useCallback(async () => {
    if (selected.size === 0 || !sourceCanvasRef.current) return;
    setExtracting(true);
    try {
      const selectedSprites = detected.filter((s) => selected.has(s.id));

      // Determine uniform frame size if padding is enabled
      let frameW: number;
      let frameH: number;
      if (padToUniform) {
        frameW = Math.max(...selectedSprites.map((s) => s.width));
        frameH = Math.max(...selectedSprites.map((s) => s.height));
      } else {
        // Without padding, each frame has its native size. The slicer pipeline
        // expects uniform frames, so fall back to the max for the SpriteSheet
        // metadata — but crop each frame at its native size.
        frameW = Math.max(...selectedSprites.map((s) => s.width));
        frameH = Math.max(...selectedSprites.map((s) => s.height));
      }

      const frames: ExtractedSpriteFrame[] = selectedSprites.map((sprite, i) => {
        const canvas = padToUniform
          ? extractSpriteRegion(sourceCanvasRef.current!, sprite, frameW, frameH)
          : extractSpriteRegion(sourceCanvasRef.current!, sprite);
        return {
          id: `sprite-${Date.now()}-${i}`,
          dataUrl: frameToDataURL(canvas),
          x: sprite.x,
          y: sprite.y,
          width: sprite.width,
          height: sprite.height,
        };
      });

      onExtract({ frames, frameWidth: frameW, frameHeight: frameH });
    } finally {
      setExtracting(false);
    }
  }, [detected, selected, padToUniform, onExtract]);

  const selectedSprites = useMemo(
    () => detected.filter((s) => selected.has(s.id)),
    [detected, selected]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-mono font-semibold text-text-primary uppercase tracking-wider mb-1 flex items-center gap-2">
            <Scan size={14} className="text-accent-amber" />
            Auto-detect Sprites
          </h3>
          <p className="text-[10px] font-mono text-text-muted leading-relaxed max-w-lg">
            Finds individual sprites using contour detection. Works best with
            transparent or solid-color backgrounds. Click any sprite to toggle
            selection, merge split characters, then extract the rest.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={runDetection} disabled={detecting}>
          <Scan size={14} />
          {detecting ? 'Detecting...' : 'Re-detect'}
        </Button>
      </div>

      {/* Detection status */}
      {detecting && (
        <div className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-4 py-3">
          <Loader2 size={14} className="text-accent-amber animate-spin" />
          <p className="text-xs font-mono text-accent-amber">Detecting sprites...</p>
        </div>
      )}

      {!detecting && error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-amber-400">{error}</p>
        </div>
      )}

      {/* Canvas overlay */}
      {!detecting && detected.length > 0 && (
        <>
          <div className="rounded-lg border border-border-default bg-bg-elevated p-3 flex justify-center overflow-auto">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="block cursor-pointer"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Sprite list summary */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono text-text-muted">
              <span className="text-text-primary font-semibold">{detected.length}</span> sprite{detected.length !== 1 ? 's' : ''} detected,{' '}
              <span className="text-accent-amber font-semibold">{selected.size}</span> selected
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleSelectAll}
                className="text-[10px] font-mono text-text-muted hover:text-text-primary cursor-pointer"
              >
                Select all
              </button>
              <span className="text-text-muted/50">·</span>
              <button
                onClick={handleDeselectAll}
                className="text-[10px] font-mono text-text-muted hover:text-text-primary cursor-pointer"
              >
                Deselect all
              </button>
            </div>
          </div>

          {/* Selected sprites detail strip */}
          {selectedSprites.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedSprites.slice(0, 20).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-1.5 rounded bg-accent-amber-glow border border-accent-amber/30 px-2 py-0.5"
                  title={`Sprite ${s.id}: ${s.width}x${s.height} at (${s.x}, ${s.y})`}
                >
                  <span className="text-[9px] font-mono text-accent-amber font-semibold">
                    #{s.id}
                  </span>
                  <span className="text-[9px] font-mono text-text-muted">
                    {s.width}x{s.height}
                  </span>
                  <button
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        next.delete(s.id);
                        return next;
                      })
                    }
                    className="text-text-muted hover:text-accent-amber cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              {selectedSprites.length > 20 && (
                <span className="text-[9px] font-mono text-text-muted self-center">
                  +{selectedSprites.length - 20} more
                </span>
              )}
            </div>
          )}

          {/* Options */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[10px] font-mono text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={padToUniform}
                onChange={(e) => setPadToUniform(e.target.checked)}
                className="accent-[var(--accent-amber)] cursor-pointer"
              />
              Pad all frames to uniform size (required for sprite sheet export)
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-border-subtle">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMergeSelected}
              disabled={selected.size < 2}
              title="Combine 2+ selected sprites into one"
            >
              <Merge size={14} />
              Merge Selected
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleExtract}
              disabled={selected.size === 0 || extracting}
            >
              {extracting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Scissors size={14} />
                  Extract Selected ({selected.size})
                </>
              )}
            </Button>
          </div>
        </>
      )}

    </div>
  );
}
