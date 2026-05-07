/**
 * Deterministic jobId so that a duplicate request with the same idempotencyKey
 * collides on the same KV row, enabling request-side dedup.
 * Per Confluence 87490562 §10 (idempotency layering).
 */
export async function deriveJobId(userId: string, idempotencyKey: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${idempotencyKey}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 32);
}
