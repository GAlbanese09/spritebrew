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

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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
  const raw = await kv.get(`job:${jobId}`, { cacheTtl: 30 });
  if (!raw) {
    return jsonResponse({ status: 'unknown' }, 404);
  }

  const state = JSON.parse(raw);

  // Authorization: only the job's owner can read.
  if (state.userId !== userId) {
    return jsonResponse({ error: 'forbidden' }, 403);
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
    }, 200);
  }
  if (state.status === 'error') {
    return jsonResponse({
      status: 'error',
      error: state.error,
      errorCode: state.errorCode,
      refunded: state.refunded ?? false,
    }, 200);
  }
  return jsonResponse({
    status: state.status,
    startedAt: state.startedAt ?? null,
  }, 200);
}
