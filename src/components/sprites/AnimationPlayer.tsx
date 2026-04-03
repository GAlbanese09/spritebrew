'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
import type { SpriteAnimation } from '@/lib/types';
import Button from '@/components/ui/Button';

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2] as const;
const ZOOM_OPTIONS = [1, 2, 4, 8, 16] as const;

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

  const [selectedAnimId, setSelectedAnimId] = useState<string>('');
  const [playing, setPlaying] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(8);
  const [bgMode, setBgMode] = useState<BgMode>('checkerboard');
  const [customBgColor, setCustomBgColor] = useState('#808080');
  const [pingPong, setPingPong] = useState(false);
  const [loop, setLoop] = useState(true);

  // Track ping-pong direction: 1 = forward, -1 = backward
  const pingPongDirRef = useRef(1);
  const lastTimeRef = useRef(0);
  const accumRef = useRef(0);

  // Pick the active animation
  const anim: SpriteAnimation | undefined =
    animations.find((a) => a.id === selectedAnimId) ?? animations[0];

  // Auto-select first animation
  useEffect(() => {
    if (animations.length > 0 && !animations.find((a) => a.id === selectedAnimId)) {
      setSelectedAnimId(animations[0].id);
    }
  }, [animations, selectedAnimId]);

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
      if (!canvas || !anim || anim.frames.length === 0) return;

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

  // Draw when frame changes while paused
  useEffect(() => {
    if (!playing) drawFrame(currentFrame);
  }, [currentFrame, playing, drawFrame]);

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
      {animations.length > 1 && (
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-1 uppercase tracking-wider">
            Animation
          </label>
          <select
            value={selectedAnimId}
            onChange={(e) => {
              setSelectedAnimId(e.target.value);
              setCurrentFrame(0);
              pingPongDirRef.current = 1;
            }}
            className="w-full max-w-xs rounded bg-bg-elevated border border-border-default px-3 py-2
              text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber cursor-pointer"
          >
            {animations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.frames.length} frames, {a.fps} fps)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Canvas */}
      <div className="flex justify-center">
        <div className="rounded-lg border border-border-default bg-bg-elevated p-3 inline-block">
          <canvas
            ref={canvasRef}
            style={{ imageRendering: 'pixelated', display: 'block' }}
          />
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="sm" onClick={handleStepBack} title="Step back">
          <SkipBack size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleStop} title="Stop">
          <Square size={14} />
        </Button>
        <Button
          variant={playing ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => setPlaying(!playing)}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleStepForward} title="Step forward">
          <SkipForward size={14} />
        </Button>

        <span className="mx-2 text-[10px] font-mono text-text-muted">|</span>

        <Button
          variant={loop ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setLoop(!loop)}
          title="Loop"
        >
          <Repeat size={14} />
        </Button>
        <Button
          variant={pingPong ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setPingPong(!pingPong)}
          title="Ping-pong"
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
          <label className="block text-[10px] font-mono text-text-muted mb-1 text-center uppercase tracking-wider">
            Speed
          </label>
          <div className="flex gap-1">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
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
          <label className="block text-[10px] font-mono text-text-muted mb-1 text-center uppercase tracking-wider">
            Zoom
          </label>
          <div className="flex gap-1">
            {ZOOM_OPTIONS.map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
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
          <label className="block text-[10px] font-mono text-text-muted mb-1 text-center uppercase tracking-wider">
            Background
          </label>
          <div className="flex gap-1 items-center">
            {([
              { id: 'checkerboard', label: '🏁' },
              { id: 'black', label: '⬛' },
              { id: 'white', label: '⬜' },
              { id: 'green', label: '🟩' },
            ] as const).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setBgMode(id)}
                className={`px-2 py-1 rounded text-[10px] cursor-pointer transition-colors
                  ${bgMode === id
                    ? 'bg-accent-amber text-bg-primary ring-1 ring-accent-amber'
                    : 'bg-bg-elevated hover:bg-bg-hover border border-border-subtle'
                  }`}
                title={id}
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
                className="w-6 h-6 rounded cursor-pointer border border-border-default"
                title="Custom color"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
