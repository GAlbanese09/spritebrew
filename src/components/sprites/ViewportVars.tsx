'use client';

import { useLayoutEffect } from 'react';

// Drives --app-vh from the visual viewport so the editor shell height matches
// what's actually visible on iOS Safari. 100dvh alone is throttled and goes
// stale across orientation changes, leaving the overflow-hidden shell taller
// than the viewport and pushing the bottom toolbar below the fold. The delayed
// resyncs catch iOS settling the viewport over several phases after a rotate.
const RESYNC_DELAYS = [50, 250, 500, 1000] as const;

export function ViewportVars() {
  useLayoutEffect(() => {
    let raf = 0;
    let timers: number[] = [];
    const setVar = () => {
      const vv = window.visualViewport;
      const h = Math.floor(vv?.height ?? window.innerHeight);
      const top = Math.floor(vv?.offsetTop ?? 0);
      document.documentElement.style.setProperty('--app-vh', `${h}px`);
      document.documentElement.style.setProperty('--app-top', `${top}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(setVar);
    };
    const resync = () => {
      schedule();
      timers.forEach(clearTimeout);
      timers = RESYNC_DELAYS.map((d) => window.setTimeout(schedule, d));
    };
    // Use the same staggered settle chain that the rotate path uses, not a
    // one-shot read. iOS doesn't report a settled visualViewport.offsetTop at
    // the instant a fixed modal mounts; resync() schedules an immediate rAF
    // write plus 50/250/500/1000ms re-reads so the vars converge to correct
    // within ~50ms — no user gesture required.
    resync();
    const vv = window.visualViewport;
    window.addEventListener('resize', resync, { passive: true });
    window.addEventListener('orientationchange', resync, { passive: true });
    window.addEventListener('pageshow', resync);
    document.addEventListener('visibilitychange', resync);
    vv?.addEventListener('resize', resync, { passive: true });
    vv?.addEventListener('scroll', resync, { passive: true });
    window.screen?.orientation?.addEventListener?.('change', resync);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', resync);
      window.removeEventListener('orientationchange', resync);
      window.removeEventListener('pageshow', resync);
      document.removeEventListener('visibilitychange', resync);
      vv?.removeEventListener('resize', resync);
      vv?.removeEventListener('scroll', resync);
      window.screen?.orientation?.removeEventListener?.('change', resync);
    };
  }, []);
  return null;
}
