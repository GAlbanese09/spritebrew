'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Show, SignInButton } from '@clerk/react';
import WaitlistModal, { hasJoinedWaitlist } from '@/components/layout/WaitlistModal';
import {
  Sparkles,
  Upload,
  Scan,
  Eraser,
  Pencil,
  Download,
  ArrowRight,
  ChevronDown,
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
    desc: 'Describe any character in plain text and get a complete animated sprite sheet. Choose from 6 animation styles.',
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
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [joined, setJoined] = useState(false);

  // Check localStorage on mount for previously joined state
  useEffect(() => {
    setJoined(hasJoinedWaitlist());
  }, []);

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
          Free during Early Access &middot; No credit card required
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
      <section className="px-6 py-16 max-w-3xl mx-auto">
        <h2 className="font-display text-[10px] text-[#9a918a] uppercase tracking-[0.2em] text-center mb-10">
          Simple pricing. Start free.
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Free tier */}
          <div className="rounded-xl border border-[#d4871c]/30 bg-[#121010] p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[#d4871c]">Free</h3>
              <p className="text-[10px] text-[#5c5550] uppercase tracking-wider mt-0.5">
                Early Access
              </p>
            </div>
            <ul className="space-y-2 text-xs text-[#9a918a]">
              {[
                '5 AI generations per day',
                'Unlimited sprite slicing',
                'Unlimited exports (all 6 formats)',
                'Pixel editor',
                'Background removal',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-[#d4871c]" />
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
          {/* Pro tier */}
          <div className="rounded-xl border border-[#1e1b18] bg-[#121010] p-6 space-y-4 opacity-70">
            <div>
              <h3 className="text-sm font-semibold">Pro</h3>
              <p className="text-[10px] text-[#5c5550] uppercase tracking-wider mt-0.5">
                Coming Soon
              </p>
            </div>
            <ul className="space-y-2 text-xs text-[#9a918a]">
              {[
                'Unlimited AI generations',
                'Priority generation queue',
                'Higher resolution support',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-[#5c5550]" />
                  {item}
                </li>
              ))}
            </ul>
            <button
              onClick={() => !joined && setWaitlistOpen(true)}
              disabled={joined}
              className={`block w-full text-center px-4 py-2.5 rounded-lg text-xs font-mono
                transition-colors ${
                  joined
                    ? 'border border-green-500/30 text-green-400 cursor-default'
                    : 'border border-[#d4871c]/30 text-[#d4871c] hover:bg-[#d4871c]/10 cursor-pointer'
                }`}
            >
              {joined ? 'On the Waitlist \u2713' : 'Join Waitlist'}
            </button>
          </div>
        </div>
        <p className="text-center text-[10px] text-[#5c5550] mt-4">
          All free tools work without an account. AI generation requires sign-up.
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
          </div>
          <p className="text-[10px] text-[#5c5550]">
            SpriteBrew {CURRENT_VERSION} &middot; Built by George Albanese
          </p>
        </div>
      </footer>

      {/* Waitlist modal */}
      <WaitlistModal
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
        onJoined={() => setJoined(true)}
      />
    </div>
  );
}

// ── Sub-components ──

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

