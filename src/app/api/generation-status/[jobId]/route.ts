import { getJobStateBucket, jobStateR2Key } from '@/lib/jobState';

export const runtime = 'edge';

interface KV {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
}

function getKV(): KV | null {
  const env = process.env as Record<string, unknown>;
  const kv = env.SPRITEBREW_KV;
  if (!kv || typeof (kv as KV).get !== 'function') return null;
  return kv as KV;
}

// Reuse the same Bearer JWT pattern as /api/generate (recon §1, lines 19-43)
function decodeJwtPayload(jwt: string): { sub?: string; exp?: number } | null {
  try {
    const [, payloadB64] = jwt.split('.');
    if (!payloadB64) return null;
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded + '==='.slice((padded.length + 3) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getAuthedUserId(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const payload = decodeJwtPayload(auth.slice(7));
  if (!payload?.sub) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload.sub;
}

type StatusSource = 'r2' | 'kv';

function jsonResponse(payload: unknown, status: number, source?: StatusSource): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      // Which store answered; the client ignores it, the dev test reads it.
      ...(source ? { 'x-sb-status-source': source } : {}),
    },
  });
}

interface JobRecord {
  status?: string;
  userId?: string;
  [field: string]: unknown;
}

function isTerminal(state: JobRecord): boolean {
  return state.status === 'success' || state.status === 'error';
}

function parseRecord(raw: string | null): JobRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as JobRecord) : null;
  } catch {
    return null;
  }
}

/** The R2 mirror of the job record. Any read or parse failure is a miss, so
 *  the route falls back to KV and degrades to the old behaviour. */
async function readR2Record(jobId: string): Promise<JobRecord | null> {
  const bucket = getJobStateBucket();
  if (!bucket) return null;
  try {
    const obj = await bucket.get(jobStateR2Key(jobId));
    return obj ? parseRecord(await obj.text()) : null;
  } catch (err) {
    console.warn('[generation-status] R2 read failed; using KV', JSON.stringify({
      jobId,
      error: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const { jobId } = await context.params;
  const userId = getAuthedUserId(request);
  if (!userId) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const kv = getKV();
  if (!kv) {
    return jsonResponse({ error: 'kv_unavailable' }, 503);
  }

  // KV serves this key from the edge cache for cacheTtl seconds, so a state
  // change can reach the client that much late (measured: `pending` about 50s
  // after `running`, `running` about 30s after `success`, at the 60s default).
  // 30 is the floor since Jan 30, 2026; 0 throws. At 3s polls this is still
  // about ten poll cycles, never the "1-2" this comment once claimed.
  const readKV = async () => parseRecord(await kv.get(`job:${jobId}`, { cacheTtl: 30 }));

  // Read rule (status-store.md 001 step 4): R2 first, because its reads are
  // strongly consistent. R2 terminal: serve it. R2 missing: serve KV, or 404
  // when KV has nothing too; never 404 on an R2 miss alone (a 404 is fatal
  // to the client). R2 in flight: serve KV only if KV is terminal (covers a
  // consumer rolled back to a build that writes KV only), else R2.
  let state: JobRecord;
  let source: StatusSource;
  const r2State = await readR2Record(jobId);
  if (r2State && isTerminal(r2State)) {
    state = r2State;
    source = 'r2';
  } else {
    const kvState = await readKV();
    if (r2State) {
      if (kvState && isTerminal(kvState)) {
        state = kvState;
        source = 'kv';
      } else {
        state = r2State;
        source = 'r2';
      }
    } else if (kvState) {
      state = kvState;
      source = 'kv';
    } else {
      return jsonResponse({ status: 'unknown' }, 404, 'kv');
    }
  }

  // Authorization: only the job's owner can read, whichever record is served.
  if (state.userId !== userId) {
    return jsonResponse({ error: 'forbidden' }, 403, source);
  }

  // Emit minimal payload during in-flight; full result only on terminal success.
  if (state.status === 'success') {
    // Rescue metadata (consumer commit 0d71a88): the five fields are present
    // ONLY on records the consumer marked as rescued. deliveredFrames is
    // optional even when rescued=true (unreadable IHDR on the delivered
    // sheet — the client derives it from decoded dimensions in that case).
    // Absent fields stay absent on the wire (JSON drops undefined), so
    // non-rescue successes are byte-compatible with today's response.
    return jsonResponse({
      status: 'success',
      resultBase64: state.resultBase64,
      completedAt: state.completedAt,
      rescued: state.rescued,
      requestedWidth: state.requestedWidth,
      requestedHeight: state.requestedHeight,
      deliveredCellSize: state.deliveredCellSize,
      deliveredFrames: state.deliveredFrames,
    }, 200, source);
  }
  if (state.status === 'error') {
    return jsonResponse({
      status: 'error',
      error: state.error,
      errorCode: state.errorCode,
      refunded: state.refunded ?? false,
    }, 200, source);
  }
  return jsonResponse({
    status: state.status,
    startedAt: state.startedAt ?? null,
  }, 200, source);
}
