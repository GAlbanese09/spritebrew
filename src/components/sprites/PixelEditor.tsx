'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Pencil, Eraser, Pipette, Undo2, Redo2, Save, X } from 'lucide-react';
import { Dialog } from '@headlessui/react';
import { useHotkeys } from 'react-hotkeys-hook';
import Button from '@/components/ui/Button';
import {
  useEditorStore,
  selectIsDirty,
  selectCanUndo,
  selectCanRedo,
  VALID_BRUSH_SIZES,
  type Tool,
} from './editorStore';

interface PixelEditorProps {
  frameDataUrl: string;
  frameWidth: number;
  frameHeight: number;
  onSave: (newDataUrl: string) => void;
  onClose: () => void;
}

export default function PixelEditor({
  frameDataUrl,
  frameWidth,
  frameHeight,
  onSave,
  onClose,
}: PixelEditorProps) {
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Store subscriptions for UI state (re-render on change).
  // Pixel data deliberately NOT subscribed via hook — we render canvases
  // imperatively in a useEditorStore.subscribe listener to avoid a React
  // re-render of the whole modal tree on every brush stroke.
  const tool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const color = useEditorStore((s) => s.foregroundColor);
  const setColor = useEditorStore((s) => s.setForegroundColor);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const isDirty = useEditorStore(selectIsDirty);
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Transient toast for keyboard-driven brush-size changes.
  const [brushToast, setBrushToast] = useState<string | null>(null);
  const brushToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cursor overlay (mirrors brush footprint at canvas-pixel coords).
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(false);
  const cursorRafRef = useRef<number | null>(null);

  // Compute fit-to-viewport zoom on dim changes (preserved from original).
  useEffect(() => {
    const maxEditorPx = Math.min(window.innerWidth - 200, window.innerHeight - 200, 640);
    const idealZoom = Math.floor(maxEditorPx / Math.max(frameWidth, frameHeight));
    setZoom(Math.max(4, Math.min(16, idealZoom)));
  }, [frameWidth, frameHeight]);

  // Load frame pixels into the store + extract palette. Reset store on unmount
  // so a fresh editor open gets a clean slate.
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

      const colors = new Set<string>();
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i + 3] < 10) continue;
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        colors.add(
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
        );
      }
      setPalette(Array.from(colors).slice(0, 32));

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

    // 1:1 staging canvas: putImageData then drawImage with smoothing off
    // gives us nearest-neighbour scaling for the zoomed editor canvas.
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
      // Cursor footprint overlay tracking — rAF-throttled so high-rate
      // pointer events don't flood React state updates.
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

  const doSaveAndClose = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (dataUrl) onSave(dataUrl);
    onClose();
  }, [renderToDataUrl, onSave, onClose]);

  // Central close gating — every close path routes through here so isDirty
  // can short-circuit straight to the confirm modal.
  const attemptClose = useCallback(() => {
    if (isDirty) {
      setConfirmOpen(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  // beforeunload guard — only registered while dirty so we don't pollute
  // navigation on a clean editor session.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Hotkeys — Wave 1 binds without scopes. Bindings live for the editor's
  // lifetime, which is exactly the duration the editor is mounted. Esc is
  // handled by HeadlessUI's Dialog (routes to onClose → attemptClose), so
  // no useHotkeys('escape') here. Brush cycling clamps at boundaries.
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

  useHotkeys('[', () => cycleBrushSize(-1));
  useHotkeys(']', () => cycleBrushSize(+1));
  useHotkeys('-', () => cycleBrushSize(-1));
  useHotkeys('=', () => cycleBrushSize(+1));
  useHotkeys('mod+z', (e) => { e.preventDefault(); undo(); });
  useHotkeys('mod+shift+z', (e) => { e.preventDefault(); redo(); });

  const toolButtons: Array<{ id: Tool; icon: typeof Pencil; label: string }> = [
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  ];

  return (
    <>
      <Dialog open onClose={attemptClose} className="relative z-[100]">
        <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl flex flex-col max-h-[90vh] max-w-[90vw] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <h2 className="text-sm font-mono font-semibold text-text-primary">
                Pixel Editor
                <span className="ml-2 text-text-muted font-normal">
                  {frameWidth}x{frameHeight}
                </span>
              </h2>
              <button
                onClick={attemptClose}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Toolbar */}
              <div className="flex flex-col gap-2 p-3 border-r border-border-default bg-bg-secondary">
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

                {/* Brush size chips */}
                <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider text-center">
                  Brush
                </div>
                <div className="grid grid-cols-2 gap-1">
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

                <div className="w-full h-px bg-border-subtle my-1" />

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
              <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4 overflow-auto bg-bg-primary relative">
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
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
              <Button variant="ghost" size="sm" onClick={attemptClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={doSaveAndClose}>
                <Save size={14} />
                Save
              </Button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      {/* Nested confirm-discard dialog. HeadlessUI handles nested dialogs:
          its Esc handler will close THIS dialog first (return to editor),
          not the outer one. */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        className="relative z-[110]"
      >
        <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4">
            <div>
              <Dialog.Title className="text-sm font-mono font-semibold text-text-primary">
                Unsaved changes
              </Dialog.Title>
              <p className="text-xs font-mono text-text-muted mt-1.5">
                You have unsaved pixel edits. What would you like to do?
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <button
                autoFocus
                onClick={() => setConfirmOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                  bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle"
              >
                Keep editing
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  onClose();
                }}
                className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                  bg-red-600 hover:bg-red-700 text-white"
              >
                Discard changes
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  doSaveAndClose();
                }}
                className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                  bg-accent-amber text-bg-primary hover:bg-accent-amber-strong"
              >
                Save and close
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
