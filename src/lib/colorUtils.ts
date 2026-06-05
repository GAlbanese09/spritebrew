/**
 * Shared color utilities for the editor and the project document model.
 *
 * Wave 1b lift: hexToRgb previously lived module-private in editorStore.ts.
 * Hoisted here so both editorStore (paint hot path) and spriteProject
 * (validator + future palette ingestion) parse colors identically.
 *
 * Pure functions — no React, no Zustand, safe to call from any context.
 */

/**
 * Parse a CSS hex color into [r, g, b, a] bytes (0–255). Accepts #RGB, #RGBA,
 * #RRGGBB, #RRGGBBAA. Expands 3/4-digit shorthand the standard way (#abc →
 * #aabbcc, #abcd → #aabbccdd). Returns null on any malformed input — callers
 * MUST no-op rather than coerce a bad parse to NaN→0 (silent black).
 *
 * Behavior is byte-identical to the Wave 1a editorStore-private version.
 */
export function hexToRgb(hex: string): [number, number, number, number] | null {
  if (typeof hex !== 'string') return null;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) {
    // Expand shorthand: each nibble doubled. #abc → #aabbcc, #abcd → #aabbccdd.
    h = h.split('').map((c) => c + c).join('');
  }
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

// Dev-only round-trip assertions for hexToRgb. Stripped in production.
if (process.env.NODE_ENV !== 'production') {
  console.assert(
    JSON.stringify(hexToRgb('#ff8800')) === JSON.stringify([255, 136, 0, 255]),
    'hexToRgb #ff8800',
  );
  console.assert(
    JSON.stringify(hexToRgb('#abc')) === JSON.stringify([170, 187, 204, 255]),
    'hexToRgb #abc shorthand expansion',
  );
  console.assert(
    JSON.stringify(hexToRgb('#abcd')) === JSON.stringify([170, 187, 204, 221]),
    'hexToRgb #abcd shorthand expansion',
  );
  console.assert(
    JSON.stringify(hexToRgb('#ff880080')) === JSON.stringify([255, 136, 0, 128]),
    'hexToRgb #ff880080 8-digit alpha',
  );
  console.assert(hexToRgb('#zz') === null, 'hexToRgb #zz rejects non-hex');
  console.assert(hexToRgb('garbage') === null, 'hexToRgb garbage rejects');
  console.assert(hexToRgb('') === null, 'hexToRgb empty rejects');
  console.assert(hexToRgb('#fffff') === null, 'hexToRgb 5-digit rejects');
}
