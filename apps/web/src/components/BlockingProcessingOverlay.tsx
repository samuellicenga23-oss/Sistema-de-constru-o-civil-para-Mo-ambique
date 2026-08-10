type Props = {
  title?: string;
  stage?: string | null;
  detail?: string | null;
  percent?: number;
};

export default function BlockingProcessingOverlay({
  title = "A analisar o projecto",
  stage,
  detail,
  percent = 0,
}: Props) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl sm:p-8">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
          <span className="text-sm font-bold tabular-nums">{safePercent}%</span>
        </div>
        <h2 className="mt-4 text-xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{stage || "A preparar a leitura do PDF"}</p>
        {detail && <p className="mt-1 truncate text-xs text-slate-400">{detail}</p>}
        <div
          className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={safePercent}
        >
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${safePercent}%` }} />
        </div>
        <p className="mt-4 text-xs text-slate-500">A página abrirá automaticamente quando a análise terminar.</p>
      </div>
    </div>
  );
}
