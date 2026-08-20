import { useState } from "react";

export type DocumentReviewAction = "submit" | "approve" | "return";

export default function DocumentReviewModal({
  action,
  documentLabel,
  onClose,
  onConfirm,
  busy,
}: {
  action: DocumentReviewAction;
  documentLabel: string;
  onClose: () => void;
  onConfirm: (note: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const [note, setNote] = useState("");
  const required = action === "return";
  const titles: Record<DocumentReviewAction, string> = {
    submit: "Submeter",
    approve: "Aprovar",
    return: "Devolver",
  };
  const labels: Record<DocumentReviewAction, string> = {
    submit: "Comentário para o aprovador (opcional)",
    approve: "Comentário (opcional)",
    return: "Motivo *",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2 className="text-base font-semibold text-slate-950">{titles[action]} {documentLabel}</h2>
        <label className="mt-4 block text-xs font-semibold text-slate-600">
          {labels[action]}
          <textarea
            className="input mt-1 min-h-28 w-full text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={action === "return" ? "Indique o que deve ser corrigido…" : "Observações…"}
            autoFocus
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn btn-sm ${action === "return" ? "btn-secondary" : action === "approve" ? "btn-success" : "btn-primary"}`}
            disabled={busy || (required && !note.trim())}
            onClick={() => void onConfirm(note.trim())}
          >
            {busy ? "A guardar…" : titles[action]}
          </button>
        </div>
      </div>
    </div>
  );
}
