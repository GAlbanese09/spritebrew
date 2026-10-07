'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Download, Grid3X3, Loader2, Scan, Sparkles } from 'lucide-react';
import UploadZone from '@/components/sprites/UploadZone';
import SlicerConfig, { type SliceConfig } from '@/components/sprites/SlicerConfig';
import FrameGrid from '@/components/sprites/FrameGrid';
import AnimationPanel from '@/components/sprites/AnimationPanel';
import FrameSizeResizer from '@/components/sprites/FrameSizeResizer';
import SpriteDetector, { type SpriteDetectorExtractResult } from '@/components/sprites/SpriteDetector';
import BgRemovalBanner from '@/components/sprites/BgRemovalBanner';
import ConfirmDiscardDialog from '@/components/sprites/ConfirmDiscardDialog';
import Button from '@/components/ui/Button';
import { useSpriteStore } from '@/stores/spriteStore';
import { useSheetLeaveGuard } from '@/hooks/useSheetLeaveGuard';
import {
  generateFrameId,
  loadImage,
  imageToCanvas,
  extractFrame,
  frameToDataURL,
} from '@/lib/spriteUtils';
import type { SpriteFrame, SpriteSheet } from '@/lib/types';
import { exportRawFrames } from '@/lib/exportEngine';

type SliceMode = 'grid' | 'auto';

const LARGE_IMAGE_THRESHOLD = 128;

interface UploadedImage {
  file: File;
  blobUrl: string;
  width: number;
  height: number;
  isGif?: boolean;
}

/** The generated image this page last loaded from the store. Module scope so
 *  it lives as long as the in-memory store does (client navigation keeps
 *  both; a reload resets both). Lets the mount effect tell "back from
 *  /preview with the same image" (keep the sheet) from "a new image was sent
 *  to the slicer" (replace the sheet, asking first if groups exist). */
let consumedGeneratedImage: string | null = null;

/** Re-cut every existing frame rect from a new source image. Frame ids and
 *  rects are unchanged, so groups that reference them stay valid. */
async function reextractFrames(sourceUrl: string, sheet: SpriteSheet): Promise<Map<string, string>> {
  const img = await loadImage(sourceUrl);
  const sourceCanvas = imageToCanvas(img);
  const urls = new Map<string, string>();
  for (const frame of sheet.animations.flatMap((a) => a.frames)) {
    if (urls.has(frame.id)) continue;
    const frameCanvas = extractFrame(sourceCanvas, frame.x, frame.y, frame.width, frame.height);
    urls.set(frame.id, frameToDataURL(frameCanvas));
  }
  return urls;
}

export default function UploadPage() {
  const router = useRouter();
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);
  const animations = useSpriteStore((s) => s.animations);
  const frameDataUrls = useSpriteStore((s) => s.frameDataUrls);
  const setSpriteSheet = useSpriteStore((s) => s.setSpriteSheet);
  const clearSpriteSheet = useSpriteStore((s) => s.clearSpriteSheet);
  const setFrameDataUrls = useSpriteStore((s) => s.setFrameDataUrls);
  const replaceSheetSource = useSpriteStore((s) => s.replaceSheetSource);
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);

  const [uploaded, setUploaded] = useState<UploadedImage | null>(null);
  const [slicing, setSlicing] = useState(false);
  const [fromGenerated, setFromGenerated] = useState(false);
  // True once the user has either resized or chosen to keep the original size
  const [sizeAcknowledged, setSizeAcknowledged] = useState(false);
  // Pre-populated frame size after a FrameSizeResizer accept
  const [preferredFrameW, setPreferredFrameW] = useState<number | undefined>();
  const [preferredFrameH, setPreferredFrameH] = useState<number | undefined>();
  // Slicing mode: grid (uniform rows/columns) or auto (contour/blob detection)
  const [sliceMode, setSliceMode] = useState<SliceMode>('grid');
  // Background removal banner: true = dismissed (user clicked Keep or Apply)
  const [bgBannerDismissed, setBgBannerDismissed] = useState(false);
  // True while a bulk-PNG ZIP is being assembled — disables the button + shows
  // a spinner. ZIP can take a few seconds on larger sheets.
  const [downloadingZip, setDownloadingZip] = useState(false);
  // An action that would clear the user's groups, held until they answer
  // the confirm dialog. Null while no confirm is open.
  const [pendingDiscard, setPendingDiscard] = useState<{
    run: () => void;
    cancel?: () => void;
  } | null>(null);

  useSheetLeaveGuard();

  /** Runs `run` now when there are no groups to lose; otherwise opens the
   *  confirm dialog. `cancel` undoes any side work the caller already did
   *  (e.g. revoking a new file's blob URL); everything else stays as is. */
  const askBeforeDiscard = useCallback((run: () => void, cancel?: () => void) => {
    if (useSpriteStore.getState().animations.length > 0) {
      setPendingDiscard({ run, cancel });
    } else {
      run();
    }
  }, []);

  // Auto-load generated image from store on mount. We copy the data URL
  // into local state but do NOT clear it from the Zustand store — this lets
  // the user navigate back to /generate and still see their last result with
  // all controls (zoom, background removal, download, Send to Slicer).
  // The result is only cleared explicitly via "Generate Another".
  //
  // Coming back from /preview or /export with the same generated image keeps
  // the sliced sheet (B4): the page shows it with "Replace sheet" instead.
  useEffect(() => {
    if (generatedImageDataUrl && !uploaded) {
      if (useSpriteStore.getState().spriteSheet && generatedImageDataUrl === consumedGeneratedImage) {
        return;
      }
      const load = () => {
        consumedGeneratedImage = generatedImageDataUrl;
        const img = new Image();
        img.onload = () => {
          const blobUrl = generatedImageDataUrl;
          setUploaded({
            file: new File([], 'generated_sprite.png', { type: 'image/png' }),
            blobUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          setFromGenerated(true);
          setSizeAcknowledged(true);
          clearSpriteSheet();
          // NOTE: intentionally NOT calling clearGeneratedImage() here
        };
        img.src = generatedImageDataUrl;
      };
      // Cancel keeps the current sheet; mark the image seen so the next
      // visit does not ask again for the same image.
      askBeforeDiscard(load, () => {
        consumedGeneratedImage = generatedImageDataUrl;
      });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImageLoaded = useCallback(
    (file: File, blobUrl: string, width: number, height: number) => {
      const apply = () => {
        const isGif = file.type === 'image/gif';
        setUploaded({ file, blobUrl, width, height, isGif });
        setFromGenerated(false);
        setPreferredFrameW(undefined);
        setPreferredFrameH(undefined);
        setBgBannerDismissed(false);
        // If the image is larger than the threshold on any side, require acknowledgement
        const needsAlert = width > LARGE_IMAGE_THRESHOLD || height > LARGE_IMAGE_THRESHOLD;
        setSizeAcknowledged(!needsAlert);
        clearSpriteSheet();
      };
      // Cancel drops the new file and keeps the current sheet.
      askBeforeDiscard(apply, () => URL.revokeObjectURL(blobUrl));
    },
    [clearSpriteSheet, askBeforeDiscard]
  );

  const handleRemove = useCallback(() => {
    askBeforeDiscard(() => {
      if (uploaded && !fromGenerated) {
        URL.revokeObjectURL(uploaded.blobUrl);
      }
      setUploaded(null);
      setFromGenerated(false);
      setSizeAcknowledged(false);
      setPreferredFrameW(undefined);
      setPreferredFrameH(undefined);
      setSliceMode('grid');
      setBgBannerDismissed(false);
      clearSpriteSheet();
    });
  }, [uploaded, fromGenerated, clearSpriteSheet, askBeforeDiscard]);

  /** B4 view's "Replace sheet": clears the kept sheet so the dropzone shows. */
  const handleReplaceSheet = useCallback(() => {
    askBeforeDiscard(() => {
      const source = useSpriteStore.getState().spriteSheet?.sourceImage;
      if (source?.startsWith('blob:')) URL.revokeObjectURL(source);
      clearSpriteSheet();
    });
  }, [clearSpriteSheet, askBeforeDiscard]);

  /** User accepted a resized sheet from FrameSizeResizer. Includes the chosen
   *  frame dimensions so the slicer can pre-populate its grid. */
  const handleResizeAccept = useCallback(
    (resizedDataUrl: string, sheetW: number, sheetH: number, frameW: number, frameH: number) => {
      if (!uploaded) return;
      if (!fromGenerated) URL.revokeObjectURL(uploaded.blobUrl);
      setUploaded({
        ...uploaded,
        blobUrl: resizedDataUrl,
        width: sheetW,
        height: sheetH,
      });
      setFromGenerated(true); // treat as data URL so we don't revoke it
      setPreferredFrameW(frameW);
      setPreferredFrameH(frameH);
      setSizeAcknowledged(true);
      clearSpriteSheet();
    },
    [uploaded, fromGenerated, clearSpriteSheet]
  );

  /** User chose to proceed with the original large image. The resizer passes
   *  the grid-derived current frame dimensions so the slicer pre-populates. */
  const handleKeepOriginal = useCallback((frameW: number, frameH: number) => {
    setPreferredFrameW(frameW);
    setPreferredFrameH(frameH);
    setSizeAcknowledged(true);
  }, []);

  /** User confirmed background removal. Replace the in-memory image with the
   *  cleaned version; original file on disk is untouched. An existing sliced
   *  sheet keeps its frame grid: every frame is re-cut from the cleaned image
   *  at the same rect and id, so groups survive. */
  const handleBgRemoved = useCallback(
    (cleanedDataUrl: string) => {
      if (!uploaded) return;
      // Load the cleaned image to get its dimensions
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const swapImage = () => {
          if (!fromGenerated) URL.revokeObjectURL(uploaded.blobUrl);
          setUploaded({ ...uploaded, blobUrl: cleanedDataUrl, width, height });
          setFromGenerated(true); // data URL, don't revoke
          setBgBannerDismissed(true);
        };
        const swapAndClear = () => {
          swapImage();
          clearSpriteSheet();
        };
        const sheet = useSpriteStore.getState().spriteSheet;
        if (!sheet) {
          swapImage();
          return;
        }
        if (width !== uploaded.width || height !== uploaded.height) {
          // The grid no longer fits the image; the sheet has to go.
          askBeforeDiscard(swapAndClear);
          return;
        }
        reextractFrames(cleanedDataUrl, sheet)
          .then((urls) => {
            replaceSheetSource(cleanedDataUrl, urls);
            swapImage();
          })
          .catch(() => askBeforeDiscard(swapAndClear));
      };
      img.src = cleanedDataUrl;
    },
    [uploaded, fromGenerated, clearSpriteSheet, replaceSheetSource, askBeforeDiscard]
  );

  const handleSlice = useCallback(
    async (config: SliceConfig) => {
      if (!uploaded) return;
      setSlicing(true);

      try {
        const img = await loadImage(uploaded.blobUrl);
        const sourceCanvas = imageToCanvas(img);

        const frames: SpriteFrame[] = [];
        const urls = new Map<string, string>();

        for (let r = 0; r < config.rows; r++) {
          for (let c = 0; c < config.columns; c++) {
            const x = config.offsetX + c * (config.frameWidth + config.padding);
            const y = config.offsetY + r * (config.frameHeight + config.padding);

            const id = generateFrameId();
            const frameCanvas = extractFrame(
              sourceCanvas,
              x,
              y,
              config.frameWidth,
              config.frameHeight
            );
            const dataUrl = frameToDataURL(frameCanvas);
            urls.set(id, dataUrl);

            frames.push({
              id,
              imageData: null,
              x,
              y,
              width: config.frameWidth,
              height: config.frameHeight,
              duration: 1000 / 8,
            });
          }
        }

        const sheet: SpriteSheet = {
          id: `sheet-${Date.now()}`,
          name: uploaded.file.name.replace(/\.[^.]+$/, '') || 'generated_sprite',
          sourceImage: uploaded.blobUrl,
          frameWidth: config.frameWidth,
          frameHeight: config.frameHeight,
          columns: config.columns,
          rows: config.rows,
          totalFrames: frames.length,
          animations: [
            {
              id: 'all-frames',
              name: 'All Frames',
              type: 'all',
              frames,
              fps: 8,
              loop: true,
            },
          ],
          padding: config.padding,
        };

        setSpriteSheet(sheet);
        setFrameDataUrls(urls);
      } finally {
        setSlicing(false);
      }
    },
    [uploaded, setSpriteSheet, setFrameDataUrls]
  );

  /** Handler for the Auto-detect Sprites mode's Extract button. Produces the
   *  same SpriteSheet + frameDataUrls format as the grid slicer, so the rest
   *  of the pipeline (FrameGrid, AnimationPanel, Preview, Export) works
   *  identically regardless of which mode was used. */
  const handleAutoExtract = useCallback(
    (result: SpriteDetectorExtractResult) => {
      if (!uploaded) return;
      setSlicing(true);
      try {
        const { frames: extracted, frameWidth, frameHeight } = result;
        const frames: SpriteFrame[] = [];
        const urls = new Map<string, string>();

        for (const ef of extracted) {
          frames.push({
            id: ef.id,
            imageData: null,
            x: ef.x,
            y: ef.y,
            width: ef.width,
            height: ef.height,
            duration: 1000 / 8,
          });
          urls.set(ef.id, ef.dataUrl);
        }

        const sheet: SpriteSheet = {
          id: `sheet-${Date.now()}`,
          name: uploaded.file.name.replace(/\.[^.]+$/, '') || 'auto_detected',
          sourceImage: uploaded.blobUrl,
          frameWidth,
          frameHeight,
          columns: frames.length, // non-grid layout; store as single row
          rows: 1,
          totalFrames: frames.length,
          animations: [
            {
              id: 'all-frames',
              name: 'All Frames',
              type: 'all',
              frames,
              fps: 8,
              loop: true,
            },
          ],
          padding: 0,
        };

        setSpriteSheet(sheet);
        setFrameDataUrls(urls);
      } finally {
        setSlicing(false);
      }
    },
    [uploaded, setSpriteSheet, setFrameDataUrls]
  );

  const canContinue = useMemo(
    () => animations.some((a) => a.frames.length > 0),
    [animations]
  );

  /** Shortcut export: invokes the same exportRawFrames path the /preview
   *  Export page uses, with no manifest and no resize. Transparency from
   *  the bg-removal banner carries through end-to-end (PNG preserves alpha). */
  const handleDownloadAllFrames = useCallback(async () => {
    if (!spriteSheet || !canContinue || downloadingZip) return;
    setDownloadingZip(true);
    try {
      await exportRawFrames({
        animations,
        frameDataUrls,
        frameWidth: spriteSheet.frameWidth,
        frameHeight: spriteSheet.frameHeight,
        padding: 0,
        powerOfTwo: false,
        includeMetadata: false,
        sheetName: spriteSheet.name,
        includeManifest: false,
      });
    } finally {
      setDownloadingZip(false);
    }
  }, [animations, frameDataUrls, spriteSheet, canContinue, downloadingZip]);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Upload & Slice</h1>
        <p className="text-sm font-mono text-text-secondary">
          Drop a sprite sheet image, define frame dimensions, and slice it into
          individual frames for preview and export.
        </p>
      </div>

      {/* Generated image banner */}
      {fromGenerated && uploaded && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-amber-glow border border-accent-amber/20 px-4 py-3">
          <Sparkles size={14} className="text-accent-amber flex-shrink-0" />
          <p className="text-xs font-mono text-accent-amber">
            Generated image loaded — configure frame size and slice.
          </p>
        </div>
      )}

      {/* Upload zone. B4: back from /preview or /export the page has no
          local image but the store still holds the sliced sheet, so show
          that sheet instead of an empty dropzone. */}
      {!uploaded && spriteSheet ? (
        <div className="rounded-lg border border-border-default bg-bg-surface p-4">
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="relative flex-shrink-0 rounded border border-border-subtle overflow-hidden"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                backgroundSize: '8px 8px',
                backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={spriteSheet.sourceImage}
                alt="Uploaded sprite sheet"
                className="block max-w-[200px] max-h-[200px]"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-text-secondary">Sprite sheet loaded</p>
            </div>
            <Button variant="secondary" size="md" onClick={handleReplaceSheet}>
              Replace sheet
            </Button>
          </div>
        </div>
      ) : (
        <UploadZone
          onImageLoaded={handleImageLoaded}
          currentImage={uploaded?.blobUrl ?? null}
          onRemove={handleRemove}
        />
      )}

      <ConfirmDiscardDialog
        open={pendingDiscard !== null}
        onCancel={() => {
          pendingDiscard?.cancel?.();
          setPendingDiscard(null);
        }}
        onContinue={() => {
          pendingDiscard?.run();
          setPendingDiscard(null);
        }}
      />

      {/* Background removal banner — shown after upload if a solid background
          is detected. Non-blocking: user can Keep or Remove before proceeding. */}
      {uploaded && !bgBannerDismissed && (
        <BgRemovalBanner
          imageUrl={uploaded.blobUrl}
          imageWidth={uploaded.width}
          imageHeight={uploaded.height}
          onRemoved={handleBgRemoved}
          onDismiss={() => setBgBannerDismissed(true)}
        />
      )}

      {/* Mode tabs — always visible as soon as an image is uploaded, so the
          user can switch to Auto-detect Sprites without being blocked by the
          grid-mode resize panel. */}
      {uploaded && (
        <div className="flex gap-1 rounded-lg bg-bg-secondary p-1 w-fit">
          <button
            onClick={() => setSliceMode('grid')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono cursor-pointer transition-colors
              ${sliceMode === 'grid'
                ? 'bg-accent-amber text-bg-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
          >
            <Grid3X3 size={14} />
            Grid Slicer
          </button>
          <button
            onClick={() => setSliceMode('auto')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono cursor-pointer transition-colors
              ${sliceMode === 'auto'
                ? 'bg-accent-amber text-bg-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
          >
            <Scan size={14} />
            Auto-detect Sprites
          </button>
        </div>
      )}

      {/* Size alert — ONLY for Grid Slicer mode. Auto-detect works on the
          original image regardless of size, so the resize step is skipped
          when the user is in auto-detect mode. */}
      {uploaded && sliceMode === 'grid' && !sizeAcknowledged && (
        <FrameSizeResizer
          sourceDataUrl={uploaded.blobUrl}
          sourceWidth={uploaded.width}
          sourceHeight={uploaded.height}
          onAccept={handleResizeAccept}
          onKeepOriginal={handleKeepOriginal}
        />
      )}

      {/* Grid Slicer — shown after upload and size acknowledged */}
      {uploaded && sliceMode === 'grid' && sizeAcknowledged && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6 space-y-4">
          <SlicerConfig
            imageUrl={uploaded.blobUrl}
            imageWidth={uploaded.width}
            imageHeight={uploaded.height}
            initialFrameWidth={preferredFrameW}
            initialFrameHeight={preferredFrameH}
            onSlice={handleSlice}
          />
          {slicing && (
            <p className="mt-4 text-xs font-mono text-accent-amber animate-pulse">
              Slicing frames...
            </p>
          )}
        </div>
      )}

      {/* Auto-detect Sprites — shown directly, no resize required */}
      {uploaded && sliceMode === 'auto' && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6 space-y-4">
          <SpriteDetector
            imageUrl={uploaded.blobUrl}
            imageWidth={uploaded.width}
            imageHeight={uploaded.height}
            onExtract={handleAutoExtract}
          />
          {slicing && (
            <p className="mt-4 text-xs font-mono text-accent-amber animate-pulse">
              Extracting sprites...
            </p>
          )}
        </div>
      )}

      {/* Frame grid — shown after slicing */}
      {spriteSheet && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6">
          <FrameGrid frameDataUrls={frameDataUrls} />
        </div>
      )}

      {/* Animation panel — shown after slicing */}
      {spriteSheet && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6">
          <AnimationPanel frameDataUrls={frameDataUrls} />
        </div>
      )}

      {/* Continue / shortcut export buttons */}
      {spriteSheet && (
        <div className="flex flex-wrap justify-end items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            disabled={!canContinue || downloadingZip}
            onClick={handleDownloadAllFrames}
            aria-label="Download all sliced frames as a ZIP of transparent PNG files"
          >
            {downloadingZip ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Preparing download...
              </>
            ) : (
              <>
                <Download size={16} />
                Download all frames (PNG ZIP)
              </>
            )}
          </Button>
          <Button
            size="lg"
            disabled={!canContinue}
            onClick={() => router.push('/preview')}
          >
            Continue to Preview
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
