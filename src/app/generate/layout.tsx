import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo';

// /generate's title and description (HQ 2026-11-17-101).
export const metadata: Metadata = pageMetadata(
  'AI Pixel Art Sprite and Animation Generator | SpriteBrew',
  'Describe a character and get a pixel art sprite, or animate it into a walk, idle or attack sprite sheet. Bring your own character too. Start free.',
);

export default function GenerateLayout({ children }: { children: ReactNode }) {
  return children;
}
