import type { Metadata } from 'next';
import { Press_Start_2P, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import AppShell from '@/components/layout/AppShell';
import './globals.css';

const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SpriteBrew — Pixel Art Sprite Sheet Generator',
  description: 'Brew pixel-perfect sprite sheets for your game. Upload, preview, and export to Unity, Godot, GameMaker, RPG Maker, and more.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      // Disable Clerk's auto-POST to the current page on auth state changes.
      // Without this, signing out on static pages like /generate or /gallery
      // triggers a POST to that URL which Cloudflare Pages returns as 405.
      // We don't rely on middleware re-running on sign-out (protection is
      // enforced at the API route and page-component level).
      // Server ClerkProvider types strip this prop via `Without<...>`, but the
      // underlying client provider still honors it when forwarded via JSX.
      // @ts-expect-error — intentional: bypass server prop stripping
      __internal_invokeMiddlewareOnAuthStateChange={false}
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
      <html lang="en" className={`${pressStart.variable} ${jetbrainsMono.variable}`}>
        <body>
          <AppShell>{children}</AppShell>
        </body>
      </html>
    </ClerkProvider>
  );
}
