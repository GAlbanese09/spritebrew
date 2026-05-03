'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Header from './Header';
import RewardModal from '@/components/rewards/RewardModal';

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // The landing page at / has its own nav and layout — no sidebar/header.
  if (pathname === '/') {
    return (
      <>
        {children}
        <RewardModal />
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col lg:ml-[var(--sidebar-width)]">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto pixel-grid">
          <div className="p-6 sm:p-8">
            {children}
          </div>
        </main>
      </div>

      <RewardModal />
    </div>
  );
}
