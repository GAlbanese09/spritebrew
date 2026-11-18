/**
 * Editor dimension caps, a neutral home for the constants both editorStore
 * (runtime + helpers) and spriteProject (boundary validator) need.
 *
 * Wave 1b.1 lift: previously these lived in editorStore.ts and were
 * imported back by spriteProject.ts, creating a circular dependency. The
 * cycle was safe today (refs only inside function bodies) but fragile;
 * moving here makes the dependency one-directional:
 *
 *   editorStore ─┐
 *                ├─→ editorConstants
 *   spriteProject ┘
 *
 * Wave 1a-established values; do not change without revisiting both
 * importers' acceptance criteria.
 */

/**
 * Per-side cap on any image loaded into the editor (px). The editor's
 * canvases are the image's own size (zoom is CSS only), so this guards the
 * browser's longest canvas side, not memory: 4096 is safe on every browser
 * SpriteBrew supports, and it is the widest sheet Animate makes (16 frames
 * of 256 in one row). It was 1024, which refused sheets SpriteBrew itself
 * made, such as 10 frames of 256 in 5 columns (HQ room 2026-11-15-114, -125).
 */
export const EDITOR_MAX_DIMENSION = 4096;

/**
 * Total-pixel cap: what bounds memory (the pixels and up to 50 undo copies,
 * about 200 MB here) and the time of the scans that run over every pixel.
 * 1,048,576 is 16 frames of 256 by 256, the most Animate delivers. Its own
 * number since HQ room 2026-11-15-125; it used to be the side cap squared.
 */
export const EDITOR_MAX_PIXELS = 1_048_576;

/** Where a refusal is shown: the editor opened from a result card, /editor
 *  itself (an upload), or a project file being opened. */
export type EditorRefusalPlace = 'card' | 'page' | 'plain' | 'project';

/** The Resize page, named in /editor's way out: the words show it as a link
 *  (DESIGN room 2026-11-15-126, item 2; HQ 2026-11-17-062). /resize takes
 *  images up to 4,096 pixels a side, and this way out is only offered under
 *  that, so it leads somewhere that takes the sheet. */
export const EDITOR_RESIZE_LINK = { label: 'Resize page', href: '/resize' } as const;

/** /editor's way out over the total, word for word. */
export const EDITOR_RESIZE_WAY_OUT = `To edit it, make it smaller on the ${EDITOR_RESIZE_LINK.label} first.`;

/** The last sentence of the over-the-total refusal: what the person can do
 *  from there (DESIGN rooms 2026-11-15-126 and -129). */
const EDITOR_WAY_OUT: Readonly<Record<EditorRefusalPlace, string>> = {
  card: 'To edit it, use Send to Editor on its result card, or use Download as delivered and upload that file.',
  page: EDITOR_RESIZE_WAY_OUT,
  // /upload's frame pencil and the Animate form's character Edit: no way out
  // that exists there yet, so the size and the limit alone (AUDIT, editor
  // size r1, M1; DESIGN may give one).
  plain: '',
  project: '',
};

const count = (n: number): string => n.toLocaleString('en-US');

/**
 * The editor's refusal for a size it will not open, in DESIGN's words
 * (rooms 2026-11-15-126 and -129, for HQ -125): the real size first, then
 * the limit, then what to do. Over a side no way out is offered: /resize
 * stops at 4,096 a side too. Pure, so the words are tested offline.
 */
export function editorSizeRefusal(width: number, height: number, place: EditorRefusalPlace): string {
  const subject = place === 'project' ? "This project's canvas" : null;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
    return subject ? `${subject} has no size the editor can read.` : 'The editor could not read the size of this image.';
  }
  const overW = width > EDITOR_MAX_DIMENSION;
  const overH = height > EDITOR_MAX_DIMENSION;
  if (overW || overH) {
    const size = overW && overH ? `${count(width)} by ${count(height)} pixels` : overW ? `${count(width)} pixels wide` : `${count(height)} pixels tall`;
    return `${subject ?? 'This image'} is ${size}. The editor opens images up to ${count(EDITOR_MAX_DIMENSION)} pixels on a side.`;
  }
  const head = `${subject ?? 'This sheet'} is ${count(width)} by ${count(height)} pixels, ${count(width * height)} in all. The editor opens up to ${count(EDITOR_MAX_PIXELS)} pixels, such as 16 frames of 256 by 256.`;
  const wayOut = EDITOR_WAY_OUT[place];
  return wayOut ? `${head} ${wayOut}` : head;
}
