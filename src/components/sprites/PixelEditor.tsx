'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Pencil, Eraser, Pipette, Undo2, Redo2, Save, X } from 'lucide-react';
import Button from '@/components/ui/Button';

type Tool = 'pencil' | 'eraser' | 'eyedropper';

interface PixelEditorProps {
  frameDataUrl: string;
  frameWidth: number;
  frameHeight: number;
  onSave: (newDataUrl: string) => void;
  onClose: () => void;
}

const MAX_UNDO = 50;

export default function PixelEditor({
  frameDataUrl,
  frameWidth,
  frameHeight,
  onSave,
  onClose,
}: PixelEditorProps) {
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  // The source-of-truth pixel data canvas (actual frame size, no scaling)
  const dataCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);

  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#d4871c');
  const [palette, setPalette] = useState<string[]>([]);
  const [zoom, setZoom] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);

  // Compute zoom to fit viewport
  useEffect(() => {
    const maxEditorPx = Math.min(window.innerWidth - 200, window.innerHeight - 200, 640);
    const idealZoom = Math.floor(maxEditorPx / Math.max(frameWidth, frameHeight));
    setZoom(Math.max(4, Math.min(16, idealZoom)));
  }, [frameWidth, frameHeight]);

  // Load the frame into the data canvas and extract palette
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const dc = document.createElement('canvas');
      dc.width = frameWidth;
      dc.height = frameHeight;
      const ctx = dc.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, frameWidth, frameHeight);
      dataCanvasRef.current = dc;

      // Extract palette
      const imgData = ctx.getImageData(0, 0, frameWidth, frameHeight);
      const colors = new Set<string>();
      for (let i = 0; i < imgData.data.length; i += 4) {
        const a = imgData.data[i + 3];
        if (a < 10) continue;
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        colors.add(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
      }
      setPalette(Array.from(colors).slice(0, 32));

      // Save initial state for undo
      undoStack.current = [ctx.getImageData(0, 0, frameWidth, frameHeight)];
      redoStack.current = [];

      drawEditor();
      drawPreview();
    };
    img.src = frameDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameDataUrl, frameWidth, frameHeight]);

  const drawEditor = useCallback(() => {
    const ec = editorCanvasRef.current;
    const dc = dataCanvasRef.current;
    if (!ec || !dc) return;

    const w = frameWidth * zoom;
    const h = frameHeight * zoom;
    ec.width = w;
    ec.height = h;
    const ctx = ec.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Checkerboard background
    const tileSize = Math.max(zoom / 2, 4);
    for (let y = 0; y < h; y += tileSize) {
      for (let x = 0; x < w; x += tileSize) {
        const light = ((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2) === 0;
        ctx.fillStyle = light ? '#2a2725' : '#1e1b18';
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }

    // Draw scaled-up sprite
    ctx.drawImage(dc, 0, 0, w, h);

    // Grid overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= frameWidth; x++) {
      ctx.beginPath();
      ctx.moveTo(x * zoom + 0.5, 0);
      ctx.lineTo(x * zoom + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= frameHeight; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * zoom + 0.5);
      ctx.lineTo(w, y * zoom + 0.5);
      ctx.stroke();
    }
  }, [frameWidth, frameHeight, zoom]);

  const drawPreview = useCallback(() => {
    const pc = previewCanvasRef.current;
    const dc = dataCanvasRef.current;
    if (!pc || !dc) return;
    pc.width = frameWidth;
    pc.height = frameHeight;
    const ctx = pc.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, frameWidth, frameHeight);
    ctx.drawImage(dc, 0, 0);
  }, [frameWidth, frameHeight]);

  // Redraw when zoom changes
  useEffect(() => {
    drawEditor();
  }, [zoom, drawEditor]);

  const pushUndo = useCallback(() => {
    const dc = dataCanvasRef.current;
    if (!dc) return;
    const ctx = dc.getContext('2d')!;
    const snap = ctx.getImageData(0, 0, frameWidth, frameHeight);
    undoStack.current.push(snap);
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  }, [frameWidth, frameHeight]);

  const handleUndo = useCallback(() => {
    const dc = dataCanvasRef.current;
    if (!dc || undoStack.current.length <= 1) return;
    const ctx = dc.getContext('2d')!;
    // Save current for redo
    redoStack.current.push(ctx.getImageData(0, 0, frameWidth, frameHeight));
    // Pop last and restore
    undoStack.current.pop();
    const prev = undoStack.current[undoStack.current.length - 1];
    ctx.putImageData(prev, 0, 0);
    drawEditor();
    drawPreview();
  }, [frameWidth, frameHeight, drawEditor, drawPreview]);

  const handleRedo = useCallback(() => {
    const dc = dataCanvasRef.current;
    if (!dc || redoStack.current.length === 0) return;
    const ctx = dc.getContext('2d')!;
    // Push current to undo
    undoStack.current.push(ctx.getImageData(0, 0, frameWidth, frameHeight));
    const next = redoStack.current.pop()!;
    ctx.putImageData(next, 0, 0);
    drawEditor();
    drawPreview();
  }, [frameWidth, frameHeight, drawEditor, drawPreview]);

  const applyTool = useCallback(
    (px: number, py: number) => {
      const dc = dataCanvasRef.current;
      if (!dc || px < 0 || py < 0 || px >= frameWidth || py >= frameHeight) return;
      const ctx = dc.getContext('2d')!;

      if (tool === 'eyedropper') {
        const pixel = ctx.getImageData(px, py, 1, 1).data;
        if (pixel[3] > 10) {
          const hex = `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;
          setColor(hex);
          setTool('pencil');
        }
        return;
      }

      if (tool === 'pencil') {
        ctx.fillStyle = color;
        ctx.clearRect(px, py, 1, 1);
        ctx.fillRect(px, py, 1, 1);
      } else if (tool === 'eraser') {
        ctx.clearRect(px, py, 1, 1);
      }

      drawEditor();
      drawPreview();
    },
    [tool, color, frameWidth, frameHeight, drawEditor, drawPreview]
  );

  const getPixelCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = editorCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / zoom);
      const y = Math.floor((e.clientY - rect.top) / zoom);
      return { x, y };
    },
    [zoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getPixelCoords(e);
      if (!coords) return;
      if (tool !== 'eyedropper') pushUndo();
      setIsDrawing(true);
      applyTool(coords.x, coords.y);
    },
    [getPixelCoords, pushUndo, applyTool, tool]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing || tool === 'eyedropper') return;
      const coords = getPixelCoords(e);
      if (coords) applyTool(coords.x, coords.y);
    },
    [isDrawing, tool, getPixelCoords, applyTool]
  );

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const handleSave = useCallback(() => {
    const dc = dataCanvasRef.current;
    if (!dc) return;
    onSave(dc.toDataURL('image/png'));
  }, [onSave]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleUndo, handleRedo, onClose]);

  const toolButtons: Array<{ id: Tool; icon: typeof Pencil; label: string }> = [
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-bg-primary border border-border-default rounded-xl shadow-2xl flex flex-col max-h-[90vh] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-mono font-semibold text-text-primary">
            Pixel Editor
            <span className="ml-2 text-text-muted font-normal">{frameWidth}x{frameHeight}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-col gap-2 p-3 border-r border-border-default bg-bg-secondary">
            {/* Tools */}
            {toolButtons.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setTool(id)}
                title={label}
                className={`p-2 rounded cursor-pointer transition-colors
                  ${tool === id
                    ? 'bg-accent-amber text-bg-primary'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                  }`}
              >
                <Icon size={16} />
              </button>
            ))}

            <div className="w-full h-px bg-border-subtle my-1" />

            {/* Undo / Redo */}
            <button
              onClick={handleUndo}
              title="Undo (Ctrl+Z)"
              disabled={undoStack.current.length <= 1}
              className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={handleRedo}
              title="Redo (Ctrl+Shift+Z)"
              disabled={redoStack.current.length === 0}
              className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Redo2 size={16} />
            </button>

            <div className="w-full h-px bg-border-subtle my-1" />

            {/* Color */}
            <div
              className="w-8 h-8 rounded border border-border-default cursor-pointer mx-auto"
              style={{ backgroundColor: color }}
              title="Current color"
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-6 rounded cursor-pointer mx-auto border-0"
            />

            <div className="w-full h-px bg-border-subtle my-1" />

            {/* Palette */}
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
              {palette.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setColor(c);
                    setTool('pencil');
                  }}
                  className={`w-4 h-4 rounded-sm border cursor-pointer ${
                    color === c ? 'border-accent-amber ring-1 ring-accent-amber' : 'border-border-subtle'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Editor area */}
          <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4 overflow-auto bg-bg-primary">
            {/* Zoom controls */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Zoom</label>
              {([4, 8, 12, 16] as const).map((z) => (
                <button
                  key={z}
                  onClick={() => setZoom(z)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors
                    ${zoom === z
                      ? 'bg-accent-amber text-bg-primary'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                    }`}
                >
                  {z}x
                </button>
              ))}
            </div>

            {/* Canvas */}
            <canvas
              ref={editorCanvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="block cursor-crosshair"
              style={{ imageRendering: 'pixelated' }}
            />

            {/* 1x preview */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-text-muted">1x preview:</span>
              <div
                className="border border-border-default rounded"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                  backgroundSize: '4px 4px',
                  backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0',
                }}
              >
                <canvas
                  ref={previewCanvasRef}
                  style={{ imageRendering: 'pixelated', display: 'block' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            <Save size={14} />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
