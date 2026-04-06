'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Wand2, Check, Loader2, AlertCircle, Info, Pencil } from 'lucide-react';
import {
  loadImage,
  imageToCanvas,
  detectSprites,
  extractSpriteRegion,
  removeBackgroundColor,
  fitToTransparentSquarePadded,
  type DetectedSprite,
} from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';
import PixelEditor from './PixelEditor';

interface CharacterAutoPrepProps {
  sourceDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  targetSize: number;
  onAccept: (preparedDataUrl: string, width: number, height: number) => void;
  onCancel: () => void;
  paddingEnabled: boolean;
  characterSizePct: number;
  onPaddingEnabledChange: (enabled: boolean) => void;
  onCharacterSizePctChange: (pct: number) => void;
}

type Stage = 'processing' | 'ready' | 'error';

export default function CharacterAutoPrep({
  sourceDataUrl,
  sourceWidth,
  sourceHeight,
  targetSize,
  onAccept,
  onCancel,
  paddingEnabled,
  characterSizePct,
  onPaddingEnabledChange,
  onCharacterSizePctChange,
}: CharacterAutoPrepProps) {
  const [stage, setStage] = useState<Stage>('processing');
  const [preparedDataUrl, setPreparedDataUrl] = useState<string | null>(null);
  const [cropBBox, setCropBBox] = useState<DetectedSprite | null>(null);
  const [spriteCount, setSpriteCount] = useState(0);
  const [sourceHasAlpha, setSourceHasAlpha] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(30);
  const [editorOpen, setEditorOpen] = useState(false);

  // Cache: cropped canvas BEFORE bg removal (keyed by sourceDataUrl).
  // Tolerance slider re-runs removal from this cache without re-detecting.
  const croppedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const croppedHasAlphaRef = useRef(false);
  // Cache: post-bg-removal canvas. Padding slider re-fits from this.
  const bgRemovedRef = useRef<HTMLCanvasElement | null>(null);
  const lastSourceRef = useRef<string | null>(null);
  const lastToleranceRef = useRef<number>(30);

  const effectivePct = paddingEnabled ? characterSizePct : 100;

  // ── Full pipeline: runs when source changes ──
  useEffect(() => {
    // Only run the full pipeline when the SOURCE changes
    if (lastSourceRef.current === sourceDataUrl) return;

    let cancelled = false;
    setStage('processing');
    setPreparedDataUrl(null);
    setCropBBox(null);
    setError(null);

    (async () => {
      try {
        const img = await loadImage(sourceDataUrl);
        if (cancelled) return;
        const sourceCanvas = imageToCanvas(img);
        const srcCtx = sourceCanvas.getContext('2d')!;
        const imgData = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

        const { sprites } = detectSprites(imgData);
        if (cancelled) return;
        setSpriteCount(sprites.length);

        let bbox: DetectedSprite;
        if (sprites.length === 0) {
          bbox = { id: 1, x: 0, y: 0, width: sourceCanvas.width, height: sourceCanvas.height };
        } else if (sprites.length === 1) {
          bbox = sprites[0];
        } else {
          bbox = sprites.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
        }
        setCropBBox(bbox);

        const croppedCanvas = extractSpriteRegion(sourceCanvas, bbox);

        // Check alpha
        const cropCtx = croppedCanvas.getContext('2d')!;
        const cropData = cropCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
        let foundAlpha = false;
        for (let i = 3; i < cropData.data.length; i += 4) {
          if (cropData.data[i] < 250) { foundAlpha = true; break; }
        }
        setSourceHasAlpha(foundAlpha);
        croppedCanvasRef.current = croppedCanvas;
        croppedHasAlphaRef.current = foundAlpha;

        // Bg removal
        let bgRemovedCanvas: HTMLCanvasElement;
        if (foundAlpha) {
          bgRemovedCanvas = croppedCanvas;
        } else {
          const { dataUrl } = removeBackgroundColor(croppedCanvas, tolerance);
          const removedImg = await loadImage(dataUrl);
          if (cancelled) return;
          bgRemovedCanvas = imageToCanvas(removedImg);
        }

        bgRemovedRef.current = bgRemovedCanvas;
        lastSourceRef.current = sourceDataUrl;
        lastToleranceRef.current = tolerance;

        const prepared = fitToTransparentSquarePadded(bgRemovedCanvas, targetSize, effectivePct);
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

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDataUrl]);

  // ── Re-run bg removal when tolerance changes (cheap: uses cached cropped canvas) ──
  useEffect(() => {
    if (!croppedCanvasRef.current || lastSourceRef.current !== sourceDataUrl) return;
    if (croppedHasAlphaRef.current) return; // no bg to remove
    if (tolerance === lastToleranceRef.current && bgRemovedRef.current) {
      // Tolerance unchanged — just re-fit with current padding
      const prepared = fitToTransparentSquarePadded(bgRemovedRef.current, targetSize, effectivePct);
      setPreparedDataUrl(prepared);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { dataUrl } = removeBackgroundColor(croppedCanvasRef.current!, tolerance);
        const removedImg = await loadImage(dataUrl);
        if (cancelled) return;
        const bgRemovedCanvas = imageToCanvas(removedImg);
        bgRemovedRef.current = bgRemovedCanvas;
        lastToleranceRef.current = tolerance;

        const prepared = fitToTransparentSquarePadded(bgRemovedCanvas, targetSize, effectivePct);
        if (!cancelled) setPreparedDataUrl(prepared);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [sourceDataUrl, tolerance, targetSize, effectivePct]);

  // ── Re-fit when padding changes (cheapest: uses cached bg-removed canvas) ──
  useEffect(() => {
    if (!bgRemovedRef.current || lastSourceRef.current !== sourceDataUrl) return;
    const prepared = fitToTransparentSquarePadded(bgRemovedRef.current, targetSize, effectivePct);
    setPreparedDataUrl(prepared);
  }, [sourceDataUrl, targetSize, effectivePct]);

  const handleAccept = useCallback(() => {
    if (!preparedDataUrl) return;
    onAccept(preparedDataUrl, targetSize, targetSize);
  }, [preparedDataUrl, targetSize, onAccept]);

  /** Pixel editor saved — replace the prepared image. */
  const handleEditorSave = useCallback(
    (editedDataUrl: string) => {
      setPreparedDataUrl(editedDataUrl);
      setEditorOpen(false);
    },
    []
  );

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
            Detecting your character, cropping, removing the background, and
            resizing to {targetSize}x{targetSize}. Adjust the tolerance or
            use the pixel editor to fix details.
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
                  style={{ imageRendering: 'pixelated', maxWidth: 128, maxHeight: 128 }}
                />
              </div>
            </div>

            <span className="text-text-muted text-lg font-mono">&rarr;</span>

            {/* Prepared */}
            <div className="text-center">
              <p className="text-[9px] font-mono text-accent-amber mb-1.5 uppercase tracking-wider">
                Prepared{cropBBox && ` (${cropBBox.width}x${cropBBox.height})`}
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

          {/* Background removal tolerance slider */}
          {!sourceHasAlpha && (
            <div className="rounded border border-border-default bg-bg-elevated p-3 space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-mono text-text-muted w-20 flex-shrink-0">
                  BG Removal
                </label>
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
              <p className="text-[9px] font-mono text-text-muted">
                Increase if background pixels remain. Decrease if character pixels are being removed.
              </p>
            </div>
          )}

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
              value={sourceHasAlpha ? 'Already transparent' : `Removed (tolerance ${tolerance})`}
            />
            <DetailRow
              label="Character size"
              value={
                paddingEnabled
                  ? `${characterSizePct}% (${Math.round(targetSize * (characterSizePct / 100))}x${Math.round(targetSize * (characterSizePct / 100))} of ${targetSize}x${targetSize})`
                  : `100% (fills ${targetSize}x${targetSize})`
              }
            />
          </div>

          {/* Animation Padding control */}
          <div className="rounded border border-border-default bg-bg-elevated p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer"
                title="Shrinks character to leave room for weapon swings and motion effects">
                <input
                  type="checkbox"
                  checked={paddingEnabled}
                  onChange={(e) => onPaddingEnabledChange(e.target.checked)}
                  className="accent-[var(--accent-amber)] cursor-pointer"
                />
                <span className="text-[11px] font-mono font-semibold text-text-primary">
                  Animation Padding
                </span>
                <Info size={11} className="text-text-muted" />
              </label>
              {paddingEnabled && (
                <span className="text-[10px] font-mono text-accent-amber">{characterSizePct}%</span>
              )}
            </div>
            <p className="text-[9px] font-mono text-text-muted leading-relaxed">
              Shrinks character to leave room for weapon swings and motion effects.
              Recommended for attack, jump, and destroy animations.
            </p>
            {paddingEnabled && (
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-mono text-text-muted w-16">Character Size</span>
                  <input
                    type="range" min={50} max={95} step={5}
                    value={characterSizePct}
                    onChange={(e) => onCharacterSizePctChange(Number(e.target.value))}
                    className="flex-1 accent-[var(--accent-amber)]"
                  />
                  <span className="text-[10px] font-mono text-text-primary w-10 text-right">
                    {characterSizePct}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Upload Different
        </Button>
        <div className="flex items-center gap-2">
          {stage === 'ready' && preparedDataUrl && (
            <Button variant="secondary" size="sm" onClick={() => setEditorOpen(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={handleAccept} disabled={stage !== 'ready'}>
            <Check size={14} />
            Use This
          </Button>
        </div>
      </div>

      {/* Pixel Editor modal */}
      {editorOpen && preparedDataUrl && (
        <PixelEditor
          frameDataUrl={preparedDataUrl}
          frameWidth={targetSize}
          frameHeight={targetSize}
          onSave={handleEditorSave}
          onClose={() => setEditorOpen(false)}
        />
      )}
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
