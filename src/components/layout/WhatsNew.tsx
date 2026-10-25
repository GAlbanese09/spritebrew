'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { CURRENT_VERSION, releaseLabel, releasesSince, type Release } from '@/lib/changelog';

/**
 * "What's New" modal.
 *
 * Shows when a visitor returns after a new release, with only the releases
 * newer than the version stored at their last visit, and a link to the full
 * list on /updates. First-ever visitors don't see it (they are already on the
 * latest version, so there is nothing to announce to them).
 */

const STORAGE_KEY = 'spritebrew_seen_version';

export default function WhatsNew() {
  const [releases, setReleases] = useState<Release[]>([]);
  const open = releases.length > 0;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // First-ever visitors (no stored value) get silently marked as up to date.
      if (stored === null) {
        localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
        return;
      }
      if (stored === CURRENT_VERSION) return;
      // A stored version past this one (after a rollback) is left as it is,
      // so rolling forward again does not show the same notes twice.
      const unseen = releasesSince(stored);
      if (unseen.length > 0) setReleases(unseen);
    } catch {
      // localStorage unavailable: don't show the modal
    }
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
    } catch {
      // ignore
    }
    setReleases([]);
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

        {/* What changed since the last visit, scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {releases.map((release, index) => (
            <section key={release.version} className="space-y-3">
              <div className={`flex items-center gap-2 pb-1 ${index === 0 ? 'pt-0' : 'pt-3'}`}>
                <div className="h-px flex-1" style={{ backgroundColor: '#3a3430' }} />
                <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider whitespace-nowrap">
                  {releaseLabel(release)}
                </span>
                <div className="h-px flex-1" style={{ backgroundColor: '#3a3430' }} />
              </div>
              {release.entries.map((entry, i) => (
                <div key={`${release.version}-${i}`} className="flex items-start gap-3">
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
            </section>
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
          <a
            href="/updates"
            onClick={handleDismiss}
            className="block mt-3 text-center text-[11px] font-mono text-text-muted underline underline-offset-2 hover:text-accent-amber transition-colors"
          >
            See all updates
          </a>
        </div>
      </div>
    </div>
  );
}
