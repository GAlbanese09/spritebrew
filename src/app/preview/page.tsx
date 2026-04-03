import { PlayCircle } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

export default function PreviewPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Preview & Play</h1>
        <p className="text-sm font-mono text-text-secondary">
          Test your sprite animations in a live PixiJS sandbox with keyboard controls. Adjust timing, switch between animations, and see your sprites in action.
        </p>
      </div>

      <Card className="flex flex-col items-center justify-center py-16 border-dashed">
        <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-bg-elevated mb-4">
          <PlayCircle size={28} className="text-text-muted" />
        </div>
        <p className="text-sm font-mono text-text-secondary mb-1">
          This will be built in the next prompt
        </p>
        <Badge variant="amber">Coming Up</Badge>
        <p className="mt-4 text-xs font-mono text-text-muted max-w-sm text-center leading-relaxed">
          A PixiJS-powered canvas where you can walk, run, attack, and jump your sprite
          using WASD/arrow keys. Full animation timeline control included.
        </p>
      </Card>
    </div>
  );
}
