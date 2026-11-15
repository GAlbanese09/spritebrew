import { getAuthedUserId } from '@/lib/edgeAuth';
import { GALLERY_KV_PREFIX, galleryR2Key, type GalleryEntryV1 } from '@/lib/galleryTypes';
import { jobStateR2Key } from '@/lib/jobState';

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
  const auth = await getAuthedUserId(request);
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
 * DELETE /api/gallery?cursor=
 *
 * Deletes the authenticated user's gallery entries in batches, and says how
 * many are left so the page can call again.
 *
 * Each batch lists up to 100 index entries (`gen:` keys), deletes their
 * pictures and job status copies in one R2 call, and only then deletes the
 * index entries. So a picture never outlives its index entry: a request that
 * stops part-way leaves entries that are still listed, and calling again
 * finishes them (deleting a missing R2 object or KV key succeeds).
 *
 * Calls to KV and R2 count toward Cloudflare's per-request limit: 10,000 by
 * default on Workers Paid, which this account is on (1,000 to Cloudflare's
 * own services on Free). A batch is about 102 calls; a request does at most
 * 34 batches (3,400 entries, about 3,470 calls), plus one list call per 1,000
 * entries to count what is left. One call on `main` reached about 3,330
 * entries (three calls an entry under 10,000), so today's page, which calls
 * once, clears at least as much as it did.
 *
 * Response (200):
 *   { deleted, remaining, done, cursor }
 *   deleted: index entries this request deleted. A list that lags behind
 *     earlier deletes (KV catches up within about a minute) can show a name
 *     already deleted; deleting it again counts it again.
 *   remaining: entries still listed after this request, counted from where it
 *     stopped, up to REMAINING_COUNT_CAP (`remainingAtLeast: true` when the
 *     count stopped there with more pages to read); null when the count
 *     itself failed (the deletes stand).
 *   done: true when nothing is left to delete. A generation that finished
 *     during a clear spread over several calls may sort before the cursor
 *     and stay; it is new, and a later clear deletes it.
 *   cursor: pass as ?cursor= on the next call. null when done, and also when
 *     the next call should start again from the beginning (always safe).
 * A request that stops part-way answers 503 with
 *   { error, deleted, done: false, cursor } (cursor as above: where to start
 *   again, or null for the beginning).
 *
 * The deletion runbook does not call this route: it deletes R2 objects with
 * wrangler (runbook 91095042, Step 4d).
 */
const DELETE_BATCH = 100;
const DELETE_MAX_BATCHES = 34;
const REMAINING_COUNT_CAP = 10_000;
const MAX_CURSOR_LENGTH = 2048;

/**
 * The job ids an index entry names: its metadata's and its key's last part
 * (gen:{userId}:{invTs}:{jobId}). The consumer writes both from one job id;
 * if they ever differ, both are deleted.
 */
function entryJobIds(name: string, prefix: string, metadata: unknown): string[] {
  const ids: string[] = [];
  const md = metadata as Partial<GalleryEntryV1> | null | undefined;
  if (md && typeof md.jobId === 'string' && md.jobId.length > 0) ids.push(md.jobId);
  const rest = name.slice(prefix.length);
  const sep = rest.indexOf(':');
  const fromName = sep >= 0 ? rest.slice(sep + 1) : '';
  if (fromName.length > 0 && !ids.includes(fromName)) ids.push(fromName);
  return ids;
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await getAuthedUserId(request);
  if ('error' in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId;

  const startCursor = new URL(request.url).searchParams.get('cursor') || undefined;
  if (startCursor !== undefined && startCursor.length > MAX_CURSOR_LENGTH) {
    return Response.json({ error: 'Invalid cursor.' }, { status: 400 });
  }

  const kv = getKV();
  const bucket = getR2();
  if (!kv || !bucket) {
    return Response.json({ error: 'Storage unavailable.' }, { status: 503 });
  }

  const prefix = `${GALLERY_KV_PREFIX}${userId}:`;
  let deleted = 0;
  let foreign = 0;
  // Where the batch being worked on started: a stop there is retried from it.
  let batchCursor: string | undefined = startCursor;
  let nextCursor: string | undefined = startCursor;
  let listComplete = false;
  // The step that was running, for the log line if it fails. A failed list
  // may mean a cursor KV no longer accepts, so its retry starts from the
  // beginning.
  let step: 'list' | 'r2' | 'kv' = 'list';

  try {
    for (let b = 0; b < DELETE_MAX_BATCHES && !listComplete; b++) {
      batchCursor = nextCursor;
      step = 'list';
      const page = await kv.list({
        prefix,
        limit: DELETE_BATCH,
        ...(batchCursor ? { cursor: batchCursor } : {}),
      });

      // Only this user's own entries, whatever the cursor: the cursor comes
      // from the caller, so a name outside the prefix is never acted on.
      const own = page.keys.filter((k) => k.name.startsWith(prefix));
      foreign += page.keys.length - own.length;

      // 1. The batch's pictures and job status copies, in one call. Every key
      //    comes from this user's own index entries.
      const r2Keys: string[] = [];
      for (const k of own) {
        for (const jobId of entryJobIds(k.name, prefix, k.metadata)) {
          r2Keys.push(galleryR2Key(userId, jobId));
          r2Keys.push(jobStateR2Key(jobId));
        }
      }
      step = 'r2';
      if (r2Keys.length > 0) {
        await bucket.delete(r2Keys);
      }

      // 2. Only then the index entries.
      step = 'kv';
      for (const k of own) {
        await kv.delete(k.name);
        deleted++;
      }

      listComplete = page.list_complete;
      nextCursor = page.list_complete ? undefined : page.cursor;
      if (!listComplete && !nextCursor) {
        // A page that says more remain but gives no cursor: stop here and
        // let the next call list again from the start.
        break;
      }
    }
  } catch {
    console.error(JSON.stringify({ source: 'gallery-delete', event: 'stopped', step, deleted, foreign }));
    return Response.json(
      {
        error: 'Some generations could not be deleted. Try again to finish.',
        deleted,
        done: false,
        cursor: step === 'list' ? null : batchCursor ?? null,
      },
      { status: 503 }
    );
  }
  if (foreign > 0) {
    console.error(JSON.stringify({ source: 'gallery-delete', event: 'foreign_names_skipped', foreign }));
  }

  if (listComplete) {
    return Response.json({ deleted, remaining: 0, done: true, cursor: null });
  }

  // Count what is left, from where this request stopped.
  let remaining = 0;
  let remainingAtLeast = false;
  try {
    let countCursor: string | undefined = nextCursor;
    let countComplete = false;
    while (!countComplete) {
      if (remaining >= REMAINING_COUNT_CAP) {
        remainingAtLeast = true;
        break;
      }
      const page = await kv.list({
        prefix,
        limit: 1000,
        ...(countCursor ? { cursor: countCursor } : {}),
      });
      remaining += page.keys.filter((k) => k.name.startsWith(prefix)).length;
      countComplete = page.list_complete || !page.cursor;
      countCursor = page.cursor;
    }
  } catch {
    // The count is for the page's progress line only; the deletes stand.
    console.error(JSON.stringify({ source: 'gallery-delete', event: 'count_failed', deleted }));
    return Response.json({ deleted, remaining: null, done: false, cursor: nextCursor ?? null });
  }

  const done = remaining === 0 && !remainingAtLeast;
  return Response.json({
    deleted,
    remaining,
    ...(remainingAtLeast ? { remainingAtLeast: true } : {}),
    done,
    cursor: done ? null : nextCursor ?? null,
  });
}
