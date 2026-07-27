import { useEffect, useState } from "react";
import { materialsByPhaseApi, type PhaseReport } from "../api/materialsByPhase";
import { IconDownload } from "./icons";
import ModalPortal from "./ModalPortal";

function fmt(n: number) {
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function money(n: number, currency: string) {
  return `${n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export default function MaterialsByPhaseModal({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const [phases, setPhases] = useState<PhaseReport[] | null>(null);
  const [currency, setCurrency] = useState("MZN");
  const [grandTotal, setGrandTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    materialsByPhaseApi
      .get(documentId)
      .then((res) => {
        setPhases(res.phases);
        setCurrency(res.currency);
        setGrandTotal(res.grandTotal);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao calcular materiais por fase"));
  }, [documentId]);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-2">
          <div className="flex gap-2">
            <a href={`/api/budget-documents/${documentId}/materials-by-phase/export.xlsx`} className="btn btn-secondary btn-sm !bg-white/10 !text-white hover:!bg-white/20">
              <IconDownload className="w-3.5 h-3.5" />
              Excel
            </a>
            <a href={`/api/budget-documents/${documentId}/materials-by-phase/export.pdf`} className="btn btn-secondary btn-sm !bg-white/10 !text-white hover:!bg-white/20">
              <IconDownload className="w-3.5 h-3.5" />
              PDF
            </a>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm !text-white hover:!bg-white/10">
            Fechar ✕
          </button>
        </div>

        <div className="bg-white rounded-xl overflow-y-auto p-5 space-y-5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Materiais por Fase</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Quantidades e valor de materiais necessários em cada fase da obra, calculados a partir das medições já
                  feitas neste Mapa de Quantidades. A "unidade de compra" (ex: camião, saco, palete) vem definida no
                  Catálogo de Preços, por material.
                </p>
              </div>
              {phases && phases.length > 0 && (
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide">Valor total</p>
                  <p className="text-lg font-bold text-brand-800 tabular-nums">{money(grandTotal, currency)}</p>
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {!error && !phases && <p className="text-sm text-gray-400">A calcular...</p>}

          {phases && phases.length === 0 && (
            <p className="text-sm text-gray-400">Ainda não há itens medidos (quantidade &gt; 0) neste orçamento.</p>
          )}

          {phases?.map((phase) => (
            <section key={phase.key} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-brand-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-brand-900 text-sm">{phase.label}</h3>
                <span className="text-sm font-semibold text-brand-800 tabular-nums">{money(phase.valueTotal, currency)}</span>
              </div>

              {(phase.materials.length > 0 || phase.itemsWithoutComposition.length > 0) && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px] border-collapse">
                    <colgroup>
                      <col className="w-[38%]" />
                      <col className="w-[16%]" />
                      <col className="w-[26%]" />
                      <col className="w-[20%]" />
                    </colgroup>
                    <thead>
                      <tr className="table-head-row">
                        <th className="text-left py-2 px-3 font-medium">Material</th>
                        <th className="text-right py-2 px-3 font-medium">Quantidade</th>
                        <th className="text-left py-2 px-3 font-medium">Unidade de compra</th>
                        <th className="text-right py-2 px-3 font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phase.materials.map((m) => (
                        <tr key={m.name} className="table-row">
                          <td className="py-2 px-3">{m.name}</td>
                          <td className="text-right px-3 tabular-nums whitespace-nowrap">
                            {fmt(m.quantity)} {m.unit}
                          </td>
                          <td className="px-3 text-gray-600 whitespace-nowrap">
                            {m.purchasePackageLabel && m.purchaseQty !== null ? `${m.purchaseQty} × ${m.purchasePackageLabel}` : "—"}
                          </td>
                          <td className="text-right px-3 tabular-nums whitespace-nowrap">{money(m.value, m.currency)}</td>
                        </tr>
                      ))}
                      {phase.itemsWithoutComposition.map((i, idx) => (
                        <tr key={`unmapped-${idx}`} className="table-row bg-amber-50/60">
                          <td className="py-2 px-3 text-amber-900">
                            {i.code} {i.description}
                          </td>
                          <td className="text-right px-3 tabular-nums text-amber-900 whitespace-nowrap">
                            {fmt(i.quantity)} {i.unit}
                          </td>
                          <td className="px-3 text-amber-800 text-xs">
                            {i.barsInfo
                              ? `${i.barsInfo.barsNeeded} varões de ${fmt(i.barsInfo.barLengthM)}m (Ø${i.barsInfo.diameterMm}mm)`
                              : "sem composição"}
                          </td>
                          <td className="text-right px-3 tabular-nums text-amber-900 whitespace-nowrap">{money(i.value, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {phase.materials.length === 0 && phase.itemsWithoutComposition.length === 0 && (
                <p className="text-sm text-gray-400 px-4 py-3">Sem materiais explodidos nesta fase.</p>
              )}
            </section>
          ))}
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
