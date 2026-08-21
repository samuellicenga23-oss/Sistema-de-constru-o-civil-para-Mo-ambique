import { useEffect, useMemo, useState } from "react";
import { measurementLinesApi, type MeasurementLine } from "../api/measurementLines";
import { formatQuantityDisplay } from "../lib/quantityFormat";
import { boqProvenanceBadge } from "../utils/boqProvenance";
import type { LineItemNode } from "../api/boq";

const FORMULA_LABELS: Record<string, string> = {
  direct: "Quantidade directa",
  count: "Contagem",
  length: "Comprimento",
  area: "Área",
  wall_area: "Área vertical",
  perimeter: "Perímetro",
  volume: "Volume",
  section_length: "Secção × comprimento",
  weight: "Peso",
  reinforcement: "Aço",
  percentage: "Percentagem",
  legacy_product: "Legado",
};

function formatTimestamp(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-MZ", { dateStyle: "short", timeStyle: "short" });
}

export default function LineItemProvenancePanel({ node }: { node: LineItemNode }) {
  const [lines, setLines] = useState<MeasurementLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const provenance = boqProvenanceBadge(node.origin, node.quantitySource);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    measurementLinesApi
      .list(node.id)
      .then((rows) => {
        if (!cancelled) setLines(rows);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Não foi possível carregar a memória");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const summary = useMemo(() => {
    const byFormula = new Map<string, number>();
    let latestAt: string | null = null;
    for (const line of lines) {
      byFormula.set(line.formulaType, (byFormula.get(line.formulaType) ?? 0) + 1);
      const candidate = line.updatedAt ?? line.createdAt;
      if (candidate && (!latestAt || candidate > latestAt)) latestAt = candidate;
    }
    return { byFormula, latestAt, activeCount: lines.length };
  }, [lines]);

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Quantidade do item</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
          {formatQuantityDisplay(node.quantity, node.unit)}
          {node.unit ? <span className="ml-1 text-sm font-normal text-slate-500">{node.unit}</span> : null}
        </p>
        {provenance ? (
          <p className="mt-1 text-xs text-slate-600">
            Origem: <span className="font-semibold">{provenance.label}</span>
            <span className="text-slate-400"> · {provenance.title}</span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Origem manual</p>
        )}
      </div>

      {loading ? <p className="text-slate-500">A carregar memória de cálculo…</p> : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      {!loading && !error && (
        <>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Resumo da fórmula</p>
            {summary.activeCount === 0 ? (
              <p className="mt-1 text-slate-600">Sem linhas activas na memória.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {[...summary.byFormula.entries()].map(([formula, count]) => (
                  <li key={formula} className="flex justify-between gap-2 text-xs text-slate-700">
                    <span>{FORMULA_LABELS[formula] ?? formula}</span>
                    <span className="font-semibold tabular-nums">{count} linha(s)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {summary.latestAt ? (
            <p className="text-xs text-slate-500">
              Última actualização da memória: {formatTimestamp(summary.latestAt)}
            </p>
          ) : null}

          {lines.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-500">
                    <th className="px-2 py-1.5">Tipo</th>
                    <th className="px-2 py-1.5 text-right">Parcial</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-700">
                        {FORMULA_LABELS[line.formulaType] ?? line.formulaType}
                        {line.description ? ` · ${line.description}` : ""}
                        {line.source !== "manual" ? (
                          <span className="ml-1 text-slate-400">({line.source}{line.sourceRef ? ` · ${line.sourceRef}` : ""})</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatQuantityDisplay(line.partial)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
