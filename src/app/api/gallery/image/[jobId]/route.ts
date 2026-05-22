import { getAuthedUserId } from '@/lib/edgeAuth';
import { galleryR2Key } from '@/lib/galleryTypes';

export const runtime = 'edge';

interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

function getR2(): R2Bucket | null {
  const env = process.env as unknown as { GALLERY_BUCKET?: R2Bucket };
  const bucket = env.GALLERY_BUCKET;
  if (!bucket || typeof bucket.get !== 'function') return null;
  return bucket;
}

/**
 * GET /api/gallery/image/[jobId]
 *
 * Streams the PNG blob for a specific generation owned by the authenticated user.
 *
 * Ownership enforcement: the R2 key is constructed from the AUTHENTICATED userId,
 * NOT from anything the caller controls. An attacker passing a jobId they don't
 * own will get a 404 because the key {their_userId}/{your_jobId}.png doesn't exist.
 *
 * No KV lookup needed for the read path — if the blob exists at the
 * userId-scoped R2 key, the user owns it by definition.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> | { jobId: string } }
): Promise<Response> {
  const auth = getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const params = await Promise.resolve(context.params);
  const { jobId } = params;
  if (!jobId || typeof jobId !== 'string') {
    return Response.json({ error: 'Invalid jobId.' }, { status: 400 });
  }

  const bucket = getR2();
  if (!bucket) {
    return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  }

  const obj = await bucket.get(galleryR2Key(userId, jobId));
  if (!obj) {
    return new Response('Not found.', { status: 404 });
  }

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/png',
      // Private cache so the browser caches across renders but proxies don't share.
      // Short TTL because deletions need to invalidate quickly.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
