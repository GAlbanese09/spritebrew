export const runtime = 'edge';

import { NextResponse } from 'next/server';

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

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
): Promise<Response> {
  const { jobId } = await context.params;
  const userId = getAuthedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const kv = getKV();
  if (!kv) {
    return NextResponse.json({ error: 'kv_unavailable' }, { status: 503 });
  }

  // cacheTtl: 0 forces fresh regional read; default 60s would mask
  // just-completed states. Per Confluence 87490562 §7.
  const raw = await kv.get(`job:${jobId}`, { cacheTtl: 0 });
  if (!raw) {
    return NextResponse.json({ status: 'unknown' }, { status: 404 });
  }

  const state = JSON.parse(raw);

  // Authorization: only the job's owner can read.
  if (state.userId !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Emit minimal payload during in-flight; full result only on terminal success.
  if (state.status === 'success') {
    return NextResponse.json({
      status: 'success',
      resultBase64: state.resultBase64,
      completedAt: state.completedAt,
    });
  }
  if (state.status === 'error') {
    return NextResponse.json({
      status: 'error',
      error: state.error,
      errorCode: state.errorCode,
      refunded: state.refunded ?? false,
    });
  }
  return NextResponse.json({
    status: state.status,
    startedAt: state.startedAt ?? null,
  });
}
