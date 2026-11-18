'use client';

import { Check } from 'lucide-react';
import type { BadgeState } from '@/lib/generateTabs';

/**
 * A form section's step number (DESIGN, design/generate-pass/generate-pass.md
 * section 1, "Numbered steps"): a 22 px circle, hidden from screen readers,
 * which read "Step n:" from the label instead. The next step's badge is
 * filled amber; a done step shows a check; the rest are plain.
 */
export default function StepBadge({ n, state }: { n: number; state: BadgeState }) {
  const look =
    state === 'next'
      ? 'bg-accent-amber text-bg-primary border-accent-amber'
      : state === 'done'
        ? 'border-accent-teal text-accent-teal'
        : 'border-border-strong text-text-secondary';
  return (
    <span
      aria-hidden="true"
      data-step-badge={state}
      className={`inline-flex flex-shrink-0 items-center justify-center w-[22px] h-[22px] rounded-full border text-xs font-mono tabular-nums normal-case tracking-normal ${look}`}
    >
      {state === 'done' ? <Check size={13} strokeWidth={3} /> : n}
    </span>
  );
}

/** "Step n:" for screen readers, before a section's label. */
export function StepWord({ n }: { n: number }) {
  return <span className="sr-only">Step {n}: </span>;
}
