import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import type { ImportApplyDecision, MeasurementImportPreview, MeasurementImportResult } from "../api/boq";

type DecisionState = ImportApplyDecision & {
  sheet: string;
  rowNumber: number;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  matchMethod: string;
  confidence: number;
  note: string | null;
  targetDescription: string | null;
  compositionName: string | null;
  priceSource: "file" | "composition" | "none";
};

export default function MeasurementImportReviewModal({
  preview,
  onClose,
  onApply,
  applying,
}: {
  preview: MeasurementImportPreview;
  onClose: () => void;
  onApply: (decisions: ImportApplyDecision[], saveToCompanyTemplate: boolean) => Promise<MeasurementImportResult | void>;
  applying: boolean;
}) {
  const [saveToCompanyTemplate, setSaveToCompanyTemplate] = useState(false);
  const [rows, setRows] = useState<DecisionState[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    setApplyError(null);
    setRows(
      preview.rows.map((row) => ({
        rowKey: row.rowKey,
        action: row.action,
        targetCode: row.targetCode,
        targetItemId: row.targetItemId,
        sheet: row.sheet,
        rowNumber: row.rowNumber,
        code: row.code,
        description: row.description,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unitPrice ?? null,
        matchMethod: row.matchMethod,
        confidence: row.confidence,
        note: row.note,
        targetDescription: row.targetDescription,
        compositionName: row.compositionName ?? null,
        priceSource: row.priceSource ?? "none",
      })),
    );
  }, [preview]);

  const summary = useMemo(() => {
    const map = rows.filter((r) => r.action === "map").length;
    const create = rows.filter((r) => r.action === "create").length;
    const ignore = rows.filter((r) => r.action === "ignore").length;
    const withFilePrice = rows.filter((r) => r.unitPrice != null && r.unitPrice > 0).length;
    const withComposition = rows.filter((r) => r.compositionName).length;
    return { map, create, ignore, withFilePrice, withComposition };
  }, [rows]);

  function updateRow(rowKey: string, patch: Partial<DecisionState>) {
    setRows((current) =>
      current.map((row) => {
        if (row.rowKey !== rowKey) return row;
        const next = { ...row, ...patch };
        // Se o código destino muda, re-resolver o itemId a partir do catálogo (evita overwrite stale).
        if (patch.targetCode !== undefined) {
          const match = preview.catalog.find((c) => c.code === patch.targetCode);
          next.targetItemId = match?.itemId ?? null;
          next.targetDescription = match?.description ?? null;
          next.compositionName = match?.compositionName ?? null;
          next.priceSource =
            row.unitPrice && row.unitPrice > 0 ? "file" : match?.compositionName ? "composition" : "none";
        }
        if (patch.action === "create") {
          next.targetItemId = null;
          next.compositionName = null;
          next.priceSource = row.unitPrice && row.unitPrice > 0 ? "file" : "none";
        }
        return next;
      }),
    );
  }

  return (
    <Modal
      title="Rever importação de medições"
      subtitle={`${preview.rowsRead} linha(s) · ${summary.map} mapear · ${summary.create} criar · ${summary.ignore} ignorar · ${summary.withFilePrice} c/ preço ficheiro · ${summary.withComposition} c/ composição`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-4">
        {applyError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{applyError}</p>
        )}
        {summary.withFilePrice === 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Este mapa não traz preços unitários. Ao aplicar, cada item será ligado a uma composição SIGO existente ou será criada uma composição nova da empresa — e o preço unitário será calculado automaticamente.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={saveToCompanyTemplate} onChange={(e) => setSaveToCompanyTemplate(e.target.checked)} />
          Guardar itens novos no template da empresa
        </label>

        <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Excel/PDF</th>
                <th className="px-3 py-2">Qtd</th>
                <th className="px-3 py-2">Un</th>
                <th className="px-3 py-2">Preço</th>
                <th className="px-3 py-2">Acção</th>
                <th className="px-3 py-2">Destino / composição</th>
                <th className="px-3 py-2">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.rowKey} className="align-top">
                  <td className="px-3 py-2">
                    <strong className="block text-slate-950">{row.code}</strong>
                    <span className="block text-xs text-slate-500">{row.description || "—"}</span>
                    <span className="block text-[11px] text-slate-400">
                      {row.sheet} · L{row.rowNumber}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.quantity}</td>
                  <td className="px-3 py-2">{row.unit}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.unitPrice != null && row.unitPrice > 0 ? (
                      <span className="tabular-nums text-slate-900">{row.unitPrice.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}</span>
                    ) : row.priceSource === "composition" ? (
                      <span className="text-brand-800">via composição</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.action}
                      onChange={(e) => updateRow(row.rowKey, { action: e.target.value as DecisionState["action"] })}
                      className="input text-sm"
                    >
                      <option value="map">Mapear</option>
                      <option value="create">Criar</option>
                      <option value="ignore">Ignorar</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 min-w-[12rem]">
                    {row.action === "ignore" ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <>
                        <input
                          value={row.targetCode ?? ""}
                          onChange={(e) => updateRow(row.rowKey, { targetCode: e.target.value })}
                          className="input text-sm"
                          list={`catalog-${row.rowKey}`}
                          placeholder="Código destino"
                        />
                        <datalist id={`catalog-${row.rowKey}`}>
                          {preview.catalog.map((item) => (
                            <option key={item.code} value={item.code}>
                              {item.description}
                            </option>
                          ))}
                        </datalist>
                        {row.targetDescription && <span className="mt-1 block text-[11px] text-slate-500">{row.targetDescription}</span>}
                        {row.compositionName && (
                          <span className="mt-1 block text-[11px] text-brand-800">Comp.: {row.compositionName}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {row.matchMethod === "code"
                      ? "código"
                      : row.matchMethod === "description"
                        ? "descrição"
                        : row.matchMethod === "ai"
                          ? "sugerido"
                          : "novo"}
                    {row.confidence > 0 ? ` · ${Math.round(row.confidence * 100)}%` : ""}
                    {row.note ? <span className="mt-1 block text-amber-700">{row.note}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary" disabled={applying}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={applying || rows.length === 0}
            className="btn btn-primary"
            onClick={() => {
              setApplyError(null);
              void onApply(
                rows.map(({ rowKey, action, targetCode, targetItemId }) => ({ rowKey, action, targetCode, targetItemId })),
                saveToCompanyTemplate,
              ).catch((err: unknown) => {
                setApplyError(err instanceof Error ? err.message : "Não foi possível aplicar a importação.");
              });
            }}
          >
            {applying ? "A aplicar…" : "Aplicar importação"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
