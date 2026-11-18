'use client';

import { useSyncExternalStore } from 'react';
import { readBarHeight, watchBar, GENERATE_BAR_SELECTOR, type BarEnv } from '@/lib/generateBarHeight';

/**
 * The Generate bar's measured height in px, or null while no bar shows
 * (src/lib/generateBarHeight.ts). Watches only while `active`: the bar is on
 * /generate alone, so no other page pays for the watch.
 */
const browserBar: BarEnv<HTMLElement> = {
  find: () => document.querySelector<HTMLElement>(GENERATE_BAR_SELECTOR),
  observeSize: (bar, onChange) => {
    const sizes = new ResizeObserver(onChange);
    sizes.observe(bar);
    return () => sizes.disconnect();
  },
  observeTree: (onChange) => {
    const nodes = new MutationObserver(onChange);
    nodes.observe(document.body, { childList: true, subtree: true });
    return () => nodes.disconnect();
  },
};
const subscribeBar = (onChange: () => void) => watchBar(browserBar, onChange);
const subscribeNone = () => () => {};
const getBarHeight = () => readBarHeight(browserBar.find);
const getNone = () => null;

export function useGenerateBarHeight(active: boolean): number | null {
  return useSyncExternalStore(active ? subscribeBar : subscribeNone, active ? getBarHeight : getNone, getNone);
}
