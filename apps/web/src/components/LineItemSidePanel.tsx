import { useEffect } from "react";
import LineItemCostSnapshotPanel from "./LineItemCostSnapshotPanel";

type PanelKind = "spec" | "apu" | "comments" | "provenance" | null;

export default function LineItemSidePanel({
  open,
  kind,
  title,
  subtitle,
  specification,
  lineItemId,
  allowEditSpec,
  specDraft,
  onSpecDraftChange,
  onSaveSpec,
  onClose,
  children,
}: {
  open: boolean;
  kind: PanelKind;
  title: string;
  subtitle?: string;
  specification?: string | null;
  lineItemId?: string;
  allowEditSpec?: boolean;
  specDraft?: string;
  onSpecDraftChange?: (value: string) => void;
  onSaveSpec?: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !kind) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={kind === "apu" ? "APU" : kind === "spec" ? "Especificação" : kind === "provenance" ? "Proveniência" : "Comentários"}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              {kind === "apu" ? "Análise de Preço Unitário" : kind === "spec" ? "Especificação" : kind === "provenance" ? "Proveniência" : "Comentários"}
            </p>
            <h2 className="mt-1 truncate text-sm font-semibold text-slate-950">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Fechar
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {kind === "spec" && (
            allowEditSpec ? (
              <div className="space-y-3">
                <textarea
                  className="input min-h-40 w-full text-sm"
                  value={specDraft ?? ""}
                  onChange={(e) => onSpecDraftChange?.(e.target.value)}
                  placeholder="Norma, classe, acabamento, critérios de medição…"
                />
                <button type="button" className="btn btn-primary btn-sm" onClick={onSaveSpec}>
                  Guardar especificação
                </button>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {specification?.trim() || "Sem especificação."}
              </p>
            )
          )}
          {kind === "apu" && lineItemId && <LineItemCostSnapshotPanel lineItemId={lineItemId} />}
          {kind === "provenance" && (children ?? <p className="text-sm text-slate-500">Sem dados de proveniência.</p>)}
          {kind === "comments" && (children ?? <p className="text-sm text-slate-500">Sem comentários.</p>)}
        </div>
      </aside>
    </div>
  );
}
