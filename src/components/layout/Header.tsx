'use client';

import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/upload': 'Upload & Slice',
  '/preview': 'Preview & Play',
  '/export': 'Export',
  '/gallery': 'Gallery',
  '/generate': 'AI Generate',
};

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? 'SpriteBrew';

  return (
    <header className="flex items-center gap-4 border-b border-border-default bg-bg-secondary/50 px-6 py-4 backdrop-blur-sm">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
      >
        <Menu size={20} />
      </button>
      <h1 className="text-sm font-mono font-medium text-text-primary tracking-wide">
        {title}
      </h1>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono text-text-muted uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-teal animate-pulse" />
          Ready
        </span>
      </div>
    </header>
  );
}
