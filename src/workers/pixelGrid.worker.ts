/**
 * "Fix pixel grid": runs the fixer (public/wasm/pixel-grid.wasm, built from
 * wasm/pixel-grid) off the main thread, so the editor never freezes. The
 * .wasm is fetched on the first request, one request runs at a time, and each
 * gets a fresh instance: WebAssembly memory never shrinks, and a trap leaves
 * an instance unusable.
 */

interface FixerExports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  fix(ptr: number, len: number): number;
  error_ptr(): number;
  error_len(): number;
}

export interface PixelGridRequest {
  id: number;
  png: ArrayBuffer;
}

export type PixelGridReply =
  | { id: number; ok: true; png: ArrayBuffer }
  | { id: number; ok: false; error: string };

// The DOM library types `self` as a Window, whose postMessage differs.
const scope = self as unknown as {
  location: Location;
  onmessage: ((e: MessageEvent<PixelGridRequest>) => void) | null;
  postMessage(reply: PixelGridReply, transfer?: Transferable[]): void;
};

let compiled: WebAssembly.Module | null = null;

async function newInstance(): Promise<WebAssembly.Instance> {
  if (compiled) return WebAssembly.instantiate(compiled, {});
  // From the origin, not a relative path: a bundler may start this worker
  // from a blob: URL, which a relative path cannot resolve against.
  const res = await fetch(new URL('/wasm/pixel-grid.wasm', scope.location.origin));
  if (!res.ok) throw new Error(`pixel-grid.wasm: HTTP ${res.status}`);
  let source: WebAssembly.WebAssemblyInstantiatedSource;
  try {
    source = await WebAssembly.instantiateStreaming(res.clone(), {});
  } catch {
    // A host that serves it with another content type.
    source = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  }
  compiled = source.module;
  return source.instance;
}

function errorText(e: FixerExports): string {
  return new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.error_ptr(), e.error_len()));
}

/** The fixed image's PNG bytes, or throws with the fixer's error text. */
function fix(e: FixerExports, input: Uint8Array): ArrayBuffer {
  const ptr = e.alloc(input.length);
  if (ptr === 0) throw new Error('out of memory');
  new Uint8Array(e.memory.buffer, ptr, input.length).set(input);
  const result = e.fix(ptr, input.length);
  e.dealloc(ptr, input.length);
  if (result === 0) throw new Error(errorText(e));
  // The fixer grew the memory, so views are made from here on: [u32 length]
  // [PNG bytes], and the whole block goes back when they are copied out.
  const length = new DataView(e.memory.buffer).getUint32(result, true);
  const png = e.memory.buffer.slice(result + 4, result + 4 + length);
  e.dealloc(result, length + 4);
  return png;
}

async function handle({ id, png }: PixelGridRequest): Promise<void> {
  let exports: FixerExports | null = null;
  try {
    const instance = await newInstance();
    exports = instance.exports as unknown as FixerExports;
    const output = fix(exports, new Uint8Array(png));
    scope.postMessage({ id, ok: true, png: output }, [output]);
  } catch (err) {
    // A panic traps, but the fixer stores its text first.
    const text = exports ? errorText(exports) : '';
    scope.postMessage({ id, ok: false, error: text || (err instanceof Error ? err.message : 'failed') });
  }
}

let queue: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  queue = queue.then(() => handle(e.data));
};
