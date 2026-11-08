import { useEffect, useRef, type RefObject } from 'react';

// A pinch on a /preview stage zooms the stage, not the page (George, Nov 8:
// pinching the Demo Area in Safari zoomed the whole page). Follows the
// editor's pattern in PixelEditorBody.tsx (safariPinchRef and the ctrl or cmd
// wheel), without sharing its code:
//   - Two fingers on the element are a pinch; their touchmove is cancelled so
//     the page does not zoom. One finger is left alone and still scrolls.
//     Fingers are tracked by identifier from e.touches on every touch event,
//     so a lost touchend, a third finger or one finger lifting starts a new
//     baseline instead of a jump. Once a pinch has started, the stage's
//     touchmove stays cancelled until every stage finger lifts, so the end of
//     a pinch never turns into a scroll. If the first two-finger move cannot
//     be cancelled (the browser already started a scroll), the gesture is the
//     browser's until every finger lifts.
//   - Safari pinches with gesturestart, gesturechange and gestureend (a
//     trackpad on macOS, and beside the touch events on iPhone and iPad);
//     these are cancelled, and reported only when no finger is on the stage.
//   - A ctrl or cmd wheel (a trackpad pinch in Chrome or Firefox, or Ctrl
//     plus a mouse wheel) is cancelled and reported as steps. A plain wheel
//     is not touched.
// Everywhere outside the element the page scrolls and zooms as it always has.

export interface StagePinchHandlers {
  /** A pinch starts, or starts again from a new pair of fingers: read the
   *  stage's current scale here. */
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
// A wheel delta under this is noise (some trackpads send 0 or a fraction).
const WHEEL_MIN_PX = 1;
// An opposite delta resets the count only when it is at least this big, so a
// trackpad's small wobble does not throw away a step in progress.
const WHEEL_FLIP_PX = 10;

/** Adds the listeners to el and returns their removal. Exported for the
 *  offline test (scripts/stage-zoom-test.mjs). */
export function attachStagePinch(el: HTMLElement, handlers: RefObject<StagePinchHandlers>): () => void {
  // Touch state, all reset when no finger remains on the stage.
  let stageIds: number[] = []; // identifiers of the fingers on the stage
  let pair: [number, number] | null = null; // the two fingers the pinch measures
  let baseline = 0; // their distance when the pinch (or its new baseline) began
  let pinching = false; // onPinchStart was called and onPinchEnd not yet
  let claimed = false; // a pinch ran: cancel the stage's touchmove until every finger lifts
  let dropped = false; // the browser had the gesture first: leave it be until every finger lifts
  let fingersOnStage = 0;

  let safariPinch = false;
  let lastGestureAt = -Infinity;
  let wheelSum = 0;
  let lastWheelAt = -Infinity;

  const stageTouches = (list: TouchList | undefined) =>
    Array.from(list ?? []).filter((t) => el.contains(t.target as Node | null));
  const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const endPinch = () => {
    if (!pinching) return;
    pinching = false;
    handlers.current.onPinchEnd?.();
  };

  const resetTouches = () => {
    endPinch();
    stageIds = [];
    pair = null;
    baseline = 0;
    claimed = false;
    dropped = false;
    fingersOnStage = 0;
  };

  // Reads the stage's fingers from e.touches and, when they changed, starts a
  // new baseline from the first two. Returns the stage's fingers.
  const sync = (e: TouchEvent): Touch[] => {
    const touches = stageTouches(e.touches);
    const ids = touches.map((t) => t.identifier);
    // Every finger lifted, or none of the tracked fingers is still down (a
    // lost touchend), or every finger on the stage just landed: a new gesture.
    const landed = new Set(stageTouches(e.changedTouches).map((t) => t.identifier));
    const fresh = e.type === 'touchstart' && ids.every((id) => landed.has(id));
    if (touches.length === 0 || fresh || (stageIds.length > 0 && !ids.some((id) => stageIds.includes(id)))) {
      resetTouches();
    }
    if (touches.length === 0) return touches;
    fingersOnStage = touches.length;
    if (ids.length === stageIds.length && ids.every((id) => stageIds.includes(id))) return touches;
    stageIds = ids;
    if (dropped) return touches;
    if (touches.length >= 2) {
      pair = [ids[0], ids[1]];
      baseline = distance(touches[0], touches[1]);
      if (pinching) {
        // A new pair mid-pinch: the stage reads its current scale again.
        handlers.current.onPinchEnd?.();
        handlers.current.onPinchStart?.();
      }
    } else {
      pair = null;
      baseline = 0;
      endPinch();
    }
    return touches;
  };

  const onTouchStart = (e: TouchEvent) => { sync(e); };
  const onTouchMove = (e: TouchEvent) => {
    const touches = sync(e);
    if (touches.length === 0 || dropped) return;
    const [idA, idB] = pair ?? [NaN, NaN];
    const a = touches.find((t) => t.identifier === idA);
    const b = touches.find((t) => t.identifier === idB);
    if (!a || !b) {
      if (claimed && e.cancelable) e.preventDefault(); // one finger left after a pinch: no scroll
      return;
    }
    const d = distance(a, b);
    if (baseline <= 0) {
      baseline = d;
      if (claimed && e.cancelable) e.preventDefault();
      return;
    }
    if (!pinching) {
      if (!e.cancelable) {
        dropped = true; // the browser is already scrolling: not ours
        return;
      }
      pinching = true;
      claimed = true;
      handlers.current.onPinchStart?.();
    }
    if (e.cancelable) e.preventDefault();
    handlers.current.onPinch?.(d / baseline);
  };
  const onTouchEnd = (e: TouchEvent) => { sync(e); };

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
    if (!(Math.abs(px) >= WHEEL_MIN_PX)) return;
    if (now - lastWheelAt > WHEEL_IDLE_MS) wheelSum = 0;
    lastWheelAt = now;
    if (wheelSum !== 0 && Math.sign(px) !== Math.sign(wheelSum)) {
      if (Math.abs(px) < WHEEL_FLIP_PX) return; // a wobble, not a turn
      wheelSum = 0;
    }
    wheelSum += px;
    if (Math.abs(wheelSum) < WHEEL_STEP_PX) return;
    const direction = wheelSum < 0 ? 1 : -1; // wheel up or fingers apart zooms in
    wheelSum = 0;
    handlers.current.onWheelStep?.(direction);
  };

  const onBlur = () => {
    resetTouches();
    if (safariPinch) {
      safariPinch = false;
      handlers.current.onPinchEnd?.();
    }
  };

  // Only touchmove, the gesture events and the wheel cancel anything.
  const active = { passive: false } as const;
  const passive = { passive: true } as const;
  el.addEventListener('touchstart', onTouchStart, passive);
  el.addEventListener('touchmove', onTouchMove, active);
  el.addEventListener('touchend', onTouchEnd, passive);
  el.addEventListener('touchcancel', onTouchEnd, passive);
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
