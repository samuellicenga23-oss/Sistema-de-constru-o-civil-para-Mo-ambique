import React from 'react';
import { twMerge } from 'tailwind-merge';

type Variant = 'primary' | 'secondary' | 'ghost' | 'navy' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none';

const variants: Record<Variant, string> = {
  primary:
  'bg-brand-orange text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_6px_16px_-8px_rgba(237,108,34,0.7)] hover:bg-brand-orangeHover active:translate-y-[1px]',
  secondary:
  'bg-white text-ink border border-slate-200 hover:border-slate-300 hover:bg-slate-50 active:translate-y-[1px]',
  ghost: 'bg-white text-ink-400 hover:text-teal-700 hover:bg-teal-50',
  navy: 'bg-ink text-white hover:bg-ink-soft active:translate-y-[1px]',
  danger: 'bg-red-600 text-white hover:bg-red-700'
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]'
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={twMerge(
        base,
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className
      )}
      disabled={disabled || loading}
      {...props}>
      
      {loading &&
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true" />

      }
      {children}
    </button>);

}

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: Variant;
};

export function IconButton({ label, variant = 'secondary', className, children, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={twMerge(
        base,
        variants[variant],
        'h-9 w-9 p-0 text-ink-400 hover:text-ink',
        className
      )}
      {...props}>
      
      {children}
    </button>);

}