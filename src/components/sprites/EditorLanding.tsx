'use client';

import { useState } from 'react';
import { UploadCloud, FilePlus, FolderOpen, Image as ImageIcon, AlertCircle, RotateCcw } from 'lucide-react';
import UploadZone from './UploadZone';
import Button from '@/components/ui/Button';
import {
  dimsWithinEditorLimits,
  editorDimsRejectionMessage,
} from '@/components/sprites/editorStore';
import type { SpriteProjectSource } from '@/lib/spriteProject';
import type { RecoveryCandidate } from '@/lib/editorRecovery';

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
  /** Stage 3: a recoverable page-mode draft, or null/undefined if none.
   *  When set, a restore banner renders above the start cards. */
  recoveryCandidate?: RecoveryCandidate | null;
  /** Restore the draft (parent reads bytes and mounts the body in restore mode). */
  onRestoreDraft?: () => void;
  /** Discard the draft (parent deletes it from IndexedDB). */
  onDiscardDraft?: () => void;
}

/** Relative-time formatter for the restore banner. Cheap, no Intl — the
 *  banner just needs "just now" / "5 minutes ago" / "2 hours ago" / "1 day
 *  ago" granularity. */
function formatDraftAge(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function EditorLanding({
  onProjectReady,
  recoveryCandidate,
  onRestoreDraft,
  onDiscardDraft,
}: EditorLandingProps) {
  const [size, setSize] = useState<SizePreset>(32);
  // Fix #5: editor-specific dimension guardrail at the upload ingestion point.
  // UploadZone itself stays generic (the /upload slicer route uses it with
  // larger sheets); we filter on the editor side so the user gets immediate
  // feedback without a page transition into the body.
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handleStartBlank() {
    // Empty canvas → transparent PNG data URL.
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const dataUrl = canvas.toDataURL('image/png');
    onProjectReady(dataUrl, size, size, { kind: 'blank' });
  }

  function handleUploadLoaded(_file: File, blobUrl: string, w: number, h: number) {
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
        {recoveryCandidate && (
          <div className="mb-6 rounded-lg border border-accent-amber bg-bg-surface p-4 flex items-start gap-3">
            <RotateCcw size={18} className="text-accent-amber flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono font-semibold text-text-primary mb-1">
                Recover your last edit?
              </p>
              <p className="text-[11px] font-mono text-text-secondary leading-relaxed">
                A {recoveryCandidate.manifest.summary.width}×{recoveryCandidate.manifest.summary.height} draft
                from {formatDraftAge(recoveryCandidate.manifest.updatedAt)} is saved on this device.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <Button variant="primary" size="sm" onClick={onRestoreDraft}>
                  Restore
                </Button>
                <button
                  onClick={onDiscardDraft}
                  className="text-[11px] font-mono text-text-muted hover:text-text-primary cursor-pointer px-2 py-1"
                >
                  Discard
                </button>
              </div>
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
                  Open a PNG or JPG and start editing pixel by pixel.
                </p>
              </div>
            </div>

            <UploadZone
              onImageLoaded={handleUploadLoaded}
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
