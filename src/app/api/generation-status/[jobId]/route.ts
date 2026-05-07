export const runtime = 'edge';

interface KV {
  get(key: string): Promise<string | null>;
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

  // Default KV cache behavior is fine: client polls every 3s, KV's default
  // ~60s edge cache resolves stale terminal states within 1-2 poll cycles.
  // (Previously passed { cacheTtl: 0 }, which throws — KV requires cacheTtl >= 60.)
  const raw = await kv.get(`job:${jobId}`);
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
    return jsonResponse({
      status: 'success',
      resultBase64: state.resultBase64,
      completedAt: state.completedAt,
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
