import type { PlantProcessingProgress } from "../api/plants";

type Props = {
  progress: PlantProcessingProgress;
  compact?: boolean;
};

export default function PlantUploadProgress({ progress, compact }: Props) {
  const label = progress.processingStage ?? "A analisar o PDF";
  const pages =
    progress.processingCurrentPage && progress.processingTotalPages
      ? `Página ${progress.processingCurrentPage} de ${progress.processingTotalPages}`
      : null;

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-brand-800">
        <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-brand-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress.processingProgress}%` }} />
        </div>
        <span className="tabular-nums font-semibold">{progress.processingProgress}%</span>
        <span className="truncate">{label}</span>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-brand-100 bg-brand-50/70 p-4" aria-live="polite">
      <div className="flex justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{label}</p>
          {pages && <p className="text-xs text-brand-800/70">{pages}</p>}
        </div>
        <strong className="text-xl tabular-nums text-ink">{progress.processingProgress}%</strong>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-brand-100"
        role="progressbar"
        aria-valuenow={progress.processingProgress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress.processingProgress}%` }} />
      </div>
    </div>
  );
}
