/**
 * Completion-time ownership for the Gallery's actions that wait for an
 * animation's clean copy: Download and Send to Slicer (Second 118).
 *
 * An action captures a token when it is clicked and acts only if the token is
 * still current when the clean copy is ready, as /upload's async work does
 * (src/lib/sheetOwnership.ts). Every token goes stale when the Gallery's visit
 * ends: the page unmounts or its account changes. A Send to Slicer token also
 * goes stale when a newer Send to Slicer is clicked, since the newest choice
 * is the one the Slicer opens. Downloads do not replace each other or a Slicer
 * choice: each Download click asked for its own file.
 */

export interface GalleryToken {
  readonly visit: number;
  /** The Send to Slicer click this token belongs to; null for a Download. */
  readonly slicer: number | null;
}

export interface GalleryOwnership {
  /** Token for a Download clicked now. */
  download(): GalleryToken;
  /** Token for a Send to Slicer clicked now; every earlier Slicer token goes stale. */
  slicer(): GalleryToken;
  /** True while the token's visit lasts and, for Send to Slicer, no newer one was clicked. */
  isCurrent(token: GalleryToken): boolean;
  /** The Gallery unmounts or its account changes: every token captured before now goes stale. */
  endVisit(): void;
}

/** One per Gallery page instance. */
export function createGalleryOwnership(): GalleryOwnership {
  let visit = 0;
  let slicer = 0;
  return {
    download: () => ({ visit, slicer: null }),
    slicer: () => {
      slicer += 1;
      return { visit, slicer };
    },
    isCurrent: (token) => token.visit === visit && (token.slicer === null || token.slicer === slicer),
    endVisit: () => {
      visit += 1;
    },
  };
}
