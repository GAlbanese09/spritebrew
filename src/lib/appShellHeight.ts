// src/lib/appShellHeight.ts
//
// The height of AppShell's root on every route but /editor (fix note 15,
// BUILD 2026-10-31). ViewportVars publishes it as --app-shell-h.
//
// The shell sits at the top of the page and clips everything below its own
// height, so it has to cover the screen even when the visual viewport is
// smaller than the screen:
// - Zoom (a pinch, or iOS zooming in on a text field under 16px): the screen
//   then shows height / scale layout pixels, so the shell takes
//   height x scale, the screen's height at scale 1.
// - The on-screen keyboard: while a text field has focus on a touch screen,
//   and for BLUR_HOLD_MS after focus leaves it while the keyboard closes, the
//   shell keeps its height (it may grow, never shrink). iOS Safari scrolls the
//   page down to show the field above the keyboard. A shell cut to the area
//   above the keyboard ended partway down the screen once it scrolled, so the
//   rest of the screen was blank and the field was hidden until typing
//   scrolled it back into view.
// - The layout's own height (the document element's clientHeight, which the
//   keyboard and zoom do not change) is a floor under all of this.
// - A layout that gets shorter while a field has focus (a rotation to
//   landscape, a keyboard that resizes the page, a shorter window) is
//   followed; a taller one raises the floor.

/** How long the shell keeps its height after focus leaves a text field. */
export const BLUR_HOLD_MS = 700;


type TextEntryLike = { tagName?: string; type?: string; isContentEditable?: boolean };

// Input types that never bring up a keyboard or a picker.
const NOT_TEXT = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

/** Whether focusing this element brings up the on-screen keyboard or a picker. */
export function isTextEntry(el: TextEntryLike | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TEXT.has((el.type || 'text').toLowerCase());
  return el.isContentEditable === true;
}

/**
 * The visual viewport's height at scale 1, in whole CSS pixels, or null when
 * the inputs give no positive finite height. Rounds down, after a 0.01 px
 * allowance so a product such as 738.9999 at a zoom still gives 739.
 */
export function visibleHeight(vvHeight: number, scale: number): number | null {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const h = Math.floor(vvHeight * s + 0.01);
  return Number.isFinite(h) && h > 0 ? h : null;
}

/** What one read of the page gives the tracker. */
export interface ShellReading {
  /** visualViewport.height, or window.innerHeight without a visual viewport. */
  vvHeight: number;
  /** visualViewport.scale, or 1. */
  scale: number;
  /** document.documentElement.clientHeight: the layout's height. */
  layoutHeight: number;
  /** document.activeElement. */
  active: TextEntryLike | null;
  /** Whether the primary pointer is coarse (a touch screen). */
  touch: boolean;
}

export interface ShellTracker {
  /** Focus left this element (a focusout event). */
  focusLeft(target: TextEntryLike | null | undefined, touch: boolean): void;
  /** The height to publish, or null to leave --app-shell-h as it is. */
  read(r: ShellReading): number | null;
}

/** The parts of window that a reading needs (window itself in the app). */
export interface ShellWindow {
  visualViewport?: { height: number; scale: number } | null;
  innerHeight: number;
  matchMedia?: (query: string) => { matches: boolean };
}

/** The parts of document that a reading needs (document itself in the app). */
export interface ShellDocument {
  documentElement: {
    clientHeight: number;
    style: { setProperty(name: string, value: string): void };
  };
  activeElement: TextEntryLike | null;
}

/** Whether the primary pointer is coarse (a touch screen), read now. */
export function coarsePointer(win: ShellWindow): boolean {
  return win.matchMedia?.('(pointer: coarse)')?.matches === true;
}

/** One reading of the page for the tracker. */
export function shellReading(win: ShellWindow, doc: ShellDocument): ShellReading {
  const vv = win.visualViewport;
  return {
    vvHeight: vv ? vv.height : win.innerHeight,
    scale: vv ? vv.scale : 1,
    layoutHeight: doc.documentElement.clientHeight,
    active: doc.activeElement,
    touch: coarsePointer(win),
  };
}

/** The shell's height over time. `now` is a clock in milliseconds. */
export function createShellTracker(now: () => number): ShellTracker {
  // The height from the last read that did not hold (a hold may grow it, never
  // shrink it), and the layout height it was measured at.
  let base: number | null = null;
  let baseLayout = 0;
  // The last height returned, for a read that gives no height.
  let last: number | null = null;
  let holdUntil = Number.NEGATIVE_INFINITY;
  // Whether the last read saw a text field focused on a touch screen.
  let wasTyping = false;

  return {
    focusLeft(target, touch) {
      if (touch && isTextEntry(target)) {
        holdUntil = now() + BLUR_HOLD_MS;
        // This focusout already started the hold; the next read must not
        // take it for a field removed without one and start it again.
        wasTyping = false;
      }
    },
    read(r) {
      const typing = r.touch && isTextEntry(r.active);
      // Focus left a text field with no focusout to say so (the field was
      // removed from the page): hold from now, as a focusout would have.
      if (wasTyping && !typing && r.touch && now() >= holdUntil) {
        holdUntil = now() + BLUR_HOLD_MS;
      }
      wasTyping = typing;
      const visible = visibleHeight(r.vvHeight, r.scale);
      const layout = Number.isFinite(r.layoutHeight) && r.layoutHeight > 0 ? Math.floor(r.layoutHeight) : 0;
      if (visible === null && layout === 0) return last;
      // The layout's own height is a floor: the keyboard and zoom do not
      // change it, so neither can cut the shell short, nor can a visual
      // viewport left a little short after the keyboard closes (iOS 26.0) or
      // a fractional height.
      const cover = Math.max(layout, visible ?? 0);
      const hold = typing || (r.touch && now() < holdUntil);
      if (hold && base !== null) {
        if (layout > 0 && layout < baseLayout) {
          // The layout itself got shorter while holding (a rotation to
          // landscape, a keyboard that resizes the page, a shorter window):
          // follow it on every read rather than overflow the page. Nothing
          // is kept, so a read taken mid-rotation cannot stick. A taller
          // layout needs no rule: the cover grows the held height below.
          last = cover;
          return last;
        }
        if (cover > base) base = cover;
        last = base;
        return last;
      }
      base = cover;
      baseLayout = layout;
      last = base;
      return last;
    },
  };
}

/** The parts of document that installShellHeight listens on. */
export interface ShellFocusTarget {
  addEventListener(type: 'focusin' | 'focusout', listener: (e: { target: unknown }) => void): void;
  removeEventListener(type: 'focusin' | 'focusout', listener: (e: { target: unknown }) => void): void;
}

export interface ShellHeight {
  /** Reads the page (no writes) and returns the height to publish. */
  measure(): number | null;
  /** Writes --app-shell-h when there is a height. */
  publish(height: number | null): void;
  /** Removes the focus listeners. */
  dispose(): void;
}

/**
 * ViewportVars' side of the shell height: one tracker for the mount, and
 * document focusin and focusout listeners that re-read (`resync`), a focusout
 * first telling the tracker that focus left its target.
 */
export function installShellHeight(
  win: ShellWindow,
  doc: ShellDocument & ShellFocusTarget,
  now: () => number,
  resync: () => void,
): ShellHeight {
  const tracker = createShellTracker(now);
  const onFocusIn = () => resync();
  const onFocusOut = (e: { target: unknown }) => {
    tracker.focusLeft(e.target as TextEntryLike | null, coarsePointer(win));
    resync();
  };
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  return {
    measure: () => tracker.read(shellReading(win, doc)),
    publish: (height) => {
      if (height !== null) doc.documentElement.style.setProperty('--app-shell-h', `${height}px`);
    },
    dispose: () => {
      doc.removeEventListener('focusin', onFocusIn);
      doc.removeEventListener('focusout', onFocusOut);
    },
  };
}
