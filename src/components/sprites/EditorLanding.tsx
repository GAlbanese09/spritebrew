'use client';

import { useState } from 'react';
import { UploadCloud, FilePlus, FolderOpen, Image as ImageIcon } from 'lucide-react';
import UploadZone from './UploadZone';
import Button from '@/components/ui/Button';

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
  onProjectReady: (frameDataUrl: string, width: number, height: number) => void;
}

export default function EditorLanding({ onProjectReady }: EditorLandingProps) {
  const [size, setSize] = useState<SizePreset>(32);

  function handleStartBlank() {
    // Empty canvas → transparent PNG data URL.
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const dataUrl = canvas.toDataURL('image/png');
    onProjectReady(dataUrl, size, size);
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-4xl mx-auto">
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
              onImageLoaded={(_file, blobUrl, w, h) => onProjectReady(blobUrl, w, h)}
              currentImage={null}
              onRemove={() => {}}
            />
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
