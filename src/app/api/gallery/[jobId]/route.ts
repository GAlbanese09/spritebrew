import { getAuthedUserId } from '@/lib/edgeAuth';
import { entryKind, GALLERY_KV_PREFIX, galleryR2Key, type GalleryEntryV1, type JobMode } from '@/lib/galleryTypes';
import { jobStateR2Key } from '@/lib/jobState';

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
  // R2's binding deletes up to 1,000 keys in one call.
  delete(keys: string | string[]): Promise<void>;
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
 * Deletes one gallery entry: its picture and job status copy first, in one
 * R2 call, then its KV index entry. So the picture never outlives the entry:
 * if the R2 call fails, the entry is still listed and the delete can be
 * tried again.
 *
 * Ownership is implicit: the R2 key is constructed from the authenticated
 * userId, so the caller can only delete blobs they own.
 *
 * To find the matching KV key we list the user's gen: prefix and filter for
 * the jobId in metadata: one list call per 1,000 entries, up to 10 pages.
 * Accounts have more than a few hundred entries now; a secondary index would
 * make this one read.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ jobId: string }> | { jobId: string } }
): Promise<Response> {
  const auth = await getAuthedUserId(request);
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

  // A Clear of one kind sends the kind it counted this entry as (HQ
  // 2026-11-25-079). A card's own Delete, and pages from before, send none
  // and are served as before.
  const kindParam = new URL(request.url).searchParams.get('kind');
  if (kindParam !== null && kindParam !== 'create' && kindParam !== 'animate') {
    return Response.json({ error: 'Invalid kind.' }, { status: 400 });
  }
  const kind: JobMode | null = kindParam;

  const kv = getKV();
  const bucket = getR2();
  if (!kv || !bucket) {
    return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  }

  // 1. Find the matching KV index entry.
  let foundKvKey: string | null = null;
  let found: GalleryEntryV1 | null = null;
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
        found = md as GalleryEntryV1;
        break;
      }
    }
    listComplete = page.list_complete;
    cursor = page.cursor;
    safetyCounter++;
  }

  if (!foundKvKey) {
    // No entry: still delete the caller's own picture key (a stale blob from
    // a partial write; R2 delete is idempotent). Never the job status copy:
    // jobs/{jobId}.json is not scoped by userId, so an unmatched jobId must
    // not reach it.
    await bucket.delete(galleryR2Key(userId, jobId));
    return Response.json({ deleted: false, reason: 'Entry not found.' }, { status: 404 });
  }

  // An entry of another kind than the Clear counted: the page's rule is out
  // of date. Nothing is deleted for it (HQ 2026-11-25-079).
  if (kind !== null && found !== null && entryKind(found) !== kind) {
    // Marked, so the page tells this answer from any other 409 (AUDIT
    // ext-mediums r2 L2).
    return Response.json({ error: 'Reload the Gallery and try again.', stale: true }, { status: 409 });
  }

  // 2. The picture and the job's status record mirror (jobs/{jobId}.json,
  //    which carries the result too), in one call, before the entry.
  try {
    await bucket.delete([galleryR2Key(userId, jobId), jobStateR2Key(jobId)]);
  } catch {
    return Response.json(
      { deleted: false, error: 'Could not delete this generation. Try again.' },
      { status: 503 }
    );
  }

  // 3. Then the index entry. If this fails, the entry stays listed with its
  //    picture gone; trying again finishes it.
  try {
    await kv.delete(foundKvKey);
  } catch {
    return Response.json(
      { deleted: false, error: 'Could not delete this generation. Try again.' },
      { status: 503 }
    );
  }
  return Response.json({ deleted: true });
}
