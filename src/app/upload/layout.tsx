import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo';

// /upload's title and description (HQ 2026-11-17-101).
export const metadata: Metadata = pageMetadata(
  'Sprite Sheet Slicer: Cut a Sheet into Frames | SpriteBrew',
  'Upload a sprite sheet and slice it into frames by grid or automatically, then preview, edit and export them. Free, no account needed.',
);

export default function UploadLayout({ children }: { children: ReactNode }) {
  return children;
}
