'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';

export interface SheetLoopGeometry {
  frameW: number;
  frameH: number;
  cols: number;
  rows: number;
  frames: number;
}

interface SheetLoopProps {
  /** Sprite sheet image (data URL or object URL). */
  src: string;
  /** Grid of the sheet; frames are read row-major. */
  geometry: SheetLoopGeometry;
  fps?: number;
  /** False shows the first frame and stops. Defaults to true. */
  playing?: boolean;
  /** Sheet frame indexes (row-major) played in this order. Absent plays
   *  every frame in sheet order. Indexes outside the sheet are skipped. */
  sequence?: number[];
  className?: string;
}

/**
 * Loops a sprite sheet on one canvas the size of one frame, scaled up by
 * CSS to fit its box. Standalone: reads nothing from the sprite store, so
 * it can sit on a result or gallery card without touching the sheet-tools
 * session. Pauses off screen and in a hidden tab. Under
 * prefers-reduced-motion it shows the first frame until the user taps play.
 */
export default function SheetLoop({ src, geometry, fps = 8, playing = true, sequence, className }: SheetLoopProps) {
  const { frameW, frameH, cols, frames } = geometry;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Current step: a position in the play list, not a sheet frame index.
  const frameRef = useRef(0);

  // The play list, keyed by content so a new array with the same frames
  // does not restart the loop. Null plays every frame in sheet order.
  const sequenceKey = sequence ? sequence.join(',') : null;
  const playList = useMemo(
    () =>
      sequenceKey === null
        ? null
        : sequenceKey
            .split(',')
            .filter((part) => part !== '')
            .map(Number)
            .filter((i) => Number.isInteger(i) && i >= 0 && i < frames),
    [sequenceKey, frames]
  );
  const steps = playList ? playList.length : frames;

  // Keyed by src so a new sheet starts unloaded and, under reduced motion,
  // waits for a fresh tap, without resetting state inside an effect.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [startedSrc, setStartedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  const userStarted = startedSrc === src;
  const [onScreen, setOnScreen] = useState(false);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const ioSupported = typeof IntersectionObserver !== 'undefined';

  const drawFrame = useCallback(
    (index: number) => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, frameW, frameH);
      const sx = (index % cols) * frameW;
      const sy = Math.floor(index / cols) * frameH;
      ctx.drawImage(img, sx, sy, frameW, frameH, 0, 0, frameW, frameH);
    },
    [frameW, frameH, cols]
  );

  // Draws the frame at a step of the play list.
  const drawStep = useCallback(
    (step: number) => {
      if (steps < 1) return;
      const s = step % steps;
      drawFrame(playList ? playList[s] : s);
    },
    [steps, playList, drawFrame]
  );

  // A changed play list starts over at its first step. Declared before the
  // still-frame and loop effects so they draw from step 0 in the same commit.
  useEffect(() => {
    frameRef.current = 0;
  }, [playList]);

  // Load the sheet. A new src starts over at frame 1.
  useEffect(() => {
    let cancelled = false;
    frameRef.current = 0;
    imgRef.current = null;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setLoadedSrc(src);
    };
    img.src = src;
    return () => {
      cancelled = true;
      img.onload = null;
    };
  }, [src]);

  // Pause off screen.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setOnScreen(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  // Pause in a hidden tab.
  useEffect(() => {
    const update = () => setTabVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Track prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const active = loaded && playing && (onScreen || !ioSupported) && tabVisible && (!reducedMotion || userStarted);

  // Still frame when not running: the first step when stopped by the caller
  // or by reduced motion, otherwise hold the current step (paused off screen).
  useEffect(() => {
    if (!loaded || active) return;
    if (!playing || (reducedMotion && !userStarted)) frameRef.current = 0;
    drawStep(frameRef.current);
  }, [loaded, active, playing, reducedMotion, userStarted, drawStep]);

  // Animation loop.
  useEffect(() => {
    if (!active || steps < 1) return;
    const step = 1000 / Math.max(1, fps);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    frameRef.current %= steps;
    drawStep(frameRef.current);
    const tick = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= step) {
        const advance = Math.floor(acc / step);
        acc -= advance * step;
        frameRef.current = (frameRef.current + advance) % steps;
        drawStep(frameRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, fps, steps, drawStep]);

  const showPlayButton = loaded && playing && reducedMotion && !userStarted;

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <canvas
        ref={canvasRef}
        width={frameW}
        height={frameH}
        className="block w-full h-full pixel-art-render"
        style={{ imageRendering: 'pixelated', objectFit: 'contain' }}
      />
      {showPlayButton && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setStartedSrc(src);
          }}
          className="absolute inset-0 m-auto w-11 h-11 rounded-full bg-bg-primary/80 hover:bg-bg-primary
            flex items-center justify-center cursor-pointer"
          aria-label="Play animation"
        >
          <Play size={18} className="text-accent-amber" />
        </button>
      )}
    </div>
  );
}
