import { isDevHost } from '@/lib/isDevHost';

/**
 * Completion-time ownership for async work on /upload: image loads,
 * slicing, background removal, file loads and the restore flow.
 *
 * An operation captures a token when it starts and applies its result only
 * if the token is still current when it completes. A token goes stale when
 * the sprite store's sheetVersion moves (a sheet was installed, replaced,
 * restored or cleared) or the page's epoch moves (a newer user action took
 * over the uploaded image or the sheet, or the page unmounted). Checking
 * before the operation starts is not enough: the newer action can land
 * while it is still running.
 */

export interface SheetToken {
  readonly sheetVersion: number;
  readonly epoch: number;
}

export interface SheetOwnership {
  /** Token for an operation starting now. */
  capture(): SheetToken;
  /** True while nothing newer has happened since the token was captured. */
  isCurrent(token: SheetToken): boolean;
  /** A newer user action takes over the uploaded image or the sheet, or the
   *  page unmounts: every token captured before now goes stale. */
  bump(): void;
}

/** One per page instance. `readSheetVersion` reads the sprite store's
 *  sheetVersion at call time. */
export function createSheetOwnership(readSheetVersion: () => number): SheetOwnership {
  let epoch = 0;
  return {
    capture: () => ({ sheetVersion: readSheetVersion(), epoch }),
    isCurrent: (token) => token.sheetVersion === readSheetVersion() && token.epoch === epoch,
    bump: () => {
      epoch += 1;
    },
  };
}

/** One console line per dropped result, on dev hosts only (localhost and
 *  the dev URL, where NODE_ENV is 'production' too). */
export function noteStale(what: string): void {
  if (isDevHost()) console.info(`[upload] dropped a stale ${what}: something newer happened first`);
}
