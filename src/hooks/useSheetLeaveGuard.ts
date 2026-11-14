'use client';

import { useEffect } from 'react';
import { useSpriteStore } from '@/stores/spriteStore';
import { sheetLeaveLosesWorkNow } from '@/hooks/useSheetSession';

/**
 * beforeunload guard for Sheet Tools (/upload, /preview, /export). The
 * sliced sheet, its frames and the user's groups are saved on this device
 * (useSheetSession) and Restore brings them back, so "Leave site?" shows only
 * while the latest change is not saved yet, or saving has turned itself off
 * after an error. Registered only while a sliced sheet exists, so an empty
 * page never prompts; the question is asked when the page is left.
 */
export function useSheetLeaveGuard() {
  const hasSheet = useSpriteStore((s) => s.spriteSheet !== null);

  useEffect(() => {
    if (!hasSheet) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!sheetLeaveLosesWorkNow()) return;
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasSheet]);
}
