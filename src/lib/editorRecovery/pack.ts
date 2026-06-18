/**
 * editorRecovery / pack.ts — serialization + integrity helpers.
 *
 * Browser APIs only: CompressionStream/DecompressionStream (with an
 * uncompressed fallback when unavailable — older Safari, some webviews),
 * crypto.subtle.digest for SHA-256, and the Blob constructor for the
 * synchronous-snapshot guarantee.
 *
 * No dependencies on idb or types.ts beyond the SpriteProjectV1 type — kept
 * intentionally pure so the same helpers can back a remote (R2) adapter.
 */

import type { SpriteProjectV1 } from '@/lib/spriteProject';

/** Feature-detect CompressionStream. Older Safari / locked-down webviews
 *  may not have it; we fall back to an uncompressed Blob so saves still
 *  work — the manifest records `compression: 'none'` so gunzipToBytes can
 *  reverse it correctly. */
function hasCompressionStream(): boolean {
  return typeof globalThis !== 'undefined' && 'CompressionStream' in globalThis;
}

/**
 * Compress raw bytes to a Blob via gzip, or fall back to an uncompressed
 * Blob if CompressionStream is unavailable.
 *
 * CRITICAL: the input bytes are snapshotted synchronously at call time by
 * wrapping them in a `new Blob([bytes])`, whose constructor copies the
 * backing memory. This means a save's payload is immutable from the moment
 * gzipBytes returns its Blob, even if the editor mutates the source buffer
 * mid-gzip. Without this guarantee the SHA-256 we compute later could
 * disagree with the bytes actually persisted.
 */
export async function gzipBytes(
  bytes: Uint8Array,
): Promise<{ blob: Blob; compression: 'gzip' | 'none' }> {
  // Synchronous snapshot via a fresh ArrayBuffer-backed copy. `new Uint8Array(bytes)`
  // (a) copies the bytes into a freshly-allocated ArrayBuffer, decoupling the payload
  // from any subsequent mutation of the source buffer, AND (b) satisfies TS's stricter
  // `Uint8Array<ArrayBufferLike>` typing — the Blob constructor's BlobPart requires
  // an ArrayBuffer-backed view, not a SharedArrayBuffer-backed one.
  const snapshot = new Uint8Array(bytes);
  const source = new Blob([snapshot]);

  if (!hasCompressionStream()) {
    return { blob: source, compression: 'none' };
  }

  // Pipe the snapshotted bytes through a gzip CompressionStream and
  // materialize the result as a single Blob via Response. This is the
  // standard idiom — Response#blob() drains the ReadableStream into one
  // Blob without us managing the queue manually.
  const compressed = source.stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(compressed).blob();
  return { blob, compression: 'gzip' };
}

/**
 * Inverse of gzipBytes. When `compression === 'gzip'`, pipe through
 * DecompressionStream; otherwise read the Blob's bytes verbatim. Returns
 * Uint8ClampedArray because that's the editor's native pixel-buffer type.
 */
export async function gunzipToBytes(
  blob: Blob,
  compression: 'gzip' | 'none',
): Promise<Uint8ClampedArray> {
  if (compression === 'gzip') {
    const decompressed = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const arrayBuf = await new Response(decompressed).arrayBuffer();
    return new Uint8ClampedArray(arrayBuf);
  }
  const arrayBuf = await blob.arrayBuffer();
  return new Uint8ClampedArray(arrayBuf);
}

/**
 * SHA-256 of a Blob's bytes, returned as a 64-char lowercase hex string.
 * Drives the integrity check that lets loadDraft fall back from the current
 * payload to the previous one without trusting either uncritically.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const view = new Uint8Array(digest);
  // Hex encode without a per-byte string allocation hot path.
  let out = '';
  for (let i = 0; i < view.length; i++) {
    const b = view[i];
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/**
 * Build the cheap-render summary stored on the manifest. The restore banner
 * uses this without paying for a payload unpack — dims and frame count are
 * enough to say "256×256, 8 frames, ~30s ago". Pure read off the envelope.
 */
export function summarizeProject(
  project: SpriteProjectV1,
): { width: number; height: number; frameCount: number } {
  return {
    width: project.canvas.width,
    height: project.canvas.height,
    frameCount: project.frames.length,
  };
}
