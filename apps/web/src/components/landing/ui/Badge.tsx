import React from 'react';
import { twMerge } from 'tailwind-merge';

export type BadgeTone =
'teal' |
'orange' |
'navy' |
'success' |
'warning' |
'error' |
'neutral';

const tones: Record<BadgeTone, string> = {
  teal: 'bg-teal-50 text-teal-700 border-teal-100',
  orange: 'bg-brand-orangeSoft text-brand-orangeHover border-orange-100',
  navy: 'bg-ink text-white border-ink',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-100',
  neutral: 'bg-slate-100 text-ink-400 border-slate-200'
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  dot = false





}: {tone?: BadgeTone;className?: string;children: React.ReactNode;dot?: boolean;}) {
  return (
    <span
      className={twMerge(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-0.5 text-[11px] font-semibold',
        tones[tone],
        className
      )}>
      
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>);

}

export function CodeTag({ children, className }: {children: React.ReactNode;className?: string;}) {
  return (
    <span className={twMerge('font-mono text-[12px] font-medium text-teal-600', className)}>
      {children}
    </span>);

}