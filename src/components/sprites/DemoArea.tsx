'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Application,
  AnimatedSprite,
  Texture,
  TilingSprite,
  TextureSource,
} from 'pixi.js';
import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { DEMO_CONTROLS } from '@/lib/constants';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteAnimation } from '@/lib/types';

// Force nearest-neighbor globally for pixel art
TextureSource.defaultOptions.scaleMode = 'nearest';

type CharState = 'idle' | 'walking' | 'running' | 'attacking' | 'jumping' | 'hurt';
type BgPreset = 'grid' | 'grass' | 'dungeon' | 'black' | 'white';

const CANVAS_W = 640;
const CANVAS_H = 480;
const WALK_SPEED = 2;
const RUN_SPEED = 4;

const ANIM_TYPE_PRIORITY: Record<string, CharState> = {
  idle: 'idle',
  walk: 'walking',
  run: 'running',
  attack: 'attacking',
  jump: 'jumping',
  hurt: 'hurt',
};

interface DemoAreaProps {
  frameDataUrls: Map<string, string>;
}

export default function DemoArea({ frameDataUrls }: DemoAreaProps) {
  const animations = useSpriteStore((s) => s.animations);
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);

  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spritesRef = useRef<Map<string, AnimatedSprite>>(new Map());
  const bgSpriteRef = useRef<TilingSprite | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const stateRef = useRef<CharState>('idle');
  const posRef = useRef({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
  const facingRef = useRef<1 | -1>(1);
  const lockedRef = useRef(false); // locked during one-shot animations

  const [focused, setFocused] = useState(false);
  const [bgPreset, setBgPreset] = useState<BgPreset>('grid');
  const [showOverlay, setShowOverlay] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [overlayInfo, setOverlayInfo] = useState({
    animation: 'idle',
    state: 'idle' as CharState,
    x: 0,
    y: 0,
    fps: 0,
  });

  // Map animation type names to store animations
  const animMap = useRef<Map<CharState, SpriteAnimation>>(new Map());

  useEffect(() => {
    const map = new Map<CharState, SpriteAnimation>();
    for (const a of animations) {
      const state = ANIM_TYPE_PRIORITY[a.type];
      if (state && !map.has(state)) {
        map.set(state, a);
      }
    }
    // Fallback: if no idle, use first animation
    if (!map.has('idle') && animations.length > 0) {
      map.set('idle', animations[0]);
    }
    animMap.current = map;
  }, [animations]);

  // Get best animation for a state, with fallbacks
  const getAnimForState = useCallback(
    (state: CharState): SpriteAnimation | null => {
      const map = animMap.current;
      if (map.has(state)) return map.get(state)!;
      // Fallbacks
      if (state === 'running') return map.get('walking') ?? map.get('idle') ?? null;
      if (state === 'attacking' || state === 'jumping' || state === 'hurt')
        return map.get('idle') ?? null;
      return map.get('idle') ?? null;
    },
    []
  );

  // Create a background texture canvas
  const createBgCanvas = useCallback((preset: BgPreset): HTMLCanvasElement => {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    switch (preset) {
      case 'grid': {
        const half = size / 2;
        ctx.fillStyle = '#1e1b18';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#252220';
        ctx.fillRect(0, 0, half, half);
        ctx.fillRect(half, half, half, half);
        break;
      }
      case 'grass': {
        ctx.fillStyle = '#2d5a1e';
        ctx.fillRect(0, 0, size, size);
        // Simple grass detail
        ctx.fillStyle = '#3a7228';
        for (let i = 0; i < 6; i++) {
          const gx = (i * 7 + 3) % size;
          const gy = (i * 11 + 5) % size;
          ctx.fillRect(gx, gy, 2, 2);
        }
        ctx.fillStyle = '#245016';
        for (let i = 0; i < 4; i++) {
          const gx = (i * 9 + 1) % size;
          const gy = (i * 13 + 2) % size;
          ctx.fillRect(gx, gy, 1, 1);
        }
        break;
      }
      case 'dungeon': {
        ctx.fillStyle = '#1a1510';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#2a221a';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
        // Brick pattern
        ctx.fillStyle = '#221c14';
        ctx.fillRect(0, 0, size, 1);
        ctx.fillRect(size / 2, size / 2, 1, size / 2);
        break;
      }
      case 'black': {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);
        break;
      }
      case 'white': {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        break;
      }
    }
    return canvas;
  }, []);

  // Initialize PixiJS
  useEffect(() => {
    if (!containerRef.current || animations.length === 0) return;

    let destroyed = false;
    const app = new Application();

    const init = async () => {
      await app.init({
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundColor: 0x121010,
        resolution: 1,
        antialias: false,
        canvas: document.createElement('canvas'),
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      appRef.current = app;

      // Style the canvas
      const cv = app.canvas as HTMLCanvasElement;
      cv.style.imageRendering = 'pixelated';
      cv.style.display = 'block';
      cv.style.width = `${CANVAS_W}px`;
      cv.style.height = `${CANVAS_H}px`;
      cv.style.outline = 'none';
      cv.tabIndex = 0;

      // Focus management
      cv.addEventListener('focus', () => setFocused(true));
      cv.addEventListener('blur', () => setFocused(false));

      containerRef.current!.innerHTML = '';
      containerRef.current!.appendChild(cv);

      // Background
      const bgCanvas = createBgCanvas(bgPreset);
      const bgTexture = Texture.from(bgCanvas);
      const bgSprite = new TilingSprite({
        texture: bgTexture,
        width: CANVAS_W,
        height: CANVAS_H,
      });
      app.stage.addChild(bgSprite);
      bgSpriteRef.current = bgSprite;

      // Load textures for each animation
      const spriteMap = new Map<string, AnimatedSprite>();
      const frameW = spriteSheet?.frameWidth ?? 32;
      const frameH = spriteSheet?.frameHeight ?? 32;
      const spriteScale = Math.min(8, Math.max(4, Math.floor(160 / Math.max(frameW, frameH))));

      for (const anim of animations) {
        if (anim.frames.length === 0) continue;

        const textures: Texture[] = [];
        for (const frame of anim.frames) {
          const url = frameDataUrls.get(frame.id);
          if (!url) continue;

          // Load the data URL as a texture
          const img = new Image();
          img.src = url;
          await new Promise<void>((r) => {
            img.onload = () => r();
            img.onerror = () => r();
          });
          const tex = Texture.from(img);
          textures.push(tex);
        }

        if (textures.length === 0) continue;

        const animSprite = new AnimatedSprite(textures);
        animSprite.anchor.set(0.5, 0.5);
        animSprite.x = Math.round(posRef.current.x);
        animSprite.y = Math.round(posRef.current.y);
        animSprite.scale.set(spriteScale);
        animSprite.animationSpeed = anim.fps / 60;
        animSprite.loop = true;
        animSprite.visible = false;
        animSprite.play();

        app.stage.addChild(animSprite);
        spriteMap.set(anim.id, animSprite);
      }

      spritesRef.current = spriteMap;

      // Show initial animation (idle or first)
      const idleAnim = getAnimForState('idle');
      if (idleAnim) {
        const s = spriteMap.get(idleAnim.id);
        if (s) s.visible = true;
      }

      // Game loop
      let lastFpsTime = performance.now();
      let fpsFrameCount = 0;
      let currentFps = 0;

      app.ticker.add(() => {
        if (destroyed) return;

        // FPS counter
        fpsFrameCount++;
        const now = performance.now();
        if (now - lastFpsTime >= 1000) {
          currentFps = fpsFrameCount;
          fpsFrameCount = 0;
          lastFpsTime = now;
        }

        const keys = keysRef.current;
        const prevState = stateRef.current;

        // Don't process movement input if locked into one-shot
        if (!lockedRef.current) {
          // Determine direction and movement
          let dx = 0;
          let dy = 0;
          const left =
            keys.has('ArrowLeft') || keys.has('a');
          const right =
            keys.has('ArrowRight') || keys.has('d');
          const up =
            keys.has('ArrowUp') || keys.has('w');
          const down =
            keys.has('ArrowDown') || keys.has('s');
          const shifting = keys.has('Shift');

          if (left) dx -= 1;
          if (right) dx += 1;
          if (up) dy -= 1;
          if (down) dy += 1;

          if (dx !== 0 || dy !== 0) {
            const isRunning = shifting;
            const speed = isRunning ? RUN_SPEED : WALK_SPEED;
            // Normalize diagonal
            const len = Math.sqrt(dx * dx + dy * dy);
            posRef.current.x += Math.round((dx / len) * speed);
            posRef.current.y += Math.round((dy / len) * speed);

            // Clamp to canvas
            posRef.current.x = Math.max(0, Math.min(CANVAS_W, posRef.current.x));
            posRef.current.y = Math.max(0, Math.min(CANVAS_H, posRef.current.y));

            // Facing
            if (dx < 0) facingRef.current = -1;
            if (dx > 0) facingRef.current = 1;

            stateRef.current = isRunning ? 'running' : 'walking';
          } else {
            stateRef.current = 'idle';
          }
        }

        // Resolve which animation to show
        const targetAnim = getAnimForState(stateRef.current);
        const currentState = stateRef.current;

        // Hide all, show active
        for (const [animId, sprite] of spriteMap) {
          const isActive = targetAnim?.id === animId;
          sprite.visible = isActive;
          if (isActive) {
            sprite.x = Math.round(posRef.current.x);
            sprite.y = Math.round(posRef.current.y);
            const absScale = Math.abs(sprite.scale.x);
            sprite.scale.x = facingRef.current * absScale;

            // Update animation speed from store
            const storeAnim = animations.find((a) => a.id === animId);
            if (storeAnim) {
              sprite.animationSpeed = storeAnim.fps / 60;
            }
          }
        }

        // If state changed, restart the new animation
        if (currentState !== prevState && targetAnim) {
          const s = spriteMap.get(targetAnim.id);
          if (s) {
            s.gotoAndPlay(0);
          }
        }

        // Update overlay
        setOverlayInfo({
          animation: targetAnim?.name ?? 'none',
          state: currentState,
          x: posRef.current.x,
          y: posRef.current.y,
          fps: currentFps,
        });
      });

      // Focus canvas automatically
      cv.focus();
    };

    init();

    return () => {
      destroyed = true;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      spritesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animations, frameDataUrls, spriteSheet]);

  // Update background when preset changes
  useEffect(() => {
    const bgSprite = bgSpriteRef.current;
    if (!bgSprite) return;
    const bgCanvas = createBgCanvas(bgPreset);
    bgSprite.texture = Texture.from(bgCanvas);
  }, [bgPreset, createBgCanvas]);

  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focused) return;

      // Prevent scrolling
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      keysRef.current.add(e.key);

      // Toggle overlay
      if (e.key === 'h' || e.key === 'H') {
        setShowOverlay((v) => !v);
        return;
      }

      // Reset position
      if (e.key === 'r' || e.key === 'R') {
        posRef.current = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
        return;
      }

      // One-shot animations
      if (!lockedRef.current) {
        if (e.key === ' ') {
          triggerOneShot('attacking');
        } else if (e.key === 'z' || e.key === 'Z') {
          triggerOneShot('jumping');
        } else if (e.key === 'x' || e.key === 'X') {
          triggerOneShot('hurt');
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const triggerOneShot = useCallback(
    (state: CharState) => {
      const anim = getAnimForState(state);
      if (!anim) return;

      stateRef.current = state;
      lockedRef.current = true;

      const sprite = spritesRef.current.get(anim.id);
      if (sprite) {
        sprite.loop = false;
        sprite.gotoAndPlay(0);
        sprite.onComplete = () => {
          sprite.loop = true;
          lockedRef.current = false;
          stateRef.current = 'idle';
        };
      } else {
        // No sprite for this state — unlock immediately
        const frameDuration = (anim.frames.length / anim.fps) * 1000;
        setTimeout(() => {
          lockedRef.current = false;
          stateRef.current = 'idle';
        }, frameDuration);
      }
    },
    [getAnimForState]
  );

  if (animations.length === 0 || animations.every((a) => a.frames.length === 0)) {
    return (
      <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-12 text-center">
        <p className="text-sm font-mono text-text-muted">
          Upload and slice a sprite sheet first, then assign animations to preview them here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Canvas container */}
      <div
        className={`relative rounded-lg border-2 overflow-hidden inline-block transition-colors ${
          focused ? 'border-accent-amber glow-amber' : 'border-border-default'
        }`}
      >
        <div ref={containerRef} style={{ width: CANVAS_W, height: CANVAS_H }} />

        {/* Info overlay */}
        {showOverlay && (
          <div className="absolute top-2 left-2 rounded bg-black/70 px-3 py-2 pointer-events-none">
            <p className="text-[10px] font-mono text-accent-amber">
              {overlayInfo.animation}
            </p>
            <p className="text-[10px] font-mono text-text-muted">
              State: {overlayInfo.state}
            </p>
            <p className="text-[10px] font-mono text-text-muted">
              Pos: {overlayInfo.x}, {overlayInfo.y}
            </p>
            <p className="text-[10px] font-mono text-text-muted">
              FPS: {overlayInfo.fps}
            </p>
          </div>
        )}

        {/* Click-to-focus hint */}
        {!focused && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
            <p className="text-sm font-mono text-text-primary bg-black/60 px-4 py-2 rounded">
              Click to focus &middot; Use keyboard to control
            </p>
          </div>
        )}
      </div>

      {/* Background selector */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
          Background
        </label>
        {([
          { id: 'grid', label: 'Grid' },
          { id: 'grass', label: 'Grass' },
          { id: 'dungeon', label: 'Dungeon' },
          { id: 'black', label: 'Black' },
          { id: 'white', label: 'White' },
        ] as const).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setBgPreset(id)}
            className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
              ${bgPreset === id
                ? 'bg-accent-amber text-bg-primary'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
              }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setShowOverlay((v) => !v)}
          className="ml-auto p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
          title={showOverlay ? 'Hide overlay (H)' : 'Show overlay (H)'}
        >
          {showOverlay ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>

      {/* Controls reference */}
      <div className="rounded-lg border border-border-default bg-bg-surface">
        <button
          onClick={() => setShowControls((v) => !v)}
          className="flex items-center justify-between w-full px-4 py-3 text-xs font-mono
            text-text-secondary uppercase tracking-wider cursor-pointer hover:bg-bg-hover"
        >
          Keyboard Controls
          {showControls ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showControls && (
          <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(DEMO_CONTROLS).map(([action, config]) => (
              <div key={action} className="flex items-center gap-3">
                <div className="flex gap-1 flex-shrink-0">
                  {config.keys.slice(0, 2).map((key) => (
                    <kbd
                      key={key}
                      className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5
                        rounded bg-bg-elevated border border-border-default text-[10px] font-mono text-text-primary"
                    >
                      {(key as string).replace('Arrow', '').slice(0, 5)}
                    </kbd>
                  ))}
                  {'alt' in config && (
                    <>
                      <span className="text-[10px] text-text-muted">/</span>
                      {(config.alt as readonly string[]).slice(0, 2).map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5
                            rounded bg-bg-elevated border border-border-default text-[10px] font-mono text-text-primary"
                        >
                          {key}
                        </kbd>
                      ))}
                    </>
                  )}
                </div>
                <span className="text-[10px] font-mono text-text-muted">
                  {config.description}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <kbd
                className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5
                  rounded bg-bg-elevated border border-border-default text-[10px] font-mono text-text-primary"
              >
                H
              </kbd>
              <span className="text-[10px] font-mono text-text-muted">
                Toggle info overlay
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
