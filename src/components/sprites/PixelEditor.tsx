'use client';

import { useState, useCallback } from 'react';
import { Dialog } from '@headlessui/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import PixelEditorBody from './PixelEditorBody';
import { useEditorStore, selectIsDirty } from './editorStore';

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
}

export default function PixelEditor({
  frameDataUrl,
  frameWidth,
  frameHeight,
  onSave,
  onClose,
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
  // to a PNG dataURL, fire onSave, then onClose. Duplicates Body's
  // renderToDataUrl trivially — keeps the wrapper self-contained.
  const saveAndCloseFromConfirm = useCallback(() => {
    const { pixels, width, height } = useEditorStore.getState();
    if (pixels) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      onSave(canvas.toDataURL('image/png'));
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
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="bg-bg-primary border border-border-default rounded-xl shadow-2xl overflow-hidden h-[90vh] w-[min(1200px,95vw)]">
            <PixelEditorBody
              frameDataUrl={frameDataUrl}
              frameWidth={frameWidth}
              frameHeight={frameHeight}
              onSave={onSave}
              onDismiss={attemptDismiss}
              layout="modal"
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
