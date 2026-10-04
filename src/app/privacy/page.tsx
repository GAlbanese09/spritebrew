export const runtime = 'edge';

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-lg font-display text-accent-amber mb-1">Privacy Policy</h1>
      <p className="text-xs font-mono text-text-muted mb-8">Last updated: October 3, 2026</p>

      <div className="space-y-6 text-sm font-mono text-text-secondary leading-relaxed">
        <p>
          SpriteBrew (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is a pixel art sprite
          sheet generator built by George Albanese. This policy explains what data we collect, why,
          where it is kept, and how to delete it.
        </p>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">1. Your account</h2>
          <div className="space-y-3">
            <p>
              You sign in through Clerk, our authentication provider. Clerk holds your email address
              and, if you sign in with GitHub, the name, username and profile photo GitHub shares
              with us.
            </p>
            <p>
              When an account is created, we check whether its email address belongs to a known
              disposable email service, to limit abuse of the free signup bonus.
            </p>
            <p>
              We keep your token balance for as long as your account exists, and a log of your token
              credits and debits for 90 days.
            </p>
            <p>
              We also keep small records that run the free tier and bonuses, for as long as your
              account exists: your signup grant, your daily login streak, how many free generations
              you have used, which one-time bonuses you have claimed, and whether your signup email
              matched our list of disposable email services.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">2. What you create</h2>
          <div className="space-y-3">
            <p>
              When you generate, your prompt, the style and size you chose, and any image you upload
              (a character to animate or a reference image) are sent to Retro Diffusion, which
              creates the art. We do not send them your name, email address or account id.
            </p>
            <p>
              Each finished generation is saved to your account: the image in Cloudflare R2
              storage, and a gallery entry in Cloudflare KV with the first 300 characters of your
              prompt, the style and the date. Both stay until you delete them.
            </p>
            <p>
              While a generation runs and for up to an hour after it finishes (about a day if we owe
              you a refund for it), we keep a job record, including the result. A copy of the
              record is deleted after one day.
            </p>
            <p>
              An image you upload travels with its job through our processing queue and is removed
              from the queue when the job finishes. If a job runs into problems, its message, with
              your image, can move to a second queue that checks the result was delivered or your
              tokens were refunded, and can stay there for up to a few hours after the job ends.
            </p>
            <p>
              To find and fix failures, we record each generation&apos;s progress (when it started,
              whether it finished, any error message, the style and size, and any tokens refunded
              along with your token balance after the refund) with your account id. These records are deleted when your account is deleted. Logs
              from our processing service, which also carry your account id, are deleted after 7
              days.
            </p>
            <p>
              The sprite slicer, preview, export tools and pixel editor run in your browser. Files
              you open in them are not uploaded to us.
            </p>
            <p>
              Some things are kept only on your device, in your browser: a list of your recent
              generations (up to 50, each with its prompt and a small preview, and full images for
              up to the 10 most recent), your Animate settings and saved templates, editor drafts,
              and a copy of your token balance. Deleting a generation from your gallery does not
              remove it from this list. Clearing your browser data removes these. It does not delete
              anything saved to your account.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">3. Payments</h2>
          <div className="space-y-3">
            <p>
              Token packs are paid through Stripe. You enter your card details on Stripe&apos;s
              checkout page; we never see or store your card number.
            </p>
            <p>
              When you open a checkout, we record your account id, the time, your IP address, your
              browser&apos;s user agent, and your consent to receive the tokens right away. We keep
              this record for 400 days as evidence in case a payment is disputed, whether or not you
              complete the purchase. We also send your account id, IP address and the time of your
              consent to Stripe with the checkout.
            </p>
            <p>
              When a payment succeeds, we keep a record of it (your account id, the pack, the tokens,
              the amount and Stripe&apos;s payment ids) and mark your account as a paying account.
              These records have no set expiry.
            </p>
            <p>
              If a payment is refunded, we take back the tokens for the refunded amount and keep a
              record of the refund. If that leaves your balance below zero, your account cannot
              generate until we lift the block by hand, so contact us to resolve it. If a payment is
              disputed (a chargeback), we take back its tokens and permanently stop the account from
              generating. Neither step deletes your account or your data. For refunds and disputes
              we keep evidence about the purchase, including a copy of the checkout record above,
              for 400 days from the refund or dispute. We also keep, with no set expiry, how many
              refunds you have had, the date of the last one, a record of any dispute and any block
              on the account. We may add the email address and card fingerprint used for the
              payment (a code Stripe uses to recognize a card, not the card number) to
              fraud-prevention lists in our Stripe account.
            </p>
            <p>Stripe keeps its own records of your payments, as the law requires.</p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">
            4. Newsletter, waitlist and feedback
          </h2>
          <div className="space-y-3">
            <p>
              If you subscribe to the newsletter inside the app, we add your account email address
              to our mailing list at Resend and give you a one-time token bonus. Ask us at any time
              and we will remove you.
            </p>
            <p>
              If you join the Pixel Pass waitlist, we keep your email address until you ask us to
              remove it.
            </p>
            <p>
              If you send feedback through our feedback form, it is collected by Tally. If you email
              us, we keep the conversation.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">5. Services we use</h2>
          <div className="space-y-3">
            <ul className="space-y-2 list-none">
              <li>
                <strong className="text-text-primary">Clerk</strong> (clerk.com): sign-in and
                account management.
              </li>
              <li>
                <strong className="text-text-primary">Retro Diffusion</strong> (retrodiffusion.ai):
                creates the art from your prompts and uploaded images.
              </li>
              <li>
                <strong className="text-text-primary">Stripe</strong> (stripe.com): payments.
              </li>
              <li>
                <strong className="text-text-primary">Cloudflare</strong> (cloudflare.com): hosts
                the site, runs our processing queue, and stores the data described above (KV, R2,
                D1 and logs).
              </li>
              <li>
                <strong className="text-text-primary">Resend</strong> (resend.com): the newsletter,
                only if you subscribe.
              </li>
              <li>
                <strong className="text-text-primary">Tally</strong> (tally.so): the feedback form.
              </li>
            </ul>
            <p>Each service&apos;s own privacy policy applies to the data it handles.</p>
            <p>
              We use Cloudflare Web Analytics to count page visits. It does not use cookies. We add
              no advertising scripts and no tracking cookies. Clerk sets the cookies that keep you
              signed in.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">6. What we don&apos;t do</h2>
          <div className="space-y-3">
            <p>
              We do not sell or rent your data, and we do not share it with anyone for their own
              marketing. We do not track you across other websites.
            </p>
            <p>We do not use your prompts or images to train AI models.</p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">7. Deleting your data</h2>
          <div className="space-y-3">
            <p>
              You can delete generations from your gallery, one at a time or all at once. The
              gallery shows your 50 most recent generations, and Clear all on the All tab also
              deletes any older ones saved to your account. Deleting removes the image and its
              gallery entry. A temporary record of the job, which also holds the image, expires on
              its own about an hour after the generation finishes.
            </p>
            <p>
              To delete your account and everything tied to it, email{' '}
              <a href="mailto:support@spritebrew.com" className="text-accent-amber hover:underline">
                support@spritebrew.com
              </a>{' '}
              from your account&apos;s email address. We delete your account, balance and history,
              images, newsletter subscription and generation records, and email you when it is done.
              If you write from another address, we first confirm with your account email.
            </p>
            <p>
              We keep a record that you asked and that we deleted your data. Payment, refund and
              dispute records, and the fraud-prevention entries described in section 3, may be kept
              where we need them to handle disputes or prevent fraud. Stripe keeps its own payment
              records. Backups clear themselves within 30 days, and logs within 7 days.
            </p>
            <p>You can also ask us for a copy of your data.</p>
            <p>Clearing your browser data removes only what is on your device (see section 2).</p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">8. Contact</h2>
          <p>
            For privacy questions or data requests, email{' '}
            <a href="mailto:support@spritebrew.com" className="text-accent-amber hover:underline">
              support@spritebrew.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-sm font-display text-text-primary mb-3">9. Changes to this policy</h2>
          <p>
            We update this policy when SpriteBrew changes how it handles data, and change the date at
            the top. Significant changes are noted on the site.
          </p>
        </section>
      </div>
    </div>
  );
}
