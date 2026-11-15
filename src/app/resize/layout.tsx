import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// /resize's own title and description (HQ 2026-11-15-102); the canonical
// stays per page, from the root layout.
export const metadata: Metadata = {
  title: 'Free Pixel Art Resizer | SpriteBrew',
  description: 'Resize pixel art and sprite sheets without blurring. Shrink or grow by whole steps, free, no account, and your image never leaves your browser.',
};

export default function ResizeLayout({ children }: { children: ReactNode }) {
  return children;
}
