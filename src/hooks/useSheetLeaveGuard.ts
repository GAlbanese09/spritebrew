'use client';

import { useEffect } from 'react';
import { useSpriteStore } from '@/stores/spriteStore';

/**
 * beforeunload guard for Sheet Tools (/upload, /preview, /export). The
 * sliced sheet, its frames and the user's groups live only in memory, so a
 * reload or tab close loses them. Same pattern as PixelEditorBody's guard:
 * register only while there is something to lose (a sliced sheet exists),
 * so an empty page never prompts.
 */
export function useSheetLeaveGuard() {
  const hasSheet = useSpriteStore((s) => s.spriteSheet !== null);

  useEffect(() => {
    if (!hasSheet) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasSheet]);
}
