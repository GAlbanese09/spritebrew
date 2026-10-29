/**
 * Completion-time ownership for the Gallery's actions that wait for an
 * animation's clean copy: Download and Send to Slicer (Second 118).
 *
 * An action captures a token when it is clicked and acts only if the token is
 * still current when the clean copy is ready, as /upload's async work does
 * (src/lib/sheetOwnership.ts). Every token goes stale when the Gallery's visit
 * ends: the page unmounts or its account changes. The page ends it in a
 * layout cleanup, in the commit that makes the change, so no waiting action
 * resumes in between (Second 119). A Send to Slicer token also goes stale
 * when a newer Send to Slicer is clicked, since the newest choice is the one
 * the Slicer opens. Downloads do not replace each other or a Slicer choice:
 * each Download click asked for its own file.
 *
 * The page runs both actions through whenCurrent, so the click, the wait and
 * the check before acting are this module's code, the same code
 * scripts/gallery-ownership-test.mjs drives.
 */

export interface GalleryToken {
  readonly visit: number;
  /** The Send to Slicer click this token belongs to; null for a Download. */
  readonly slicer: number | null;
}

export type GalleryAction = 'download' | 'slicer';

export interface GalleryOwnership {
  /** Token for a Download clicked now. */
  download(): GalleryToken;
  /** Token for a Send to Slicer clicked now; every earlier Slicer token goes stale. */
  slicer(): GalleryToken;
  /** True while the token's visit lasts and, for Send to Slicer, no newer one was clicked. */
  isCurrent(token: GalleryToken): boolean;
  /** The Gallery unmounts or its account changes: every token captured before now goes stale. */
  endVisit(): void;
  /**
   * A click now: takes the action's token, then waits for the sheet's URL,
   * and calls act only if there is a URL and the token is still current.
   * Resolves true if it acted.
   */
  whenCurrent(
    action: GalleryAction,
    getUrl: () => string | undefined | Promise<string | undefined>,
    act: (url: string) => void,
  ): Promise<boolean>;
}

/** One per Gallery page instance. */
export function createGalleryOwnership(): GalleryOwnership {
  let visit = 0;
  let slicer = 0;
  const ownership: GalleryOwnership = {
    download: () => ({ visit, slicer: null }),
    slicer: () => {
      slicer += 1;
      return { visit, slicer };
    },
    isCurrent: (token) => token.visit === visit && (token.slicer === null || token.slicer === slicer),
    endVisit: () => {
      visit += 1;
    },
    whenCurrent: async (action, getUrl, act) => {
      const token = action === 'slicer' ? ownership.slicer() : ownership.download();
      const url = await getUrl();
      if (!url || !ownership.isCurrent(token)) return false;
      act(url);
      return true;
    },
  };
  return ownership;
}
