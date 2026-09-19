// Admin-only read of the D1 event ledger: every row for one user on one
// New York day, or every row for one job.
//
// Auth: x-admin-token header must match env.ADMIN_TOKEN, exactly as
// failure-rate/route.ts does it. No Clerk session check; this is an
// ops/observability surface.
//
// The ledger is written by the consumer Worker (spritebrew-rd-consumer,
// src/events.ts) and is observability, not money: token_tx:* in KV stays the
// source of truth for balances. This route only reads. Bound parameters only.
//
// Query: exactly one of ?userId= or ?jobId=. Optional ?day=YYYY-MM-DD (New
// York calendar day, default today; ignored for jobId, a job's timeline is
// small and has no day filter), ?format=json|ndjson (default json), ?limit=
// (default 500, cap 2000).

export const runtime = 'edge';

interface D1Rows<T> {
  results: T[];
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = unknown>(): Promise<D1Rows<T>>;
}

interface D1 {
  prepare(sql: string): D1Statement;
}

function getDb(): D1 | null {
  const db = (process.env as Record<string, unknown>).EVENTS_DB;
  if (db && typeof (db as D1).prepare === 'function') return db as D1;
  return null;
}

/** The typed projection the queries select. event_json is the full canonical
 *  object as the consumer serialized it; left as a string so its sha256 can
 *  be re-checked by the reader. */
interface EventRow {
  occurred_at_ms: number;
  event_name: string;
  level: string;
  event_id: string;
  job_id: string | null;
  request_id: string | null;
  queue_message_id: string | null;
  provider_job_id: string | null;
  attempt: number | null;
  style: string | null;
  requested_size: string | null;
  final_size: string | null;
  outcome: string | null;
  error_code: string | null;
  failure_stage: string | null;
  http_status: number | null;
  latency_ms: number | null;
  queue_wait_ms: number | null;
  units_delta: number | null;
  event_json: string;
  event_sha256: string;
}

const COLUMNS =
  'occurred_at_ms, event_name, level, event_id, job_id, request_id, queue_message_id, provider_job_id, attempt, style, requested_size, final_size, outcome, error_code, failure_stage, http_status, latency_ms, queue_wait_ms, units_delta, event_json, event_sha256';

const SQL_BY_USER_DAY = `SELECT ${COLUMNS} FROM events WHERE user_id = ?1 AND reporting_day = ?2 ORDER BY occurred_at_ms, event_id LIMIT ?3`;
const SQL_BY_JOB = `SELECT ${COLUMNS} FROM events WHERE job_id = ?1 ORDER BY occurred_at_ms, event_id LIMIT ?2`;

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Same formatter the consumer uses for reporting_day, so "today" here is the
// same day the writer stamped. en-CA yields YYYY-MM-DD.
const NY_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parseLimit(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Keep the download name to safe characters; ids are hex/uuid/Clerk ids. */
function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function badRequest(error: string): Response {
  return Response.json({ success: false, error }, { status: 400 });
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

  const db = getDb();
  if (!db) {
    return Response.json(
      { success: false, error: 'EVENTS_DB not bound on this environment.' },
      { status: 500 }
    );
  }

  const params = new URL(request.url).searchParams;
  const userId = params.get('userId')?.trim() || null;
  const jobId = params.get('jobId')?.trim() || null;
  if ((userId && jobId) || (!userId && !jobId)) {
    return badRequest('Exactly one of userId or jobId is required.');
  }

  const dayParam = params.get('day')?.trim();
  const day = dayParam && dayParam.length > 0 ? dayParam : NY_DAY.format(new Date());
  if (!DAY_RE.test(day)) {
    return badRequest('day must be YYYY-MM-DD.');
  }

  const format = (params.get('format') || 'json').toLowerCase();
  if (format !== 'json' && format !== 'ndjson') {
    return badRequest('format must be json or ndjson.');
  }

  const limit = parseLimit(params.get('limit'));

  let rows: EventRow[];
  try {
    const result = userId
      ? await db.prepare(SQL_BY_USER_DAY).bind(userId, day, limit).all<EventRow>()
      : await db.prepare(SQL_BY_JOB).bind(jobId, limit).all<EventRow>();
    rows = result.results ?? [];
  } catch (err) {
    return Response.json(
      { success: false, error: `D1 query failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const subject = userId ?? (jobId as string);

  if (format === 'ndjson') {
    // One canonical event per line, exactly as the writer serialized it.
    const body = rows.map((r) => r.event_json).join('\n') + (rows.length > 0 ? '\n' : '');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="events-${safeName(subject)}-${day}.ndjson"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return Response.json(
    {
      success: true,
      query: userId ? { userId, day, limit } : { jobId, day, limit },
      count: rows.length,
      rows,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
