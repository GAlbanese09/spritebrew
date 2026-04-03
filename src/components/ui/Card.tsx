import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export default function Card({ children, className = '', hover = false }: CardProps) {
  return (
    <div
      className={`
        rounded-lg border border-border-default bg-bg-surface p-6
        ${hover ? 'transition-all duration-200 hover:border-border-strong hover:bg-bg-elevated cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
