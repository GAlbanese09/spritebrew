'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Show, SignInButton } from '@clerk/react';
// WaitlistModal kept for potential future use but no longer opened from pricing
import {
  Sparkles,
  Upload,
  Scan,
  Eraser,
  Pencil,
  Download,
  ArrowRight,
  ChevronDown,
  Loader2,
  Check,
} from 'lucide-react';

/** Simple GitHub mark SVG — lucide-react doesn't include a GitHub icon. */
function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016.02 0c2.28-1.55 3.28-1.23 3.28-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.82.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
import { CURRENT_VERSION } from '@/components/layout/WhatsNew';

// ── Data ──

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI Character Generation',
    desc: 'Describe any character in plain text and get a complete animated sprite sheet. 4 animation styles available now, more coming soon.',
    span: 'sm:col-span-2',
  },
  {
    icon: Upload,
    title: 'Animate Your Own Art',
    desc: 'Upload existing pixel art and generate walk cycles, attacks, idles. The AI preserves your character\'s look.',
    span: '',
  },
  {
    icon: Scan,
    title: 'Smart Sprite Detection',
    desc: 'Auto-detect characters on any sprite sheet, regardless of layout. No grid required — contour detection finds each sprite.',
    span: '',
  },
  {
    icon: Eraser,
    title: 'Background Removal',
    desc: 'One-click background removal with adjustable tolerance. Corner-sampling detection, checkerboard preview.',
    span: '',
  },
  {
    icon: Pencil,
    title: 'Pixel Editor',
    desc: 'Touch up AI output pixel by pixel. Pencil, eraser, eyedropper, undo/redo. Edit at up to 16x zoom.',
    span: '',
  },
  {
    icon: Download,
    title: '6 Export Formats',
    desc: 'TexturePacker, Aseprite, GameMaker, RPG Maker, Godot, raw frames. One click, game-ready.',
    span: 'sm:col-span-2',
  },
] as const;

const STEPS = [
  {
    num: 1,
    title: 'Describe or Upload',
    desc: 'Type a character description or drag in your existing pixel art. SpriteBrew auto-preps it for animation.',
  },
  {
    num: 2,
    title: 'Generate & Refine',
    desc: 'Pick an action — walk, attack, idle, jump. AI generates the frames. Adjust with the built-in pixel editor.',
  },
  {
    num: 3,
    title: 'Export & Ship',
    desc: 'Download game-ready sprite sheets for your engine. Unity, Godot, GameMaker, RPG Maker — all supported.',
  },
] as const;

const ENGINES = [
  'Unity (TexturePacker)',
  'Godot (SpriteFrames)',
  'GameMaker (Strip)',
  'RPG Maker MV/MZ',
  'Aseprite (JSON)',
  'Raw PNGs (Any)',
] as const;

// ── Component ──

export default function LandingPage() {

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e8e0d6] font-mono overflow-x-hidden">
      {/* ── Nav ── */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <BrewLogo />
          <span className="font-display text-[10px] text-[#d4871c] tracking-wide leading-tight">
            Sprite<br />Brew
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Show when="signed-in">
            <Link
              href="/upload"
              className="px-4 py-2 rounded text-xs font-mono font-semibold
                bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors"
            >
              Open App
            </Link>
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="px-4 py-2 rounded text-xs font-mono
                text-[#d4871c] border border-[#d4871c]/30 hover:bg-[#d4871c]/10 cursor-pointer transition-colors">
                Sign In
              </button>
            </SignInButton>
            <Link
              href="/generate"
              className="px-4 py-2 rounded text-xs font-mono font-semibold
                bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors"
            >
              Start Creating
            </Link>
          </Show>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="text-center px-6 pt-16 pb-20 max-w-4xl mx-auto">
        <h1 className="font-display text-lg sm:text-2xl md:text-3xl text-[#d4871c] leading-relaxed"
          style={{ textShadow: '0 0 30px rgba(212,135,28,0.3)' }}>
          Pixel-perfect sprite sheets.<br />In minutes, not months.
        </h1>
        <p className="mt-6 text-sm sm:text-base text-[#9a918a] max-w-2xl mx-auto leading-relaxed">
          Describe a character, pick a moveset, and let AI generate game-ready
          pixel art animations. Upload your own art or create from scratch.
          Export to Unity, Godot, or GameMaker in one click.
        </p>

        {/* Hero sprite animation — real SpriteBrew wizard output */}
        <div className="mt-12 flex flex-col items-center gap-3">
          <div
            className="rounded-xl"
            style={{
              boxShadow: '0 0 60px rgba(212, 135, 28, 0.15), 0 0 120px rgba(212, 135, 28, 0.05)',
            }}
          >
            <div
              className="w-[256px] h-[256px] rounded-xl hero-sprite"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
          <p className="text-[10px] font-mono text-[#5c5550]">
            Generated with SpriteBrew
          </p>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/generate"
            className="px-8 py-3 rounded-lg text-sm font-mono font-bold
              bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors
              shadow-[0_0_20px_rgba(212,135,28,0.3)]"
          >
            Start Creating — Free
          </Link>
          <a
            href="#how-it-works"
            className="px-6 py-3 rounded-lg text-sm font-mono
              text-[#9a918a] hover:text-[#e8e0d6] border border-[#2a2725]
              hover:border-[#3a3430] transition-colors flex items-center gap-2"
          >
            See how it works <ChevronDown size={14} />
          </a>
        </div>
        <p className="mt-4 text-[10px] font-mono text-[#5c5550]">
          100 free tokens on signup &middot; No credit card required
        </p>
      </section>

      {/* ── Features (Bento Grid) ── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="font-display text-[10px] text-[#9a918a] uppercase tracking-[0.2em] text-center mb-10">
          Everything you need
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc, span }) => (
            <div
              key={title}
              className={`rounded-xl border border-[#1e1b18] bg-[#121010] p-5
                hover:border-[#d4871c]/30 transition-colors group ${span}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg
                  bg-[#d4871c]/10 group-hover:bg-[#d4871c]/20 transition-colors">
                  <Icon size={18} className="text-[#d4871c]" />
                </div>
                <h3 className="text-sm font-semibold">{title}</h3>
              </div>
              <p className="text-xs text-[#9a918a] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="px-6 py-16 max-w-4xl mx-auto scroll-mt-8">
        <h2 className="font-display text-[10px] text-[#9a918a] uppercase tracking-[0.2em] text-center mb-10">
          How it works
        </h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {STEPS.map(({ num, title, desc }) => (
            <div key={num} className="text-center">
              <div className="w-12 h-12 rounded-lg border-2 border-[#d4871c]/40 bg-[#d4871c]/10
                flex items-center justify-center mx-auto mb-4
                font-display text-sm text-[#d4871c]">
                {num}
              </div>
              <h3 className="text-sm font-semibold mb-2">{title}</h3>
              <p className="text-xs text-[#9a918a] leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Engine Compatibility ── */}
      <section className="px-6 py-12 max-w-4xl mx-auto">
        <h2 className="font-display text-[10px] text-[#9a918a] uppercase tracking-[0.2em] text-center mb-6">
          Export to any engine
        </h2>
        <div className="flex flex-wrap justify-center gap-2">
          {ENGINES.map((name) => (
            <span
              key={name}
              className="px-3 py-1.5 rounded-full text-[10px] font-mono
                border border-[#1e1b18] bg-[#121010] text-[#9a918a]"
            >
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* ── Trust ── */}
      <section className="px-6 py-16 max-w-2xl mx-auto">
        <div className="rounded-xl border border-[#1e1b18] bg-[#121010] p-8 text-center space-y-4">
          <h2 className="text-sm font-semibold">Built for game developers, by game developers.</h2>
          <div className="space-y-2 text-xs text-[#9a918a] leading-relaxed">
            <p>SpriteBrew is built by an indie developer who got tired of frame-by-frame animation.</p>
            <p>AI assists your workflow — you stay the creative director.</p>
            <p>Your creations are yours. Full commercial rights, no strings.</p>
            <p>Free tools (slicer, editor, exporter) work without AI and without an account.</p>
          </div>
          <a
            href="https://github.com/GAlbanese09/spritebrew"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs text-[#d4871c] hover:text-[#e8991f] transition-colors mt-2"
          >
            <GithubIcon size={14} />
            SpriteBrew is open source (AGPL-3.0)
          </a>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="px-6 py-16 max-w-5xl mx-auto">
        <h2 className="font-display text-[10px] text-[#9a918a] uppercase tracking-[0.2em] text-center mb-10">
          Simple pricing. Start free.
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Free tier */}
          <div className="rounded-xl border border-[#d4871c]/30 bg-[#121010] p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[#d4871c]">Free</h3>
              <p className="text-[10px] text-[#5c5550] uppercase tracking-wider mt-0.5">
                Get Started
              </p>
            </div>
            <ul className="space-y-2 text-xs text-[#9a918a]">
              {[
                '100 bonus tokens on signup',
                '200 tokens for early adopters',
                'All editing tools free forever',
                'Sprite slicer, pixel editor, BG removal',
                '6 export formats',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="w-1 h-1 rounded-full bg-[#d4871c] mt-1.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/generate"
              className="block text-center px-4 py-2.5 rounded-lg text-xs font-semibold
                bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors"
            >
              Start Free
            </Link>
          </div>
          {/* Token Packs */}
          <div className="relative rounded-xl border border-[#d4871c] bg-[#121010] p-6 space-y-4"
            style={{ boxShadow: '0 0 30px rgba(212,135,28,0.1)' }}>
            <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded text-[8px] font-mono font-semibold
              bg-[#d4871c] text-[#0a0a0a] uppercase tracking-wider">
              Most Popular
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#d4871c]">Token Packs</h3>
              <p className="text-[10px] text-[#5c5550] uppercase tracking-wider mt-0.5">
                Pay as You Go
              </p>
            </div>
            <ul className="space-y-2 text-xs text-[#9a918a]">
              <li className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-[#d4871c] mt-1.5 flex-shrink-0" />
                Starter — 500 tokens for $4.99
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-[#d4871c] mt-1.5 flex-shrink-0" />
                Creator — 1,800 for $14.99 <span className="text-green-400">(+20%)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-[#d4871c] mt-1.5 flex-shrink-0" />
                Studio — 4,500 for $29.99 <span className="text-green-400">(+50%)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-[#d4871c] mt-1.5 flex-shrink-0" />
                Pro — 15,000 for $74.99 <span className="text-green-400">(+100%)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-[#d4871c] mt-1.5 flex-shrink-0" />
                Tokens never expire
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-[#d4871c] mt-1.5 flex-shrink-0" />
                Commercial use included
              </li>
            </ul>
            <a
              href="/buy-tokens"
              className="block text-center px-4 py-2.5 rounded-lg text-xs font-semibold
                bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors"
            >
              See Pack Options
            </a>
          </div>
          {/* Pixel Pass */}
          <div className="rounded-xl border border-[#1e1b18] bg-[#121010] p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Pixel Pass</h3>
              <p className="text-[10px] text-[#5c5550] uppercase tracking-wider mt-0.5">
                Coming Soon
              </p>
            </div>
            <ul className="space-y-2 text-xs text-[#9a918a]">
              {[
                '1,500 tokens per month',
                '+5 bonus tokens every day you generate',
                'Priority support',
                '$9/month',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="w-1 h-1 rounded-full bg-[#5c5550] mt-1.5 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <PixelPassWaitlist />
          </div>
        </div>
        <p className="text-center text-[10px] text-[#5c5550] mt-4">
          All editing tools work without an account. AI generation requires sign-up. Commercial use included with every generation.
        </p>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-6 py-20 text-center">
        <h2 className="text-sm sm:text-base font-semibold mb-6">
          Ready to stop drawing frame by frame?
        </h2>
        <Link
          href="/generate"
          className="inline-flex items-center gap-2 px-8 py-3 rounded-lg text-sm font-mono font-bold
            bg-[#d4871c] text-[#0a0a0a] hover:bg-[#e8991f] transition-colors
            shadow-[0_0_20px_rgba(212,135,28,0.3)]"
        >
          Start Creating — Free <ArrowRight size={16} />
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[#1e1b18] px-6 py-8">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-[10px] text-[#5c5550]">
            <a
              href="https://github.com/GAlbanese09/spritebrew"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#9a918a] transition-colors flex items-center gap-1"
            >
              <GithubIcon size={12} /> GitHub
            </a>
            <a
              href="mailto:george@spritebrew.com"
              className="hover:text-[#9a918a] transition-colors"
            >
              Contact
            </a>
            <a href="/privacy" className="hover:text-[#9a918a] transition-colors">
              Privacy
            </a>
            <a href="/terms" className="hover:text-[#9a918a] transition-colors">
              Terms
            </a>
            <a href="/refund-policy" className="hover:text-[#9a918a] transition-colors">
              Refund Policy
            </a>
          </div>
          <p className="text-[10px] text-[#5c5550]">
            SpriteBrew {CURRENT_VERSION} &middot; Built by George Albanese
          </p>
        </div>
      </footer>

    </div>
  );
}

// ── Sub-components ──

const PIXEL_PASS_JOINED_KEY = 'spritebrew_pixel_pass_joined';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Inline waitlist signup for the Pixel Pass card. */
function PixelPassWaitlist() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(PIXEL_PASS_JOINED_KEY) === 'true') setSuccess(true);
    } catch { /* */ }
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      setError('Please enter a valid email.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, source: 'pixel_pass' }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Something went wrong.');
        return;
      }
      setSuccess(true);
      try { localStorage.setItem(PIXEL_PASS_JOINED_KEY, 'true'); } catch { /* */ }
    } catch {
      setError('Connection failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [email]);

  if (success) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-green-500/30 text-green-400 text-xs font-mono">
        <Check size={14} />
        We&apos;ll notify you!
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleSubmit(); }}
          placeholder="your@email.com"
          className="flex-1 min-w-0 rounded-lg border px-3 py-2 text-xs font-mono
            text-[#e8e0d6] placeholder:text-[#5c5550]
            focus:outline-none focus:border-[#d4871c] transition-colors"
          style={{ backgroundColor: '#2a2420', borderColor: error ? '#ef4444' : '#3a3430' }}
        />
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-3 py-2 rounded-lg text-xs font-mono font-semibold
            border border-[#d4871c]/30 text-[#d4871c] hover:bg-[#d4871c]/10
            cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center gap-1.5 flex-shrink-0"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : 'Notify Me'}
        </button>
      </div>
      {error && <p className="text-[10px] font-mono text-red-400">{error}</p>}
    </div>
  );
}

/** Tiny pixel potion bottle logo — matches the sidebar icon. */
function BrewLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ imageRendering: 'pixelated' }}>
      <rect x="6" y="1" width="4" height="2" fill="#d4871c" />
      <rect x="6" y="0" width="4" height="1" fill="#8B7355" />
      <rect x="4" y="3" width="8" height="2" fill="#d4871c" opacity="0.6" />
      <rect x="3" y="5" width="10" height="8" rx="1" fill="#d4871c" opacity="0.8" />
      <rect x="4" y="7" width="8" height="5" fill="#e8991f" />
      <rect x="6" y="8" width="1" height="1" fill="#fff" opacity="0.6" />
      <rect x="9" y="9" width="1" height="1" fill="#fff" opacity="0.4" />
      <rect x="7" y="10" width="1" height="1" fill="#fff" opacity="0.3" />
      <rect x="4" y="5" width="1" height="6" fill="#fff" opacity="0.1" />
      <rect x="3" y="13" width="10" height="1" fill="#d4871c" />
    </svg>
  );
}

