// Admin-only failure-rate scan over the token_tx: KV namespace.
//
// Auth: x-admin-token header must match env.ADMIN_TOKEN (set as a Worker
// secret via `wrangler secret put ADMIN_TOKEN --env production`). No
// Clerk session check — this is an ops/observability surface.
//
// Output: counts of generation attempts vs RD-failure refunds across the
// 90-day token_tx: retention window.
//
// Schema note: the current debit and refund-credit write paths in
// tokenBalance.ts do NOT populate the optional `style` field on
// TransactionRecord, so per-style breakdown is empty today. `byStyle`
// stays in the response shape per spec (with `_dataGap` note) so a
// future migration that backfills style can populate it without
// changing the response contract.

export const runtime = 'edge';

interface KVListKey {
  name: string;
  expiration?: number;
  metadata?: unknown;
}

interface KVListResult {
  keys: KVListKey[];
  list_complete: boolean;
  cursor?: string;
}

interface KV {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<KVListResult>;
}

function getKV(): KV | null {
  const kv = (process.env as Record<string, unknown>).SPRITEBREW_KV;
  if (kv && typeof (kv as KV).list === 'function' && typeof (kv as KV).get === 'function') {
    return kv as KV;
  }
  return null;
}

// Exact shape written by tokenBalance.ts::writeTx — both debit and credit paths.
// Only the fields we actually consume are listed; the rest are ignored.
interface TxRecord {
  type?: 'credit' | 'debit';
  reason?: string;
  /** Not populated by current code paths; kept here for the future migration
   *  that backfills style onto tx records. */
  style?: string;
}

const PAGE_SIZE = 1000;

/**
 * Compute and stringify a failure-rate percentage to one decimal place.
 * Returns `'0.0%'` when the denominator is zero so the response shape is stable.
 */
function rate(failures: number, attempts: number): string {
  if (attempts <= 0) return '0.0%';
  return `${((failures / attempts) * 100).toFixed(1)}%`;
}

export async function GET(request: Request): Promise<Response> {
  const adminToken = (process.env as Record<string, unknown>).ADMIN_TOKEN as string | undefined;
  if (!adminToken) {
    return Response.json(
      { success: false, error: 'ADMIN_TOKEN not configured on this environment.' },
      { status: 500 }
    );
  }

  const provided = request.headers.get('x-admin-token');
  if (!provided || provided !== adminToken) {
    return Response.json({ success: false, error: 'forbidden' }, { status: 403 });
  }

  const kv = getKV();
  if (!kv) {
    return Response.json(
      { success: false, error: 'KV namespace unavailable.' },
      { status: 503 }
    );
  }

  let totalAttempts = 0;
  let totalFailures = 0;
  const byStyle: Record<string, { attempts: number; failures: number }> = {};

  let cursor: string | undefined;
  let pagesScanned = 0;
  let keysScanned = 0;

  // Paginate through token_tx: in PAGE_SIZE chunks; gets within a page run
  // in parallel to stay well under the Worker CPU budget.
  do {
    const page = await kv.list({ prefix: 'token_tx:', limit: PAGE_SIZE, cursor });
    pagesScanned++;
    keysScanned += page.keys.length;

    const records = await Promise.all(
      page.keys.map((k) =>
        kv.get<TxRecord>(k.name, 'json').catch(() => null)
      )
    );

    for (const tx of records) {
      if (!tx || typeof tx !== 'object') continue;

      const isGenerationAttempt = tx.type === 'debit' && tx.reason === 'generation';
      const isGenerationFailure =
        tx.type === 'credit' && tx.reason === 'generation_failed_refund';

      if (!isGenerationAttempt && !isGenerationFailure) continue;

      const style = typeof tx.style === 'string' && tx.style.length > 0 ? tx.style : null;

      if (isGenerationAttempt) {
        totalAttempts++;
        if (style) {
          (byStyle[style] ??= { attempts: 0, failures: 0 }).attempts++;
        }
      } else {
        totalFailures++;
        if (style) {
          (byStyle[style] ??= { attempts: 0, failures: 0 }).failures++;
        }
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // Format the per-style buckets with computed rate strings. Empty when no
  // tx records carry style info (current state — see top-of-file note).
  const byStyleFormatted: Record<string, { attempts: number; failures: number; rate: string }> = {};
  for (const [style, counts] of Object.entries(byStyle)) {
    byStyleFormatted[style] = {
      attempts: counts.attempts,
      failures: counts.failures,
      rate: rate(counts.failures, counts.attempts),
    };
  }

  const body: Record<string, unknown> = {
    asOf: new Date().toISOString(),
    totalAttempts,
    totalFailures,
    overallFailureRate: rate(totalFailures, totalAttempts),
    byStyle: byStyleFormatted,
    _scan: {
      pagesScanned,
      keysScanned,
      windowDays: 90,
    },
  };

  if (Object.keys(byStyleFormatted).length === 0) {
    body._note =
      'Per-style breakdown is empty: the current debit and refund-credit code paths in src/lib/tokenBalance.ts do not write the `style` field onto TransactionRecord. Backfill required for per-style rates.';
  }

  return Response.json(body);
}
