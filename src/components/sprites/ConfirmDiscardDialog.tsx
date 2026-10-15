'use client';

import { Dialog } from '@headlessui/react';

interface ConfirmDiscardDialogProps {
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}

/**
 * Asks before an action throws away the sliced frames and groups on
 * /upload. Same HeadlessUI Dialog pattern as PixelEditor's confirm-discard
 * dialog. Esc and the backdrop count as Cancel, and Cancel has focus, so the
 * safe choice is always the default.
 */
export default function ConfirmDiscardDialog({ open, onCancel, onContinue }: ConfirmDiscardDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} className="relative z-[110]">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4">
          <Dialog.Title className="text-sm font-mono font-semibold text-text-primary">
            This clears your frames and groups. Continue?
          </Dialog.Title>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              autoFocus
              onClick={onCancel}
              className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle"
            >
              Cancel
            </button>
            <button
              onClick={onContinue}
              className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                bg-red-600 hover:bg-red-700 text-white"
            >
              Continue
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
