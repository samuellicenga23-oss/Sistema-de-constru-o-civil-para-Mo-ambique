import { useEffect, useState } from "react";
import { boqApi } from "../api/boq";
import Modal from "./Modal";

function money(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value: number | null) {
  return value == null ? "—" : value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BudgetRevisionDiffModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [diff, setDiff] = useState<Awaited<ReturnType<typeof boqApi.revisionDiff>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void boqApi.revisionDiff(documentId)
      .then((result) => { if (!cancelled) setDiff(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível comparar"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [documentId]);

  const top = (diff?.items ?? []).filter((item) => item.delta !== 0).slice(0, 12);

  return (
    <Modal title="Comparar revisão" subtitle={diff?.previous ? `Rev. ${diff.previous.revision ?? "—"} → ${diff.current.revision ?? "—"}` : "Sem revisão anterior"} onClose={onClose} maxWidth="max-w-4xl">
      {loading && <p className="text-sm text-slate-500">A comparar…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!loading && !error && diff && !diff.previous && (
        <p className="text-sm text-slate-600">Não há revisão anterior neste projecto para este tipo de documento.</p>
      )}
      {!loading && !error && diff?.previous && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><span className="text-slate-500">Anterior</span><strong className="block tabular-nums">{money(diff.previousTotal)}</strong></div>
            <div><span className="text-slate-500">Actual</span><strong className="block tabular-nums">{money(diff.currentTotal)}</strong></div>
            <div><span className="text-slate-500">Δ</span><strong className={`block tabular-nums ${diff.delta < 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(diff.delta)}</strong></div>
            <div><span className="text-slate-500">Δ %</span><strong className="block tabular-nums">{diff.previousTotal === 0 ? "—" : `${((diff.delta / diff.previousTotal) * 100).toFixed(1)} %`}</strong></div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-500">
                  <th className="px-3 py-2">Item</th>
                  <th className="text-right">Qtd ant.</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">P. ant.</th>
                  <th className="text-right">P. unit.</th>
                  <th className="text-right">Δ qtd</th>
                  <th className="text-right">Δ preço</th>
                  <th className="text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {top.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">Sem variação de itens</td></tr>
                )}
                {top.map((item) => (
                  <tr key={item.key} className="border-t border-slate-100">
                    <td className="px-3 py-2"><span className="text-slate-400">{item.code ?? ""}</span> {item.description}</td>
                    <td className="text-right tabular-nums">{qty(item.previousQuantity)}</td>
                    <td className="text-right tabular-nums">{qty(item.quantity)}</td>
                    <td className="text-right tabular-nums">{qty(item.previousUnitPrice)}</td>
                    <td className="text-right tabular-nums">{qty(item.unitPrice)}</td>
                    <td className="text-right tabular-nums">{money(item.quantityEffect)}</td>
                    <td className="text-right tabular-nums">{money(item.priceEffect)}</td>
                    <td className={`text-right tabular-nums font-semibold ${item.delta < 0 ? "text-rose-700" : "text-slate-900"}`}>{money(item.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
