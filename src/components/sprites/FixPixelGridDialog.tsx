'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { GripVertical } from 'lucide-react';
import Button from '@/components/ui/Button';
import { layerRendering } from '@/lib/editorZoom';
import {
  FIX_GRID_AFTER,
  FIX_GRID_BEFORE,
  FIX_GRID_CANCEL,
  FIX_GRID_DIVIDER_NAME,
  FIX_GRID_LABEL,
  FIX_GRID_MAY_BE_WRONG,
  FIX_GRID_USE,
  fixGridDividerValue,
  fixGridSizes,
} from '@/lib/pixelGrid';

export interface FixGridCompare {
  beforeUrl: string;
  afterUrl: string;
  inW: number;
  inH: number;
  outW: number;
  outH: number;
  /** The guard refused this result and the person asked to see it anyway. */
  refused?: boolean;
}

/** The dialog's title, line and buttons, in rem: what the compare view must
 *  leave room for so the whole dialog fits the screen. */
const DIALOG_CHROME_REM = 11;

/** And the line under the title on a refused result, two lines on a phone. */
const DIALOG_NOTE_REM = 3;

/** How far one arrow key moves the divider, in percent. */
const ARROW_STEP = 5;

/** A corner label fades once the divider is about to cover it. */
const LABEL_FADE_AT = 12;

const MOVE_CLASS = 'transition duration-[160ms] ease-out motion-reduce:transition-none';

/** The divider and the after layer ease on the arrow keys. Tailwind's plain
 *  `transition` names neither of the properties they move by, and a drag
 *  follows the pointer with no easing at all. */
const EASE_LEFT_CLASS = 'transition-[left] duration-[160ms] ease-out motion-reduce:transition-none';
const EASE_CLIP_CLASS = 'transition-[clip-path] duration-[160ms] ease-out motion-reduce:transition-none';

/** Both images at the same size on screen, split by a divider that follows a
 *  drag or a finger and moves with the arrow keys. */
function CompareView({ compare, checkerboard }: { compare: FixGridCompare; checkerboard: CSSProperties }) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  // The box's width and the screen's density, for the editor's own rule on
  // when a layer draws smoothed. Measured before the first paint, and by
  // layout width: the dialog's scale-in does not count.
  const [view, setView] = useState({ width: 0, dpr: 1 });
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setView({ width: box.clientWidth, dpr: window.devicePixelRatio || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // On a touch screen HeadlessUI leaves focus on the dialog itself, so that
  // no keyboard opens over a text field. The divider is no text field, so it
  // takes focus there too, as it does from a keyboard: a frame after the
  // dialog has placed its own, which comes after this view's effects.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const slider = sliderRef.current;
      const active = document.activeElement;
      if (slider && active instanceof HTMLElement && active !== slider && active.getAttribute('role') === 'dialog' && active.contains(slider)) {
        slider.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const moveTo = useCallback((clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setSplit(Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100)));
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    // Focus stays on the divider through a drag, so the arrow keys go on
    // working and no key falls through to the editor behind the dialog.
    e.preventDefault();
    sliderRef.current?.focus({ preventScroll: true });
    setDragging(true);
    moveTo(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) moveTo(e.clientX);
  };
  const onPointerEnd = () => setDragging(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next: Record<string, number> = {
      ArrowLeft: split - ARROW_STEP,
      ArrowDown: split - ARROW_STEP,
      ArrowRight: split + ARROW_STEP,
      ArrowUp: split + ARROW_STEP,
      Home: 0,
      End: 100,
    };
    if (!(e.key in next)) return;
    e.preventDefault();
    setSplit(Math.max(0, Math.min(100, next[e.key])));
  };

  const value = Math.round(split);
  const chrome = DIALOG_CHROME_REM + (compare.refused ? DIALOG_NOTE_REM : 0);
  const label = 'absolute top-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-mono text-white pointer-events-none';
  return (
    <div
      ref={boxRef}
      data-compare=""
      onPointerDown={onPointerDown}
      onMouseDown={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className="relative overflow-hidden rounded-xl border border-border-subtle select-none cursor-ew-resize"
      style={{
        ...checkerboard,
        // The height of the room left is the limit for a tall image.
        width: `min(100%, calc((100dvh - ${chrome}rem) * ${compare.inW / compare.inH}))`,
        aspectRatio: `${compare.inW} / ${compare.inH}`,
        touchAction: 'none',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, drawn by the editor's own rule */}
      <img
        src={compare.beforeUrl}
        alt={FIX_GRID_BEFORE}
        draggable={false}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: layerRendering(view.width / compare.inW, view.dpr) }}
      />
      {/* The after image covers the before one from the divider rightward;
          the checkerboard behind it stops the before image showing through
          what the fix made transparent. */}
      <div
        className={`absolute inset-0 ${dragging ? '' : EASE_CLIP_CLASS}`}
        style={{ ...checkerboard, clipPath: `inset(0 0 0 ${split}%)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, drawn by the editor's own rule */}
        <img
          src={compare.afterUrl}
          alt={FIX_GRID_AFTER}
          draggable={false}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: layerRendering(view.width / compare.outW, view.dpr) }}
        />
      </div>
      <span className={`${label} left-1.5 ${MOVE_CLASS} ${split < LABEL_FADE_AT ? 'opacity-0' : ''}`}>
        {FIX_GRID_BEFORE}
      </span>
      <span className={`${label} right-1.5 ${MOVE_CLASS} ${split > 100 - LABEL_FADE_AT ? 'opacity-0' : ''}`}>
        {FIX_GRID_AFTER}
      </span>
      <div
        ref={sliderRef}
        role="slider"
        tabIndex={0}
        data-autofocus
        aria-label={FIX_GRID_DIVIDER_NAME}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={fixGridDividerValue(value)}
        onKeyDown={onKeyDown}
        className={`absolute inset-y-0 -translate-x-1/2 w-11 md:w-8 flex items-center justify-center focus:outline-none group ${dragging ? '' : EASE_LEFT_CLASS}`}
        style={{ left: `${split}%` }}
      >
        <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_3px_rgba(0,0,0,0.8)]" />
        <span className="relative h-11 w-7 md:h-8 md:w-6 rounded-lg flex items-center justify-center bg-bg-primary/90 backdrop-blur-sm border border-border-default text-text-primary group-focus-visible:border-accent-amber group-focus-visible:text-accent-amber">
          <GripVertical size={14} />
        </span>
      </div>
    </div>
  );
}

interface FixPixelGridDialogProps {
  open: boolean;
  compare: FixGridCompare | null;
  /** The transparency checkerboard the editor draws behind images. */
  checkerboard: CSSProperties;
  onUse: () => void;
  onCancel: () => void;
}

/**
 * Shows what "Fix pixel grid" would do, before anything changes. Esc and the
 * backdrop cancel; focus goes back where it was. Same HeadlessUI Dialog as
 * EditorLeaveDialog, under it in the stack. On a phone it fills the screen.
 */
export default function FixPixelGridDialog({ open, compare, checkerboard, onUse, onCancel }: FixPixelGridDialogProps) {
  // The editor's shortcuts listen on the document and the window, and the
  // dialog is modal: its keys stay in it, or Cmd+Z would edit the image
  // behind it. Escape and Tab go on, for HeadlessUI. The panel can hold focus
  // itself (tabIndex), so a press on its padding does not drop focus to the
  // page, outside this handler.
  const keepKeysIn = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
  };

  return (
    <Dialog open={open && compare !== null} onClose={onCancel} className="relative z-[108]">
      <DialogBackdrop
        transition
        className={`fixed inset-0 bg-black/60 data-[closed]:opacity-0 ${MOVE_CLASS}`}
      />
      <div className="fixed inset-0 flex items-center justify-center md:p-4">
        <DialogPanel
          transition
          tabIndex={-1}
          onKeyDown={keepKeysIn}
          className={`focus:outline-none w-full h-dvh md:h-auto md:max-w-2xl flex flex-col gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-bg-primary md:border border-border-default md:rounded-xl shadow-2xl data-[closed]:opacity-0 data-[closed]:scale-95 ${MOVE_CLASS}`}
        >
          <DialogTitle className="text-sm font-mono font-semibold text-text-primary">
            {FIX_GRID_LABEL}
          </DialogTitle>
          {compare?.refused && (
            <Description as="p" className="text-xs font-mono text-text-secondary">
              {FIX_GRID_MAY_BE_WRONG}
            </Description>
          )}
          {compare && (
            <>
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <CompareView key={compare.afterUrl} compare={compare} checkerboard={checkerboard} />
              </div>
              <Description as="p" className="text-xs font-mono text-text-muted text-center tabular-nums">
                {fixGridSizes(compare.inW, compare.inH, compare.outW, compare.outH)}
              </Description>
            </>
          )}
          <div className="flex items-center justify-end gap-2">
            {/* One height: the secondary variant's border would make it 2 px
                taller than the primary. */}
            <Button variant="secondary" size="sm" onClick={onCancel} className="flex-1 md:flex-none md:h-8">
              {FIX_GRID_CANCEL}
            </Button>
            <Button variant="primary" size="sm" onClick={onUse} className="flex-1 md:flex-none md:h-8">
              {FIX_GRID_USE}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
