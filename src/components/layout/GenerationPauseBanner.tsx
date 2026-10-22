'use client';

import { useLayoutEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { GENERATION_PAUSED, GENERATION_PAUSED_MESSAGE } from '@/lib/generationPause';

/**
 * The site-wide notice while generation is paused (src/lib/generationPause.ts).
 * Renders nothing when the pause is off. While shown, it publishes its height
 * as --pause-banner-h so the editor's full-height layout (h-editor-page) gives
 * up that space instead of being clipped at the bottom.
 */
export default function GenerationPauseBanner() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--pause-banner-h', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--pause-banner-h');
    };
  }, []);

  if (!GENERATION_PAUSED) return null;

  return (
    <div
      ref={ref}
      role="status"
      className="w-full flex-shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2"
    >
      <p className="mx-auto flex max-w-5xl items-start gap-2 text-xs font-mono text-amber-300">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>{GENERATION_PAUSED_MESSAGE}</span>
      </p>
    </div>
  );
}
