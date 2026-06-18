/**
 * editorRecovery — types and contracts.
 *
 * Stage 1 of editor crash-recovery auto-save. The interface here is the seam
 * a future remote (R2-backed) adapter plugs into without code changes in the
 * editor; the IndexedDB-backed IndexedDbDraftStore is the only concrete
 * implementation today.
 *
 * Pure types — no DOM, no IndexedDB. Safe to import from anywhere.
 */

import type { SpriteProjectV1 } from '@/lib/spriteProject';

/**
 * Why a save was triggered. Stage 2 wiring uses this to differentiate
 * debounced edit saves from idle/lifecycle/explicit ones. 'restore' is
 * reserved for when a successful restore re-arms the controller.
 */
export type SaveReason = 'edit' | 'idle' | 'lifecycle' | 'explicit' | 'restore';

/**
 * Manifest envelope persisted in the `manifests` object store. Carries the
 * project document (envelope only — frame pixels live in the payload Blob)
 * plus integrity metadata for the current payload AND a one-deep previous
 * payload kept as the corruption fallback (two-phase safety net).
 *
 * Stable on-disk shape — bump manifestVersion if a breaking change ever lands.
 */
export interface RecoveryManifestV1 {
  manifestSchema: 'spritebrew.recovery.manifest';
  manifestVersion: 1;
  draftId: string;
  projectKey: string;
  createdAt: number;
  updatedAt: number;
  appVersion: string;
  // Project envelope only — pixel bytes live in the payload, never here.
  project: SpriteProjectV1;
  // Current payload.
  payloadKey: string;
  payloadBytes: number;
  payloadSha256: string;
  compression: 'gzip' | 'none';
  // Previous payload, kept as a corruption fallback (the two-phase safety net).
  previousPayloadKey?: string;
  previousPayloadSha256?: string;
  previousCompression?: 'gzip' | 'none';
  // Lets the restore banner render without unpacking the payload.
  summary: { width: number; height: number; frameCount: number };
}

export interface SaveDraftInput {
  projectKey: string;
  project: SpriteProjectV1;   // from editorStore.toProject()
  bytes: Uint8ClampedArray;   // from editorStore.getFramePixels(frameId)
  reason: SaveReason;
}

export interface RecoveryCandidate { manifest: RecoveryManifestV1; }
export interface LoadedDraft { project: SpriteProjectV1; bytes: Uint8ClampedArray; }

/**
 * The persistence seam. Stage 2 (the controller) depends on this interface,
 * not on IndexedDbDraftStore — so the remote (R2) adapter in Wave 3 is a
 * pure additive: implement EditorDraftStore, swap the controller's instance.
 */
export interface EditorDraftStore {
  saveDraft(input: SaveDraftInput): Promise<RecoveryCandidate>;
  loadDraft(draftId: string): Promise<LoadedDraft>;
  getLatest(projectKey: string): Promise<RecoveryCandidate | null>;
  listDrafts(): Promise<RecoveryCandidate[]>;
  deleteDraft(draftId: string): Promise<void>;
  cleanup(): Promise<void>;
}

// ── Typed errors ────────────────────────────────────────────────────────────
//
// Each carries a distinct `name` so callers can `switch (err.name)` rather
// than parsing messages. instanceof checks also work — these extend Error.

/** Thrown when a save fails because the browser refuses to allocate more
 *  storage even after a cleanup pass. The controller should surface this to
 *  the user (the recovery banner becomes "storage full, please save"). */
export class RecoveryQuotaError extends Error {
  constructor(message = 'IndexedDB quota exceeded; recovery save failed.') {
    super(message);
    this.name = 'RecoveryQuotaError';
  }
}

/** Thrown when a load can't be served from either the current OR the previous
 *  payload (missing keys or SHA-256 mismatches). Restoration must fail loud
 *  rather than silently load garbage. */
export class RecoveryCorruptError extends Error {
  constructor(message = 'Recovery draft is corrupt; payload integrity check failed.') {
    super(message);
    this.name = 'RecoveryCorruptError';
  }
}

/** Thrown from isRecoveryAvailable / probe paths when IndexedDB itself can't
 *  be opened or written to — private browsing, locked-down webviews, or a
 *  storage-disabled iframe. Recovery is silently disabled in these contexts. */
export class RecoveryUnavailableError extends Error {
  constructor(message = 'IndexedDB recovery storage is unavailable in this context.') {
    super(message);
    this.name = 'RecoveryUnavailableError';
  }
}
