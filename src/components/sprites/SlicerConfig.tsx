'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Grid3X3, Scan, Scissors } from 'lucide-react';
import { SPRITE_SIZES } from '@/lib/constants';
import { detectFrameGrid, loadImage, imageToCanvas } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';

interface SlicerConfigProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onSlice: (config: SliceConfig) => void;
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
}: SlicerConfigProps) {
  const generationStyle = useSpriteStore((s) => s.generationStyle);
  const [frameWidth, setFrameWidth] = useState(32);
  const [frameHeight, setFrameHeight] = useState(32);
  const [padding, setPadding] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const columns = Math.max(1, Math.floor((imageWidth - offsetX) / (frameWidth + padding)));
  const rows = Math.max(1, Math.floor((imageHeight - offsetY) / (frameHeight + padding)));
  const totalFrames = columns * rows;

  // Auto-detect on mount
  useEffect(() => {
    handleAutoDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const handleAutoDetect = useCallback(async () => {
    setDetecting(true);
    try {
      // Animate My Character results use animation__any_animation which always
      // outputs 64x64 frames in a grid. Skip detection and force 64x64.
      if (generationStyle && generationStyle.startsWith('any_animation_')) {
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
      if (result) {
        setFrameWidth(result.width);
        setFrameHeight(result.height);
        setPadding(0);
        setOffsetX(0);
        setOffsetY(0);
      }
    } catch {
      // Detection failed — keep defaults
    } finally {
      setDetecting(false);
    }
  }, [imageUrl, generationStyle]);

  // Draw preview with grid overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      // Scale to fit within 600px width
      const maxW = 600;
      const scale = Math.min(maxW / imageWidth, 1);
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
  }, [imageUrl, imageWidth, imageHeight, frameWidth, frameHeight, columns, rows, padding, offsetX, offsetY]);

  const handleSlice = () => {
    onSlice({ frameWidth, frameHeight, columns, rows, padding, offsetX, offsetY });
  };

  return (
    <div className="space-y-6">
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
              onChange={(e) => setFrameWidth(Math.max(1, Number(e.target.value)))}
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
              onChange={(e) => setFrameHeight(Math.max(1, Number(e.target.value)))}
              className="w-full rounded bg-bg-elevated border border-border-default px-3 py-2
                text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber"
            />
          </div>
        </div>

        {/* Quick-select sizes */}
        <div className="flex flex-wrap gap-1.5">
          {SPRITE_SIZES.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setFrameWidth(s.width);
                setFrameHeight(s.height);
              }}
              title={s.description}
              className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                ${
                  frameWidth === s.width && frameHeight === s.height
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-border-subtle'
                }
              `}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

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
        <div className="rounded-lg border border-border-default bg-bg-elevated p-3 overflow-auto">
          <canvas
            ref={canvasRef}
            className="block mx-auto"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      </div>

      {/* Slice button */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-text-muted">
          Will extract <span className="text-accent-amber font-semibold">{totalFrames}</span> frames
        </p>
        <Button size="lg" onClick={handleSlice}>
          <Scissors size={16} />
          Slice into Frames
        </Button>
      </div>
    </div>
  );
}
