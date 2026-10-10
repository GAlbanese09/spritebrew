// Types for the parts of gifenc 1.0.3 that src/lib/gifExport.ts uses. The
// package ships no declarations; signatures follow node_modules/gifenc/src.

declare module 'gifenc' {
  export type GifPalette = number[][];

  export interface WriteFrameOptions {
    /** Required on the first frame; it becomes the global color table. A
     *  palette on a later frame is written as a local color table. */
    palette?: GifPalette | null;
    /** Milliseconds; gifenc writes Math.round(delay / 10) centiseconds. */
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** -1 plays once, 0 loops forever, n > 0 repeats n extra times. */
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): Encoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444';
      clearAlpha?: boolean;
      clearAlphaColor?: number;
      clearAlphaThreshold?: number;
      oneBitAlpha?: boolean | number;
      useSqrt?: boolean;
    }
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
  ): Uint8Array;
}
