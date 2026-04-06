import type { Metadata } from 'next';
import { Press_Start_2P, JetBrains_Mono } from 'next/font/google';
import ClerkClientProvider from '@/components/layout/ClerkClientProvider';
import AppShell from '@/components/layout/AppShell';
import WhatsNew from '@/components/layout/WhatsNew';
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
  title: 'SpriteBrew — AI-Powered Pixel Art Sprite Sheets',
  description: 'Describe a character, pick a moveset, and let AI generate game-ready animations. Upload your own art or create from scratch. Export to Unity, Godot, or GameMaker in one click.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${pressStart.variable} ${jetbrainsMono.variable}`}>
      <body>
        <ClerkClientProvider>
          <AppShell>{children}</AppShell>
          <WhatsNew />
        </ClerkClientProvider>
      </body>
    </html>
  );
}
