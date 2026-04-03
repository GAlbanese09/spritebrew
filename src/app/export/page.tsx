'use client';

import Link from 'next/link';
import { UploadCloud } from 'lucide-react';
import { useSpriteStore } from '@/stores/spriteStore';
import ExportConfig from '@/components/sprites/ExportConfig';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function ExportPage() {
  const animations = useSpriteStore((s) => s.animations);

  const hasData = animations.length > 0 && animations.some((a) => a.frames.length > 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Export</h1>
        <p className="text-sm font-mono text-text-secondary">
          Export your sprite sheets in the format your game engine expects.
          Supports Unity, Godot, GameMaker, RPG Maker, Aseprite, and raw PNG frames.
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

      {/* Export configuration */}
      {hasData && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6">
          <ExportConfig />
        </div>
      )}
    </div>
  );
}
