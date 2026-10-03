/**
 * One `admission.late_completion` row in the D1 event ledger (`EVENTS_DB`,
 * `spritebrew-events`), written when an admission record's completion lands
 * on a record George has already closed by his statement
 * (n1-release-2-spec.md revision 9, 6.2 and 8, R7-1). His audit and the
 * actual completion stay side by side; this row tells him to review it.
 *
 * Its own writer, not recordUnrefundedAlarm, so it never reads as an
 * unrefunded customer: no cost, the user only when known, dedupe key
 * `{admission_id}:admission.late_completion`. It never throws, and each
 * statement is bounded (2 s), so a hung EVENTS_DB never holds the route. The admission
 * row is the durable review obligation even if this notification fails.
 */

import { withTimeout } from '@/lib/moneyPause';
import { NY_DAY, sha256Hex, stableStringify } from '@/lib/unrefundedAlarm';

interface D1Like {
  prepare(sql: string): {
    bind(...v: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

export async function recordLateCompletionAlarm(args: {
  admissionId: string;
  route: string;
  subjectKind: string;
  subjectId: string;
  userId?: string | null;
  completedAtMs: number;
  closedAtMs: number;
}): Promise<boolean> {
  try {
    const env = process.env as Record<string, unknown>;
    const db = env.EVENTS_DB as D1Like | undefined;
    if (!db || typeof db.prepare !== 'function') {
      console.error(JSON.stringify({ source: 'late-completion-alarm', event: 'write_failed', admission_id: args.admissionId, error: 'EVENTS_DB unbound' }));
      return false;
    }
    const eventId = crypto.randomUUID();
    const occurredAtMs = Date.now();
    const environment = typeof env.APP_ENV === 'string' && env.APP_ENV ? env.APP_ENV : 'unknown';
    const dedupeKey = `${args.admissionId}:admission.late_completion`;
    const jobId = args.subjectKind === 'job' ? args.subjectId : undefined;
    const canonical = {
      schemaVersion: 1,
      eventId,
      dedupeKey,
      eventName: 'admission.late_completion',
      level: 'error',
      occurredAtMs,
      occurredAt: new Date(occurredAtMs).toISOString(),
      reportingDay: NY_DAY.format(new Date(occurredAtMs)),
      ingestedAtMs: occurredAtMs,
      environment,
      sourceService: 'spritebrew-pages',
      userId: args.userId ?? undefined,
      jobId,
      errorCode: 'late_completion',
      extra: {
        admissionId: args.admissionId,
        route: args.route,
        subjectKind: args.subjectKind,
        subjectId: args.subjectId,
        completedAtMs: args.completedAtMs,
        closedAtMs: args.closedAtMs,
      },
    };
    const eventJson = stableStringify(canonical);
    await withTimeout(db
      .prepare(
        `INSERT OR IGNORE INTO events (event_id, dedupe_key, schema_version, event_name, level,
           occurred_at_ms, reporting_day, ingested_at_ms, environment, source_service,
           user_id, job_id, request_id, error_code, event_json, event_sha256)
         VALUES (?1, ?2, 1, 'admission.late_completion', 'error', ?3, ?4, ?3, ?5, 'spritebrew-pages',
           ?6, ?7, NULL, 'late_completion', ?8, ?9)`
      )
      .bind(eventId, dedupeKey, occurredAtMs, canonical.reportingDay, environment,
        args.userId ?? null, jobId ?? null, eventJson, await sha256Hex(eventJson))
      .run(), 'late completion alarm insert');
    // INSERT OR IGNORE also ignores a failed CHECK: the row counts only if
    // one holds the dedupe key now (a duplicate from an earlier try counts).
    const row = await withTimeout(db
      .prepare('SELECT 1 AS ok FROM events WHERE dedupe_key = ?1')
      .bind(dedupeKey)
      .first<{ ok: number }>(), 'late completion alarm read-back');
    if (row) return true;
    console.error(JSON.stringify({ source: 'late-completion-alarm', event: 'write_failed', admission_id: args.admissionId, error: 'insert ignored' }));
    return false;
  } catch (err) {
    console.error(JSON.stringify({
      source: 'late-completion-alarm',
      event: 'write_failed',
      admission_id: args.admissionId,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    }));
    return false;
  }
}
