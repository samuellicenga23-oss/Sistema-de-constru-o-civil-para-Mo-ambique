import type { ReactNode } from "react";

export function SectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
    </div>
  );
}

export function MetricCard({ label, value, tone = "neutral", note }: { label: string; value: ReactNode; tone?: "neutral" | "positive" | "negative" | "warning" | "info"; note?: string }) {
  const tones = {
    neutral: "border-t-slate-400 text-slate-900",
    positive: "border-t-emerald-500 text-emerald-700",
    negative: "border-t-red-500 text-red-700",
    warning: "border-t-amber-500 text-amber-700",
    info: "border-t-blue-500 text-blue-700",
  };
  return (
    <div className={`card rounded-lg border-t-2 px-4 py-3.5 ${tones[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 break-words text-lg font-bold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-[11px] leading-4 text-slate-500">{note}</p>}
    </div>
  );
}

export function InlineNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "danger" }) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    danger: "border-red-200 bg-red-50 text-red-800",
  };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}
