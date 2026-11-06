'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import Button from '@/components/ui/Button';
import {
  alignmentSummary,
  applyAlignment,
  moveWords,
  type AlignFrame,
} from '@/lib/alignFrames';
import { frameToDataURL, imageToCanvas, loadImage } from '@/lib/spriteUtils';
import { useSpriteStore } from '@/stores/spriteStore';
import type { SpriteAnimation, SpriteFrame, SpriteSheet } from '@/lib/types';

/** The sheet's pixels after Align, or before it for Undo. */
export interface AlignedSheet {
  sourceImage: string;
  urls: Map<string, string>;
}

interface AlignFramesPanelProps {
  sheet: SpriteSheet;
  animations: SpriteAnimation[];
  frameDataUrls: Map<string, string>;
  /** Puts what `prepare` returns on the sheet it was started from; false if
   *  the sheet moved on first, or `prepare` returned null. */
  onCommit: (prepare: () => Promise<AlignedSheet | null>) => Promise<boolean>;
}

/** Group types whose frames start left out: the body leaves its feet. */
const LEFT_OUT_TYPES = ['jump', 'death', 'destroy'];
const ALL_FRAMES = 'all-frames';
const ALL_FRAMES_FPS = 8;
/** The widest a preview is drawn, in CSS pixels, at a whole scale. */
const PREVIEW_SIZE = 160;

const CHECKERBOARD = {
  backgroundImage:
    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const toImageData = (frame: AlignFrame) =>
  new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);

async function decodeFrame(url: string): Promise<AlignFrame> {
  const img = await loadImage(url);
  return imageToCanvas(img).getContext('2d')!.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
}

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
  context.putImageData(toImageData(frame), 0, 0);
}

function PreviewLoop({
  label,
  canvasRef,
  cellWidth,
  cellHeight,
  feetRow,
}: {
  label: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cellWidth: number;
  cellHeight: number;
  feetRow: number | null;
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
          aria-label={`${label} aligning, frames looping`}
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
export default function AlignFramesPanel({ sheet, animations, frameDataUrls, onCommit }: AlignFramesPanelProps) {
  const sheetVersion = useSpriteStore((s) => s.sheetVersion);
  const [decoded, setDecoded] = useState<{ urls: Map<string, string>; frames: Map<string, AlignFrame> } | null>(null);
  const [scopeId, setScopeId] = useState(ALL_FRAMES);
  // Only the user's own toggles; every other frame follows its groups.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [undo, setUndo] = useState<{
    before: AlignedSheet;
    version: number;
    urls: Map<string, string>;
  } | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const stepRef = useRef(0);
  const selectId = useId();
  const undoNoteId = useId();

  const allFrames = useMemo(() => sheet.animations.flatMap((a) => a.frames), [sheet]);
  const frameNumbers = useMemo(() => new Map(allFrames.map((f, i) => [f.id, i + 1])), [allFrames]);
  const group = animations.find((a) => a.id === scopeId && a.frames.length > 0) ?? null;
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

  const leaveOut = useMemo(
    () => scopeFrames.map((f) => toggled.get(f.id) ?? startLeftOut.has(f.id)),
    [scopeFrames, toggled, startLeftOut]
  );
  const before = useMemo(() => scopeFrames.map((f) => decoded!.frames.get(f.id)!), [scopeFrames, decoded]);
  const { frames: after, plan } = useMemo(() => applyAlignment(before, { leaveOut }), [before, leaveOut]);
  const numbers = scopeFrames.map((f) => frameNumbers.get(f.id) ?? 0);

  const ready = decoded?.urls === frameDataUrls;
  const undoOpen = undo !== null && undo.version === sheetVersion && undo.urls === frameDataUrls;
  const showsJumpsLine = groupFrames.some((f) => startLeftOut.has(f.id) && toggled.get(f.id) !== false);
  const cellWidth = Math.max(1, ...before.map((f) => f.width));
  const cellHeight = Math.max(1, ...before.map((f) => f.height));

  // Decode each frame's pixels, after a yield so the page never freezes.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const entries = await Promise.all(
          allFrames.flatMap((frame) => {
            const url = frameDataUrls.get(frame.id);
            return url ? [decodeFrame(url).then((pixels) => [frame.id, pixels] as const)] : [];
          })
        );
        if (!cancelled) setDecoded({ urls: frameDataUrls, frames: new Map(entries) });
      } catch {
        if (!cancelled) setStatus('Could not read these frames. Try slicing again.');
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allFrames, frameDataUrls]);

  // Track prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // One timer steps both loops together.
  useEffect(() => {
    const steps = before.length;
    if (steps === 0) return;
    const draw = () => {
      paint(beforeRef.current, before[stepRef.current]);
      paint(afterRef.current, after[stepRef.current]);
    };
    stepRef.current = reducedMotion ? 0 : stepRef.current % steps;
    draw();
    if (reducedMotion || steps < 2) return;
    const timer = setInterval(() => {
      stepRef.current = (stepRef.current + 1) % steps;
      draw();
    }, 1000 / Math.max(1, fps));
    return () => clearInterval(timer);
  }, [before, after, fps, reducedMotion, cellWidth, cellHeight]);

  const changeScope = useCallback((id: string) => {
    setScopeId(id);
    setStatus('');
  }, []);

  const toggleLeaveOut = useCallback((id: string, leftOut: boolean) => {
    setToggled((current) => new Map(current).set(id, !leftOut));
    setStatus('');
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
    if (!ready || plan.refused) return;
    void runPress(async () => {
      if (scopeFrames.length > 0 && leaveOut.every(Boolean)) {
        await nextTask();
        return 'Every frame is left out, so nothing moved.';
      }
      const moved = scopeFrames.flatMap((frame, i) => {
        const { dx, dy } = plan.moves[i];
        return dx !== 0 || dy !== 0 ? [{ frame, pixels: after[i] }] : [];
      });
      if (moved.length === 0) {
        await nextTask();
        return alignmentSummary(plan, numbers);
      }
      const applied = await onCommit(async () => {
        await nextTask();
        const built = await buildAlignedSheet(sheet, moved, frameDataUrls);
        return stillCurrent() ? built : null;
      });
      if (!applied) return 'The sheet changed, so nothing moved. Press Align again.';
      const now = useSpriteStore.getState();
      setUndo({
        before: { sourceImage: sheet.sourceImage, urls: frameDataUrls },
        version: now.sheetVersion,
        urls: now.frameDataUrls,
      });
      return alignmentSummary(plan, numbers);
    });
  }, [ready, plan, scopeFrames, leaveOut, after, numbers, sheet, frameDataUrls, onCommit, runPress, stillCurrent]);

  const handleUndo = useCallback(() => {
    if (!undo || !undoOpen) return;
    void runPress(async () => {
      const applied = await onCommit(async () => {
        await nextTask();
        return stillCurrent() ? undo.before : null;
      });
      if (!applied) return 'Undo is no longer available: the sheet changed.';
      setUndo(null);
      return 'Align undone.';
    });
  }, [undo, undoOpen, onCommit, runPress, stillCurrent]);

  return (
    <div className="space-y-4">
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

      {showsJumpsLine && (
        <p className="text-xs font-mono text-text-secondary">
          Jumps and falls are left out: aligning their feet would flatten them.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 max-w-md">
        <PreviewLoop label="Before" canvasRef={beforeRef} cellWidth={cellWidth} cellHeight={cellHeight} feetRow={plan.target?.feetRow ?? null} />
        <PreviewLoop label="After" canvasRef={afterRef} cellWidth={cellWidth} cellHeight={cellHeight} feetRow={plan.target?.feetRow ?? null} />
      </div>

      <ul className="max-h-64 overflow-y-auto divide-y divide-border-subtle">
        {scopeFrames.map((frame, i) => {
          const leftOut = leaveOut[i];
          return (
            <li key={frame.id} className="flex items-center gap-3 py-1 text-xs font-mono">
              <span className="w-20 flex-shrink-0 text-text-secondary">Frame {numbers[i]}</span>
              <span className="flex-1 min-w-0 text-text-muted">{moveWords(plan.moves[i])}</span>
              <Button
                variant={leftOut ? 'primary' : 'ghost'}
                size="sm"
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

      <div className="flex flex-wrap items-center gap-3">
        {!plan.refused && (
          <Button
            size="sm"
            aria-disabled={busy || !ready || undefined}
            aria-busy={busy || undefined}
            onClick={handleAlign}
          >
            Align
          </Button>
        )}
        {undo && (
          <Button
            variant="secondary"
            size="sm"
            disabled={!undoOpen}
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

      {/* Always rendered, so each result is announced once. */}
      <p role="status" className="text-xs font-mono text-text-secondary min-h-4">
        {plan.refused ? alignmentSummary(plan, numbers) : status}
      </p>
    </div>
  );
}
