/**
 * Turns a picture to face the other way, on this device, for free: no tokens,
 * no network call, no Gallery write (DESIGN, design/tickets/builder-create.md
 * section 8; design/generate-pass/generate-pass.md section 7, ticket G0).
 * The result card's "Face the other way, free" (G3) and the Animate side
 * (G4) use it.
 *
 * Pixel (x, y) of the result is pixel (width - 1 - x, y) of the picture,
 * alpha included, so turning a picture twice gives its pixels back. Nothing
 * is smoothed or blended: every pixel is a copy of one source pixel.
 *
 * mirrorPixels is pure and node tests it. mirrorX takes the browser
 * boundary (decode a data URL to pixels, encode pixels to a PNG data URL) as
 * an argument, so the offline test drives the same path the page runs
 * (scripts/generate-groundwork-test.mjs).
 */

import { pixelsToPngDataUrl } from './editorImage';
import type { PixelImage } from './pixelResize';

/** The picture turned left to right. Never changes the picture it is given. */
export function mirrorPixels(image: PixelImage): PixelImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const to = row + x * 4;
      const from = row + (width - 1 - x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width, height, data: out };
}

/** The browser boundary: a data URL to pixels and pixels to a PNG data URL. */
export interface MirrorIo {
  decode: (dataUrl: string) => Promise<PixelImage>;
  encode: (image: PixelImage) => string;
}

/** The page's boundary: the picture drawn at its own size, unsmoothed, and
 *  read back; the result written with putImageData, which replaces bytes, so
 *  a fully transparent pixel stays fully transparent. */
export const BROWSER_MIRROR_IO: MirrorIo = {
  decode: (dataUrl) =>
    new Promise<PixelImage>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx || width === 0 || height === 0) {
          reject(new Error('The picture could not be read.'));
          return;
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
        const read = ctx.getImageData(0, 0, width, height);
        resolve({ width, height, data: read.data });
      };
      img.onerror = () => reject(new Error('The picture could not be read.'));
      img.src = dataUrl;
    }),
  encode: (image) => pixelsToPngDataUrl(image.data, image.width, image.height),
};

/** The picture in `dataUrl` turned left to right, as a PNG data URL. */
export async function mirrorX(dataUrl: string, io: MirrorIo = BROWSER_MIRROR_IO): Promise<string> {
  const image = await io.decode(dataUrl);
  return io.encode(mirrorPixels(image));
}
