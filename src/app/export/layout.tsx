import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo';

// /export's title (HQ 2026-11-17-101).
export const metadata: Metadata = pageMetadata('Export | SpriteBrew');

export default function ExportLayout({ children }: { children: ReactNode }) {
  return children;
}
