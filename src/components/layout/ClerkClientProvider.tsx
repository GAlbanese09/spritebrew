'use client';

import { ClerkProvider } from '@clerk/react';
import type { ReactNode } from 'react';

/**
 * Client-side ClerkProvider wrapper.
 *
 * @clerk/react is a pure client SDK — unlike @clerk/nextjs it does not have a
 * server variant, so it must be rendered inside a 'use client' boundary.
 *
 * We deliberately switched from @clerk/nextjs to @clerk/react to avoid the
 * Cloudflare Pages 405 error on sign-out: @clerk/nextjs POSTs to the current
 * page URL to sync middleware, and static pages on Cloudflare return 405.
 * @clerk/react talks directly to Clerk's Frontend API via CORS — no POSTs to
 * our own origin.
 */
export default function ClerkClientProvider({ children }: { children: ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    // Missing key — render children without auth so free features still work
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: '#d4871c',
          colorBackground: '#1a1614',
          colorText: '#e8dcc8',
          colorTextSecondary: '#a89880',
          colorInputBackground: '#2a2420',
          colorInputText: '#e8dcc8',
          colorNeutral: '#e8dcc8',
          borderRadius: '0.5rem',
          fontFamily: 'JetBrains Mono, monospace',
        },
        elements: {
          card: { backgroundColor: '#1e1a16', borderColor: '#3a3430' },
          headerTitle: { color: '#e8dcc8' },
          headerSubtitle: { color: '#a89880' },
          formFieldLabel: { color: '#e8dcc8' },
          formButtonPrimary: { backgroundColor: '#d4871c', color: '#121010' },
          footerActionLink: { color: '#d4871c' },
          userButtonPopoverCard: { backgroundColor: '#1e1a16', borderColor: '#3a3430' },
          userPreviewMainIdentifier: { color: '#e8dcc8' },
          userPreviewSecondaryIdentifier: { color: '#a89880' },
          profileSectionTitle: { color: '#e8dcc8' },
          profileSectionContent: { color: '#a89880' },
          navbarButton: { color: '#e8dcc8' },
          navbarButtonIcon: { color: '#a89880' },
          menuButton: { color: '#e8dcc8' },
          menuItem: { color: '#e8dcc8' },
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
