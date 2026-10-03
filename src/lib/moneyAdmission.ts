/**
 * S0's admission records (n1-release-2-spec.md revision 9, 6.2 and 8, R5-1,
 * R7-1). Every release 1 HTTP request that writes money takes one row in
 * `money_admissions` of `spritebrew-ledger` before its first money write,
 * and completes it in a `finally` after its last.
 *
 * The admission replaces the route's pause read. It is one statement that
 * inserts only while `money_pause` reads '0', then a read-back: zero rows is
 * the paused answer, as today. A missing binding, a failed or timed-out
 * statement, or an uncertain answer also read as paused (fail closed). An
 * uncertain insert may have landed, so its request still runs the completion,
 * keyed on the fresh id.
 *
 * The completion catches and logs its own failure, leaving the record open
 * for Q4; it never changes the route's response. A completion after George's
 * closing statement is kept beside it, and its read-back raises the
 * `admission.late_completion` alarm row.
 *
 * One log line at admission and one at the end, each naming the admission
 * id, the request's own ids and the outcome. Pages keeps no logs, so the
 * row's completion is the durable record of the end.
 */

import { devFaultScope, withTimeout } from '@/lib/moneyPause';
import { recordLateCompletionAlarm } from '@/lib/lateCompletionAlarm';

interface D1Like {
  prepare(sql: string): {
    bind(...v: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

export type AdmissionRoute = 'generate' | 'stripe_webhook' | 'daily_reward' | 'email_list' | 'opening';
export type AdmissionSubject = 'job' | 'event' | 'user';

export interface Admission {
  /** The fresh admission id, logged at admission and at the end. */
  readonly id: string;
  /** True only when the read-back found the row: money was open. */
  readonly admitted: boolean;
  /** The completion and the end line. Never throws; call it in a `finally`. */
  complete(outcome: string): Promise<void>;
}

const ADMISSION_SQL =
  `INSERT INTO money_admissions (admission_id, route, subject_kind, subject_id, user_id, meta_json, admitted_at_ms)
   SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
    WHERE EXISTS (SELECT 1 FROM control WHERE key = 'money_pause' AND value = '0')`;
const ADMISSION_READ_SQL = 'SELECT admission_id FROM money_admissions WHERE admission_id = ?1';
const COMPLETION_SQL =
  'UPDATE money_admissions SET completed_at_ms = ?2 WHERE admission_id = ?1 AND completed_at_ms IS NULL';
const COMPLETION_READ_SQL =
  'SELECT completed_at_ms, closed_at_ms FROM money_admissions WHERE admission_id = ?1';

/** How long an uncertain completion waits for its own insert to settle first. */
const UNCERTAIN_INSERT_WAIT_MS = 5_000;

function ledger(): D1Like | undefined {
  const db = (process.env as Record<string, unknown>).LEDGER_DB as D1Like | undefined;
  return db && typeof db.prepare === 'function' ? db : undefined;
}

const message = (err: unknown) => (err instanceof Error ? err.message.slice(0, 120) : 'unknown');

/** A dev fault `name` or `name:<route>` (10.3), scoped to a route when given. */
async function faultFor(name: string, route: AdmissionRoute): Promise<boolean> {
  const scope = await devFaultScope(name);
  return scope !== undefined && (scope === null || scope === route);
}

export async function admitMoney(args: {
  route: AdmissionRoute;
  kind: AdmissionSubject;
  subject: string;
  userId?: string | null;
  /** generate: its mode, token cost and request id. */
  meta?: Record<string, unknown> | null;
  /** The request's own ids for the two log lines (no email, no secret). */
  ids: Record<string, string | null | undefined>;
}): Promise<Admission> {
  const id = crypto.randomUUID();
  const line = { source: 'money-admission', admission_id: id, route: args.route, ...args.ids };
  let admitted = false;
  let attempted = false;
  let error: string | undefined;
  // Kept so an uncertain completion can wait for the insert itself: a timed-out
  // insert is still in flight, and a completion sent first would match nothing.
  let insert: Promise<unknown> | undefined;
  try {
    const db = ledger();
    if (!db) throw new Error('LEDGER_DB binding missing');
    attempted = true;
    insert = db.prepare(ADMISSION_SQL)
      .bind(id, args.route, args.kind, args.subject, args.userId ?? null,
        args.meta ? JSON.stringify(args.meta) : null, Date.now())
      .run();
    await withTimeout(insert, 'admission insert');
    const row = await withTimeout(
      db.prepare(ADMISSION_READ_SQL).bind(id).first<{ admission_id: string }>(),
      'admission read-back'
    );
    admitted = row?.admission_id === id;
  } catch (err) {
    error = message(err);
  }
  // A statement that failed after it was sent may have landed: completed below.
  const uncertain = attempted && error !== undefined;
  const admissionLine = { ...line, event: 'admission', outcome: admitted ? 'admitted' : uncertain ? 'uncertain' : 'paused' };
  if (error) console.error(JSON.stringify({ ...admissionLine, error }));
  else console.log(JSON.stringify(admissionLine));

  return {
    id,
    admitted,
    async complete(outcome: string): Promise<void> {
      if (admitted || uncertain) {
        if (uncertain && insert) {
          await withTimeout(insert, 'admission insert', UNCERTAIN_INSERT_WAIT_MS).catch(() => undefined);
        }
        await completeRecord(id, args, uncertain);
      }
      console.log(JSON.stringify({ ...line, event: 'end', outcome }));
    },
  };
}

async function completeRecord(
  id: string,
  args: { route: AdmissionRoute; kind: AdmissionSubject; subject: string; userId?: string | null },
  uncertain: boolean
): Promise<void> {
  try {
    if (await faultFor('admission_complete_skip', args.route)) {
      // Dev only: the request ends without its completion, as a killed one would.
      console.log(JSON.stringify({ source: 'money-admission', admission_id: id, route: args.route, event: 'completion_skipped', fault: 'admission_complete_skip' }));
      return;
    }
    if (await faultFor('admission_complete_fail', args.route)) {
      throw new Error('dev fault: admission_complete_fail');
    }
    const db = ledger();
    if (!db) throw new Error('LEDGER_DB binding missing');
    await withTimeout(db.prepare(COMPLETION_SQL).bind(id, Date.now()).run(), 'completion');
    const row = await withTimeout(
      db.prepare(COMPLETION_READ_SQL).bind(id).first<{ completed_at_ms: number | null; closed_at_ms: number | null }>(),
      'completion read-back'
    );
    if (!row && uncertain) {
      // The uncertain insert did not land (or has not yet): nothing to complete.
      console.log(JSON.stringify({ source: 'money-admission', admission_id: id, route: args.route, event: 'completion_no_row' }));
    }
    if (row && row.closed_at_ms !== null && row.closed_at_ms !== undefined
      && row.completed_at_ms !== null && row.completed_at_ms !== undefined) {
      // A completion after George's closure: kept beside it, and reviewed by
      // him before the next switch's step 0 or Close (8, R7-1).
      const alarmed = await recordLateCompletionAlarm({
        admissionId: id,
        route: args.route,
        subjectKind: args.kind,
        subjectId: args.subject,
        userId: args.userId ?? null,
        completedAtMs: row.completed_at_ms,
        closedAtMs: row.closed_at_ms,
      });
      console.error(JSON.stringify({
        source: 'money-admission', admission_id: id, route: args.route, event: 'late_completion',
        completed_at_ms: row.completed_at_ms, closed_at_ms: row.closed_at_ms, alarmed,
      }));
    }
  } catch (err) {
    // The record stays open for Q4; the route's answer is unchanged.
    console.error(JSON.stringify({ source: 'money-admission', admission_id: id, route: args.route, event: 'completion_failed', error: message(err) }));
  }
}
