import { UploadCloud } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

export default function UploadPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-sm text-accent-amber mb-2">Upload & Slice</h1>
        <p className="text-sm font-mono text-text-secondary">
          Drop a sprite sheet image, define frame dimensions, and slice it into individual frames for preview and export.
        </p>
      </div>

      <Card className="flex flex-col items-center justify-center py-16 border-dashed">
        <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-bg-elevated mb-4">
          <UploadCloud size={28} className="text-text-muted" />
        </div>
        <p className="text-sm font-mono text-text-secondary mb-1">
          This will be built in the next prompt
        </p>
        <Badge variant="amber">Coming Up</Badge>
        <p className="mt-4 text-xs font-mono text-text-muted max-w-sm text-center leading-relaxed">
          You&apos;ll be able to drag-and-drop sprite sheets, set frame width/height,
          auto-detect grid dimensions, and preview individual frames.
        </p>
      </Card>
    </div>
  );
}
