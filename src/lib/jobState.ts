/**
 * Pages-side copy of the job record write path (status-store.md 001, step 3).
 *
 * The consumer's canonical helper is spritebrew-rd-consumer/src/jobState.ts
 * putJobState(). Same contract here: the full record, the exact JSON that
 * goes to KV, is mirrored to R2 at jobs/{jobId}.json first, then written to
 * KV as before. The R2 write is best effort: a failure logs and never fails
 * the request beyond one retry. The status route reads R2 first because R2
 * reads are strongly consistent, and falls back to KV when R2 has nothing.
 */

export const JOB_TTL_S = 60 * 60;

/** R2 answers a second write to one key inside about a second with error
 *  10058; one retry after this delay clears it. */
const R2_RETRY_DELAY_MS = 1_100;

export function jobStateR2Key(jobId: string): string {
  return `jobs/${jobId}.json`;
}

export interface JobStateR2Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, opts?: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface JobStateKV {
  put(key: string, value: string, opts?: unknown): Promise<void>;
}

export function getJobStateBucket(): JobStateR2Bucket | null {
  const env = process.env as unknown as { GALLERY_BUCKET?: JobStateR2Bucket };
  const bucket = env.GALLERY_BUCKET;
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function') return null;
  return bucket;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function putJobStateR2(jobId: string, body: string): Promise<void> {
  const bucket = getJobStateBucket();
  if (!bucket) {
    console.warn('[jobState] GALLERY_BUCKET unavailable; KV only', JSON.stringify({ jobId }));
    return;
  }
  const key = jobStateR2Key(jobId);
  const put = () => bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  try {
    await put();
    return;
  } catch (err) {
    console.warn('[jobState] R2 put failed, retrying once', JSON.stringify({ jobId, error: errText(err) }));
  }
  await new Promise((resolve) => setTimeout(resolve, R2_RETRY_DELAY_MS));
  try {
    await put();
  } catch (err) {
    console.warn('[jobState] R2 put failed after retry; KV only', JSON.stringify({ jobId, error: errText(err) }));
  }
}

/**
 * Writes the job record to R2, then to KV (`job:{jobId}`), the same JSON in
 * both. A KV failure throws, as the bare kv.put did before.
 */
export async function putJobState(kv: JobStateKV, jobId: string, state: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify(state);
  await putJobStateR2(jobId, body);
  await kv.put(`job:${jobId}`, body, { expirationTtl: JOB_TTL_S });
}
