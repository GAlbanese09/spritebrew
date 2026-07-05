'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantStyles: Record<Variant, string> = {
  primary:
    'bg-accent-amber text-bg-primary hover:bg-accent-amber-strong active:brightness-90',
  secondary:
    'bg-bg-elevated text-text-primary border border-border-default hover:bg-bg-hover hover:border-border-strong',
  ghost:
    'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
};

const sizeStyles: Record<Size, string> = {
  // Mobile touch floor: min-h-11 min-w-11 = 44px hit area (WCAG 2.5.5 AA / Apple
  // HIG). md:min-h-0 md:min-w-0 restores desktop's compact visual so the change
  // is invisible above the mobile breakpoint. The Button root's
  // `inline-flex items-center justify-center` keeps content centered when
  // the mobile floor makes the button taller than its text.
  sm: 'px-3 py-1.5 text-xs min-h-11 min-w-11 md:min-h-0 md:min-w-0',
  md: 'px-4 py-2 text-sm min-h-11 min-w-11 md:min-h-0 md:min-w-0',
  lg: 'px-6 py-3 text-base',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`
          inline-flex items-center justify-center gap-2 rounded font-mono font-medium
          transition-all duration-150 cursor-pointer
          disabled:opacity-40 disabled:cursor-not-allowed
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export default Button;
