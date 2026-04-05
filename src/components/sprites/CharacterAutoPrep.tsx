'use client';

import { useEffect, useState, useCallback } from 'react';
import { Wand2, Check, Loader2, AlertCircle } from 'lucide-react';
import {
  loadImage,
  imageToCanvas,
  detectSprites,
  extractSpriteRegion,
  removeBackgroundColor,
  fitToTransparentSquare,
  type DetectedSprite,
} from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';

/**
 * Auto-prep pipeline for the Animate My Character tab:
 *
 *   1. Detect the character via contour/blob detection (`detectSprites`)
 *   2. Auto-crop to the largest detected sprite's bounding box
 *   3. Remove the background (solid-color matching) and leave alpha=0
 *   4. Scale-to-fit the result inside a `targetSize × targetSize` canvas,
 *      centered, with transparent padding around shorter sides
 *   5. Emit the prepared PNG data URL via `onAccept`
 *
 * The prepared image is RGBA with a transparent background. The API route
 * composites it onto a solid background color at call time (Retro Diffusion
 * requires RGB), so the transparent version is what we hand off here.
 */

interface CharacterAutoPrepProps {
  sourceDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Target square size for the final prepared image (e.g. 64). */
  targetSize: number;
  /** Called when the user confirms the prepared result. */
  onAccept: (preparedDataUrl: string, width: number, height: number) => void;
  /** Called when the user wants to upload a different image. */
  onCancel: () => void;
}

type Stage = 'processing' | 'ready' | 'error';

export default function CharacterAutoPrep({
  sourceDataUrl,
  sourceWidth,
  sourceHeight,
  targetSize,
  onAccept,
  onCancel,
}: CharacterAutoPrepProps) {
  const [stage, setStage] = useState<Stage>('processing');
  const [preparedDataUrl, setPreparedDataUrl] = useState<string | null>(null);
  const [cropBBox, setCropBBox] = useState<DetectedSprite | null>(null);
  const [spriteCount, setSpriteCount] = useState(0);
  const [sourceHasAlpha, setSourceHasAlpha] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Run the pipeline whenever the source changes
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setStage('processing');
      setPreparedDataUrl(null);
      setCropBBox(null);
      setError(null);

      try {
        // 1. Load + rasterise the source
        const img = await loadImage(sourceDataUrl);
        if (cancelled) return;
        const sourceCanvas = imageToCanvas(img);
        const srcCtx = sourceCanvas.getContext('2d')!;
        const imgData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

        // Yield so the loading indicator paints before heavy work
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

        // 2. Detect the character(s)
        const { sprites } = detectSprites(imgData);
        if (cancelled) return;
        setSpriteCount(sprites.length);

        // 3. Pick the bounding box to crop to
        let bbox: DetectedSprite;
        if (sprites.length === 0) {
          // Detection failed — fall back to the full image
          bbox = {
            id: 1,
            x: 0,
            y: 0,
            width: sourceCanvas.width,
            height: sourceCanvas.height,
          };
        } else if (sprites.length === 1) {
          bbox = sprites[0];
        } else {
          // Multiple detected — use the largest by area
          bbox = sprites.reduce((a, b) =>
            a.width * a.height >= b.width * b.height ? a : b
          );
        }
        setCropBBox(bbox);

        // 4. Crop to the bbox
        const croppedCanvas = extractSpriteRegion(sourceCanvas, bbox);

        // 5. Background removal — only if the source didn't already have alpha
        const cropCtx = croppedCanvas.getContext('2d')!;
        const cropData = cropCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
        let foundAlpha = false;
        for (let i = 3; i < cropData.data.length; i += 4) {
          if (cropData.data[i] < 250) {
            foundAlpha = true;
            break;
          }
        }
        setSourceHasAlpha(foundAlpha);

        let bgRemovedCanvas: HTMLCanvasElement;
        if (foundAlpha) {
          // Already transparent — skip removal
          bgRemovedCanvas = croppedCanvas;
        } else {
          const { dataUrl } = removeBackgroundColor(croppedCanvas, 15);
          const removedImg = await loadImage(dataUrl);
          if (cancelled) return;
          bgRemovedCanvas = imageToCanvas(removedImg);
        }

        // 6. Fit to targetSize × targetSize with transparent padding
        const prepared = fitToTransparentSquare(bgRemovedCanvas, targetSize);

        if (cancelled) return;
        setPreparedDataUrl(prepared);
        setStage('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Preparation failed');
          setStage('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceDataUrl, targetSize]);

  const handleAccept = useCallback(() => {
    if (!preparedDataUrl) return;
    onAccept(preparedDataUrl, targetSize, targetSize);
  }, [preparedDataUrl, targetSize, onAccept]);

  // Upscale the target preview so the user can see individual pixels
  const previewScale = Math.max(1, Math.floor(256 / targetSize));

  return (
    <div className="rounded-lg border border-accent-amber/30 bg-bg-surface p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Wand2 size={16} className="text-accent-amber mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-xs font-mono font-semibold text-text-primary uppercase tracking-wider mb-1">
            Auto-prep Character
          </h3>
          <p className="text-[10px] font-mono text-text-muted leading-relaxed">
            Detecting your character, cropping to its bounds, removing the
            background, and resizing to {targetSize}x{targetSize} for animation.
            You can approve or upload a different image.
          </p>
        </div>
      </div>

      {/* Processing spinner */}
      {stage === 'processing' && (
        <div className="flex items-center gap-2 rounded border border-border-default bg-bg-elevated px-4 py-8 justify-center">
          <Loader2 size={14} className="text-accent-amber animate-spin" />
          <p className="text-xs font-mono text-accent-amber">Preparing character...</p>
        </div>
      )}

      {/* Error */}
      {stage === 'error' && error && (
        <div className="flex items-start gap-2 rounded bg-red-500/10 border border-red-500/20 px-3 py-2">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-red-400">{error}</p>
        </div>
      )}

      {/* Ready — before/after preview */}
      {stage === 'ready' && (
        <>
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

            {/* Detected / cropped with transparency */}
            <div className="text-center">
              <p className="text-[9px] font-mono text-accent-amber mb-1.5 uppercase tracking-wider">
                Detected{cropBBox && ` (${cropBBox.width}x${cropBBox.height})`}
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
                {preparedDataUrl && (
                  <img
                    src={preparedDataUrl}
                    alt="Prepared character"
                    className="block"
                    style={{
                      imageRendering: 'pixelated',
                      width: targetSize * previewScale,
                      height: targetSize * previewScale,
                    }}
                  />
                )}
              </div>
              <p className="text-[9px] font-mono text-green-400 mt-1.5">
                Ready for animation ({targetSize}x{targetSize})
              </p>
            </div>
          </div>

          {/* Detection details */}
          <div className="rounded border border-border-default bg-bg-elevated p-3 space-y-1">
            <DetailRow
              label="Detected sprites"
              value={spriteCount === 0 ? 'None (used full image)' : `${spriteCount}`}
            />
            {cropBBox && (
              <DetailRow
                label="Cropped to"
                value={`${cropBBox.width}x${cropBBox.height} at (${cropBBox.x}, ${cropBBox.y})`}
              />
            )}
            <DetailRow
              label="Background"
              value={sourceHasAlpha ? 'Already transparent' : 'Removed (corner-sampled, ±15)'}
            />
            <DetailRow label="Final size" value={`${targetSize}x${targetSize} (transparent padding)`} />
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Upload Different
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleAccept}
          disabled={stage !== 'ready'}
        >
          <Check size={14} />
          Use This
        </Button>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider flex-shrink-0">
        {label}
      </span>
      <span className="text-[11px] font-mono text-text-primary text-right">{value}</span>
    </div>
  );
}
