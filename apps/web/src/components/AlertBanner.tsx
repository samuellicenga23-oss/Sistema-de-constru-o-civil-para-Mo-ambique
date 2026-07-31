import type { ReactNode } from "react";

type Tone = "error" | "success" | "warning" | "info";

const TONES: Record<Tone, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

export default function AlertBanner({
  children,
  tone = "error",
  onDismiss,
}: {
  children: ReactNode;
  tone?: Tone;
  onDismiss?: () => void;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`} role="alert">
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100" aria-label="Fechar">
          ✕
        </button>
      )}
    </div>
  );
}
