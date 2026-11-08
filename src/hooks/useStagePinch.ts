import { useEffect, useRef, type RefObject } from 'react';

// A pinch on a /preview stage zooms the stage, not the page (George, Nov 8:
// pinching the Demo Area in Safari zoomed the whole page). Follows the
// editor's pattern in PixelEditorBody.tsx (safariPinchRef and the ctrl or cmd
// wheel), without sharing its code:
//   - Two fingers on the element are a pinch; their touchmove is cancelled so
//     the page does not zoom. One finger is left alone and still scrolls.
//   - Safari pinches with gesturestart, gesturechange and gestureend (a
//     trackpad on macOS, and beside the touch events on iPhone and iPad);
//     these are cancelled, and reported only when no finger is on the stage.
//   - A ctrl or cmd wheel (a trackpad pinch in Chrome or Firefox, or Ctrl
//     plus a mouse wheel) is cancelled and reported as steps. A plain wheel
//     is not touched.
// Everywhere outside the element the page scrolls and zooms as it always has.

export interface StagePinchHandlers {
  onPinchStart?: () => void;
  /** The pinch's scale from its start: finger distance over the starting distance. */
  onPinch?: (gestureScale: number) => void;
  onPinchEnd?: () => void;
  /** One zoom step: 1 in, -1 out. */
  onWheelStep?: (direction: 1 | -1) => void;
}

type GestureEvent = Event & { scale?: number };

// A Safari pinch can also arrive as ctrl wheel events; within this long of a
// gesture event the wheel is not zoomed a second time (same guard as the editor).
const SAFARI_GUARD_MS = 500;
// Wheel delta, in CSS px, per zoom step: one mouse notch (about 100 px, or 3
// lines in Firefox) is one step; a trackpad pinch's small deltas add up to one.
const WHEEL_STEP_PX = 40;
// A wheel pause this long starts a new count.
const WHEEL_IDLE_MS = 300;

/** Adds the listeners to el and returns their removal. Exported for the
 *  offline test (scripts/stage-zoom-test.mjs). */
export function attachStagePinch(el: HTMLElement, handlers: RefObject<StagePinchHandlers>): () => void {
  let touchStartDistance = 0; // > 0 while a touch pinch is under way
  let fingersOnStage = 0;
  let safariPinch = false;
  let lastGestureAt = -Infinity;
  let wheelSum = 0;
  let lastWheelAt = -Infinity;

  const stageTouches = (e: TouchEvent) =>
    Array.from(e.touches).filter((t) => el.contains(t.target as Node | null));
  const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const endTouchPinch = () => {
    if (touchStartDistance > 0) {
      touchStartDistance = 0;
      handlers.current.onPinchEnd?.();
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    const touches = stageTouches(e);
    fingersOnStage = touches.length;
    if (touches.length >= 2 && touchStartDistance === 0) {
      const d = distance(touches[0], touches[1]);
      if (d > 0) {
        touchStartDistance = d;
        handlers.current.onPinchStart?.();
      }
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    const touches = stageTouches(e);
    if (touches.length < 2 || touchStartDistance === 0) return;
    if (e.cancelable) e.preventDefault();
    handlers.current.onPinch?.(distance(touches[0], touches[1]) / touchStartDistance);
  };
  const onTouchEnd = (e: TouchEvent) => {
    const touches = stageTouches(e);
    fingersOnStage = touches.length;
    if (touches.length < 2) endTouchPinch();
  };

  const onGestureStart = (e: Event) => {
    e.preventDefault();
    lastGestureAt = performance.now();
    if (fingersOnStage > 0) return; // iPhone and iPad: the touch pinch has it
    safariPinch = true;
    handlers.current.onPinchStart?.();
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    lastGestureAt = performance.now();
    const scale = (e as GestureEvent).scale;
    if (!safariPinch || fingersOnStage > 0 || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
    handlers.current.onPinch?.(scale);
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    lastGestureAt = performance.now();
    if (!safariPinch) return;
    safariPinch = false;
    handlers.current.onPinchEnd?.();
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // a plain wheel scrolls the page
    e.preventDefault();
    const now = performance.now();
    if (safariPinch || now - lastGestureAt < SAFARI_GUARD_MS) return;
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    if (now - lastWheelAt > WHEEL_IDLE_MS || Math.sign(px) !== Math.sign(wheelSum)) wheelSum = 0;
    lastWheelAt = now;
    wheelSum += px;
    if (Math.abs(wheelSum) < WHEEL_STEP_PX) return;
    const direction = wheelSum < 0 ? 1 : -1; // wheel up or fingers apart zooms in
    wheelSum = 0;
    handlers.current.onWheelStep?.(direction);
  };

  const onBlur = () => {
    endTouchPinch();
    fingersOnStage = 0;
    if (safariPinch) {
      safariPinch = false;
      handlers.current.onPinchEnd?.();
    }
  };

  const active = { passive: false } as const;
  el.addEventListener('touchstart', onTouchStart, active);
  el.addEventListener('touchmove', onTouchMove, active);
  el.addEventListener('touchend', onTouchEnd, active);
  el.addEventListener('touchcancel', onTouchEnd, active);
  el.addEventListener('gesturestart', onGestureStart, active);
  el.addEventListener('gesturechange', onGestureChange, active);
  el.addEventListener('gestureend', onGestureEnd, active);
  el.addEventListener('wheel', onWheel, active);
  window.addEventListener('blur', onBlur);
  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', onGestureEnd);
    el.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', onBlur);
  };
}

/** Pinch and ctrl or cmd wheel zoom on one stage element. The listeners are
 *  added once, when the element first appears (the stages render it after
 *  their own empty states), and removed on unmount. The handlers are read
 *  from a ref, so they may change every render. */
export function useStagePinch(ref: RefObject<HTMLElement | null>, handlers: StagePinchHandlers): void {
  const handlersRef = useRef<StagePinchHandlers>(handlers);
  const attached = useRef<{ el: HTMLElement; detach: () => void } | null>(null);

  useEffect(() => {
    handlersRef.current = handlers;
    const el = ref.current;
    if (attached.current?.el === el) return;
    attached.current?.detach();
    attached.current = el ? { el, detach: attachStagePinch(el, handlersRef) } : null;
  });

  useEffect(() => () => {
    attached.current?.detach();
    attached.current = null;
  }, []);
}
