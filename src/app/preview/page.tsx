'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Gamepad2, UploadCloud } from 'lucide-react';
import { useSpriteStore } from '@/stores/spriteStore';
import AnimationPlayer from '@/components/sprites/AnimationPlayer';
import DemoArea from '@/components/sprites/DemoArea';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

type Tab = 'demo' | 'player';

export default function PreviewPage() {
  const animations = useSpriteStore((s) => s.animations);
  const frameDataUrls = useSpriteStore((s) => s.frameDataUrls);

  const hasData = animations.length > 0 && animations.some((a) => a.frames.length > 0);
  const [tab, setTab] = useState<Tab>('demo');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Preview & Play</h1>
        <p className="text-sm font-mono text-text-secondary">
          Test your sprite animations in a live sandbox with keyboard controls,
          or step through frames in the animation player.
        </p>
      </div>

      {/* Empty state */}
      {!hasData && (
        <Card className="flex flex-col items-center justify-center py-16 border-dashed">
          <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-bg-elevated mb-4">
            <UploadCloud size={28} className="text-text-muted" />
          </div>
          <p className="text-sm font-mono text-text-secondary mb-3">
            No sprite data loaded.
          </p>
          <Link href="/upload">
            <Button variant="secondary" size="md">
              Go to Upload
            </Button>
          </Link>
        </Card>
      )}

      {/* Tabs + content */}
      {hasData && (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 rounded-lg bg-bg-secondary p-1 w-fit">
            <button
              onClick={() => setTab('demo')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono cursor-pointer transition-colors
                ${tab === 'demo'
                  ? 'bg-accent-amber text-bg-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
            >
              <Gamepad2 size={14} />
              Demo Area
            </button>
            <button
              onClick={() => setTab('player')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-mono cursor-pointer transition-colors
                ${tab === 'player'
                  ? 'bg-accent-amber text-bg-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
            >
              <Film size={14} />
              Animation Player
            </button>
          </div>

          {/* Tab content */}
          <div className="rounded-lg border border-border-default bg-bg-surface p-6">
            {tab === 'demo' && <DemoArea frameDataUrls={frameDataUrls} />}
            {tab === 'player' && <AnimationPlayer frameDataUrls={frameDataUrls} />}
          </div>
        </>
      )}
    </div>
  );
}
