/**
 * Rows the Pages app writes to the D1 event ledger (`EVENTS_DB`,
 * `spritebrew-events`). The canonical object, stable JSON and SHA-256 mirror
 * the consumer's writer (spritebrew-rd-consumer/src/events.ts).
 *
 * Release 2 (n1-release-2-spec.md revision 9, S4) writes one kind from Pages:
 * the `ledger.alarm` row (4.0, O8), `error_code` = the alarm's kind, deduped
 * by kind and subject (`{kind}:{jobId}`, `{kind}:{userId}` or
 * `{kind}:{eventId}`). An alarm is best effort, never money proof (`S2 010`
 * 6): the debt always lives in a `jobs` or `ledger` row. The writer never
 * throws, and each statement is bounded (2 s), so a hung EVENTS_DB never
 * holds a route.
 */

import { withTimeout } from '@/lib/moneyPause';

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

/** The kinds Pages raises (4.0's list; the consumer raises the others). */
export type PagesAlarmKind =
  | 'zero_alarm' | 'unique_mismatch' | 'stripe_no_evidence' | 'stripe_mapping_missing' | 'debit_missing';

/**
 * One `ledger.alarm` row. `subjectKind` says which id the subject is, so a
 * job's alarm carries its `job_id`. Answers whether a row with its dedupe key
 * exists afterwards (an earlier duplicate counts).
 */
export async function recordLedgerAlarm(args: {
  kind: PagesAlarmKind;
  subject: string;
  subjectKind: 'job' | 'user' | 'event';
  userId?: string | null;
  fields?: Record<string, unknown>;
}): Promise<boolean> {
  const dedupeKey = `${args.kind}:${args.subject}`;
  try {
    const env = process.env as Record<string, unknown>;
    const db = env.EVENTS_DB as D1Like | undefined;
    if (!db || typeof db.prepare !== 'function') throw new Error('EVENTS_DB unbound');
    const eventId = crypto.randomUUID();
    const occurredAtMs = Date.now();
    const environment = typeof env.APP_ENV === 'string' && env.APP_ENV ? env.APP_ENV : 'unknown';
    const jobId = args.subjectKind === 'job' ? args.subject : undefined;
    const canonical = {
      schemaVersion: 1,
      eventId,
      dedupeKey,
      eventName: 'ledger.alarm',
      level: 'error',
      occurredAtMs,
      occurredAt: new Date(occurredAtMs).toISOString(),
      reportingDay: NY_DAY.format(new Date(occurredAtMs)),
      ingestedAtMs: occurredAtMs,
      environment,
      sourceService: 'spritebrew-pages',
      userId: args.userId ?? undefined,
      jobId,
      errorCode: args.kind,
      extra: { subjectKind: args.subjectKind, subject: args.subject, ...args.fields },
    };
    const eventJson = stableStringify(canonical);
    await withTimeout(db
      .prepare(
        `INSERT OR IGNORE INTO events (event_id, dedupe_key, schema_version, event_name, level,
           occurred_at_ms, reporting_day, ingested_at_ms, environment, source_service,
           user_id, job_id, request_id, error_code, event_json, event_sha256)
         VALUES (?1, ?2, 1, 'ledger.alarm', 'error', ?3, ?4, ?3, ?5, 'spritebrew-pages',
           ?6, ?7, NULL, ?8, ?9, ?10)`
      )
      .bind(eventId, dedupeKey, occurredAtMs, canonical.reportingDay, environment,
        args.userId ?? null, jobId ?? null, args.kind, eventJson, await sha256Hex(eventJson))
      .run(), 'ledger alarm insert');
    // INSERT OR IGNORE also ignores a failed CHECK: the row counts only if
    // one holds the dedupe key now.
    const row = await withTimeout(db
      .prepare('SELECT 1 AS ok FROM events WHERE dedupe_key = ?1')
      .bind(dedupeKey)
      .first<{ ok: number }>(), 'ledger alarm read-back');
    if (row) return true;
    throw new Error('insert ignored');
  } catch (err) {
    console.error(JSON.stringify({
      source: 'ledger-alarm', event: 'write_failed', dedupe_key: dedupeKey,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    }));
    return false;
  }
}
