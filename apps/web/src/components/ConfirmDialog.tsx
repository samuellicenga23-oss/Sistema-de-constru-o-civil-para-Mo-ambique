// Confirmação de acções destrutivas — substitui window.confirm(...) espalhado por várias
// páginas (bloqueia a thread do browser inteira, não é estilável, e em alguns browsers móveis
// aparece de forma inconsistente). Uso: montar condicionalmente com estado local, ex.
//   {confirming && <ConfirmDialog title="Remover?" message="..." danger onConfirm={...} onCancel={() => setConfirming(false)} />}
import ModalPortal from "./ModalPortal";

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4">
        <div className="card card-pad w-full max-w-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-1">{title}</h2>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-secondary flex-1">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`btn flex-1 ${danger ? "bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 disabled:opacity-50" : "btn-primary"}`}
          >
            {busy ? "A processar..." : confirmLabel}
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
