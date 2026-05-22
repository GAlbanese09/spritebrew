import { getAuthedUserId } from '@/lib/edgeAuth';
import { GALLERY_KV_PREFIX, galleryR2Key, type GalleryEntryV1 } from '@/lib/galleryTypes';

export const runtime = 'edge';

interface KV {
  delete(key: string): Promise<void>;
  list(opts: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

interface R2Bucket {
  delete(key: string): Promise<void>;
}

function getKV(): KV | null {
  const env = process.env as Record<string, unknown>;
  const kv = env.SPRITEBREW_KV;
  if (!kv || typeof (kv as KV).list !== 'function') return null;
  return kv as KV;
}

function getR2(): R2Bucket | null {
  const env = process.env as unknown as { GALLERY_BUCKET?: R2Bucket };
  const bucket = env.GALLERY_BUCKET;
  if (!bucket || typeof bucket.delete !== 'function') return null;
  return bucket;
}

/**
 * DELETE /api/gallery/[jobId]
 *
 * Deletes one gallery entry: KV index entry first (immediately invisible to
 * GET /api/gallery), then R2 blob.
 *
 * Ownership is implicit: the R2 key is constructed from the authenticated
 * userId, so the caller can only delete blobs they own.
 *
 * To find the matching KV key we list the user's gen: prefix and filter for
 * the jobId in metadata. This is O(n) over the user's entries (cap 50), so
 * acceptable. If the user ever exceeds a few hundred entries we'd want a
 * secondary index — out of scope for Phase 3.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ jobId: string }> | { jobId: string } }
): Promise<Response> {
  const auth = getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  // Next.js 15+ async params — await regardless of whether it's a Promise.
  const params = await Promise.resolve(context.params);
  const { jobId } = params;
  if (!jobId || typeof jobId !== 'string') {
    return Response.json({ error: 'Invalid jobId.' }, { status: 400 });
  }

  const kv = getKV();
  const bucket = getR2();
  if (!kv || !bucket) {
    return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  }

  // 1. Find and delete the matching KV index entry.
  let foundKvKey: string | null = null;
  let cursor: string | undefined = undefined;
  let listComplete = false;
  let safetyCounter = 0;

  while (!listComplete && !foundKvKey && safetyCounter < 10) {
    const page = await kv.list({
      prefix: `${GALLERY_KV_PREFIX}${userId}:`,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const k of page.keys) {
      const md = k.metadata as Partial<GalleryEntryV1> | null | undefined;
      if (md?.jobId === jobId) {
        foundKvKey = k.name;
        break;
      }
    }
    listComplete = page.list_complete;
    cursor = page.cursor;
    safetyCounter++;
  }

  if (foundKvKey) {
    await kv.delete(foundKvKey);
  }
  // If no KV key found, fall through and still try R2 delete — might be a
  // stale blob from a partial write. R2 delete is idempotent.

  // 2. Delete the R2 blob.
  await bucket.delete(galleryR2Key(userId, jobId));

  if (!foundKvKey) {
    return Response.json({ deleted: false, reason: 'Entry not found.' }, { status: 404 });
  }
  return Response.json({ deleted: true });
}
