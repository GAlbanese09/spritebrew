import { getAuthedUserId } from '@/lib/edgeAuth';
import { GALLERY_KV_PREFIX, galleryR2Key, type GalleryEntryV1 } from '@/lib/galleryTypes';

export const runtime = 'edge';

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: unknown): Promise<void>;
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

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

/**
 * GET /api/gallery?cursor=&limit=24
 *
 * Returns the authenticated user's gallery entries, newest first.
 *
 * Response shape:
 *   {
 *     entries: GalleryEntryV1[],
 *     cursor: string | null  // null = no more pages
 *   }
 *
 * Pagination: pass the returned cursor as ?cursor= on the next request.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const kv = getKV();
  if (!kv) {
    return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const cursorParam = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, limitParam ? parseInt(limitParam, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT)
  );

  const result = await kv.list({
    prefix: `${GALLERY_KV_PREFIX}${userId}:`,
    limit,
    ...(cursorParam ? { cursor: cursorParam } : {}),
  });

  // Filter out any keys whose metadata doesn't match the expected v1 shape.
  // Defensive — Phase 2's writer always sets metadata, but a future schema
  // bump or partial write could leave a malformed entry.
  const entries: GalleryEntryV1[] = [];
  for (const k of result.keys) {
    const md = k.metadata as Partial<GalleryEntryV1> | null | undefined;
    if (
      md &&
      typeof md.jobId === 'string' &&
      typeof md.prompt === 'string' &&
      typeof md.style === 'string' &&
      (md.mode === 'create' || md.mode === 'animate') &&
      typeof md.createdAt === 'number' &&
      md.v === 1
    ) {
      entries.push(md as GalleryEntryV1);
    }
  }

  return Response.json({
    entries,
    cursor: result.list_complete ? null : result.cursor ?? null,
  });
}

/**
 * DELETE /api/gallery
 *
 * Deletes ALL gallery entries for the authenticated user.
 * Order: KV entries first (removes index → entries become invisible to
 * /api/gallery and /api/gallery/image), then R2 objects (the blobs).
 *
 * This is the nuclear option — also called by the User Data Deletion runbook
 * during a full account purge.
 */
export async function DELETE(request: Request): Promise<Response> {
  const auth = getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const kv = getKV();
  const bucket = getR2();
  if (!kv || !bucket) {
    return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  }

  // 1. Collect all jobIds via paginated KV list, then delete KV entries.
  const jobIds: string[] = [];
  let cursor: string | undefined = undefined;
  let listComplete = false;
  let safetyCounter = 0;
  const MAX_LIST_ROUNDS = 20; // 20 × 1000 keys = 20k entry ceiling; well above any user's MAX_HISTORY 50

  while (!listComplete && safetyCounter < MAX_LIST_ROUNDS) {
    const page = await kv.list({
      prefix: `${GALLERY_KV_PREFIX}${userId}:`,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const k of page.keys) {
      const md = k.metadata as Partial<GalleryEntryV1> | null | undefined;
      if (md && typeof md.jobId === 'string') {
        jobIds.push(md.jobId);
      }
      await kv.delete(k.name);
    }
    listComplete = page.list_complete;
    cursor = page.cursor;
    safetyCounter++;
  }

  // 2. Delete the R2 blobs.
  for (const jobId of jobIds) {
    await bucket.delete(galleryR2Key(userId, jobId));
  }

  return Response.json({ deleted: jobIds.length });
}
