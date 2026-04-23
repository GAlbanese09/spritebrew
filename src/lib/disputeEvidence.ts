/**
 * Dispute evidence collection — records snapshots for CE 3.0 evidence bundles.
 *
 * KV key: evidence:{stripeChargeId}:{timestamp}
 * TTL: 400 days (covers 365-day Visa CE 3.0 retention + buffer)
 *
 * Evidence is collected automatically on refund/dispute events. Evidence
 * SUBMISSION to Stripe is a manual decision per dispute — not automated.
 */

const EVIDENCE_TTL = 34_560_000; // 400 days

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).put === 'function') return kv as KV;
  return null;
}

export interface EvidenceData {
  userId: string;
  eventType: string;
  stripeEventId: string;
  consentSnapshot: unknown;
  currentBalance: number;
  refundCount: number;
  rawStripeEvent: unknown;
  [key: string]: unknown;
}

/**
 * Record an evidence snapshot for a charge (refund or dispute).
 */
export async function recordEvidenceSnapshot(
  type: 'refund' | 'dispute',
  stripeChargeId: string,
  data: EvidenceData
): Promise<void> {
  const kv = getKV();
  if (!kv) return;

  const timestamp = Date.now();
  const key = `evidence:${stripeChargeId}:${timestamp}`;

  try {
    await kv.put(
      key,
      JSON.stringify({
        type,
        collected_at: new Date().toISOString(),
        ...data,
      }),
      { expirationTtl: EVIDENCE_TTL }
    );
  } catch {
    console.error(`[DisputeEvidence] Failed to write evidence for ${stripeChargeId}`);
  }
}

/**
 * Load the consent snapshot for a Stripe session, if it exists.
 */
export async function loadConsentSnapshot(sessionId: string): Promise<unknown> {
  const kv = getKV();
  if (!kv) return null;

  try {
    const raw = await kv.get(`consent:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
