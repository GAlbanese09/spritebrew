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

export const CURRENT_VERSION = '0.4.0';

const STORAGE_KEY = 'spritebrew_seen_version';

interface ChangelogEntry {
  emoji: string;
  title: string;
  description: string;
}

const CHANGELOG: ChangelogEntry[] = [
  // ── 0.4.0 — Daily Brew & Pixel Polish (May 2026) ──
  {
    emoji: '🔥',
    title: 'Daily Login Rewards',
    description:
      'Earn +3 tokens every day you generate. Streak builds with each consecutive day.',
  },
  {
    emoji: '⭐',
    title: '7-Day Streak Bonus',
    description:
      'Hit a 7-day streak and earn +6 tokens instead of +3. Miss a day and the streak resets.',
  },
  {
    emoji: '📬',
    title: 'Newsletter Signup Bonus',
    description:
      'Subscribe to product updates from inside the app and earn +5 tokens. One-time, your account email only.',
  },
  {
    emoji: '🖼️',
    title: 'Reference Images on Pro Styles',
    description:
      'Attach up to 9 images to guide the style, palette, and design feel of your generation. Pro tier only.',
  },
  {
    emoji: '↔️',
    title: 'Sprite-Flip Toggle',
    description:
      'Demo Area now lets you flip your sprite’s natural facing — fixes moonwalk on left-facing sheets.',
  },
  {
    emoji: '🔍',
    title: 'Pixel-Perfect Demo Area',
    description:
      'Integer-scale rendering (1×/2×/4×/8×) with drop shadows. Crisp pixels at every zoom level.',
  },
  {
    emoji: '🎬',
    title: 'Showcase Mode',
    description:
      'Press F in the Demo Area for distraction-free fullscreen preview. Esc or F to exit.',
  },
  // ── 0.3.0 — Token Economy ──
  {
    emoji: '🪙',
    title: 'Token Economy',
    description:
      'Replaced daily limits with tokens. Signup bonus, token packs from $4.99, and tokens that never expire.',
  },
  {
    emoji: '💳',
    title: 'Buy Token Packs',
    description:
      'Purchase tokens via Stripe. Four packs available — Starter, Creator, Studio, and Pro.',
  },
  {
    emoji: '📜',
    title: 'Refund Policy',
    description:
      'Refund policy now live. 14-day refund on unused token packs. See /refund-policy for full terms.',
  },
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
