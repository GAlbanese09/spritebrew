'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

/**
 * "What's New" modal.
 *
 * Shows once per version whenever the user returns after a new release.
 * First-ever visitors don't see the changelog (they're already on the
 * latest version — there's nothing to announce to them).
 */

export const CURRENT_VERSION = '0.2.0';

const STORAGE_KEY = 'spritebrew_seen_version';

interface ChangelogEntry {
  emoji: string;
  title: string;
  description: string;
}

const CHANGELOG: ChangelogEntry[] = [
  {
    emoji: '✨',
    title: 'Animate My Character',
    description:
      'Upload your pixel art and generate walk, idle, and attack animations from it.',
  },
  {
    emoji: '🔍',
    title: 'Auto-Detect Sprites',
    description:
      'Find individual sprites in any layout — no grid required. Uses contour detection.',
  },
  {
    emoji: '🪄',
    title: 'Auto-Prep Character',
    description:
      'Drop any image — SpriteBrew finds, crops, removes background, and resizes your character automatically.',
  },
  {
    emoji: '🔐',
    title: 'Sign In to Generate',
    description:
      'Free account required for AI features. Upload, slice, preview, and export stay free.',
  },
  {
    emoji: '🖼️',
    title: 'Generation Gallery',
    description: 'Browse past generations. Filter, download, or send to slicer.',
  },
  {
    emoji: '📐',
    title: 'Smart Image Resizer',
    description:
      'Choose target frame size — SpriteBrew calculates sheet dimensions automatically.',
  },
  {
    emoji: '🖌️',
    title: 'Pixel Editor',
    description: 'Click any frame to edit. Pencil, eraser, eyedropper, undo/redo.',
  },
  {
    emoji: '🎯',
    title: 'Background Removal',
    description: 'Remove solid backgrounds from generated animations automatically.',
  },
];

export default function WhatsNew() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // Only show if there's a stored version AND it's different from current.
      // First-ever visitors (no stored value) get silently marked as up-to-date.
      if (stored === null) {
        localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
        return;
      }
      if (stored !== CURRENT_VERSION) {
        setOpen(true);
      }
    } catch {
      // localStorage unavailable — don't show the modal
    }
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    } catch {
      // ignore
    }
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 animate-[whatsNewFadeIn_0.2s_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div
        className="relative w-full max-w-lg max-h-[70vh] flex flex-col rounded-xl border shadow-2xl animate-[whatsNewSlideUp_0.3s_ease-out]"
        style={{ backgroundColor: '#1e1a16', borderColor: '#3a3430' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: '#3a3430' }}
        >
          <div>
            <h2 className="text-sm font-mono font-semibold text-accent-amber">
              🧪 What&apos;s New in SpriteBrew
            </h2>
            <p className="text-[10px] font-mono text-text-muted mt-0.5 uppercase tracking-wider">
              Version {CURRENT_VERSION}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-colors"
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>

        {/* Changelog list — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {CHANGELOG.map((entry, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex-shrink-0 text-xl leading-none pt-0.5">
                {entry.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-xs font-mono font-semibold text-text-primary">
                  {entry.title}
                </h3>
                <p className="text-[11px] font-mono text-text-muted leading-relaxed mt-0.5">
                  {entry.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer action */}
        <div
          className="px-5 py-4 border-t flex-shrink-0"
          style={{ borderColor: '#3a3430' }}
        >
          <button
            onClick={handleDismiss}
            className="w-full px-4 py-2.5 rounded-md bg-accent-amber text-bg-primary text-sm font-mono font-semibold
              hover:bg-accent-amber-strong cursor-pointer transition-colors"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
}
