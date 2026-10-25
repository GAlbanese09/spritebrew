import type { Metadata } from 'next';
import { RELEASES, releaseLabel } from '@/lib/changelog';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Updates | SpriteBrew',
  description: 'Every SpriteBrew update, newest first.',
};

export default function UpdatesPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-lg font-display text-accent-amber mb-1">Updates</h1>
      <p className="text-xs font-mono text-text-muted mb-8">Every SpriteBrew update, newest first.</p>

      <div className="space-y-4">
        {RELEASES.map((release, index) => (
          <details
            key={release.version}
            open={index === 0}
            className="group rounded-lg border border-border-default bg-bg-secondary/50"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-text-secondary">
                <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
                  &#9656;
                </span>
                {releaseLabel(release)}
              </span>
              <span className="text-[10px] font-mono text-text-muted whitespace-nowrap">
                v{release.version}
              </span>
            </summary>
            <ul className="space-y-3 border-t border-border-subtle px-4 py-4">
              {release.entries.map((entry, i) => (
                <li key={`${release.version}-${i}`} className="flex items-start gap-3">
                  <span className="flex-shrink-0 text-xl leading-none pt-0.5" aria-hidden="true">
                    {entry.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xs font-mono font-semibold text-text-primary">{entry.title}</h2>
                    <p className="text-[11px] font-mono text-text-muted leading-relaxed mt-0.5">
                      {entry.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
