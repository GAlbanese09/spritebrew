'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Sparkles } from 'lucide-react';
import UploadZone from '@/components/sprites/UploadZone';
import SlicerConfig, { type SliceConfig } from '@/components/sprites/SlicerConfig';
import FrameGrid from '@/components/sprites/FrameGrid';
import AnimationPanel from '@/components/sprites/AnimationPanel';
import ImageResizer from '@/components/sprites/ImageResizer';
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
    clearSpriteSheet();
  }, [uploaded, fromGenerated, clearSpriteSheet]);

  /** User accepted a resized version from the ImageResizer */
  const handleResizeAccept = useCallback(
    (resizedDataUrl: string, w: number, h: number) => {
      if (!uploaded) return;
      if (!fromGenerated) URL.revokeObjectURL(uploaded.blobUrl);
      setUploaded({
        ...uploaded,
        blobUrl: resizedDataUrl,
        width: w,
        height: h,
      });
      setFromGenerated(true); // treat as data URL so we don't revoke it
      setSizeAcknowledged(true);
      clearSpriteSheet();
    },
    [uploaded, fromGenerated, clearSpriteSheet]
  );

  /** User chose to proceed with the original large image */
  const handleKeepOriginal = useCallback(() => {
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

      {/* Size alert — shown when image exceeds 128px on either side and user hasn't acknowledged */}
      {uploaded && !sizeAcknowledged && (
        <ImageResizer
          sourceDataUrl={uploaded.blobUrl}
          sourceWidth={uploaded.width}
          sourceHeight={uploaded.height}
          defaultTarget={128}
          allowKeepOriginal
          keepOriginalWarning="Large images may have slower performance in the editor and preview."
          onAccept={handleResizeAccept}
          onKeepOriginal={handleKeepOriginal}
          isGif={uploaded.isGif}
          description={`Your image is ${uploaded.width}x${uploaded.height}. For best results with pixel art, images should be 128x128 or smaller. You can resize below, or keep the original size and proceed directly to slicing.`}
        />
      )}

      {/* Slicer config — shown after upload and size acknowledged */}
      {uploaded && sizeAcknowledged && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6">
          <SlicerConfig
            imageUrl={uploaded.blobUrl}
            imageWidth={uploaded.width}
            imageHeight={uploaded.height}
            onSlice={handleSlice}
          />
          {slicing && (
            <p className="mt-4 text-xs font-mono text-accent-amber animate-pulse">
              Slicing frames...
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
