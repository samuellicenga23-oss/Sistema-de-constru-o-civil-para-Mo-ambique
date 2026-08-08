import { useEffect, useState } from "react";
import { boqApi, type LineItemCostSnapshot } from "../api/boq";

const REASON_LABEL: Record<string, string> = {
  attached: "Composição associada",
  reprice: "Reprice",
  import: "Importação",
  generated: "Gerado",
  revision_copy: "Cópia de revisão",
};

function money(value: number, currency?: string) {
  const formatted = value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency ? `${formatted} ${currency}` : formatted;
}

function sourceLabel(source?: string | null, date?: string | null, origin?: string) {
  const bits = [source?.trim() || null, date || null, origin === "zone" ? "zona" : null].filter(Boolean);
  return bits.length ? bits.join(" · ") : "—";
}

export default function LineItemCostSnapshotPanel({ lineItemId }: { lineItemId: string }) {
  const [latest, setLatest] = useState<LineItemCostSnapshot | null>(null);
  const [history, setHistory] = useState<LineItemCostSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    boqApi.listCostSnapshots(lineItemId)
      .then((result) => {
        setLatest(result.latest);
        setHistory(result.snapshots);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar o snapshot"))
      .finally(() => setLoading(false));
  }, [lineItemId]);

  if (loading) {
    return <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">A carregar snapshot APU…</div>;
  }
  if (error) {
    return <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>;
  }
  if (!latest) {
    return <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">Ainda não existe snapshot APU para este item. Associe uma composição ou execute um reprice.</div>;
  }

  const snap = latest.resourceSnapshot;
  const composition = snap?.composition;
  const computed = snap?.computed;

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-emerald-950">Snapshot APU</p>
          <p className="text-[11px] text-slate-500">
            {composition?.name ?? "Composição"} · v{latest.compositionVersion ?? composition?.version ?? "—"} · {REASON_LABEL[latest.reason] ?? latest.reason}
          </p>
          <p className="text-[11px] text-slate-500">
            Capturado em {new Date(latest.createdAt).toLocaleString("pt-MZ")}
            {composition?.sourceName ? ` · fonte ${composition.sourceName}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-500">Custo directo unitário</p>
          <strong className="text-base tabular-nums text-emerald-950">{money(latest.unitCost, latest.currency)}</strong>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-white/80 bg-white px-2.5 py-2"><span className="text-[10px] uppercase tracking-wide text-slate-400">Materiais</span><strong className="mt-0.5 block tabular-nums">{money(latest.materialCost)}</strong></div>
        <div className="rounded-lg border border-white/80 bg-white px-2.5 py-2"><span className="text-[10px] uppercase tracking-wide text-slate-400">Mão-de-obra</span><strong className="mt-0.5 block tabular-nums">{money(latest.labourCost)}</strong></div>
        <div className="rounded-lg border border-white/80 bg-white px-2.5 py-2"><span className="text-[10px] uppercase tracking-wide text-slate-400">Equipamento</span><strong className="mt-0.5 block tabular-nums">{money(latest.equipmentCost)}</strong></div>
        <div className="rounded-lg border border-white/80 bg-white px-2.5 py-2"><span className="text-[10px] uppercase tracking-wide text-slate-400">Subcomposições</span><strong className="mt-0.5 block tabular-nums">{money(latest.subcompositionCost)}</strong></div>
        <div className="rounded-lg border border-white/80 bg-white px-2.5 py-2"><span className="text-[10px] uppercase tracking-wide text-slate-400">Derivados</span><strong className="mt-0.5 block tabular-nums">{money(latest.derivedCost)}</strong></div>
      </div>

      {computed?.productivity?.outputPerDay != null && (
        <p className="text-[11px] text-slate-600">
          Produtividade no snapshot: <strong>{computed.productivity.outputPerDay}</strong> un/dia
          {computed.productivity.basis ? ` (${computed.productivity.basis})` : ""}
        </p>
      )}

      {(snap?.materials?.length || 0) > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Materiais com fonte de preço</div>
          <div className="max-h-40 overflow-auto">
            {snap!.materials!.map((row, index) => (
              <div key={`${row.name}-${index}`} className="grid grid-cols-[1fr_70px_90px_1fr] gap-2 border-b border-slate-50 px-2.5 py-1.5 text-[11px]">
                <span className="truncate font-medium text-slate-800">{row.name}</span>
                <span className="tabular-nums text-right">{row.qtyPerUnit.toLocaleString("pt-MZ", { maximumFractionDigits: 4 })} {row.unit}</span>
                <span className="tabular-nums text-right">{money(row.unitCost)}</span>
                <span className="truncate text-slate-500">{sourceLabel(row.priceSourceName, row.priceDate, row.priceOrigin)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(snap?.labour?.length || 0) > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mão-de-obra</div>
          <div className="max-h-32 overflow-auto">
            {snap!.labour!.map((row, index) => (
              <div key={`${row.name}-${index}`} className="grid grid-cols-[1fr_70px_90px_1fr] gap-2 border-b border-slate-50 px-2.5 py-1.5 text-[11px]">
                <span className="truncate font-medium text-slate-800">{row.name}</span>
                <span className="tabular-nums text-right">{row.hoursPerUnit.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} h</span>
                <span className="tabular-nums text-right">{money(row.hourlyRate)}/h</span>
                <span className="truncate text-slate-500">{sourceLabel(row.priceSourceName, row.priceDate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(snap?.equipment?.length || 0) > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Equipamento</div>
          <div className="max-h-28 overflow-auto">
            {snap!.equipment!.map((row, index) => (
              <div key={`${row.name}-${index}`} className="grid grid-cols-[1fr_70px_90px] gap-2 border-b border-slate-50 px-2.5 py-1.5 text-[11px]">
                <span className="truncate font-medium text-slate-800">{row.name}</span>
                <span className="tabular-nums text-right">{row.hoursPerUnit.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} h</span>
                <span className="tabular-nums text-right">{money(row.hourlyCost)}/h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 1 && (
        <div>
          <button type="button" className="text-[11px] font-semibold text-emerald-800 hover:text-emerald-950" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Ocultar histórico" : `Ver histórico (${history.length})`}
          </button>
          {showHistory && (
            <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-2">
              {history.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-[11px] hover:bg-slate-50">
                  <span>{new Date(row.createdAt).toLocaleString("pt-MZ")} · {REASON_LABEL[row.reason] ?? row.reason} · v{row.compositionVersion ?? "—"}</span>
                  <strong className="tabular-nums">{money(row.unitCost, row.currency)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
