/**
 * Editor zoom: fitting the whole image in view (George, Nov 4, 2026: "the
 * editor does not have a way to fit the whole sprite sheet ... I can't even
 * pinch on my Macbook Pro's Track pad to zoom out"; HQ 2026-11-04-018).
 *
 * The editor opened every image at 4x or more and never zoomed out past 1x,
 * so a 1024 x 1024 sheet was 4,096 px wide and could not be seen whole. These
 * helpers decide the fitted zoom, the smallest zoom allowed, and the zoom an
 * image opens at. Pure, tested offline (scripts/editor-zoom-test.mjs).
 */

/** Room kept clear around a fitted image, in CSS px: a little at the sides
 *  and the top, more at the bottom, where the zoom control floats over the
 *  canvas area (its top edge sits about 44 px up). A fitted image is moved up
 *  by fitPanY() so it is centred in the space above the control. */
export const FIT_PAD_X = 16;
export const FIT_PAD_TOP = 16;
export const FIT_PAD_BOTTOM = 60;

/** The vertical offset that centres a fitted image between the top padding
 *  and the zoom control (negative: up). `heldRoom` is extra room kept clear
 *  above the image, taken off the height given to fitZoom. */
export function fitPanY(heldRoom = 0): number {
  return -(FIT_PAD_BOTTOM - FIT_PAD_TOP - heldRoom) / 2;
}

/** The lowest an image `imageH` CSS px tall may sit, as a pan (positive:
 *  down) from the middle of an area `areaH` tall, and stay clear of the zoom
 *  control: its bottom edge at a fit's, FIT_PAD_BOTTOM above the area's.
 *  Infinity when it is taller than a fit leaves room for, where it cannot. */
export function panYClearOfControl(areaH: number, imageH: number): number {
  if (!(imageH <= areaH - FIT_PAD_TOP - FIT_PAD_BOTTOM)) return Infinity;
  return areaH / 2 - FIT_PAD_BOTTOM - imageH / 2;
}

/** How an image layer draws at a zoom on a screen of `dpr` device pixels per
 *  CSS px: below one device pixel per image pixel, nearest-neighbor drops
 *  whole rows and columns of 1 px art, so it draws smoothed (W2 audit). */
export function layerRendering(zoom: number, dpr: number): 'auto' | 'pixelated' {
  return zoom * dpr < 1 ? 'auto' : 'pixelated';
}

/** The zoom control's steps, powers of two from 25% to 3,200% (pixel art
 *  stays even at each of them). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

/** The levels the zoom menu lists. */
export const ZOOM_MENU_LEVELS: readonly number[] = [0.5, 1, 2, 4, 8, 16];

/** Zoom never goes below this, however large the image or small the area. */
export const MIN_ZOOM_FLOOR = 0.05;

/** The largest zoom at which a W x H image fits a vpW x vpH area with the
 *  padding above. 0 when a size is unknown (not laid out yet, no image). */
export function fitZoom(vpW: number, vpH: number, W: number, H: number): number {
  if (!(vpW > 0 && vpH > 0 && W > 0 && H > 0)) return 0;
  const z = Math.min((vpW - 2 * FIT_PAD_X) / W, (vpH - FIT_PAD_TOP - FIT_PAD_BOTTOM) / H);
  return z > 0 ? z : 0;
}

/** The smallest zoom allowed: 1x as before, or the fitted zoom when the image
 *  is too big for 1x, so zooming out stops with the whole image in view.
 *  1 when the fit is unknown. */
export function minZoomFor(fit: number): number {
  if (!(fit > 0)) return 1;
  return Math.max(MIN_ZOOM_FLOOR, Math.min(1, fit));
}

/** The zoom an image opens at. `preferred` is the editor's usual pick (a
 *  whole number from 4x to 16x); it stays whenever the image fits at it. An
 *  image that would not fit opens at the largest whole zoom that fits while
 *  that is 4x or more (pixels stay even), and fitted exactly below that (a
 *  whole sheet). */
export function openingZoom(preferred: number, fit: number): number {
  if (!(fit > 0) || preferred <= fit) return preferred;
  if (fit >= 4) return Math.floor(fit);
  return Math.max(MIN_ZOOM_FLOOR, fit);
}

/** The zoom as the control shows it: a whole percentage (59%, 400%). */
export function formatZoomPercent(z: number): string {
  return `${Math.round(z * 100)}%`;
}

/** Whether a zoom lies within [min, max] (a hair of float tolerance). The
 *  steps and the menu's levels outside it are not offered (W2 audit r2,
 *  finding 11: a level below the fit used to clamp silently). */
export function zoomAllowed(z: number, min: number, max: number): boolean {
  return z >= min - 1e-9 && z <= max + 1e-9;
}

/** The zoom menu opens above the control inside the canvas area, which
 *  clips it; its height is capped to the room there, and it scrolls (W2
 *  audit r2, finding 3: on a phone in landscape the top items were cut off).
 *  MENU_GAP is the space between the menu and the control (mb-2), MENU_MARGIN
 *  what is kept clear at the top, MENU_MIN_PX the least it is ever given
 *  (one row on a phone; a phone in landscape can have less than two rows of
 *  room above the control). */
export const MENU_GAP = 8;
export const MENU_MARGIN = 8;
export const MENU_MIN_PX = 44;

/** The menu's largest height in CSS px, from the top of the canvas area and
 *  the top of the zoom control (both in viewport px). */
export function zoomMenuMaxHeight(areaTop: number, controlTop: number): number {
  const room = Math.floor(controlTop - areaTop - MENU_GAP - MENU_MARGIN);
  return Number.isFinite(room) ? Math.max(MENU_MIN_PX, room) : MENU_MIN_PX;
}

/** The next zoom for the control's minus (dir -1) or plus (dir +1): the
 *  nearest step, or the fit, beyond the current zoom in that direction,
 *  within [min, max]. The current zoom when there is none. A zoom within
 *  0.5% of a step counts as on it, so pinch residue never makes a step that
 *  only nudges. `areaFit`, when given, is one more stop: the whole canvas
 *  area's fit while a banner's room is held, `fit` then being the fit less
 *  that room. */
export function nextZoomStep(current: number, dir: 1 | -1, fit: number, min: number, max: number, areaFit = 0): number {
  const stops = [...ZOOM_STEPS, ...[fit, areaFit].filter((f) => f > 0)]
    .filter((s) => zoomAllowed(s, min, max))
    .sort((a, b) => a - b);
  const tol = current * 0.005;
  if (dir > 0) {
    const next = stops.find((s) => s > current + tol);
    return next === undefined ? current : next;
  }
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i] < current - tol) return stops[i];
  }
  return current;
}

/** The number keys' zoom levels, as in Aseprite: 1 is 100%, 2 200%, 3 400%,
 *  4 800%, 5 1600%, 6 3200% (George's pick, Nov 4: Chrome keeps Cmd+1 for
 *  its first tab, so "Actual size" moved off it; HQ 2026-11-04-050). */
export const ZOOM_NUMBER_KEYS: Readonly<Record<string, number>> = { '1': 1, '2': 2, '3': 4, '4': 8, '5': 16, '6': 32 };

/** The number key for a zoom level, or null (the menu shows it). */
export function zoomNumberKey(level: number): string | null {
  for (const [key, z] of Object.entries(ZOOM_NUMBER_KEYS)) if (z === level) return key;
  return null;
}

/** Whether a keydown is one of the editor's zoom shortcuts, and which:
 *  Cmd (Mac) or Ctrl with = or + (in), - (out) and 0 (fit); the number keys
 *  1 to 6 alone (a zoom level, ZOOM_NUMBER_KEYS); Shift+0 (100%, as in
 *  Figma), matched by the key's place so any layout works. Alt combinations
 *  are left to the system, and Cmd or Ctrl with a number to the browser
 *  (Cmd+1 switches tabs). */
export function zoomShortcut(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey?: boolean }): 'in' | 'out' | 'fit' | number | null {
  if (e.altKey) return null;
  if (e.metaKey || e.ctrlKey) {
    switch (e.key) {
      case '=':
      case '+':
        return 'in';
      case '-':
      case '_':
        return 'out';
      case '0':
        return 'fit';
      default:
        return null;
    }
  }
  if (e.shiftKey) return e.code === 'Digit0' ? 1 : null;
  return Object.prototype.hasOwnProperty.call(ZOOM_NUMBER_KEYS, e.key) ? ZOOM_NUMBER_KEYS[e.key] : null;
}

/** Whether a key press may change the brush size (the editor's [ ] - = +
 *  hotkeys, which react-hotkeys-hook matches on the key alone, whatever the
 *  modifiers). Not when the press is a zoom shortcut: Cmd or Ctrl with = + -
 *  (W2 audit r2, finding 1), or Shift+0, which types "=" on German, Nordic,
 *  Spanish, Italian and other layouts (REV, #46, P2 a). Not with Cmd (Cmd+[
 *  is the browser's Back) or a plain Ctrl. Option, and AltGr (Windows reports
 *  it as Ctrl with Alt), are allowed: [ and ] need them on many layouts (REV,
 *  #46, P3 a). */
export function isBrushKey(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey?: boolean }): boolean {
  return zoomShortcut(e) === null && !e.metaKey && !(e.ctrlKey && !e.altKey);
}
