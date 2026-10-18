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
import {
  DEFAULT_BG_TOLERANCE,
  preparedIsCurrent,
  type AcceptedPrep,
  type PreparedFit,
} from '@/lib/animateCharacter';

/**
 * State hierarchy:
 *
 *   sourceDataUrl (original upload)
 *     → detect + crop → croppedCanvasRef
 *       → bg remove (tolerance) → bgRemovedRef                 stage 1, the base
 *         → fit (target size, padding %) → prepared           stage 2, the fit
 *           → [user pixel edits] → editedBaseDataUrl  ← user's source of truth
 *             → fit (target size, padding %) → prepared        ← displayed + sent
 *
 * Two stages (Oct 18, 2026, audit r1). Stage 1 runs when the source changes
 * and again when the tolerance or the skip toggle changes the base; it never
 * fits. Stage 2 fits the base, or the edited image when there is one, and
 * re-runs whenever the target size, the padding or the base changes, always
 * with the values in force at that moment, never the ones captured when
 * processing began. A fit records what it was made for; Use This and Edit
 * are disabled until the fit on display matches the current size, padding
 * and base. When editedBaseDataUrl is set, size and padding changes re-fit
 * IT, not the pipeline cache. Only a base change clears edits: a new source,
 * a tolerance change (which warns first), or the skip toggle. A size or
 * padding change never does.
 */

interface CharacterAutoPrepProps {
  sourceDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  targetSize: number;
  /** Use This. `prep` says whether the image carries pixel edits and which
   *  background settings were in force, so a later re-prep opens the same
   *  way. */
  onAccept: (preparedDataUrl: string, width: number, height: number, prep: AcceptedPrep) => void;
  onCancel: () => void;
  paddingEnabled: boolean;
  characterSizePct: number;
  onPaddingEnabledChange: (enabled: boolean) => void;
  onCharacterSizePctChange: (pct: number) => void;
  /** When true, AutoPrep skips its bg-removal step and routes the cropped
   *  canvas straight to the fit step. Set by the Send-to-Animator handoff
   *  to honor the user's result-side "Remove background" toggle choice.
   *  Initial value only — user can toggle the checkbox in-modal too. */
  initialSkipBgRemoval?: boolean;
  /** The tolerance to open with; a re-prep passes the one Use This ended
   *  on. Initial value only. */
  initialTolerance?: number;
  /** Set on a re-prep: the accepted character this prep would replace. The
   *  cancel button then reads "Keep WxH", and when that character carries
   *  pixel edits a note says they do not carry over. */
  replacing?: { width: number; height: number; edited: boolean } | null;
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
  initialSkipBgRemoval,
  initialTolerance,
  replacing,
}: CharacterAutoPrepProps) {
  const [stage, setStage] = useState<Stage>('processing');
  // The fitted image on display, with what it was fitted for (stage 2).
  const [prepared, setPrepared] = useState<PreparedFit | null>(null);
  const [cropBBox, setCropBBox] = useState<DetectedSprite | null>(null);
  const [spriteCount, setSpriteCount] = useState(0);
  const [sourceHasAlpha, setSourceHasAlpha] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState(initialTolerance ?? DEFAULT_BG_TOLERANCE);
  const [skipBgRemoval, setSkipBgRemoval] = useState(initialSkipBgRemoval ?? false);
  const [editorOpen, setEditorOpen] = useState(false);

  // The user's manually edited image: the displayed image at save time, so
  // it carries that moment's size and padding. When set, a size or padding
  // change re-fits it instead of the pipeline base. Cleared only when the
  // base changes (a new source, a tolerance change, the skip toggle), never
  // by a size or padding change. The ref is what the fit effect reads, so a
  // save does not re-fit the edited image at the size it was saved at.
  const [editedBaseDataUrl, setEditedBaseDataUrl] = useState<string | null>(null);
  const editedBaseRef = useRef<string | null>(null);
  const setEditedBase = useCallback((url: string | null) => {
    editedBaseRef.current = url;
    setEditedBaseDataUrl(url);
  }, []);

  // Pipeline caches (stage 1)
  const croppedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const croppedHasAlphaRef = useRef(false);
  const bgRemovedRef = useRef<HTMLCanvasElement | null>(null);
  const lastSourceRef = useRef<string | null>(null);
  const lastToleranceRef = useRef<number>(initialTolerance ?? DEFAULT_BG_TOLERANCE);
  const lastSkipRef = useRef<boolean>(initialSkipBgRemoval ?? false);
  // Bumped whenever bgRemovedRef changes. Stage 2 re-runs on it, and a fit
  // carries the version it was made from. 0 means no base yet.
  const [baseVersion, setBaseVersion] = useState(0);

  const effectivePct = paddingEnabled ? characterSizePct : 100;
  const fitCurrent = preparedIsCurrent(prepared, { size: targetSize, pct: effectivePct, baseVersion });
  const preparedDataUrl = prepared?.dataUrl ?? null;
  const shownSize = prepared?.size ?? targetSize;

  // ── Stage 1, the base: detect, crop, remove the background. Runs when
  // the source changes. It never fits: that is stage 2's job, so the fit
  // uses the size and padding in force when the base is ready, not the ones
  // captured when processing began (a size change during processing used to
  // ship an image of the old size under the new label).
  useEffect(() => {
    if (lastSourceRef.current === sourceDataUrl) return;

    let cancelled = false;
    setStage('processing');
    setPrepared(null);
    setCropBBox(null);
    setError(null);
    setEditedBase(null); // new source clears edits

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
        const cropCtx = croppedCanvas.getContext('2d')!;
        const cropData = cropCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
        let foundAlpha = false;
        for (let i = 3; i < cropData.data.length; i += 4) {
          if (cropData.data[i] < 250) { foundAlpha = true; break; }
        }
        setSourceHasAlpha(foundAlpha);
        croppedCanvasRef.current = croppedCanvas;
        croppedHasAlphaRef.current = foundAlpha;

        let bgRemovedCanvas: HTMLCanvasElement;
        if (foundAlpha || skipBgRemoval) {
          // foundAlpha → input already transparent, no removal needed.
          // skipBgRemoval → user opted out (handoff carrier OR in-modal toggle).
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
        lastSkipRef.current = skipBgRemoval;
        setBaseVersion((v) => v + 1);
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

  // ── Stage 1 again: a new tolerance (base ready, opaque source, removal
  // on). The edits were made on the old base, so they go; stage 2 re-fits.
  useEffect(() => {
    if (!croppedCanvasRef.current || lastSourceRef.current !== sourceDataUrl) return;
    if (croppedHasAlphaRef.current) return;
    if (skipBgRemoval) return; // user opted out, the tolerance slider is hidden anyway
    if (tolerance === lastToleranceRef.current) return; // no change

    let cancelled = false;
    (async () => {
      try {
        const { dataUrl } = removeBackgroundColor(croppedCanvasRef.current!, tolerance);
        const removedImg = await loadImage(dataUrl);
        if (cancelled) return;
        bgRemovedRef.current = imageToCanvas(removedImg);
        lastToleranceRef.current = tolerance;
        setEditedBase(null);
        setBaseVersion((v) => v + 1);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [sourceDataUrl, tolerance, skipBgRemoval, setEditedBase]);

  // ── Stage 1 again: the skip-background toggle (base ready, opaque
  // source). The edits were made on the old base, so they go; stage 2
  // re-fits. Only an actual toggle gets past the lastSkipRef check: this
  // effect used to list the size and the padding as dependencies, so either
  // of those changes re-ran it and silently cleared the edits (BUILD, Oct 18).
  useEffect(() => {
    if (!croppedCanvasRef.current || lastSourceRef.current !== sourceDataUrl) return;
    if (croppedHasAlphaRef.current) return; // input already transparent, toggle has no effect
    if (skipBgRemoval === lastSkipRef.current) return; // no change

    let cancelled = false;
    (async () => {
      try {
        let bgRemovedCanvas: HTMLCanvasElement;
        if (skipBgRemoval) {
          bgRemovedCanvas = croppedCanvasRef.current!;
        } else {
          const { dataUrl } = removeBackgroundColor(croppedCanvasRef.current!, tolerance);
          const removedImg = await loadImage(dataUrl);
          if (cancelled) return;
          bgRemovedCanvas = imageToCanvas(removedImg);
          lastToleranceRef.current = tolerance;
        }
        bgRemovedRef.current = bgRemovedCanvas;
        lastSkipRef.current = skipBgRemoval;
        setEditedBase(null);
        setBaseVersion((v) => v + 1);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
    // tolerance is intentionally NOT in deps: that's the other effect's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipBgRemoval, sourceDataUrl]);

  // ── Stage 2, the fit: the base, or the edited image when there is one, at
  // the current target size and padding. Re-runs when any of those change
  // and whenever the base changes, always with the values in force now. The
  // latest run cancels the earlier one, so two quick changes cannot land out
  // of order. The edited image is read from its ref, not a dependency: a
  // save sets the display itself (handleEditorSave) and must not be fitted
  // again at the size and padding it was saved at. A fit that fails shows
  // the error stage, as a failed pipeline does, instead of throwing out of
  // the effect or leaving Use This waiting on a fit that never comes (audit
  // r2).
  useEffect(() => {
    if (baseVersion === 0) return;
    const size = targetSize;
    const pct = effectivePct;
    const editedBase = editedBaseRef.current;
    const fail = (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Preparation failed');
      setStage('error');
    };
    if (!editedBase) {
      const base = bgRemovedRef.current;
      if (!base) return;
      try {
        setPrepared({ dataUrl: fitToTransparentSquarePadded(base, size, pct), size, pct, baseVersion });
      } catch (err) {
        fail(err);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(editedBase);
        if (cancelled) return;
        setPrepared({ dataUrl: fitToTransparentSquarePadded(img, size, pct), size, pct, baseVersion });
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();
    return () => { cancelled = true; };
  }, [baseVersion, targetSize, effectivePct]);

  // Use This takes the fit on display, and only while it is the current
  // one, so what the parent records as the size is the size of the image.
  const handleAccept = useCallback(() => {
    if (!fitCurrent) return;
    onAccept(prepared.dataUrl, prepared.size, prepared.size, {
      edited: editedBaseDataUrl !== null,
      skipBgRemoval,
      tolerance,
    });
  }, [fitCurrent, prepared, onAccept, editedBaseDataUrl, skipBgRemoval, tolerance]);

  /** Pixel editor saved: the edited image becomes the user's base and the
   *  display, at the size and padding of the image it was made from. */
  const handleEditorSave = useCallback(
    (editedDataUrl: string) => {
      setEditedBase(editedDataUrl);
      setPrepared((p) => ({
        dataUrl: editedDataUrl,
        size: p?.size ?? targetSize,
        pct: p?.pct ?? effectivePct,
        baseVersion,
      }));
      setEditorOpen(false);
    },
    [setEditedBase, targetSize, effectivePct, baseVersion]
  );

  /** Tolerance slider change with edit protection. */
  const handleToleranceChange = useCallback(
    (newTolerance: number) => {
      if (editedBaseDataUrl) {
        // Warn the user that changing tolerance resets their edits
        const ok = confirm(
          'Changing background removal will reset your manual edits. Continue?'
        );
        if (!ok) return;
      }
      setTolerance(newTolerance);
    },
    [editedBaseDataUrl]
  );

  const previewScale = Math.max(1, Math.floor(256 / shownSize));

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
                  className="block pixel-art-render"
                  style={{ maxWidth: 128, maxHeight: 128 }}
                />
              </div>
            </div>

            <span className="text-text-muted text-lg font-mono">&rarr;</span>

            {/* Prepared */}
            <div className="text-center">
              <p className="text-[9px] font-mono text-accent-amber mb-1.5 uppercase tracking-wider">
                {editedBaseDataUrl ? 'Edited' : 'Prepared'}
                {/* The size of the image on display, which is the target
                    size except for the moment a fit is pending. */}
                {cropBBox && !editedBaseDataUrl && ` (${shownSize}x${shownSize})`}
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
                    className="block pixel-art-render"
                    style={{
                      width: shownSize * previewScale,
                      height: shownSize * previewScale,
                    }}
                  />
                )}
              </div>
              {fitCurrent ? (
                <p className="text-[9px] font-mono text-green-400 mt-1.5">
                  Ready for animation ({prepared.size}x{prepared.size})
                </p>
              ) : (
                <p className="text-[9px] font-mono text-accent-amber mt-1.5">
                  Preparing character...
                </p>
              )}
            </div>
          </div>

          {/* Background removal: skip checkbox + tolerance slider */}
          {!sourceHasAlpha && (
            <div className="rounded border border-border-default bg-bg-elevated p-3 space-y-3">
              <label
                className="flex items-center gap-2 cursor-pointer"
                title="Keep the original background instead of removing it. Useful when the character shares colors with the background (e.g. white beard on white background)."
              >
                <input
                  type="checkbox"
                  checked={skipBgRemoval}
                  onChange={(e) => setSkipBgRemoval(e.target.checked)}
                  className="accent-[var(--accent-amber)] cursor-pointer"
                />
                <span className="text-[11px] font-mono font-semibold text-text-primary">
                  Skip background removal (keep original background)
                </span>
                <Info size={11} className="text-text-muted" />
              </label>
              {!skipBgRemoval && (
                <>
                  <div className="flex items-center gap-3">
                    <label className="text-[10px] font-mono text-text-muted w-20 flex-shrink-0">
                      BG Removal
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={tolerance}
                      onChange={(e) => handleToleranceChange(Number(e.target.value))}
                      className="flex-1 accent-[var(--accent-amber)]"
                    />
                    <span className="text-[10px] font-mono text-text-primary w-8 text-right">
                      {tolerance}
                    </span>
                  </div>
                  <p className="text-[9px] font-mono text-text-muted">
                    Increase if background pixels remain. Decrease if character pixels are being removed.
                    {editedBaseDataUrl && (
                      <span className="text-amber-400 ml-1">(changing will reset manual edits)</span>
                    )}
                  </p>
                </>
              )}
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
              value={
                sourceHasAlpha
                  ? 'Already transparent'
                  : skipBgRemoval
                    ? 'Kept (no removal)'
                    : `Removed (tolerance ${tolerance})`
              }
            />
            {editedBaseDataUrl && (
              <DetailRow label="Manual edits" value="Applied" />
            )}
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

      {/* On a re-prep of a character with pixel edits: those edits were made
          at the old size and are not in this prep. Said before the buttons,
          since Use This is the click that replaces that character. */}
      {replacing?.edited && (
        <p className="text-[10px] font-mono text-amber-400">
          Your pixel edits are on the {replacing.width}x{replacing.height} version and do not carry over. Use This replaces it.
        </p>
      )}

      {/* Actions. On a re-prep the cancel keeps the accepted character. */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {replacing ? `Keep ${replacing.width}x${replacing.height}` : 'Upload Different'}
        </Button>
        <div className="flex items-center gap-2">
          {stage === 'ready' && preparedDataUrl && (
            <Button variant="secondary" size="sm" onClick={() => setEditorOpen(true)} disabled={!fitCurrent}>
              <Pencil size={14} />
              Edit
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={handleAccept} disabled={stage !== 'ready' || !fitCurrent}>
            <Check size={14} />
            Use This
          </Button>
        </div>
      </div>

      {/* Pixel Editor modal */}
      {editorOpen && prepared && (
        <PixelEditor
          frameDataUrl={prepared.dataUrl}
          frameWidth={prepared.size}
          frameHeight={prepared.size}
          onSave={handleEditorSave}
          onClose={() => setEditorOpen(false)}
          source={{ kind: 'upload' }}
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
