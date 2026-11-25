/**
 * The result card's white outline clean (DESIGN's ticket
 * design/tickets/outline-clean.md, section 2): read a picture, scan it with
 * scanOutline, and make the two pictures the card shows, the cleaned one and
 * the one with the outline marked in the editor's residue cyan. In the
 * browser only (it decodes with an image and a canvas); the scan itself is
 * pure and tested offline (scripts/outline-clean-test.mjs).
 */

import { OUTLINE_CLEAR, scanOutline } from './outlineClean';
import { OVERLAY_CLEAR } from './residueCleanup';
import { loadImage } from './spriteUtils';

export interface PictureOutline {
  /** How many pixels the clean takes; 0 when nothing is offered. */
  n: number;
  /** The picture with the outline cleared to (0,0,0,0) ('' when n is 0). */
  cleanedUrl: string;
  /** The picture with the outline marked ('' when n is 0). */
  markedUrl: string;
}

export async function outlineOfPicture(src: string): Promise<PictureOutline> {
  const img = await loadImage(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || W === 0 || H === 0) return { n: 0, cleanedUrl: '', markedUrl: '' };
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H);
  const { kinds, count } = scanOutline(data.data, W, H);
  if (count === 0) return { n: 0, cleanedUrl: '', markedUrl: '' };
  const cleaned = new ImageData(new Uint8ClampedArray(data.data), W, H);
  const marked = new ImageData(new Uint8ClampedArray(data.data), W, H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (kinds[p] !== OUTLINE_CLEAR) continue;
    cleaned.data[i] = 0;
    cleaned.data[i + 1] = 0;
    cleaned.data[i + 2] = 0;
    cleaned.data[i + 3] = 0;
    marked.data[i] = OVERLAY_CLEAR[0];
    marked.data[i + 1] = OVERLAY_CLEAR[1];
    marked.data[i + 2] = OVERLAY_CLEAR[2];
    marked.data[i + 3] = 255;
  }
  ctx.putImageData(cleaned, 0, 0);
  const cleanedUrl = canvas.toDataURL('image/png');
  ctx.putImageData(marked, 0, 0);
  const markedUrl = canvas.toDataURL('image/png');
  return { n: count, cleanedUrl, markedUrl };
}
