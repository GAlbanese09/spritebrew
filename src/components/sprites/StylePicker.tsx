'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Film, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import PixelCoin from '@/components/ui/PixelCoin';
import {
  GENERATION_STYLES,
  getStyleById,
  type GenerationStyle,
  type StyleCategory,
} from '@/lib/styleRegistry';
import { nextIndex } from '@/lib/stylePickerNav';

const CATEGORY_NAMES: Record<StyleCategory, string> = {
  characters: 'Characters',
  items: 'Items',
  tiles: 'Tiles',
  ui: 'UI',
  animations: 'Animated from text',
  environments: 'Environments',
};

// Categories in registry order, each with its styles.
const CATEGORIES: { id: StyleCategory; name: string; styles: GenerationStyle[] }[] = (() => {
  const out: { id: StyleCategory; name: string; styles: GenerationStyle[] }[] = [];
  for (const style of GENERATION_STYLES) {
    let group = out.find((c) => c.id === style.category);
    if (!group) {
      group = { id: style.category, name: CATEGORY_NAMES[style.category], styles: [] };
      out.push(group);
    }
    group.styles.push(style);
  }
  return out;
})();

// The dialog fades and scales in from 768 px; the sheet slides up below it.
// Both are motion-safe only.
const KEYFRAMES = `
@keyframes sb-picker-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes sb-sheet-up { from { transform: translateY(100%); } to { transform: none; } }
`;

/** Past this, a drag down on the sheet closes it. */
const DRAG_CLOSE_PX = 80;
/** A downward flick this fast (px per ms) closes it too. */
const FLICK_SPEED = 0.5;

interface StylePickerProps {
  open: boolean;
  currentStyleId: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}

/**
 * Choose a style: a centered dialog from 768 px, a bottom sheet below it.
 * Categories on the left (a tab row on phones), the open category's styles as
 * a radio group of tiles, and Use this style. Nothing changes until the
 * person chooses; Esc, Close, the scrim and a swipe down keep the old style.
 */
export default function StylePicker(props: StylePickerProps) {
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<PickerDialog {...props} />, document.body);
}

function PickerDialog({ currentStyleId, onChoose, onClose }: StylePickerProps) {
  const current = getStyleById(currentStyleId) ?? GENERATION_STYLES[0];
  const [pending, setPending] = useState(current.id);
  const [category, setCategory] = useState<StyleCategory>(current.category);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const panelId = `${baseId}-panel`;
  const tabId = (c: StyleCategory) => `${baseId}-tab-${c}`;

  const dialogRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabRefs = useRef(new Map<StyleCategory, HTMLButtonElement>());

  const open = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
  const styles = open.styles;
  const pendingStyle = getStyleById(pending) ?? current;
  // One tab stop for the group: the pending tile when it is here, else the first.
  const tabStopId = styles.some((s) => s.id === pending) ? pending : styles[0]?.id;

  // Focus the current style's tile on open; give focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    tileRefs.current.get(current.id)?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** True in the dialog layout (from 768 px), where the sheet's handle is not shown. */
  const isDialogLayout = () => !handleRef.current || handleRef.current.offsetParent === null;

  const choose = (id: string) => {
    if (id !== currentStyleId) onChoose(id);
    onClose();
  };

  const onDialogKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    // Keep Tab inside: the category list, the tile group, Use this style, Close.
    const stops = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]'),
    ).filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && (at <= 0)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === -1 || at === stops.length - 1)) {
      e.preventDefault();
      first.focus();
    }
  };

  const onTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = CATEGORIES.length;
    let j: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j === null) return;
    e.preventDefault();
    const next = CATEGORIES[j].id;
    setCategory(next);
    tabRefs.current.get(next)?.focus();
  };

  const columnCount = () => {
    if (!gridRef.current) return 1;
    const cols = getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  };

  const onTileKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      choose(styles[i].id);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      setPending(styles[i].id);
      return;
    }
    const j = nextIndex(i, e.key, styles.length, columnCount());
    if (j === null) return;
    e.preventDefault();
    setPending(styles[j].id);
    tileRefs.current.get(styles[j].id)?.focus();
  };

  // ── The sheet's drag to close (below 768 px only) ──
  const drag = useRef<{ id: number; y0: number; lastY: number; lastT: number; speed: number } | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isDialogLayout()) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, y0: e.clientY, lastY: e.clientY, lastT: e.timeStamp, speed: 0 };
    setDragging(true);
  };
  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.speed = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setDragY(Math.max(0, e.clientY - d.y0));
  };
  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    const dy = Math.max(0, e.clientY - d.y0);
    if (e.type !== 'pointercancel' && (dy > DRAG_CLOSE_PX || (d.speed > FLICK_SPEED && dy > 16))) {
      onClose();
    } else {
      setDragY(0);
    }
  };

  const unitFor = (s: GenerationStyle) => (s.isAnimation ? 'per animation' : 'per sprite');

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center">
      <style>{KEYFRAMES}</style>
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(5, 4, 3, 0.62)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
        className={`relative flex flex-col w-full h-[min(620px,85vh)] max-h-[min(620px,85vh)] rounded-t-2xl
          border border-b-0 border-border-default bg-bg-surface shadow-2xl
          md:w-[min(860px,90vw)] md:h-[min(640px,85vh)] md:max-h-none md:rounded-2xl md:border-b
          motion-safe:animate-[sb-sheet-up_220ms_ease-out] md:motion-safe:animate-[sb-picker-in_160ms_ease-out]
          ${dragging ? '' : 'motion-safe:transition-transform motion-safe:duration-200'}`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        {/* Handle and header: drag down here to close the sheet. */}
        <div
          className="flex-shrink-0 touch-none md:touch-auto"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div ref={handleRef} className="md:hidden flex justify-center pt-2" aria-hidden="true">
            <span className="block w-10 h-1 rounded-full bg-text-muted" />
          </div>
          <div className="flex items-center justify-between gap-3 pl-5 pr-3 py-2 md:py-3 border-b border-border-default">
            <h2 id={titleId} className="font-display text-[13px] text-accent-amber">
              Choose a style
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex items-center justify-center w-10 h-10 pointer-coarse:w-11 pointer-coarse:h-11 rounded-md
                text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          <div
            role="tablist"
            aria-label="Style categories"
            className="flex flex-shrink-0 gap-1 overflow-x-auto overscroll-contain px-3 py-2 border-b border-border-default
              md:flex-col md:w-[200px] md:overflow-x-visible md:overflow-y-auto md:px-2 md:py-3 md:border-b-0 md:border-r"
          >
            {CATEGORIES.map((c, i) => {
              const selected = c.id === category;
              return (
                <button
                  key={c.id}
                  ref={(el) => {
                    if (el) tabRefs.current.set(c.id, el);
                    else tabRefs.current.delete(c.id);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(c.id)}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setCategory(c.id)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={`relative flex flex-shrink-0 items-center justify-between gap-2 rounded-md px-3 md:px-2.5 min-h-10 pointer-coarse:min-h-11
                    text-sm md:text-[13px] font-mono whitespace-nowrap cursor-pointer transition-colors
                    ${selected
                      ? 'text-accent-amber bg-accent-amber-glow md:before:absolute md:before:-left-2 md:before:top-1.5 md:before:bottom-1.5 md:before:w-0.5 md:before:rounded-full md:before:bg-accent-amber'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                    }`}
                >
                  <span>{c.name}</span>
                  <span className="text-xs tabular-nums">{c.styles.length}</span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId(open.id)}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 md:p-4"
          >
            <div
              ref={gridRef}
              role="radiogroup"
              aria-label={`${open.name} styles`}
              className="grid grid-cols-3 md:grid-cols-4 gap-[10px]"
            >
              {styles.map((s, i) => {
                const isPending = s.id === pending;
                const example = s.examplePaths?.[0];
                return (
                  <button
                    key={s.id}
                    ref={(el) => {
                      if (el) tileRefs.current.set(s.id, el);
                      else tileRefs.current.delete(s.id);
                    }}
                    type="button"
                    role="radio"
                    aria-checked={isPending}
                    tabIndex={s.id === tabStopId ? 0 : -1}
                    onClick={() => setPending(s.id)}
                    onDoubleClick={() => {
                      if (isDialogLayout()) choose(s.id);
                    }}
                    onKeyDown={(e) => onTileKeyDown(e, i)}
                    className={`relative flex flex-col min-w-0 text-left rounded-lg border-2 overflow-hidden bg-bg-elevated cursor-pointer
                      transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-amber
                      ${isPending ? 'border-accent-amber' : 'border-border-default hover:border-border-strong'}`}
                  >
                    <span className="relative flex items-center justify-center w-full aspect-square overflow-hidden bg-[#151311]">
                      {example ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={example}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 w-full h-full object-contain"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      ) : (
                        <Film size={32} className="text-text-secondary" aria-hidden="true" />
                      )}
                    </span>
                    <span
                      className={`block px-2 pt-1.5 text-[13px] font-mono truncate ${isPending ? 'text-accent-amber' : 'text-text-primary'}`}
                      title={s.label}
                    >
                      {s.label}
                    </span>
                    <span className="flex items-center gap-1.5 px-2 pt-0.5 pb-2 text-xs font-mono text-text-secondary tabular-nums">
                      <PixelCoin />
                      {s.tokenCost}
                    </span>
                    {isPending && (
                      <span
                        className="absolute top-1.5 right-1.5 flex items-center justify-center w-[22px] h-[22px] rounded-full bg-accent-amber text-bg-primary"
                        aria-hidden="true"
                      >
                        <Check size={14} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className="flex-shrink-0 flex flex-col gap-3 px-5 pt-3 border-t border-border-default sm:flex-row sm:items-center"
          style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
        >
          <p className="flex-1 min-w-0 text-[13px] font-mono text-text-secondary">
            {pendingStyle.label}: {pendingStyle.description}.{' '}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <PixelCoin />
              {pendingStyle.tokenCost} {unitFor(pendingStyle)}.
            </span>
          </p>
          <Button
            type="button"
            onClick={() => choose(pending)}
            className="flex-shrink-0 w-full sm:w-auto whitespace-nowrap pointer-coarse:min-h-11"
          >
            Use this style
          </Button>
        </div>
      </div>
    </div>
  );
}
