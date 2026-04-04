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
type Direction = 'up' | 'down' | 'left' | 'right';
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

// ── Directional detection ──

const DIR_KEYWORDS: Record<string, Direction> = {
  up: 'up',
  north: 'up',
  down: 'down',
  south: 'down',
  left: 'left',
  west: 'left',
  right: 'right',
  east: 'right',
};

const ACTION_KEYWORDS: Record<string, CharState> = {
  idle: 'idle',
  walk: 'walking',
  run: 'running',
  attack: 'attacking',
  jump: 'jumping',
  hurt: 'hurt',
};

/**
 * Parse an animation name like "Walk Up", "walk_down", "run_left" into
 * { state, direction } or null if no directional keyword found.
 */
function parseDirectional(name: string): { state: CharState; direction: Direction } | null {
  const normalized = name.toLowerCase().replace(/[_\-]/g, ' ').trim();
  const words = normalized.split(/\s+/);

  let direction: Direction | null = null;
  let state: CharState | null = null;

  for (const word of words) {
    if (!direction && DIR_KEYWORDS[word]) {
      direction = DIR_KEYWORDS[word];
    }
    if (!state && ACTION_KEYWORDS[word]) {
      state = ACTION_KEYWORDS[word];
    }
  }

  if (!direction) return null;
  // Default to walking if we found a direction but no action keyword
  return { state: state ?? 'walking', direction };
}

/**
 * Analyze all animations and determine:
 * - hasDirectional: whether directional variants were detected
 * - dirMap: state+direction → SpriteAnimation
 * - flatMap: state → SpriteAnimation (non-directional fallback)
 */
function buildAnimMaps(animations: SpriteAnimation[]) {
  const dirMap = new Map<string, SpriteAnimation>(); // key: "state:direction"
  const flatMap = new Map<CharState, SpriteAnimation>();
  let hasRealIdle = false; // tracks whether a genuine idle animation exists

  for (const anim of animations) {
    // Try type-based mapping first (from ANIM_TYPE_PRIORITY)
    const typeState = ANIM_TYPE_PRIORITY[anim.type];

    // Try name-based directional parsing
    const parsed = parseDirectional(anim.name);

    if (parsed) {
      const key = `${parsed.state}:${parsed.direction}`;
      if (!dirMap.has(key)) {
        dirMap.set(key, anim);
      }
      if (parsed.state === 'idle') hasRealIdle = true;
    }

    // Also add to flat map for non-directional fallback
    if (typeState && !flatMap.has(typeState)) {
      flatMap.set(typeState, anim);
      if (typeState === 'idle') hasRealIdle = true;
    }
    // Check non-directional idle by name (e.g. animation named "Idle" with no direction)
    if (!parsed && anim.name.toLowerCase().replace(/[_\-]/g, ' ').trim() === 'idle') {
      if (!flatMap.has('idle')) flatMap.set('idle', anim);
      hasRealIdle = true;
    }
    // If the name parses to a state but isn't in the type map, still add to flat
    if (parsed && !flatMap.has(parsed.state)) {
      flatMap.set(parsed.state, anim);
    }
  }

  // Only set a fallback idle if no real idle animation was found.
  // Mark it so getAnimForState knows this is synthetic.
  if (!flatMap.has('idle') && animations.length > 0) {
    flatMap.set('idle', animations[0]);
  }

  const hasDirectional = dirMap.size > 0;

  return { hasDirectional, dirMap, flatMap, hasRealIdle };
}

function dirMapKey(state: CharState, dir: Direction): string {
  return `${state}:${dir}`;
}

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
  const directionRef = useRef<Direction>('down');
  const lockedRef = useRef(false);

  const animMapsRef = useRef<ReturnType<typeof buildAnimMaps>>({
    hasDirectional: false,
    dirMap: new Map(),
    flatMap: new Map(),
    hasRealIdle: false,
  });

  const [focused, setFocused] = useState(false);
  const [bgPreset, setBgPreset] = useState<BgPreset>('grid');
  const [showOverlay, setShowOverlay] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [overlayInfo, setOverlayInfo] = useState({
    animation: 'idle',
    state: 'idle' as CharState,
    direction: 'down' as Direction,
    x: 0,
    y: 0,
    fps: 0,
    directional: false,
  });

  // Build animation maps when animations change
  useEffect(() => {
    animMapsRef.current = buildAnimMaps(animations);
  }, [animations]);

  // Get best animation for a state+direction, with fallbacks.
  const getAnimForState = useCallback(
    (state: CharState, dir: Direction): SpriteAnimation | null => {
      const { hasDirectional, dirMap, flatMap, hasRealIdle } = animMapsRef.current;

      if (hasDirectional) {
        // Try exact state+direction
        const exact = dirMap.get(dirMapKey(state, dir));
        if (exact) return exact;

        // Fallback: running → walking in same direction
        if (state === 'running') {
          const walkDir = dirMap.get(dirMapKey('walking', dir));
          if (walkDir) return walkDir;
        }

        if (state === 'idle') {
          // 1) Try directional idle for all 4 dirs (maybe named differently)
          //    Already tried exact dir above, so this only matters if dir lookup failed.
          // 2) Try generic non-directional idle — but ONLY if it's a real idle,
          //    not the animations[0] fallback which could be "Walk Up"
          if (hasRealIdle) {
            const flat = flatMap.get('idle');
            if (flat) return flat;
          }
          // 3) No idle animation at all — freeze the walk animation for this direction.
          //    The game loop detects this case and calls gotoAndStop(0).
          const walkDir = dirMap.get(dirMapKey('walking', dir));
          if (walkDir) return walkDir;
          // 4) Try any walk animation as last resort
          const anyWalk = flatMap.get('walking');
          if (anyWalk) return anyWalk;
        }

        // For non-idle states: try the state without direction (flat map)
        const flat = flatMap.get(state);
        if (flat) return flat;

        // Fallback to directional idle, then generic idle
        if (state !== 'idle') {
          const idleDir = dirMap.get(dirMapKey('idle', dir));
          if (idleDir) return idleDir;
          if (hasRealIdle) {
            const flatIdle = flatMap.get('idle');
            if (flatIdle) return flatIdle;
          }
        }
      }

      // Non-directional fallbacks (original behavior for side-scroller sheets)
      if (flatMap.has(state)) return flatMap.get(state)!;
      if (state === 'running') return flatMap.get('walking') ?? flatMap.get('idle') ?? null;
      if (state === 'attacking' || state === 'jumping' || state === 'hurt')
        return flatMap.get('idle') ?? null;
      return flatMap.get('idle') ?? null;
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

      const cv = app.canvas as HTMLCanvasElement;
      cv.style.imageRendering = 'pixelated';
      cv.style.display = 'block';
      cv.style.width = `${CANVAS_W}px`;
      cv.style.height = `${CANVAS_H}px`;
      cv.style.outline = 'none';
      cv.tabIndex = 0;

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

      // Show initial animation (idle facing down, or first)
      const idleAnim = getAnimForState('idle', 'down');
      if (idleAnim) {
        const s = spriteMap.get(idleAnim.id);
        if (s) s.visible = true;
      }

      // Track previous resolved anim ID to detect changes
      let prevAnimId: string | null = null;

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
        const { hasDirectional } = animMapsRef.current;

        // Don't process movement input if locked into one-shot
        if (!lockedRef.current) {
          let dx = 0;
          let dy = 0;
          const left = keys.has('ArrowLeft') || keys.has('a');
          const right = keys.has('ArrowRight') || keys.has('d');
          const up = keys.has('ArrowUp') || keys.has('w');
          const down = keys.has('ArrowDown') || keys.has('s');
          const shifting = keys.has('Shift');

          if (left) dx -= 1;
          if (right) dx += 1;
          if (up) dy -= 1;
          if (down) dy += 1;

          if (dx !== 0 || dy !== 0) {
            const isRunning = shifting;
            const speed = isRunning ? RUN_SPEED : WALK_SPEED;
            const len = Math.sqrt(dx * dx + dy * dy);
            posRef.current.x += Math.round((dx / len) * speed);
            posRef.current.y += Math.round((dy / len) * speed);

            posRef.current.x = Math.max(0, Math.min(CANVAS_W, posRef.current.x));
            posRef.current.y = Math.max(0, Math.min(CANVAS_H, posRef.current.y));

            // Update direction
            if (hasDirectional) {
              // Vertical takes priority for top-down RPGs on diagonal
              if (dy < 0) directionRef.current = 'up';
              else if (dy > 0) directionRef.current = 'down';
              else if (dx < 0) directionRef.current = 'left';
              else if (dx > 0) directionRef.current = 'right';
            } else {
              // Non-directional: track left/right facing for flip
              if (dx < 0) facingRef.current = -1;
              if (dx > 0) facingRef.current = 1;
            }

            stateRef.current = isRunning ? 'running' : 'walking';
          } else {
            stateRef.current = 'idle';
          }
        }

        // Resolve which animation to show
        const currentState = stateRef.current;
        const currentDir = directionRef.current;
        const targetAnim = getAnimForState(currentState, currentDir);
        const targetAnimId = targetAnim?.id ?? null;

        // Detect idle-with-walk-fallback: we're idle but using a non-idle anim
        // because no idle animation exists. In this case, freeze on last frame.
        const idleFallback =
          currentState === 'idle' &&
          targetAnim != null &&
          parseDirectional(targetAnim.name)?.state !== 'idle' &&
          targetAnim.type !== 'idle';

        // Hide all, show active
        for (const [animId, sprite] of spriteMap) {
          const isActive = targetAnimId === animId;
          sprite.visible = isActive;
          if (isActive) {
            sprite.x = Math.round(posRef.current.x);
            sprite.y = Math.round(posRef.current.y);

            if (hasDirectional) {
              const absScale = Math.abs(sprite.scale.x);
              sprite.scale.x = absScale;
            } else {
              const absScale = Math.abs(sprite.scale.x);
              sprite.scale.x = facingRef.current * absScale;
            }

            const storeAnim = animations.find((a) => a.id === animId);
            if (storeAnim) {
              sprite.animationSpeed = idleFallback ? 0 : storeAnim.fps / 60;
            }
          }
        }

        // If resolved animation changed, restart it
        if (targetAnimId !== prevAnimId && targetAnim) {
          const s = spriteMap.get(targetAnim.id);
          if (s) {
            if (idleFallback) {
              // Freeze on frame 0 (standing pose) rather than animating
              s.gotoAndStop(0);
            } else {
              s.gotoAndPlay(0);
            }
          }
        }
        prevAnimId = targetAnimId;

        // Update overlay
        setOverlayInfo({
          animation: targetAnim?.name ?? 'none',
          state: currentState,
          direction: currentDir,
          x: posRef.current.x,
          y: posRef.current.y,
          fps: currentFps,
          directional: hasDirectional,
        });
      });

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

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      keysRef.current.add(e.key);

      if (e.key === 'h' || e.key === 'H') {
        setShowOverlay((v) => !v);
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        posRef.current = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
        return;
      }

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
      const dir = directionRef.current;
      const anim = getAnimForState(state, dir);
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
              Dir: {overlayInfo.direction.charAt(0).toUpperCase() + overlayInfo.direction.slice(1)}
              {overlayInfo.directional && ' (4-dir)'}
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
          <div className="px-4 pb-4 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            <p className="text-[9px] font-mono text-text-muted/70 pt-1 border-t border-border-subtle">
              Arrow keys control direction when directional animations (Walk Up/Down/Left/Right) are available.
              Vertical direction takes priority on diagonals.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
