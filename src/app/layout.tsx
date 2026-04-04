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
      appearance={{
        variables: {
          colorPrimary: '#d4871c',
          colorBackground: '#1a1614',
          colorText: '#e8dcc8',
          colorInputBackground: '#2a2420',
          colorInputText: '#e8dcc8',
          borderRadius: '0.5rem',
          fontFamily: 'JetBrains Mono, monospace',
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
