import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NOINDEX, pageMetadata } from '@/lib/seo';

// /gallery's title (HQ 2026-11-17-101); kept out of search: it holds a person's own work or account.
export const metadata: Metadata = { ...pageMetadata('Gallery | SpriteBrew'), robots: NOINDEX };

export default function GalleryLayout({ children }: { children: ReactNode }) {
  return children;
}
