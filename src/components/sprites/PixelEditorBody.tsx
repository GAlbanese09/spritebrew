'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Pencil, Eraser, Pipette, Undo2, Redo2, Save, X, ArrowLeft } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import Button from '@/components/ui/Button';
import {
  useEditorStore,
  selectCanUndo,
  selectCanRedo,
  VALID_BRUSH_SIZES,
  type Tool,
} from './editorStore';
import { extractPaletteFromImageData } from '@/lib/imagePalette';

/**
 * Chrome-free Pixel Editor body. Hosts all the Wave 1 logic (store wiring,
 * hotkeys, canvas rendering, beforeunload guard, palette extraction) plus
 * the v2 Phase 1 structural CSS Grid layout that fixes the swatch clip
 * by construction.
 *
 * Two modes:
 *   - layout="modal" — mounted inside <PixelEditor>'s Dialog. Header shows
 *     title + X; footer shows Cancel + Save (existing UX preserved). Save
 *     calls onSave(dataUrl) then onDismiss(); dismiss routes through the
 *     wrapper's confirm-discard logic.
 *   - layout="page" — mounted directly by /editor. Header shows title +
 *     "← Back" link + "Save (download PNG)". No footer. Save triggers a
 *     PNG download via <a download>; the editor stays open. Dismiss is the
 *     parent's responsibility (clears store + landing).
 */

interface PixelEditorBodyProps {
  frameDataUrl: string;
  frameWidth: number;
  frameHeight: number;
  onSave: (newDataUrl: string) => void;
  onDismiss: () => void;
  layout: 'modal' | 'page';
}

export default function PixelEditorBody({
  frameDataUrl,
  frameWidth,
  frameHeight,
  onSave,
  onDismiss,
  layout,
}: PixelEditorBodyProps) {
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Non-pixel store subscriptions (re-render on change).
  const tool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const color = useEditorStore((s) => s.foregroundColor);
  const setColor = useEditorStore((s) => s.setForegroundColor);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const isDirty = useEditorStore((s) => s.historyIndex > 0);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);

  const loadFrame = useEditorStore((s) => s.loadFrame);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const endStroke = useEditorStore((s) => s.endStroke);
  const paintPixel = useEditorStore((s) => s.paintPixel);
  const erasePixel = useEditorStore((s) => s.erasePixel);
  const eyedrop = useEditorStore((s) => s.eyedrop);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const reset = useEditorStore((s) => s.reset);

  const [zoom, setZoom] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);

  // Transient toast for keyboard-driven brush-size changes.
  const [brushToast, setBrushToast] = useState<string | null>(null);
  const brushToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cursor overlay (mirrors brush footprint at canvas-pixel coords).
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(false);
  const cursorRafRef = useRef<number | null>(null);

  // Fit-to-viewport zoom on dim changes.
  useEffect(() => {
    const maxEditorPx = Math.min(window.innerWidth - 200, window.innerHeight - 200, 640);
    const idealZoom = Math.floor(maxEditorPx / Math.max(frameWidth, frameHeight));
    setZoom(Math.max(4, Math.min(16, idealZoom)));
  }, [frameWidth, frameHeight]);

  // Load frame pixels into the store + extract palette. Reset on unmount so
  // the next editor open gets a clean slate.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const tmp = document.createElement('canvas');
      tmp.width = frameWidth;
      tmp.height = frameHeight;
      const ctx = tmp.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, frameWidth, frameHeight);
      const imageData = ctx.getImageData(0, 0, frameWidth, frameHeight);

      setPalette(extractPaletteFromImageData(imageData, 16));
      loadFrame('current', new Uint8ClampedArray(imageData.data), frameWidth, frameHeight);
    };
    img.src = frameDataUrl;

    return () => {
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameDataUrl, frameWidth, frameHeight]);

  // Imperative canvas render — reads pixels via getState so we don't depend
  // on React re-renders to draw. Called on subscription fire and on zoom change.
  const renderCanvases = useCallback(() => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels || width === 0 || height === 0) return;

    const stage = document.createElement('canvas');
    stage.width = width;
    stage.height = height;
    const stageCtx = stage.getContext('2d')!;
    stageCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);

    const ec = editorCanvasRef.current;
    if (ec) {
      const w = width * zoom;
      const h = height * zoom;
      ec.width = w;
      ec.height = h;
      const ctx = ec.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;

      const tileSize = Math.max(zoom / 2, 4);
      for (let y = 0; y < h; y += tileSize) {
        for (let x = 0; x < w; x += tileSize) {
          const light = ((Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2) === 0;
          ctx.fillStyle = light ? '#2a2725' : '#1e1b18';
          ctx.fillRect(x, y, tileSize, tileSize);
        }
      }
      ctx.drawImage(stage, 0, 0, w, h);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, h);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(w, y * zoom + 0.5);
        ctx.stroke();
      }
    }

    const pc = previewCanvasRef.current;
    if (pc) {
      pc.width = width;
      pc.height = height;
      const ctx = pc.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(stage, 0, 0);
    }
  }, [zoom]);

  // Pixel subscription — fires outside React reconciliation, no re-render.
  useEffect(() => {
    renderCanvases();
    const unsub = useEditorStore.subscribe(
      (s) => s.pixels,
      () => renderCanvases()
    );
    return unsub;
  }, [renderCanvases]);

  // Re-render on zoom change (canvas dims change).
  useEffect(() => {
    renderCanvases();
  }, [zoom, renderCanvases]);

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

  const applyAt = useCallback(
    (x: number, y: number) => {
      if (tool === 'pencil') {
        paintPixel(x, y, color);
      } else if (tool === 'eraser') {
        erasePixel(x, y);
      } else if (tool === 'eyedropper') {
        const hex = eyedrop(x, y);
        if (hex) {
          setColor(hex);
          setTool('pencil');
        }
      }
    },
    [tool, color, paintPixel, erasePixel, eyedrop, setColor, setTool]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getPixelCoords(e);
      if (!coords) return;
      if (tool !== 'eyedropper') beginStroke();
      setIsDrawing(true);
      applyAt(coords.x, coords.y);
    },
    [getPixelCoords, tool, beginStroke, applyAt]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = editorCanvasRef.current?.getBoundingClientRect();
      if (rect) {
        const cellX = Math.floor((e.clientX - rect.left) / zoom);
        const cellY = Math.floor((e.clientY - rect.top) / zoom);
        const half = Math.floor(brushSize / 2);
        const ox = (cellX - half) * zoom;
        const oy = (cellY - half) * zoom;
        if (cursorRafRef.current !== null) cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = requestAnimationFrame(() => {
          setCursorX(ox);
          setCursorY(oy);
        });
      }

      if (!isDrawing || tool === 'eyedropper') return;
      const coords = getPixelCoords(e);
      if (coords) applyAt(coords.x, coords.y);
    },
    [isDrawing, tool, brushSize, zoom, getPixelCoords, applyAt]
  );

  const handleMouseUp = useCallback(() => {
    if (isDrawing && tool !== 'eyedropper') {
      endStroke();
    }
    setIsDrawing(false);
  }, [isDrawing, tool, endStroke]);

  const handleMouseEnter = useCallback(() => setCursorVisible(true), []);
  const handleMouseLeaveCanvas = useCallback(() => {
    setCursorVisible(false);
    handleMouseUp();
  }, [handleMouseUp]);

  // Serialize current store pixels to a PNG dataURL.
  const renderToDataUrl = useCallback((): string | null => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    return canvas.toDataURL('image/png');
  }, []);

  // Modal-mode Save: callback + dismiss (parent handles flow).
  const doSaveAndDismiss = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (dataUrl) onSave(dataUrl);
    onDismiss();
  }, [renderToDataUrl, onSave, onDismiss]);

  // Page-mode Save: PNG download via <a download>. Editor stays open.
  const doSaveAsDownload = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `spritebrew-edit-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [renderToDataUrl]);

  // beforeunload guard — fires in BOTH layouts. Wave 1 invariant: register
  // only while dirty so a clean editor session doesn't pollute navigation.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Hotkeys — same Wave 1 + Day-9 useKey/splitKey fixes.
  const cycleBrushSize = useCallback(
    (delta: number) => {
      const cur = useEditorStore.getState().brushSize;
      const idx = VALID_BRUSH_SIZES.indexOf(cur);
      const nextIdx = Math.max(0, Math.min(VALID_BRUSH_SIZES.length - 1, idx + delta));
      const next = VALID_BRUSH_SIZES[nextIdx];
      if (next !== cur) {
        setBrushSize(next);
        if (brushToastTimerRef.current) clearTimeout(brushToastTimerRef.current);
        setBrushToast(`Brush: ${next}px`);
        brushToastTimerRef.current = setTimeout(() => setBrushToast(null), 1200);
      }
    },
    [setBrushSize]
  );

  useHotkeys('[', () => cycleBrushSize(-1), { useKey: true });
  useHotkeys(']', () => cycleBrushSize(+1), { useKey: true });
  useHotkeys('-', () => cycleBrushSize(-1), { useKey: true });
  useHotkeys(['=', '+'], () => cycleBrushSize(+1), { useKey: true, splitKey: '_' });
  useHotkeys('mod+z', (e) => { e.preventDefault(); undo(); });
  useHotkeys('mod+shift+z', (e) => { e.preventDefault(); redo(); });

  const toolButtons: Array<{ id: Tool; icon: typeof Pencil; label: string }> = [
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  ];

  return (
    <div
      className="h-full grid grid-rows-[auto_1fr] grid-cols-[56px_1fr_280px] [grid-template-areas:'header_header_header''toolbar_canvas_sidepanel'] bg-bg-primary"
    >
      {/* Header */}
      <header className="[grid-area:header] flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-primary">
        <h2 className="text-sm font-mono font-semibold text-text-primary">
          Pixel Editor
          <span className="ml-2 text-text-muted font-normal">
            {frameWidth}x{frameHeight}
          </span>
        </h2>

        {layout === 'modal' ? (
          <button
            onClick={onDismiss}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
            aria-label="Close editor"
          >
            <X size={16} />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/editor" onClick={onDismiss}>
              <Button variant="ghost" size="sm">
                <ArrowLeft size={14} />
                Back
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={doSaveAsDownload}>
              <Save size={14} />
              Save (download PNG)
            </Button>
          </div>
        )}
      </header>

      {/* Toolbar (left) */}
      <aside className="[grid-area:toolbar] border-r border-border-default bg-bg-secondary overflow-y-auto [scrollbar-gutter:stable] p-2 flex flex-col gap-2">
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

        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider text-center">
          Brush
        </div>
        <div className="grid grid-cols-3 gap-1">
          {VALID_BRUSH_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setBrushSize(size)}
              aria-label={`Brush size ${size}px`}
              title={`Brush size ${size}px ( [ / ] )`}
              className={`h-7 rounded text-[10px] font-mono cursor-pointer transition-colors
                ${brushSize === size
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {size}
            </button>
          ))}
        </div>

        <div className="w-full h-px bg-border-subtle my-1" />

        <button
          onClick={undo}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Redo2 size={16} />
        </button>
      </aside>

      {/* Canvas (center) */}
      <main className="[grid-area:canvas] overflow-auto bg-bg-primary relative">
        <div className="min-h-full flex flex-col items-center justify-center p-4 gap-4">
          {/* Zoom controls (Wave 2 replaces with react-zoom-pan-pinch) */}
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Zoom
            </label>
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

          {/* Canvas + cursor footprint overlay */}
          <div className="relative">
            <canvas
              ref={editorCanvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeaveCanvas}
              className="block"
              style={{ imageRendering: 'pixelated', cursor: 'none' }}
            />
            <div
              aria-hidden="true"
              className="absolute pointer-events-none border border-white"
              style={{
                mixBlendMode: 'difference',
                top: 0,
                left: 0,
                width: brushSize * zoom,
                height: brushSize * zoom,
                transform: `translate(${cursorX}px, ${cursorY}px)`,
                display: cursorVisible ? 'block' : 'none',
              }}
            />
          </div>

          {/* 1× preview */}
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

          {/* Brush-size toast */}
          {brushToast && (
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded bg-black/80 text-amber-300 text-xs font-mono pointer-events-none"
              role="status"
              aria-live="polite"
            >
              {brushToast}
            </div>
          )}
        </div>
      </main>

      {/* Sidepanel (right): color + palette + future preview */}
      <aside className="[grid-area:sidepanel] border-l border-border-default bg-bg-secondary overflow-y-auto [scrollbar-gutter:stable] p-3 flex flex-col gap-4">
        {/* Current color */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Color
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded border border-border-default cursor-pointer flex-shrink-0"
              style={{ backgroundColor: color }}
              title="Current color"
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="flex-1 h-10 rounded cursor-pointer border-0"
              aria-label="Pick color"
            />
          </div>
        </div>

        {/* Palette */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Palette
          </div>
          <div className="grid grid-cols-2 gap-1">
            {palette.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  setTool('pencil');
                }}
                className={`w-3 h-3 rounded-sm border cursor-pointer ${
                  color === c ? 'border-accent-amber ring-1 ring-accent-amber' : 'border-border-subtle'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Animation preview — Phase 4 */}

        {/* Modal footer slot: Cancel / Save sits inline at the bottom of the
            sidepanel only in modal mode. Page mode puts Save in the header,
            so this block is hidden there. */}
        {layout === 'modal' && (
          <div className="mt-auto pt-3 border-t border-border-subtle flex flex-col gap-2">
            <Button variant="primary" size="sm" onClick={doSaveAndDismiss}>
              <Save size={14} />
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Cancel
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
