import ModalPortal from "./ModalPortal";

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  busy = false,
  details,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  details?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/55 p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={onCancel}
      >
        <div
          className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`px-5 pt-5 sm:px-6 sm:pt-6 ${danger ? "border-b border-red-100 bg-red-50/60" : "border-b border-slate-100"}`}>
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${
                  danger ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                }`}
                aria-hidden="true"
              >
                {danger ? "!" : "?"}
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="confirm-dialog-title" className="text-base font-bold text-slate-900 sm:text-lg">
                  {title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{message}</p>
              </div>
            </div>
            {details && details.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                {details.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-slate-400">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end sm:px-6 sm:pb-6">
            <button type="button" onClick={onCancel} disabled={busy} className="btn btn-secondary w-full sm:w-auto">
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`btn w-full sm:w-auto ${danger ? "btn-danger bg-red-600 text-white border-red-600 hover:bg-red-700 hover:border-red-700" : "btn-primary"}`}
            >
              {busy ? "A processar..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
