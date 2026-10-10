'use client';

import { RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';

interface SheetRestoreBannerProps {
  restoring: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * Offers the Sheet Tools session saved on this device (useSheetSession) on
 * /upload, /preview and /export. Same look as the editor's "Recover your last
 * edit?" banner on EditorLanding.
 */
export default function SheetRestoreBanner({ restoring, onRestore, onDiscard }: SheetRestoreBannerProps) {
  return (
    <div className="rounded-lg border border-accent-amber bg-bg-surface p-4 flex items-start gap-3">
      <RotateCcw size={18} className="text-accent-amber flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono font-semibold text-text-primary">
          Restore your last sheet?
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button variant="primary" size="sm" disabled={restoring} onClick={onRestore}>
            Restore
          </Button>
          <Button variant="ghost" size="sm" disabled={restoring} onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}
