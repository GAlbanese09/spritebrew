'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { onBeforeResume, savedJobMode, type GenMode } from '@/hooks/useGenerationPoll';

/**
 * The /generate page's tab, and the page's say in which form finishes a saved
 * generation. Only the form for the current tab is mounted.
 *
 * - The first tab is the mode of the saved job that will resume, if any, so
 *   a generation that ran while the user was on another page comes back on
 *   the tab whose form started it. This value reads localStorage, so the
 *   page keeps every use of the tab out of server markup.
 * - Before any form resumes a saved job, the generation poll asks the page
 *   (onBeforeResume). Unless the user has picked a tab since the page
 *   mounted (a tab click or Send to Animator, through pickTab), a job for
 *   the other tab switches the tab, and the form that asked leaves the job
 *   to the job's own form, which resumes it on mount. A job saved after the
 *   first tab was chosen (its Generate request was still in flight when the
 *   user left) is covered whenever it lands, because the asking happens at
 *   every resume, not at a subscription (Second 090).
 * - The check is registered, and the tab it compares with is updated, in
 *   layout effects. Those run when the page commits, before any form's mount
 *   effect can resume a job, and the tab compared with is always the one on
 *   screen.
 */
export function useGenerateTab(): { tab: GenMode; pickTab: (tab: GenMode) => void } {
  const [tab, setTab] = useState<GenMode>(() => (savedJobMode() === 'animate' ? 'animate' : 'create'));
  const shownTab = useRef(tab);
  const userPicked = useRef(false);

  useLayoutEffect(() => {
    shownTab.current = tab;
  }, [tab]);

  useLayoutEffect(
    () =>
      onBeforeResume((mode) => {
        if (userPicked.current || mode === shownTab.current) return false;
        setTab(mode);
        return true;
      }),
    []
  );

  const pickTab = useCallback((next: GenMode) => {
    userPicked.current = true;
    setTab(next);
  }, []);

  return { tab, pickTab };
}
