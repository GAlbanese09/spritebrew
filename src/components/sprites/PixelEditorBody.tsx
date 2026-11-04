'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Eraser, Pipette, Undo2, Redo2, FlipHorizontal, History, Save, X, ArrowLeft, Film, AlertCircle, Download, ScanEye, Sparkles, Layers, Minus, Plus, ChevronDown, Check } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import Button from '@/components/ui/Button';
import {
  useEditorStore,
  selectCanUndo,
  selectCanRedo,
  selectIsDirty,
  VALID_BRUSH_SIZES,
  dimsWithinEditorLimits,
  editorDimsRejectionMessage,
  type Tool,
  type DirtyRect,
} from './editorStore';
import type { SpriteProjectSource, SpriteProjectV1 } from '@/lib/spriteProject';
import { scanResidue, residueOverlay } from '@/lib/residueCleanup';
import {
  fitZoom,
  fitPanY,
  minZoomFor,
  openingZoom,
  formatZoomPercent,
  nextZoomStep,
  zoomShortcut,
  isBareKey,
  zoomAllowed,
  zoomMenuMaxHeight,
  ZOOM_MENU_LEVELS,
} from '@/lib/editorZoom';
import { loadImage } from '@/lib/spriteUtils';
import {
  ONION_MAX,
  ONION_DEFAULT_BACK,
  ONION_DEFAULT_AHEAD,
  ONION_DEFAULT_OPACITY,
  onionLayer,
  type OnionFrame,
  type OnionNeighbours,
  decodeOnionSources,
} from '@/lib/onionSkin';

/** How long after the last stroke change "Show residue" scans again. A
 *  scan at the editor's 1024 x 1024 cap takes about 5 to 25 ms (up to about
 *  110 ms on synthetic worst cases), so it never runs per stroke event, only
 *  once the edits pause. A wholesale change (flip, undo, redo, revert, clean,
 *  a new image) rescans at once, so old marks never sit on moved pixels. */
const RESIDUE_RESCAN_MS = 150;

/** Onion skin sources: data URLs of the frames before and after the edited
 *  one, nearest first; null where a frame has no image (W2). */
export type OnionSources = OnionNeighbours<string | null>;

/** The transparency checkerboard behind the image (Wave 1c): a fixed 16px
 *  screen tile. With onion skin on it moves to the onion layer, which sits
 *  under the image, so the checkerboard stays at the bottom. */
const CHECKERBOARD_STYLE = {
  backgroundColor: '#1e1b18',
  backgroundImage:
    'linear-gradient(45deg, #2a2725 25%, transparent 25%, transparent 75%, #2a2725 75%, #2a2725), ' +
    'linear-gradient(45deg, #2a2725 25%, transparent 25%, transparent 75%, #2a2725 75%, #2a2725)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
} as const;

/** Scope key for editor hotkeys — keeps brush-size / undo / redo bindings
 *  isolated to the editor subtree so they don't fire when a text input
 *  outside the editor is focused (or when a future input INSIDE the editor
 *  is focused — react-hotkeys-hook's default `enableOnFormTags: false`
 *  also handles that, but scoping is the cleaner contract). The matching
 *  <HotkeysProvider initiallyActiveScopes={['editor']}> lives in
 *  PixelEditor.tsx (modal) and app/editor/page.tsx (page route). */
const EDITOR_HOTKEY_SCOPE = 'editor';

// Wave 2a continuous-zoom range. Buttons remain as preset shortcuts inside
// [4, 16], but pinch/wheel can land anywhere from the smallest zoom to
// MAX_ZOOM, including non-integer values. The smallest zoom is 1x, or the
// fitted zoom when the image is too big for 1x (editorZoom.minZoomFor, kept
// in minZoomRef), so zooming out stops with the whole image in view.
const MAX_ZOOM = 32;

/** The zoom control animates only a stack at most this wide or tall, in CSS
 *  px, before and after (see the zoom animation effect). */
const ZOOM_ANIM_MAX_PX = 4096;

/** The browser's decode for onion skin frames: a data URL to RGBA bytes. */
async function decodeImageToFrame(url: string): Promise<OnionFrame> {
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  return { pixels: data.data, width: c.width, height: c.height };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
import { useSpriteStore } from '@/stores/spriteStore';
import { extractPaletteFromImageData } from '@/lib/imagePalette';
import { useEditorRecovery, closeEditorDraft } from './useEditorRecovery';
import { useEditorHistoryGuard } from './useEditorHistoryGuard';
import { useLeaveByBack } from './useLeaveByBack';
import EditorLeaveDialog from './EditorLeaveDialog';
import { isDevHost } from '@/lib/isDevHost';
import { devRecoverySelfTest } from '@/lib/editorRecovery';
import { pixelsToPngDataUrl } from '@/lib/editorImage';

/** Module-scope so the dev self-test runs at most once per page load, even
 *  if the editor body remounts (e.g. Strict Mode double-invoke in dev). */
let recoverySelfTestRan = false;

/**
 * Chrome-free Pixel Editor body. Hosts all the Wave 1 logic (store wiring,
 * hotkeys, canvas rendering, beforeunload guard, palette extraction) plus
 * the v2 Phase 1 structural CSS Grid layout that fixes the swatch clip
 * by construction.
 *
 * Two modes:
 *   - layout="modal" — mounted inside <PixelEditor>'s Dialog. Header shows
 *     title + X; footer shows Cancel + Save (existing UX preserved). Save
 *     calls onSave(dataUrl) then onDismiss(); dismiss routes through the
 *     wrapper's confirm-discard logic.
 *   - layout="page" — mounted directly by /editor. Header shows title +
 *     "← Back" link + "Save (download PNG)". No footer. Save triggers a
 *     PNG download via <a download>; the editor stays open. Dismiss is the
 *     parent's responsibility (clears store + landing).
 */

interface PixelEditorBodyProps {
  frameDataUrl: string;
  frameWidth: number;
  frameHeight: number;
  onSave: (newDataUrl: string) => void;
  onDismiss: () => void;
  layout: 'modal' | 'page';
  /**
   * Origin lineage for the loaded image (Wave 1b). Threaded into the
   * SpriteProjectV1 document via loadFrame so the editor's document model
   * carries provenance. Optional — when omitted, the project's source is
   * left undefined.
   */
  source?: SpriteProjectSource;
  /**
   * Stage 3 crash-recovery restore. When present, the mount-load effect
   * materializes this recovered draft via loadProject (preserving the full
   * envelope: name, source, frameId, palette) instead of decoding frameDataUrl.
   * Page mode only, mount-stable (the body remounts for a restore, so this is
   * read once on mount). Omitted on the normal image-load path.
   */
  restore?: { envelope: SpriteProjectV1; bytes: Uint8ClampedArray };
  /**
   * Stage 3 escape hatch for the corrupt-restore loop: when loadProject
   * fails on a recovered envelope, the only natural action (Go back) would
   * land back on the banner offering the same broken draft. Wiring this in
   * surfaces a second "Discard draft" button in the loadError UI so the user
   * isn't stuck looping. Only meaningful when `restore` is set.
   */
  onDiscardDraft?: () => void;
  /**
   * Direct close path used ONLY by the explicit modal Save button. The
   * normal onDismiss routes through the wrapper's attemptDismiss which
   * re-checks isDirty and (correctly) re-pops the confirm dialog — but
   * after an explicit Save, the user just expressed intent to keep their
   * work, so re-prompting them with "Unsaved changes?" reads as a bug.
   * Wrapper supplies this as onClose (bypasses confirm). doSaveAndDismiss
   * prefers it; falls back to onDismiss when omitted (page mode, etc).
   */
  onSaveClose?: () => void;
  /**
   * This editor session's draft key (newDraftKey), or a restored draft's key.
   * The session's work is saved under it as the user edits, on both layouts
   * (useEditorRecovery; BUILD 2026-10-29).
   */
  draftKey: string;
  /**
   * Onion skin (W2, HQ 2026-11-03-021): the neighbouring frames' images,
   * nearest first. Given only where the caller knows the animation
   * (FrameGrid on /upload); omitted, the editor shows no onion controls.
   */
  onion?: OnionSources;
}

export default function PixelEditorBody({
  frameDataUrl,
  frameWidth,
  frameHeight,
  onSave,
  onDismiss,
  layout,
  source,
  restore,
  onDiscardDraft,
  onSaveClose,
  draftKey,
  onion,
}: PixelEditorBodyProps) {
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  // Grid overlay: a div whose CSS background draws the grid, sized to the
  // zoomed image. It used to be a canvas at device resolution times the zoom,
  // which on a phone asked for 144 MB for a 512 px sheet at 4x, 655 MB at
  // 8.5x and 1.3 GB at 12x, reallocated after every pinch: the likely reason
  // iOS killed and reloaded the tab mid-session (BUILD 2026-10-29). The
  // browser paints a background at device resolution itself, so it stays
  // crisp and its memory does not grow with the zoom. Sits between the image
  // canvas and the cursor footprint div in the DOM (paint-order stacking).
  const overlayRef = useRef<HTMLDivElement>(null);
  // Tracks the last pointer cell of the active stroke so handleMouseMove can
  // interpolate via Bresenham (paintLine) instead of just stamping discrete
  // points (which left gaps at high pointer speeds).
  const prevCellRef = useRef<{ x: number; y: number } | null>(null);

  // Non-pixel store subscriptions (re-render on change).
  const tool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setActiveTool);
  const color = useEditorStore((s) => s.foregroundColor);
  const setColor = useEditorStore((s) => s.setForegroundColor);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const isDirty = useEditorStore((s) => s.historyIndex > 0);
  // Broader dirty signal (historyIndex > 0 || hasAttemptedEdit) — used ONLY
  // by the beforeunload guard so an iOS-cancelled-stroke session still
  // prompts on reload/close. Revert button keeps the narrower isDirty above
  // since reverting a non-committed state would push a no-op history entry.
  const isDirtyForGuard = useEditorStore(selectIsDirty);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);

  // Send-to-Animator handoff (v0.5.9): the editor → animator round-trip.
  // Selectors are pulled imperatively from spriteStore so they don't trigger
  // unrelated re-renders of the editor body. router is from next/navigation.
  const router = useRouter();
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setOriginalCharacter = useSpriteStore((s) => s.setOriginalCharacter);
  const setCurrentSheetMetadata = useSpriteStore((s) => s.setCurrentSheetMetadata);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setPendingAnimatorHandoff = useSpriteStore((s) => s.setPendingAnimatorHandoff);
  const setPendingAnimatorSkipBgRemoval = useSpriteStore((s) => s.setPendingAnimatorSkipBgRemoval);

  const loadFrame = useEditorStore((s) => s.loadFrame);
  const loadProject = useEditorStore((s) => s.loadProject);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const endStroke = useEditorStore((s) => s.endStroke);
  const cancelStroke = useEditorStore((s) => s.cancelStroke);
  const paintPixel = useEditorStore((s) => s.paintPixel);
  const erasePixel = useEditorStore((s) => s.erasePixel);
  const paintLine = useEditorStore((s) => s.paintLine);
  const eraseLine = useEditorStore((s) => s.eraseLine);
  const eyedrop = useEditorStore((s) => s.eyedrop);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const flipHorizontal = useEditorStore((s) => s.flipHorizontal);
  const cleanResidue = useEditorStore((s) => s.cleanResidue);
  const hasPixels = useEditorStore((s) => s.pixels != null);
  const revertToOriginal = useEditorStore((s) => s.revertToOriginal);
  const reset = useEditorStore((s) => s.reset);

  // Wave 2a refs for pointer-events arbitration + transform-based pan/zoom.
  // containerRef hosts the pointer/wheel handlers (so a finger landing on
  // padding still counts toward the gesture). stackRef is the canvas-stack
  // wrapper that carries the transform during a pinch and the committed pan.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    startDist: number;
    startMid: { x: number; y: number };
    startPan: { x: number; y: number };
    startZoom: number;
    localCss: { x: number; y: number };
    lastScale: number;
    /** The two pointerIds that initiated this gesture (insertion order on
     *  pointerdown→size===2). Identified explicitly so that a 3rd-finger
     *  arrival followed by one of the originals lifting commits cleanly
     *  rather than continuing with mismatched (B, C) geometry against an
     *  (A, B) baseline. */
    pointerIds: [number, number];
  } | null>(null);
  // True from the moment 2 pointers land until ALL pointers lift. Blocks the
  // leftover finger from accidentally drawing after the user lifts one finger
  // post-pinch (spec arbitration rule 4).
  const gestureSessionRef = useRef<boolean>(false);
  // Set by a committer (gesture-end or wheel) to the post-commit transform
  // string. The useLayoutEffect keyed on [zoom] writes it AFTER React has
  // applied the new canvas CSS size but BEFORE paint — same frame, no flicker.
  const pendingTransformRef = useRef<string | null>(null);

  // Dimension-guardrail error path (Fix #5). If the loaded image exceeds
  // EDITOR_MAX_DIMENSION / EDITOR_MAX_PIXELS, the load effect bails out before
  // touching the store and sets this — the canvas area renders a friendly
  // refusal instead of an empty canvas, and the editor stays in a valid state.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [zoom, setZoom] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);

  // Crash-recovery capture, on both layouts: the modal used to save nothing,
  // and an iPhone reload in the middle of a modal session lost all of it
  // (BUILD 2026-10-29). Reads the live palette at save time via the closure
  // so the saved envelope includes it (toProject emits an empty palette).
  useEditorRecovery({ enabled: true, getPalette: () => palette, projectKey: draftKey, surface: layout });

  // Mobile-only Colors sheet (Wave 2b-2). Hosts the color picker + palette
  // on phones; never opens at md+ (the close-on-md effect dismisses if the
  // viewport reaches desktop width via rotation).
  const [sheetOpen, setSheetOpen] = useState(false);

  // Transient toast for keyboard-driven brush-size changes.
  const [brushToast, setBrushToast] = useState<string | null>(null);
  const brushToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Show residue" (George, Oct 31; HQ 2026-11-03-007): a layer above the
  // image that marks what "Clean residue" would change. The ref mirrors the
  // state for the pixel subscription, which lives outside React's render.
  const [showResidue, setShowResidue] = useState(false);
  const showResidueRef = useRef(false);
  const residueCanvasRef = useRef<HTMLCanvasElement>(null);
  const residueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Onion skin (W2): off until the person turns it on; available only when
  // the caller passed neighbours. The decoded neighbours belong to the
  // `onion` sources they were decoded from, so a stale set is never drawn.
  const onionAvailable = !!onion && onion.back.length + onion.ahead.length > 0;
  const [onionOn, setOnionOn] = useState(false);
  // Neighbours are decoded only once the person first turns onion skin on,
  // so an editor that never uses it holds no extra images.
  const [onionRequested, setOnionRequested] = useState(false);
  const toggleOnion = useCallback(() => {
    setOnionRequested(true);
    setOnionOn((v) => !v);
  }, []);
  const [onionBack, setOnionBack] = useState(ONION_DEFAULT_BACK);
  const [onionAhead, setOnionAhead] = useState(ONION_DEFAULT_AHEAD);
  const [onionOpacity, setOnionOpacity] = useState(ONION_DEFAULT_OPACITY);
  const [onionDecoded, setOnionDecoded] = useState<{
    sources: OnionSources;
    frames: OnionNeighbours<OnionFrame | null>;
  } | null>(null);
  const onionCanvasRef = useRef<HTMLCanvasElement>(null);
  const editorWidth = useEditorStore((s) => s.width);
  const editorHeight = useEditorStore((s) => s.height);
  const onionShown = onionAvailable && onionOn;

  // Fit (W2): the zoom at which the whole image fits the canvas area, kept
  // current as the area or the image size changes. It drives the "Fit"
  // button and the smallest zoom pinch, wheel and buttons may reach.
  const [fit, setFit] = useState(0);
  const fitRef = useRef(0);
  const minZoomRef = useRef(1);
  // Set when an image opened before the canvas area had a size (no fit
  // known); the first measurement then fits it if it does not fit.
  const openedUnfittedRef = useRef(false);
  // The fit an image opened at (0 when it opened at another zoom). The first
  // measurement with the image's size keeps it fitted if the area changed
  // while the image loaded (W2 audit r2, finding 4).
  const openedFitRef = useRef(0);
  // The device's pixels per CSS px: below one device pixel per image pixel
  // the layers draw smoothed, since nearest-neighbour would drop whole rows.
  const [dpr, setDpr] = useState(1);
  // Safari's trackpad pinch (gesturestart/gesturechange): the zoom it began
  // at and when its last event came, while one is under way. Null otherwise.
  const safariPinchRef = useRef<{ startZoom: number; at: number } | null>(null);
  // The zoom control (W2, George Nov 4: "more intuitive and just apple
  // product like"): its menu, and the stack's position before a zoom the
  // control asked for, which the layout effect below animates from.
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  // Mirrors zoomMenuOpen for the document listeners below, which outlive a
  // render.
  const zoomMenuOpenRef = useRef(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);
  // The control, and the canvas area that clips the menu (W2 audit r2,
  // finding 3: the menu's height is capped to the room between them).
  const zoomPillRef = useRef<HTMLDivElement>(null);
  const canvasAreaRef = useRef<HTMLElement>(null);
  const zoomAnimFromRef = useRef<DOMRect | null>(null);
  const zoomAnimRef = useRef<Animation | null>(null);
  const zoomAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cursor overlay (mirrors brush footprint at canvas-pixel coords).
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(false);
  const cursorRafRef = useRef<number | null>(null);

  // Fit-to-viewport zoom on dim changes. Wave 2a resets the committed pan +
  // writes a (0,0) translate transform directly so a fresh frame opens at
  // its natural (flex-centered) position rather than carrying over the prior
  // frame's pan/pinch state. We also clear pendingTransformRef so any stale
  // string staged by a concurrent gesture commit can't leak through the
  // next zoom change (defensive — handles a narrow race where a gesture
  // commits in the same render cycle as a frame change).
  useEffect(() => {
    const maxEditorPx = Math.min(window.innerWidth - 200, window.innerHeight - 200, 640);
    const idealZoom = Math.floor(maxEditorPx / Math.max(frameWidth, frameHeight));
    panRef.current = { x: 0, y: 0 };
    pendingTransformRef.current = null;
    zoomAnimRef.current?.cancel();
    zoomAnimRef.current = null;
    if (stackRef.current) {
      stackRef.current.style.transform = 'translate3d(0px, 0px, 0)';
    }
    // An image too big for that zoom (a whole sheet) opens fitted to the
    // canvas area instead (George, Nov 4: a 1024 sheet opened 4,096 px wide).
    const c = containerRef.current;
    const fit = c ? fitZoom(c.clientWidth, c.clientHeight, frameWidth, frameHeight) : 0;
    const z0 = openingZoom(Math.max(4, Math.min(16, idealZoom)), fit);
    openedUnfittedRef.current = !(fit > 0);
    openedFitRef.current = fit > 0 && Math.abs(z0 - fit) < 1e-9 ? fit : 0;
    // An image that fits above the zoom control opens centred in that space,
    // so the control never covers its bottom edge.
    if (fit > 0 && z0 <= fit + 1e-9) {
      panRef.current = { x: 0, y: fitPanY() };
      if (stackRef.current) {
        stackRef.current.style.transform = `translate3d(0px, ${fitPanY()}px, 0)`;
      }
    }
    setZoom(z0);
  }, [frameWidth, frameHeight]);

  // Load frame pixels into the store + extract palette. Reset on unmount so
  // the next editor open gets a clean slate.
  //
  // Fix #5: defensive dimension guardrail. Callers (EditorLanding upload,
  // EditorPage handoff) also check, but this is the last line of defense
  // before any pixel buffer is allocated/copied.
  //
  // Fix #4: if the incoming URL is a blob URL (from UploadZone or the gallery
  // Send-to-Editor path), revoke it AFTER decode — the bytes are now in the
  // store and the browser can release the underlying File/Blob reference.
  useEffect(() => {
    setLoadError(null);

    // Stage 3 restore: a recovered draft carries the full envelope (name,
    // source, frameId, palette) plus raw bytes, so it must go through
    // loadProject, NOT the dataUrl -> loadFrame path, which rebuilds a fresh
    // project (new frameId, empty palette) and would drop the envelope.
    // loadProject re-validates the envelope and cross-checks the byte length,
    // so a corrupt restore fails closed into the loadError UI.
    if (restore) {
      const ok = loadProject(restore.envelope, restore.bytes);
      if (!ok) {
        setLoadError('That recovery draft could not be restored.');
      } else {
        // toProject() emits an empty palette, so the controller merged the
        // live palette into the envelope at save time; seed it back here.
        setPalette(restore.envelope.color.palette);
      }
      return () => { reset(); };
    }

    // Pre-flight check on the props' declared dimensions.
    if (!dimsWithinEditorLimits(frameWidth, frameHeight)) {
      setLoadError(editorDimsRejectionMessage(frameWidth, frameHeight));
      return () => { reset(); };
    }

    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      // Double-check against the decoded natural dims in case the props lied.
      if (!dimsWithinEditorLimits(img.naturalWidth, img.naturalHeight)) {
        setLoadError(editorDimsRejectionMessage(img.naturalWidth, img.naturalHeight));
        return;
      }
      const tmp = document.createElement('canvas');
      tmp.width = frameWidth;
      tmp.height = frameHeight;
      const ctx = tmp.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, frameWidth, frameHeight);
      const imageData = ctx.getImageData(0, 0, frameWidth, frameHeight);

      setPalette(extractPaletteFromImageData(imageData, 16));
      loadFrame('current', new Uint8ClampedArray(imageData.data), frameWidth, frameHeight, source);

      if (frameDataUrl.startsWith('blob:')) {
        // We own the consumption side of this blob URL. UploadZone created
        // it; once the bytes are copied into the store, the underlying File
        // can be released.
        URL.revokeObjectURL(frameDataUrl);
      }
    };
    img.src = frameDataUrl;

    return () => {
      cancelled = true;
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameDataUrl, frameWidth, frameHeight]);

  // Full image repaint — runs on mount, zoom change, frame load, undo/redo.
  // Wave 1c: visible canvas backing store is NATIVE WxH; the browser handles
  // the upscale via CSS + image-rendering: pixelated, so the work is now
  // zoom-independent (O(W*H) bytes, not O(W*H*zoom^2)). The transparency
  // checkerboard lives in CSS on the canvas element; the grid lives in the
  // overlay canvas — neither is touched here.
  const renderCanvasesFull = useCallback(() => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels || width === 0 || height === 0) return;

    const ec = editorCanvasRef.current;
    if (ec) {
      // Assigning width/height clears the canvas, so only re-size when the
      // native dims actually change (avoids the zoom-change wipe).
      if (ec.width !== width || ec.height !== height) {
        ec.width = width;
        ec.height = height;
      }
      // CSS size carries the visible scale. Backing store stays native.
      ec.style.width = `${width * zoom}px`;
      ec.style.height = `${height * zoom}px`;
      const ctx = ec.getContext('2d')!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    }

    // The residue layer sits exactly over the image: same CSS size. Its
    // backing store is sized when it is drawn (drawResidueOverlay).
    const rc = residueCanvasRef.current;
    if (rc) {
      rc.style.width = `${width * zoom}px`;
      rc.style.height = `${height * zoom}px`;
    }

    // The onion layer sits exactly under the image: same CSS size. Its
    // backing store is sized when it is drawn.
    const oc = onionCanvasRef.current;
    if (oc) {
      oc.style.width = `${width * zoom}px`;
      oc.style.height = `${height * zoom}px`;
    }

    const pc = previewCanvasRef.current;
    if (pc && ec) {
      pc.width = width;
      pc.height = height;
      const ctx = pc.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      // Source from the visible canvas (now native res) — the off-screen
      // stage canvas is gone in Wave 1c.
      ctx.drawImage(ec, 0, 0);
    }
  }, [zoom]);

  // Per-event patch — writes only the dirty sub-region at native resolution.
  // Wave 1c: ONE putImageData straight to the visible canvas (which is native
  // res now), no stage, no scaled drawImage. This is the real-time erase fix:
  // putImageData REPLACES bytes (no source-over composite), so alpha=0 pixels
  // become transparent immediately — the CSS-bg checkerboard shows through
  // during the drag, not just after stroke-end.
  const patchDirtyRect = useCallback((rect: DirtyRect) => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels || width === 0 || height === 0) return;
    const ec = editorCanvasRef.current;
    if (!ec) return;
    if (ec.width !== width || ec.height !== height) {
      // Visible canvas not yet sized for these dims (race with a fresh load);
      // bootstrap with a full render then bail — the patch is included in the
      // bytes the full render just wrote.
      renderCanvasesFull();
      return;
    }

    // Build a small ImageData containing only the dirty sub-region (row-by-row
    // copy because the source rows aren't contiguous in the full-frame buffer).
    const subData = new Uint8ClampedArray(rect.w * rect.h * 4);
    for (let row = 0; row < rect.h; row++) {
      const srcOffset = ((rect.y + row) * width + rect.x) * 4;
      const dstOffset = row * rect.w * 4;
      subData.set(pixels.subarray(srcOffset, srcOffset + rect.w * 4), dstOffset);
    }
    const subImageData = new ImageData(subData, rect.w, rect.h);

    // Single native-res write.
    const ctx = ec.getContext('2d')!;
    ctx.putImageData(subImageData, rect.x, rect.y);

    // Preview canvas — source from the visible canvas (also native res).
    const pc = previewCanvasRef.current;
    if (pc) {
      const pctx = pc.getContext('2d')!;
      pctx.imageSmoothingEnabled = false;
      pctx.clearRect(0, 0, width, height);
      pctx.drawImage(ec, 0, 0);
    }
  }, [renderCanvasesFull]);

  // Grid overlay geometry. Called on mount, zoom change and dims/frame-load
  // change. Lines are 1 CSS px at every pixel boundary from x = 0 to
  // x = width - 1 (and the same for y), as the canvas drew them; below 4x
  // there is no grid, since it would only gray the image.
  const drawGridOverlay = useCallback(() => {
    const { width, height } = useEditorStore.getState();
    const ov = overlayRef.current;
    if (!ov || width === 0 || height === 0) return;
    ov.style.width = `${width * zoom}px`;
    ov.style.height = `${height * zoom}px`;
    if (zoom < 4) {
      ov.style.backgroundImage = 'none';
      return;
    }
    const line = 'rgba(255, 255, 255, 0.08)';
    ov.style.backgroundImage =
      `linear-gradient(to right, ${line} 1px, transparent 1px), ` +
      `linear-gradient(to bottom, ${line} 1px, transparent 1px)`;
    ov.style.backgroundSize = `${zoom}px ${zoom}px`;
  }, [zoom]);

  // "Show residue": scan the pixels as they are now and mark what a clean
  // would change. Reads the store at call time, so a scan that runs after
  // more edits marks the newest pixels, never an older copy.
  const drawResidueOverlay = useCallback(() => {
    const rc = residueCanvasRef.current;
    if (!rc) return;
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels || width === 0 || height === 0) {
      rc.getContext('2d')?.clearRect(0, 0, rc.width, rc.height);
      return;
    }
    if (rc.width !== width || rc.height !== height) {
      rc.width = width;
      rc.height = height;
    }
    const { kinds } = scanResidue(pixels, width, height);
    rc.getContext('2d')!.putImageData(new ImageData(residueOverlay(kinds, width, height), width, height), 0, 0);
  }, []);

  // After any pixel change while the layer is on, scan once the edits pause.
  const scheduleResidueOverlay = useCallback(() => {
    if (!showResidueRef.current) return;
    if (residueTimerRef.current !== null) clearTimeout(residueTimerRef.current);
    residueTimerRef.current = setTimeout(() => {
      residueTimerRef.current = null;
      if (showResidueRef.current) drawResidueOverlay();
    }, RESIDUE_RESCAN_MS);
  }, [drawResidueOverlay]);

  // A wholesale change: drop any pending scan and mark the new pixels now.
  const redrawResidueOverlayNow = useCallback(() => {
    if (!showResidueRef.current) return;
    if (residueTimerRef.current !== null) {
      clearTimeout(residueTimerRef.current);
      residueTimerRef.current = null;
    }
    drawResidueOverlay();
  }, [drawResidueOverlay]);

  const toggleShowResidue = useCallback(() => {
    const next = !showResidueRef.current;
    showResidueRef.current = next;
    if (residueTimerRef.current !== null) {
      clearTimeout(residueTimerRef.current);
      residueTimerRef.current = null;
    }
    if (next) drawResidueOverlay();
    setShowResidue(next);
  }, [drawResidueOverlay]);

  // Onion skin: decode the neighbours once per set of sources. A decode
  // that finishes after the sources changed or the editor closed is
  // dropped (decodeOnionSources asks isCurrent at the end).
  useEffect(() => {
    if (!onionRequested || !onion || onion.back.length + onion.ahead.length === 0) return;
    let current = true;
    void decodeOnionSources(onion, decodeImageToFrame, () => current).then((frames) => {
      if (frames && current) setOnionDecoded({ sources: onion, frames });
    });
    return () => {
      current = false;
    };
  }, [onion, onionRequested]);

  // Draw the onion layer whenever what it shows changes. Neighbours never
  // change while a frame is edited, so strokes do not redraw it, and zoom
  // does not either: renderCanvasesFull sets the layer's CSS size.
  useEffect(() => {
    const oc = onionCanvasRef.current;
    if (!oc) return;
    const frames = onionDecoded && onionDecoded.sources === onion ? onionDecoded.frames : null;
    if (!onionShown || !frames || editorWidth <= 0 || editorHeight <= 0) {
      oc.getContext('2d')?.clearRect(0, 0, oc.width, oc.height);
      return;
    }
    if (oc.width !== editorWidth || oc.height !== editorHeight) {
      oc.width = editorWidth;
      oc.height = editorHeight;
    }
    const layer = onionLayer(frames, editorWidth, editorHeight, { back: onionBack, ahead: onionAhead, opacity: onionOpacity });
    oc.getContext('2d')!.putImageData(new ImageData(layer, editorWidth, editorHeight), 0, 0);
  }, [onion, onionDecoded, onionShown, onionBack, onionAhead, onionOpacity, editorWidth, editorHeight]);

  // Pixel subscription — fires outside React reconciliation, no re-render.
  // Subscribes to `pixels` (always changes reference on any pixel mutation),
  // then reads `lastDirtyRect` via getState to decide between full vs patch.
  // We subscribe to pixels (not lastDirtyRect) so wholesale replacements
  // — undo/redo, which set lastDirtyRect: null — still trigger the listener
  // even when prior lastDirtyRect was also null (Object.is would miss that).
  useEffect(() => {
    renderCanvasesFull();
    drawGridOverlay();
    const unsub = useEditorStore.subscribe(
      (s) => s.pixels,
      () => {
        const rect = useEditorStore.getState().lastDirtyRect;
        if (rect === null) {
          renderCanvasesFull();
          // Wholesale change may be a frame load with new dims — refresh grid.
          drawGridOverlay();
        } else {
          patchDirtyRect(rect);
        }
        if (rect === null) redrawResidueOverlayNow();
        else scheduleResidueOverlay();
      }
    );
    return unsub;
  }, [renderCanvasesFull, patchDirtyRect, drawGridOverlay, scheduleResidueOverlay, redrawResidueOverlayNow]);

  // Re-render on zoom change (image canvas's CSS size + overlay's full
  // geometry). Wave 2a: this MUST be a layout effect so the canvas CSS size
  // updates BEFORE paint and BEFORE the pendingTransformRef flush effect
  // (declared after this one) writes the post-commit transform. Together,
  // both updates land in the same pre-paint phase, eliminating the
  // intermediate "old size + new no-scale transform" frame.
  useLayoutEffect(() => {
    renderCanvasesFull();
    drawGridOverlay();
  }, [zoom, renderCanvasesFull, drawGridOverlay]);

  // Close the mobile Colors sheet if the viewport grows to md+ (e.g. rotate
  // to landscape), where the desktop sidepanel takes over and an open sheet
  // would be a stranded overlay.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = () => { if (mq.matches) setSheetOpen(false); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Escape closes the mobile Colors sheet (parity with the old Dialog).
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  // Wave 2a commit contract: when a gesture/wheel committer wants to atomic-
  // ally swap the wrapper transform from `translate(p) scale(s)` to
  // `translate(p')`, it stages the new transform string in pendingTransformRef
  // and calls setZoom(newZoom). React commits the new zoom -> the zoom-change
  // effects run renderCanvasesFull (resizing the canvas CSS to native*newZoom)
  // -> THIS layout effect writes the staged transform. All in one frame
  // before paint, so the user never sees an intermediate-state flicker.
  useLayoutEffect(() => {
    if (pendingTransformRef.current !== null && stackRef.current) {
      stackRef.current.style.transform = pendingTransformRef.current;
      pendingTransformRef.current = null;
    }
  }, [zoom]);

  // The zoom control's changes animate (W2): after the new size and place are
  // committed above, the stack is shown back where it was and eased into
  // place (a FLIP, with the Web Animations API, so the inline transform always
  // holds the final place). Only the control animates; the wheel and pinches
  // cancel an animation in flight. A stack larger than ZOOM_ANIM_MAX_PX is
  // not animated (a layer thousands of px wide may fail to composite, which
  // left a CSS transition stuck at its start in Chromium), and whatever
  // happens to an animation, the final place holds within 250 ms.
  useLayoutEffect(() => {
    const from = zoomAnimFromRef.current;
    zoomAnimFromRef.current = null;
    const st = stackRef.current;
    if (!from || !st || typeof st.animate !== 'function') return;
    const to = st.getBoundingClientRect();
    if (from.width <= 0 || to.width <= 0) return;
    if (Math.max(from.width, from.height, to.width, to.height) > ZOOM_ANIM_MAX_PX) return;
    const { x, y } = panRef.current;
    zoomAnimRef.current?.cancel();
    const anim = st.animate(
      [
        { transform: `translate3d(${x + from.left - to.left}px, ${y + from.top - to.top}px, 0) scale(${from.width / to.width})` },
        { transform: `translate3d(${x}px, ${y}px, 0)` },
      ],
      { duration: 160, easing: 'ease-out' }
    );
    zoomAnimRef.current = anim;
    const done = () => {
      anim.cancel();
      if (zoomAnimRef.current === anim) zoomAnimRef.current = null;
    };
    anim.onfinish = done;
    if (zoomAnimTimerRef.current !== null) clearTimeout(zoomAnimTimerRef.current);
    zoomAnimTimerRef.current = setTimeout(() => {
      zoomAnimTimerRef.current = null;
      done();
    }, 250);
  }, [zoom]);

  const cancelZoomAnimation = useCallback(() => {
    if (zoomAnimTimerRef.current !== null) {
      clearTimeout(zoomAnimTimerRef.current);
      zoomAnimTimerRef.current = null;
    }
    zoomAnimFromRef.current = null;
    zoomAnimRef.current?.cancel();
    zoomAnimRef.current = null;
  }, []);

  // Bound the committed pan to the viewport.
  //   Canvas LARGER than viewport on an axis: bound so the canvas still covers
  //     the viewport (edge can't pass center) — can't shove it off-screen.
  //   Canvas SMALLER (fits): let it slide within the viewport (stay fully
  //     visible) so you can pan to a feature near an edge, instead of locking
  //     it dead-center. |W*zoom - vp| handles both with one expression.
  //   Behavior note: zoom-OUT no longer auto-recenters via gesture (it stays
  //     where you left it, bounded); the zoom BUTTONS still recenter (pan {0,0}).
  // Valid ONLY where the committed scale is 1 (post-commit zoom + wheel-pan);
  //   NOT during a live pinch (scale != 1, transform-origin 0,0 → pan=0 isn't
  //   "centered"). Never called from the live gesture-move branch.
  const clampPan = useCallback(
    (pan: { x: number; y: number }, zoomLevel: number) => {
      const vp = containerRef.current?.getBoundingClientRect();
      const { width, height } = useEditorStore.getState();
      if (!vp || width === 0 || height === 0) return pan;
      const maxX = Math.abs(width * zoomLevel - vp.width) / 2;
      const maxY = Math.abs(height * zoomLevel - vp.height) / 2;
      return { x: clamp(pan.x, -maxX, maxX), y: clamp(pan.y, -maxY, maxY) };
    },
    []
  );

  // The pan that keeps the image point under a screen point still while the
  // zoom goes from z to z2 (the wheel's and Safari's pinch anchor). local is
  // the screen point relative to the stack's top-left at zoom z. The stack
  // is flex-centred, so its layout origin also moves by dims*(z2 - z)/2, the
  // same correction the touch pinch's commit applies.
  const anchoredPan = useCallback((z: number, z2: number, local: { x: number; y: number }) => {
    const { width, height } = useEditorStore.getState();
    const s = z2 / z;
    return {
      x: panRef.current.x + (1 - s) * local.x + (width * (z2 - z)) / 2,
      y: panRef.current.y + (1 - s) * local.y + (height * (z2 - z)) / 2,
    };
  }, []);

  // Single commit point for the wrapper transform + zoom state. Every
  // committer (gesture-end, wheel zoom, zoom buttons) routes through here so
  // the commit contract is honored in one place:
  //   - If zoom changes, stage the new transform string and call setZoom;
  //     the [zoom]-keyed useLayoutEffect above flushes it AFTER the canvas
  //     CSS size update in the same pre-paint phase (no flicker).
  //   - If zoom is unchanged (idempotent setZoom skips re-render so the
  //     layout effect can't fire), write the transform directly and clear
  //     pendingTransformRef so no stale string carries into the next commit.
  // panRef is always updated to the (clamped) new pan so subsequent gestures
  // pick up the current committed position.
  const commitZoomPan = useCallback(
    (nextZoom: number, nextPan: { x: number; y: number }) => {
      const clampedZoom = clamp(nextZoom, minZoomRef.current, MAX_ZOOM);
      const clampedPan = clampPan(nextPan, clampedZoom);
      panRef.current = clampedPan;
      const transform = `translate3d(${clampedPan.x}px, ${clampedPan.y}px, 0)`;
      if (clampedZoom === zoom) {
        if (stackRef.current) stackRef.current.style.transform = transform;
        pendingTransformRef.current = null;
      } else {
        pendingTransformRef.current = transform;
        setZoom(clampedZoom);
      }
    },
    [zoom, clampPan]
  );

  // Mirrors of the current zoom and commit for callbacks that outlive a
  // render (the ResizeObserver below).
  const zoomRef = useRef(zoom);
  const commitRef = useRef(commitZoomPan);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    commitRef.current = commitZoomPan;
  });

  // A zoom asked for by the zoom control, its menu or a shortcut: about the
  // centre of the view (the point under the centre stays there) unless a pan
  // is given, and animated unless the person prefers reduced motion.
  const zoomFromControl = useCallback(
    (nextZoom: number, nextPan?: { x: number; y: number }) => {
      const target = clamp(nextZoom, minZoomRef.current, MAX_ZOOM);
      const s = target / zoom;
      const pan = nextPan ?? { x: panRef.current.x * s, y: panRef.current.y * s };
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Where the stack is on screen now, measured before a running zoom
      // animation is cancelled: a second press while one runs starts from
      // there, not from where the first was heading (W2 audit r2, finding 10).
      const from = target !== zoom && !reduce && stackRef.current ? stackRef.current.getBoundingClientRect() : null;
      cancelZoomAnimation();
      zoomAnimFromRef.current = from;
      commitZoomPan(target, pan);
    },
    [zoom, commitZoomPan, cancelZoomAnimation]
  );

  const zoomToFit = useCallback(() => {
    if (fit > 0) zoomFromControl(Math.min(fit, MAX_ZOOM), { x: 0, y: fitPanY() });
  }, [fit, zoomFromControl]);

  const zoomStep = useCallback(
    (dir: 1 | -1) => zoomFromControl(nextZoomStep(zoom, dir, fit, minZoomRef.current, MAX_ZOOM)),
    [zoom, fit, zoomFromControl]
  );

  // Zoom shortcuts while the editor is open (W2): Cmd (Mac) or Ctrl with +,
  // -, 0 (fit) and 1 (actual size). They replace the browser's page zoom only
  // here; outside the editor nothing listens. Not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const kind = zoomShortcut(e);
      if (!kind) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (kind === 'fit') zoomToFit();
      else if (kind === 'actual') zoomFromControl(1);
      else zoomStep(kind === 'in' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit, zoomFromControl, zoomStep]);

  useLayoutEffect(() => {
    zoomMenuOpenRef.current = zoomMenuOpen;
  }, [zoomMenuOpen]);

  // Close the zoom menu and give the focus back to its button, as a menu
  // button does (W2 audit r2, finding 5: choosing an item left the focus on
  // the page). Tab closes the menu without this, so the focus moves on.
  const closeZoomMenu = useCallback(() => {
    zoomMenuOpenRef.current = false;
    setZoomMenuOpen(false);
    zoomTriggerRef.current?.focus({ preventScroll: true });
  }, []);

  // Focus a menu item, scrolling only the menu to show it: the canvas area
  // clips the menu and must never scroll itself.
  const focusZoomMenuItem = useCallback((item: HTMLElement) => {
    item.focus({ preventScroll: true });
    const menu = zoomMenuRef.current;
    if (!menu) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, []);

  // When the menu opens: its height is capped to the room above the control
  // inside the canvas area, which clips it, and kept so while it is open (a
  // phone turned on its side); then the focus goes to the checked level, or
  // the first item. Written to the element here, before paint, so the focus
  // scrolls the capped menu (W2 audit r2, finding 3).
  useLayoutEffect(() => {
    if (!zoomMenuOpen) return;
    const menu = zoomMenuRef.current;
    if (!menu) return;
    const capToArea = () => {
      const area = canvasAreaRef.current;
      const pill = zoomPillRef.current;
      if (!area || !pill) return;
      menu.style.maxHeight = `${zoomMenuMaxHeight(area.getBoundingClientRect().top, pill.getBoundingClientRect().top)}px`;
    };
    capToArea();
    const first =
      menu.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu.querySelector<HTMLElement>('[role^="menuitem"]');
    if (first) focusZoomMenuItem(first);
    window.addEventListener('resize', capToArea);
    return () => window.removeEventListener('resize', capToArea);
  }, [zoomMenuOpen, focusZoomMenuItem]);

  // The press that closes the zoom menu only closes it (W2 audit r2, finding
  // 2: it used to paint a pixel; Apple's menus never click through). Neither
  // the press, its click nor a finger that lands while it is down reaches any
  // other handler, so a two-finger touch that closes the menu cannot draw
  // either, and a press on the dialog's backdrop does not also close the
  // editor. A press on the menu or its button works as usual.
  useEffect(() => {
    const held = new Set<number>();
    let eatClickUntil = 0;
    let eatTouchEnd = false;
    const onDown = (e: PointerEvent) => {
      // A new first pointer means the held ones are gone, even if their
      // pointerup was never seen.
      if (held.size > 0 && e.isPrimary) held.clear();
      if (held.size === 0) {
        eatClickUntil = 0;
        if (!zoomMenuOpenRef.current) return;
        const t = e.target as Node;
        if (zoomMenuRef.current?.contains(t) || zoomTriggerRef.current?.contains(t)) return;
        closeZoomMenu();
      }
      held.add(e.pointerId);
      if (e.pointerType === 'touch') eatTouchEnd = true;
      e.preventDefault();
      e.stopPropagation();
    };
    const onUpOrCancel = (e: PointerEvent) => {
      if (!held.delete(e.pointerId)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'pointerup') eatClickUntil = performance.now() + 500;
    };
    // On touch screens the click (and the dialog's outside-press check)
    // follow touchend, so it is cancelled too.
    const onTouchEnd = (e: TouchEvent) => {
      if (!eatTouchEnd) return;
      if (e.touches.length === 0) eatTouchEnd = false;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };
    // Only a click from the swallowed press: a keyboard click (detail 0) or
    // one long after it is left alone.
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0 || performance.now() > eatClickUntil) return;
      eatClickUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUpOrCancel, true);
    document.addEventListener('pointercancel', onUpOrCancel, true);
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUpOrCancel, true);
      document.removeEventListener('pointercancel', onUpOrCancel, true);
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      document.removeEventListener('click', onClick, true);
    };
  }, [closeZoomMenu]);

  const onZoomMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeZoomMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const items = Array.from(zoomMenuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
      if (items.length === 0) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home' ? 0
        : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (i + 1) % items.length
        : (i - 1 + items.length) % items.length;
      focusZoomMenuItem(items[next]);
    } else if (e.key === 'Tab') {
      setZoomMenuOpen(false);
    }
  }, [closeZoomMenu, focusZoomMenuItem]);

  // Wave 2a desktop wheel:
  //   - ctrl/cmd+wheel = ZOOM, anchored at the cursor (trackpad pinch on
  //     macOS surfaces as ctrlKey wheel).
  //   - plain wheel / two-finger swipe = PAN (replaces the prior scroll-pan
  //     since the viewport is now overflow-hidden). Bounded by clampPan.
  // Attached via addEventListener with { passive: false } because React's
  // synthetic onWheel is passive and preventDefault would no-op.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      cancelZoomAnimation();
      if (e.ctrlKey || e.metaKey) {
        // Safari reports a trackpad pinch as gesture events (below); a ctrl
        // wheel arriving during one is not zoomed twice.
        const pinch = safariPinchRef.current;
        if (pinch && performance.now() - pinch.at < 500) return;
        const s = Math.exp(-e.deltaY * 0.0015);
        const newZoom = clamp(zoom * s, minZoomRef.current, MAX_ZOOM);
        if (newZoom === zoom) return;
        const stackRect = stackRef.current?.getBoundingClientRect();
        if (!stackRect) return;
        commitZoomPan(newZoom, anchoredPan(zoom, newZoom, { x: e.clientX - stackRect.left, y: e.clientY - stackRect.top }));
      } else {
        // Plain wheel / two-finger swipe = pan (clamped). No zoom change, so
        // write the transform directly; no setZoom / pendingTransform needed.
        const newPan = clampPan(
          { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY },
          zoom
        );
        panRef.current = newPan;
        if (stackRef.current) {
          stackRef.current.style.transform = `translate3d(${newPan.x}px, ${newPan.y}px, 0)`;
        }
      }
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [zoom, commitZoomPan, clampPan, cancelZoomAnimation, anchoredPan]);

  // Fit (W2): recompute the fitted zoom whenever the canvas area or the
  // image size changes (window resize, the side panel, a new image).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const prev = fitRef.current;
      const f = fitZoom(container.clientWidth, container.clientHeight, editorWidth, editorHeight);
      fitRef.current = f;
      minZoomRef.current = minZoomFor(f);
      setFit(f);
      setDpr(window.devicePixelRatio || 1);
      if (!(f > 0)) return;
      // Not during a pinch: its own commit lands the zoom when the fingers
      // lift, against the new smallest zoom (W2 audit r2, finding 8: a commit
      // here replaced the live pinch under the fingers).
      const pinch = safariPinchRef.current;
      if (gestureRef.current || (pinch && performance.now() - pinch.at < 500)) return;
      // Follow the fit: a fitted image stays fitted when the area changes
      // size (including while it loaded, if it opened fitted), a zoom left
      // below the new smallest zoom rises to it, and an image that opened
      // before the area had a size is fitted once it has.
      const z = zoomRef.current;
      const openedAt = openedFitRef.current;
      openedFitRef.current = 0;
      const atFit =
        (prev > 0 && Math.abs(z - Math.min(prev, MAX_ZOOM)) < 1e-6) ||
        (openedAt > 0 && Math.abs(z - openedAt) < 1e-6);
      if (atFit || z < minZoomRef.current - 1e-9) {
        openedUnfittedRef.current = false;
        commitRef.current(Math.min(f, MAX_ZOOM), { x: 0, y: fitPanY() });
      } else if (openedUnfittedRef.current) {
        openedUnfittedRef.current = false;
        const z1 = openingZoom(z, f);
        if (z1 !== z) commitRef.current(z1, { x: 0, y: fitPanY() });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [editorWidth, editorHeight]);

  // Safari's trackpad pinch (W2): Safari sends gesturestart, gesturechange
  // and gestureend with a scale from the start of the pinch, not a ctrl
  // wheel as Chrome does, and would zoom the whole page. Zoom the canvas
  // instead, anchored at the pointer, through the same commit as the wheel.
  // The pinch's start zoom lives in a ref, so re-subscribing on every zoom
  // change does not lose it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    type PinchEvent = Event & { scale?: number; clientX?: number; clientY?: number };
    // On iPhone and iPad, Safari sends these beside the touch events of a
    // two-finger pinch, which the pointer handlers already zoom; only a pinch
    // with no finger on the screen (a trackpad) is handled here.
    const touching = () => pointersRef.current.size > 0 || gestureSessionRef.current;
    const onStart = (e: Event) => {
      e.preventDefault();
      if (touching()) return;
      cancelZoomAnimation();
      safariPinchRef.current = { startZoom: zoom, at: performance.now() };
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      if (touching()) return;
      const start = safariPinchRef.current;
      const ge = e as PinchEvent;
      if (!start || typeof ge.scale !== 'number' || !Number.isFinite(ge.scale) || ge.scale <= 0) return;
      const newZoom = clamp(start.startZoom * ge.scale, minZoomRef.current, MAX_ZOOM);
      if (newZoom === zoom) return;
      const stackRect = stackRef.current?.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      if (!stackRect) return;
      const cx = Number.isFinite(ge.clientX) ? (ge.clientX as number) : box.left + box.width / 2;
      const cy = Number.isFinite(ge.clientY) ? (ge.clientY as number) : box.top + box.height / 2;
      start.at = performance.now();
      commitZoomPan(newZoom, anchoredPan(zoom, newZoom, { x: cx - stackRect.left, y: cy - stackRect.top }));
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      safariPinchRef.current = null;
    };
    const onBlur = () => {
      safariPinchRef.current = null;
    };
    container.addEventListener('gesturestart', onStart, { passive: false });
    container.addEventListener('gesturechange', onChange, { passive: false });
    container.addEventListener('gestureend', onEnd, { passive: false });
    window.addEventListener('blur', onBlur);
    return () => {
      container.removeEventListener('gesturestart', onStart);
      container.removeEventListener('gesturechange', onChange);
      container.removeEventListener('gestureend', onEnd);
      window.removeEventListener('blur', onBlur);
    };
  }, [zoom, commitZoomPan, cancelZoomAnimation, anchoredPan]);

  // Wave 2a getPixelCoords — accepts a {clientX, clientY} payload (so it
  // works with pointer / wheel / synthetic events) and derives the visual
  // scale FROM THE RECT, not from the React zoom state. This single change
  // makes every tool correct under any pan/zoom/pinch state (spec AD-2).
  // canvas.width is native pixels; rect.width is current CSS pixels under
  // whatever transform chain sits above the canvas.
  const getPixelCoords = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const canvas = editorCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / Math.max(1, canvas.width);
      if (scale <= 0) return null;
      const x = Math.floor((e.clientX - rect.left) / scale);
      const y = Math.floor((e.clientY - rect.top) / scale);
      return { x, y };
    },
    []
  );

  const applyAt = useCallback(
    (x: number, y: number) => {
      if (tool === 'pencil') {
        paintPixel(x, y, color);
      } else if (tool === 'eraser') {
        erasePixel(x, y);
      } else if (tool === 'eyedropper') {
        const hex = eyedrop(x, y);
        if (hex) {
          setColor(hex);
          setTool('pencil');
        }
      }
    },
    [tool, color, paintPixel, erasePixel, eyedrop, setColor, setTool]
  );

  // Interpolated line stamp for mid-stroke pointermove. Single store action
  // (one subscription fire) regardless of segment length. Eyedropper not
  // applicable (filtered out by the caller).
  const applyLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      if (tool === 'pencil') {
        paintLine(x0, y0, x1, y1, color);
      } else if (tool === 'eraser') {
        eraseLine(x0, y0, x1, y1);
      }
    },
    [tool, color, paintLine, eraseLine]
  );

  // Mouse-cursor brush footprint overlay. RAF-coalesced so rapid mouse moves
  // produce at most one setState per frame. Hides when the mouse is outside
  // canvas bounds. Touch/pen pointers do NOT call this — fingers occlude the
  // footprint and there's nothing to show.
  //
  // canvas.getBoundingClientRect() includes ALL parent transforms (the
  // wrapper's pan/zoom via stackRef), so scale = rect.width / canvas.width
  // is the EFFECTIVE on-screen scale. cellX/cellY are correct canvas-pixel
  // indices, and the cursor offset (cellX - half) * scale lands at the right
  // CSS-pixel position within the (pre-transform) wrapper, where the cursor
  // div is a child — the wrapper's transform then carries it to the final
  // screen position. Same technique as getPixelCoords (Wave 2a spec AD-2).
  const updateCursorForMouse = useCallback((clientX: number, clientY: number) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / Math.max(1, canvas.width);
    if (scale <= 0) return;
    const cellX = Math.floor((clientX - rect.left) / scale);
    const cellY = Math.floor((clientY - rect.top) / scale);
    if (cellX < 0 || cellX >= canvas.width || cellY < 0 || cellY >= canvas.height) {
      setCursorVisible(false);
      return;
    }
    setCursorVisible(true);
    const half = Math.floor(brushSize / 2);
    const ox = (cellX - half) * scale;
    const oy = (cellY - half) * scale;
    if (cursorRafRef.current !== null) cancelAnimationFrame(cursorRafRef.current);
    cursorRafRef.current = requestAnimationFrame(() => {
      setCursorX(ox);
      setCursorY(oy);
    });
  }, [brushSize]);

  // Wave 2a pointer handlers — replace the prior mouse handlers entirely.
  // Bound on the CONTAINER (the flex div) so fingers on the padding still
  // count toward a pinch; setPointerCapture routes all subsequent moves to
  // us regardless of where the pointer ends up.

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Skip presses that land on an interactive control inside the container
      // (zoom buttons, etc.). Calling setPointerCapture on the container
      // would retarget the matching pointerup off the button and suppress
      // its synthetic click. The canvas and padding are not interactive
      // elements, so drawing + gesture-start on the canvas/padding still
      // route through this handler.
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest('button, input, a, select, textarea, [role="button"]')) {
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers throw if pointerId isn't currently captureable; ignore.
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const size = pointersRef.current.size;

      if (size === 1 && !gestureSessionRef.current) {
        // Drawing branch — but only if the press landed on the canvas.
        const coords = getPixelCoords(e);
        if (!coords) return;
        const canvas = editorCanvasRef.current;
        if (!canvas) return;
        if (coords.x < 0 || coords.x >= canvas.width || coords.y < 0 || coords.y >= canvas.height) {
          // Inside container but outside canvas (padding/zoom-controls row).
          // Don't start a stroke; the pointer is still captured so a pinch
          // started here would still work.
          return;
        }
        if (tool !== 'eyedropper') beginStroke();
        setIsDrawing(true);
        prevCellRef.current = null;
        applyAt(coords.x, coords.y);
        if (tool !== 'eyedropper') {
          prevCellRef.current = coords;
        }
      } else if (size === 2) {
        // Second pointer landed — kill any drawing in progress, start gesture.
        // cancelStroke restores the pre-stroke snapshot from history so the
        // partial stroke is invisible (spec AD-4).
        if (isDrawing) {
          cancelStroke();
          setIsDrawing(false);
          prevCellRef.current = null;
        }
        gestureSessionRef.current = true;
        cancelZoomAnimation();
        const ids = Array.from(pointersRef.current.keys());
        const p0Id = ids[0];
        const p1Id = ids[1];
        const p0 = pointersRef.current.get(p0Id)!;
        const p1 = pointersRef.current.get(p1Id)!;
        const startMid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const startDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const stackRect = stackRef.current?.getBoundingClientRect();
        const localCss = stackRect
          ? { x: startMid.x - stackRect.left, y: startMid.y - stackRect.top }
          : { x: 0, y: 0 };
        gestureRef.current = {
          startDist: Math.max(1, startDist), // avoid div-by-zero on coincident touches
          startMid,
          startPan: { x: panRef.current.x, y: panRef.current.y },
          startZoom: zoom,
          localCss,
          lastScale: 1,
          pointerIds: [p0Id, p1Id],
        };
      }
      // size > 2: ignore extra pointers (still captured/tracked, but no behavior).
    },
    [tool, beginStroke, isDrawing, applyAt, cancelStroke, getPixelCoords, zoom, cancelZoomAnimation]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Cursor footprint tracking — runs BEFORE the capture guard so plain
      // mouse hover (uncaptured pointermove on the container) still updates
      // the brush outline. Skipped during an active pinch (the wrapper is
      // mid-transform; an in-flight overlay position would be misleading).
      if (e.pointerType === 'mouse' && !gestureRef.current) {
        updateCursorForMouse(e.clientX, e.clientY);
      }
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const size = pointersRef.current.size;
      const g = gestureRef.current;

      if (g && size >= 2) {
        // Active pinch/pan — compute geometry from the SAME two pointer ids
        // that initiated the gesture, not the two oldest currently tracked.
        // If a 3rd finger joined and then one of the originals lifted, the
        // Map iteration order would otherwise hand us the wrong pair against
        // the baseline (startDist / startMid). If either original is gone,
        // bail; pointerup will commit the gesture cleanly.
        const p0 = pointersRef.current.get(g.pointerIds[0]);
        const p1 = pointersRef.current.get(g.pointerIds[1]);
        if (!p0 || !p1) return;
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const rawS = dist / g.startDist;
        const minS = minZoomRef.current / g.startZoom;
        const maxS = MAX_ZOOM / g.startZoom;
        const s = clamp(rawS, minS, maxS);
        const newPan = {
          x: g.startPan.x + (mid.x - g.startMid.x) + (1 - s) * g.localCss.x,
          y: g.startPan.y + (mid.y - g.startMid.y) + (1 - s) * g.localCss.y,
        };
        if (stackRef.current) {
          stackRef.current.style.transform = `translate3d(${newPan.x}px, ${newPan.y}px, 0) scale(${s})`;
        }
        g.lastScale = s;
        panRef.current = newPan;
        return;
      }

      if (isDrawing && size === 1 && tool !== 'eyedropper') {
        // Mid-stroke move — Bresenham interpolation. Cursor footprint was
        // already updated at the top of this function.
        const coords = getPixelCoords(e);
        if (!coords) return;
        const prev = prevCellRef.current;
        if (prev && (prev.x !== coords.x || prev.y !== coords.y)) {
          applyLine(prev.x, prev.y, coords.x, coords.y);
        } else if (!prev) {
          applyAt(coords.x, coords.y);
        }
        prevCellRef.current = coords;
      }
    },
    [isDrawing, tool, getPixelCoords, applyAt, applyLine, updateCursorForMouse]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Double-fire guard: W3C says when releasePointerCapture is called
      // inside pointerup, the browser ALSO fires lostpointercapture — and
      // we've wired both to this same handler. The second call would
      // double-execute endStroke (pushing a duplicate history entry).
      // Bail if the pointer is already gone from our tracker.
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);
      const container = containerRef.current;
      try {
        container?.releasePointerCapture(e.pointerId);
      } catch {
        // Capture may already be implicitly released; ignore.
      }
      const size = pointersRef.current.size;
      const g = gestureRef.current;

      // Commit the gesture either when size drops below 2 OR when one of the
      // gesture's original pointer ids is gone (3rd finger arrived, then an
      // original lifted while size remains >= 2). The latter prevents
      // continuing with wrong-pair geometry against the original baseline.
      const gestureOriginalLost =
        g && (!pointersRef.current.has(g.pointerIds[0]) || !pointersRef.current.has(g.pointerIds[1]));

      if (g && (size < 2 || gestureOriginalLost)) {
        const newZoom = g.startZoom * g.lastScale;
        // Flex-shift correction. The canvas stack is flex-centered, so its
        // layout origin moves by dims*(newZoom - startZoom)/2 when the
        // committed zoom changes. panRef holds the live pan in the START
        // zoom's centered frame; re-express it in the NEW zoom's centered
        // frame so the commit lands exactly where the live pinch left it
        // (otherwise it snaps toward center on release — the "pinch
        // recenter" bug). Pure pan (newZoom === startZoom) => correction is
        // 0. commitZoomPan then clamps the result.
        const { width, height } = useEditorStore.getState();
        const correctedPan = {
          x: panRef.current.x + (width * (newZoom - g.startZoom)) / 2,
          y: panRef.current.y + (height * (newZoom - g.startZoom)) / 2,
        };
        commitZoomPan(newZoom, correctedPan);
        gestureRef.current = null;
        // gestureSessionRef stays true until size === 0 (spec rule 4).
      } else if (isDrawing && size === 0) {
        if (tool !== 'eyedropper') {
          endStroke();
          // Wave 1c correctness backstop — putImageData full buffer to the
          // visible canvas, in case per-event patches drifted from the store's
          // final state.
          const ec = editorCanvasRef.current;
          const { pixels, width, height } = useEditorStore.getState();
          if (
            ec && pixels && width > 0 && height > 0 &&
            ec.width === width && ec.height === height
          ) {
            const ctx = ec.getContext('2d')!;
            ctx.putImageData(
              new ImageData(new Uint8ClampedArray(pixels), width, height),
              0, 0,
            );
          }
        }
        setIsDrawing(false);
        prevCellRef.current = null;
      }

      if (size === 0) {
        gestureSessionRef.current = false;
      }

      // Mouse: recompute visibility (we may have ended outside canvas bounds).
      if (e.pointerType === 'mouse') {
        updateCursorForMouse(e.clientX, e.clientY);
      }
    },
    [isDrawing, tool, endStroke, updateCursorForMouse, commitZoomPan]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Match handlePointerUp's guard against double-fire — if we already
      // processed this id, bail.
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      // OS stole the gesture — don't commit a half-stroke.
      if (isDrawing) {
        cancelStroke();
        setIsDrawing(false);
        prevCellRef.current = null;
      }
      // Only abandon the gesture if the cancellation actually terminates it
      // — i.e., we've dropped below 2 pointers OR one of the gesture's
      // original pointer ids is now gone. Cancelling a 3rd-finger palm-touch
      // while a 2-finger pinch is ongoing must NOT kill the active pinch.
      const g = gestureRef.current;
      const size = pointersRef.current.size;
      const gestureOriginalLost =
        g && (!pointersRef.current.has(g.pointerIds[0]) || !pointersRef.current.has(g.pointerIds[1]));
      if (g && (size < 2 || gestureOriginalLost)) {
        // Abandon the in-progress gesture without committing zoom changes.
        // The wrapper transform stays at its last imperatively-written value
        // until the next gesture or zoom commit — acceptable for 2a.
        gestureRef.current = null;
      }
      if (size === 0) {
        gestureSessionRef.current = false;
      }
    },
    [isDrawing, cancelStroke]
  );

  // Serialize current store pixels to a PNG dataURL.
  const renderToDataUrl = useCallback((): string | null => {
    const { pixels, width, height } = useEditorStore.getState();
    if (!pixels) return null;
    return pixelsToPngDataUrl(pixels, width, height);
  }, []);

  // Modal-mode Save: callback + dismiss (parent handles flow).
  //
  // The dismiss path is deliberately the wrapper-supplied onSaveClose (NOT
  // onDismiss) so the explicit Save button bypasses attemptDismiss's
  // isDirty check. Without this, doSaveAndDismiss → onDismiss → attemptDismiss
  // re-reads historyIndex (still > 0 — save doesn't reset it) and re-pops
  // the "Unsaved changes?" confirm right after the user just clicked Save.
  // Fallback to onDismiss when the wrapper omits onSaveClose — page mode's
  // Save button doesn't exist today, but the fallback keeps the contract safe.
  const doSaveAndDismiss = useCallback(() => {
    // The session ends by the user's choice: its newest state goes into the
    // draft (read now, before the close resets the store), which is then
    // marked closed so Generate does not offer it.
    void closeEditorDraft(draftKey);
    // Skip onSave when there are no committed edits (historyIndex === 0): the
    // pixels are byte-identical to load (e.g. a pinch-cancelled stroke left the
    // session dirty only via hasAttemptedEdit), and pushing them downstream
    // falsely flips "Edited" state. Still close either way.
    if (useEditorStore.getState().historyIndex > 0) {
      const dataUrl = renderToDataUrl();
      if (dataUrl) onSave(dataUrl);
    }
    (onSaveClose ?? onDismiss)();
  }, [renderToDataUrl, onSave, onSaveClose, onDismiss, draftKey]);

  // Leaving the full-page editor with edits asks first (BUILD 2026-10-29):
  // its Back, any in-app link, and the browser's Back (an edge swipe on
  // iOS). The modal asks through its wrapper's confirm instead. The work is
  // already in the draft either way; this makes leaving a choice.
  const [leaveAsk, setLeaveAsk] = useState<null | { kind: 'back' } | { kind: 'dismiss' } | { kind: 'href'; href: string }>(null);
  const guardPage = layout === 'page' && isDirtyForGuard;
  const { rearm: rearmPageGuard, ownsTop: pageGuardOnTop } = useEditorHistoryGuard(guardPage, () => setLeaveAsk({ kind: 'back' }));
  // Going to another page: while the editor's own history entry is the
  // current one, replace it rather than push past it, so Back from there
  // comes straight back here instead of landing on that entry first.
  const goTo = useCallback((href: string) => {
    if (pageGuardOnTop()) router.replace(href);
    else router.push(href);
  }, [pageGuardOnTop, router]);

  // Send-to-Animator (page-mode only). Snapshot the canvas synchronously
  // BEFORE any state change or navigation. The dataUrl is a JS string copy
  // — once it's staged in spriteStore (which is decoupled from editorStore),
  // the natural unmount-driven editorStore.reset() can fire without harming
  // it. Do NOT call onDismiss here — onDismiss triggers reset() before the
  // snapshot completes and zeros out the canvas.
  const handleSendToAnimator = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (!dataUrl) return;

    setGeneratedImage(dataUrl, dataUrl);
    setCurrentSheetMetadata(null);                 // the edit is a new image: no sheet hints
    setGenerationStyle(null);
    setOriginalCharacter(null);                    // clear stale Animate-source if any
    setPendingAnimatorSkipBgRemoval(true);         // user just edited; respect what they made
    setPendingAnimatorHandoff(true);

    // The edit goes on to the Animator: the session ended by choice.
    void closeEditorDraft(draftKey);
    goTo('/generate');
  }, [renderToDataUrl, setGeneratedImage, setCurrentSheetMetadata, setGenerationStyle, setOriginalCharacter, setPendingAnimatorSkipBgRemoval, setPendingAnimatorHandoff, goTo, draftKey]);

  // PNG download via <a download>. Editor stays open. Backs page-mode Save
  // and the modal header's Download ("keep a copy") action.
  const doSaveAsDownload = useCallback(() => {
    const dataUrl = renderToDataUrl();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `spritebrew-edit-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [renderToDataUrl]);

  // beforeunload guard — fires in BOTH layouts. Wave 1 invariant: register
  // only while dirty so a clean editor session doesn't pollute navigation.
  // Keyed on the BROADER selectIsDirty so an iOS-cancelled-stroke session
  // (historyIndex unwound to 0 but hasAttemptedEdit still true) also prompts
  // on reload — same gap hasAttemptedEdit closed for the dismiss confirm.
  useEffect(() => {
    if (!isDirtyForGuard) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirtyForGuard]);

  // No gesture inside the editor may act on the page or its controls (BUILD
  // 2026-10-29). While the editor is open:
  //   - Safari's own pinch-zoom of the page is cancelled (gesturestart);
  //     every editor surface also has touch-action set below.
  //   - A tap that ends a two-finger gesture is not a tap: a second finger
  //     landing on Save, Close or a zoom preset mid-pinch would otherwise
  //     press it. Clicks are ignored from the moment a second finger lands
  //     until 400 ms after the last finger lifts.
  useEffect(() => {
    const QUIET_MS = 400;
    let multiTouch = false;
    let quietUntil = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) multiTouch = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (multiTouch && e.touches.length === 0) {
        multiTouch = false;
        quietUntil = performance.now() + QUIET_MS;
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!e.isTrusted) return;
      if (multiTouch || performance.now() < quietUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onGesture = (e: Event) => e.preventDefault();
    const passive = { capture: true, passive: true } as const;
    window.addEventListener('touchstart', onTouchStart, passive);
    window.addEventListener('touchend', onTouchEnd, passive);
    window.addEventListener('touchcancel', onTouchEnd, passive);
    window.addEventListener('click', onClick, true);
    window.addEventListener('gesturestart', onGesture, { passive: false });
    window.addEventListener('gesturechange', onGesture, { passive: false });
    return () => {
      window.removeEventListener('touchstart', onTouchStart, passive);
      window.removeEventListener('touchend', onTouchEnd, passive);
      window.removeEventListener('touchcancel', onTouchEnd, passive);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('gesturestart', onGesture);
      window.removeEventListener('gesturechange', onGesture);
    };
  }, []);

  // In-app links from the full-page editor with edits ask first (see
  // leaveAsk above).
  useEffect(() => {
    if (!guardPage) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
      const url = new URL(a.href, window.location.href);
      // Another site, or this page itself (the header's Back decides that
      // one through its own handler).
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveAsk({ kind: 'href', href: url.pathname + url.search + url.hash });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [guardPage]);

  const leaveByBack = useLeaveByBack(onDismiss, draftKey);

  const stayInEditor = useCallback(() => {
    // A Back already took the editor's history entry; put it back.
    if (leaveAsk?.kind === 'back') rearmPageGuard();
    setLeaveAsk(null);
  }, [leaveAsk, rearmPageGuard]);

  const leaveEditor = useCallback(() => {
    const ask = leaveAsk;
    setLeaveAsk(null);
    if (!ask) return;
    void closeEditorDraft(draftKey);
    // The user's Back already took the editor's own entry; this one leaves
    // the page, or goes to the landing when there is nowhere to go back to
    // (useLeaveByBack).
    if (ask.kind === 'back') leaveByBack();
    else if (ask.kind === 'href') goTo(ask.href);
    else onDismiss();
  }, [leaveAsk, draftKey, goTo, onDismiss, leaveByBack]);

  // The page header's Back: straight to the landing when there is nothing
  // to lose, else ask.
  const handlePageBack = useCallback((e: React.MouseEvent) => {
    if (selectIsDirty(useEditorStore.getState())) {
      e.preventDefault();
      setLeaveAsk({ kind: 'dismiss' });
      return;
    }
    void closeEditorDraft(draftKey);
    onDismiss();
  }, [draftKey, onDismiss]);

  // Hotkeys — same Wave 1 + Day-9 useKey/splitKey fixes.
  const cycleBrushSize = useCallback(
    (delta: number) => {
      const cur = useEditorStore.getState().brushSize;
      const idx = VALID_BRUSH_SIZES.indexOf(cur);
      const nextIdx = Math.max(0, Math.min(VALID_BRUSH_SIZES.length - 1, idx + delta));
      const next = VALID_BRUSH_SIZES[nextIdx];
      if (next !== cur) {
        setBrushSize(next);
        if (brushToastTimerRef.current) clearTimeout(brushToastTimerRef.current);
        setBrushToast(`Brush: ${next}px`);
        brushToastTimerRef.current = setTimeout(() => setBrushToast(null), 1200);
      }
    },
    [setBrushSize]
  );

  // "Clean residue": one undo step, then say how many pixels changed. The
  // overlay, when on, rescans through the pixel subscription.
  const handleCleanResidue = useCallback(() => {
    const { cleared, despilled } = cleanResidue();
    const n = cleared + despilled;
    if (brushToastTimerRef.current) clearTimeout(brushToastTimerRef.current);
    setBrushToast(`Cleaned ${n} ${n === 1 ? 'pixel' : 'pixels'}`);
    brushToastTimerRef.current = setTimeout(() => setBrushToast(null), 2000);
  }, [cleanResidue]);

  // Fix #3: scope every editor hotkey to the 'editor' scope so they don't
  // fire while a text input (e.g., the future project-name prompt or a
  // gallery search) is focused. The matching <HotkeysProvider initiallyActive
  // Scopes={['editor']}> wraps both editor mount sites (modal + page).
  // The brush keys fire on a bare key only: useKey matches a single key
  // whatever the modifiers, and Cmd or Ctrl with = + - is the zoom shortcut
  // (W2 audit r2, finding 1: each zoom step also changed the brush size).
  useHotkeys('[', (e) => { if (isBareKey(e)) cycleBrushSize(-1); }, { useKey: true, scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys(']', (e) => { if (isBareKey(e)) cycleBrushSize(+1); }, { useKey: true, scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys('-', (e) => { if (isBareKey(e)) cycleBrushSize(-1); }, { useKey: true, scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys(['=', '+'], (e) => { if (isBareKey(e)) cycleBrushSize(+1); }, { useKey: true, splitKey: '_', scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys('mod+z', (e) => { e.preventDefault(); undo(); }, { scopes: [EDITOR_HOTKEY_SCOPE] });
  useHotkeys('mod+shift+z', (e) => { e.preventDefault(); redo(); }, { scopes: [EDITOR_HOTKEY_SCOPE] });
  // Onion skin: O (Aseprite uses F3, which is the browser's Find Next).
  // Plain O only: not with a modifier (Ctrl/Cmd+O is the browser's Open) and
  // not on a held key's repeats.
  useHotkeys('o', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (onionAvailable) toggleOnion();
  }, { useKey: true, scopes: [EDITOR_HOTKEY_SCOPE] }, [onionAvailable, toggleOnion]);

  // Fix #4: cancel pending RAF + brush-toast timer on unmount. They're
  // otherwise no-ops if the component is gone (React 19 swallows setState),
  // but explicit cleanup prevents any post-unmount callbacks from firing.
  useEffect(() => {
    return () => {
      if (cursorRafRef.current !== null) {
        cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
      if (brushToastTimerRef.current !== null) {
        clearTimeout(brushToastTimerRef.current);
        brushToastTimerRef.current = null;
      }
      // A residue rescan scheduled just before the editor closed never runs.
      if (residueTimerRef.current !== null) {
        clearTimeout(residueTimerRef.current);
        residueTimerRef.current = null;
      }
      // Nor does a zoom animation's backstop (W2 audit r2, finding 9).
      if (zoomAnimTimerRef.current !== null) {
        clearTimeout(zoomAnimTimerRef.current);
        zoomAnimTimerRef.current = null;
      }
      zoomAnimRef.current?.cancel();
      zoomAnimRef.current = null;
    };
  }, []);

  // Dev-only round-trip self-test for the recovery store. Hostname-gated
  // (NODE_ENV is 'production' on dev.spritebrew.pages.dev too — Cloudflare
  // Pages builds every deployment with `next build`). Module-scope flag
  // ensures we run once per page load even across Strict Mode remounts.
  useEffect(() => {
    if (!isDevHost() || recoverySelfTestRan) return;
    recoverySelfTestRan = true;
    void devRecoverySelfTest()
      .then((pass) => console.log(`[editorRecovery] self-test: ${pass ? 'PASS' : 'FAIL'}`))
      .catch((err) => console.warn('[editorRecovery] self-test threw', err));
  }, []);


  const toolButtons: Array<{ id: Tool; icon: typeof Pencil; label: string }> = [
    { id: 'pencil', icon: Pencil, label: 'Pencil' },
    { id: 'eraser', icon: Eraser, label: 'Eraser' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  ];

  // Below one device pixel per image pixel, nearest-neighbour drops whole
  // rows and columns of 1 px art; the layers draw smoothed there (W2 audit).
  const layerRendering: 'auto' | 'pixelated' = zoom * dpr < 1 ? 'auto' : 'pixelated';

  return (
    <>
    <div
      // The whole editor takes every touch: no page scroll or pinch-zoom
      // from anywhere in it (BUILD 2026-10-29). The toolbar and the side
      // panel scroll, so they allow panning (and still no pinch-zoom).
      style={{ touchAction: 'none' }}
      className="h-full grid bg-bg-primary grid-rows-[auto_minmax(0,1fr)_auto] grid-cols-1 [grid-template-areas:'header''canvas''bottombar'] md:grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[56px_1fr_280px] md:[grid-template-areas:'header_header_header''toolbar_canvas_sidepanel']"
    >
      {/* Header */}
      <header className="[grid-area:header] flex items-center justify-between gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-3 border-b border-border-default bg-bg-primary">
        <h2 className="flex-1 min-w-0 truncate text-sm font-mono font-semibold text-text-primary">
          <span className="hidden md:inline">Pixel Editor</span>
          <span className="sr-only md:not-sr-only md:ml-2 text-text-muted font-normal">
            {frameWidth} × {frameHeight}
          </span>
        </h2>

        {layout === 'modal' ? (
          <div className="flex items-center gap-2 shrink-0">
            {/* "Keep a copy" — backs the modal header with the same
                doSaveAsDownload that page mode uses. Primary Save sitting
                between Download and X keeps the two icon buttons from
                being mistaken for each other. */}
            <button
              onClick={doSaveAsDownload}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer shrink-0 min-h-11 min-w-11 flex items-center justify-center md:min-h-0 md:min-w-0"
              aria-label="Download a copy (PNG)"
              title="Download a copy (PNG)"
            >
              <Download size={16} />
            </button>
            {/* Primary Save in the always-visible header — replaces the
                sidepanel footer Save, which lived under `hidden md:flex`
                and was inaccessible on mobile. Routes through the same
                doSaveAndDismiss path (onSave + onSaveClose ?? onDismiss),
                so the post-Save close still bypasses attemptDismiss's
                dirty re-check. */}
            <Button variant="primary" size="sm" onClick={doSaveAndDismiss}>
              <Save size={14} />
              Save
            </Button>
            <button
              onClick={onDismiss}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer shrink-0 min-h-11 min-w-11 flex items-center justify-center md:min-h-0 md:min-w-0"
              aria-label="Close editor"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/editor" onClick={handlePageBack}>
              <Button variant="ghost" size="sm">
                <ArrowLeft size={14} />
                <span className="sr-only md:not-sr-only">Back</span>
              </Button>
            </Link>
            {layout === 'page' && (
              <Button variant="secondary" size="sm" onClick={handleSendToAnimator}>
                <Film size={14} />
                Send to Animator
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={doSaveAsDownload}>
              <Save size={14} />
              <span className="md:hidden">PNG</span>
              <span className="hidden md:inline">Save (download PNG)</span>
            </Button>
          </div>
        )}
      </header>

      {/* Toolbar — vertical rail on md+ (its original placement); horizontal
          bottom bar on mobile (overflow-x scrolls if needed). Buttons grow to
          a 44×44 touch target on mobile and revert to compact sizing on md. */}
      <aside style={{ touchAction: 'pan-x pan-y' }} className="[grid-area:bottombar] flex flex-row items-center gap-2 overflow-x-auto border-t border-border-default bg-bg-secondary p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:[grid-area:toolbar] md:flex-col md:items-stretch md:overflow-x-visible md:overflow-y-auto md:[scrollbar-gutter:stable] md:border-t-0 md:border-r md:pb-2">
        {toolButtons.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTool(id)}
            title={label}
            className={`p-2 rounded cursor-pointer transition-colors min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0
              ${tool === id
                ? 'bg-accent-amber text-bg-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
          >
            <Icon size={16} />
          </button>
        ))}

        {/* Mobile-only Colors trigger — opens the slide-up sheet (color +
            palette). Shows the current color. The desktop equivalent lives
            in the sidepanel (hidden below md). */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Colors"
          title="Colors"
          className="w-11 h-11 shrink-0 rounded border border-border-default cursor-pointer md:hidden p-1"
        >
          <span className="block w-full h-full rounded-sm" style={{ backgroundColor: color }} />
        </button>

        <div className="w-full h-px bg-border-subtle my-1 hidden md:block" />

        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider text-center hidden md:block">
          Brush
        </div>
        <div className="flex gap-1 md:grid md:grid-cols-3">
          {VALID_BRUSH_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => setBrushSize(size)}
              aria-label={`Brush size ${size}px`}
              title={`Brush size ${size}px ( [ / ] )`}
              className={`h-11 w-11 shrink-0 md:h-7 md:w-auto rounded text-[10px] font-mono cursor-pointer transition-colors
                ${brushSize === size
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {size}
            </button>
          ))}
        </div>

        <div className="w-full h-px bg-border-subtle my-1 hidden md:block" />

        <button
          onClick={undo}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
        >
          <Redo2 size={16} />
        </button>
        <button
          onClick={flipHorizontal}
          title="Flip horizontally"
          aria-label="Flip horizontally"
          disabled={!hasPixels}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
        >
          <FlipHorizontal size={16} />
        </button>
        <button
          onClick={toggleShowResidue}
          title="Show residue"
          aria-label="Show residue"
          aria-pressed={showResidue}
          disabled={!hasPixels}
          className={`p-2 rounded cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0
            ${showResidue
              ? 'bg-accent-amber text-bg-primary'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
        >
          <ScanEye size={16} />
        </button>
        <button
          onClick={handleCleanResidue}
          title="Clean residue"
          aria-label="Clean residue"
          disabled={!hasPixels}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
        >
          <Sparkles size={16} />
        </button>
        {onionAvailable && (
          <button
            onClick={toggleOnion}
            title="Onion skin (O)"
            aria-label="Onion skin"
            aria-pressed={onionOn}
            className={`p-2 rounded cursor-pointer transition-colors min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0
              ${onionOn
                ? 'bg-accent-amber text-bg-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
          >
            <Layers size={16} />
          </button>
        )}

        <div className="w-full h-px bg-border-subtle my-1 hidden md:block" />

        <button
          onClick={revertToOriginal}
          title="Revert to original (undoable)"
          disabled={!isDirty}
          className="p-2 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed min-h-11 min-w-11 shrink-0 md:min-h-0 md:min-w-0"
          aria-label="Revert to original"
        >
          <History size={16} />
        </button>
      </aside>

      {/* Canvas (center) — a fixed clipping viewport. Pan is fully transform-
          based now (the wheel handler pans on plain wheel), so we drop the
          overflow-auto scroll plane. Controls float above as overlays.
          min-h-0/min-w-0 lets the grid track shrink to its assigned size —
          without these, the absolutely-positioned canvas region would create
          intrinsic min-size pressure and push the track past 1fr. */}
      <main ref={canvasAreaRef} className="[grid-area:canvas] overflow-hidden bg-bg-primary relative min-h-0 min-w-0">
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center p-8 z-20">
            <div className="max-w-md rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-semibold text-red-400 mb-1">
                  Can&apos;t open this image
                </p>
                <p className="text-[11px] font-mono text-text-secondary leading-relaxed">
                  {loadError}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={onDismiss}
                    className="text-[10px] font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer underline"
                  >
                    Go back
                  </button>
                  {/* Stage 3 corrupt-restore escape: only shown when this
                      body is mounted from a restore AND a discard callback
                      was wired through. Without it, "Go back" leads to the
                      landing banner offering the same broken draft — an
                      infinite loop with only the banner's Discard as exit. */}
                  {restore && onDiscardDraft && (
                    <button
                      onClick={onDiscardDraft}
                      className="text-[10px] font-mono text-text-muted hover:text-text-primary cursor-pointer underline"
                    >
                      Discard draft
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Zoom control (W2; George, Nov 4: "more intuitive and just apple
            product like"): one pill at the bottom of the canvas area, minus,
            the zoom as a percentage opening a menu, plus. Outside the
            pointer-capturing container below, so presses never reach the
            gesture handlers. A fitted image sits above it (FIT_PAD_BOTTOM). */}
        <div ref={zoomPillRef} className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 p-0.5 rounded-xl bg-bg-primary/90 backdrop-blur-sm border border-border-subtle">
          {/* Zoom changes are announced, as the old readout's were (W2 audit
              r2, finding 6). */}
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {`Zoom ${formatZoomPercent(zoom)}`}
          </span>
          <button
            onClick={() => zoomStep(-1)}
            title="Zoom out"
            aria-label="Zoom out"
            className="h-11 w-11 md:h-7 md:w-8 rounded-lg flex items-center justify-center text-text-primary hover:bg-bg-hover cursor-pointer"
          >
            <Minus size={14} />
          </button>
          <button
            ref={zoomTriggerRef}
            onClick={() => setZoomMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={zoomMenuOpen}
            aria-label={`Zoom options, ${formatZoomPercent(zoom)}`}
            title="Zoom options"
            className="h-11 md:h-7 min-w-[4.75rem] px-2 rounded-lg flex items-center justify-center gap-1 text-xs font-mono tabular-nums text-text-primary hover:bg-bg-hover cursor-pointer"
          >
            {formatZoomPercent(zoom)}
            <ChevronDown size={12} className="text-text-muted" />
          </button>
          <button
            onClick={() => zoomStep(1)}
            title="Zoom in"
            aria-label="Zoom in"
            className="h-11 w-11 md:h-7 md:w-8 rounded-lg flex items-center justify-center text-text-primary hover:bg-bg-hover cursor-pointer"
          >
            <Plus size={14} />
          </button>
          {zoomMenuOpen && (() => {
            const mod = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '\u2318' : 'Ctrl+';
            // Rows are 44 px on phones, like the control's buttons (W2 audit
            // r2, finding 12). A level the zoom cannot reach (below the fit)
            // is shown dimmed and does nothing (finding 11); it stays
            // focusable, as a disabled menu item does.
            const item = 'w-full flex items-center justify-between gap-6 px-2.5 min-h-11 py-2.5 md:min-h-0 md:py-1.5 rounded-md text-xs text-text-primary focus:bg-bg-hover focus:outline-none';
            const live = `${item} hover:bg-bg-hover cursor-pointer`;
            const dim = `${item} opacity-40 cursor-default`;
            const minZ = minZoomFor(fit);
            return (
              <div
                ref={zoomMenuRef}
                role="menu"
                aria-label="Zoom"
                onKeyDown={onZoomMenuKeyDown}
                className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[13rem] p-1 rounded-xl bg-bg-secondary border border-border-default shadow-lg overflow-y-auto overscroll-contain"
              >
                <button
                  role="menuitem"
                  aria-disabled={fit > 0 ? undefined : true}
                  className={fit > 0 ? live : dim}
                  onClick={() => { if (!(fit > 0)) return; zoomToFit(); closeZoomMenu(); }}
                >
                  <span>Zoom to fit</span>
                  <span className="text-text-muted font-mono">{mod}0</span>
                </button>
                <button role="menuitem" className={live} onClick={() => { zoomFromControl(1); closeZoomMenu(); }}>
                  <span>Actual size</span>
                  <span className="text-text-muted font-mono">{mod}1</span>
                </button>
                <div role="separator" className="my-1 h-px bg-border-subtle" />
                {ZOOM_MENU_LEVELS.map((level) => {
                  const on = Math.abs(zoom - level) < 1e-6;
                  const ok = zoomAllowed(level, minZ, MAX_ZOOM);
                  return (
                    <button
                      key={level}
                      role="menuitemradio"
                      aria-checked={on}
                      aria-disabled={ok ? undefined : true}
                      className={ok ? live : dim}
                      onClick={() => { if (!ok) return; zoomFromControl(level); closeZoomMenu(); }}
                    >
                      <span className="font-mono tabular-nums">{formatZoomPercent(level)}</span>
                      {on ? <Check size={12} className="text-accent-amber" /> : <span />}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>

        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerUp}
          className="absolute inset-0 flex items-center justify-center"
          style={{
            // Wave 2a touch CSS: kill browser's default touch behaviors so
            // one-finger drags hit our pointer handlers instead of scrolling
            // the page, two-finger gestures don't trigger pinch-zoom of the
            // whole page, and iOS's long-press magnifier / text-selection
            // popup don't fight with drawing.
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        >
          {/* Canvas stack — image (bottom) → grid overlay (middle) → cursor
              footprint (top). DOM order = paint order. The image canvas has
              the transparency checkerboard as its CSS background, so any
              alpha-0 region (eraser strokes, transparent project canvases)
              reveals it through the canvas — no in-canvas tile fill needed.
              The wrapper carries the pan/pinch transform (transform-origin
              0 0 — see commit contract in the layout effect). */}
          <div ref={stackRef} className="relative" style={{ transformOrigin: '0 0' }}>
            {/* Onion skin layer: under the image (the image canvas is
                positioned, so DOM order sets the paint order), carrying the
                checkerboard while it shows. Never takes input. */}
            <canvas
              ref={onionCanvasRef}
              aria-hidden="true"
              data-onion-layer=""
              className="absolute top-0 left-0 pointer-events-none"
              style={{ imageRendering: layerRendering, display: onionShown ? 'block' : 'none', ...CHECKERBOARD_STYLE }}
            />
            <canvas
              ref={editorCanvasRef}
              className="block relative"
              style={{
                imageRendering: layerRendering,
                // Eyedropper tool gets its own cursor (lucide pipette SVG,
                // hotspot at the tip 2,22). Pencil/eraser keep cursor:none
                // so the brush-footprint overlay below is the only indicator.
                cursor: tool === 'eyedropper' ? "url('/cursors/eyedropper.svg') 2 22, crosshair" : 'none',
                // Wave 1c CSS checkerboard. Fixed 16px screen tile (8px
                // squares) — intentional look change from the prior zoom-
                // scaled in-canvas fill.
                // With onion skin showing, the checkerboard is on the onion
                // layer underneath and the image is see-through.
                ...(onionShown ? { backgroundColor: 'transparent' } : CHECKERBOARD_STYLE),
              }}
            />
            {/* "Show residue" marks, over the image and under the grid. It
                never takes input (the gestures live on the container). */}
            <canvas
              ref={residueCanvasRef}
              aria-hidden="true"
              data-residue-overlay=""
              className="absolute top-0 left-0 pointer-events-none"
              style={{ imageRendering: layerRendering, display: showResidue ? 'block' : 'none' }}
            />
            <div
              ref={overlayRef}
              aria-hidden="true"
              className="absolute top-0 left-0 pointer-events-none"
            />
            <div
              aria-hidden="true"
              className="absolute pointer-events-none border border-white"
              style={{
                mixBlendMode: 'difference',
                top: 0,
                left: 0,
                width: brushSize * zoom,
                height: brushSize * zoom,
                transform: `translate(${cursorX}px, ${cursorY}px)`,
                display: cursorVisible && tool !== 'eyedropper' ? 'block' : 'none',
              }}
            />
          </div>

          {/* Brush-size toast */}
          {brushToast && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded bg-black/80 text-amber-300 text-xs font-mono pointer-events-none"
              role="status"
              aria-live="polite"
            >
              {brushToast}
            </div>
          )}
        </div>
      </main>

      {/* Sidepanel (right): color + palette + future preview. Hidden on
          mobile (palette returns as the Wave 2b-2 slide-up sheet; color is
          surfaced inline in the mobile bottom bar). */}
      <aside style={{ touchAction: 'pan-x pan-y' }} className="[grid-area:sidepanel] hidden md:flex flex-col gap-4 border-l border-border-default bg-bg-secondary overflow-y-auto [scrollbar-gutter:stable] p-3">
        {/* Current color — single styled input acts as both swatch and picker. */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Color
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-10 h-10 rounded border border-border-default cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm"
              aria-label="Foreground color"
              title="Click to pick a foreground color"
            />
            <span className="text-xs font-mono text-text-muted">Click to pick</span>
          </div>
        </div>

        {/* Palette */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            Palette
          </div>
          {palette.length === 0 ? (
            <p className="text-[11px] font-mono text-text-muted italic leading-relaxed">
              Use the color picker above — colors from your source image will appear here when you upload one.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {palette.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setColor(c);
                    setTool('pencil');
                  }}
                  className={`w-3 h-3 rounded-sm border cursor-pointer ${
                    color === c ? 'border-accent-amber ring-1 ring-accent-amber' : 'border-border-subtle'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        {/* Onion skin settings (desktop; phones use the defaults). */}
        {onionAvailable && (
          <div className="flex flex-col gap-2">
            <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
              Onion skin
            </div>
            {([
              { label: 'Back', side: 'back', value: onionBack, set: setOnionBack },
              { label: 'Ahead', side: 'ahead', value: onionAhead, set: setOnionAhead },
            ] as const).map(({ label, side, value, set }) => (
              <div key={side} className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-text-secondary">{label}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => set((v) => Math.max(0, v - 1))}
                    disabled={value <= 0}
                    aria-label={`Fewer frames ${side}`}
                    className="h-7 w-7 flex items-center justify-center rounded border border-border-subtle bg-bg-elevated text-text-secondary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Minus size={12} />
                  </button>
                  <output aria-label={`Frames ${side}`} aria-live="off" className="w-5 text-center text-[11px] font-mono text-text-primary tabular-nums">
                    {value}
                  </output>
                  <button
                    type="button"
                    onClick={() => set((v) => Math.min(ONION_MAX, v + 1))}
                    disabled={value >= ONION_MAX}
                    aria-label={`More frames ${side}`}
                    className="h-7 w-7 flex items-center justify-center rounded border border-border-subtle bg-bg-elevated text-text-secondary hover:bg-bg-hover cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
            <label className="flex items-center justify-between gap-2 text-[11px] font-mono text-text-secondary">
              <span>Opacity</span>
              <input
                type="range"
                min={10}
                max={100}
                step={10}
                value={Math.round(onionOpacity * 100)}
                onChange={(e) => setOnionOpacity(Number(e.target.value) / 100)}
                aria-label="Onion skin opacity"
                className="w-28 accent-accent-amber"
              />
              <span className="w-9 text-right tabular-nums text-text-primary">{Math.round(onionOpacity * 100)}%</span>
            </label>
          </div>
        )}

        {/* 1× preview — sidepanel placement (Phase 1.5: was below the canvas
            grid, now lives alongside the palette so it's visible without
            scrolling past the canvas). */}
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
            1× preview
          </div>
          <div
            className="border border-border-default rounded inline-block self-start"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
              backgroundSize: '4px 4px',
              backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0',
            }}
          >
            <canvas
              ref={previewCanvasRef}
              style={{ imageRendering: 'pixelated', display: 'block' }}
            />
          </div>
        </div>

        {/* Animation preview — Phase 4 */}

        {/* Save/Cancel formerly lived here; moved to the header on all widths
            so mobile (where this sidepanel is `hidden md:flex`) has a
            reachable Save. The header X serves as Cancel (routes through
            attemptDismiss → confirm). */}
      </aside>
    </div>

    {/* Mobile Colors sheet — plain inline overlay (NOT a HeadlessUI Dialog).
        In the sheet-frame flow the editor is itself a Dialog; a nested Dialog
        portals to <body>, outside the editor's panel, so the editor's outside-
        click guard fired on sheet taps (spurious unsaved-changes prompt + dead
        canvas). This overlay renders inline, stays inside the editor panel's
        DOM, and has no Dialog to collide with. Backdrop tap and Done close it;
        Escape closes it via the keydown effect. Always mounted so it can slide;
        pointer-events are gated off when closed so it never blocks the canvas,
        and md:hidden keeps it off desktop entirely. */}
    <div
      aria-hidden={!sheetOpen}
      onClick={() => setSheetOpen(false)}
      style={{ touchAction: 'none' }}
      className={`fixed inset-0 z-[105] bg-black/50 transition-opacity duration-200 md:hidden ${
        sheetOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    />
    <div
      role="dialog"
      aria-label="Colors"
      aria-hidden={!sheetOpen}
      style={{ touchAction: 'none' }}
      className={`fixed inset-x-0 bottom-0 z-[106] md:hidden flex flex-col gap-4 bg-bg-secondary border-t border-border-default rounded-t-2xl shadow-2xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] transition-transform duration-200 ease-out ${
        sheetOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none'
      }`}
    >
      {/* drag handle */}
      <div className="mx-auto h-1 w-10 rounded-full bg-border-default" />

      <div className="flex items-center justify-between">
        <span className="text-sm font-mono font-semibold text-text-primary">Colors</span>
        <button
          type="button"
          onClick={() => setSheetOpen(false)}
          className="text-xs font-mono text-accent-amber hover:text-accent-amber-strong cursor-pointer px-2 py-1"
        >
          Done
        </button>
      </div>

      {/* Custom color picker (native) */}
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Foreground color"
          className="w-12 h-12 rounded border border-border-default cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-sm"
        />
        <span className="text-xs font-mono text-text-muted">Tap to pick a custom color</span>
      </div>

      {/* Palette */}
      <div className="flex flex-col gap-2">
        <div className="text-[9px] font-mono text-text-muted uppercase tracking-wider">Palette</div>
        {palette.length === 0 ? (
          <p className="text-[11px] font-mono text-text-muted italic leading-relaxed">
            Colors from your source image appear here when you upload one.
          </p>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setColor(c); setTool('pencil'); setSheetOpen(false); }}
                className={`aspect-square w-full rounded-sm border cursor-pointer ${
                  color === c ? 'border-accent-amber ring-1 ring-accent-amber' : 'border-border-subtle'
                }`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>
    </div>
    {layout === 'page' && (
      <EditorLeaveDialog open={leaveAsk !== null} onStay={stayInEditor} onLeave={leaveEditor} />
    )}
    </>
  );
}
