import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo';

// /sign-up's title (HQ 2026-11-17-101).
export const metadata: Metadata = pageMetadata('Sign Up | SpriteBrew');

export default function SignUpLayout({ children }: { children: ReactNode }) {
  return children;
}
