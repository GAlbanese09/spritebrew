import JSZip from 'jszip';

/** Trigger a browser download of a single file. */
export function downloadFile(data: Blob | string, filename: string): void {
  const blob =
    typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Package multiple files into a ZIP and trigger download. */
export async function downloadAsZip(
  files: { name: string; data: Blob | string }[],
  zipFilename: string
): Promise<void> {
  const zip = new JSZip();
  for (const file of files) {
    if (typeof file.data === 'string') {
      zip.file(file.name, file.data);
    } else {
      zip.file(file.name, file.data);
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadFile(blob, zipFilename);
}

/** Convert a canvas to a PNG Blob. */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to convert canvas to blob'));
    }, 'image/png');
  });
}

/**
 * Assemble frame canvases into a grid sprite sheet.
 * Returns the assembled canvas.
 */
export function assembleGridSheet(
  frames: HTMLCanvasElement[],
  columns: number,
  padding: number,
  powerOfTwo: boolean
): HTMLCanvasElement {
  if (frames.length === 0) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c;
  }

  const fw = frames[0].width;
  const fh = frames[0].height;
  const rows = Math.ceil(frames.length / columns);

  let sheetW = columns * fw + (columns - 1) * padding;
  let sheetH = rows * fh + (rows - 1) * padding;

  if (powerOfTwo) {
    sheetW = nextPowerOfTwo(sheetW);
    sheetH = nextPowerOfTwo(sheetH);
  }

  const canvas = document.createElement('canvas');
  canvas.width = sheetW;
  canvas.height = sheetH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < frames.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * (fw + padding);
    const y = row * (fh + padding);
    ctx.drawImage(frames[i], x, y);
  }

  return canvas;
}

/** Assemble frame canvases into a single horizontal strip. */
export function assembleStripSheet(frames: HTMLCanvasElement[]): HTMLCanvasElement {
  if (frames.length === 0) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c;
  }

  const fw = frames[0].width;
  const fh = frames[0].height;

  const canvas = document.createElement('canvas');
  canvas.width = fw * frames.length;
  canvas.height = fh;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < frames.length; i++) {
    ctx.drawImage(frames[i], i * fw, 0);
  }

  return canvas;
}

/** Resize a frame canvas with nearest-neighbor interpolation. */
export function resizeFrame(
  frame: HTMLCanvasElement,
  newWidth: number,
  newHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame, 0, 0, newWidth, newHeight);
  return canvas;
}

/** Sanitize a filename: lowercase, replace spaces/special chars with underscores. */
export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
