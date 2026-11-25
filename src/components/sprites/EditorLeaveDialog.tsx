'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@headlessui/react';
import { Download } from 'lucide-react';
import { DOWNLOAD_PNG_LABEL, leaveDialogView, leaveEditorText, type LeaveSaveState } from '@/lib/editorCopy';
import { useFreshPress } from './useFreshPress';

/** How long the question waits for the save of what is on screen before it
 *  stops waiting and says the edits are not saved. */
export const LEAVE_SAVE_WAIT_MS = 2000;

/** How long a save may be on its way before the question says so: a
 *  quicker one shows no "Saving" at all (DESIGN 2026-11-25-067). */
export const LEAVE_SAVING_SHOW_MS = 300;

interface EditorLeaveDialogProps {
  open: boolean;
  /** How the edits are kept right now (useLeaveSaveState). */
  saveState: LeaveSaveState;
  onStay: () => void;
  onLeave: () => void;
  /** Saves a PNG of the picture, as the editor's own Download PNG. */
  onDownload: () => void;
}

/**
 * Asks before the full-page editor is left with edits: its Back, an in-app
 * link, or the browser's Back, which on iOS is an edge swipe (BUILD
 * 2026-10-29). It says the edits are saved on this device only once the
 * write of what is on screen has landed (SB-25, the outside audit of Nov 24,
 * 2026: it used to say so when the save had failed). While that write is on
 * its way Leave waits, and from LEAVE_SAVING_SHOW_MS the line says it is
 * saving (before that it is quiet); when it failed, when this browser
 * cannot keep drafts, or when it takes longer than LEAVE_SAVE_WAIT_MS, it
 * says the edits are not saved and offers Download PNG, Keep editing and
 * Leave anyway. Leaving ends the session by choice, so the draft is then
 * listed on the Editor and not offered on Generate (useEditorRecovery). Same
 * HeadlessUI Dialog pattern as the modal's confirm: Esc and the backdrop
 * count as staying. Staying has the focus, except when the edits are not
 * saved: then Download PNG has it.
 */
export default function EditorLeaveDialog({ open, saveState, onStay, onLeave, onDownload }: EditorLeaveDialogProps) {
  // The question's own clock: true once a save has been on its way for
  // LEAVE_SAVE_WAIT_MS; it starts again each time a save starts (an Undo
  // with the question open asks for a new one: AUDIT data-loss r1, L7), and
  // is back to false when the save lands, fails or the question closes.
  const [waitedOut, setWaitedOut] = useState(false);
  const saving = open && saveState === 'saving';
  useEffect(() => {
    if (!saving) return;
    const id = setTimeout(() => setWaitedOut(true), LEAVE_SAVE_WAIT_MS);
    return () => { clearTimeout(id); setWaitedOut(false); };
  }, [saving]);
  // Its line stays quiet for a save's first LEAVE_SAVING_SHOW_MS, so a
  // quick save goes straight to saved (or not saved): no flicker, and never
  // saved and then not saved (DESIGN 2026-11-25-067; AUDIT data-loss r2, L1).
  const [savingShown, setSavingShown] = useState(false);
  useEffect(() => {
    if (!saving) return;
    const id = setTimeout(() => setSavingShown(true), LEAVE_SAVING_SHOW_MS);
    return () => { clearTimeout(id); setSavingShown(false); };
  }, [saving]);
  // Leave and Leave anyway act only on a press that began a moment after the
  // question opened (AUDIT data-loss r1, M1).
  const press = useFreshPress(open);
  const view = leaveDialogView(saveState, waitedOut, savingShown);
  const button = 'w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-11 sm:min-h-0 sm:pointer-coarse:min-h-11 rounded text-xs font-mono whitespace-nowrap cursor-pointer';
  const primary = `${button} border border-transparent bg-accent-amber text-bg-primary hover:bg-accent-amber-strong disabled:opacity-50 disabled:cursor-wait`;
  const neutral = `${button} bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle`;
  const red = `${button} sm:mr-auto border border-transparent text-red-400 hover:text-red-300 hover:bg-red-500/10`;
  return (
    <Dialog open={open} onClose={onStay} className="relative z-[110]">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4">
          <div>
            <Dialog.Title className="text-sm font-mono font-semibold text-text-primary">
              Leave the editor?
            </Dialog.Title>
            {/* While a save is on its way the saved sentence holds the
                line's height, unseen and not read out, under the quiet line
                or "Saving", so nothing jumps when the answer comes. */}
            <p role="status" className="grid text-xs font-mono text-text-muted mt-1.5">
              {view.state === 'saving' && <span className="invisible col-start-1 row-start-1" aria-hidden="true">{leaveEditorText('saved')}</span>}
              {!view.quiet && <span className="col-start-1 row-start-1">{view.text}</span>}
            </p>
          </div>
          {/* DESIGN 2026-11-25-032: from 640 px one row, the red action at
              the left and the primary last; under 640 full width, stacked
              the other way up, primary first and red last, as the modal's
              question. Not saved: Leave anyway, Keep editing, Download PNG
              (the primary, with the focus: the one button that keeps the
              work). Saved or saving: Keep editing (the focus), Leave. */}
          {view.download ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button onPointerDown={press.onPointerDown} onClick={(e) => { if (press.accept(e)) onLeave(); }} className={red}>
                {view.leaveLabel}
              </button>
              <button onClick={onStay} className={neutral}>
                Keep editing
              </button>
              <button autoFocus onClick={onDownload} className={primary}>
                <Download size={14} aria-hidden="true" />
                {DOWNLOAD_PNG_LABEL}
              </button>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button autoFocus onClick={onStay} className={neutral}>
                Keep editing
              </button>
              <button onPointerDown={press.onPointerDown} onClick={(e) => { if (press.accept(e)) onLeave(); }} disabled={!view.leaveEnabled} className={primary}>
                {view.leaveLabel}
              </button>
            </div>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
