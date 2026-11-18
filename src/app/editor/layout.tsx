import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo';

// /editor's title (HQ 2026-11-17-101).
export const metadata: Metadata = pageMetadata('Edit | SpriteBrew');

export default function EditorLayout({ children }: { children: ReactNode }) {
  return children;
}
