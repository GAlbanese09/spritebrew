'use client';

import { Dialog } from '@headlessui/react';

interface EditorLeaveDialogProps {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}

/**
 * Asks before the full-page editor is left with edits: its Back, an in-app
 * link, or the browser's Back, which on iOS is an edge swipe (BUILD
 * 2026-10-29). The edits are already saved as a draft, so leaving loses
 * nothing; the dialog makes sure leaving is a choice. Leaving ends the
 * session by choice, so the draft is then listed on the Editor and not
 * offered on Generate (useEditorRecovery). Same HeadlessUI Dialog
 * pattern as the modal's confirm: Esc and the backdrop count as staying, and
 * staying has focus.
 */
export default function EditorLeaveDialog({ open, onStay, onLeave }: EditorLeaveDialogProps) {
  return (
    <Dialog open={open} onClose={onStay} className="relative z-[110]">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4">
          <div>
            <Dialog.Title className="text-sm font-mono font-semibold text-text-primary">
              Leave the editor?
            </Dialog.Title>
            <p className="text-xs font-mono text-text-muted mt-1.5">
              Your edits are saved on this device. You can restore them from the Editor.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button
              autoFocus
              onClick={onStay}
              className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle"
            >
              Keep editing
            </button>
            <button
              onClick={onLeave}
              className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                bg-accent-amber text-bg-primary hover:bg-accent-amber-strong"
            >
              Leave
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
