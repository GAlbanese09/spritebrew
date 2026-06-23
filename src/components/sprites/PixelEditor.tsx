'use client';

import { useState, useCallback } from 'react';
import { Dialog } from '@headlessui/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import PixelEditorBody from './PixelEditorBody';
import { useEditorStore, selectIsDirty } from './editorStore';
import type { SpriteProjectSource } from '@/lib/spriteProject';
import { pixelsToPngDataUrl } from '@/lib/editorImage';

/**
 * Modal-mode wrapper around <PixelEditorBody>. Preserves the existing
 * 5-prop interface used by FrameGrid and CharacterAutoPrep. v2 Phase 1
 * splits the chrome (Dialog + nested confirm-discard) from the editor
 * body itself so the body can also mount inside the /editor route.
 */

interface PixelEditorProps {
  frameDataUrl: string;
  frameWidth: number;
  frameHeight: number;
  onSave: (newDataUrl: string) => void;
  onClose: () => void;
  /** Origin lineage forwarded to the SpriteProjectV1 document model
   *  (Wave 1b). Optional — omit when origin is unknown. */
  source?: SpriteProjectSource;
}

export default function PixelEditor({
  frameDataUrl,
  frameWidth,
  frameHeight,
  onSave,
  onClose,
  source,
}: PixelEditorProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Central close gating — every close path the body emits routes through
  // attemptDismiss so isDirty can short-circuit to the confirm dialog.
  const attemptDismiss = useCallback(() => {
    if (selectIsDirty(useEditorStore.getState())) {
      setConfirmOpen(true);
    } else {
      onClose();
    }
  }, [onClose]);

  // Save-and-close from the confirm dialog: serialize current store pixels
  // to a PNG dataURL, fire onSave, then onClose. Shares the pixelsToPngDataUrl
  // helper with PixelEditorBody so the recipe lives in one place.
  const saveAndCloseFromConfirm = useCallback(() => {
    const { pixels, width, height } = useEditorStore.getState();
    if (pixels) {
      onSave(pixelsToPngDataUrl(pixels, width, height));
    }
    onClose();
  }, [onSave, onClose]);

  return (
    // HotkeysProvider scopes the editor's brush-size / undo / redo hotkeys
    // to the 'editor' scope (Fix #3). Wrapping from outside guarantees the
    // provider's context is established BEFORE PixelEditorBody's useHotkeys
    // calls run on first render.
    <HotkeysProvider initiallyActiveScopes={['editor']}>
      <Dialog open onClose={attemptDismiss} className="relative z-[100]">
        <div className="fixed inset-0 bg-black/70" aria-hidden="true" />
        {/* items-start on mobile pins the panel to the top of the visible
            viewport so the bottombar (toolbar) lands just above the iOS URL
            bar / home indicator. With items-center, the layout-viewport-sized
            wrapper centered the visible-viewport-sized panel inside itself,
            pushing the bottombar under the URL bar after a rotate. md+ keeps
            the 90vh panel centered as before. */}
        <div className="fixed inset-0 flex items-start justify-center p-0 md:items-center md:p-4">
          <Dialog.Panel className="bg-bg-primary overflow-hidden shadow-2xl h-app-vh w-screen rounded-none border-0 md:h-[90vh] md:w-[min(1200px,95vw)] md:rounded-xl md:border md:border-border-default">
            <PixelEditorBody
              frameDataUrl={frameDataUrl}
              frameWidth={frameWidth}
              frameHeight={frameHeight}
              onSave={onSave}
              onDismiss={attemptDismiss}
              onSaveClose={onClose}
              layout="modal"
              source={source}
            />
          </Dialog.Panel>
        </div>
      </Dialog>

      {/* Nested confirm-discard dialog. HeadlessUI handles nested dialogs:
          its Esc handler will close THIS dialog first (return to editor),
          not the outer one. */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        className="relative z-[110]"
      >
        <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4">
            <div>
              <Dialog.Title className="text-sm font-mono font-semibold text-text-primary">
                Unsaved changes
              </Dialog.Title>
              <p className="text-xs font-mono text-text-muted mt-1.5">
                You have unsaved pixel edits. What would you like to do?
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <button
                autoFocus
                onClick={() => setConfirmOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                  bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle"
              >
                Keep editing
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  onClose();
                }}
                className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                  bg-red-600 hover:bg-red-700 text-white"
              >
                Discard changes
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  saveAndCloseFromConfirm();
                }}
                className="px-3 py-1.5 rounded text-xs font-mono cursor-pointer
                  bg-accent-amber text-bg-primary hover:bg-accent-amber-strong"
              >
                Save and close
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </HotkeysProvider>
  );
}
