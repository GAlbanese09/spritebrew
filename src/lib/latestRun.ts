/**
 * Latest-run tracking for async work that can overlap.
 *
 * Each start() takes the next run number and returns an isLatest() for that
 * run. After every await, a run that is no longer the latest must return
 * without touching any state, so an older run that finishes last cannot
 * overwrite a newer one, and the pieces a run writes (for example a source
 * canvas and the regions detected on it) always come from the same run.
 *
 * Pure and framework-free so an offline script can drive it; a component
 * keeps one tracker in a ref for its lifetime.
 */
export interface LatestRun {
  /** Begin a run: the returned function says whether this run is still the latest. */
  start(): () => boolean;
  /** The number of runs started so far. */
  count(): number;
}

export function createLatestRun(): LatestRun {
  let latest = 0;
  return {
    start() {
      const id = ++latest;
      return () => latest === id;
    },
    count() {
      return latest;
    },
  };
}
