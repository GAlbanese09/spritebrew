import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo';

// /preview's title (HQ 2026-11-17-101).
export const metadata: Metadata = pageMetadata('Preview | SpriteBrew');

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return children;
}
