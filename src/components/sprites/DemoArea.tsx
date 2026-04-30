'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Application,
  AnimatedSprite,
  Container,
  Graphics,
  Texture,
  TilingSprite,
  TextureSource,
} from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { ChevronDown, ChevronUp, Eye, EyeOff, Maximize2 } from 'lucide-react';
import { DEMO_CONTROLS } from '@/lib/constants';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteAnimation } from '@/lib/types';

// Force nearest-neighbor globally for pixel art
TextureSource.defaultOptions.scaleMode = 'nearest';

const VALID_WORLD_SCALES = [1, 2, 4, 8] as const;
type WorldScale = typeof VALID_WORLD_SCALES[number];

type CharState = 'idle' | 'walking' | 'running' | 'attacking' | 'jumping' | 'hurt';
type Direction = 'up' | 'down' | 'left' | 'right';
type BgPreset = 'grid' | 'grass' | 'dungeon' | 'black' | 'white';
type NaturalFacing = 'left' | 'right';

// Internal canvas resolution. The CSS display size is responsive (max 100%
// width preserving 16:9 aspect ratio) so pixel-art scales cleanly on smaller
// viewports while keeping the same play area in source-pixel space.
const CANVAS_W = 1280;
const CANVAS_H = 720;
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
  const worldRef = useRef<Container | null>(null);
  const shadowRef = useRef<Graphics | null>(null);
  const spritesRef = useRef<Map<string, AnimatedSprite>>(new Map());
  // Currently-visible sprite — updated by the game loop, read by clamp logic
  // on the next tick to subtract halfSprite from the world-bounds.
  const activeSpriteRef = useRef<AnimatedSprite | null>(null);
  const bgSpriteRef = useRef<TilingSprite | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const stateRef = useRef<CharState>('idle');
  // posRef holds WORLD-space coordinates (pre-scale). Default = visible center
  // at scale=1; re-centered when scale changes via the worldScale effect.
  const posRef = useRef({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
  const facingRef = useRef<1 | -1>(1);
  const directionRef = useRef<Direction>('down');
  const lockedRef = useRef(false);
  const worldScaleRef = useRef<WorldScale>(2);
  const naturalFacingRef = useRef<NaturalFacing>('right');

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
  // Default 2× — most generated sprites are 64–128 and 2× reads well on 1280×720.
  const [worldScale, setWorldScale] = useState<WorldScale>(2);
  const [showcaseMode, setShowcaseMode] = useState(false);
  const [naturalFacing, setNaturalFacing] = useState<NaturalFacing>('right');
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

  // Sync natural-facing into a ref so the game loop reads it without re-render churn.
  useEffect(() => {
    naturalFacingRef.current = naturalFacing;
  }, [naturalFacing]);

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
        roundPixels: true,
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
      // Responsive display: take 100% of the (max-1280px) container width,
      // preserving 16:9 aspect ratio. Internal resolution stays at CANVAS_W × CANVAS_H.
      cv.style.width = '100%';
      cv.style.height = 'auto';
      cv.style.aspectRatio = `${CANVAS_W} / ${CANVAS_H}`;
      cv.style.maxWidth = `${CANVAS_W}px`;
      cv.style.outline = 'none';
      cv.tabIndex = 0;
      cv.classList.add('pixel-art-render');

      cv.addEventListener('focus', () => setFocused(true));
      cv.addEventListener('blur', () => setFocused(false));

      containerRef.current!.innerHTML = '';
      containerRef.current!.appendChild(cv);

      // World container — holds bg + shadow + sprites. Scaled by worldScale
      // so 1×/2×/4×/8× zoom preserves pixel-perfect rendering. Math.floor()
      // applied to the user-facing scale keeps it on integer multiples.
      const world = new Container();
      world.scale.set(Math.floor(worldScaleRef.current));
      app.stage.addChild(world);
      worldRef.current = world;

      // Background — sized to the largest visible world area (CANVAS_W × CANVAS_H
      // at scale=1). At higher scales the bg overshoots the canvas but since it's
      // a TilingSprite, the visible portion still fills cleanly.
      const bgCanvas = createBgCanvas(bgPreset);
      const bgTexture = Texture.from(bgCanvas);
      const bgSprite = new TilingSprite({
        texture: bgTexture,
        width: CANVAS_W,
        height: CANVAS_H,
      });
      world.addChild(bgSprite);
      bgSpriteRef.current = bgSprite;

      // Ground shadow — single Graphics ellipse parented to world, follows
      // the active sprite's feet. Added BEFORE sprites so it renders beneath.
      const shadow = new Graphics();
      shadow.ellipse(0, 0, 16, 5);
      shadow.fill({ color: 0x000000, alpha: 0.35 });
      shadow.visible = false;
      world.addChild(shadow);
      shadowRef.current = shadow;

      // Load textures for each animation
      const spriteMap = new Map<string, AnimatedSprite>();

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
        animSprite.x = Math.floor(posRef.current.x);
        animSprite.y = Math.floor(posRef.current.y);
        animSprite.scale.set(1);
        animSprite.animationSpeed = anim.fps / 60;
        animSprite.loop = true;
        animSprite.visible = false;
        // Drop shadow on each sprite (one-time, persists across visibility swaps).
        // Filter is configured for soft elevation, not pixel-art-perfect.
        animSprite.filters = [
          new DropShadowFilter({
            offset: { x: 3, y: 5 },
            blur: 2,
            alpha: 0.45,
            color: 0x000000,
            quality: 4,
          }),
        ];
        animSprite.play();

        world.addChild(animSprite);
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
      let prevIdleFallback = false;

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

            // Boundary clamp uses scale-adjusted world bounds AND subtracts
            // halfSprite so the sprite stays fully visible (anchor is centered
            // at 0.5,0.5 — without the half-offset, half the sprite would clip
            // offscreen at the extremes). Falls back to no offset before the
            // first sprite is visible.
            const ws = worldScaleRef.current;
            const activeSprite = activeSpriteRef.current;
            const halfW = activeSprite ? (activeSprite.width / 2) / ws : 0;
            const halfH = activeSprite ? (activeSprite.height / 2) / ws : 0;
            posRef.current.x = Math.max(halfW, Math.min(CANVAS_W / ws - halfW, posRef.current.x));
            posRef.current.y = Math.max(halfH, Math.min(CANVAS_H / ws - halfH, posRef.current.y));

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
        let activeSprite: AnimatedSprite | null = null;
        for (const [animId, sprite] of spriteMap) {
          const isActive = targetAnimId === animId;
          sprite.visible = isActive;
          if (isActive) {
            sprite.x = Math.floor(posRef.current.x);
            sprite.y = Math.floor(posRef.current.y);

            if (hasDirectional) {
              const absScale = Math.abs(sprite.scale.x);
              sprite.scale.x = absScale;
            } else {
              const absScale = Math.abs(sprite.scale.x);
              // facingRef = +1 (moving right) / -1 (moving left).
              // For right-natural sheets: scale.x = facingRef * absScale (right=+, left=-).
              // For left-natural sheets: invert — sheet faces left at rest, so moving
              // left = no flip, moving right = flip.
              const naturalSign = naturalFacingRef.current === 'right' ? 1 : -1;
              sprite.scale.x = naturalSign * facingRef.current * absScale;
            }

            const storeAnim = animations.find((a) => a.id === animId);
            if (storeAnim) {
              sprite.animationSpeed = idleFallback ? 0 : storeAnim.fps / 60;
            }
            activeSprite = sprite;
          }
        }

        // Ground shadow follows the active sprite's feet
        if (shadowRef.current && activeSprite) {
          const halfH = (activeSprite.height || 32) / 2;
          shadowRef.current.x = activeSprite.x;
          shadowRef.current.y = activeSprite.y + Math.floor(halfH);
          shadowRef.current.visible = true;
        } else if (shadowRef.current) {
          shadowRef.current.visible = false;
        }

        // Publish the active sprite to the ref so next tick's clamp can read
        // its dimensions for the half-sprite boundary offset.
        activeSpriteRef.current = activeSprite;

        // If resolved animation OR idle-fallback flag changed, restart playback.
        // Tracking idleFallback transitions catches the case where the same
        // sprite is used as both synthetic-idle (stopped) and walking (playing).
        const animOrFallbackChanged =
          targetAnimId !== prevAnimId || idleFallback !== prevIdleFallback;
        if (animOrFallbackChanged && targetAnim) {
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
        prevIdleFallback = idleFallback;

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

  // Apply world scale + re-center sprite to the new visible bounds.
  // Math.floor() guarantees integer scaling for crisp pixel rendering.
  useEffect(() => {
    worldScaleRef.current = worldScale;
    const world = worldRef.current;
    if (world) {
      world.scale.set(Math.floor(worldScale));
    }
    // Re-center sprite into the new scale-adjusted world bounds.
    posRef.current = {
      x: CANVAS_W / 2 / worldScale,
      y: CANVAS_H / 2 / worldScale,
    };
  }, [worldScale]);

  // Showcase mode — fullscreen the canvas + hide chrome via conditional render.
  useEffect(() => {
    const cv = appRef.current?.canvas as HTMLCanvasElement | undefined;
    if (!showcaseMode) {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => { /* ignore */ });
      }
      return;
    }
    if (cv?.requestFullscreen) {
      cv.requestFullscreen().catch(() => { /* user rejected, ignore */ });
    }
  }, [showcaseMode]);

  // Listen for Escape-exiting fullscreen — keep showcase state in sync.
  useEffect(() => {
    const onFsChange = () => {
      if (typeof document === 'undefined') return;
      if (!document.fullscreenElement && showcaseMode) setShowcaseMode(false);
    };
    if (typeof document === 'undefined') return;
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [showcaseMode]);

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
        // Re-center using the current world scale's bounds
        const ws = worldScaleRef.current;
        posRef.current = { x: CANVAS_W / 2 / ws, y: CANVAS_H / 2 / ws };
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        setShowcaseMode((v) => !v);
        return;
      }

      // Scale toggle — keys 1, 2, 4, 8
      if (e.key === '1') { setWorldScale(1); return; }
      if (e.key === '2') { setWorldScale(2); return; }
      if (e.key === '4') { setWorldScale(4); return; }
      if (e.key === '8') { setWorldScale(8); return; }

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
      {/* Canvas container — responsive max-width with 16:9 aspect ratio.
          Internal canvas resolution stays at CANVAS_W × CANVAS_H; CSS scales
          the display down on narrower viewports while preserving pixel art. */}
      <div
        className={`relative rounded-lg border-2 overflow-hidden transition-colors w-full ${
          focused ? 'border-accent-amber glow-amber' : 'border-border-default'
        }`}
        style={{ maxWidth: CANVAS_W, aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
      >
        <div ref={containerRef} className="w-full h-full" />

        {/* Info overlay — hidden in showcase mode */}
        {showOverlay && !showcaseMode && (
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

      {/* Toolbar (background + scale + showcase) — hidden in showcase mode */}
      {!showcaseMode && (
        <>
          {/* Background selector */}
          <div className="flex items-center gap-2 flex-wrap">
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

          {/* Scale toggle (1×/2×/4×/8×) + Showcase mode button */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Scale
            </label>
            {VALID_WORLD_SCALES.map((s) => (
              <button
                key={s}
                onClick={() => setWorldScale(s)}
                className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                  ${worldScale === s
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {s}×
              </button>
            ))}
            <button
              onClick={() => setShowcaseMode(true)}
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle"
              title="Showcase mode (F)"
            >
              <Maximize2 size={12} />
              Showcase
            </button>
          </div>

          {/* Natural facing toggle — for sheets generated facing left
              (single-direction sheets only; ignored when directional anims exist). */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
              Facing
            </label>
            {([
              { id: 'left', label: '← Left' },
              { id: 'right', label: 'Right →' },
            ] as const).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setNaturalFacing(id)}
                className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                  ${naturalFacing === id
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Controls reference — hidden in showcase mode */}
      {!showcaseMode && (
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
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {(['1', '2', '4', '8'] as const).map((k) => (
                    <kbd
                      key={k}
                      className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5
                        rounded bg-bg-elevated border border-border-default text-[10px] font-mono text-text-primary"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
                <span className="text-[10px] font-mono text-text-muted">
                  Set scale (1×/2×/4×/8×)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <kbd
                  className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5
                    rounded bg-bg-elevated border border-border-default text-[10px] font-mono text-text-primary"
                >
                  F
                </kbd>
                <span className="text-[10px] font-mono text-text-muted">
                  Showcase / fullscreen
                </span>
              </div>
            </div>
            <p className="text-[9px] font-mono text-text-muted/70 pt-1 border-t border-border-subtle">
              Arrow keys control direction when directional animations (Walk Up/Down/Left/Right) are available.
              Vertical direction takes priority on diagonals.
            </p>
            <p className="text-[9px] font-mono text-text-muted/70">
              Sprite moonwalking? Try toggling natural facing if your sheet was generated facing left.
            </p>
          </div>
        )}
      </div>
      )}

      {/* Showcase mode hint — only visible when in showcase */}
      {showcaseMode && (
        <p className="text-center text-[10px] font-mono text-text-muted">
          Showcase mode &middot; Press <kbd className="px-1 rounded bg-bg-elevated border border-border-default">F</kbd> or <kbd className="px-1 rounded bg-bg-elevated border border-border-default">Esc</kbd> to exit
        </p>
      )}
    </div>
  );
}
