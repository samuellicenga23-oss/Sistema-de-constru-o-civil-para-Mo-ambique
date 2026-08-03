import React from 'react';
import { twMerge } from 'tailwind-merge';

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        'rounded-2xl border border-slate-200 bg-white shadow-card',
        className
      )}
      {...props}>
      
      {children}
    </div>);

}

export function CardHeader({
  title,
  eyebrow,
  description,
  action,
  className






}: {title: React.ReactNode;eyebrow?: string;description?: React.ReactNode;action?: React.ReactNode;className?: string;}) {
  return (
    <div
      className={twMerge(
        'flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4',
        className
      )}>
      
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
        <h2 className="font-display text-[15px] font-bold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-ink-400">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>);

}

export function CardBody({ className, children }: {className?: string;children: React.ReactNode;}) {
  return <div className={twMerge('px-5 py-4', className)}>{children}</div>;
}

export function Eyebrow({
  children,
  tone = 'teal',
  className




}: {children: React.ReactNode;tone?: 'teal' | 'orange' | 'muted' | 'light';className?: string;}) {
  const tones = {
    teal: 'text-teal-600',
    orange: 'text-brand-orange',
    muted: 'text-ink-400',
    light: 'text-teal-bright'
  } as const;
  return (
    <p
      className={twMerge(
        'text-eyebrow font-bold uppercase',
        tones[tone],
        className
      )}>
      
      {children}
    </p>);

}

export function Divider({ className }: {className?: string;}) {
  return <div className={twMerge('h-px w-full bg-slate-200', className)} />;
}

export function ProgressBar({
  value,
  tone = 'teal',
  className,
  label





}: {value: number;tone?: 'teal' | 'orange' | 'navy';className?: string;label?: string;}) {
  const tones = { teal: 'bg-teal', orange: 'bg-brand-orange', navy: 'bg-ink' } as const;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={twMerge('h-1.5 w-full overflow-hidden rounded-full bg-slate-200', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}>
      
      <div
        className={twMerge('h-full rounded-full transition-[width] duration-500', tones[tone])}
        style={{ width: `${clamped}%` }} />
      
    </div>);

}

export function Skeleton({ className }: {className?: string;}) {
  return <div className={twMerge('sigo-skeleton h-4 w-full rounded-md', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className






}: {icon?: React.ReactNode;title: string;description?: string;action?: React.ReactNode;className?: string;}) {
  return (
    <div
      className={twMerge(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center',
        className
      )}>
      
      {icon &&
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-teal-600 shadow-card">
          {icon}
        </span>
      }
      <div>
        <p className="font-display text-sm font-bold text-ink">{title}</p>
        {description && <p className="mt-1 max-w-sm text-[13px] text-ink-400">{description}</p>}
      </div>
      {action}
    </div>);

}