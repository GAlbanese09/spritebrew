// Admin-only failure-rate scan over the token_tx: KV namespace.
//
// Auth: x-admin-token header must match env.ADMIN_TOKEN (set as a Worker
// secret via `wrangler secret put ADMIN_TOKEN --env production`). No
// Clerk session check; this is an ops/observability surface.
//
// Output: counts of generation attempts vs RD-failure refunds for one slice
// of the 90-day token_tx: retention window, per style where known.
//
// Bounded work per call (2026-09-18). The previous version listed in pages of
// 1000 and issued one kv.get per key; against a 13k-key ledger the first page
// alone was over the 1000-subrequest ceiling and the route had never returned
// in production. Now:
//   - One list() call per invocation, of at most `limit` keys (?limit=,
//     default DEFAULT_LIMIT, hard cap MAX_LIMIT), resumed from ?cursor=.
//   - Rows written after the tx-metadata rollout carry TxMetadata
//     { type, reason, style, mode, size } as KV metadata and are counted from
//     the list() result at no extra subrequest cost.
//   - Only rows without metadata (historical) cost a get(), so gets per call
//     are bounded by `limit`. Worst case at the cap: 1 list + 800 gets, inside
//     the ceiling with headroom.
//   - The response is a partial for the keys examined; `next_cursor` is null
//     when the prefix is exhausted. A caller loops until it is null and sums
//     the partials. As the 90-day window rolls past the rollout the walk
//     needs no gets at all.

export const runtime = 'edge';

import type { TxMetadata } from '@/lib/tokenTxMeta';

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

// Shape of the JSON value written by the historical (pre-metadata) write paths
// in tokenBalance.ts / tokenDebit.ts / the consumer's refund.ts. Only the
// fields we consume are listed; the rest are ignored.
interface TxRecord {
  type?: 'credit' | 'debit';
  reason?: string;
  /** Never populated by the historical paths; kept so a get() fallback and a
   *  metadata hit tally through the same code. */
  style?: string;
}

/** What the tally needs from a row, whichever source it came from. */
type TxClass = Pick<TxRecord, 'type' | 'reason' | 'style'>;

/** Keys examined per call when ?limit= is absent. */
const DEFAULT_LIMIT = 500;
/** Hard cap on keys examined per call. Every key may cost a get(), so this is
 *  also the get budget: 800 + 1 list stays inside the 1000-subrequest ceiling
 *  with headroom. KV list() itself accepts up to 1000, so one call suffices. */
const MAX_LIMIT = 800;
/** Concurrent get() fan-out for historical keys. Workers queue connections
 *  past the runtime's concurrency limit rather than failing them, so this is
 *  about not holding hundreds of promises at once, not correctness. */
const GET_BATCH = 50;

/**
 * The row's TxMetadata if list() returned one we can classify from, else null
 * (historical row, or metadata of an unexpected shape) so the caller falls
 * back to get(). `type` and `reason` are the two fields every writer sets.
 */
function metadataOf(k: KVListKey): TxMetadata | null {
  const m = k.metadata;
  if (!m || typeof m !== 'object') return null;
  const meta = m as Partial<TxMetadata>;
  if (typeof meta.type !== 'string' || typeof meta.reason !== 'string') return null;
  return meta as TxMetadata;
}

/** ?limit= parsed and clamped to [1, MAX_LIMIT]; DEFAULT_LIMIT when absent or unparseable. */
function parseLimit(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

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

  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params.get('limit'));
  // Resume point from a previous response. Passed to kv.list verbatim; KV
  // rejects a malformed cursor and that surfaces as the 502 below.
  const cursor = params.get('cursor') || undefined;

  let attempts = 0;
  let failures = 0;
  // Rows counted in the totals but not in byStyle because they carry no style.
  // Historical rows never do; going forward, refunds issued by the consumer's
  // stale-running cron sweep carry mode only (the running record holds no
  // style or size), so per-style failures under-report by exactly this much
  // while per-style attempts stay complete. Surfaced rather than hidden.
  let attemptsWithoutStyle = 0;
  let failuresWithoutStyle = 0;
  const byStyle: Record<string, { attempts: number; failures: number }> = {};

  const tally = (tx: TxClass): void => {
    const isGenerationAttempt = tx.type === 'debit' && tx.reason === 'generation';
    const isGenerationFailure =
      tx.type === 'credit' && tx.reason === 'generation_failed_refund';
    if (!isGenerationAttempt && !isGenerationFailure) return;

    const style = typeof tx.style === 'string' && tx.style.length > 0 ? tx.style : null;

    if (isGenerationAttempt) {
      attempts++;
      if (style) {
        (byStyle[style] ??= { attempts: 0, failures: 0 }).attempts++;
      } else {
        attemptsWithoutStyle++;
      }
    } else {
      failures++;
      if (style) {
        (byStyle[style] ??= { attempts: 0, failures: 0 }).failures++;
      } else {
        failuresWithoutStyle++;
      }
    }
  };

  let page: KVListResult;
  try {
    page = await kv.list({ prefix: 'token_tx:', limit, cursor });
  } catch (err) {
    return Response.json(
      { success: false, error: `KV list failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  // Metadata first; only rows without it cost a get().
  let metadataHits = 0;
  const needGet: string[] = [];
  for (const k of page.keys) {
    const meta = metadataOf(k);
    if (meta) {
      metadataHits++;
      tally(meta);
    } else {
      needGet.push(k.name);
    }
  }

  let getsIssued = 0;
  for (let i = 0; i < needGet.length; i += GET_BATCH) {
    const batch = needGet.slice(i, i + GET_BATCH);
    getsIssued += batch.length;
    const records = await Promise.all(
      batch.map((name) => kv.get<TxRecord>(name, 'json').catch(() => null))
    );
    for (const tx of records) {
      if (tx && typeof tx === 'object') tally(tx);
    }
  }

  const nextCursor = page.list_complete || !page.cursor ? null : page.cursor;

  // Per-style buckets with computed rate strings. Empty when no examined row
  // carried style info (historical rows never do).
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
    scanned: page.keys.length,
    attempts,
    failures,
    rate: rate(failures, attempts),
    byStyle: byStyleFormatted,
    attemptsWithoutStyle,
    failuresWithoutStyle,
    next_cursor: nextCursor,
    _scan: {
      keysExamined: page.keys.length,
      getsIssued,
      metadataHits,
      limit,
      resumedFromCursor: Boolean(cursor),
      windowDays: 90,
    },
  };

  if (nextCursor) {
    body._note =
      'Partial: counts cover only the keys examined in this call. Repeat with ?cursor=<next_cursor> until next_cursor is null and sum the partials.';
  }
  body._styleNote =
    'attemptsWithoutStyle and failuresWithoutStyle are in the totals but not in byStyle. Rows written before the 2026-09-18 tx-metadata rollout carry no style and age out over the 90-day window. Refunds issued by the consumer stale-running sweep carry no style by design (the running record holds mode only), so per-style failure rates under-report by failuresWithoutStyle while per-style attempts are complete.';

  return Response.json(body);
}
