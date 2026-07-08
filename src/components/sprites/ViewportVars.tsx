'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Drives --app-vh from the visual viewport so the editor shell height matches
// what's actually visible on iOS Safari. 100dvh alone is throttled and goes
// stale across orientation changes, leaving the overflow-hidden shell taller
// than the viewport and pushing the bottom toolbar below the fold. The delayed
// resyncs catch iOS settling the viewport over several phases after a rotate.
const RESYNC_DELAYS = [50, 250, 500, 1000] as const;

export function ViewportVars() {
  // Wave M2.2: expose the mount effect's resync() to a route-change trigger.
  // A ref (assigned inside the mount effect) keeps the mount effect's closure
  // byte-for-byte identical to what shipped before — no logic hoisting, no
  // dep-array churn. The pathname effect just calls resyncRef.current?.() on
  // every pathname change (including initial mount, which harmlessly runs
  // resync twice — same writes, idempotent).
  const resyncRef = useRef<(() => void) | null>(null);
  const pathname = usePathname();

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
    // Wave M2.2: publish resync so the pathname effect can trigger it on
    // client-side navigation (iOS Safari fires no visualViewport events
    // during a route change, so URL-bar chrome that transitions during nav
    // — e.g. Preview → Export — leaves --app-vh / --app-top stale until a
    // pinch forces a layout).
    resyncRef.current = resync;
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
      resyncRef.current = null;
    };
  }, []);

  // Wave M2.2: re-run the staggered resync chain on every client-side route
  // change. iOS Safari's URL-bar chrome transitions during navigation without
  // firing visualViewport events, so vars written for the previous page are
  // stale until a real gesture (pinch, scroll, rotate) forces Safari to fire.
  // Fires on initial mount too — harmless: same writes as the mount effect's
  // resync(), and the mount effect always runs first because useLayoutEffect
  // precedes useEffect within a single commit.
  useEffect(() => {
    resyncRef.current?.();
  }, [pathname]);

  return null;
}
