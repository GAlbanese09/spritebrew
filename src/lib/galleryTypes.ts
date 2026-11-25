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
/**
 * What a card holds, for the filters, the paging and the badge (external
 * audit SB-24): an animate job, or a create job whose style is an animation
 * (Animate from Text, and the Create form's animation styles before it), is
 * Animated; any other create job is Created. Worked out on read, so old and
 * new records agree. The job's own mode still decides how its picture is
 * stored and downloaded. Shared by the Gallery page and the single delete
 * route's kind check (HQ 2026-11-25-079).
 */
export function entryKind(entry: GalleryEntryV1): JobMode | null {
  if (entry.mode === 'animate') return 'animate';
  // A mode the Gallery does not know (none today) is neither kind, so no
  // kind's Clear reaches it without someone deciding so (AUDIT
  // ext-mediums r1 L3). A record without a style counts by its mode.
  if (entry.mode !== 'create') return null;
  return typeof entry.style === 'string' && entry.style.startsWith('animation__') ? 'animate' : 'create';
}

export const GALLERY_KV_PREFIX = 'gen:';

/**
 * R2 object key shape: `${userId}/${jobId}.png`. No `gallery/` prefix.
 * The bucket name itself provides the namespace.
 */
export function galleryR2Key(userId: string, jobId: string): string {
  return `${userId}/${jobId}.png`;
}

/**
 * Animation action → slicer animationType mapping.
 * Ported from generate/page.tsx (the original localStorage-write site)
 * so the gallery can derive slicer hints from server-side GalleryEntryV1
 * data without re-reading the (now-deprecated for gallery) generationHistory module.
 *
 * Last reviewed against generate/page.tsx: Day-10 (May 21, 2026).
 * If actions are added to RD's animate mode, this map must grow too.
 */
export const ANIMATE_ACTION_TO_SLICER_TYPE: Record<string, string> = {
  walking: 'walk',
  idle: 'idle',
  attack: 'attack',
  jump: 'jump',
  crouch: 'crouch',
  destroy: 'destroy',
  subtle_motion: 'subtle',
  custom_action: 'custom',
};

/**
 * Structurally compatible with SlicerHints in @/lib/generationHistory.
 * Declared locally to avoid coupling Phase 4 to that module (which Phase 5+ may retire).
 * The spriteStore consumes via TypeScript structural typing — exact name match not required.
 */
export interface DerivedSlicerHints {
  source: 'animate' | 'create';
  animationType: string;
  frameCount: number;
  directional: boolean;
  rows?: number;
  frameSize?: number;
}

/**
 * Derive slicer hints from a server-side GalleryEntryV1.
 *
 * - create-mode → null (matches today's behavior; slicer auto-detects from canvas)
 * - animate-mode with action → reconstructed hints
 *
 * The frameCount/directional values are constants here because AnimationPanel.tsx's
 * computeAutoAssignProposal only reads animationType and directional from hints.
 * The entry records no frame size or frame count, so frameSize is left unset and
 * frameCount is a placeholder: SlicerConfig guesses the size from the image and
 * keeps every cell at that size instead of trusting this frameCount.
 */
export function deriveSlicerHints(entry: GalleryEntryV1): DerivedSlicerHints | null {
  if (entry.mode !== 'animate' || !entry.action) return null;
  return {
    source: 'animate',
    animationType: ANIMATE_ACTION_TO_SLICER_TYPE[entry.action] ?? 'custom',
    frameCount: 4,
    directional: false,
  };
}
