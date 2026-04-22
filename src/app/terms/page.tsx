export const runtime = 'edge';

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-lg font-display text-accent-amber mb-1">Terms of Service</h1>
      <p className="text-xs font-mono text-text-muted mb-8">Last updated: April 21, 2026</p>

      <div className="space-y-6 text-sm font-mono text-text-secondary leading-relaxed">
        <p>By using SpriteBrew, you agree to these terms.</p>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">What SpriteBrew Is</h2>
          <p>
            SpriteBrew is an AI-powered pixel art sprite sheet generator. It uses Retro
            Diffusion&apos;s AI models to generate pixel art from text descriptions and to animate
            existing characters. The tool also includes non-AI features like sprite slicing,
            animation preview, pixel editing, and multi-engine export.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Your Account</h2>
          <p>
            You need a free account to use AI generation features. You&apos;re responsible for
            keeping your login credentials secure. Don&apos;t share accounts. One account per
            person.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Free Tier</h2>
          <p>
            Free accounts receive a one-time signup bonus of tokens and can earn additional tokens
            through daily rewards (coming soon). Different AI styles cost different token
            amounts&nbsp;&mdash; simpler styles cost fewer tokens, premium styles cost more. Tokens do
            not expire. We reserve the right to adjust token grants and costs at any time to manage
            costs. Abuse of the free tier (including creating multiple accounts to earn multiple
            signup bonuses) may result in account suspension.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Your Generated Content</h2>
          <p>
            You own the sprites and images you generate with SpriteBrew. You may use them for any
            purpose, including commercial use in games and other projects. We do not claim ownership
            of your generated content. We do not use your generated content to train AI models.
          </p>
          <p className="mt-3">
            However, AI-generated pixel art is produced by Retro Diffusion&apos;s models. We
            encourage you to be transparent about AI usage in your projects, consistent with
            industry norms and any applicable platform policies (such as Steam&apos;s disclosure
            requirements).
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Acceptable Use</h2>
          <p>
            Don&apos;t use SpriteBrew to generate content that is illegal, harmful, or violates the
            rights of others. Don&apos;t attempt to reverse-engineer, scrape, or abuse the API.
            Don&apos;t create multiple accounts to circumvent free tier limits. Don&apos;t use
            automated tools or bots to generate content in bulk.
          </p>
          <p className="mt-3">
            We reserve the right to suspend or terminate accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Service Availability</h2>
          <p>
            SpriteBrew is provided &ldquo;as is&rdquo; without warranties. We&apos;re a solo
            developer project&nbsp;&mdash; downtime happens, bugs exist, and features may change. We
            do our best to keep the service running but cannot guarantee 100% uptime.
          </p>
          <p className="mt-3">
            We may modify, suspend, or discontinue any part of SpriteBrew at any time. We&apos;ll
            try to give notice for significant changes, but this isn&apos;t always possible.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, SpriteBrew and its creator are not liable for
            any indirect, incidental, or consequential damages arising from your use of the service.
            Our total liability is limited to the amount you&apos;ve paid us (which, for free tier
            users, is zero).
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">
            AI-Generated Content Disclaimer
          </h2>
          <p>
            SpriteBrew uses AI to generate images. AI output is inherently unpredictable. We do not
            guarantee that generated content will be unique, free of artifacts, suitable for any
            particular purpose, or free from resemblance to existing works. You are responsible for
            reviewing generated content before using it in your projects.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Open Source</h2>
          <p>
            SpriteBrew&apos;s source code is available under the AGPL-3.0 license at{' '}
            <a
              href="https://github.com/GAlbanese09/spritebrew"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-amber hover:underline"
            >
              github.com/GAlbanese09/spritebrew
            </a>
            . If you deploy a modified version as a service, you must release your changes under the
            same license.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Contact</h2>
          <p>
            For questions about these terms, email:{' '}
            <a href="mailto:george@spritebrew.com" className="text-accent-amber hover:underline">
              george@spritebrew.com
            </a>
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Changes to These Terms</h2>
          <p>
            We may update these terms as SpriteBrew evolves. Continued use after changes constitutes
            acceptance.
          </p>
        </section>
      </div>
    </div>
  );
}
