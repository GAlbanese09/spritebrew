'use client';

/**
 * Drag and drop for frames in the sheet tools, on pointer events rather than
 * HTML5 drag and drop so it works with touch.
 *
 * - Sources: a tile in the Frames grid (drops insert a copy into a group, the
 *   frame stays in the grid) or a tile in a group strip (drops reorder that
 *   group only).
 * - Targets: any element with data-frame-drop-anim={animId}; tiles inside it
 *   carry data-frame-drop-index so the insertion point can be measured.
 * - Mouse drags start after a few pixels of movement, so a click still
 *   selects. Touch and pen drags start after a short hold without moving, so
 *   a swipe still scrolls the page.
 * - Escape, pointercancel or the window losing focus abort with no change.
 *
 * Commits go through the existing updateFrameOrder action; the sprite store's
 * shape is unchanged. Drag state lives here, outside the store.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useSpriteStore } from '@/stores/spriteStore';
import { dropIndex, indicatorBox, insertAt, moveItem, type Box } from '@/lib/frameDragMath';

export type FrameDragSource =
  | { kind: 'grid'; frameId: string }
  | { kind: 'group'; animId: string; index: number; frameId: string };

export interface FrameDropTarget {
  animId: string;
  index: number;
}

export interface FrameDragView {
  source: FrameDragSource;
  pointerType: string;
  x: number;
  y: number;
  target: FrameDropTarget | null;
  bar: Box | null;
}

const HOLD_MS = 250;
const MOUSE_SLOP_PX = 5;
const TOUCH_SLOP_PX = 8;
const TILE_GAP_PX = 6; // matches gap-1.5 on the group strip
const EDGE_PX = 56;
const MAX_SCROLL_STEP_PX = 18;

interface Session {
  pointerId: number;
  pointerType: string;
  source: FrameDragSource;
  element: HTMLElement;
  scroller: HTMLElement | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  phase: 'pending' | 'active';
  holdTimer: ReturnType<typeof setTimeout> | null;
  raf: number | null;
  target: FrameDropTarget | null;
  bar: Box | null;
  prevUserSelect: string;
  prevCursor: string;
}

let session: Session | null = null;
let view: FrameDragView | null = null;
const subscribers = new Set<() => void>();

function emit() {
  view =
    session && session.phase === 'active'
      ? {
          source: session.source,
          pointerType: session.pointerType,
          x: session.x,
          y: session.y,
          target: session.target,
          bar: session.bar,
        }
      : null;
  subscribers.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// ── Hit testing ──

function hitTest(s: Session): { target: FrameDropTarget | null; bar: Box | null } {
  const el = document.elementFromPoint(s.x, s.y);
  const zone = el?.closest<HTMLElement>('[data-frame-drop-anim]');
  const animId = zone?.dataset.frameDropAnim;
  if (!zone || !animId) return { target: null, bar: null };
  if (s.source.kind === 'group' && animId !== s.source.animId) return { target: null, bar: null };

  const tiles = Array.from(zone.querySelectorAll<HTMLElement>('[data-frame-drop-index]'));
  const boxes: Box[] = tiles.map((t) => {
    const r = t.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  const index = dropIndex(boxes, s.x, s.y);
  return { target: { animId, index }, bar: indicatorBox(boxes, index, TILE_GAP_PX) };
}

function retarget() {
  if (!session || session.phase !== 'active') return;
  const { target, bar } = hitTest(session);
  session.target = target;
  session.bar = bar;
  emit();
}

// ── Commit ──

function commit(source: FrameDragSource, target: FrameDropTarget) {
  const state = useSpriteStore.getState();
  const anim = state.animations.find((a) => a.id === target.animId);
  if (!anim) return;

  if (source.kind === 'grid') {
    const frame = state.spriteSheet?.animations
      .flatMap((a) => a.frames)
      .find((f) => f.id === source.frameId);
    if (!frame) return;
    state.updateFrameOrder(anim.id, insertAt(anim.frames, target.index, frame));
    return;
  }

  // Guard against the group having changed under the drag.
  if (anim.id !== source.animId || anim.frames[source.index]?.id !== source.frameId) return;
  const next = moveItem(anim.frames, source.index, target.index);
  if (next !== anim.frames) state.updateFrameOrder(anim.id, next);
}

// ── Lifecycle ──

/** The element that scrolls the sheet tools. The app shell scrolls its
 *  <main>, not the window, so walk up from the dragged tile; null means the
 *  window. */
function findScroller(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const overflowY = getComputedStyle(n).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** Near the top or bottom edge of the scrolling area, scroll toward it so a
 *  frame can reach a group that is off screen. */
function autoScroll() {
  if (!session || session.phase !== 'active') return;
  const { y, scroller } = session;
  const rect = scroller?.getBoundingClientRect();
  const top = Math.max(0, rect ? rect.top : 0);
  const bottom = Math.min(window.innerHeight, rect ? rect.bottom : window.innerHeight);
  let step = 0;
  if (y < top + EDGE_PX) step = -((top + EDGE_PX - y) / EDGE_PX) * MAX_SCROLL_STEP_PX;
  else if (y > bottom - EDGE_PX) step = ((y - (bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_STEP_PX;
  step = Math.max(-MAX_SCROLL_STEP_PX, Math.min(MAX_SCROLL_STEP_PX, step));
  if (step !== 0) (scroller ?? window).scrollBy(0, step);
  session.raf = requestAnimationFrame(autoScroll);
}

function activate() {
  if (!session || session.phase !== 'pending') return;
  session.phase = 'active';
  session.holdTimer = null;
  if (session.pointerType === 'mouse') {
    // Keep receiving the pointer if it leaves the window mid-drag.
    try {
      session.element.setPointerCapture(session.pointerId);
    } catch {
      // The pointer may already be gone; pointerup or pointercancel will end it.
    }
  }
  session.scroller = findScroller(session.element);
  session.prevUserSelect = document.body.style.userSelect;
  session.prevCursor = document.body.style.cursor;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'grabbing';
  session.raf = requestAnimationFrame(autoScroll);
  retarget();
}

/** After a real drag, swallow the click the browser sends on release so a
 *  grid tile is not also selected. */
function suppressNextClick() {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
}

function end(apply: boolean) {
  const s = session;
  if (!s) return;
  session = null;
  if (s.holdTimer) clearTimeout(s.holdTimer);
  if (s.raf !== null) cancelAnimationFrame(s.raf);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerCancel);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('contextmenu', onContextMenu, true);
  window.removeEventListener('scroll', onScroll, true);
  if (s.phase === 'active') {
    document.body.style.userSelect = s.prevUserSelect;
    document.body.style.cursor = s.prevCursor;
    suppressNextClick();
    if (apply && s.target) commit(s.source, s.target);
  }
  emit();
}

function onPointerMove(e: PointerEvent) {
  const s = session;
  if (!s || e.pointerId !== s.pointerId) return;
  s.x = e.clientX;
  s.y = e.clientY;
  if (s.phase === 'pending') {
    const moved = Math.hypot(s.x - s.startX, s.y - s.startY);
    if (s.pointerType === 'mouse') {
      if (moved > MOUSE_SLOP_PX) activate();
    } else if (moved > TOUCH_SLOP_PX) {
      // Moved before the hold finished: this is a scroll, not a drag.
      end(false);
    }
    return;
  }
  e.preventDefault();
  retarget();
}

function onPointerUp(e: PointerEvent) {
  if (!session || e.pointerId !== session.pointerId) return;
  end(true);
}

function onPointerCancel(e: PointerEvent) {
  if (!session || e.pointerId !== session.pointerId) return;
  end(false);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !session) return;
  e.preventDefault();
  e.stopPropagation();
  end(false);
}

function onBlur() {
  end(false);
}

function onContextMenu(e: Event) {
  // A long press would otherwise open the context menu mid-drag on Android.
  if (session && session.pointerType !== 'mouse') e.preventDefault();
}

function onScroll() {
  retarget();
}

/** Pointer-down handler for a draggable frame tile. Presses on elements
 *  marked data-frame-drag-ignore (the arrow, remove and pencil buttons)
 *  never start a drag. */
export function startFrameDrag(e: React.PointerEvent<HTMLElement>, source: FrameDragSource) {
  if (session) return;
  if (!e.isPrimary) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if ((e.target as Element).closest('[data-frame-drag-ignore]')) return;

  session = {
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    source,
    element: e.currentTarget,
    scroller: null,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    phase: 'pending',
    holdTimer: null,
    raf: null,
    target: null,
    bar: null,
    prevUserSelect: '',
    prevCursor: '',
  };
  if (e.pointerType !== 'mouse') session.holdTimer = setTimeout(activate, HOLD_MS);

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
}

// ── Touch guard ──
// Once a touch drag is active the page must not scroll under the finger.
// Calling preventDefault on touchmove does that, but only from a listener
// that is non-passive and already registered when the touch starts (iOS
// Safari ignores one added mid-gesture), so one stays mounted while any
// drag-aware component is on screen.

let guardCount = 0;

function onTouchMove(e: TouchEvent) {
  if (session && session.phase === 'active' && e.cancelable) e.preventDefault();
}

function useTouchGuard() {
  useEffect(() => {
    if (guardCount++ === 0) window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      if (--guardCount === 0) window.removeEventListener('touchmove', onTouchMove);
      if (guardCount === 0) end(false);
    };
  }, []);
}

/** The active drag, or null. Also keeps the touch guard mounted. */
export function useFrameDrag(): FrameDragView | null {
  useTouchGuard();
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => null
  );
}

/** Inline style for draggable tiles: no long-press callout or text
 *  selection on touch, page scrolling left to the browser until a hold. */
export const DRAG_TILE_STYLE: React.CSSProperties = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
};

const CHECKER: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
  backgroundSize: '6px 6px',
  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
  backgroundColor: '#fff',
};

/** The frame under the pointer and the drop indicator bar. Mount once. */
export function FrameDragLayer({ frameDataUrls }: { frameDataUrls: Map<string, string> }) {
  const drag = useFrameDrag();
  if (!drag) return null;

  const url = frameDataUrls.get(drag.source.frameId);
  // On touch the frame floats above the finger so it stays visible.
  const ghostTransform =
    drag.pointerType === 'mouse' ? 'translate(10px, 10px)' : 'translate(-50%, calc(-100% - 28px))';

  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[100]">
      {drag.bar && (
        <div
          className="fixed rounded-full bg-accent-amber"
          style={{
            left: drag.bar.left - 1,
            top: drag.bar.top - 2,
            width: drag.bar.right - drag.bar.left + 2,
            height: drag.bar.bottom - drag.bar.top + 4,
          }}
        />
      )}
      <div
        className={`fixed w-12 h-12 overflow-hidden rounded border-2 shadow-lg ${
          drag.target ? 'border-accent-amber' : 'border-border-strong opacity-70'
        }`}
        style={{ left: drag.x, top: drag.y, transform: ghostTransform, ...CHECKER }}
      >
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            draggable={false}
            className="w-full h-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
