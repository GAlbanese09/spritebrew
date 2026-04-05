'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Grid3X3, Check, AlertCircle, Lock, Unlock } from 'lucide-react';
import { loadImage, resizePixelArt } from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';

/**
 * Frame-size-first sheet resizer for the Upload page.
 *
 * The user picks how big each FRAME should be (e.g. 64x64). We compute the
 * grid from the current image dimensions, warn if it doesn't divide evenly,
 * and offer rounded sheet targets that do. On accept we resize the sheet to
 * `frameW × cols` by `frameH × rows` using nearest-neighbor and pass the
 * chosen frame size back to the parent so the slicer can auto-populate.
 */

const FRAME_PRESETS = [
  { w: 16, h: 16 },
  { w: 24, h: 32 },
  { w: 32, h: 32 },
  { w: 48, h: 48 },
  { w: 64, h: 64 },
  { w: 128, h: 128 },
] as const;

interface FrameSizeResizerProps {
  sourceDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  /**
   * Called when the user accepts a resized sheet.
   * @param dataUrl  - resized sheet PNG data URL
   * @param sheetW   - new sheet width (pixels)
   * @param sheetH   - new sheet height (pixels)
   * @param frameW   - chosen frame width
   * @param frameH   - chosen frame height
   */
  onAccept: (dataUrl: string, sheetW: number, sheetH: number, frameW: number, frameH: number) => void;
  /** Called when the user wants to proceed without resizing. */
  onKeepOriginal?: () => void;
  /** Called when the user wants to upload a different image. */
  onCancel?: () => void;
}

/**
 * Suggest an initial frame size for an image.
 * Preference order:
 *   1. A standard preset where imageW/4 and imageH/4 match a preset (4x4 grid)
 *   2. The largest standard preset that divides both dimensions evenly
 *   3. Fallback: 64x64
 */
function suggestFrameSize(imgW: number, imgH: number): { w: number; h: number } {
  // Try 4x4 grid first — very common for AI-generated sheets
  const quarterW = imgW / 4;
  const quarterH = imgH / 4;
  if (Number.isInteger(quarterW) && Number.isInteger(quarterH)) {
    const match = FRAME_PRESETS.find((p) => p.w === quarterW && p.h === quarterH);
    if (match) return { w: match.w, h: match.h };
  }

  // Largest preset that divides both evenly (prefer more frames, so iterate desc)
  const sorted = [...FRAME_PRESETS].sort((a, b) => b.w - a.w);
  for (const p of sorted) {
    if (imgW % p.w === 0 && imgH % p.h === 0) {
      return { w: p.w, h: p.h };
    }
  }

  return { w: 64, h: 64 };
}

export default function FrameSizeResizer({
  sourceDataUrl,
  sourceWidth,
  sourceHeight,
  onAccept,
  onKeepOriginal,
  onCancel,
}: FrameSizeResizerProps) {
  const suggested = useMemo(
    () => suggestFrameSize(sourceWidth, sourceHeight),
    [sourceWidth, sourceHeight]
  );

  const [frameW, setFrameW] = useState(suggested.w);
  const [frameH, setFrameH] = useState(suggested.h);
  const [lockAspect, setLockAspect] = useState(true);

  // Grid math — raw column/row counts (may not divide evenly)
  const rawCols = sourceWidth / frameW;
  const rawRows = sourceHeight / frameH;
  const dividesEvenly = Number.isInteger(rawCols) && Number.isInteger(rawRows);

  // Floor/ceil sheet targets when it doesn't divide evenly
  const floorCols = Math.max(1, Math.floor(rawCols));
  const floorRows = Math.max(1, Math.floor(rawRows));
  const ceilCols = Math.max(1, Math.ceil(rawCols));
  const ceilRows = Math.max(1, Math.ceil(rawRows));

  const floorSheetW = floorCols * frameW;
  const floorSheetH = floorRows * frameH;
  const ceilSheetW = ceilCols * frameW;
  const ceilSheetH = ceilRows * frameH;

  // Target selection: when divides evenly there's only one; otherwise user picks floor or ceil
  type Target = 'exact' | 'floor' | 'ceil';
  const [target, setTarget] = useState<Target>('exact');

  // If frame size changes and we were on exact but it no longer divides evenly,
  // default to the "floor" (closer, fewer frames lost) option.
  useEffect(() => {
    if (dividesEvenly) {
      setTarget('exact');
    } else if (target === 'exact') {
      // Pick the closest (fewest pixel-size change)
      const floorDelta = Math.abs(sourceWidth - floorSheetW) + Math.abs(sourceHeight - floorSheetH);
      const ceilDelta = Math.abs(sourceWidth - ceilSheetW) + Math.abs(sourceHeight - ceilSheetH);
      setTarget(floorDelta <= ceilDelta ? 'floor' : 'ceil');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameW, frameH, dividesEvenly]);

  // Resolve actual target dimensions
  const finalCols = target === 'ceil' ? ceilCols : target === 'floor' ? floorCols : rawCols;
  const finalRows = target === 'ceil' ? ceilRows : target === 'floor' ? floorRows : rawRows;
  const finalSheetW = finalCols * frameW;
  const finalSheetH = finalRows * frameH;
  const totalFrames = finalCols * finalRows;

  const handlePreset = useCallback((w: number, h: number) => {
    // Explicit preset click overrides aspect lock
    setFrameW(w);
    setFrameH(h);
  }, []);

  const handleFrameWChange = useCallback((val: number) => {
    const clamped = Math.max(1, Math.min(512, val));
    setFrameW(clamped);
    if (lockAspect) {
      // Keep the user's current W:H ratio
      const ratio = frameH / frameW;
      setFrameH(Math.max(1, Math.round(clamped * ratio)));
    }
  }, [lockAspect, frameW, frameH]);

  const handleFrameHChange = useCallback((val: number) => {
    const clamped = Math.max(1, Math.min(512, val));
    setFrameH(clamped);
    if (lockAspect) {
      const ratio = frameW / frameH;
      setFrameW(Math.max(1, Math.round(clamped * ratio)));
    }
  }, [lockAspect, frameW, frameH]);

  const handleResize = useCallback(async () => {
    try {
      const img = await loadImage(sourceDataUrl);
      const dataUrl = resizePixelArt(img, finalSheetW, finalSheetH);
      onAccept(dataUrl, finalSheetW, finalSheetH, frameW, frameH);
    } catch {
      // ignore
    }
  }, [sourceDataUrl, finalSheetW, finalSheetH, frameW, frameH, onAccept]);

  const needsResize = finalSheetW !== sourceWidth || finalSheetH !== sourceHeight;

  return (
    <div className="rounded-lg border border-accent-amber/30 bg-bg-surface p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Grid3X3 size={16} className="text-accent-amber mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-xs font-mono font-semibold text-text-primary uppercase tracking-wider mb-1">
            Resize Sprite Sheet
          </h3>
          <p className="text-[10px] font-mono text-text-muted leading-relaxed">
            Your image is {sourceWidth}x{sourceHeight}. For best results with pixel art,
            sheets should be 128x128 or smaller per frame. Start by choosing how big
            each frame should be — SpriteBrew will calculate the grid and target sheet
            size for you.
          </p>
        </div>
      </div>

      {/* Step 1: Frame size */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          1. What size should each frame be?
        </label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {FRAME_PRESETS.map((p) => {
            const active = frameW === p.w && frameH === p.h;
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
                {active && <Check size={10} />}
              </button>
            );
          })}
        </div>

        {/* Custom W/H inputs */}
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[9px] font-mono text-text-muted mb-1">Custom W</label>
            <input
              type="number"
              min={1}
              max={512}
              value={frameW}
              onChange={(e) => handleFrameWChange(Number(e.target.value))}
              className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <button
            onClick={() => setLockAspect((v) => !v)}
            title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
            className={`mb-1 p-1.5 rounded border cursor-pointer transition-colors
              ${lockAspect
                ? 'border-accent-amber/40 bg-accent-amber-glow text-accent-amber'
                : 'border-border-default bg-bg-elevated text-text-muted hover:text-text-primary'
              }`}
          >
            {lockAspect ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <div>
            <label className="block text-[9px] font-mono text-text-muted mb-1">Custom H</label>
            <input
              type="number"
              min={1}
              max={512}
              value={frameH}
              onChange={(e) => handleFrameHChange(Number(e.target.value))}
              className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <p className="text-[9px] font-mono text-text-muted mb-2">
            {lockAspect ? 'Aspect locked' : 'Free ratio'}
          </p>
        </div>
      </div>

      {/* Step 2: Grid layout status */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          2. Grid layout
        </label>
        {dividesEvenly ? (
          <div className="flex items-start gap-2 rounded bg-green-500/10 border border-green-500/20 px-3 py-2">
            <Check size={14} className="text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-mono text-green-400">
                Your image is {sourceWidth}x{sourceHeight}. At {frameW}x{frameH} per frame,
                that&apos;s a {floorCols}x{floorRows} grid ({floorCols * floorRows} frames).
              </p>
              <p className="text-[10px] font-mono text-green-400/70 mt-0.5">
                Divides evenly — no resize needed.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-amber-400">
                {sourceWidth}x{sourceHeight} doesn&apos;t divide evenly into {frameW}x{frameH} frames.
                Pick a target sheet size below:
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => setTarget('floor')}
                className={`text-left rounded border p-3 cursor-pointer transition-colors
                  ${target === 'floor'
                    ? 'border-accent-amber bg-accent-amber-glow'
                    : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                  }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[11px] font-mono font-semibold text-text-primary">
                    {floorSheetW}x{floorSheetH}
                  </span>
                  {target === 'floor' && <Check size={11} className="text-accent-amber" />}
                </div>
                <p className="text-[10px] font-mono text-text-muted">
                  {floorCols}x{floorRows} grid ({floorCols * floorRows} frames)
                </p>
                <p className="text-[9px] font-mono text-text-muted/70">
                  Scale down (smaller sheet)
                </p>
              </button>
              <button
                onClick={() => setTarget('ceil')}
                className={`text-left rounded border p-3 cursor-pointer transition-colors
                  ${target === 'ceil'
                    ? 'border-accent-amber bg-accent-amber-glow'
                    : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                  }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[11px] font-mono font-semibold text-text-primary">
                    {ceilSheetW}x{ceilSheetH}
                  </span>
                  {target === 'ceil' && <Check size={11} className="text-accent-amber" />}
                </div>
                <p className="text-[10px] font-mono text-text-muted">
                  {ceilCols}x{ceilRows} grid ({ceilCols * ceilRows} frames)
                </p>
                <p className="text-[9px] font-mono text-text-muted/70">
                  Scale up (larger sheet)
                </p>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 3: Summary */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          3. Summary
        </label>
        <div className="rounded border border-border-default bg-bg-elevated p-3 space-y-1">
          <SummaryRow label="Frame size" value={`${frameW}x${frameH}`} />
          <SummaryRow label="Grid" value={`${finalCols} columns x ${finalRows} rows`} />
          <SummaryRow label="Total frames" value={`${totalFrames}`} />
          <SummaryRow
            label="Sheet"
            value={
              needsResize
                ? `${sourceWidth}x${sourceHeight} → ${finalSheetW}x${finalSheetH}`
                : `${finalSheetW}x${finalSheetH} (unchanged)`
            }
            highlight={needsResize}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Upload Different
            </Button>
          )}
          {onKeepOriginal && (
            <Button variant="secondary" size="sm" onClick={onKeepOriginal}>
              Keep Original Size
            </Button>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={handleResize}>
          <Check size={14} />
          {needsResize ? 'Resize' : 'Use as-is'}
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <span
        className={`text-[11px] font-mono ${
          highlight ? 'text-accent-amber font-semibold' : 'text-text-primary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
