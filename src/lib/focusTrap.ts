// A Tab order kept within one part of the page, for an overlay that is not a
// HeadlessUI Dialog (the editor's phone Colors sheet: AUDIT editor batch 2
// r1, L2, Nov 25, 2026).

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** The controls in `root` that Tab stops on, in page order: enabled, shown,
 *  and not inside anything inert. */
export function tabbableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]'),
  );
}

/** Where Tab (or Shift+Tab, `back`) goes among `count` controls when the
 *  focus is on control `current` (-1: on the overlay itself, or outside
 *  it): the next one, wrapping from the last to the first and back. -1 when
 *  there is nothing to focus. */
export function nextTrapIndex(count: number, current: number, back: boolean): number {
  if (count <= 0) return -1;
  if (back) return current <= 0 ? count - 1 : current - 1;
  return current < 0 || current >= count - 1 ? 0 : current + 1;
}
