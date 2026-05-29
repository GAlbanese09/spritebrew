'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

/**
 * "What's New" modal.
 *
 * Shows once per version whenever the user returns after a new release.
 * First-ever visitors don't see the changelog (they're already on the
 * latest version — there's nothing to announce to them).
 */

export const CURRENT_VERSION = '0.5.8';

const STORAGE_KEY = 'spritebrew_seen_version';

interface ChangelogEntry {
  emoji: string;
  title: string;
  description: string;
  releaseLabel?: string;  // shown as a section header above this entry
}

const CHANGELOG: ChangelogEntry[] = [
  // ── 0.5.8 — Send to Animator + BG Control (May 28, 2026) ──
  {
    releaseLabel: 'MAY 28, 2026 — SEND TO ANIMATOR + BG CONTROL',
    emoji: '🎬',
    title: 'Send your generated sprites straight to the Animator',
    description:
      'Added a "Send to Animator" button on every Create-mode generation result. Click it to drop your sprite straight into the Animate flow with no download-and-reupload step. Now you can also choose whether to keep your sprite\'s background — your "Remove background" choice from the result carries through to AutoPrep, and there is a new "Skip background removal" toggle for when you want to keep the original background completely intact.',
  },
  // ── 0.5.7 — Send to Editor (May 27, 2026) ──
  {
    releaseLabel: 'MAY 27, 2026 — SEND TO EDITOR',
    emoji: '🖌️',
    title: 'Send your generated sprites straight to the Pixel Editor',
    description:
      "Added a new 'Send to Editor' button on every generation result. Click it to open your sprite in the Pixel Editor for pixel-level refinements — perfect for cleaning up small details the AI got slightly wrong. Honors the 'Remove background' toggle so you get the variant you saw on the result.",
  },
  // ── 0.5.6 — Gallery Goes Server-Side (May 22, 2026) ──
  {
    releaseLabel: 'MAY 22, 2026 — GALLERY GOES SERVER-SIDE',
    emoji: '🌐',
    title: 'Your gallery now syncs across devices',
    description:
      'Sign in on any browser or device and your generations are there. No more losing work when you clear your browser cache.',
  },
  // ── 0.5.5 — Editor Has a Home (May 21, 2026) ──
  {
    releaseLabel: 'MAY 21, 2026 — EDITOR HAS A HOME',
    emoji: '🎨',
    title: 'Pixel Editor now has its own tab',
    description:
      'Find it as "Edit" in the sidebar. Start a blank canvas at any size or upload an image to edit pixel by pixel. No more digging through Generate → Animate → upload to find the editor.',
  },
  {
    emoji: '🧩',
    title: 'Editor toolbar layout fixed',
    description:
      'The color palette no longer clips at the right edge. Cleaner editor surface across the board.',
  },
  // ── 0.5.4 — Slicer Quick Export (May 20, 2026) ──
  {
    releaseLabel: 'MAY 20, 2026 — SLICER QUICK EXPORT',
    emoji: '📦',
    title: 'Quick download all sliced frames',
    description:
      'After slicing your sprite sheet on the Upload & Slice page, you can now download every frame as a separate transparent PNG with a single click. Look for "Download all frames (PNG ZIP)" right next to "Continue to Preview."',
  },
  // ── 0.5.3 — Editor Foundation (May 19, 2026) ──
  {
    releaseLabel: 'MAY 19, 2026 — EDITOR FOUNDATION',
    emoji: '💾',
    title: 'Your edits are safe now',
    description:
      'Clicking outside the editor or pressing Esc with unsaved work now asks before discarding. Auto-save coming next.',
  },
  {
    emoji: '🖌️',
    title: 'Brush sizes',
    description:
      'Pencil and eraser now support sizes 1, 2, 4, 8, and 16 pixels. Use [ and ] keys to cycle.',
  },
  {
    emoji: '⚡',
    title: 'Editor under the hood',
    description:
      'Big architectural upgrade — the editor is now built on a foundation that will support animation preview, palette swap, and onion skinning in upcoming releases.',
  },
  // ── 0.5.2 — Style Preview Upgrade (May 12, 2026) ──
  {
    releaseLabel: 'MAY 12, 2026 — STYLE PREVIEW UPGRADE',
    emoji: '🎨',
    title: 'See examples for every style',
    description:
      'Tap the ⤢ icon on any style card to open a carousel showing what each style actually produces. 15 of 21 styles now have curated examples — animation previews coming in a future release.',
  },
  {
    emoji: '🌅',
    title: 'Background toggle on the generate bar',
    description:
      "The 'Remove background' control is now always visible on the sticky generate bar — no more hunting through the form. Default is on for character styles, off for tiles. Toggle off to keep environmental detail in your generation.",
  },
  {
    emoji: '📐',
    title: 'Larger downloads coming soon',
    description:
      "All generations output at 256×256 native pixel grid — the right size for sprite sheets and pixel-perfect game engines. Some example images may display at larger sizes; a 'Download at 2× / 4×' option for upscaled PNG output is coming in a future release.",
  },
  // ── 0.5.1 — UX Polish (May 10, 2026) ──
  {
    releaseLabel: 'MAY 10, 2026 — UX POLISH',
    emoji: '🎯',
    title: 'Always-visible Generate button',
    description:
      'The Generate button now stays pinned at the bottom of the screen while you scroll through styles or settings. No more scrolling back up after picking your style.',
  },
  {
    emoji: '📁',
    title: 'Collapsible style picker',
    description:
      'Each style category (Characters, Items, Tiles, UI, Animations) now collapses with a single click. Focus on the kind of sprite you want without wading through every option.',
  },
  {
    emoji: '📱',
    title: 'Mobile polish',
    description:
      'Better layouts, bigger tap targets, and a cleaner Generate bar that stacks gracefully on phones and tablets.',
  },
  // ── 0.5.0 — Reliability (May 2026) ──
  {
    releaseLabel: 'May 10, 2026 — Reliability',
    emoji: '🛡️',
    title: 'More reliable generations',
    description:
      "We've made big improvements behind the scenes so generations finish smoothly even when they take a while. If anything ever goes wrong, your tokens are refunded automatically.",
  },
  // ── 0.4.0 — Daily Brew & Pixel Polish (May 2026) ──
  {
    releaseLabel: 'May 2026 — Daily Brew & Pixel Polish',
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
    releaseLabel: 'Earlier — Token Economy & Foundations',
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
            <Fragment key={i}>
              {entry.releaseLabel && (
                <div className="flex items-center gap-2 pt-3 pb-1 first:pt-0">
                  <div className="h-px flex-1" style={{ backgroundColor: '#3a3430' }} />
                  <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider whitespace-nowrap">
                    {entry.releaseLabel}
                  </span>
                  <div className="h-px flex-1" style={{ backgroundColor: '#3a3430' }} />
                </div>
              )}
              <div className="flex items-start gap-3">
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
            </Fragment>
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
