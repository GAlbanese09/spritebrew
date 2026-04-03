import { Sparkles } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

export default function GeneratePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-sm text-text-muted mb-2">AI Generate</h1>
        <Badge variant="teal">Phase 2</Badge>
      </div>
      <p className="text-sm font-mono text-text-secondary">
        AI-powered sprite generation is coming in Phase 2. Describe a character and get a full animation sprite sheet.
      </p>

      <Card className="flex flex-col items-center justify-center py-20 border-dashed border-accent-teal/20 bg-accent-teal-muted/5">
        <div className="flex items-center justify-center w-16 h-16 rounded-lg bg-accent-teal-muted mb-4">
          <Sparkles size={32} className="text-accent-teal" />
        </div>
        <h2 className="text-sm font-mono font-semibold text-text-primary mb-2">
          AI-Powered Sprite Generation
        </h2>
        <p className="text-xs font-mono text-text-secondary mb-4 max-w-md text-center leading-relaxed">
          Describe your character — style, pose, colors — and SpriteBrew will generate
          a complete animation sprite sheet using AI. Walk cycles, attacks, idles, and more.
        </p>
        <Badge variant="teal">Coming in Phase 2</Badge>
        <div className="mt-8 grid grid-cols-2 gap-4 max-w-sm w-full">
          {['Text-to-sprite generation', 'Style consistency', 'Multi-animation output', 'Iterative refinement'].map(
            (feature) => (
              <div
                key={feature}
                className="flex items-center gap-2 text-[11px] font-mono text-text-muted"
              >
                <span className="w-1 h-1 rounded-full bg-accent-teal/40" />
                {feature}
              </div>
            )
          )}
        </div>
      </Card>
    </div>
  );
}
