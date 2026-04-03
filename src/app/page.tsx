import Link from 'next/link';
import { UploadCloud, PlayCircle, Download, Sparkles } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

const FEATURES = [
  {
    href: '/upload',
    icon: UploadCloud,
    title: 'Upload & Slice',
    description: 'Drop a sprite sheet, define your frames, and start working.',
    badge: null,
  },
  {
    href: '/preview',
    icon: PlayCircle,
    title: 'Preview & Play',
    description: 'Test your animations with keyboard controls in a live sandbox.',
    badge: null,
  },
  {
    href: '/export',
    icon: Download,
    title: 'Export Anywhere',
    description: 'Unity, Godot, GameMaker, RPG Maker — one click.',
    badge: null,
  },
] as const;

const STEPS = [
  { num: 1, title: 'Upload', text: 'Drop your sprite sheet or individual frames' },
  { num: 2, title: 'Preview', text: 'Tweak timing, test with keyboard controls' },
  { num: 3, title: 'Export', text: 'Download for your target engine in one click' },
] as const;

export default function HomePage() {
  return (
    <div className="max-w-5xl mx-auto space-y-12">
      {/* Hero */}
      <section className="text-center py-8">
        <h1 className="font-display text-xl sm:text-2xl text-accent-amber leading-relaxed text-glow-amber">
          SpriteBrew
        </h1>
        <p className="mt-4 text-text-secondary font-mono text-sm max-w-md mx-auto">
          Brew pixel-perfect sprite sheets for your game.
        </p>
      </section>

      {/* Feature cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href} className="block">
            <Card hover className="h-full flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center justify-center w-9 h-9 rounded bg-accent-amber-glow">
                  <Icon size={18} className="text-accent-amber" />
                </div>
                <h2 className="text-sm font-mono font-semibold text-text-primary">
                  {title}
                </h2>
              </div>
              <p className="text-xs font-mono text-text-secondary leading-relaxed flex-1">
                {description}
              </p>
            </Card>
          </Link>
        ))}
      </section>

      {/* Getting started */}
      <section>
        <h2 className="font-display text-[10px] text-text-secondary uppercase tracking-widest mb-6">
          Getting Started
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ num, title, text }) => (
            <div key={num} className="flex gap-4 items-start">
              <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full border border-border-strong text-accent-amber font-mono text-sm font-bold">
                {num}
              </span>
              <div>
                <h3 className="text-sm font-mono font-semibold text-text-primary">
                  {title}
                </h3>
                <p className="mt-1 text-xs font-mono text-text-secondary leading-relaxed">
                  {text}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Phase 2 teaser */}
      <section>
        <Card className="text-center border-accent-teal/20">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Sparkles size={16} className="text-accent-teal" />
            <Badge variant="teal">Phase 2</Badge>
          </div>
          <p className="text-sm font-mono text-text-secondary">
            AI-powered sprite generation coming soon.
          </p>
          <p className="mt-1 text-xs font-mono text-text-muted">
            Describe a character, get a full animation sheet.
          </p>
        </Card>
      </section>
    </div>
  );
}
