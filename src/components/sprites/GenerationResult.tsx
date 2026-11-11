'use client';

import { useState, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Scissors, RefreshCw, Archive, Trash2, ArrowRight, Eraser, Pencil, Film, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import BrewingLoader from './BrewingLoader';
import PixelEditor from './PixelEditor';
import SheetLoop from './SheetLoop';
import LoopFrameStrip from './LoopFrameStrip';
import { sheetGeometry } from '@/lib/animationGeometry';
import { createSequence, playback, type LoopSequence } from '@/lib/loopSequence';
import { loadImage, removeBackgroundColor } from '@/lib/spriteUtils';
import { encodeGif, framesFromSheet, GIF_SCALES, GIF_SCALE_DEFAULT, type GifScale } from '@/lib/gifExport';
import { canvasToBlob, downloadFile } from '@/lib/downloadUtils';
import { assemblePlayedSheet, playedIsIdentity } from '@/lib/playedSheet';
import { borderMostlyTransparent } from '@/lib/sheetAlpha';
import {
  loadHistory,
  clearHistory,
  onHistoryChange,
  failedSaveAfter,
  type FailedSave,
  type GenerationHistoryEntry,
} from '@/lib/generationHistory';

const ZOOM_OPTIONS = [1, 2, 4, 8] as const;

/** Target display width in px for the looping preview; the frame is scaled
 *  by the largest whole number that fits, then capped to the box width. */
const LOOP_TARGET_PX = 320;

/** The card's two toggles (Sheet and Playing; Edited and Before edit) are
 *  one kind of control, so they share one look: the track, and a button of
 *  12 px text, 32 px tall, 44 px on touch (DESIGN 2026-11-11-009). From lg
 *  the page has two columns and the card is at its narrowest (about 345 px
 *  inside), so the side padding drops 2 px there and both groups stay on
 *  one row; where they still do not fit (a phone), the second wraps whole. */
const TOGGLE_TRACK = 'flex gap-1 rounded-lg bg-bg-secondary p-1 w-fit';
const TOGGLE_BUTTON =
  'px-3 lg:px-2.5 min-h-8 pointer-coarse:min-h-11 rounded-md text-xs font-mono whitespace-nowrap cursor-pointer transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber';
const TOGGLE_ON = 'bg-accent-amber text-bg-primary';
const TOGGLE_OFF = 'text-text-secondary hover:text-text-primary hover:bg-bg-hover';

/** Fit-to-container default zoom — picks the largest value from ZOOM_OPTIONS
 *  such that naturalWidth × zoom fits within the measured container width.
 *  Display-only; the data URL passed to download/export/handoffs is always
 *  native resolution regardless of the displayed zoom. */
function computeFitZoom(naturalWidth: number, containerWidth: number): number {
  const usable = Math.max(64, containerWidth - 8); // small buffer for border / sub-pixel rounding
  for (const z of [...ZOOM_OPTIONS].reverse()) {
    if (naturalWidth * z <= usable) return z;
  }
  return 1; // even 1x overflows — let it scroll
}

/** Saves a data URL as a file, byte for byte. */
function saveDataUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

interface GenerationResultProps {
  onReset: () => void;
}

export default function GenerationResult({ onReset }: GenerationResultProps) {
  const router = useRouter();
  const { userId } = useAuth();
  const generatedImageDataUrl = useSpriteStore((s) => s.generatedImageDataUrl);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generatingAction = useSpriteStore((s) => s.generatingAction);
  const generationStartedAt = useSpriteStore((s) => s.generationStartedAt);
  const generationStage = useSpriteStore((s) => s.generationStage);
  const generationMode = useSpriteStore((s) => s.generationMode);
  const generationPausedMessage = useSpriteStore((s) => s.generationPausedMessage);
  const originalGeneratedImageDataUrl = useSpriteStore((s) => s.originalGeneratedImageDataUrl);
  const cardVersion = useSpriteStore((s) => s.cardVersion);
  const clearGeneratedImage = useSpriteStore((s) => s.clearGeneratedImage);
  const saveEditedImage = useSpriteStore((s) => s.saveEditedImage);
  const showCardVersion = useSpriteStore((s) => s.showCardVersion);
  const setWorkingImage = useSpriteStore((s) => s.setWorkingImage);
  // The same for every image of one result (the delivered sheet): what the
  // user set on the card for a result (the view, the loop, the zoom) is held
  // with it, so an editor save and a switch between "Edited" and "Before
  // edit" keep it. A new result has a new key.
  const resultKey = originalGeneratedImageDataUrl ?? generatedImageDataUrl;
  const originalCharacterDataUrl = useSpriteStore((s) => s.originalCharacterDataUrl);
  const rescueInfo = useSpriteStore((s) => s.rescueInfo);
  const currentSheetMetadata = useSpriteStore((s) => s.currentSheetMetadata);
  const setPendingAnimatorHandoff = useSpriteStore((s) => s.setPendingAnimatorHandoff);
  const setPendingAnimatorSkipBgRemoval = useSpriteStore((s) => s.setPendingAnimatorSkipBgRemoval);

  const [zoom, setZoom] = useState(4);
  // Natural dimensions of the loaded image. Drives the actual-size CSS width /
  // height in place of transform: scale (which left the layout box unscaled
  // and broke overflow-auto scroll/centering when zoom > 1). Reset to {0,0}
  // on each new generation so a stale dim × current zoom can't briefly render
  // mis-sized before the new onLoad fires.
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Track the result (resultKey) the size-aware default was last computed
  // for. Tracks the result (not displayImageDataUrl) so toggling background
  // removal, an editor save or a version switch, which swap the image for one
  // with the same natural dimensions, don't re-fire the default and clobber a
  // user-picked zoom. Only a genuinely new generation triggers a recompute.
  const lastDefaultZoomSrcRef = useRef<string | null>(null);
  // Ref to the overflow-auto preview container. Read at onLoad time so the
  // fit-zoom calc uses the real available width (adapts to viewport / sidebar)
  // rather than a hardcoded magic number.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<GenerationHistoryEntry[]>([]);
  // Sheet / Playing toggle for animate results. Holds the result (resultKey)
  // the user switched to Sheet for, so a new generation lands Playing again
  // without resetting state in an effect.
  const [sheetViewSrc, setSheetViewSrc] = useState<string | null>(null);
  // The user's edit of the playing loop (order, speed, ping-pong), held with
  // the result (resultKey) and frame count it was made for. A new generation
  // or a new frame count falls back to the default without resetting state in
  // an effect; a background-removal toggle, an editor save and a version
  // switch keep both, so the loop survives them.
  const [loopEdit, setLoopEdit] = useState<{ src: string; frames: number; seq: LoopSequence } | null>(null);
  // Download GIF: output scale, an in-flight flag, and the last encode error
  // held with the source it was for, so a new generation drops it without
  // resetting state in an effect.
  const [gifScale, setGifScale] = useState<GifScale>(GIF_SCALE_DEFAULT);
  const [gifEncoding, setGifEncoding] = useState(false);
  const [gifError, setGifError] = useState<{ src: string; message: string } | null>(null);
  // Download on an Animate result: an in-flight flag, and the sources a sheet
  // failed for and was last saved for, so a new generation drops the note and
  // the status the same way.
  const [sheetPreparing, setSheetPreparing] = useState(false);
  const [sheetFailedSrc, setSheetFailedSrc] = useState<string | null>(null);
  const [sheetReadySrc, setSheetReadySrc] = useState<string | null>(null);
  const sheetStatus = sheetPreparing
    ? 'Preparing the sheet.'
    : sheetReadySrc !== null && sheetReadySrc === generatedImageDataUrl
      ? 'Sheet ready.'
      : '';

  // Whether the sheet's border is already transparent, held with the source
  // it was read for, so a new generation reads as unknown (null) without
  // resetting state in an effect.
  const [sheetAlpha, setSheetAlpha] = useState<{ src: string; transparent: boolean } | null>(null);
  const sheetIsTransparent =
    sheetAlpha && sheetAlpha.src === generatedImageDataUrl ? sheetAlpha.transparent : null;

  // Background removal state. removeBackgroundColor averages the corners' RGB
  // and ignores alpha, so a transparent sheet's corners read as black and only
  // near-black art would go. Active is derived, so a press made before the
  // answer arrived simply stops applying, the same render the answer lands.
  const [bgRemovalWanted, setBgRemovalWanted] = useState(false);
  const bgRemovalActive = bgRemovalWanted && sheetIsTransparent !== true;
  const bgNoteId = useId();
  const bgTitleId = useId();
  const bgToggleId = useId();
  const [bgRemovedDataUrl, setBgRemovedDataUrl] = useState<string | null>(null);
  const [bgTolerance, setBgTolerance] = useState(10);
  const [detectedBgColor, setDetectedBgColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [bgRemovalError, setBgRemovalError] = useState<string | null>(null);

  // Editor modal state. Held as a snapshot of {url, w, h} captured at click
  // time rather than reactive state, because the [generatedImageDataUrl]
  // reset effect at line 85-91 zeros naturalDims whenever the store URL
  // changes — and pre-emptively staging the bg-removed variant in the store
  // would zero our dims mid-modal, crashing the editor into a 0×0 error.
  // Snapshot-on-open is also the right shape for any other event that could
  // change the working image while the editor is open. Null = closed.
  const [editorSnapshot, setEditorSnapshot] = useState<{ url: string; w: number; h: number } | null>(null);
  // Brief "preparing" flag during the click-time decode. Disables the button
  // so a fast double-tap can't fire two decodes/snapshots in flight.
  const [openingEditor, setOpeningEditor] = useState(false);

  // Load history on mount and whenever a new generation arrives or user changes
  useEffect(() => {
    setHistory(loadHistory(userId));
  }, [generatedImageDataUrl, userId]);

  // A new generation's entry is saved after its thumbnail is drawn, after the
  // load above, so Recent reads the history again when the save is done (it
  // used to miss the newest sheet). Every outcome names its user and image;
  // failedSaveAfter keeps the failed save this card notes under the result.
  const [historySaveFailed, setHistorySaveFailed] = useState<FailedSave | null>(null);
  useEffect(() => onHistoryChange((change) => {
    setHistory(loadHistory(userId));
    setHistorySaveFailed((noted) => failedSaveAfter(noted, change, userId));
  }), [userId]);
  const historyNote = historySaveFailed !== null && historySaveFailed.userId === (userId ?? null) && historySaveFailed.image === generatedImageDataUrl;

  // Reset background removal when the card's image changes. For a new
  // generation also reset naturalDims so the new image isn't briefly rendered
  // at the previous generation's dimensions × current zoom: the
  // undefined-width fallback in the <img> style lets the browser layout-size
  // from the source's natural dims for the one frame before onLoad fires the
  // fit-zoom recompute. An editor save and a version switch show another
  // image of the same result, the same size, so the dims stay and the loop,
  // the toggles and the buttons under them do not blink out and back.
  const dimsResultKeyRef = useRef(resultKey);
  useEffect(() => {
    setBgRemovalWanted(false);
    setBgRemovedDataUrl(null);
    setDetectedBgColor(null);
    setBgRemovalError(null);
    if (dimsResultKeyRef.current !== resultKey) setNaturalDims({ w: 0, h: 0 });
    dimsResultKeyRef.current = resultKey;
  }, [generatedImageDataUrl, resultKey]);

  // Read the sheet's border. On any error the answer stays unknown, and the
  // card behaves as it did before this check.
  useEffect(() => {
    if (!generatedImageDataUrl) return;
    const src = generatedImageDataUrl;
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(src);
        if (cancelled) return;
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, W, H).data;
        if (!cancelled) setSheetAlpha({ src, transparent: borderMostlyTransparent(px, W, H) });
      } catch {
        // Unknown: keep today's behaviour.
      }
    })();
    return () => { cancelled = true; };
  }, [generatedImageDataUrl]);

  // Recompute background removal when tolerance changes
  useEffect(() => {
    if (!bgRemovalActive || !generatedImageDataUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(generatedImageDataUrl);
        if (cancelled) return;
        const result = removeBackgroundColor(img, bgTolerance);
        if (!cancelled) {
          setBgRemovedDataUrl(result.dataUrl);
          setDetectedBgColor(result.detectedColor);
          setBgRemovalError(null);
        }
      } catch {
        if (!cancelled) setBgRemovalError('Failed to process image.');
      }
    })();
    return () => { cancelled = true; };
  }, [bgRemovalActive, bgTolerance, generatedImageDataUrl]);

  /** The image currently displayed and used for download / Send to Slicer */
  const displayImageDataUrl =
    bgRemovalActive && bgRemovedDataUrl ? bgRemovedDataUrl : generatedImageDataUrl;

  // Animate results loop in place. Geometry comes from the sheet hints the
  // generation set (frame size and count) and the loaded image's natural
  // size; null (not animate, hints missing, or a size mismatch) shows the
  // sheet only.
  const isAnimateResult =
    generationMode === 'animate' || currentSheetMetadata?.source === 'animate';
  const loopGeometry = useMemo(
    () =>
      isAnimateResult
        ? sheetGeometry({
            imageW: naturalDims.w,
            imageH: naturalDims.h,
            frameSize: currentSheetMetadata?.frameSize,
            frameCount: currentSheetMetadata?.frameCount,
          })
        : null,
    [isAnimateResult, naturalDims.w, naturalDims.h, currentSheetMetadata]
  );
  const showLoop = !!loopGeometry && sheetViewSrc !== resultKey;
  const loopFrames = loopGeometry?.frames ?? 0;
  const loopSeq = useMemo(
    () =>
      loopEdit && loopEdit.src === resultKey && loopEdit.frames === loopFrames
        ? loopEdit.seq
        : createSequence(loopFrames),
    [loopEdit, resultKey, loopFrames]
  );
  const loopPlayback = useMemo(() => playback(loopSeq), [loopSeq]);
  const handleLoopChange = useCallback(
    (seq: LoopSequence) => {
      if (resultKey) setLoopEdit({ src: resultKey, frames: loopFrames, seq });
    },
    [resultKey, loopFrames]
  );

  // An Animate result's Download saves the frames as they play, so the file
  // matches the loop on the card; every other result saves the image as shown.
  const playedSheetReady = !!loopGeometry && loopPlayback.length > 0;

  const handleDownload = useCallback(() => {
    if (!displayImageDataUrl || sheetPreparing) return;
    saveDataUrl(displayImageDataUrl, `spritebrew_generated_${Date.now()}.png`);
  }, [displayImageDataUrl, sheetPreparing]);

  // The loop as it plays (order after Remove and Duplicate, ping-pong
  // expanded) from the displayed image, so background removal applies, in the
  // source sheet's columns. Reads the card and changes none of it.
  const handleDownloadPlayed = useCallback(async () => {
    const src = displayImageDataUrl;
    if (!src || !generatedImageDataUrl || !loopGeometry || sheetPreparing) return;
    setSheetFailedSrc(null);
    setSheetReadySrc(null);
    // An unedited loop is the displayed image, so it saves with no canvas.
    if (playedIsIdentity(loopPlayback, loopFrames)) {
      saveDataUrl(src, `spritebrew_animation_${Date.now()}.png`);
      setSheetReadySrc(generatedImageDataUrl);
      return;
    }
    setSheetPreparing(true);
    try {
      // Cutting is synchronous; yield once so the spinner paints first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const img = await loadImage(src);
      const frames = framesFromSheet(img, loopGeometry, loopPlayback);
      const sheet = assemblePlayedSheet(frames, loopGeometry.frameW, loopGeometry.frameH, loopGeometry.cols, (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      });
      downloadFile(await canvasToBlob(sheet), `spritebrew_animation_${Date.now()}.png`);
      setSheetReadySrc(generatedImageDataUrl);
    } catch {
      setSheetFailedSrc(generatedImageDataUrl);
    } finally {
      setSheetPreparing(false);
    }
  }, [displayImageDataUrl, generatedImageDataUrl, loopGeometry, loopFrames, loopPlayback, sheetPreparing]);

  // The sheet as delivered, with no canvas in the way, so this one always
  // works. After an editor save the card's image is the edit or the sheet
  // from before it, and the store keeps the delivered sheet beside them.
  const handleDownloadOriginal = useCallback(() => {
    const delivered = originalGeneratedImageDataUrl ?? generatedImageDataUrl;
    if (!delivered) return;
    saveDataUrl(delivered, `spritebrew_animation_${Date.now()}_original.png`);
  }, [originalGeneratedImageDataUrl, generatedImageDataUrl]);

  // Encodes the loop as it plays (A1's order, ping-pong and speed) from the
  // displayed image, so background removal applies. Errors show inline.
  const handleDownloadGif = useCallback(async () => {
    const src = displayImageDataUrl;
    if (!src || !generatedImageDataUrl || !loopGeometry || gifEncoding) return;
    setGifEncoding(true);
    setGifError(null);
    try {
      // Encoding is synchronous; yield once so the spinner paints first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const img = await loadImage(src);
      const frames = framesFromSheet(img, loopGeometry, loopPlayback);
      const blob = encodeGif(frames, { scale: gifScale, fps: loopSeq.fps });
      downloadFile(blob, `spritebrew_animation_${Date.now()}.gif`);
    } catch {
      setGifError({ src: generatedImageDataUrl, message: 'Could not make the GIF. Try a smaller scale.' });
    } finally {
      setGifEncoding(false);
    }
  }, [displayImageDataUrl, generatedImageDataUrl, loopGeometry, loopPlayback, loopSeq.fps, gifScale, gifEncoding]);

  const handleSendToSlicer = useCallback(() => {
    // If background removal is active, push the transparent version into the
    // store so the slicer receives the transparent sprite.
    if (bgRemovalActive && bgRemovedDataUrl) {
      setWorkingImage(bgRemovedDataUrl);
    }
    router.push('/upload');
  }, [router, bgRemovalActive, bgRemovedDataUrl, setWorkingImage]);

  const handleSendToEditor = useCallback(async () => {
    // Snapshot bytes + dims at click time. We deliberately do NOT pre-stage
    // the bg-removed variant in the store: a new store image used to zero
    // naturalDims in the [generatedImageDataUrl] reset effect and crash the
    // modal mid-mount with a 0×0 error. The snapshot is what
    // the editor reads from now, so the store can wait until Save commits
    // the EDITED bytes (which is what we actually want downstream anyway).
    //
    // Mobile-race fix: naturalDims is repopulated asynchronously by the
    // visible result <img>'s onLoad. It's also reset to {0,0} on every new
    // generatedImageDataUrl (incl. our own handleEditorSave round-trip).
    // On mobile the decode window between "new src committed" and "onLoad
    // fired" is wide enough that a tap can land while dims are still zero.
    // Decode on demand here so the click is never blocked by the async
    // population path. Fast path: if dims are already populated, no decode.
    const url = displayImageDataUrl;
    if (!url) return;
    setOpeningEditor(true);
    try {
      let { w, h } = naturalDims;
      if (!w || !h) {
        const img = new Image();
        img.src = url;
        try { await img.decode(); } catch { return; }
        w = img.naturalWidth;
        h = img.naturalHeight;
        if (!w || !h) return;
      }
      setEditorSnapshot({ url, w, h });
    } finally {
      setOpeningEditor(false);
    }
  }, [naturalDims, displayImageDataUrl]);

  // Editor Save: the edit becomes the card's image, and every downstream
  // action (Animate, Send to Slicer, Download PNG, Download GIF) uses it. The
  // store keeps the sheet from before the edit and the delivered sheet, so
  // the card's "Before edit" and "Download original" still give them
  // (src/lib/cardImage.ts). The save is announced once, for the edit it made.
  const [announcedEdit, setAnnouncedEdit] = useState<string | null>(null);
  const handleEditorSave = useCallback((editedDataUrl: string) => {
    saveEditedImage(editedDataUrl);
    setAnnouncedEdit(editedDataUrl);
    setEditorSnapshot(null);
  }, [saveEditedImage]);
  const editNote =
    cardVersion === 'edited' && announcedEdit !== null && announcedEdit === generatedImageDataUrl
      ? 'Your edit is on the card. Before edit is one tap away.'
      : '';

  const handleSendToAnimator = useCallback(() => {
    // Honor bg-removal toggle the same way Send to Editor / Send to Slicer do.
    // Same route as the user's already on (/generate) — receiving effects must
    // be reactive subscriptions, not mount-only. Two-stage state machine:
    // GeneratePage flips the tab; AnimateForm consumes the flag on mount.
    if (bgRemovalActive && bgRemovedDataUrl) {
      setWorkingImage(bgRemovedDataUrl);
    }
    // Communicate the user's bg-removal CHOICE to AutoPrep. If the result-side
    // toggle was OFF, the user wants to keep the bg — tell AutoPrep to skip
    // removal too. (When toggle is ON, the transparent variant lands in the
    // store via setWorkingImage above and AutoPrep auto-detects alpha and
    // skips removal regardless — so the skip flag is essentially a no-op on
    // that branch, but setting it consistently keeps the intent explicit.)
    setPendingAnimatorSkipBgRemoval(!bgRemovalActive);
    setPendingAnimatorHandoff(true);
    router.push('/generate');
  }, [router, bgRemovalActive, bgRemovedDataUrl, setWorkingImage, setPendingAnimatorHandoff, setPendingAnimatorSkipBgRemoval]);

  const handleToggleBgRemoval = useCallback(() => {
    if (sheetIsTransparent === true) return;
    setBgRemovalWanted((v) => !v);
  }, [sheetIsTransparent]);

  const handleGenerateAnother = useCallback(() => {
    clearGeneratedImage();
    onReset();
  }, [clearGeneratedImage, onReset]);

  const handleClearHistory = useCallback(() => {
    clearHistory(userId);
    setHistory([]);
  }, [userId]);

  // Loading overlay — shown over a previous result (dimmed) or standalone
  const loadingIndicator = isGenerating ? (
    <BrewingLoader
      action={generatingAction}
      startedAt={generationStartedAt}
      serverStatus={generationStage}
      mode={generationMode}
      pausedMessage={generationPausedMessage}
    />
  ) : null;

  // If generating AND there's a previous result, show it dimmed with the
  // loading overlay on top instead of fully replacing it
  if (isGenerating && generatedImageDataUrl) {
    return (
      <div className="relative space-y-4">
        {/* Dimmed previous result */}
        <div className="opacity-20 pointer-events-none">
          <div className="rounded-lg border border-border-default bg-bg-elevated p-4 overflow-auto">
            <div className="inline-block mx-auto">
              <img
                src={displayImageDataUrl ?? generatedImageDataUrl}
                alt="Previous result"
                style={{ imageRendering: 'pixelated' }}
                className="block max-h-48 pixel-art-render"
              />
            </div>
          </div>
        </div>
        {/* Overlay loading indicator */}
        <div className="absolute inset-0 flex items-center justify-center">
          {loadingIndicator}
        </div>
      </div>
    );
  }

  // Generating with no previous result — show standalone loading
  if (isGenerating) {
    return <>{loadingIndicator}</>;
  }

  if (!generatedImageDataUrl) {
    // Tips / empty state
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-dashed border-border-default bg-bg-surface p-8 text-center">
          <p className="text-sm font-mono text-text-muted mb-4">
            Your generated sprites will appear here
          </p>
          <div className="text-left max-w-xs mx-auto space-y-2">
            <p className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2">
              Tips for good prompts
            </p>
            {[
              'Be specific about colors and style',
              'Mention the action: walking, running, attacking',
              'Include equipment and accessories',
              'Specify the art style: 16-bit, 8-bit, etc.',
            ].map((tip) => (
              <div key={tip} className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-accent-amber/40 mt-1.5 flex-shrink-0" />
                <p className="text-[10px] font-mono text-text-secondary">{tip}</p>
              </div>
            ))}
          </div>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Link
                href="/gallery"
                className="group flex items-center gap-1.5 text-[10px] font-mono text-text-muted
                  hover:text-accent-amber uppercase tracking-wider cursor-pointer transition-colors"
              >
                Recent Generations
                <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <div className="flex items-center gap-2">
                <Link
                  href="/gallery"
                  className="text-[10px] font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer"
                >
                  View all &rarr;
                </Link>
                <button
                  onClick={handleClearHistory}
                  className="text-[10px] font-mono text-text-muted hover:text-text-secondary cursor-pointer"
                >
                  <Trash2 size={10} className="inline mr-1" />
                  Clear
                </button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {history.slice(0, 5).map((entry) => (
                <Link
                  key={entry.id}
                  href="/gallery"
                  className="flex-shrink-0 rounded border border-border-subtle bg-bg-surface p-2 w-28
                    hover:border-accent-amber/40 transition-colors"
                >
                  <div
                    className="w-full aspect-square rounded overflow-hidden mb-1.5"
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                      backgroundSize: '6px 6px',
                      backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
                    }}
                  >
                    <img
                      src={entry.thumbnailDataUrl}
                      alt={entry.prompt}
                      className="w-full h-full object-contain pixel-art-render"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </div>
                  <p className="text-[9px] font-mono text-text-muted truncate" title={entry.prompt}>
                    {entry.prompt}
                  </p>
                  <p className="text-[8px] font-mono text-text-muted/60">
                    {entry.style}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Original → Animated comparison */}
      {originalCharacterDataUrl && (
        <div className="flex items-center gap-3 justify-center">
          <div className="text-center">
            <p className="text-[9px] font-mono text-text-muted mb-1">Original</p>
            <div
              className="inline-block rounded border border-border-subtle overflow-hidden"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
              }}
            >
              <img
                src={originalCharacterDataUrl}
                alt="Original character"
                className="block w-16 h-16 object-contain pixel-art-render"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          </div>
          <span className="text-text-muted text-xs font-mono">&rarr;</span>
          <div className="text-center">
            <p className="text-[9px] font-mono text-accent-amber mb-1">Animated</p>
          </div>
        </div>
      )}

      {/* Rescue notice — surfaces the consumer's fallback delivery so
          users know their requested-size animation timed out and we
          auto-downgraded to a 64px version at no extra cost. Template
          builds only from fields that are actually present (spec: "never
          render undefined"): the requested-size clause drops when
          requestedWidth is absent, and the frame-count clause drops when
          deliveredFrames is absent (unreadable IHDR + client-derivation
          also failed). */}
      {rescueInfo && (
        <div className="rounded-lg border border-accent-amber/40 bg-accent-amber/5 px-4 py-3 text-xs font-mono text-text-secondary leading-relaxed">
          This one came from our backup process.
          {' '}
          {typeof rescueInfo.requestedWidth === 'number'
            ? `Your ${rescueInfo.requestedWidth}px animation failed on the provider's side, so we made a `
            : `Your animation failed on the provider's side, so we made a `}
          {typeof rescueInfo.deliveredCellSize === 'number'
            ? `${rescueInfo.deliveredCellSize}px`
            : 'smaller'}
          {typeof rescueInfo.deliveredFrames === 'number'
            ? `, ${rescueInfo.deliveredFrames}-frame`
            : ''}
          {' '}version instead. No extra tokens were used.
        </div>
      )}

      {/* Result image. Outer container is overflow-auto + scrollable. The
          inline-block mx-auto inner wrapper centers small images and
          left-aligns + scrolls large ones (margin: auto resolves to 0 when
          content > container). Image uses explicit width/height (not
          transform: scale) so the layout box matches the visual size — that's
          what makes overflow-auto compute scroll correctly. */}
      {(loopGeometry || cardVersion) && (
        <div className="flex flex-wrap items-center gap-2">
          {loopGeometry && (
            <div className={TOGGLE_TRACK} role="group" aria-label="Result view">
              {([['sheet', 'Sheet'], ['loop', 'Playing']] as const).map(([view, label]) => {
                const selected = view === 'loop' ? showLoop : !showLoop;
                return (
                  <button
                    key={view}
                    type="button"
                    onClick={() => setSheetViewSrc(view === 'sheet' ? resultKey : null)}
                    aria-pressed={selected}
                    className={`${TOGGLE_BUTTON} ${selected ? TOGGLE_ON : TOGGLE_OFF}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {/* After an editor save: the edit, or the card's sheet from before
              it. Both are kept until a new result, so there is nothing to
              undo; every button below acts on the version shown. The group
              never splits across rows (it wraps whole). */}
          {cardVersion && (
            <div className={TOGGLE_TRACK} role="group" aria-label="Version">
              {([['edited', 'Edited'], ['before', 'Before edit']] as const).map(([version, label]) => {
                const selected = cardVersion === version;
                return (
                  <button
                    key={version}
                    type="button"
                    onClick={() => showCardVersion(version)}
                    aria-pressed={selected}
                    className={`${TOGGLE_BUTTON} ${selected ? TOGGLE_ON : TOGGLE_OFF}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="rounded-lg border border-border-default bg-bg-elevated p-4 overflow-auto"
      >
        {showLoop && loopGeometry && (
          <div
            className="mx-auto"
            style={{
              width: `min(100%, ${Math.max(1, Math.floor(LOOP_TARGET_PX / loopGeometry.frameW)) * loopGeometry.frameW}px)`,
              aspectRatio: `${loopGeometry.frameW} / ${loopGeometry.frameH}`,
              backgroundImage:
                'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
            }}
          >
            <SheetLoop
              src={displayImageDataUrl ?? generatedImageDataUrl}
              geometry={loopGeometry}
              sequence={loopPlayback}
              fps={loopSeq.fps}
              className="w-full h-full"
            />
          </div>
        )}
        {/* The sheet image stays mounted while the loop shows (hidden) so
            its onLoad keeps feeding naturalDims and the fit zoom. */}
        <div
          className={showLoop ? 'hidden' : 'inline-block mx-auto'}
          style={{
            backgroundImage:
              'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
          }}
        >
          <img
            src={displayImageDataUrl ?? generatedImageDataUrl}
            alt="Generated sprite sheet"
            className="pixel-art-render block max-w-none"
            style={{
              imageRendering: 'pixelated',
              width: naturalDims.w ? naturalDims.w * zoom : undefined,
              height: naturalDims.h ? naturalDims.h * zoom : undefined,
            }}
            onLoad={(e) => {
              // Always record natural dims (used by the explicit width/height
              // style on every render, including bg-removal toggle loads).
              const nw = e.currentTarget.naturalWidth;
              const nh = e.currentTarget.naturalHeight;
              setNaturalDims({ w: nw, h: nh });

              // Fit-to-container default zoom — fires once per new generation.
              // Skip if this load is just a bg-removal toggle, an editor save
              // or a version switch on the same result (ref still matches).
              // Once a user manually picks a zoom, no further loads happen
              // until a genuinely new source URL arrives — so manual zoom
              // sticks.
              if (lastDefaultZoomSrcRef.current === resultKey) return;
              lastDefaultZoomSrcRef.current = resultKey;

              // clientWidth includes the container's p-4 padding (16px each
              // side = 32px total). Subtract it to get usable content width.
              // Fallback to 480 if the ref isn't ready (defensive — onLoad
              // runs after the first commit so the ref is normally populated).
              const el = containerRef.current;
              const containerWidth = el ? Math.max(64, el.clientWidth - 32) : 480;
              setZoom(computeFitZoom(nw, containerWidth));
            }}
          />
        </div>
      </div>

      {showLoop && loopGeometry && (
        <LoopFrameStrip
          src={displayImageDataUrl ?? generatedImageDataUrl}
          geometry={loopGeometry}
          sequence={loopSeq}
          onChange={handleLoopChange}
        />
      )}

      {/* Zoom controls */}
      <div className="flex items-center gap-2" role="group" aria-label="Zoom">
        <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
          Zoom
        </span>
        {ZOOM_OPTIONS.map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => setZoom(z)}
            aria-pressed={zoom === z}
            className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
              ${zoom === z
                ? 'bg-accent-amber text-bg-primary'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
              }`}
          >
            {z}x
          </button>
        ))}
      </div>

      {/* Background removal */}
      <div className="rounded border border-border-default bg-bg-elevated/50 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eraser size={12} className="text-text-muted" />
            <span id={bgTitleId} className="text-[11px] font-mono text-text-primary">
              Remove background
            </span>
            {bgRemovalActive && detectedBgColor && (
              <span className="flex items-center gap-1.5 text-[9px] font-mono text-text-muted">
                <span
                  className="w-3 h-3 rounded border border-border-default"
                  style={{
                    backgroundColor: `rgb(${detectedBgColor.r}, ${detectedBgColor.g}, ${detectedBgColor.b})`,
                  }}
                />
                rgb({detectedBgColor.r}, {detectedBgColor.g}, {detectedBgColor.b})
              </span>
            )}
          </div>
          {/* aria-disabled, not the disabled attribute: a disabled button
              takes no focus, so Tab would skip it and neither its focus style
              nor its reason would ever reach a keyboard or screen reader. The
              handler ignores the press. */}
          <button
            type="button"
            id={bgToggleId}
            onClick={handleToggleBgRemoval}
            aria-labelledby={`${bgTitleId} ${bgToggleId}`}
            aria-disabled={sheetIsTransparent === true || undefined}
            aria-describedby={sheetIsTransparent === true ? bgNoteId : undefined}
            className={`px-2.5 py-1 rounded text-[10px] font-mono transition-colors
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber
              ${sheetIsTransparent === true
                ? 'bg-bg-elevated text-text-muted border border-border-subtle cursor-not-allowed'
                : bgRemovalActive
                  ? 'bg-accent-amber text-bg-primary cursor-pointer'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle cursor-pointer'
              }`}
          >
            {bgRemovalActive ? 'Active' : 'Off'}
          </button>
        </div>
        {sheetIsTransparent === true && (
          <p id={bgNoteId} className="text-[9px] font-mono text-text-muted">
            Background already removed.
          </p>
        )}
        {bgRemovalActive && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-[9px] font-mono text-text-muted w-16">
                Tolerance
              </label>
              <input
                type="range"
                min={0}
                max={60}
                value={bgTolerance}
                onChange={(e) => setBgTolerance(Number(e.target.value))}
                className="flex-1 accent-[var(--accent-amber)]"
              />
              <span className="text-[10px] font-mono text-text-primary w-6 text-right">
                {bgTolerance}
              </span>
            </div>
            <p className="text-[9px] font-mono text-text-muted">
              Samples the corners for the dominant color. Increase tolerance if
              the background isn&apos;t fully removed.
            </p>
            {bgRemovalError && (
              <p className="text-[9px] font-mono text-red-400">{bgRemovalError}</p>
            )}
          </>
        )}
      </div>

      {/* GIF scale, for Download GIF */}
      {playedSheetReady && (
        <div className="flex items-center gap-2" role="group" aria-label="GIF scale">
          <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
            GIF scale
          </span>
          {GIF_SCALES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setGifScale(s)}
              aria-pressed={gifScale === s}
              className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors
                ${gifScale === s
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {s}x
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" size="md" onClick={handleSendToSlicer}>
          <Scissors size={14} />
          Send to Slicer
        </Button>
        <Button variant="secondary" size="md" onClick={handleSendToEditor} disabled={openingEditor}>
          <Pencil size={14} />
          Send to Editor
        </Button>
        {!originalCharacterDataUrl && (
          <Button variant="secondary" size="md" onClick={handleSendToAnimator}>
            <Film size={14} />
            Send to Animator
          </Button>
        )}
        {/* aria-disabled, as on the toggle above: the disabled attribute would
            drop keyboard focus while the sheet is made. The handlers ignore a
            press while busy. */}
        <Button
          variant="secondary"
          size="md"
          className="aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
          onClick={playedSheetReady ? handleDownloadPlayed : handleDownload}
          aria-disabled={sheetPreparing || undefined}
          aria-busy={sheetPreparing || undefined}
        >
          {sheetPreparing ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <Download size={14} />}
          {sheetPreparing ? 'Preparing...' : 'Download PNG'}
        </Button>
        {playedSheetReady && (
          <Button variant="secondary" size="md" onClick={handleDownloadGif} disabled={gifEncoding}>
            {gifEncoding ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download GIF
          </Button>
        )}
        <Button variant="ghost" size="md" onClick={handleGenerateAnother}>
          <RefreshCw size={14} />
          Generate Another
        </Button>
        <Link href="/gallery" className="contents">
          <Button variant="ghost" size="md">
            <Archive size={14} />
            View Gallery
          </Button>
        </Link>
      </div>
      {playedSheetReady && (
        <div className="flex">
          <Button variant="ghost" size="sm" onClick={handleDownloadOriginal}>
            <Download size={12} />
            Download original
          </Button>
        </div>
      )}
      {gifError && gifError.src === generatedImageDataUrl && (
        <p className="text-[10px] font-mono text-red-400" role="alert">{gifError.message}</p>
      )}
      {sheetFailedSrc !== null && sheetFailedSrc === generatedImageDataUrl && (
        <p className="text-[10px] font-mono text-red-400" role="alert">Could not make the sheet. Try Download original.</p>
      )}
      {/* Always rendered, so a screen reader announces each change. */}
      <p className="sr-only" role="status">{sheetStatus}</p>
      <p className="sr-only" role="status">{editNote}</p>

      {/* A Recent entry that could not be saved (localStorage full); the
          Gallery has the sheet either way, since the server writes it.
          Always rendered, so a screen reader announces the note when its
          text arrives. */}
      <p className={historyNote ? 'text-[10px] font-mono text-text-muted' : 'sr-only'} role="status">
        {historyNote ? "Couldn't add this to Recent on this browser. It's saved in your Gallery." : null}
      </p>

      {/* History */}
      {history.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/gallery"
              className="text-[10px] font-mono text-text-muted hover:text-accent-amber uppercase tracking-wider cursor-pointer"
            >
              Recent &rarr;
            </Link>
            <button
              onClick={handleClearHistory}
              className="text-[10px] font-mono text-text-muted hover:text-text-secondary cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2">
            {history.slice(0, 5).map((entry) => (
              <Link
                key={entry.id}
                href="/gallery"
                className="flex-shrink-0 w-12 h-12 rounded border border-border-subtle overflow-hidden hover:border-accent-amber/40"
                title={entry.prompt}
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                  backgroundSize: '4px 4px',
                  backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0',
                }}
              >
                <img
                  src={entry.thumbnailDataUrl}
                  alt={entry.prompt}
                  className="w-full h-full object-contain pixel-art-render"
                  style={{ imageRendering: 'pixelated' }}
                />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Pixel Editor modal — opens in-place over the result card. Reads
          from editorSnapshot (a click-time capture of {url, w, h}) rather
          than reactive state, so the [generatedImageDataUrl] reset effect
          can't zero the dims mid-mount and crash the editor into a 0×0
          error. Save writes the cleaned image back to generatedImageDataUrl
          via handleEditorSave, so every downstream action (Animate, Slicer,
          Download) picks it up automatically. */}
      {editorSnapshot && (
        <PixelEditor
          frameDataUrl={editorSnapshot.url}
          frameWidth={editorSnapshot.w}
          frameHeight={editorSnapshot.h}
          onSave={handleEditorSave}
          onClose={() => setEditorSnapshot(null)}
          source={{ kind: 'generation' }}
        />
      )}
    </div>
  );
}

