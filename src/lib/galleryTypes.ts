/**
 * Pages-side declaration of the GalleryEntryV1 contract.
 *
 * IMPORTANT: This is a cross-repo contract. The canonical definition lives
 * in the consumer Worker repo at spritebrew-rd-consumer/src/types.ts.
 * The Pages app does NOT import that directly — it keeps this copy in sync.
 *
 * Any change to this shape requires a coordinated update on both sides AND
 * a schema-version bump. Current schema version: v1.
 *
 * Last reviewed against consumer Worker: Day-10 (May 21, 2026).
 * Consumer Worker writer: spritebrew-rd-consumer/src/gallery.ts writeGalleryEntry().
 */

export type JobMode = 'create' | 'animate';

export interface GalleryEntryV1 {
  jobId: string;
  prompt: string;       // truncated to first 300 chars by writer
  style: string;        // RD wire form, e.g. 'rd_pro__fantasy'
  mode: JobMode;
  action?: string;      // animate-only; suffix of prompt_style
  createdAt: number;    // ms epoch; sourced from completedAt
  v: 1;                 // schema version
}

/**
 * KV key shape used by the consumer Worker. invTs = (MAX_SAFE_INTEGER - createdAt).toString()
 * so a prefix list returns entries newest-first lexicographically.
 *
 * Pages side: read-only — we never construct gen: keys for writing.
 */
export const GALLERY_KV_PREFIX = 'gen:';

/**
 * R2 object key shape: `${userId}/${jobId}.png`. No `gallery/` prefix.
 * The bucket name itself provides the namespace.
 */
export function galleryR2Key(userId: string, jobId: string): string {
  return `${userId}/${jobId}.png`;
}
