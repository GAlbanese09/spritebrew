/**
 * Constant-time string compare for secrets such as ADMIN_TOKEN (private-config
 * 001). Both strings are encoded as UTF-8 and compared over a fixed-length
 * buffer, so the time does not depend on where they first differ, and unequal
 * lengths still walk the full buffer. Runs on the edge runtime (no node:crypto).
 */

const FIXED_LENGTH = 256;

export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.max(FIXED_LENGTH, x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) {
    diff |= (i < x.length ? x[i] : 0) ^ (i < y.length ? y[i] : 0);
  }
  return diff === 0;
}
