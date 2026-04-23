export const runtime = 'edge';

export default function RefundPolicyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-lg font-display text-accent-amber mb-1">Refund Policy</h1>
      <p className="text-xs font-mono text-text-muted mb-8">Last updated: April 22, 2026</p>

      <div className="space-y-6 text-sm font-mono text-text-secondary leading-relaxed">
        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">1. Scope</h2>
          <p>
            This policy applies to all one-time token pack purchases made on SpriteBrew
            (spritebrew.com). It does not apply to free signup bonus tokens, promotional credits, or
            future subscription plans (which will have their own cancellation terms).
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">2. 14-Day Refund Window</h2>
          <p>
            You may request a full refund of any token pack purchase within 14 calendar days of the
            purchase date, provided that none of the purchased tokens have been used (spent on
            AI generations). This 14-day period aligns with the EU Consumer Rights Directive
            2011/83/EU cooling-off period.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">3. Used Tokens</h2>
          <p>
            If you have used (spent) any tokens from a purchased pack, the pack is not eligible for a
            refund. This is because generated pixel art cannot be &ldquo;returned&rdquo; and each
            generation incurs real compute costs. The only exception is where required by mandatory
            consumer-protection law (see Clause 4 for EU/UK specifics; Clause 2 applies in all cases
            for unused packs).
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">
            4. Waiver of Right of Withdrawal (EU/UK)
          </h2>
          <p>
            At checkout, you expressly consent to SpriteBrew beginning performance of the contract
            immediately by crediting the purchased tokens to your account. By providing this consent,
            you acknowledge that you lose your right of withdrawal under Article 16(m) of Directive
            2011/83/EU and Regulation 37 of the UK Consumer Contracts Regulations 2013 once the
            tokens are credited and you begin using them. Despite this waiver, we still honour the
            14-day refund window described in Clause 2 for completely unused packs as a matter of
            goodwill.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">5. How to Request a Refund</h2>
          <p>
            Email{' '}
            <a href="mailto:george@spritebrew.com" className="text-accent-amber hover:underline">
              george@spritebrew.com
            </a>{' '}
            with the subject line &ldquo;Refund Request&rdquo; and include your account email address
            and the approximate date of purchase. We will respond within 3 business days.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">6. Refund Method</h2>
          <p>
            Refunds are processed via Stripe to the original payment method. Refunds typically appear
            within 5&ndash;10 business days depending on your bank or card issuer.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">7. Exceptions</h2>
          <p>
            We reserve the right to deny refund requests where we reasonably believe the request is
            fraudulent, abusive, or part of a pattern of repeated purchase-and-refund behaviour. If a
            refund is denied, we will explain why.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">8. Connecticut Disclosure</h2>
          <p>
            Pursuant to Connecticut General Statutes &sect; 42-110aa: this refund policy is
            prominently displayed before purchase. SpriteBrew token packs are eligible for refund
            under the conditions stated above. No restocking fees apply.
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">9. Changes</h2>
          <p>
            We may update this policy as SpriteBrew evolves. Changes apply to purchases made after the
            update date. Existing purchases remain subject to the policy in effect at the time of
            purchase.
          </p>
        </section>
      </div>
    </div>
  );
}
