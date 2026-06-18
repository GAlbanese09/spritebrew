/**
 * editorRecovery / indexedDbDraftStore.ts — the local-storage adapter.
 *
 * Implements EditorDraftStore over IndexedDB via the `idb` promise wrapper.
 * Two object stores:
 *   - `manifests` (keyPath: 'draftId', indexes: by-projectKey, by-updatedAt)
 *   - `payloads`  (out-of-line key = payloadKey, value = compressed Blob)
 *
 * Correctness invariants — these are why the file exists:
 *
 *   1. Two-phase commit. In ONE readwrite tx, the new payload is `put` first
 *      and the manifest is `put` last. If the tx fails mid-flight, IndexedDB
 *      rolls both back atomically; if it commits, the manifest never
 *      references a missing payload. Cleanup may later GC orphaned payloads.
 *
 *   2. Previous-payload fallback. Each save reads the existing manifest
 *      WITHIN the same tx, captures its current payloadKey/sha/compression as
 *      the new previous*, and writes a fresh unique payloadKey. Result:
 *      every committed manifest carries two integrity-checkable payloads, so
 *      a single-payload corruption (e.g., partial write before a crash) is
 *      survivable.
 *
 *   3. Deterministic draftId = projectKey. Repeated saves overwrite the SAME
 *      logical draft entry (one project → one manifest), keeping the index
 *      bounded; the "previous payload" lineage handles the rollback story.
 *
 *   4. Quota handling. QuotaExceededError triggers ONE cleanup pass and a
 *      retry; if that also fails, we throw RecoveryQuotaError so the
 *      controller can surface a banner. We do NOT silently drop data.
 *
 *   5. SHA-256 verification on load. loadDraft recomputes the hash of the
 *      stored Blob and falls back to the previous payload if it differs.
 *      Both failed → RecoveryCorruptError (loud, not silent garbage).
 *
 *   6. Cleanup. After every successful save, fire-and-forget cleanup GCs
 *      payloads no longer referenced by any manifest's current OR previous
 *      key — the only producers of orphans.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import {
  RecoveryCorruptError,
  RecoveryQuotaError,
  type EditorDraftStore,
  type LoadedDraft,
  type RecoveryCandidate,
  type RecoveryManifestV1,
  type SaveDraftInput,
} from './types';
import { gunzipToBytes, gzipBytes, sha256Hex, summarizeProject } from './pack';

const DB_NAME = 'spritebrew-editor-recovery';
const DB_VERSION = 1;
const MANIFEST_STORE = 'manifests' as const;
const PAYLOAD_STORE = 'payloads' as const;

interface RecoveryDbV1 extends DBSchema {
  manifests: {
    key: string;
    value: RecoveryManifestV1;
    indexes: {
      'by-projectKey': string;
      'by-updatedAt': number;
    };
  };
  payloads: {
    key: string;
    value: Blob;
  };
}

/** Schema migration. Object stores + indexes are created here on first open;
 *  bumping DB_VERSION later requires a coordinated extension. */
function upgrade(db: IDBPDatabase<RecoveryDbV1>): void {
  if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
    const manifests = db.createObjectStore(MANIFEST_STORE, { keyPath: 'draftId' });
    manifests.createIndex('by-projectKey', 'projectKey');
    manifests.createIndex('by-updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains(PAYLOAD_STORE)) {
    // Out-of-line keys — caller supplies a unique payloadKey per save.
    db.createObjectStore(PAYLOAD_STORE);
  }
}

/** QuotaExceededError detector. Browsers report it either as a DOMException
 *  with name === 'QuotaExceededError' (modern) or with the legacy numeric
 *  code 22; some Safari versions hide it under InvalidStateError too, but
 *  we conservatively check the canonical signal. */
function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === 'QuotaExceededError' || e.code === 22;
}

/** Stable-prefix payloadKey: literal "draftId::" tag so the keyspace is
 *  greppable, followed by the actual draftId, a millisecond timestamp, and
 *  a UUID. The timestamp+UUID guarantees uniqueness even if two saves land
 *  in the same millisecond (which they should not — controller serializes). */
function newPayloadKey(draftId: string): string {
  return `draftId::${draftId}::${Date.now()}::${crypto.randomUUID()}`;
}

export class IndexedDbDraftStore implements EditorDraftStore {
  /** One-shot DB connection, lazily opened and reused. Held as a promise so
   *  concurrent first-callers share a single open() instead of racing. The
   *  cache is evicted on rejection (transient open() failure must not poison
   *  the store for the page lifetime) and on `terminated` (the browser killed
   *  the connection — eviction, version-upgrade-from-another-tab). Both fire
   *  through the same null-out-if-still-current pattern so a later successful
   *  open() can't be clobbered by an old failed handle. */
  private dbPromise: Promise<IDBPDatabase<RecoveryDbV1>> | null = null;

  /** In-flight cleanup, if any. Concurrent callers join the same promise
   *  instead of stacking redundant cleanup transactions — fire-and-forget
   *  post-save cleanup is then cheap during edit bursts (1 cleanup per
   *  burst, not N). Correctness comes from the single-tx scoping inside
   *  runCleanup(); this field is purely a perf knob. */
  private cleanupInFlight: Promise<void> | null = null;

  private getDb(): Promise<IDBPDatabase<RecoveryDbV1>> {
    if (!this.dbPromise) {
      const p = openDB<RecoveryDbV1>(DB_NAME, DB_VERSION, {
        upgrade,
        terminated: () => { if (this.dbPromise === p) this.dbPromise = null; },
      });
      p.catch(() => { if (this.dbPromise === p) this.dbPromise = null; });
      this.dbPromise = p;
    }
    return this.dbPromise;
  }

  async saveDraft(input: SaveDraftInput): Promise<RecoveryCandidate> {
    const db = await this.getDb();
    const draftId = input.projectKey;

    // Prepare OUTSIDE the tx — gzip + sha256 are awaits that must not be
    // interleaved with the IDB tx (those awaits would auto-commit it).
    // gzipBytes synchronously snapshots the input bytes via `new Blob([...])`,
    // so any subsequent mutation of the source buffer cannot affect the
    // payload we're about to persist.
    const u8 = new Uint8Array(
      input.bytes.buffer,
      input.bytes.byteOffset,
      input.bytes.byteLength,
    );
    const { blob, compression } = await gzipBytes(u8);
    const payloadSha256 = await sha256Hex(blob);
    const payloadKey = newPayloadKey(draftId);
    const now = Date.now();
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';
    const summary = summarizeProject(input.project);

    // The actual write — wrapped in a closure so we can retry it after a
    // cleanup pass if the first attempt hits QuotaExceededError.
    const write = async (): Promise<RecoveryManifestV1> => {
      const tx = db.transaction([MANIFEST_STORE, PAYLOAD_STORE], 'readwrite');
      // Read existing manifest WITHIN the tx so the previous-payload lineage
      // is consistent with the manifest we're about to overwrite (no race
      // window between read and write).
      const existing = await tx.objectStore(MANIFEST_STORE).get(draftId);

      const manifest: RecoveryManifestV1 = {
        manifestSchema: 'spritebrew.recovery.manifest',
        manifestVersion: 1,
        draftId,
        projectKey: input.projectKey,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        appVersion,
        project: input.project,
        payloadKey,
        payloadBytes: blob.size,
        payloadSha256,
        compression,
        previousPayloadKey: existing?.payloadKey,
        previousPayloadSha256: existing?.payloadSha256,
        previousCompression: existing?.compression,
        summary,
      };

      // Two-phase: payload FIRST, manifest LAST. A crash between these two
      // puts is rolled back by the tx; a crash after the tx commits leaves a
      // manifest pointing at a complete payload.
      await tx.objectStore(PAYLOAD_STORE).put(blob, payloadKey);
      await tx.objectStore(MANIFEST_STORE).put(manifest);
      await tx.done;
      return manifest;
    };

    let manifest: RecoveryManifestV1;
    try {
      manifest = await write();
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      // Quota path — run cleanup once and retry. cleanup() may free space by
      // dropping payloads orphaned from prior aborted saves; if the retry
      // still throws quota, we surface RecoveryQuotaError so the controller
      // can warn the user.
      await this.cleanup();
      try {
        manifest = await write();
      } catch (err2) {
        if (isQuotaError(err2)) throw new RecoveryQuotaError();
        throw err2;
      }
    }

    // Post-commit cleanup is fire-and-forget — it GCs the payload we just
    // displaced (now older than `previousPayloadKey`) plus any earlier
    // orphans. Failure here must not fail the save.
    void this.cleanup().catch(() => { /* swallow */ });

    return { manifest };
  }

  async loadDraft(draftId: string): Promise<LoadedDraft> {
    const db = await this.getDb();
    const manifest = await db.get(MANIFEST_STORE, draftId);
    if (!manifest) {
      throw new RecoveryCorruptError(`No recovery manifest for draft "${draftId}".`);
    }

    // Verify a candidate payload key against its expected SHA-256. Returns
    // the unpacked bytes on match, null on miss/mismatch (so the caller can
    // fall back to the previous payload).
    const tryPayload = async (
      key: string,
      expectedSha: string,
      compression: 'gzip' | 'none',
    ): Promise<Uint8ClampedArray | null> => {
      const blob = await db.get(PAYLOAD_STORE, key);
      if (!blob) return null;
      const sha = await sha256Hex(blob);
      if (sha !== expectedSha) return null;
      return gunzipToBytes(blob, compression);
    };

    // Current payload first.
    const current = await tryPayload(
      manifest.payloadKey,
      manifest.payloadSha256,
      manifest.compression,
    );
    if (current) return { project: manifest.project, bytes: current };

    // Fall back to the previous payload if all three previous-fields are
    // present — saveDraft writes them as a triple, so a partial set here
    // means no recoverable previous.
    if (
      manifest.previousPayloadKey &&
      manifest.previousPayloadSha256 &&
      manifest.previousCompression
    ) {
      const prev = await tryPayload(
        manifest.previousPayloadKey,
        manifest.previousPayloadSha256,
        manifest.previousCompression,
      );
      if (prev) return { project: manifest.project, bytes: prev };
    }

    throw new RecoveryCorruptError(
      `Draft "${draftId}" failed payload integrity check (current and previous both unrecoverable).`,
    );
  }

  async getLatest(projectKey: string): Promise<RecoveryCandidate | null> {
    const db = await this.getDb();
    const candidates = await db.getAllFromIndex(MANIFEST_STORE, 'by-projectKey', projectKey);
    if (candidates.length === 0) return null;
    // draftId === projectKey today, so this normally returns 1 row. The
    // max-updatedAt pick is defensive: if a future schema ever lets two
    // drafts share a projectKey (e.g., a "duplicate" feature), the newest
    // one is the right candidate to restore.
    let latest = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].updatedAt > latest.updatedAt) latest = candidates[i];
    }
    return { manifest: latest };
  }

  async listDrafts(): Promise<RecoveryCandidate[]> {
    const db = await this.getDb();
    // by-updatedAt yields ascending — reverse for the newest-first contract.
    const ascending = await db.getAllFromIndex(MANIFEST_STORE, 'by-updatedAt');
    const out: RecoveryCandidate[] = [];
    for (let i = ascending.length - 1; i >= 0; i--) {
      out.push({ manifest: ascending[i] });
    }
    return out;
  }

  async deleteDraft(draftId: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([MANIFEST_STORE, PAYLOAD_STORE], 'readwrite');
    // Read the manifest within the tx so the payload deletes line up with
    // the same generation we're removing.
    const manifest = await tx.objectStore(MANIFEST_STORE).get(draftId);
    if (manifest) {
      await tx.objectStore(PAYLOAD_STORE).delete(manifest.payloadKey);
      if (manifest.previousPayloadKey) {
        await tx.objectStore(PAYLOAD_STORE).delete(manifest.previousPayloadKey);
      }
    }
    await tx.objectStore(MANIFEST_STORE).delete(draftId);
    await tx.done;
  }

  async cleanup(): Promise<void> {
    // Dedup concurrent cleanups. The post-save fire-and-forget in saveDraft
    // means many cleanups can be requested in quick succession; joining a
    // single in-flight pass collapses them, and IDB's readwrite tx scheduling
    // already gives any save that lands during a cleanup the correct atomic
    // ordering against runCleanup()'s tx.
    if (this.cleanupInFlight) return this.cleanupInFlight;
    const work = this.runCleanup().finally(() => {
      if (this.cleanupInFlight === work) this.cleanupInFlight = null;
    });
    this.cleanupInFlight = work;
    return work;
  }

  /** Atomic orphan sweep. CRITICAL: manifest enumeration and payload deletion
   *  MUST share one readwrite tx so concurrent saveDraft tx's are serialized
   *  by IDB onto one side or the other of this whole operation. Splitting the
   *  read and the delete into separate tx's (the prior implementation) opens
   *  a window where a save committing between them gets its just-written
   *  payload deleted as an "orphan" — silently destroying committed data.
   *  Adversarial review caught this; do not re-split. */
  private async runCleanup(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([MANIFEST_STORE, PAYLOAD_STORE], 'readwrite');
    const manifests = await tx.objectStore(MANIFEST_STORE).getAll();
    const referenced = new Set<string>();
    for (const m of manifests) {
      referenced.add(m.payloadKey);
      if (m.previousPayloadKey) referenced.add(m.previousPayloadKey);
    }
    const payloads = tx.objectStore(PAYLOAD_STORE);
    const keys = await payloads.getAllKeys();
    for (const key of keys) {
      if (!referenced.has(key)) {
        await payloads.delete(key);
      }
    }
    await tx.done;
  }
}

/**
 * Ask the browser to mark this origin's storage as persistent (so the OS /
 * browser cache eviction won't drop it under storage pressure). Resolves
 * `true` if granted, `false` if denied or unsupported. Safe to call any
 * number of times — the browser only prompts (if at all) on the first call.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Probe whether IndexedDB recovery is actually usable. Some contexts that
 * SAY they have IndexedDB still throw on first write (Firefox private mode,
 * locked-down webviews, third-party iframe in cookie-blocked origins). We
 * detect by opening the DB and doing a no-op write-then-delete under a temp
 * key; any throw → false.
 */
export async function isRecoveryAvailable(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const db = await openDB<RecoveryDbV1>(DB_NAME, DB_VERSION, { upgrade });
    const probeKey = `__probe__::${Date.now()}::${crypto.randomUUID()}`;
    const probeBlob = new Blob([new Uint8Array([0])]);
    const tx = db.transaction(PAYLOAD_STORE, 'readwrite');
    await tx.objectStore(PAYLOAD_STORE).put(probeBlob, probeKey);
    await tx.objectStore(PAYLOAD_STORE).delete(probeKey);
    await tx.done;
    db.close();
    return true;
  } catch {
    return false;
  }
}
