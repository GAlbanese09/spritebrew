import { Download } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

export default function ExportPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Export</h1>
        <p className="text-sm font-mono text-text-secondary">
          Export your sprite sheets in the format your game engine expects. Supports Unity, Godot, GameMaker, RPG Maker, Aseprite, and raw PNG frames.
        </p>
      </div>

      <Card className="flex flex-col items-center justify-center py-16 border-dashed">
        <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-bg-elevated mb-4">
          <Download size={28} className="text-text-muted" />
        </div>
        <p className="text-sm font-mono text-text-secondary mb-1">
          This will be built in the next prompt
        </p>
        <Badge variant="amber">Coming Up</Badge>
        <p className="mt-4 text-xs font-mono text-text-muted max-w-sm text-center leading-relaxed">
          Choose your target engine, configure padding and power-of-two options,
          and download ready-to-use sprite sheets with metadata.
        </p>
      </Card>
    </div>
  );
}
