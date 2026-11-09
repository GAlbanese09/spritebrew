'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Repeat,
  ArrowLeftRight,
} from 'lucide-react';
import { useSpriteStore } from '@/stores/spriteStore';
import { useStagePinch } from '@/hooks/useStagePinch';
import { fitZoomToBox, snapZoom, stepZoom } from '@/lib/stageZoom';
import type { SpriteAnimation } from '@/lib/types';
import Button from '@/components/ui/Button';

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;
const ZOOM_OPTIONS = [1, 2, 4, 8, 16] as const;

// Touch size for the control chips: 44 px tall, 12 px text on a coarse
// pointer; desktop keeps its compact chips.
const TOUCH_CHIP = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-3 pointer-coarse:text-xs';
const TOUCH_LABEL = 'pointer-coarse:text-xs';
// 44 px on a coarse pointer at every width for the transport buttons (Button's
// own floor stops at md).
const TOUCH_BUTTON = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';
// The canvas box's padding (p-3) and border, in CSS px, around the canvas.
const BOX_PAD = 12;
const BOX_INSET = 2 * (BOX_PAD + 1);
// After the first fit, the row must change width by more than this to fit
// again. A scrollbar (about 15 px) coming and going stays under it, so it
// cannot flip the zoom back and forth.
const REFIT_PX = 24;

// The platform's scrollbar thickness, from an off-screen probe, measured once.
// It is 0 where scrollbars overlay the page (phones, most Macs).
let scrollbarPx: number | null = null;
function scrollbarThickness(): number {
  if (scrollbarPx === null) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow:scroll';
    document.body.appendChild(probe);
    scrollbarPx = probe.offsetWidth - probe.clientWidth;
    probe.remove();
  }
  return scrollbarPx;
}

/**
 * The width the fit may use: the row's width, less the scrollbar's thickness
 * when the page's <main> shows no scrollbar yet (mainBarPx is 0), so a fitted
 * zoom that makes <main> gain its bar still fits. A bar already showing has
 * taken its room, so nothing is subtracted then.
 */
export function fitRoomWidth(rowWidth: number, thickness: number, mainBarPx: number): number {
  return mainBarPx > 0 ? rowWidth : rowWidth - thickness;
}

type BgMode = 'checkerboard' | 'black' | 'white' | 'green' | 'custom';

interface AnimationPlayerProps {
  /** If provided, load frame images from this map; otherwise nothing renders */
  frameDataUrls: Map<string, string>;
}

export default function AnimationPlayer({ frameDataUrls }: AnimationPlayerProps) {
  const animations = useSpriteStore((s) => s.animations);
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const frameImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  // The row the canvas box sits in, measured for the fitting zoom, and the
  // box itself, which pinches and scrolls.
  const rowRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pinchStartRef = useRef(8);
  // The zoom as of the last handler, ahead of the render, so two wheel notches
  // before a render make two steps.
  const zoomRef = useRef<number | null>(null);
  // The row width the last fit used.
  const fitWidthRef = useRef(0);
  // The canvas point at the box's visible middle, saved before a zoom change
  // and restored after the canvas resizes.
  const centerRef = useRef<{ x: number; y: number } | null>(null);

  const [selectedAnimId, setSelectedAnimId] = useState<string>('');
  const [playing, setPlaying] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [speed, setSpeed] = useState(1);
  // Fit on open: the largest zoom whose frame fits the box's width and 60% of
  // the viewport height, until the person picks a zoom; theirs is kept. No
  // frame is drawn, and the canvas stays hidden, before the box is measured.
  const [fittedZoom, setFittedZoom] = useState<number | null>(null);
  const [pickedZoom, setPickedZoom] = useState<number | null>(null);
  const zoom = pickedZoom ?? fittedZoom;
  const [bgMode, setBgMode] = useState<BgMode>('checkerboard');
  const [customBgColor, setCustomBgColor] = useState('#808080');
  const [pingPong, setPingPong] = useState(false);
  const [loop, setLoop] = useState(true);

  // Track ping-pong direction: 1 = forward, -1 = backward
  const pingPongDirRef = useRef(1);
  const lastTimeRef = useRef(0);
  const accumRef = useRef(0);

  // Pick the active animation: only animations with frames can play, so an
  // empty one (an Idle group with nothing in it) is skipped.
  const playable = useMemo(() => animations.filter((a) => a.frames.length > 0), [animations]);
  const anim: SpriteAnimation | undefined =
    playable.find((a) => a.id === selectedAnimId) ?? playable[0];
  const frameW = spriteSheet?.frameWidth ?? anim?.frames[0]?.width ?? 0;
  const frameH = spriteSheet?.frameHeight ?? anim?.frames[0]?.height ?? 0;
  const hasFrames = !!anim && anim.frames.length > 0;

  // Fit once, before paint, when the frame size is known and the row first
  // measured; again when the frame size changes; and otherwise only when the
  // row's width changes by more than REFIT_PX (height alone never refits).
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !(frameW > 0) || !(frameH > 0)) return;
    const fit = (width: number) => {
      fitWidthRef.current = width;
      const main = row.closest('main');
      const mainBarPx = main ? main.offsetWidth - main.clientWidth : 0;
      const room = fitRoomWidth(width, scrollbarThickness(), mainBarPx);
      setFittedZoom(fitZoomToBox(frameW, frameH, room - BOX_INSET, window.innerHeight * 0.6, ZOOM_OPTIONS));
    };
    fit(row.clientWidth);
    const ro = new ResizeObserver(() => {
      const width = row.clientWidth;
      if (Math.abs(width - fitWidthRef.current) > REFIT_PX) fit(width);
    });
    ro.observe(row);
    return () => ro.disconnect();
  }, [frameW, frameH, hasFrames]);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // A picked zoom: saves the canvas point at the box's visible middle, so the
  // layout effect below keeps it there after the canvas resizes.
  const pickZoom = (next: number) => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (box && canvas && canvas.width > 0 && canvas.height > 0 && zoomRef.current !== null) {
      centerRef.current = {
        x: (box.scrollLeft + box.clientWidth / 2 - BOX_PAD) / canvas.width,
        y: (box.scrollTop + box.clientHeight / 2 - BOX_PAD) / canvas.height,
      };
    }
    zoomRef.current = next;
    setPickedZoom(next);
  };

  // Pinch or ctrl or cmd wheel on the canvas steps through the zoom options;
  // the page still zooms everywhere else.
  useStagePinch(boxRef, {
    onPinchStart: () => { pinchStartRef.current = zoomRef.current ?? 8; },
    onPinch: (gestureScale) => {
      const next = snapZoom(pinchStartRef.current, gestureScale, ZOOM_OPTIONS);
      if (next !== zoomRef.current) pickZoom(next);
    },
    onWheelStep: (direction) => {
      if (zoomRef.current === null) return;
      const next = stepZoom(zoomRef.current, direction, ZOOM_OPTIONS);
      if (next !== zoomRef.current) pickZoom(next);
    },
  });

  // Preload frame images
  useEffect(() => {
    const loaded = new Map<string, HTMLImageElement>();
    let cancelled = false;

    const loadAll = async () => {
      for (const [id, url] of frameDataUrls) {
        if (cancelled) return;
        const img = new Image();
        img.src = url;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        loaded.set(id, img);
      }
      if (!cancelled) {
        frameImagesRef.current = loaded;
      }
    };

    loadAll();
    return () => { cancelled = true; };
  }, [frameDataUrls]);

  // Draw a single frame
  const drawFrame = useCallback(
    (frameIdx: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !anim || anim.frames.length === 0 || zoom === null) return;

      const frame = anim.frames[frameIdx];
      if (!frame) return;

      const fw = spriteSheet?.frameWidth ?? frame.width;
      const fh = spriteSheet?.frameHeight ?? frame.height;
      const w = fw * zoom;
      const h = fh * zoom;

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;

      // Background
      if (bgMode === 'checkerboard') {
        const tileSize = Math.max(8, zoom);
        for (let y = 0; y < h; y += tileSize) {
          for (let x = 0; x < w; x += tileSize) {
            const isLight = ((x / tileSize) + (y / tileSize)) % 2 === 0;
            ctx.fillStyle = isLight ? '#ffffff' : '#e0e0e0';
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
      } else if (bgMode === 'custom') {
        ctx.fillStyle = customBgColor;
        ctx.fillRect(0, 0, w, h);
      } else {
        const colors: Record<string, string> = {
          black: '#000000',
          white: '#ffffff',
          green: '#00ff00',
        };
        ctx.fillStyle = colors[bgMode];
        ctx.fillRect(0, 0, w, h);
      }

      // Draw sprite
      const img = frameImagesRef.current.get(frame.id);
      if (img) {
        ctx.drawImage(img, 0, 0, w, h);
      }
    },
    [anim, spriteSheet, zoom, bgMode, customBgColor]
  );

  // Animation loop
  useEffect(() => {
    if (!anim || anim.frames.length === 0) return;

    lastTimeRef.current = 0;
    accumRef.current = 0;
    pingPongDirRef.current = 1;

    const tick = (timestamp: number) => {
      if (!playing) {
        drawFrame(currentFrame);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }

      const delta = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;
      accumRef.current += delta;

      const msPerFrame = 1000 / (anim.fps * speed);

      if (accumRef.current >= msPerFrame) {
        accumRef.current -= msPerFrame;

        setCurrentFrame((prev) => {
          const total = anim.frames.length;
          if (total <= 1) return 0;

          if (pingPong) {
            let next = prev + pingPongDirRef.current;
            if (next >= total) {
              pingPongDirRef.current = -1;
              next = total - 2;
            } else if (next < 0) {
              if (!loop) return 0;
              pingPongDirRef.current = 1;
              next = 1;
            }
            return Math.max(0, Math.min(total - 1, next));
          }

          const next = prev + 1;
          if (next >= total) {
            return loop ? 0 : total - 1;
          }
          return next;
        });
      }

      drawFrame(currentFrame);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [anim, playing, speed, pingPong, loop, currentFrame, drawFrame]);

  // Draw before paint whenever the frame, zoom or background changes, so a
  // new canvas size is never painted blank; the loop keeps drawing while
  // playing.
  useLayoutEffect(() => {
    drawFrame(currentFrame);
  }, [currentFrame, drawFrame]);

  // After a zoom change, put the saved middle back in the middle of the box.
  // The first fit has nothing saved, so it opens at scroll 0.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const center = centerRef.current;
    centerRef.current = null;
    if (!box || !canvas || !center) return;
    box.scrollLeft = center.x * canvas.width + BOX_PAD - box.clientWidth / 2;
    box.scrollTop = center.y * canvas.height + BOX_PAD - box.clientHeight / 2;
  }, [zoom]);

  const handleStop = () => {
    setPlaying(false);
    setCurrentFrame(0);
    pingPongDirRef.current = 1;
  };

  const handleStepBack = () => {
    setPlaying(false);
    setCurrentFrame((prev) => {
      const total = anim?.frames.length ?? 1;
      return prev > 0 ? prev - 1 : total - 1;
    });
  };

  const handleStepForward = () => {
    setPlaying(false);
    setCurrentFrame((prev) => {
      const total = anim?.frames.length ?? 1;
      return prev < total - 1 ? prev + 1 : 0;
    });
  };

  if (!anim || anim.frames.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-12 text-center">
        <p className="text-sm font-mono text-text-muted">
          No animation frames to preview.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Animation selector */}
      {playable.length > 1 && (
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-1 uppercase tracking-wider">
            Animation
          </label>
          <select
            value={anim.id}
            onChange={(e) => {
              setSelectedAnimId(e.target.value);
              setCurrentFrame(0);
              pingPongDirRef.current = 1;
            }}
            className="w-full max-w-xs rounded bg-bg-elevated border border-border-default px-3 py-2 pointer-coarse:min-h-11
              text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber cursor-pointer"
          >
            {playable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.frames.length} frames, {a.fps} fps)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Canvas: drawn at its real zoom. A zoom wider or taller than the box
          scrolls inside the box (one finger pans it) instead of shrinking the
          canvas, so a bigger zoom is really bigger. The box takes one-finger
          pans in both directions but no browser pinch: that one zooms the
          canvas (useStagePinch). It takes focus, so arrow keys scroll it in
          every browser, Safari included. */}
      <div ref={rowRef} className="flex justify-center w-full">
        <div
          ref={boxRef}
          tabIndex={0}
          role="region"
          aria-label="Animation preview (scroll when zoomed in)"
          className="rounded-lg border border-border-default bg-bg-elevated p-3 max-w-full overflow-auto
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber"
          style={{ maxHeight: '70vh', touchAction: 'pan-x pan-y' }}
        >
          <canvas
            ref={canvasRef}
            className="pixel-art-render"
            style={{
              imageRendering: 'pixelated',
              display: 'block',
              visibility: zoom === null ? 'hidden' : undefined,
            }}
          />
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="sm" className={TOUCH_BUTTON} onClick={handleStepBack} title="Step back" aria-label="Step back">
          <SkipBack size={14} />
        </Button>
        <Button variant="ghost" size="sm" className={TOUCH_BUTTON} onClick={handleStop} title="Stop" aria-label="Stop">
          <Square size={14} />
        </Button>
        <Button
          variant={playing ? 'secondary' : 'primary'}
          size="sm"
          className={TOUCH_BUTTON}
          onClick={() => setPlaying(!playing)}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>
        <Button variant="ghost" size="sm" className={TOUCH_BUTTON} onClick={handleStepForward} title="Step forward" aria-label="Step forward">
          <SkipForward size={14} />
        </Button>

        <span className="mx-2 text-[10px] font-mono text-text-muted">|</span>

        <Button
          variant={loop ? 'secondary' : 'ghost'}
          size="sm"
          className={TOUCH_BUTTON}
          onClick={() => setLoop(!loop)}
          title="Loop"
          aria-label="Loop"
          aria-pressed={loop}
        >
          <Repeat size={14} />
        </Button>
        <Button
          variant={pingPong ? 'secondary' : 'ghost'}
          size="sm"
          className={TOUCH_BUTTON}
          onClick={() => setPingPong(!pingPong)}
          title="Ping-pong"
          aria-label="Ping-pong"
          aria-pressed={pingPong}
        >
          <ArrowLeftRight size={14} />
        </Button>
      </div>

      {/* Frame info */}
      <div className="text-center text-xs font-mono text-text-secondary">
        Frame {currentFrame + 1} / {anim.frames.length}
        <span className="mx-2 text-text-muted">&middot;</span>
        {anim.fps} fps
        <span className="mx-2 text-text-muted">&middot;</span>
        {speed}x
      </div>

      {/* Speed, Zoom, Background controls */}
      <div className="flex flex-wrap gap-6 justify-center">
        {/* Speed */}
        <div>
          <label className={`block text-[10px] font-mono text-text-muted mb-1 text-center uppercase tracking-wider ${TOUCH_LABEL}`}>
            Speed
          </label>
          <div className="flex gap-1">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors ${TOUCH_CHIP}
                  ${speed === s
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Zoom */}
        <div>
          <label className={`block text-[10px] font-mono text-text-muted mb-1 text-center uppercase tracking-wider ${TOUCH_LABEL}`}>
            Zoom
          </label>
          <div className="flex gap-1">
            {ZOOM_OPTIONS.map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={zoom === z}
                onClick={() => pickZoom(z)}
                className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors ${TOUCH_CHIP}
                  ${zoom === z
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {z}x
              </button>
            ))}
          </div>
        </div>

        {/* Background */}
        <div>
          <label className={`block text-[10px] font-mono text-text-muted mb-1 text-center uppercase tracking-wider ${TOUCH_LABEL}`}>
            Background
          </label>
          <div className="flex gap-1 items-center">
            {([
              { id: 'checkerboard', label: '🏁', name: 'Checkerboard background' },
              { id: 'black', label: '⬛', name: 'Black background' },
              { id: 'white', label: '⬜', name: 'White background' },
              { id: 'green', label: '🟩', name: 'Green background' },
            ] as const).map(({ id, label, name }) => (
              <button
                key={id}
                type="button"
                aria-pressed={bgMode === id}
                onClick={() => setBgMode(id)}
                className={`px-2 py-1 rounded text-[10px] cursor-pointer transition-colors ${TOUCH_CHIP}
                  ${bgMode === id
                    ? 'bg-accent-amber text-bg-primary ring-1 ring-accent-amber'
                    : 'bg-bg-elevated hover:bg-bg-hover border border-border-subtle'
                  }`}
                title={name}
                aria-label={name}
              >
                {label}
              </button>
            ))}
            <div className="relative">
              <input
                type="color"
                value={customBgColor}
                onChange={(e) => {
                  setCustomBgColor(e.target.value);
                  setBgMode('custom');
                }}
                className="w-6 h-6 pointer-coarse:w-11 pointer-coarse:h-11 rounded cursor-pointer border border-border-default"
                title="Custom color"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
