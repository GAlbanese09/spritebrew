'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Grid3X3, Scan, Sparkles } from 'lucide-react';
import UploadZone from '@/components/sprites/UploadZone';
import SlicerConfig, { type SliceConfig } from '@/components/sprites/SlicerConfig';
import FrameGrid from '@/components/sprites/FrameGrid';
import AnimationPanel from '@/components/sprites/AnimationPanel';
import FrameSizeResizer from '@/components/sprites/FrameSizeResizer';
import SpriteDetector, { type SpriteDetectorExtractResult } from '@/components/sprites/SpriteDetector';
import Button from '@/components/ui/Button';
import { useSpriteStore } from '@/stores/spriteStore';
import {
  generateFrameId,
  loadImage,
  imageToCanvas,
  extractFrame,
  frameToDataURL,
} from '@/lib/spriteUtils';
import type { SpriteFrame, SpriteSheet } from '@/lib/types';

type SliceMode = 'grid' | 'auto';

const LARGE_IMAGE_THRESHOLD = 128;

interface UploadedImage {
  file: File;
  blobUrl: string;
  width: number;
  height: number;
  isGif?: boolean;
}

export default function UploadPage() {
  const router = useRouter();
  const spriteSheet = useSpriteStore((s) => s.spriteSheet);
  const animations = useSpriteStore((s) => s.animations);
  const frameDataUrls = useSpriteStore((s) => s.frameDataUrls);
  const setSpriteSheet = useSpriteStore((s) => s.setSpriteSheet);
  const clearSpriteSheet = useSpriteStore((s) => s.clearSpriteSheet);
  const setFrameDataUrls = useSpriteStore((s) => s.setFrameDataUrls);
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);
  const clearGeneratedImage = useSpriteStore((s) => s.clearGeneratedImage);

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

  // Auto-load generated image from store on mount
  useEffect(() => {
    if (generatedImageDataUrl && !uploaded) {
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
        // Generated images are already pixel-perfect; skip the size alert
        setSizeAcknowledged(true);
        clearSpriteSheet();
        clearGeneratedImage();
      };
      img.src = generatedImageDataUrl;
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImageLoaded = useCallback(
    (file: File, blobUrl: string, width: number, height: number) => {
      const isGif = file.type === 'image/gif';
      setUploaded({ file, blobUrl, width, height, isGif });
      setFromGenerated(false);
      setPreferredFrameW(undefined);
      setPreferredFrameH(undefined);
      // If the image is larger than the threshold on any side, require acknowledgement
      const needsAlert = width > LARGE_IMAGE_THRESHOLD || height > LARGE_IMAGE_THRESHOLD;
      setSizeAcknowledged(!needsAlert);
      clearSpriteSheet();
    },
    [clearSpriteSheet]
  );

  const handleRemove = useCallback(() => {
    if (uploaded && !fromGenerated) {
      URL.revokeObjectURL(uploaded.blobUrl);
    }
    setUploaded(null);
    setFromGenerated(false);
    setSizeAcknowledged(false);
    setPreferredFrameW(undefined);
    setPreferredFrameH(undefined);
    setSliceMode('grid');
    clearSpriteSheet();
  }, [uploaded, fromGenerated, clearSpriteSheet]);

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

      {/* Upload zone */}
      <UploadZone
        onImageLoaded={handleImageLoaded}
        currentImage={uploaded?.blobUrl ?? null}
        onRemove={handleRemove}
      />

      {/* Size alert — shown when image exceeds 128px on either side and user hasn't acknowledged.
          User picks a FRAME size; we calculate the sheet target that divides evenly. */}
      {uploaded && !sizeAcknowledged && (
        <FrameSizeResizer
          sourceDataUrl={uploaded.blobUrl}
          sourceWidth={uploaded.width}
          sourceHeight={uploaded.height}
          onAccept={handleResizeAccept}
          onKeepOriginal={handleKeepOriginal}
        />
      )}

      {/* Slicer / Detector — shown after upload and size acknowledged */}
      {uploaded && sizeAcknowledged && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6 space-y-4">
          {/* Mode tabs — Grid Slicer (uniform rows/columns) vs Auto-detect (contour) */}
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

          {sliceMode === 'grid' ? (
            <SlicerConfig
              imageUrl={uploaded.blobUrl}
              imageWidth={uploaded.width}
              imageHeight={uploaded.height}
              initialFrameWidth={preferredFrameW}
              initialFrameHeight={preferredFrameH}
              onSlice={handleSlice}
            />
          ) : (
            <SpriteDetector
              imageUrl={uploaded.blobUrl}
              imageWidth={uploaded.width}
              imageHeight={uploaded.height}
              onExtract={handleAutoExtract}
            />
          )}
          {slicing && (
            <p className="mt-4 text-xs font-mono text-accent-amber animate-pulse">
              {sliceMode === 'grid' ? 'Slicing frames...' : 'Extracting sprites...'}
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

      {/* Continue button */}
      {spriteSheet && (
        <div className="flex justify-end">
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
