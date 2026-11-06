/**
 * The page's side of "Fix pixel grid". The worker, and so the .wasm, exists
 * only once someone uses the action: neither is in the main bundle.
 */
import type { PixelGridReply, PixelGridRequest } from '@/workers/pixelGrid.worker';

/** A fix on a large image takes about 2 s on a laptop; this is for a device
 *  far slower than that, or a worker that never answers. */
const FIX_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let nextId = 0;
let inFlight: { reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;

/** Ends the worker and fails any request under way. The next call starts a
 *  new worker. */
export function terminatePixelGrid(): void {
  worker?.terminate();
  worker = null;
  if (inFlight) {
    clearTimeout(inFlight.timer);
    inFlight.reject(new Error('Fix pixel grid stopped'));
    inFlight = null;
  }
}

/** Runs the fixer on a PNG, one request at a time, and gives the fixed PNG.
 *  Rejects when the fixer refuses, the worker or the .wasm cannot load, or
 *  the time runs out. `png` is handed over to the worker. */
export function fixPixelGrid(png: ArrayBuffer): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (inFlight) {
      reject(new Error('Fix pixel grid is already running'));
      return;
    }
    const w = (worker ??= new Worker(new URL('../workers/pixelGrid.worker.ts', import.meta.url)));
    const id = ++nextId;
    const timer = setTimeout(() => {
      terminatePixelGrid();
    }, FIX_TIMEOUT_MS);
    inFlight = { reject, timer };
    w.onmessage = (e: MessageEvent<PixelGridReply>) => {
      const reply = e.data;
      if (reply.id !== id) return;
      clearTimeout(timer);
      inFlight = null;
      if (reply.ok) resolve(reply.png);
      else reject(new Error(reply.error));
    };
    // The worker's script did not load, or it died: start over next time.
    w.onerror = (e) => {
      e.preventDefault();
      terminatePixelGrid();
    };
    const request: PixelGridRequest = { id, png };
    w.postMessage(request, [png]);
  });
}
