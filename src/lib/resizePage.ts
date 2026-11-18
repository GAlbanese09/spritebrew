/**
 * The free /resize page's own rules and words, kept out of the page so node
 * can test them (DESIGN design/tickets/editor-tools-batch.md v4.1, B2 to B5;
 * DESIGN 2026-11-14-249). The resizing itself is the engine's
 * (src/lib/pixelResize.ts); this file decides what the page offers and says.
 *
 * Pure: no React, no DOM.
 */

import {
  DOWNLOAD_SIDE_CAP,
  classifySize,
  isWholeSize,
  nearestCleanSizes,
  passesCap,
  sizeChoiceLabel,
  sizeChoices,
  sizeText,
  type SizeChoice,
} from './pixelResize';

/** One cap for downloads and /resize, a side (B2). */
export const RESIZE_SIDE_CAP = DOWNLOAD_SIDE_CAP;

/** What the page takes. A GIF gives its first frame. */
export const RESIZE_TYPES: readonly string[] = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const RESIZE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';

/** B5's words for the page, in one place. */
export const RESIZE_WORDS = Object.freeze({
  title: 'Resize pixel art',
  lead: 'Shrink or grow pixel art without blurring it. Free, no account, and your image never leaves your browser.',
  drop: 'Drop an image here or choose a file',
  choose: 'Choose a file',
  another: 'Choose another',
  hint: `PNG, JPEG, WebP or GIF, up to ${DOWNLOAD_SIDE_CAP} px a side.`,
  tooLarge: `That image is larger than ${DOWNLOAD_SIDE_CAP} px a side. Try a smaller one.`,
  wrongType: 'That file is not a PNG, JPEG, WebP or GIF. Choose another.',
  unreadable: 'That image could not be read. Choose another.',
  noGrid: 'No even grid found. Pick the columns and rows.',
  what: 'What is this image?',
  oneImage: 'One image',
  sheet: "It's a sheet",
  change: 'Change',
  columns: 'Columns',
  rows: 'Rows',
  frameSize: 'Frame size',
  size: 'Size',
  bigger: 'Bigger, for posting',
  other: 'Other size...',
  otherTitle: 'Other size',
  width: 'Width',
  height: 'Height',
  cancel: 'Cancel',
  anyway: 'Resize anyway',
  before: 'Before',
  after: 'After',
  download: 'Download PNG',
  resizing: 'Resizing...',
  // A side that is not a size (AUDIT resize-page-r1, M3; DESIGN -090, HQ -093).
  notASize: 'Type a whole number of pixels, 1 or more, for each side.',
  // The preview's choice (DESIGN design/resize/phone-preview/phone-preview.md; HQ -236).
  previewLabel: 'Preview',
  fitEach: 'Fit each',
  sameScale: 'Same scale',
});

/** Is this file one the page takes? By its type, or by its name when the
 *  browser gives no type. */
export function takesFile(file: { type: string; name: string }): boolean {
  if (RESIZE_TYPES.includes(file.type)) return true;
  if (file.type) return false;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

/** The drop zone's line for a file the page cannot take, or null. */
export function fileProblem(file: { type: string; name: string }, width?: number, height?: number): string | null {
  if (!takesFile(file)) return RESIZE_WORDS.wrongType;
  if (width !== undefined && height !== undefined && (width > RESIZE_SIDE_CAP || height > RESIZE_SIDE_CAP)) return RESIZE_WORDS.tooLarge;
  return null;
}

/** A sheet's grid as the page holds it. */
export interface PageGrid {
  columns: number;
  rows: number;
}

/** The detector's guess, kept only when every frame is whole pixels and
 *  there is more than one frame; otherwise there is no guess (B3). */
export function wholeGuess(width: number, height: number, guess: { cols: number; rows: number } | null | undefined): PageGrid | null {
  if (!guess) return null;
  const { cols, rows } = guess;
  if (!isWholeSize(cols) || !isWholeSize(rows) || (cols === 1 && rows === 1)) return null;
  if (width % cols !== 0 || height % rows !== 0) return null;
  return { columns: cols, rows };
}

/** The whole divisors of a side, for the rows and columns picker: every
 *  count that gives frames of whole pixels. */
export function wholeCounts(side: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= side; d++) if (side % d === 0) out.push(d);
  return out;
}

/** "4 by 4 frames of 128 px" ("3 by 1 frames of 24 by 32 px"). */
export function gridLine(width: number, height: number, grid: PageGrid): string {
  return `${grid.columns} by ${grid.rows} frames of ${sizeText(width / grid.columns, height / grid.rows)}`;
}

/** The unit the sizes are for: the whole image, or a sheet's frame. */
export interface Unit {
  width: number;
  height: number;
  columns: number;
  rows: number;
}

export function unitOf(width: number, height: number, grid: PageGrid | null): Unit {
  if (!grid) return { width, height, columns: 1, rows: 1 };
  return { width: width / grid.columns, height: height / grid.rows, columns: grid.columns, rows: grid.rows };
}

/** The two rows of sizes (B2): the start and the smaller whole fractions,
 *  then 2x, 4x and 8x. */
export function sizeRows(unit: Unit): { down: SizeChoice[]; up: SizeChoice[]; noSmaller: string | null; overLine: string | null } {
  const all = sizeChoices(unit.width, unit.height, RESIZE_SIDE_CAP, unit.columns, unit.rows);
  const down = all.filter((c) => c.direction !== 'up');
  const up = all.filter((c) => c.direction === 'up');
  // Says what the page checks: Other size... may still take a smaller clean
  // size under 8 px (AUDIT resize-page-r1, L10; DESIGN -090, HQ -093).
  const noSmaller = down.length === 1 ? `${sizeText(unit.width, unit.height)} has no clean smaller size of 8 px or more.` : null;
  const over = up.filter((c) => c.overCap).map((c) => `${c.factor}x`);
  const overLine = over.length === 0 ? null
    : over.length === 1 ? `${over[0]} would go over the ${RESIZE_SIDE_CAP} px limit.`
      : `${over.slice(0, -1).join(', ')} and ${over[over.length - 1]} would go over the ${RESIZE_SIDE_CAP} px limit.`;
  return { down, up, noSmaller, overLine };
}

/** A pill's words (B5). */
export function pillLabel(choice: SizeChoice): string {
  return sizeChoiceLabel(choice, 'resize');
}

/** What "Other size" is, for its line and its buttons (B2; DESIGN
 *  2026-11-14-249). 'stretched': both sides change by a whole factor, but
 *  by different ones, so nothing is dropped and the shape changes; the
 *  engine's classifySize reports it (BUILD-2 2026-11-14-254). */
export type OtherKind = 'invalid' | 'clean' | 'stretched' | 'uneven-down' | 'uneven-up' | 'uneven-mixed';

export interface OtherState {
  kind: OtherKind;
  width: number | null;
  height: number | null;
  /** The warning, or null. */
  line: string | null;
  /** The size is over the cap: nothing can be applied. */
  overCap: boolean;
  overLine: string | null;
  /** The nearest clean sizes either side, for the uneven kinds. */
  smaller: SizeChoice | null;
  larger: SizeChoice | null;
  /** The main button's words ("Resize to 64 px"), for a clean size. */
  button: string | null;
}

/** Reads a typed side: a whole number of pixels, at least 1, or null. */
export function readSide(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return isWholeSize(n) ? n : null;
}

export function otherState(unit: Unit, widthText: string, heightText: string): OtherState {
  const width = readSide(widthText);
  const height = readSide(heightText);
  const empty: OtherState = { kind: 'invalid', width, height, line: null, overCap: false, overLine: null, smaller: null, larger: null, button: null };
  if (width === null || height === null) return empty;
  const overCap = !passesCap(width, height, RESIZE_SIDE_CAP, unit.columns, unit.rows);
  const overLine = overCap ? `That is larger than ${RESIZE_SIDE_CAP} px a side.` : null;
  const start = sizeText(unit.width, unit.height);
  const size = sizeText(width, height);
  const base = { width, height, overCap, overLine, smaller: null, larger: null, button: null };
  const kind = classifySize(unit.width, unit.height, width, height);
  if (kind === 'clean') return { ...base, kind: 'clean', line: null, button: `Resize to ${size}` };
  if (kind === 'stretched') {
    return { ...base, kind: 'stretched', line: 'Width and height change by different amounts, so the art will be stretched.' };
  }
  const near = nearestCleanSizes(unit.width, unit.height, width, height, RESIZE_SIDE_CAP, unit.columns, unit.rows);
  const line = kind === 'uneven-down'
    ? `${size} is not a whole fraction of ${start}, so rows and columns of pixels will be dropped unevenly.`
    : kind === 'uneven-up'
      ? `${size} is not a whole multiple of ${start}, so some pixels will come out wider than others.`
      : `${size} shrinks one side and grows the other unevenly, so some pixels will be dropped and some will come out wider.`;
  return { ...base, kind, line, smaller: near.smaller, larger: near.larger };
}

/** "Use 132 px": a nearest clean size, offered beside an uneven one. */
export function cleanSizeLabel(choice: SizeChoice): string {
  return `Use ${sizeText(choice.width, choice.height)}`;
}

/**
 * Before and After at one whole-number zoom: the largest at which Before
 * fits the room it has; when even 100% does not fit, both show at 100% and
 * pan together (B4.3). Sides are CSS pixels; under 1 means not measured
 * yet, and 1 is used.
 */
export function previewZoom(width: number, height: number, boxWidth: number, boxHeight: number): { zoom: number; pans: boolean } {
  if (boxWidth < 1 || boxHeight < 1) return { zoom: 1, pans: false };
  const zoom = Math.floor(Math.min(boxWidth / width, boxHeight / height));
  if (zoom < 1) return { zoom: 1, pans: true };
  return { zoom, pans: false };
}

/** Both boxes are as tall as the Before picture plus 12 px above and below,
 *  and as wide as their column, as the mockup draws them; a picture that
 *  pans gets the whole room (DESIGN 2026-11-14-259). */
export const BOX_PAD = 12;
export function boxSize(height: number, zoom: number, pans: boolean, roomWidth: number, roomHeight: number): { width: number; height: number } {
  const width = Math.max(0, roomWidth);
  if (pans) return { width, height: Math.max(0, roomHeight) };
  return { width, height: Math.min(roomHeight, height * zoom + 2 * BOX_PAD) };
}

/** The line under Before and After: "Frame 1 of each, both at 300%." */
export function zoomLine(sheet: boolean, zoom: number): string {
  return sheet ? `Frame 1 of each, both at ${zoom * 100}%.` : `Both at ${zoom * 100}%.`;
}

/** Fit each's margin inside the box, and how far over its room a picture may
 *  be and still show at 100%, panning by those pixels (DESIGN spec 2eae516d). */
export const FIT_PAD = 4;
export const FIT_SLACK = 8;

/**
 * "Fit each" (DESIGN, design/resize/phone-preview/phone-preview.md): a
 * picture smaller than its room grows by the largest whole number that fits,
 * pixels crisp; one at most 8 px over shows at 100% and pans by those pixels;
 * a larger one shrinks to fit, smoothed, so it reads as the whole picture.
 * Only the preview shrinks; the download is untouched. Under 1 means not
 * measured yet, and 1 is used.
 */
export function fitZoom(width: number, height: number, roomWidth: number, roomHeight: number): number {
  if (roomWidth < 1 || roomHeight < 1 || width < 1 || height < 1) return 1;
  if (width <= roomWidth && height <= roomHeight) return Math.max(1, Math.floor(Math.min(roomWidth / width, roomHeight / height)));
  if (width <= roomWidth + FIT_SLACK && height <= roomHeight + FIT_SLACK) return 1;
  return Math.min(roomWidth / width, roomHeight / height);
}

/** In Fit each, a picture at 100% that is a few pixels over its room pans. */
export function fitPans(width: number, height: number, zoom: number, roomWidth: number, roomHeight: number): boolean {
  return zoom === 1 && (width > roomWidth || height > roomHeight);
}

/** How Before and After are shown: each fitted to its box, or at one zoom. */
export type PreviewMode = 'fit' | 'same';

/** "Fit each" by default when either picture would not fit its box at one
 *  zoom (the pan case); otherwise "Same scale", today's view. */
export function defaultPreviewMode(beforeOver: boolean, afterOver: boolean): PreviewMode {
  return beforeOver || afterOver ? 'fit' : 'same';
}

const percent = (zoom: number) => Math.round(zoom * 100);

/** The line under Before and After, for either view (HQ -236's words). */
export function previewLine(sheet: boolean, mode: PreviewMode, zoom: number, view: { beforeZoom: number; afterZoom: number; beforeOver: boolean; afterOver: boolean }): string {
  if (mode === 'fit') {
    const b = percent(view.beforeZoom);
    const a = percent(view.afterZoom);
    if (b === a) return sheet ? `Frame 1 of each, both at ${b}%.` : `Both at ${b}%.`;
    const lead = sheet ? 'Frame 1 of each, fitted to its box' : 'Each fitted to its box';
    return `${lead}: Before at ${b}%, After at ${a}%. Same scale shows both at one zoom.`;
  }
  const z = percent(zoom);
  if (view.beforeOver && view.afterOver) return `Both at ${z}%. Both are larger than their boxes: drag or scroll to see the rest.`;
  if (view.beforeOver) return `Both at ${z}%. Before is larger than its box: drag or scroll it to see the rest.`;
  if (view.afterOver) return `Both at ${z}%. After is larger than its box: drag or scroll it to see the rest.`;
  return zoomLine(sheet, zoom);
}

/** A figure's caption: "Before · frame 1, 128 px" or "After · 256 px". */
export function caption(which: 'before' | 'after', sheet: boolean, width: number, height: number): string {
  const word = which === 'before' ? RESIZE_WORDS.before : RESIZE_WORDS.after;
  return sheet ? `${word} · frame 1, ${sizeText(width, height)}` : `${word} · ${sizeText(width, height)}`;
}

/**
 * The saved name (B4.2; DESIGN 2026-11-14-249): "{name}-{size}px.png", a
 * sheet named by its frame size, and "{name}.png" as is; a name already
 * ending in "-{n}px" has that ending replaced, not added to.
 */
export function downloadName(fileName: string, size: { width: number; height: number } | null): string {
  const dot = fileName.lastIndexOf('.');
  let base = (dot >= 0 ? fileName.slice(0, dot) : fileName).trim();
  if (size) base = base.replace(/-\d+(x\d+)?px$/i, '');
  if (!base) base = 'image';
  if (!size) return `${base}.png`;
  const tag = size.width === size.height ? `${size.width}px` : `${size.width}x${size.height}px`;
  return `${base}-${tag}.png`;
}
