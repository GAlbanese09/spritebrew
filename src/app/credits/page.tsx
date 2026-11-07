import type { Metadata } from 'next';
import credits from '@/lib/pixelGridCredits.json';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Credits',
};

export default function CreditsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-lg font-display text-accent-amber mb-8 leading-relaxed">
        Open-source software in SpriteBrew
      </h1>

      <div className="space-y-6 text-sm font-mono text-text-secondary leading-relaxed">
        <p>SpriteBrew uses open-source software. Thank you to the people who make it.</p>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Fix pixel grid</h2>
          <div className="space-y-3">
            <p>
              Fix pixel grid runs Retro Diffusion&apos;s pixel-art-fixer in your browser, built with
              these packages:
            </p>
            <ul>
              {credits.map(({ name, version, license, repository }) => (
                <li
                  key={name}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 py-1 border-b border-border-subtle"
                >
                  <a
                    href={repository}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 break-words text-text-primary hover:underline"
                  >
                    {name}
                  </a>
                  <span className="text-xs text-text-muted tabular-nums">
                    {version} {license}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              <a href="/wasm/THIRD-PARTY-NOTICES.txt" className="text-accent-amber hover:underline">
                Full license texts
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
