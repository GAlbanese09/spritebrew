/// <reference lib="webworker" />
/**
 * Runs the engine's resize off the page's thread, so a large image does not
 * freeze /resize (DESIGN design/tickets/editor-tools-batch.md v4.1, B4.3).
 * One message in, one out; the pixels move, they are not copied.
 */
import { resizeImage } from './pixelResize';

interface ResizeAsk {
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  toWidth: number;
  toHeight: number;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ResizeAsk>) => {
  const { id, width, height, data, toWidth, toHeight } = event.data;
  try {
    const out = resizeImage({ width, height, data }, toWidth, toHeight);
    scope.postMessage({ id, ok: true, width: out.width, height: out.height, data: out.data }, [out.data.buffer]);
  } catch (error) {
    scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
