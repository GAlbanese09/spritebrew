'use client';

import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import Button from '@/components/ui/Button';
import PixelCoin from '@/components/ui/PixelCoin';
import type { GenerationStyle } from '@/lib/styleRegistry';

interface StyleFieldProps {
  style: GenerationStyle;
  /** Recent styles to offer, newest first (already without the current one). */
  recent: GenerationStyle[];
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onViewExamples: (style: GenerationStyle) => void;
  onChooseRecent: (id: string) => void;
}

/**
 * The Create form's style field: the chosen style's first example, its name,
 * description and cost, and Change style (opens StylePicker). Recent sits
 * under it. The field's height is the same for every style. The forwarded ref
 * is the Change style button, so the picker can hand focus back to it.
 */
const StyleField = forwardRef<HTMLButtonElement, StyleFieldProps>(function StyleField(
  { style, recent, pickerOpen, onOpenPicker, onViewExamples, onChooseRecent },
  changeRef,
) {
  const labelId = useId();
  const hasExamples = !!style.examplePaths && style.examplePaths.length > 0;
  const unit = style.isAnimation ? 'per animation' : 'per sprite';

  return (
    <div>
      <p id={labelId} className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
        Style
      </p>
      <div role="group" aria-labelledby={labelId}>
        <div className="w-full rounded-xl border border-border-strong p-2.5">
          <div className="flex items-center gap-2 sm:gap-3 h-14 sm:h-16">
            {hasExamples ? (
              <button
                type="button"
                onClick={() => onViewExamples(style)}
                aria-label={`View examples of ${style.label}`}
                className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-[#151311] overflow-hidden cursor-pointer
                  hover:ring-1 hover:ring-border-strong"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={style.examplePaths![0]}
                  alt=""
                  decoding="async"
                  className="w-full h-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </button>
            ) : (
              <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-[#151311] flex items-center justify-center">
                <Film size={32} className="text-text-secondary" aria-hidden="true" />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="text-sm font-mono text-text-primary truncate">{style.label}</p>
              <p
                className="hidden sm:block text-[13px] font-mono text-text-secondary truncate"
                title={style.description}
              >
                {style.description}
              </p>
              {/* The cost shows in full: it may wrap to a second line inside
                  the field's fixed height, never truncate. */}
              <p className="flex items-start gap-1.5 text-xs leading-tight font-mono text-text-secondary tabular-nums">
                <PixelCoin />
                <span className="min-w-0">{style.tokenCost} {unit}</span>
              </p>
            </div>

            <Button
              ref={changeRef}
              type="button"
              variant="secondary"
              onClick={onOpenPicker}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              className="flex-shrink-0 whitespace-nowrap max-sm:px-3 sm:h-10 sm:min-h-0 pointer-coarse:min-h-11"
            >
              <span className="hidden sm:inline">Change style</span>
              <span className="sm:hidden">Change</span>
            </Button>
          </div>
        </div>
        <RecentRow recent={recent} onChoose={onChooseRecent} />
      </div>
    </div>
  );
});

export default StyleField;

/**
 * "Recent:" and one badge per style. From 640 px it always shows (and wraps).
 * Below 640 it shows only when every badge fits on one line: it stays in
 * layout, hidden, until measured, then shows or leaves the layout.
 */
function RecentRow({ recent, onChoose }: { recent: GenerationStyle[]; onChoose: (id: string) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState<boolean | null>(null);
  const key = recent.map((s) => s.id).join(',');

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    // A ResizeObserver reports once on observe, so this also takes the first measure.
    const measure = () => setFits(row.scrollWidth <= row.clientWidth + 1);
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    if (row.parentElement) ro.observe(row.parentElement);
    return () => ro.disconnect();
  }, [key]);

  if (recent.length === 0) return null;

  const below640 =
    fits === null
      ? 'max-sm:invisible'
      : fits
        ? ''
        : 'max-sm:invisible max-sm:absolute max-sm:inset-x-0 max-sm:top-0';

  return (
    <div className="relative">
      <div
        ref={rowRef}
        className={`flex items-center gap-2 mt-2 flex-wrap max-sm:flex-nowrap max-sm:overflow-hidden ${below640}`}
      >
        <span className="flex-shrink-0 text-xs font-mono text-text-secondary">Recent:</span>
        {recent.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChoose(s.id)}
            title={s.label}
            className="flex-shrink-0 max-w-[12rem] truncate h-7 pointer-coarse:h-11 px-2.5 rounded-md border border-border-default
              bg-bg-elevated text-xs font-mono text-text-secondary hover:text-text-primary hover:border-border-strong cursor-pointer
              transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-amber"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
