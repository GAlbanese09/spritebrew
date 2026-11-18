'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Header from './Header';
import GenerationPauseBanner from './GenerationPauseBanner';
import RewardModal from '@/components/rewards/RewardModal';
import GenerationErrorNotice from '@/components/sprites/GenerationErrorNotice';
import { ViewportVars } from '@/components/sprites/ViewportVars';
import { GENERATE_BAR_GAP_PX } from '@/lib/generateBarHeight';
import { useGenerateBarHeight } from './useGenerateBarHeight';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  // /editor renders flush below the Header (no page padding, no main scroll)
  // so its h-editor-page grid fills exactly the visible area and the mobile
  // bottom toolbar doesn't get pushed below the fold by AppShell padding.
  const isEditor = pathname === '/editor';
  // On /generate, <main> keeps its bottom scroll padding 8 px taller than the
  // Generate bar, so a control scrolled into view (and its focus ring) is
  // never under the bar (DESIGN generate-pass.md section 1, G1).
  const barHeight = useGenerateBarHeight(pathname === '/generate');

  // The landing page at / has its own nav and layout — no sidebar/header.
  if (pathname === '/') {
    return (
      <>
        <GenerationPauseBanner />
        {children}
        <RewardModal />
      </>
    );
  }

  // Fix note 15: every route but /editor takes h-app-shell, which ignores zoom
  // and does not shrink for the on-screen keyboard (src/lib/appShellHeight.ts).
  // A shell that shrank to the area above the keyboard left the rest of the
  // screen blank once iOS Safari scrolled up to the focused field. /editor
  // keeps h-app-vh, which its h-editor-page grid is sized against.
  return (
    <div className={`flex ${isEditor ? 'h-app-vh' : 'h-app-shell'} overflow-hidden`}>
      {/* Single app-wide instance of the visible-viewport publisher. Writes
          --app-vh / --app-top to document.documentElement from visualViewport
          so every fixed-positioned surface (editor modal, sticky bars, etc.)
          can anchor to the real visible viewport on iOS Safari instead of the
          layout viewport (which includes URL bar / notch zones). Hoisted here
          from PixelEditorBody so the vars are populated well before any modal
          opens. Landing route bypasses AppShell entirely and doesn't need it. */}
      <ViewportVars />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col lg:ml-[var(--sidebar-width)]">
        <GenerationPauseBanner />
        <Header onMenuClick={() => setSidebarOpen(true)} />

        {/* `relative`: <main> is the page's scroller, and it has to be the
            containing block for what it holds. Without it, an absolutely
            placed element with no positioned ancestor (every `sr-only`
            status line is one) is laid out against the document instead,
            the document grows taller than the window, and a wheel turn or a
            drag over the sidebar or the header slides the whole app up. */}
        <main
          className={`relative flex-1 pixel-grid overscroll-none ${isEditor ? 'overflow-hidden' : 'overflow-y-auto'}`}
          style={barHeight === null ? undefined : { scrollPaddingBottom: barHeight + GENERATE_BAR_GAP_PX }}
        >
          <div className={isEditor ? 'h-full' : 'p-6 sm:p-8'}>
            {children}
            {/* While the Generate bar shows, real room at the end as tall as the
                bar, so the page's last controls can scroll clear of it (AUDIT
                g1-tabs-r1 M3); the scroll padding keeps a focused one clear. */}
            {barHeight !== null && <div aria-hidden="true" data-bar-room="" style={{ height: barHeight }} />}
          </div>
        </main>
      </div>

      <GenerationErrorNotice />
      <RewardModal />
    </div>
  );
}
