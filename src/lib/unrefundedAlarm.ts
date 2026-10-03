/**
 * One `generation.unrefunded` row in the D1 event ledger (`EVENTS_DB`,
 * `spritebrew-events`), written by the Pages app when a compensating refund
 * it owes could not be credited (n1-ledger.md 008 ruling G). The morning
 * digest lists these rows under "Dead letters not refunded" so George settles
 * each by hand.
 *
 * The row mirrors the consumer's writer (spritebrew-rd-consumer/src/events.ts:
 * the same canonical object, stable JSON and SHA-256), narrowed to this one
 * event. It never throws, but it is strict (n1-ledger-02.md 002 ruling B):
 * it answers whether a row with its dedupe key exists afterwards, so the
 * caller can log the debt when it does not.
 */

interface D1Like {
  prepare(sql: string): {
    bind(...v: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

export const NY_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = sort(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recordUnrefundedAlarm(args: {
  userId: string;
  jobId?: string;
  tokenCost: number;
  reason: string;
  /** The generate request, and its refund's idempotency key (`refund:{requestId}`),
   *  so whoever settles it can check the evidence first (ruling C). */
  requestId?: string;
  idempotencyKey?: string;
  balanceWritten?: boolean;
  detail?: string;
}): Promise<boolean> {
  try {
    const env = process.env as Record<string, unknown>;
    const db = env.EVENTS_DB as D1Like | undefined;
    if (!db || typeof db.prepare !== 'function') {
      console.error(JSON.stringify({ source: 'unrefunded-alarm', event: 'write_failed', reason: args.reason, error: 'EVENTS_DB unbound' }));
      return false;
    }
    const eventId = crypto.randomUUID();
    const occurredAtMs = Date.now();
    const environment = typeof env.APP_ENV === 'string' && env.APP_ENV ? env.APP_ENV : 'unknown';
    const dedupeKey = `${args.jobId ?? `pages:${eventId}`}:generation.unrefunded`;
    const canonical = {
      schemaVersion: 1,
      eventId,
      dedupeKey,
      eventName: 'generation.unrefunded',
      level: 'error',
      occurredAtMs,
      occurredAt: new Date(occurredAtMs).toISOString(),
      reportingDay: NY_DAY.format(new Date(occurredAtMs)),
      ingestedAtMs: occurredAtMs,
      environment,
      sourceService: 'spritebrew-pages',
      userId: args.userId,
      jobId: args.jobId,
      requestId: args.requestId,
      errorCode: args.reason,
      extra: {
        reason: args.reason,
        tokenCost: args.tokenCost,
        idempotencyKey: args.idempotencyKey,
        balanceWritten: args.balanceWritten,
        detail: args.detail?.slice(0, 500),
      },
    };
    const eventJson = stableStringify(canonical);
    await db
      .prepare(
        `INSERT OR IGNORE INTO events (event_id, dedupe_key, schema_version, event_name, level,
           occurred_at_ms, reporting_day, ingested_at_ms, environment, source_service,
           user_id, job_id, request_id, error_code, event_json, event_sha256)
         VALUES (?1, ?2, 1, 'generation.unrefunded', 'error', ?3, ?4, ?3, ?5, 'spritebrew-pages',
           ?6, ?7, ?8, ?9, ?10, ?11)`
      )
      .bind(eventId, dedupeKey, occurredAtMs, canonical.reportingDay, environment,
        args.userId, args.jobId ?? null, args.requestId ?? null, args.reason, eventJson, await sha256Hex(eventJson))
      .run();
    // INSERT OR IGNORE also ignores a failed CHECK: the row counts only if
    // one holds the dedupe key now (a duplicate from an earlier try counts).
    const row = await db
      .prepare('SELECT 1 AS ok FROM events WHERE dedupe_key = ?1')
      .bind(dedupeKey)
      .first<{ ok: number }>();
    if (row) return true;
    console.error(JSON.stringify({ source: 'unrefunded-alarm', event: 'write_failed', reason: args.reason, error: 'insert ignored' }));
    return false;
  } catch (err) {
    console.error(JSON.stringify({
      source: 'unrefunded-alarm',
      event: 'write_failed',
      reason: args.reason,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    }));
    return false;
  }
}
