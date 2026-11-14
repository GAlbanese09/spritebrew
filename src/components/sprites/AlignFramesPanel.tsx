'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Info } from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  alignmentSummary,
  measureFrame,
  moveWords,
  planAlignment,
  heldWords,
  shiftFrame,
  solidBackground,
  walkLike,
  fillsCell,
  type AlignAnchor,
  type AlignFrame,
  type AlignParts,
  type BodyMeasure,
  type FrameMove,
} from '@/lib/alignFrames';
import { frameToDataURL, imageToCanvas, loadImage } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteAnimation, SpriteFrame, SpriteSheet } from '@/lib/types';

/** The sheet's pixels after Align, or before it for Undo. */
export interface AlignedSheet {
  sourceImage: string;
  urls: Map<string, string>;
}

/** The frames as read, each measured once, for the frame map they came from. */
type Decoded = {
  urls: Map<string, string>;
  frames: Map<string, AlignFrame>;
  measured: Map<string, BodyMeasure | null>;
};

interface AlignFramesPanelProps {
  sheet: SpriteSheet;
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;
  /** Puts what `prepare` returns on the sheet it was started from; false if
   *  the sheet moved on first, or `prepare` returned null. */
  onCommit: (prepare: () => Promise<AlignedSheet | null>) => Promise<boolean>;
  /** Brings back the page's background banner, for the opaque refusal. */
  onRemoveBackground?: () => void;
}

/** Group types whose frames start left out: the body leaves its feet. */
const LEFT_OUT_TYPES = ['jump', 'death', 'destroy'];
/** A walk or a run moves its legs on purpose: these are centered from the
 *  head and torso, not the legs (HQ room 2026-11-11-098, 2026-11-14-053). */
const WALK_TYPES = ['walk', 'run'];
/** The type of a group nobody labelled; frames in no group count as this. */
const UNLABELLED = 'custom';
/** The note and its button when a part of the plan would make the head move
 *  more than it does now, by the part that is left out to start. */
const WORSE_WORDS: Record<Exclude<AlignParts, 'both'>, { before: string; go: string; after: string; back: string }> = {
  sideways: {
    before: 'Feet left as drawn: lining them up would make the head bob more.',
    go: 'Line up feet anyway',
    after: 'Feet lined up. The head will bob more than before.',
    back: 'Leave feet as drawn',
  },
  height: {
    before: 'Not centered: centering would make the head sway more.',
    go: 'Center anyway',
    after: 'Centered. The head will sway more than before.',
    back: "Don't center",
  },
  none: {
    before: 'Left as drawn: aligning would make the head move more.',
    go: 'Align anyway',
    after: 'Aligned. The head will move more than before.',
    back: 'Leave as drawn',
  },
};
/** When a walk's or a run's centering is held only because its head could
 *  not be tracked: nothing measured says centering would make it sway, so
 *  the note says "might" (DESIGN 2026-11-14-156). The buttons are case 2's. */
const UNSURE_WORDS = {
  ...WORSE_WORDS.height,
  before: 'Not centered: the head could not be tracked, so centering might make it sway more.',
  after: 'Centered. The head may sway more than before.',
};
const ALL_FRAMES = 'all-frames';
const ALL_FRAMES_FPS = 8;
/** The widest a preview is drawn, in CSS pixels, at a whole scale. */
const PREVIEW_SIZE = 160;
/** Dims a button that cannot act yet but keeps its focus (no native disabled). */
const DIMMED = 'aria-disabled:opacity-40 aria-disabled:cursor-not-allowed';
/** Every button in the card is 44 px tall on touch, at any width: the small
 *  size drops its touch floor from 768 px up. */
const TOUCH = 'pointer-coarse:min-h-11';

const CHECKERBOARD = {
  backgroundImage:
    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const toImageData = (frame: AlignFrame) =>
  new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);

/** Each frame's ImageData for the previews, built once per frame. */
const images = new WeakMap<AlignFrame, ImageData>();
function imageOf(frame: AlignFrame): ImageData {
  let image = images.get(frame);
  if (!image) {
    image = toImageData(frame);
    images.set(frame, image);
  }
  return image;
}

/** Each frame's last shifted copy, kept until the frame or its move changes,
 *  so a frame is shifted only when it is about to be drawn or committed. */
const shifts = new WeakMap<AlignFrame, { dx: number; dy: number; frame: AlignFrame }>();
function shiftedOnce(frame: AlignFrame, move: FrameMove): AlignFrame {
  const kept = shifts.get(frame);
  if (kept && kept.dx === move.dx && kept.dy === move.dy) return kept.frame;
  const moved = shiftFrame(frame, move);
  shifts.set(frame, { dx: move.dx, dy: move.dy, frame: moved });
  return moved;
}

const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((value, i) => value === b[i]);

async function decodeFrame(url: string): Promise<AlignFrame> {
  const img = await loadImage(url);
  return imageToCanvas(img).getContext('2d')!.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
}

/** Each frame's feet and center, so a scope or Leave out change measures nothing. */
const measureAll = (frames: Map<string, AlignFrame>) =>
  new Map([...frames].map(([id, frame]) => [id, measureFrame(frame)] as const));

/** The sheet's source image with each moved frame put back at its rect, and
 *  each moved frame's new data URL. */
async function buildAlignedSheet(
  sheet: SpriteSheet,
  moved: { frame: SpriteFrame; pixels: AlignFrame }[],
  frameDataUrls: Map<string, string>
): Promise<AlignedSheet> {
  const sheetCanvas = imageToCanvas(await loadImage(sheet.sourceImage));
  const sheetContext = sheetCanvas.getContext('2d')!;
  const cell = document.createElement('canvas');
  const urls = new Map(frameDataUrls);
  for (const { frame, pixels } of moved) {
    const image = toImageData(pixels);
    cell.width = pixels.width;
    cell.height = pixels.height;
    cell.getContext('2d')!.putImageData(image, 0, 0);
    urls.set(frame.id, frameToDataURL(cell));
    // An auto-detected frame can be padded or scaled, so its pixels are not
    // the size of its rect and would land on its neighbors. Its data URL is
    // what plays and exports; only the rect-sized frames go back on the sheet.
    if (pixels.width === frame.width && pixels.height === frame.height) {
      sheetContext.putImageData(image, frame.x, frame.y);
    }
  }
  return { sourceImage: frameToDataURL(sheetCanvas), urls };
}

function paint(canvas: HTMLCanvasElement | null, frame: AlignFrame | undefined) {
  const context = canvas?.getContext('2d');
  if (!canvas || !context || !frame) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.putImageData(imageOf(frame), 0, 0);
}

function PreviewLoop({
  label,
  canvasRef,
  cellWidth,
  cellHeight,
  feetRow,
  looping,
}: {
  label: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cellWidth: number;
  cellHeight: number;
  feetRow: number | null;
  looping: boolean;
}) {
  const scale = Math.max(1, Math.floor(PREVIEW_SIZE / Math.max(cellWidth, cellHeight)));
  return (
    <div className="min-w-0 text-center">
      <p className="text-[10px] font-mono text-text-muted mb-1 uppercase tracking-wider">{label}</p>
      <div
        className="relative mx-auto rounded border border-border-subtle overflow-hidden"
        style={{ ...CHECKERBOARD, width: cellWidth * scale, maxWidth: '100%', aspectRatio: `${cellWidth} / ${cellHeight}` }}
      >
        <canvas
          ref={canvasRef}
          width={cellWidth}
          height={cellHeight}
          role="img"
          aria-label={looping ? `${label} aligning, frames looping` : `${label} aligning`}
          className="block w-full h-full pixel-art-render"
          style={{ imageRendering: 'pixelated' }}
        />
        {feetRow !== null && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 h-px bg-accent-amber/40"
            style={{ bottom: `${((cellHeight - feetRow - 1) / cellHeight) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The "Align frames" card on /upload. The preview never changes the sheet;
 * Align and Undo go through the page's commit. A pixel edit in the frame grid
 * does not move sheetVersion, so the frame map is compared as well.
 */
export default function AlignFramesPanel({
  sheet,
  animations,
  frameDataUrls,
  onCommit,
  onRemoveBackground,
}: AlignFramesPanelProps) {
  const sheetVersion = useSpriteStore((s) => s.sheetVersion);
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  // True from the moment a decode starts until it ends. The card mounts to
  // read its frames; its own Align or Undo is never read again.
  const [reading, setReading] = useState(true);
  // The frame map the card's own Align or Undo is committing: it already
  // holds those pixels, so the decode skips it.
  const committedRef = useRef<Map<string, string> | null>(null);
  const [scopeId, setScopeId] = useState(ALL_FRAMES);
  // Only the user's own toggles; every other frame follows its groups.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [undo, setUndo] = useState<{
    before: AlignedSheet;
    decoded: Decoded;
    version: number;
    urls: Map<string, string>;
  } | null>(null);
  // What the last Align did, shown until the scope, its frames, a Leave out
  // or the sheet changes, or Undo runs.
  const [result, setResult] = useState<{
    version: number;
    urls: Map<string, string>;
    ids: string[];
    leaveOut: boolean[];
    before: AlignFrame[];
    after: AlignFrame[];
    moves: Map<string, FrameMove>;
    filled: Set<string>;
    feetRow: number | null;
  } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  // Frames are read once the card first comes into view.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  // The frame both previews show under reduced motion.
  const [still, setStill] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const alignRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const stepRef = useRef(0);
  const selectId = useId();
  const undoNoteId = useId();
  const groupsLabelId = useId();
  const worseNoteId = useId();

  const allFrames = useMemo(() => sheet.animations.flatMap((a) => a.frames), [sheet]);
  const frameNumbers = useMemo(() => new Map(allFrames.map((f, i) => [f.id, i + 1])), [allFrames]);
  const groups = useMemo(() => animations.filter((a) => a.frames.length > 0), [animations]);
  const group = groups.find((a) => a.id === scopeId) ?? null;
  const groupFrames = group?.frames ?? allFrames;
  const fps = group?.fps ?? ALL_FRAMES_FPS;

  const startLeftOut = useMemo(
    () => new Set(
      animations.filter((a) => LEFT_OUT_TYPES.includes(a.type)).flatMap((a) => a.frames.map((f) => f.id))
    ),
    [animations]
  );

  // A group can hold a frame twice; a frame moves once.
  const scopeFrames = useMemo(() => {
    const seen = new Map<string, SpriteFrame>();
    for (const frame of groupFrames) if (decoded?.frames.has(frame.id)) seen.set(frame.id, frame);
    return [...seen.values()];
  }, [groupFrames, decoded]);

  const isLeftOut = useCallback((id: string) => toggled.get(id) ?? startLeftOut.has(id), [toggled, startLeftOut]);
  const leaveOut = useMemo(() => scopeFrames.map((f) => isLeftOut(f.id)), [scopeFrames, isLeftOut]);
  const current = useMemo(() => scopeFrames.map((f) => decoded!.frames.get(f.id)!), [scopeFrames, decoded]);
  const measured = useMemo(() => scopeFrames.map((f) => decoded!.measured.get(f.id) ?? null), [scopeFrames, decoded]);
  // Which animation each frame plays in (the scope's own group, else the
  // first group that holds it, else -1), and where each is centered from: a
  // Walk or a Run from its head and torso; frames nobody labelled by their
  // own shape (walkLike); every other type from its legs.
  const { anchors, plays } = useMemo(() => {
    const first = new Map<string, number>();
    groups.forEach((g, index) => g.frames.forEach((f) => { if (!first.has(f.id)) first.set(f.id, index); }));
    const scopeIndex = group ? groups.indexOf(group) : -1;
    const plays = scopeFrames.map((f) => (group ? scopeIndex : first.get(f.id) ?? -1));
    const typeOf = (index: number) => (index >= 0 ? groups[index].type : UNLABELLED);
    const byShape = new Map<number, boolean>();
    for (const index of new Set(plays)) {
      if (typeOf(index) !== UNLABELLED) continue;
      // A frame that fills its cell gets no move, so it does not steer the
      // shape either.
      byShape.set(index, walkLike(measured.filter((_, i) => plays[i] === index && !leaveOut[i] && !fillsCell(current[i]))));
    }
    const anchors: AlignAnchor[] = plays.map((index) =>
      (WALK_TYPES.includes(typeOf(index)) || byShape.get(index) ? 'upper' : 'legs'));
    return { anchors, plays };
  }, [groups, group, scopeFrames, measured, leaveOut, current]);
  // Only a plan: the After preview shifts each frame when it draws it. The
  // whole plan first; a part of it that would make the head move more than it
  // does now is left out until the person asks for it.
  const fullPlan = useMemo(
    () => planAlignment(current, { leaveOut, measured, anchors, groups: plays, holdUntracked: true }),
    [current, leaveOut, measured, anchors, plays]
  );
  const parts: AlignParts = fullPlan.worse.sideways && fullPlan.worse.height ? 'none'
    : fullPlan.worse.height ? 'sideways' : fullPlan.worse.sideways ? 'height' : 'both';
  // "Anyway" holds for the plan it was pressed on: a new scope, a Leave out
  // or new pixels make a new plan, and the part is left out again.
  const [anywayFor, setAnywayFor] = useState<object | null>(null);
  const anyway = anywayFor === fullPlan;
  // "Anyway" aligns the whole plan, with any animation whose head could not
  // be tracked centered too.
  const plan = useMemo(
    () => (anyway ? (fullPlan.unsure ? planAlignment(current, { leaveOut, measured, anchors, groups: plays }) : fullPlan)
      : parts === 'both' ? fullPlan
      : planAlignment(current, { leaveOut, measured, anchors, groups: plays, parts, holdUntracked: true })),
    [parts, anyway, fullPlan, current, leaveOut, measured, anchors, plays]
  );
  // A held walk beside animations that are aligned is named by its group (the
  // chips' names), so the note does not read as the whole scope; one
  // animation in the scope, every one held, or one in no group: the line
  // as it was (DESIGN 2026-11-14-220).
  const heldNames = useMemo(() => {
    const playing = new Set(plays.filter((_, i) => !leaveOut[i]));
    const held = fullPlan.heldGroups;
    return held.length === 0 || held.length >= playing.size || held.some((index) => index < 0) ? null
      : held.map((index) => groups[index].name);
  }, [fullPlan, plays, leaveOut, groups]);
  // A measured reason is named first; a held centering alone says "might".
  const worseWords = fullPlan.refused ? null
    : parts !== 'both' ? WORSE_WORDS[parts]
    : fullPlan.unsure ? (heldNames ? { ...UNSURE_WORDS, ...heldWords(heldNames) } : UNSURE_WORDS) : null;
  // Nothing is selected: Align has nothing to do until the person asks for
  // the whole plan.
  const nothingKept = parts === 'none' && !anyway;
  const numbers = scopeFrames.map((f) => frameNumbers.get(f.id) ?? 0);
  const scopeIds = useMemo(() => scopeFrames.map((f) => f.id), [scopeFrames]);
  const plannedFilled = useMemo(() => new Set(plan.filled.map((i) => scopeIds[i])), [plan, scopeIds]);
  const solid = useMemo(
    () => plan.refused === 'opaque' && solidBackground(current.filter((_, i) => !leaveOut[i])),
    [plan, current, leaveOut]
  );

  const undoOpen = undo !== null && undo.version === sheetVersion && undo.urls === frameDataUrls;
  const shown = result !== null && result.version === sheetVersion && result.urls === frameDataUrls
    && sameList(result.ids, scopeIds) && sameList(result.leaveOut, leaveOut) ? result : null;
  const filledIds = shown?.filled ?? plannedFilled;
  // The previews: after Align, the frames as they were and as aligned.
  const before = shown?.before ?? current;
  const afterAt = useCallback(
    (i: number) => (shown ? shown.after[i] : current[i] && shiftedOnce(current[i], plan.moves[i])),
    [shown, current, plan]
  );
  const feetRow = shown ? shown.feetRow : plan.target?.feetRow ?? null;
  const showsJumpsLine = !plan.refused
    && groupFrames.some((f) => startLeftOut.has(f.id) && toggled.get(f.id) !== false);
  const cellWidth = Math.max(1, ...before.map((f) => f.width));
  const cellHeight = Math.max(1, ...before.map((f) => f.height));
  const stillStep = before.length > 0 ? still % before.length : 0;
  const looping = !reducedMotion && before.length > 1;
  // A press's result wins over the standing lines, so "Align undone." shows.
  // Steady frames say so without a press (HQ room 2026-11-11-098, point 1).
  const line = status || (reading ? 'Reading frames...' : plan.refused || plan.steady ? alignmentSummary(plan, numbers) : '');
  // Only a solid background is one the page's banner can remove.
  const offersRemoveBackground = !status && !reading && plan.refused === 'opaque' && solid && !!onRemoveBackground;

  // Wait for the card to come into view before reading any frame.
  useEffect(() => {
    const card = cardRef.current;
    if (seen || !card) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, [seen]);

  // Decode each frame's pixels, after a yield so the page never freezes.
  useEffect(() => {
    if (!seen) return;
    if (committedRef.current === frameDataUrls) {
      committedRef.current = null;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setReading(true);
      try {
        const entries = await Promise.all(
          allFrames.flatMap((frame) => {
            const url = frameDataUrls.get(frame.id);
            return url ? [decodeFrame(url).then((pixels) => [frame.id, pixels] as const)] : [];
          })
        );
        if (cancelled) return;
        const frames = new Map(entries);
        setDecoded({ urls: frameDataUrls, frames, measured: measureAll(frames) });
      } catch {
        if (!cancelled) setStatus('Could not read these frames. Try slicing again.');
      } finally {
        if (!cancelled) setReading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allFrames, frameDataUrls, seen]);

  // Track prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // One timer steps both loops together. Under reduced motion nothing loops:
  // Previous frame and Next frame step both previews instead.
  useEffect(() => {
    const steps = before.length;
    if (steps === 0) return;
    const draw = () => {
      paint(beforeRef.current, before[stepRef.current]);
      paint(afterRef.current, afterAt(stepRef.current));
    };
    stepRef.current = reducedMotion ? stillStep : stepRef.current % steps;
    draw();
    if (reducedMotion || steps < 2) return;
    const timer = setInterval(() => {
      stepRef.current = (stepRef.current + 1) % steps;
      draw();
    }, 1000 / Math.max(1, fps));
    return () => clearInterval(timer);
  }, [before, afterAt, fps, reducedMotion, stillStep, cellWidth, cellHeight]);

  const changeScope = useCallback((id: string) => {
    setScopeId(id);
    setStatus('');
    setResult(null);
  }, []);

  const toggleLeaveOut = useCallback((id: string, leftOut: boolean) => {
    setToggled((current) => new Map(current).set(id, !leftOut));
    setStatus('');
    setResult(null);
  }, []);

  /** Leaves out every frame of a group, or brings them all back. */
  const toggleGroup = useCallback((frames: SpriteFrame[], leftOut: boolean) => {
    setToggled((current) => {
      const next = new Map(current);
      for (const frame of frames) next.set(frame.id, !leftOut);
      return next;
    });
    setStatus('');
    setResult(null);
  }, []);

  /** Runs one press of Align or Undo. A press while one runs does nothing.
   *  The status clears first, so the same result is announced again. */
  const runPress = useCallback(async (press: () => Promise<string>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus('');
    try {
      setStatus(await press());
    } catch {
      setStatus('Could not align these frames. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  /** False when a pixel edit landed since the press: the version guard does
   *  not see those. */
  const stillCurrent = useCallback(
    () => useSpriteStore.getState().frameDataUrls === frameDataUrls,
    [frameDataUrls]
  );

  const handleAlign = useCallback(() => {
    // A frame map the card has not read yet waits for its decode.
    if (reading || decoded?.urls !== frameDataUrls || plan.refused || nothingKept) return;
    void runPress(async () => {
      if (scopeFrames.length > 0 && leaveOut.every(Boolean)) {
        await nextTask();
        return 'Every frame is left out, so nothing moved.';
      }
      const after = current.map((frame, i) => shiftedOnce(frame, plan.moves[i]));
      const moved = scopeFrames.flatMap((frame, i) => {
        const { dx, dy } = plan.moves[i];
        return dx !== 0 || dy !== 0 ? [{ frame, pixels: after[i] }] : [];
      });
      if (moved.length === 0) {
        await nextTask();
        return alignmentSummary(plan, numbers);
      }
      let committed = frameDataUrls;
      const applied = await onCommit(async () => {
        await nextTask();
        const built = await buildAlignedSheet(sheet, moved, frameDataUrls);
        committed = built.urls;
        committedRef.current = built.urls;
        return stillCurrent() ? built : null;
      });
      if (!applied) {
        committedRef.current = null;
        return 'The sheet changed, so nothing moved. Press Align again.';
      }
      const now = useSpriteStore.getState();
      const earlier = decoded!;
      // The card keeps the pixels it committed, so nothing is read again.
      const frames = new Map(earlier.frames);
      const bodies = new Map(earlier.measured);
      for (const { frame, pixels } of moved) {
        frames.set(frame.id, pixels);
        bodies.set(frame.id, measureFrame(pixels));
      }
      setDecoded({ urls: committed, frames, measured: bodies });
      // Undo and the applied view are for the Map the card committed. If the
      // store holds another by now, neither is recorded.
      if (now.frameDataUrls === committed) {
        setUndo({
          before: { sourceImage: sheet.sourceImage, urls: frameDataUrls },
          decoded: earlier,
          version: now.sheetVersion,
          urls: committed,
        });
        setResult({
          version: now.sheetVersion,
          urls: committed,
          ids: scopeIds,
          leaveOut,
          before: current,
          after,
          moves: new Map(scopeFrames.map((frame, i) => [frame.id, plan.moves[i]])),
          filled: plannedFilled,
          feetRow: plan.target?.feetRow ?? null,
        });
      }
      return alignmentSummary(plan, numbers);
    });
  }, [reading, plan, nothingKept, scopeFrames, scopeIds, plannedFilled, leaveOut, current, decoded, numbers, sheet, frameDataUrls, onCommit, runPress, stillCurrent]);

  const handleUndo = useCallback(() => {
    if (!undo || !undoOpen) return;
    void runPress(async () => {
      const applied = await onCommit(async () => {
        await nextTask();
        committedRef.current = undo.before.urls;
        return stillCurrent() ? undo.before : null;
      });
      if (!applied) {
        committedRef.current = null;
        return 'Undo is no longer available: the sheet changed.';
      }
      // Focus moves before Undo goes, so it never drops to the page. Align is
      // not there when this scope is refused; the scope picker is.
      (alignRef.current ?? selectRef.current)?.focus();
      setUndo(null);
      setResult(null);
      // The earlier pixels, as they were read, so nothing is read again.
      setDecoded(undo.decoded);
      return 'Align undone.';
    });
  }, [undo, undoOpen, onCommit, runPress, stillCurrent]);

  return (
    <div ref={cardRef} className="space-y-4">
      <div>
        <h2 className="text-xs font-mono text-text-secondary uppercase tracking-wider mb-1">Align frames</h2>
        <p className="text-xs font-mono text-text-muted">
          Puts every frame&apos;s feet on one line and centers the character, so the animation stops drifting.
        </p>
      </div>

      <div>
        <label htmlFor={selectId} className="block text-[10px] font-mono text-text-muted mb-1 uppercase tracking-wider">
          Frames to align
        </label>
        <select
          ref={selectRef}
          id={selectId}
          value={group?.id ?? ALL_FRAMES}
          onChange={(e) => changeScope(e.target.value)}
          className="w-full max-w-xs min-h-11 md:min-h-0 rounded bg-bg-elevated border border-border-default px-3 py-2
            text-sm font-mono text-text-primary focus:outline-none focus:border-accent-amber cursor-pointer"
        >
          <option value={ALL_FRAMES}>All frames</option>
          {animations.filter((a) => a.frames.length > 0).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {!plan.refused && !group && groups.length >= 2 && (
        <div role="group" aria-labelledby={groupsLabelId} className="flex flex-wrap items-center gap-2">
          <span id={groupsLabelId} className="text-[10px] font-mono text-text-muted uppercase tracking-wider">
            Leave out a group:
          </span>
          {groups.map((g) => {
            const leftOut = g.frames.every((f) => isLeftOut(f.id));
            return (
              <Button
                key={g.id}
                variant={leftOut ? 'primary' : 'ghost'}
                size="sm"
                className={TOUCH}
                aria-pressed={leftOut}
                onClick={() => toggleGroup(g.frames, leftOut)}
              >
                {g.name}
              </Button>
            );
          })}
        </div>
      )}

      {showsJumpsLine && (
        <p className="text-xs font-mono text-text-secondary">
          Jumps and falls are left out: aligning their feet would flatten them.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 max-w-md">
        <PreviewLoop label="Before" canvasRef={beforeRef} cellWidth={cellWidth} cellHeight={cellHeight} feetRow={feetRow} looping={looping} />
        <PreviewLoop label="After" canvasRef={afterRef} cellWidth={cellWidth} cellHeight={cellHeight} feetRow={feetRow} looping={looping} />
      </div>

      {reducedMotion && before.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" className={TOUCH} onClick={() => setStill((stillStep + before.length - 1) % before.length)}>
            Previous frame
          </Button>
          <p aria-live="polite" className="text-xs font-mono text-text-secondary">
            Frame {stillStep + 1} of {before.length}
          </p>
          <Button variant="secondary" size="sm" className={TOUCH} onClick={() => setStill((stillStep + 1) % before.length)}>
            Next frame
          </Button>
        </div>
      )}

      {!plan.refused && (
        <ul className="max-h-64 overflow-y-auto divide-y divide-border-subtle">
          {scopeFrames.map((frame, i) => {
            const leftOut = leaveOut[i];
            return (
              <li key={frame.id} className="flex items-center gap-3 py-1 text-xs font-mono">
                <span className="w-20 flex-shrink-0 text-text-secondary">Frame {numbers[i]}</span>
                <span className="flex-1 min-w-0 text-text-muted">
                  {filledIds.has(frame.id) ? 'Fills its cell' : moveWords(shown?.moves.get(frame.id) ?? plan.moves[i])}
                </span>
                <Button
                  variant={leftOut ? 'primary' : 'ghost'}
                  size="sm"
                  className={TOUCH}
                  aria-pressed={leftOut}
                  aria-label={`Leave out frame ${numbers[i]}`}
                  onClick={() => toggleLeaveOut(frame.id, leftOut)}
                >
                  Leave out
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {/* A part of the plan that would make the head move more than it does
          now is left out to start: the note says which and why, and the
          button puts it back, and takes it out again. Said once when it
          appears or changes. */}
      {/* The status region is always in the page and only its words change,
          so a screen reader hears the note when it arrives (a region added
          together with its text often is not announced). With no note the
          wrapper takes no box, so the card keeps its spacing. */}
      <div className={worseWords && !reading ? 'space-y-1.5' : 'contents'}>
        <p
          id={worseNoteId}
          role="status"
          className={worseWords && !reading ? 'flex items-start gap-1.5 text-[13px] font-mono text-text-secondary' : undefined}
        >
          {worseWords && !reading && (
            <>
              <Info size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
              {/* Both notes share one cell, so the swap never changes the
                  height: the one not shown is invisible and not read. */}
              <span className="grid">
                <span className="col-start-1 row-start-1">{anyway ? worseWords.after : worseWords.before}</span>
                <span aria-hidden="true" className="col-start-1 row-start-1 invisible">
                  {anyway ? worseWords.before : worseWords.after}
                </span>
              </span>
            </>
          )}
        </p>
        {worseWords && !reading && (
          <Button
            variant="secondary"
            size="sm"
            className={TOUCH}
            onClick={() => {
              // The rows and the After preview must show what Align will
              // do now: an earlier Align's result no longer does.
              setAnywayFor(anyway ? null : fullPlan);
              setStatus('');
              setResult(null);
            }}
          >
            {anyway ? worseWords.back : worseWords.go}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!plan.refused && (
          <Button
            ref={alignRef}
            size="sm"
            className={`${DIMMED} ${TOUCH}`}
            aria-disabled={busy || reading || nothingKept || undefined}
            aria-describedby={nothingKept ? worseNoteId : undefined}
            aria-busy={busy || undefined}
            onClick={handleAlign}
          >
            Align
          </Button>
        )}
        {/* Stale Undo stays focusable: aria-disabled, and the press does nothing. */}
        {undo && (
          <Button
            variant="secondary"
            size="sm"
            className={`${DIMMED} ${TOUCH}`}
            aria-disabled={busy || !undoOpen || undefined}
            aria-busy={busy || undefined}
            aria-describedby={undoOpen ? undefined : undoNoteId}
            onClick={handleUndo}
          >
            Undo align
          </Button>
        )}
        {undo && !undoOpen && (
          <p id={undoNoteId} className="text-xs font-mono text-text-muted">
            Undo is no longer available: the sheet changed.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Always rendered, so each result is announced once. */}
        <p role="status" className="text-xs font-mono text-text-secondary min-h-4">
          {line}
        </p>
        {offersRemoveBackground && (
          <Button variant="secondary" size="sm" className={TOUCH} onClick={onRemoveBackground}>
            Remove background
          </Button>
        )}
      </div>
    </div>
  );
}
