export const runtime = 'edge';

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-lg font-display text-accent-amber mb-1">Privacy Policy</h1>
      <p className="text-xs font-mono text-text-muted mb-8">Last updated: April 21, 2026</p>

      <div className="space-y-6 text-sm font-mono text-text-secondary leading-relaxed">
        <p>
          SpriteBrew (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is a pixel art sprite
          sheet generator built by George Albanese. This policy explains what data we collect, why,
          and how we handle it.
        </p>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">What We Collect</h2>
          <div className="space-y-3">
            <p>
              <strong className="text-text-primary">Account Information:</strong> When you sign up,
              we collect your email address and, if you use GitHub sign-in, your GitHub username and
              profile photo. This is processed by Clerk (our authentication provider) and is
              necessary to provide you with an account.
            </p>
            <p>
              <strong className="text-text-primary">Generation Data:</strong> When you generate
              sprites, we store the generated images in your browser&apos;s local session so you can
              access your gallery. We store your token balance and a log of token transactions
              (credits and debits with timestamps) in Cloudflare KV. Transaction records are
              automatically deleted after 90 days. Your token balance persists indefinitely.
            </p>
            <p>
              <strong className="text-text-primary">Waitlist:</strong> If you join the Pro waitlist,
              we store your email address in Cloudflare KV. You can request removal at any time by
              contacting us.
            </p>
            <p>
              <strong className="text-text-primary">Usage Data:</strong> Cloudflare Pages
              automatically collects standard web analytics (page views, country, browser type). We
              do not add any additional tracking scripts, cookies, or analytics tools.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">What We Don&apos;t Collect</h2>
          <p>
            We do not collect payment information (we don&apos;t have paid plans yet). We do not
            track you across other websites. We do not sell, rent, or share your personal data with
            third parties for marketing. We do not use your data to train AI models. We do not store
            your generated images on our servers&nbsp;&mdash; they exist only in your browser session.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Third-Party Services</h2>
          <ul className="space-y-2 list-none">
            <li>
              <strong className="text-text-primary">Clerk</strong> (clerk.com): Handles
              authentication and account management. Their privacy policy applies to auth data.
            </li>
            <li>
              <strong className="text-text-primary">Retro Diffusion</strong> (retrodiffusion.ai):
              Processes your text prompts to generate pixel art. Your prompts are sent to their API.
              Their privacy policy applies to prompt processing.
            </li>
            <li>
              <strong className="text-text-primary">Cloudflare</strong> (cloudflare.com): Hosts the
              site and provides KV storage. Their privacy policy applies to infrastructure-level
              data.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Your Rights</h2>
          <p>
            You can request deletion of your account and all associated data by emailing us. You can
            request a copy of any data we hold about you. You can delete your generation history at
            any time by clearing your browser data.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Data Retention</h2>
          <ul className="space-y-2 list-none">
            <li>
              <strong className="text-text-primary">Token balances:</strong> Retained indefinitely.
              Transaction records auto-deleted after 90 days.
            </li>
            <li>
              <strong className="text-text-primary">Waitlist emails:</strong> Retained until you
              request removal or we launch paid plans (whichever comes first).
            </li>
            <li>
              <strong className="text-text-primary">Account data:</strong> Retained as long as your
              Clerk account exists. Contact us to delete.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Contact</h2>
          <p>
            For any privacy questions or data requests, email:{' '}
            <a href="mailto:george@spritebrew.com" className="text-accent-amber hover:underline">
              george@spritebrew.com
            </a>
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">Changes to This Policy</h2>
          <p>
            We may update this policy as SpriteBrew evolves. Significant changes will be noted on the
            site. Continued use after changes constitutes acceptance.
          </p>
        </section>
      </div>
    </div>
  );
}
