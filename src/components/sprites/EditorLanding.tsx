'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { UploadCloud, FilePlus, FolderOpen, Image as ImageIcon, AlertCircle, RotateCcw } from 'lucide-react';
import UploadZone from './UploadZone';
import Button from '@/components/ui/Button';
import {
  dimsWithinEditorLimits,
  editorDimsRejectionMessage,
} from '@/components/sprites/editorStore';
import type { SpriteProjectSource } from '@/lib/spriteProject';
import { draftHeading, draftListLine, draftSentence, type RecoveryManifestV1 } from '@/lib/editorRecovery';

/**
 * Landing UI for the /editor route. Lets the user choose how to start
 * a new editing session — blank canvas at a chosen size, or an uploaded
 * image. Two future entry points (open existing project, pick from
 * gallery) are visually present but disabled.
 *
 * On a chosen entry point this component does NOT touch the editorStore.
 * Instead it produces a PNG data/blob URL plus dimensions and hands them
 * to the parent via `onProjectReady`. The parent (EditorPage) renders
 * <PixelEditorBody> which has the canonical "load this frameDataUrl into
 * the store" useEffect — single entry point, no duplicate loadFrame.
 */

const SIZE_PRESETS = [16, 32, 64, 128, 256] as const;
type SizePreset = (typeof SIZE_PRESETS)[number];

interface EditorLandingProps {
  /** Hand off a decoded image to the parent for editor mount. The 4th arg
   *  carries provenance into the SpriteProjectV1 document model (Wave 1b).
   *  Optional so future entry points can omit when origin is unknown. */
  onProjectReady: (
    frameDataUrl: string,
    width: number,
    height: number,
    source?: SpriteProjectSource,
  ) => void;
  /** The saved editor drafts this user may restore, newest first (from
   *  either editor surface; BUILD 2026-10-29). The newest gets the restore
   *  banner above the start cards; the rest are listed under it. */
  drafts?: RecoveryManifestV1[];
  /** Told the moment an upload starts, before its image is decoded, so the
   *  parent can drop a restore that is still loading (the later choice wins). */
  onChoose?: () => void;
  /** Restore a draft (parent reads its bytes and mounts the body in restore mode). */
  onRestoreDraft?: (draftId: string) => void;
  /** Discard a draft (parent deletes it from IndexedDB). */
  onDiscardDraft?: (draftId: string) => void;
}

export default function EditorLanding({
  onProjectReady,
  onChoose,
  drafts = [],
  onRestoreDraft,
  onDiscardDraft,
}: EditorLandingProps) {
  const [newest, ...older] = drafts;
  // The user's choices here (a blank canvas, an upload, a restore): the
  // latest one wins. An uploaded image that finishes decoding after a later
  // choice, or after this landing went (liveRef turns false in the commit
  // that removes it), opens nothing (Second 122: a late decode replaced the
  // draft the user had restored since).
  const choiceRef = useRef(0);
  const uploadRef = useRef<{ file: File; choice: number } | null>(null);
  const liveRef = useRef(false);
  useLayoutEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);
  const [size, setSize] = useState<SizePreset>(32);
  // Fix #5: editor-specific dimension guardrail at the upload ingestion point.
  // UploadZone itself stays generic (the /upload slicer route uses it with
  // larger sheets); we filter on the editor side so the user gets immediate
  // feedback without a page transition into the body.
  const [uploadError, setUploadError] = useState<string | null>(null);

  function restoreDraft(draftId: string) {
    choiceRef.current++;
    onRestoreDraft?.(draftId);
  }

  function handleStartBlank() {
    choiceRef.current++;
    // Empty canvas → transparent PNG data URL.
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const dataUrl = canvas.toDataURL('image/png');
    onProjectReady(dataUrl, size, size, { kind: 'blank' });
  }

  function handleUploadStart(file: File) {
    uploadRef.current = { file, choice: ++choiceRef.current };
    onChoose?.();
  }

  function handleUploadLoaded(file: File, blobUrl: string, w: number, h: number) {
    const upload = uploadRef.current;
    if (!liveRef.current || !upload || upload.file !== file || upload.choice !== choiceRef.current) {
      // A later choice came, or the landing went: this image is not wanted.
      URL.revokeObjectURL(blobUrl);
      return;
    }
    uploadRef.current = null;
    if (!dimsWithinEditorLimits(w, h)) {
      // Revoke the blob URL we won't be using.
      URL.revokeObjectURL(blobUrl);
      setUploadError(editorDimsRejectionMessage(w, h));
      return;
    }
    setUploadError(null);
    onProjectReady(blobUrl, w, h, { kind: 'upload' });
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-4xl mx-auto">
        {newest && (
          <div className="mb-6 rounded-lg border border-accent-amber bg-bg-surface p-4 flex items-start gap-3">
            <RotateCcw size={18} className="text-accent-amber flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono font-semibold text-text-primary mb-1">
                {draftHeading(newest)}
              </p>
              <p className="text-[11px] font-mono text-text-secondary leading-relaxed">
                {draftSentence(newest)}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <Button variant="primary" size="sm" onClick={() => restoreDraft(newest.draftId)}>
                  Restore
                </Button>
                <button
                  onClick={() => onDiscardDraft?.(newest.draftId)}
                  className="text-[11px] font-mono text-text-muted hover:text-text-primary cursor-pointer px-2 py-1"
                >
                  Discard
                </button>
              </div>
              {older.length > 0 && (
                <div className="mt-4 border-t border-border-subtle pt-3">
                  <p className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2">Older drafts</p>
                  <ul className="flex flex-col gap-2">
                    {older.map((m) => (
                      <li key={m.draftId} className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-mono text-text-secondary flex-1 min-w-0">{draftListLine(m)}</span>
                        <button
                          onClick={() => restoreDraft(m.draftId)}
                          aria-label={`Restore ${draftListLine(m)}`}
                          className="text-[11px] font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer px-2 py-1"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => onDiscardDraft?.(m.draftId)}
                          aria-label={`Discard ${draftListLine(m)}`}
                          className="text-[11px] font-mono text-text-muted hover:text-text-primary cursor-pointer px-2 py-1"
                        >
                          Discard
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
        <h1 className="font-display text-sm text-accent-amber mb-2">Pixel Editor</h1>
        <p className="text-sm font-mono text-text-secondary mb-8">
          Start a new project or upload an image to edit pixel by pixel.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CARD 1: New blank canvas */}
          <div className="rounded-lg border border-border-default bg-bg-surface p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-accent-amber-glow flex items-center justify-center text-accent-amber">
                <FilePlus size={20} />
              </div>
              <div>
                <h2 className="text-sm font-mono font-semibold text-text-primary">
                  New blank canvas
                </h2>
                <p className="text-[11px] font-mono text-text-muted">
                  Start from scratch at the size of your choice.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
                Size
              </label>
              <div className="flex gap-1 flex-wrap">
                {SIZE_PRESETS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                      ${size === s
                        ? 'bg-accent-amber text-bg-primary'
                        : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                      }`}
                  >
                    {s}×{s}
                  </button>
                ))}
              </div>
            </div>

            <Button variant="primary" size="md" onClick={handleStartBlank}>
              Start blank {size}×{size}
            </Button>
          </div>

          {/* CARD 2: Upload image */}
          <div className="rounded-lg border border-border-default bg-bg-surface p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-accent-amber-glow flex items-center justify-center text-accent-amber">
                <UploadCloud size={20} />
              </div>
              <div>
                <h2 className="text-sm font-mono font-semibold text-text-primary">
                  Upload image to edit
                </h2>
                <p className="text-[11px] font-mono text-text-muted">
                  Open a PNG, WEBP or GIF and start editing pixel by pixel.
                </p>
              </div>
            </div>

            <UploadZone
              onImageLoaded={handleUploadLoaded}
              onLoadStart={handleUploadStart}
              currentImage={null}
              onRemove={() => {}}
            />
            {uploadError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] font-mono text-text-secondary leading-relaxed flex-1 min-w-0">
                  {uploadError}
                </p>
                <button
                  onClick={() => setUploadError(null)}
                  className="text-[10px] font-mono text-text-muted hover:text-text-primary cursor-pointer flex-shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {/* CARD 3: Open project (disabled — coming soon) */}
          <div
            className="rounded-lg border border-dashed border-border-default bg-bg-surface p-6 opacity-50 cursor-not-allowed flex flex-col gap-3"
            title="Coming soon"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-bg-elevated flex items-center justify-center text-text-muted">
                <FolderOpen size={20} />
              </div>
              <div>
                <h2 className="text-sm font-mono font-semibold text-text-muted">
                  Open project
                </h2>
                <p className="text-[11px] font-mono text-text-muted">
                  Resume a saved project. Coming soon.
                </p>
              </div>
            </div>
          </div>

          {/* CARD 4: Pick from gallery (disabled — coming soon) */}
          <div
            className="rounded-lg border border-dashed border-border-default bg-bg-surface p-6 opacity-50 cursor-not-allowed flex flex-col gap-3"
            title="Coming soon"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-bg-elevated flex items-center justify-center text-text-muted">
                <ImageIcon size={20} />
              </div>
              <div>
                <h2 className="text-sm font-mono font-semibold text-text-muted">
                  Pick from gallery
                </h2>
                <p className="text-[11px] font-mono text-text-muted">
                  Edit a past generation. Coming soon.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
