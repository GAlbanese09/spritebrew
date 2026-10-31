'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { discardEditorDraft, editorDraftStore, editorWritesSettled, isEditorSessionOpen, visibleDraft } from './useEditorRecovery';

/**
 * On Generate: offers this user's newest editor draft whose session did not
 * end the way they chose, which means a reload or a crash took it (BUILD
 * 2026-10-29: an iPhone reload in the middle of a modal session landed
 * George on Generate with his work gone). Restore opens it in the full-page
 * editor; Discard deletes it.
 *
 * The offer belongs to the account it was found for: it is hidden the
 * moment the account changes, and Restore and Discard check the draft's
 * owner against the account at the time of the click (Second 121). A
 * Restore or a Discard acts only within the banner's visit, which ends when
 * the account changes or the banner goes (Second 122).
 */
export default function EditorDraftBanner() {
  const router = useRouter();
  const { isLoaded, userId } = useAuth();
  const account = isLoaded ? (userId ?? null) : undefined;
  const [offer, setOffer] = useState<{ account: string | null; draft: RecoveryManifestV1 } | null>(null);
  // The account as of the latest render, for the click handlers; the
  // account's visit, which moves on when the account changes; and whether
  // the banner is on screen, which turns false in the commit that removes
  // it (a sign-out takes it away with Generate's signed-in view, without
  // rendering it again). A Restore or a Discard that answers after either
  // changed does nothing.
  const accountRef = useRef(account);
  const visitRef = useRef(0);
  const liveRef = useRef(false);
  useLayoutEffect(() => {
    if (accountRef.current !== account) {
      accountRef.current = account;
      visitRef.current++;
    }
  });
  useLayoutEffect(() => {
    liveRef.current = true;
    return () => { liveRef.current = false; };
  }, []);

  useEffect(() => {
    if (account === undefined) return;
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
        const found = unfinishedDraft(all, account);
        if (!cancelled) setOffer(found ? { account, draft: found } : null);
      } catch {
        if (!cancelled) setOffer(null);
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  // Shown only to the account it was found for.
  const draft = offer && offer.account === account ? offer.draft : null;
  if (!draft) return null;

  const restore = async () => {
    const who = accountRef.current;
    const visit = visitRef.current;
    if (who === undefined) return;
    const visible = await visibleDraft(draft.draftId, who);
    // Stale: the offer on screen, if any, is a newer one; leave it (audit r5).
    if (!liveRef.current || visitRef.current !== visit) return;
    if (!visible) {
      setOffer(null);
      return;
    }
    useSpriteStore.getState().setPendingEditorRestore({ draftId: draft.draftId, account: who });
    router.push('/editor');
  };
  const discard = async () => {
    const who = accountRef.current;
    const visit = visitRef.current;
    setOffer(null);
    if (who === undefined || !(await visibleDraft(draft.draftId, who)) || !liveRef.current || visitRef.current !== visit) return;
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
          <Button variant="primary" size="sm" onClick={() => { void restore(); }}>
            Restore in Editor
          </Button>
          <button
            onClick={() => { void discard(); }}
            className="text-[11px] font-mono text-text-muted hover:text-text-primary cursor-pointer px-2 py-1"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
