'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { onBeforeResume, savedJob } from '@/hooks/useGenerationPoll';
import { tabForJob, type GenerateTab } from '@/lib/generateTabs';

/**
 * The /generate page's tab, and the page's say in which form finishes a saved
 * generation. Only the form for the current tab is mounted. Three tabs, two
 * kinds of job: a create job with an animation style is Animate from Text's
 * (tabForJob, src/lib/generateTabs.ts; DESIGN generate-pass.md section 3).
 *
 * - The tab opens on the mode of the saved job that will resume for the
 *   signed-in user, if any, so a generation that ran while the user was on
 *   another page comes back on the tab whose form started it. Another
 *   account's job is dropped, not opened (resumeDecision). On a reload the
 *   user is not known at the page's first render, so the tab is chosen
 *   again once they are, and again at every later sign-in. The first value
 *   reads localStorage, so the page keeps every use of the tab out of
 *   server markup.
 * - Before any form resumes a saved job, the generation poll asks the page
 *   (onBeforeResume). Unless the user has picked a tab since the page
 *   mounted or they signed in (a tab click or Send to Animator, through
 *   pickTab), a job for the other tab switches the tab, and the form that
 *   asked leaves the job to the job's own form, which resumes it on mount.
 *   A job saved after the first tab was chosen (its Generate request was
 *   still in flight when the user left) is covered whenever it lands,
 *   because the asking happens at every resume, not at a subscription
 *   (Second 090).
 * - The check is registered, and the tab it compares with is updated, in
 *   layout effects. Those run when the page commits, before any form's mount
 *   effect can resume a job, and the tab compared with is always the one on
 *   screen.
 */
export function useGenerateTab(): { tab: GenerateTab; pickTab: (tab: GenerateTab) => void } {
  const { userId } = useAuth();
  const [tab, setTab] = useState<GenerateTab>(() => tabForSavedJob(userId));
  // The account the tab was chosen for.
  const [tabUser, setTabUser] = useState(userId);
  const shownTab = useRef(tab);
  const userPicked = useRef(false);

  // On a reload Clerk loads after the page's first render, so the first tab
  // was chosen before the user was known. When the user becomes known, or
  // signs in again, or another account signs in, the tab is chosen again
  // for that account's saved job, and a pick made before no longer holds.
  // React renders the page again before its children, so no form mounts
  // for the old tab.
  if (tabUser !== userId) {
    setTabUser(userId);
    if (userId) setTab(tabForSavedJob(userId));
  }

  useLayoutEffect(() => {
    shownTab.current = tab;
  }, [tab]);

  // The pick goes with the account: cleared before any form's mount effect
  // can ask the resume check below.
  useLayoutEffect(() => {
    if (userId) userPicked.current = false;
  }, [userId]);

  useLayoutEffect(
    () =>
      onBeforeResume((mode, styleId) => {
        const jobTab = tabForJob(mode, styleId);
        if (userPicked.current || jobTab === shownTab.current) return false;
        setTab(jobTab);
        return true;
      }),
    []
  );

  const pickTab = useCallback((next: GenerateTab) => {
    userPicked.current = true;
    setTab(next);
  }, []);

  return { tab, pickTab };
}

/** The tab for the saved job that will resume for this user: its own tab
 *  (tabForJob), or Create Sprite when there is none. */
function tabForSavedJob(userId: string | null | undefined): GenerateTab {
  const job = savedJob(userId);
  return job ? tabForJob(job.mode, job.styleId) : 'create';
}
