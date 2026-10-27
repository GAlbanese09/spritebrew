'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Grid3X3, Check, Scan, AlertCircle } from 'lucide-react';
import { loadImage, imageToCanvas, resizePixelArt } from '@/lib/spriteUtils';
import { SLICER_FRAME_PRESETS } from '@/lib/constants';
import { defaultTargetFrame, detectGridSmart, type DetectionConfidence } from '@/lib/resizerGrid';
import { useCanvasFitScale } from '@/lib/useCanvasFitScale';
import Button from '@/components/ui/Button';

/**
 * Grid-first sprite sheet resizer.
 *
 * Flow:
 *   1. User picks (or auto-detects) the grid layout — columns × rows.
 *   2. We compute the CURRENT per-frame dimensions from image size ÷ grid.
 *   3. User picks a target frame size. We resize the entire sheet to
 *      `targetFrameW × cols` by `targetFrameH × rows` using nearest-neighbor
 *      and pass the chosen frame dimensions back to the parent so the slicer
 *      auto-populates its grid.
 */

const GRID_PRESETS = [
  { cols: 1, rows: 1 },
  { cols: 2, rows: 2 },
  { cols: 3, rows: 3 },
  { cols: 3, rows: 4 },
  { cols: 4, rows: 4 },
  { cols: 4, rows: 8 },
  { cols: 8, rows: 8 },
] as const;

// Ascending square presets for the resizer's target-size pills.
const FRAME_SIZE_PRESETS: ReadonlyArray<{ w: number; h: number }> = SLICER_FRAME_PRESETS
  .filter((p) => p.width === p.height)
  .map((p) => ({ w: p.width, h: p.height }));

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
  /**
   * Called when the user wants to proceed without resizing.
   * Passes the current grid info so the slicer can pre-populate.
   */
  onKeepOriginal?: (frameW: number, frameH: number) => void;
  /** Called when the user wants to upload a different image. */
  onCancel?: () => void;
}

export default function FrameSizeResizer({
  sourceDataUrl,
  sourceWidth,
  sourceHeight,
  onAccept,
  onKeepOriginal,
  onCancel,
}: FrameSizeResizerProps) {
  const [cols, setCols] = useState(1);
  const [rows, setRows] = useState(1);
  const [detecting, setDetecting] = useState(false);
  const [detectionRan, setDetectionRan] = useState(false);
  const [detectionConfidence, setDetectionConfidence] = useState<DetectionConfidence | null>(null);
  // The other grid the detector found plausible (upload-2 item 1), one click
  // away beside "Best guess", and the detector's own answer: the label and
  // the button follow from the grid on screen. A manual change clears both.
  const [alternative, setAlternative] = useState<{ cols: number; rows: number } | null>(null);
  const [detected, setDetected] = useState<{ cols: number; rows: number } | null>(null);

  const [targetFrameW, setTargetFrameW] = useState(64);
  const [targetFrameH, setTargetFrameH] = useState(64);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Wave M2: measure the canvas wrapper's actual width so mobile-portrait
  // doesn't paint a 400px canvas that then overflows its centered flex
  // wrapper. Legacy maxWidth: 400 preserves desktop pixel-identical output.
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const previewScale = useCanvasFitScale(sourceWidth, previewWrapperRef, { maxWidth: 400 });

  // ── Current frame size (given the selected grid) ──
  const currentFrameW = Math.floor(sourceWidth / cols);
  const currentFrameH = Math.floor(sourceHeight / rows);

  // Check for "clean" grid — image divides evenly
  const gridDividesEvenly =
    sourceWidth % cols === 0 && sourceHeight % rows === 0;

  // Is the current frame already a standard size?
  const matchingPreset = useMemo(
    () => FRAME_SIZE_PRESETS.find((p) => p.w === currentFrameW && p.h === currentFrameH),
    [currentFrameW, currentFrameH]
  );
  const alreadyStandardSize = matchingPreset != null && gridDividesEvenly;

  // ── Target sheet dimensions after resize ──
  const targetSheetW = targetFrameW * cols;
  const targetSheetH = targetFrameH * rows;
  const needsResize = targetSheetW !== sourceWidth || targetSheetH !== sourceHeight;

  // ── Auto-detect grid on mount ──
  const handleAutoDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const img = await loadImage(sourceDataUrl);
      const canvas = imageToCanvas(img);
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = detectGridSmart(imgData);
      setCols(result.cols);
      setRows(result.rows);
      setDetectionConfidence(result.confidence);
      setAlternative(result.alternative ?? null);
      setDetected(result.alternative ? { cols: result.cols, rows: result.rows } : null);
    } catch {
      // ignore
    } finally {
      setDetecting(false);
      setDetectionRan(true);
    }
  }, [sourceDataUrl]);

  useEffect(() => {
    handleAutoDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default target frame size for the grid on screen (defaultTargetFrame).
  useEffect(() => {
    if (!detectionRan) return;
    const target = defaultTargetFrame(currentFrameW, currentFrameH);
    setTargetFrameW(target.w);
    setTargetFrameH(target.h);
  }, [detectionRan, currentFrameW, currentFrameH]);

  // ── Draw grid overlay preview ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      // Wave M2: container-aware scale via useCanvasFitScale.
      const scale = previewScale;
      const displayW = Math.floor(sourceWidth * scale);
      const displayH = Math.floor(sourceHeight * scale);

      canvas.width = displayW;
      canvas.height = displayH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, displayW, displayH);

      // Grid overlay
      ctx.strokeStyle = 'rgba(212, 135, 28, 0.85)';
      ctx.lineWidth = 1;
      for (let c = 0; c <= cols; c++) {
        const x = Math.round((c * displayW) / cols) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, displayH);
        ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        const y = Math.round((r * displayH) / rows) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(displayW, y);
        ctx.stroke();
      }
    };
    img.src = sourceDataUrl;
  }, [sourceDataUrl, sourceWidth, sourceHeight, cols, rows, previewScale]);

  // ── Handlers ──
  const handleGridPreset = useCallback((c: number, r: number) => {
    setCols(c);
    setRows(r);
    setDetectionConfidence(null); // manual override clears the detection label
    setAlternative(null);
    setDetected(null);
  }, []);

  // On the detector's second choice, the button offers its first one back.
  const onAlternative = alternative !== null && cols === alternative.cols && rows === alternative.rows;
  const offered = alternative && detected ? (onAlternative ? detected : alternative) : null;

  const handleTryOther = useCallback(() => {
    if (!offered) return;
    setCols(offered.cols);
    setRows(offered.rows);
  }, [offered]);

  const handleFrameSizePreset = useCallback((w: number, h: number) => {
    setTargetFrameW(w);
    setTargetFrameH(h);
  }, []);

  const handleResize = useCallback(async () => {
    try {
      const img = await loadImage(sourceDataUrl);
      const dataUrl = resizePixelArt(img, targetSheetW, targetSheetH);
      onAccept(dataUrl, targetSheetW, targetSheetH, targetFrameW, targetFrameH);
    } catch {
      // ignore
    }
  }, [sourceDataUrl, targetSheetW, targetSheetH, targetFrameW, targetFrameH, onAccept]);

  const handleKeep = useCallback(() => {
    onKeepOriginal?.(currentFrameW, currentFrameH);
  }, [onKeepOriginal, currentFrameW, currentFrameH]);

  const totalFrames = cols * rows;
  // DRAFT COPY (upload-2 item 1): "Other guess" names the detector's second choice.
  const detectionLabel =
    detectionConfidence === 'high' ? 'Detected' : onAlternative ? 'Other guess' : 'Best guess';
  const detectionStatus = detectionConfidence
    ? `${detectionLabel}: ${cols}x${rows} (${cols * rows} frames)` +
      (detectionConfidence !== 'high' ? ', adjust if needed' : '')
    : '';

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
            we&apos;ll first identify the grid layout, then resize the whole sheet so
            each frame lands at a standard pixel art size.
          </p>
        </div>
      </div>

      {/* Step 1: Grid layout */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-mono text-text-secondary uppercase tracking-wider">
            1. How many frames does your sheet have?
          </label>
          <Button variant="ghost" size="sm" onClick={handleAutoDetect} disabled={detecting}>
            <Scan size={12} />
            {detecting ? 'Detecting...' : 'Auto-detect'}
          </Button>
        </div>

        {/* Detection result label. Screen readers hear it from the status
            line, which stays mounted while only its text changes, so the
            first result is announced too; the visible line is hidden from
            them, and the button beside it stays reachable. */}
        <span role="status" className="sr-only">
          {detectionStatus}
        </span>
        {detectionConfidence && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
            <p
              aria-hidden="true"
              className={`text-[10px] font-mono ${
                detectionConfidence === 'high' ? 'text-green-400' : 'text-amber-400'
              }`}
            >
              {detectionLabel}:{' '}
              <span className="font-semibold">
                {cols}x{rows}
              </span>{' '}
              ({cols * rows} frames)
              {detectionConfidence !== 'high' && ', adjust if needed'}
            </p>
            {/* DRAFT COPY (upload-2 item 1): "Try 4x4" */}
            {offered && (
              <button
                type="button"
                onClick={handleTryOther}
                disabled={detecting}
                className="px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                  bg-bg-elevated text-accent-amber hover:bg-bg-hover border border-accent-amber/40
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Try {offered.cols}x{offered.rows}
              </button>
            )}
          </div>
        )}

        {/* Grid presets */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {GRID_PRESETS.map((p) => {
            const active = cols === p.cols && rows === p.rows;
            return (
              <button
                key={`${p.cols}x${p.rows}`}
                onClick={() => handleGridPreset(p.cols, p.rows)}
                className={`px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors flex items-center gap-1
                  ${active
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {p.cols}x{p.rows}
                {active && <Check size={10} />}
              </button>
            );
          })}
        </div>

        {/* Custom cols/rows */}
        <div className="flex items-end gap-2 mb-3">
          <div>
            <label className="block text-[9px] font-mono text-text-muted mb-1">Columns</label>
            <input
              type="number"
              min={1}
              max={32}
              value={cols}
              onChange={(e) => {
                setCols(Math.max(1, Math.min(32, Number(e.target.value))));
                setDetectionConfidence(null);
                setAlternative(null);
                setDetected(null);
              }}
              className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <div>
            <label className="block text-[9px] font-mono text-text-muted mb-1">Rows</label>
            <input
              type="number"
              min={1}
              max={32}
              value={rows}
              onChange={(e) => {
                setRows(Math.max(1, Math.min(32, Number(e.target.value))));
                setDetectionConfidence(null);
                setAlternative(null);
                setDetected(null);
              }}
              className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <p className="text-[9px] font-mono text-text-muted mb-2">
            {totalFrames} frame{totalFrames !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Grid overlay preview */}
        <div
          ref={previewWrapperRef}
          className="rounded-lg border border-border-default bg-bg-elevated p-3 flex justify-center overflow-auto"
        >
          <canvas
            ref={canvasRef}
            className="block"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
        {!gridDividesEvenly && (
          <div className="mt-2 flex items-start gap-2 rounded bg-amber-500/10 border border-amber-500/20 px-3 py-1.5">
            <AlertCircle size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] font-mono text-amber-400">
              {sourceWidth}x{sourceHeight} doesn&apos;t divide evenly into {cols}x{rows}.
              The grid overlay approximates the layout — consider a different grid or auto-detect.
            </p>
          </div>
        )}
      </div>

      {/* Step 2: Target frame size */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          2. What size should each frame be?
        </label>
        <p className="text-[10px] font-mono text-text-muted mb-2">
          Each frame is currently{' '}
          <span className="text-text-primary font-semibold">
            {currentFrameW}x{currentFrameH}
          </span>
          {alreadyStandardSize && (
            <span className="ml-2 text-green-400">— already at a standard size</span>
          )}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {FRAME_SIZE_PRESETS.map((p) => {
            const active = targetFrameW === p.w && targetFrameH === p.h;
            const isCurrent = currentFrameW === p.w && currentFrameH === p.h && gridDividesEvenly;
            return (
              <button
                key={`${p.w}x${p.h}`}
                onClick={() => handleFrameSizePreset(p.w, p.h)}
                title={isCurrent ? 'Current frame size' : ''}
                className={`px-2.5 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors flex items-center gap-1
                  ${active
                    ? 'bg-accent-amber text-bg-primary'
                    : isCurrent
                      ? 'bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {p.w}x{p.h}
                {active && <Check size={10} />}
                {!active && isCurrent && <span className="text-[8px]">current</span>}
              </button>
            );
          })}
        </div>

        {/* Custom target frame size */}
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[9px] font-mono text-text-muted mb-1">Custom W</label>
            <input
              type="number"
              min={1}
              max={512}
              value={targetFrameW}
              onChange={(e) => setTargetFrameW(Math.max(1, Math.min(512, Number(e.target.value))))}
              className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
          <div>
            <label className="block text-[9px] font-mono text-text-muted mb-1">Custom H</label>
            <input
              type="number"
              min={1}
              max={512}
              value={targetFrameH}
              onChange={(e) => setTargetFrameH(Math.max(1, Math.min(512, Number(e.target.value))))}
              className="w-20 rounded bg-bg-elevated border border-border-default px-2 py-1
                text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
        </div>
      </div>

      {/* Step 3: Summary */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          3. Summary
        </label>
        <div className="rounded border border-border-default bg-bg-elevated p-3 space-y-1">
          <SummaryRow
            label="Current"
            value={`${cols}x${rows} grid, ${currentFrameW}x${currentFrameH} per frame (${sourceWidth}x${sourceHeight} sheet)`}
          />
          <SummaryRow
            label="Target"
            value={`${cols}x${rows} grid, ${targetFrameW}x${targetFrameH} per frame (${targetSheetW}x${targetSheetH} sheet)`}
            highlight={needsResize}
          />
          <SummaryRow label="Total frames" value={`${totalFrames}`} />
        </div>
      </div>

      {/* Actions — flex-wrap keeps the primary "Use as-is" / "Resize to WxH"
          button reachable on portrait where the three buttons together exceed
          the card content width. */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Upload Different
            </Button>
          )}
          {onKeepOriginal && (
            <Button variant="secondary" size="sm" onClick={handleKeep}>
              Keep Original Size
            </Button>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={handleResize}>
          <Check size={14} />
          {needsResize ? `Resize to ${targetSheetW}x${targetSheetH}` : 'Use as-is'}
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
    <div className="flex items-start justify-between gap-3">
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider flex-shrink-0">
        {label}
      </span>
      <span
        className={`text-[11px] font-mono text-right ${
          highlight ? 'text-accent-amber font-semibold' : 'text-text-primary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
