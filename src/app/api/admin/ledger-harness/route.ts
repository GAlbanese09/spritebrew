// The dev harness for release 2's ledger library (n1-release-2-spec.md
// revision 9: 6.2, section 10, section 11's S1 row; `L 004` ruling 12).
// Dev only, S1 to S5; removed in phase C.
//
// POST only. The first two guards run before the body is read:
//   1. the host: APP_ENV must be 'dev' and the request's host
//      dev.spritebrew.pages.dev; anything else answers 404 with no body;
//   2. verified admin auth: the RS256-verified Clerk session (getAuthedUserId,
//      auth-verify.md), then isAdminUser; 401 or 403 otherwise;
//   3. synthetic data only: every user id is ledgertest_<n>, and every job id,
//      event id and key an op names carries the ledgertest_ prefix; checked
//      for the whole request (each call of a race included) before any
//      statement runs, 400 otherwise.
//
// It runs the library's batches (src/lib/ledger.ts) against LEDGER_DB. It
// binds no queue and sends nothing, so the enqueue rows of T4 and T7 stay
// offline until S5 (section 11). It never writes a control row: the unpause
// (4.15), the kill switch (4.16) and Stripe's refusal rows are not exposed,
// and T0's and T25's control-row variants run offline. `clear` deletes only
// synthetic rows and answers the control rows for S1's closing check.

import { getAuthedUserId } from '@/lib/edgeAuth';
import { isAdminUser } from '@/lib/generationLimits';
import * as L from '@/lib/ledger';
import type { LedgerCtx, LedgerDb } from '@/lib/ledger';

export const runtime = 'edge';

const DEV_HOST = 'dev.spritebrew.pages.dev';
const USER_RE = /^ledgertest_[0-9]{1,9}$/;
const ID_RE = /^ledgertest_[A-Za-z0-9_-]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9_:.-]{1,200}$/;
const RACE_MAX = 50;

type Args = Record<string, unknown>;

class BadRequest extends Error {}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function user(a: Args, field: string): string {
  const v = a[field];
  if (typeof v !== 'string' || !USER_RE.test(v)) throw new BadRequest(`${field} must be a synthetic ledgertest_<n> user`);
  return v;
}
function synthId(a: Args, field: string): string {
  const v = a[field];
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new BadRequest(`${field} must carry the ledgertest_ prefix`);
  return v;
}
/** A key (an idempotency key, a legacy key) that names a synthetic subject. */
function synthKey(a: Args, field: string, optional = false): string | null {
  const v = a[field];
  if (optional && (v === undefined || v === null)) return null;
  if (typeof v !== 'string' || !KEY_RE.test(v) || !v.includes('ledgertest_')) throw new BadRequest(`${field} must name a ledgertest_ subject`);
  return v;
}
function optSynthId(a: Args, field: string): string | null {
  return a[field] === undefined || a[field] === null ? null : synthId(a, field);
}
const str = (a: Args, f: string): string | null => (typeof a[f] === 'string' ? (a[f] as string) : null);
const int = (a: Args, f: string): number => {
  const v = a[f];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new BadRequest(`${f} must be an integer`);
  return v;
};
const mode = (a: Args): 'create' | 'animate' => (a.mode === 'animate' ? 'animate' : 'create');

const SEED_COLUMNS: Record<string, readonly string[]> = {
  jobs: ['job_id', 'user_id', 'mode', 'token_cost', 'client_key', 'request_hash', 'provenance', 'state', 'phase', 'claim_id',
    'claim_attempt', 'claimed_at_ms', 'lease_at_ms', 'released_at_ms', 'submitted_at_ms', 'task_id', 'refund_due_code',
    'hold_reason', 'import_json', 'outcome', 'error_code', 'error_message', 'refunded_amount', 'artifact',
    'artifact_meta_json', 'status_written_at_ms', 'created_at_ms', 'enqueued_at_ms', 'finished_at_ms'],
  legacy_idem: ['key', 'kind', 'kv_expires_ms', 'copied_at_ms', 'keep_until_ms'],
  ledger: ['id', 'user_id', 'type', 'amount', 'reason', 'source', 'job_id', 'balance_after', 'idem_key', 'created_at_ms', 'meta_json'],
  stripe_pending: ['event_id', 'reason', 'first_seen_ms', 'disposition', 'evidence_note', 'decided_by', 'decided_at_ms'],
};

/** Test setup on synthetic rows (a kv row, a held row, a mismatched debit,
 *  legacy evidence, a pending row): one INSERT, named columns only. */
async function seed(db: LedgerDb, a: Args, dry: boolean): Promise<unknown> {
  const table = String(a.table);
  const cols = SEED_COLUMNS[table];
  const row = (a.row ?? {}) as Args;
  if (!cols) throw new BadRequest('table not seedable');
  const names = Object.keys(row);
  if (!names.length || names.some((n) => !cols.includes(n))) throw new BadRequest('unknown column');
  if (table === 'jobs') { synthId(row, 'job_id'); user(row, 'user_id'); }
  if (table === 'ledger') { synthId(row, 'id'); user(row, 'user_id'); optSynthId(row, 'job_id'); synthKey(row, 'idem_key'); }
  if (table === 'legacy_idem') synthKey(row, 'key');
  if (table === 'stripe_pending') synthId(row, 'event_id');
  if (dry) return null;
  const sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => `?${i + 1}`).join(', ')})`;
  const [r] = await db.batch([db.prepare(sql).bind(...names.map((n) => row[n] ?? null))]);
  return { changes: r?.meta?.changes ?? 0 };
}

const ROW_READS: Record<string, string> = {
  jobs: 'SELECT * FROM jobs WHERE job_id = ?1',
  balances: 'SELECT * FROM balances WHERE user_id = ?1',
  ledger: 'SELECT * FROM ledger WHERE user_id = ?1 ORDER BY seq',
  stripe_pending: 'SELECT * FROM stripe_pending WHERE event_id = ?1',
  legacy_idem: 'SELECT * FROM legacy_idem WHERE key = ?1',
};

async function rows(db: LedgerDb, a: Args, dry: boolean): Promise<unknown> {
  const table = String(a.table);
  const sql = ROW_READS[table];
  if (!sql) throw new BadRequest('table not readable');
  const id = table === 'balances' || table === 'ledger' ? user(a, 'id') : table === 'legacy_idem' ? synthKey(a, 'id') : synthId(a, 'id');
  if (dry) return null;
  const [r] = await db.batch([db.prepare(sql).bind(id)]);
  return r?.results ?? [];
}

const CONTROLS = "SELECT key, value, updated_at_ms FROM control WHERE key IN ('money_pause', 'migration_open', 'switch_at_ms') ORDER BY key";

/** S1's closing step on dev: every synthetic row cleared, then the control
 *  rows and what is left, read back. */
async function clear(db: LedgerDb): Promise<unknown> {
  await db.batch([
    db.prepare("DELETE FROM ledger WHERE user_id GLOB 'ledgertest_*'"),
    db.prepare("DELETE FROM balances WHERE user_id GLOB 'ledgertest_*'"),
    db.prepare("DELETE FROM jobs WHERE job_id GLOB 'ledgertest_*' OR user_id GLOB 'ledgertest_*'"),
    db.prepare("DELETE FROM legacy_idem WHERE key GLOB '*ledgertest_*'"),
    db.prepare("DELETE FROM stripe_pending WHERE event_id GLOB 'ledgertest_*'"),
  ]);
  const [left, ctl] = await db.batch([
    db.prepare(`SELECT (SELECT COUNT(*) FROM ledger WHERE user_id GLOB 'ledgertest_*')
      + (SELECT COUNT(*) FROM balances WHERE user_id GLOB 'ledgertest_*')
      + (SELECT COUNT(*) FROM jobs WHERE job_id GLOB 'ledgertest_*' OR user_id GLOB 'ledgertest_*')
      + (SELECT COUNT(*) FROM legacy_idem WHERE key GLOB '*ledgertest_*')
      + (SELECT COUNT(*) FROM stripe_pending WHERE event_id GLOB 'ledgertest_*') AS synthetic_left`),
    db.prepare(CONTROLS),
  ]);
  return { left: left?.results?.[0], controls: ctl?.results ?? [] };
}

const synthetic = (list: Array<Record<string, unknown>>) => list.filter((r) => typeof r.job_id === 'string' && r.job_id.startsWith('ledgertest_'));

/** One op. With `dry`, only its arguments are checked and nothing runs: the
 *  route checks every op (a race's included) before it runs any. */
async function runOp(ctx: LedgerCtx, op: string, a: Args, dry: boolean, depth = 0): Promise<unknown> {
  const run = <T>(input: T, fn: (i: T) => Promise<unknown>): Promise<unknown> => (dry ? Promise.resolve(null) : fn(input));
  switch (op) {
    case 'movement':
      return run<L.MovementInput>({
        uid: user(a, 'uid'), type: a.type === 'debit' ? 'debit' : 'credit', amount: int(a, 'amount'),
        reason: str(a, 'reason') ?? 'ledger_harness', source: str(a, 'source'), idem: synthKey(a, 'idem') as string,
        job: optSynthId(a, 'job'), meta: str(a, 'meta'), floor: a.floor === undefined || a.floor === null ? null : int(a, 'floor'),
        legacy1: synthKey(a, 'legacy1', true), legacy2: synthKey(a, 'legacy2', true), event: optSynthId(a, 'event'),
      }, (i) => L.movement(ctx, i));
    case 'opening':
      return run<L.OpeningInput>({
        uid: user(a, 'uid'), amount: int(a, 'amount'), reason: str(a, 'reason') ?? 'ledger_harness', source: str(a, 'source'),
        via: a.via === 'zero_alarm' || a.via === 'early_adopter' || a.via === 'disposable' ? a.via : 'signup',
      }, (i) => L.openBalance(ctx, i));
    case 'debit':
      return run({
        uid: user(a, 'uid'), job: synthId(a, 'job'), cost: int(a, 'cost'), mode: mode(a),
        ckey: str(a, 'ckey') ?? 'harness', hash: str(a, 'hash') ?? 'harness', meta: str(a, 'meta'),
      }, (i) => L.generationDebit(ctx, i));
    case 'identity':
      return run(synthId(a, 'job'), (i) => L.readGenerationIdentity(ctx, i));
    case 'enqueued':
      return run(synthId(a, 'job'), (i) => L.markEnqueued(ctx, i));
    case 'claim':
      return run({ job: synthId(a, 'job'), claim: String(a.claim), attempt: int(a, 'attempt') },
        (i) => L.claimJob(ctx, a.kind === 'resume' || a.kind === 'finalize' ? a.kind : 'submit', i));
    case 'owner_update': {
      const kinds = ['submitted', 'task', 'fallback', 'release_create', 'release_animate', 'stage'] as const;
      const kind = kinds.find((k) => k === a.kind);
      if (!kind) throw new BadRequest('unknown owner update');
      return run({ job: synthId(a, 'job'), claim: String(a.claim), task: str(a, 'task'), meta: str(a, 'meta') }, (i) => L.ownerUpdate(ctx, kind, i));
    }
    case 'success':
      return run<{ job: string; claim: string; outcome: 'succeeded' | 'rescued' }>({ job: synthId(a, 'job'), claim: String(a.claim), outcome: a.outcome === 'rescued' ? 'rescued' : 'succeeded' }, (i) => L.successUpdate(ctx, i));
    case 'refund': {
      const fences = ['owner', 'canceller', 'recovery', 'pages'] as const;
      const fence = fences.find((f) => f === a.fence);
      if (!fence) throw new BadRequest('unknown fence');
      return run({ job: synthId(a, 'job'), fence, claim: str(a, 'claim'), code: str(a, 'code') ?? 'ledger_harness', msg: str(a, 'msg') }, (i) => L.refundAndFinish(ctx, i));
    }
    case 'tombstone':
      return run({ job: synthId(a, 'job'), uid: user(a, 'uid'), mode: mode(a), cost: int(a, 'cost'), code: 'no_record' as string }, (i) => L.tombstone(ctx, i));
    case 'publish':
      return run(synthId(a, 'job'), (i) => L.markPublished(ctx, i));
    case 'status_written':
      return run(synthId(a, 'job'), (i) => L.markStatusWritten(ctx, i));
    case 'delivered_finish':
      return run({ job: synthId(a, 'job'), meta: str(a, 'meta') ?? '{}' }, (i) => L.deliveredFinish(ctx, i));
    case 'hold':
      return run(synthId(a, 'job'), (i) => L.holdIndexOnly(ctx, i));
    case 'discard_staged':
      return run(synthId(a, 'job'), (i) => L.discardStaged(ctx, i));
    case 'discard_png':
      return run(synthId(a, 'job'), (i) => L.discardPngOnly(ctx, i));
    case 'pending':
      return run<{ event: string; reason: 'no_evidence' | 'mapping_missing' }>({ event: synthId(a, 'event'), reason: a.reason === 'mapping_missing' ? 'mapping_missing' : 'no_evidence' }, (i) => L.recordPending(ctx, i));
    case 'disposition':
      return run<{ event: string; disposition: 'apply' | 'none'; note: string | null; who: string }>({ event: synthId(a, 'event'), disposition: a.disposition === 'none' ? 'none' : 'apply', note: str(a, 'note'), who: 'ledger_harness' }, (i) => L.recordDisposition(ctx, i));
    case 'none_n14':
      return run({ event: synthId(a, 'event'), note: str(a, 'note') ?? '', who: 'ledger_harness' }, (i) => L.recordNoneN14(ctx, i));
    case 'resolve':
      return run(synthId(a, 'event'), (i) => L.resolvePending(ctx, i));
    case 'admission_read':
      return run({ event: synthId(a, 'event'), createdMs: int(a, 'createdMs'),
        legacy1: synthKey(a, 'legacy1') as string, legacy2: synthKey(a, 'legacy2') as string }, (i) => L.readAdmission(ctx, i));
    case 'sweep_list':
      return run(null, async () => synthetic(await L.sweepList(ctx)));
    case 'repair_list':
      return run(null, async () => {
        const r = await L.repairList(ctx);
        return { outcome: r.outcome, rows: synthetic(r.rows) };
      });
    case 'overdue_list':
      return run(null, async () => synthetic(await L.overdueList(ctx)));
    case 'race': {
      if (depth > 0) throw new BadRequest('a race cannot nest');
      const calls = Array.isArray(a.calls) ? (a.calls as Array<{ op?: unknown; args?: unknown }>) : [];
      if (!calls.length || calls.length > RACE_MAX) throw new BadRequest(`a race takes 1 to ${RACE_MAX} calls`);
      for (const c of calls) await runOp(ctx, String(c.op), (c.args ?? {}) as Args, true, depth + 1);
      return run(calls, (cs) => Promise.all(cs.map((c) =>
        runOp(ctx, String(c.op), (c.args ?? {}) as Args, false, depth + 1).catch((e) => ({ error: errText(e) })))));
    }
    case 'seed':
      return seed(ctx.db, a, dry);
    case 'rows':
      return rows(ctx.db, a, dry);
    case 'controls':
      return run(null, async () => (await ctx.db.batch([ctx.db.prepare(CONTROLS)]))[0]?.results ?? []);
    case 'clear':
      return run(null, () => clear(ctx.db));
    default:
      throw new BadRequest('unknown op');
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message.slice(0, 160) : 'error');

export async function POST(request: Request): Promise<Response> {
  const env = process.env as Record<string, unknown>;
  let host = '';
  try {
    host = new URL(request.url).hostname;
  } catch {
    host = '';
  }
  if (env.APP_ENV !== 'dev' || host !== DEV_HOST) return new Response(null, { status: 404 });

  const auth = await getAuthedUserId(request);
  if ('error' in auth) return json({ error: auth.error }, auth.status);
  if (!isAdminUser(auth.userId)) return json({ error: 'Admins only.' }, 403);

  const db = env.LEDGER_DB as LedgerDb | undefined;
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') return json({ error: 'LEDGER_DB binding missing' }, 503);

  let body: { op?: unknown; args?: unknown };
  try {
    body = (await request.json()) as { op?: unknown; args?: unknown };
  } catch {
    return json({ error: 'JSON body required' }, 400);
  }
  const op = String(body?.op ?? '');
  const args = (body?.args && typeof body.args === 'object' ? body.args : {}) as Args;
  try {
    const ctx: LedgerCtx = { db, appEnv: 'dev', timeoutMs: 10_000 };
    await runOp(ctx, op, args, true);
    const result = await runOp(ctx, op, args, false);
    return json({ op, result });
  } catch (e) {
    if (e instanceof BadRequest || e instanceof L.LedgerInputError) return json({ error: e.message }, 400);
    console.error(JSON.stringify({ source: 'ledger-harness', event: 'op_failed', op, error: errText(e) }));
    return json({ op, error: errText(e) }, 500);
  }
}
