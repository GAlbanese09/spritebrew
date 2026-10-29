'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/react';
import { RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useSpriteStore } from '@/stores/spriteStore';
import {
  isRecoveryAvailable,
  draftSentence,
  unfinishedDraft,
  type RecoveryManifestV1,
} from '@/lib/editorRecovery';
import { discardEditorDraft, editorDraftStore, editorWritesSettled, isEditorSessionOpen } from './useEditorRecovery';

/**
 * On Generate: offers this user's newest editor draft whose session did not
 * end the way they chose, which means a reload or a crash took it (BUILD
 * 2026-10-29: an iPhone reload in the middle of a modal session landed
 * George on Generate with his work gone). Restore opens it in the full-page
 * editor; Discard deletes it.
 */
export default function EditorDraftBanner() {
  const router = useRouter();
  const { isLoaded, userId } = useAuth();
  const [draft, setDraft] = useState<RecoveryManifestV1 | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await isRecoveryAvailable())) return;
        // An editor that just went (a Back from it) has saved or closed its
        // draft by then.
        await editorWritesSettled();
        const all = (await editorDraftStore().listDrafts())
          .map((c) => c.manifest)
          .filter((m) => !isEditorSessionOpen(m.draftId));
        if (!cancelled) setDraft(unfinishedDraft(all, userId ?? null));
      } catch {
        if (!cancelled) setDraft(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoaded, userId]);

  if (!draft) return null;

  const restore = () => {
    useSpriteStore.getState().setPendingEditorRestore(draft.draftId);
    router.push('/editor');
  };
  const discard = () => {
    setDraft(null);
    void discardEditorDraft(draft.draftId);
  };

  return (
    <div className="mb-4 rounded-lg border border-accent-amber bg-bg-surface p-4 flex items-start gap-3">
      <RotateCcw size={18} className="text-accent-amber flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono font-semibold text-text-primary mb-1">
          Recover your last edit?
        </p>
        <p className="text-[11px] font-mono text-text-secondary leading-relaxed">
          {draftSentence(draft)}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <Button variant="primary" size="sm" onClick={restore}>
            Restore in Editor
          </Button>
          <button
            onClick={discard}
            className="text-[11px] font-mono text-text-muted hover:text-text-primary cursor-pointer px-2 py-1"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
