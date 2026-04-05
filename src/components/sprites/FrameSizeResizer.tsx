'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Grid3X3, Check, Scan, AlertCircle } from 'lucide-react';
import { loadImage, imageToCanvas, resizePixelArt } from '@/lib/spriteUtils';
import Button from '@/components/ui/Button';

// ─────────────────────────────────────────────────────────────────────────
// Grid detection for the FrameSizeResizer.
//
// This is intentionally separate from `detectFrameGrid` in spriteUtils.ts —
// that function is tuned for the slicer's "find frame size from gutters"
// problem. Here we want the opposite: figure out the GRID (cols × rows)
// for a sheet the user will resize next.
//
// Priority order:
//   1. Common grid layouts (4×4, 3×4, 8×8, etc.) that divide the image
//      evenly with a reasonable per-frame size. This catches the 800×800 →
//      4×4 case that the old algorithm missed.
//   2. Standard SPRITE_SIZES that divide the image evenly (for sheets that
//      are already at pixel-art resolutions like 192×192 → 48×48 frames).
//   3. Transparent/uniform gutter detection.
//   4. Dimension-based fallback (square → 4×4, strip → W÷H columns, etc.)
// ─────────────────────────────────────────────────────────────────────────

type DetectionConfidence = 'high' | 'medium' | 'low';

interface DetectionResult {
  cols: number;
  rows: number;
  confidence: DetectionConfidence;
}

/** Preferred grid layouts in order of commonality for sprite sheets. */
const COMMON_GRIDS: ReadonlyArray<readonly [number, number]> = [
  [4, 4],
  [3, 4],
  [4, 3],
  [8, 8],
  [4, 8],
  [8, 4],
  [2, 2],
  [3, 3],
  [2, 4],
  [4, 2],
  [5, 5],
  [6, 6],
  [2, 3],
  [3, 2],
];

const STANDARD_FRAME_SIZES = [128, 64, 48, 32, 24, 16] as const;

/** Validate a (cols, rows) candidate produces a sensible sprite sheet. */
function isValidGrid(imgW: number, imgH: number, cols: number, rows: number): boolean {
  if (cols < 1 || rows < 1 || cols > 16 || rows > 16) return false;
  const count = cols * rows;
  if (count < 2 || count > 256) return false;
  const fw = imgW / cols;
  const fh = imgH / rows;
  if (!Number.isInteger(fw) || !Number.isInteger(fh)) return false;
  if (fw < 8 || fh < 8 || fw > 512 || fh > 512) return false;
  // Reject extreme aspect ratios unless the grid itself is non-square
  const frameRatio = fw / fh;
  if (frameRatio < 0.4 || frameRatio > 2.5) return false;
  return true;
}

/** Priority 1: check common grid layouts first. */
function detectByCommonGrid(imgW: number, imgH: number): DetectionResult | null {
  for (const [c, r] of COMMON_GRIDS) {
    if (isValidGrid(imgW, imgH, c, r)) {
      return { cols: c, rows: r, confidence: 'high' };
    }
  }
  return null;
}

/** Priority 2: standard frame sizes that divide the image evenly. */
function detectByStandardSize(imgW: number, imgH: number): DetectionResult | null {
  for (const fw of STANDARD_FRAME_SIZES) {
    for (const fh of STANDARD_FRAME_SIZES) {
      if (imgW % fw !== 0 || imgH % fh !== 0) continue;
      const cols = imgW / fw;
      const rows = imgH / fh;
      if (!isValidGrid(imgW, imgH, cols, rows)) continue;
      return { cols, rows, confidence: 'high' };
    }
  }
  return null;
}

/** Priority 3: transparent/uniform gutter analysis. */
function detectByGutters(imgData: ImageData): DetectionResult | null {
  const { width: W, height: H, data } = imgData;

  const isTransparentColumn = (x: number): boolean => {
    for (let y = 0; y < H; y++) {
      if (data[(y * W + x) * 4 + 3] > 10) return false;
    }
    return true;
  };
  const isTransparentRow = (y: number): boolean => {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 10) return false;
    }
    return true;
  };

  // Collect transparent column/row indices, group into bands
  const groupBands = (indices: number[]): number[] => {
    if (indices.length === 0) return [];
    const bands: number[] = [];
    let bandStart = indices[0];
    let prev = indices[0];
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === prev + 1) {
        prev = indices[i];
      } else {
        bands.push(Math.floor((bandStart + prev) / 2));
        bandStart = indices[i];
        prev = indices[i];
      }
    }
    bands.push(Math.floor((bandStart + prev) / 2));
    return bands;
  };

  const transparentCols: number[] = [];
  for (let x = 0; x < W; x++) if (isTransparentColumn(x)) transparentCols.push(x);
  const transparentRows: number[] = [];
  for (let y = 0; y < H; y++) if (isTransparentRow(y)) transparentRows.push(y);

  const colBands = groupBands(transparentCols);
  const rowBands = groupBands(transparentRows);

  // Number of frames = bands between edges. If the image has edge gutters,
  // bands will include start and end; otherwise they're interior dividers.
  // Interior-divider case: cols = bands.length + 1
  // Edge-inclusive case: cols = bands.length - 1 (if first/last band is at 0/W)
  let cols = 0;
  let rows = 0;
  if (colBands.length >= 1) {
    const hasLeftEdge = colBands[0] < 5;
    const hasRightEdge = colBands[colBands.length - 1] > W - 5;
    cols = colBands.length + 1 - (hasLeftEdge ? 1 : 0) - (hasRightEdge ? 1 : 0);
  }
  if (rowBands.length >= 1) {
    const hasTopEdge = rowBands[0] < 5;
    const hasBottomEdge = rowBands[rowBands.length - 1] > H - 5;
    rows = rowBands.length + 1 - (hasTopEdge ? 1 : 0) - (hasBottomEdge ? 1 : 0);
  }

  if (cols >= 2 && rows >= 2 && cols <= 16 && rows <= 16) {
    return { cols, rows, confidence: 'medium' };
  }
  if (cols >= 2 && cols <= 16 && rows === 0 && H > 0) {
    return { cols, rows: 1, confidence: 'medium' };
  }
  if (rows >= 2 && rows <= 16 && cols === 0 && W > 0) {
    return { cols: 1, rows, confidence: 'medium' };
  }
  return null;
}

/** Priority 4: dimension-based heuristic. */
function detectByDimensions(imgW: number, imgH: number): DetectionResult {
  if (imgW === imgH) {
    // Square — 4×4 is by far the most common sprite sheet layout
    return { cols: 4, rows: 4, confidence: 'low' };
  }
  if (imgW > 2 * imgH) {
    // Horizontal strip
    const c = Math.max(2, Math.min(16, Math.round(imgW / imgH)));
    return { cols: c, rows: 1, confidence: 'low' };
  }
  if (imgH > 2 * imgW) {
    // Vertical strip
    const r = Math.max(2, Math.min(16, Math.round(imgH / imgW)));
    return { cols: 1, rows: r, confidence: 'low' };
  }
  // Rectangular but not extreme — guess 4×4
  return { cols: 4, rows: 4, confidence: 'low' };
}

/** Main detection entry point. Runs all priorities and returns the first match. */
function detectGridSmart(imgData: ImageData): DetectionResult {
  const { width: W, height: H } = imgData;

  const p1 = detectByCommonGrid(W, H);
  if (p1) return p1;

  const p2 = detectByStandardSize(W, H);
  if (p2) return p2;

  const p3 = detectByGutters(imgData);
  if (p3) return p3;

  return detectByDimensions(W, H);
}

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

const FRAME_SIZE_PRESETS = [
  { w: 16, h: 16 },
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

  const [targetFrameW, setTargetFrameW] = useState(64);
  const [targetFrameH, setTargetFrameH] = useState(64);

  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  // Default target frame size to the first standard size ≤ current (scale down)
  // or match if already standard
  useEffect(() => {
    if (!detectionRan) return;
    if (matchingPreset) {
      setTargetFrameW(matchingPreset.w);
      setTargetFrameH(matchingPreset.h);
      return;
    }
    // Largest preset smaller than current frame
    const sorted = [...FRAME_SIZE_PRESETS].sort((a, b) => b.w - a.w);
    const smaller = sorted.find((p) => p.w <= currentFrameW && p.h <= currentFrameH);
    if (smaller) {
      setTargetFrameW(smaller.w);
      setTargetFrameH(smaller.h);
    } else {
      // Source frames are tiny — use smallest preset
      setTargetFrameW(16);
      setTargetFrameH(16);
    }
  }, [detectionRan, matchingPreset, currentFrameW, currentFrameH]);

  // ── Draw grid overlay preview ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      const maxW = 400;
      const scale = Math.min(maxW / sourceWidth, 1);
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
  }, [sourceDataUrl, sourceWidth, sourceHeight, cols, rows]);

  // ── Handlers ──
  const handleGridPreset = useCallback((c: number, r: number) => {
    setCols(c);
    setRows(r);
    setDetectionConfidence(null); // manual override clears the detection label
  }, []);

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

        {/* Detection result label */}
        {detectionConfidence && (
          <p
            className={`text-[10px] font-mono mb-2 ${
              detectionConfidence === 'high' ? 'text-green-400' : 'text-amber-400'
            }`}
          >
            {detectionConfidence === 'high' ? 'Detected' : 'Best guess'}:{' '}
            <span className="font-semibold">
              {cols}x{rows}
            </span>{' '}
            ({cols * rows} frames)
            {detectionConfidence !== 'high' && ' — adjust if needed'}
          </p>
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
        <div className="rounded-lg border border-border-default bg-bg-elevated p-3 flex justify-center">
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

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
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
