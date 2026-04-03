import type { ReactNode } from 'react';

type BadgeVariant = 'default' | 'amber' | 'teal' | 'muted';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-bg-elevated text-text-secondary border-border-default',
  amber: 'bg-accent-amber-glow text-accent-amber border-accent-amber/20',
  teal: 'bg-accent-teal-muted text-accent-teal border-accent-teal/20',
  muted: 'bg-bg-hover text-text-muted border-border-subtle',
};

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center rounded px-2 py-0.5 text-[10px] font-mono font-medium
        uppercase tracking-wider border
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}
