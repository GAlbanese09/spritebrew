import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo';

// /sign-in's title (HQ 2026-11-17-101).
export const metadata: Metadata = pageMetadata('Sign In | SpriteBrew');

export default function SignInLayout({ children }: { children: ReactNode }) {
  return children;
}
