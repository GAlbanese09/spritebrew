// Admin smoke test for the GALLERY_BUCKET R2 binding.
//
// Phase 1 of the Generation Gallery Backend (Confluence 93028353). Verifies
// the binding resolves at runtime and that PUT + GET + DELETE round-trip
// cleanly against the bucket bound by wrangler.toml. Admin-gated; not for
// general consumption. Will be removed in a follow-up commit after Phase 2.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUserId } from '@/lib/edgeAuth';

export const runtime = 'edge';

// Admin allowlist covering both Clerk environments so dev verification on
// dev.spritebrew.pages.dev works without per-env code edits.
const ADMIN_USER_IDS = new Set<string>([
  'user_3C34WAUmVRoHvKiyhYSNrMt4dvT', // production Clerk (george.albanese2@hotmail.com)
  'user_3BtzTR8gHfGDiNXd1G8WFLQvEf2', // dev Clerk (george.albanese@outlook.com)
]);

// Minimal local R2Bucket shape — @cloudflare/workers-types is not installed
// in the Pages app, and the codebase declares bindings ad-hoc per route
// (same pattern as the KV interface in /api/generation-status/[jobId]).
interface R2ObjectBody {
  text(): Promise<string>;
}
interface R2Bucket {
  put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

export async function GET(request: NextRequest) {
  const auth = getAuthedUserId(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.userId || !ADMIN_USER_IDS.has(auth.userId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const bucket = (process.env as unknown as { GALLERY_BUCKET?: R2Bucket })
    .GALLERY_BUCKET;
  if (!bucket) {
    return NextResponse.json(
      { error: 'GALLERY_BUCKET binding not found in env' },
      { status: 500 }
    );
  }

  const testKey = `smoke/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const testValue = `hello from spritebrew pages — r2 smoke test @ ${new Date().toISOString()}`;

  try {
    await bucket.put(testKey, testValue);
    const obj = await bucket.get(testKey);
    if (!obj) {
      return NextResponse.json(
        { ok: false, stage: 'get', error: 'GET returned null after PUT' },
        { status: 500 }
      );
    }
    const got = await obj.text();
    const matches = got === testValue;
    await bucket.delete(testKey);

    return NextResponse.json({
      ok: true,
      binding: 'GALLERY_BUCKET',
      testKey,
      putBytes: testValue.length,
      getBytes: got.length,
      matches,
      note: matches
        ? 'R2 binding resolved, PUT+GET+DELETE round-trip clean.'
        : 'Round-trip returned a different value than was written. Investigate.',
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
