/**
 * editorRecovery — barrel.
 *
 * Stage 1 ships the persistence layer behind the EditorDraftStore interface.
 * Stage 2 will wire the controller (debounce, idle/visibility/pagehide
 * triggers, banner state machine) on top. Stage 3 adds the Cloudflare R2
 * adapter, which slots in as an additional EditorDraftStore implementation.
 *
 * Re-exports the public surface so consumers do
 *   `import { IndexedDbDraftStore, ... } from '@/lib/editorRecovery'`
 * and never reach into the per-file paths.
 */

import { createBlankProject } from '@/lib/spriteProject';

import {
  IndexedDbDraftStore,
  isRecoveryAvailable,
  requestPersistentStorage,
} from './indexedDbDraftStore';
import { gunzipToBytes, gzipBytes, sha256Hex, summarizeProject } from './pack';
import {
  RecoveryCorruptError,
  RecoveryQuotaError,
  RecoveryUnavailableError,
} from './types';

// ── Public types ────────────────────────────────────────────────────────────
export type {
  EditorDraftStore,
  LoadedDraft,
  RecoveryCandidate,
  RecoveryManifestV1,
  SaveDraftInput,
  SaveReason,
} from './types';

// ── Public values ───────────────────────────────────────────────────────────
export {
  IndexedDbDraftStore,
  isRecoveryAvailable,
  requestPersistentStorage,
  gunzipToBytes,
  gzipBytes,
  sha256Hex,
  summarizeProject,
  RecoveryCorruptError,
  RecoveryQuotaError,
  RecoveryUnavailableError,
};

/**
 * devRecoverySelfTest — a one-shot integration smoke check.
 *
 * Builds a synthetic SpriteProjectV1 + sized pixel buffer, runs
 * saveDraft → loadDraft, asserts byte-equal round-trip + canvas dim match,
 * logs the result, cleans up the test draft, and returns pass/fail.
 *
 * Stage 2 may wire this behind a /debug toggle for browser-side verification
 * after deploys. Pure JS; safe to call in any browser context once the DB is
 * available (caller should gate on isRecoveryAvailable in production).
 */
export async function devRecoverySelfTest(): Promise<boolean> {
  const store = new IndexedDbDraftStore();
  const width = 16;
  const height = 16;
  const project = createBlankProject({
    width,
    height,
    name: 'recovery self-test',
    source: { kind: 'blank' },
  });
  // Deterministic synthetic pattern — a recognisable byte stream so a
  // round-trip mismatch is visible at a glance in any debugger inspector.
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 31) & 0xff;
  }
  const projectKey = `__self-test__::${Date.now()}::${crypto.randomUUID()}`;

  try {
    await store.saveDraft({
      projectKey,
      project,
      bytes,
      reason: 'explicit',
    });
    const loaded = await store.loadDraft(projectKey);

    if (loaded.project.canvas.width !== width || loaded.project.canvas.height !== height) {
      console.error('[editorRecovery] self-test FAIL: canvas dims mismatch', {
        expected: { width, height },
        got: { width: loaded.project.canvas.width, height: loaded.project.canvas.height },
      });
      return false;
    }
    if (loaded.bytes.length !== bytes.length) {
      console.error('[editorRecovery] self-test FAIL: byte length mismatch', {
        expected: bytes.length, got: loaded.bytes.length,
      });
      return false;
    }
    for (let i = 0; i < bytes.length; i++) {
      if (loaded.bytes[i] !== bytes[i]) {
        console.error('[editorRecovery] self-test FAIL: byte mismatch at index', i, {
          expected: bytes[i], got: loaded.bytes[i],
        });
        return false;
      }
    }
    console.log('[editorRecovery] self-test PASS', {
      width, height, bytes: bytes.length,
    });
    return true;
  } catch (err) {
    console.error('[editorRecovery] self-test FAIL: threw', err);
    return false;
  } finally {
    try { await store.deleteDraft(projectKey); } catch { /* swallow */ }
  }
}
