/**
 * Editor image helpers — shared serialization for "edited pixels → PNG dataURL".
 *
 * The same offscreen-canvas + putImageData + toDataURL recipe used to live
 * inline in three places: PixelEditorBody.renderToDataUrl, PixelEditor's
 * saveAndCloseFromConfirm, and the page-mode doSaveAsDownload (via
 * renderToDataUrl). Single helper now backs all three — keeps the recipe
 * canonical so any future format/quality tweak lands in one spot.
 *
 * Pure module — no React, no store. Safe to call from anywhere with access
 * to a runtime pixel buffer.
 */

/**
 * Serialize a raw RGBA pixel buffer to a base64 PNG data URL.
 *
 * - The buffer is wrapped in a fresh Uint8ClampedArray so the underlying
 *   ArrayBuffer cannot be a SharedArrayBuffer (which `new ImageData(...)`
 *   would reject at runtime) and so the caller's buffer is decoupled from
 *   the canvas write.
 * - `putImageData` REPLACES bytes (no source-over composite), so alpha=0
 *   regions stay transparent in the output PNG.
 * - Width × height MUST match pixels.length / 4 or the canvas paint is wrong.
 */
export function pixelsToPngDataUrl(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas.toDataURL('image/png');
}
