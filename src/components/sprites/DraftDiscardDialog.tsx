'use client';

import { Dialog } from '@headlessui/react';
import { DISCARD_DRAFT_LABEL, DISCARD_DRAFT_TITLE, KEEP_DRAFT_LABEL } from '@/lib/editorCopy';
import { useFreshPress } from './useFreshPress';

interface DraftDiscardDialogProps {
  /** The question's text (discardDraftText), or null while it is closed. */
  text: string | null;
  onKeep: () => void;
  onDiscard: () => void;
}

/**
 * Asks before a saved editor draft is deleted (SB-04, the outside audit of
 * Nov 24, 2026: Discard sat beside Restore and deleted the draft, perhaps
 * the only copy of a drawing after a crash, on one click). It names the
 * draft by its size, where it came from and its age, and says it cannot be
 * undone. Keep draft has the focus, and Esc and the backdrop keep it too;
 * only the Discard button deletes, and only on a press that began a moment
 * after the question opened (useFreshPress: a double tap on a Discard that
 * opens the question under the pointer deletes nothing). Same HeadlessUI
 * Dialog pattern as the editor's leave question.
 */
export default function DraftDiscardDialog({ text, onKeep, onDiscard }: DraftDiscardDialogProps) {
  const press = useFreshPress(text !== null);
  const button = 'w-full sm:w-auto inline-flex items-center justify-center px-3 py-1.5 min-h-11 sm:min-h-0 sm:pointer-coarse:min-h-11 rounded text-xs font-mono whitespace-nowrap cursor-pointer';
  return (
    <Dialog open={text !== null} onClose={onKeep} className="relative z-[110]">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4">
          <div>
            <Dialog.Title className="text-sm font-mono font-semibold text-text-primary">
              {DISCARD_DRAFT_TITLE}
            </Dialog.Title>
            <p className="text-xs font-mono text-text-muted mt-1.5">{text}</p>
          </div>
          {/* DESIGN 2026-11-25-032: from 640 px one row, Discard at the left
              and Keep draft at the right; under 640 full width, stacked,
              Keep draft first and Discard last. */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              onPointerDown={press.onPointerDown}
              onClick={(e) => { if (press.accept(e)) onDiscard(); }}
              className={`${button} sm:mr-auto border border-transparent text-red-400 hover:text-red-300 hover:bg-red-500/10`}
            >
              {DISCARD_DRAFT_LABEL}
            </button>
            <button
              autoFocus
              onClick={onKeep}
              className={`${button} bg-accent-amber text-bg-primary hover:bg-accent-amber-strong border border-transparent`}
            >
              {KEEP_DRAFT_LABEL}
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
