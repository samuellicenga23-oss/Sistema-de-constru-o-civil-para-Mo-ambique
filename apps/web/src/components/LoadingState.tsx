export default function LoadingState({
  label = "A carregar...",
  fullScreen = false,
  skeleton = false,
}: {
  label?: string;
  fullScreen?: boolean;
  skeleton?: boolean;
}) {
  const containerClass = `flex flex-col items-center justify-center gap-3 text-slate-400 text-sm ${
    fullScreen ? "min-h-screen" : "min-h-[200px]"
  }`;

  if (skeleton) {
    return (
      <div className={`space-y-4 ${fullScreen ? "min-h-[200px]" : ""}`} aria-busy="true" aria-label={label}>
        <div className="skeleton h-8 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card card-pad space-y-2">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-7 w-16" />
            </div>
          ))}
        </div>
        <div className="card card-pad space-y-2">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-3/4" />
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass} aria-busy="true" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
      <span>{label}</span>
    </div>
  );
}
