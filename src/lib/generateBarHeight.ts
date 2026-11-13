/**
 * The real height of the Create form's Generate bar, for what sits just
 * above it (GenerationErrorNotice). The form marks its bar with
 * data-generate-bar. The bar's height follows its content: a reason line
 * under the button, a reason on two lines, the phone layout. A fixed offset
 * ends up over the bar in some of those (PR #53, audit pass on fix 3, G3).
 *
 * The browser's parts are passed in, so this is tested without a page.
 */
export const GENERATE_BAR_SELECTOR = '[data-generate-bar]';

/** The space kept between the bar and what sits above it. */
export const GENERATE_BAR_GAP_PX = 8;

export interface BarEnv<T extends { offsetHeight: number }> {
  /** The marked bar, or null when none is on the page. */
  find: () => T | null;
  /** Calls back whenever that element's size changes; returns the stop. */
  observeSize: (bar: T, onChange: () => void) => () => void;
  /** Calls back whenever elements are added or removed; returns the stop. */
  observeTree: (onChange: () => void) => () => void;
}

/** The bar's height in px, or null when no marked bar is showing (none on
 *  the page, or one that takes no room). */
export function readBarHeight(find: () => { offsetHeight: number } | null): number | null {
  const height = find()?.offsetHeight ?? 0;
  return height > 0 ? height : null;
}

/**
 * Calls onChange whenever the bar's height may have changed: the bar was
 * resized, it left the page, or another one arrived. Returns the stop.
 * Nothing is called for the bar found at the start: the caller reads the
 * height itself once it is watching.
 */
export function watchBar<T extends { offsetHeight: number }>(env: BarEnv<T>, onChange: () => void): () => void {
  let watched: T | null = null;
  let stopSize: (() => void) | null = null;
  const attach = (announce: boolean) => {
    const bar = env.find();
    if (bar === watched) return;
    stopSize?.();
    watched = bar;
    stopSize = bar ? env.observeSize(bar, onChange) : null;
    if (announce) onChange();
  };
  const stopTree = env.observeTree(() => attach(true));
  attach(false);
  return () => {
    stopTree();
    stopSize?.();
    stopSize = null;
    watched = null;
  };
}
