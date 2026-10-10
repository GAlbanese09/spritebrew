'use client';

import { usePathname } from 'next/navigation';
import { AlertCircle, X } from 'lucide-react';
import { useSpriteStore } from '@/stores/spriteStore';

// Bottom offsets sit just above the tallest sticky generate bar on /generate
// (GenerationForm.tsx and AnimateForm.tsx render the bars; they are not
// looked up in the DOM because they are about to be rewritten). Tallest bar,
// computed from classes: 139px below the sm breakpoint (stacked layout, two
// line summary, Remove background toggle, 48px button, py-3, border) and 73px
// from sm up (single row). Plus an 8px gap. The bars add max(12px, safe area)
// of bottom padding, so the safe-area inset is added on top here.
const BOTTOM_OFFSET =
  'bottom-[calc(147px+env(safe-area-inset-bottom))] sm:bottom-[calc(81px+env(safe-area-inset-bottom))]';

export default function GenerationErrorNotice() {
  const pathname = usePathname();
  const generationError = useSpriteStore((s) => s.generationError);
  const setGenerationError = useSpriteStore((s) => s.setGenerationError);

  if (pathname !== '/generate' || !generationError) return null;

  const showBuyLink =
    generationError.includes('buy more tokens') || generationError.includes('top up');

  return (
    <div
      className={`pointer-events-none fixed left-0 right-0 lg:left-[var(--sidebar-width)] z-40 ${BOTTOM_OFFSET}`}
    >
      <div className="max-w-5xl mx-auto px-4">
        <div className="pointer-events-auto max-h-[40vh] overflow-y-auto rounded-lg bg-bg-primary">
          <div
            role="alert"
            className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-red-400">{generationError}</p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setGenerationError(null)}
                className="ml-auto -my-3 -mr-4 flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center text-red-400 hover:text-red-300 cursor-pointer md:my-0 md:mr-0 md:min-h-0 md:min-w-0"
              >
                <X size={12} />
              </button>
            </div>
            {showBuyLink && (
              <a
                href="/buy-tokens"
                className="inline-block mt-2 ml-6 px-3 py-1.5 rounded text-[10px] font-mono
                  bg-accent-amber text-bg-primary hover:bg-accent-amber/90 transition-colors"
              >
                Buy tokens
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
