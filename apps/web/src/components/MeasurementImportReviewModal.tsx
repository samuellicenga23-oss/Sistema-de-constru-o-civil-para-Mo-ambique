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
  compositionId: string | null;
  forceCreateComposition: boolean;
  priceSource: "file" | "composition" | "none";
};

function willCreateComposition(row: DecisionState) {
  return row.forceCreateComposition || Boolean(row.note?.includes("Será criada composição") || row.note?.includes("Nova composição"));
}

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
  const compositionOptions = preview.compositionOptions ?? [];

  useEffect(() => {
    setApplyError(null);
    setRows(
      preview.rows.map((row) => ({
        rowKey: row.rowKey,
        action: row.action,
        targetCode: row.targetCode,
        targetItemId: row.targetItemId,
        compositionId: row.compositionId ?? null,
        compositionName: row.compositionName ?? null,
        forceCreateComposition: false,
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
    const newCompositions = rows.filter((r) => r.action !== "ignore" && willCreateComposition(r)).length;
    const suspicious = rows.filter((r) => r.note?.includes("outro tipo de trabalho") || (r.matchMethod === "code" && r.confidence < 0.7)).length;
    return { map, create, ignore, withFilePrice, withComposition, newCompositions, suspicious };
  }, [rows]);

  function updateRow(rowKey: string, patch: Partial<DecisionState>) {
    setRows((current) =>
      current.map((row) => {
        if (row.rowKey !== rowKey) return row;
        const next = { ...row, ...patch };
        if (patch.targetCode !== undefined) {
          const match = preview.catalog.find((c) => c.code === patch.targetCode);
          next.targetItemId = match?.itemId ?? null;
          next.targetDescription = match?.description ?? null;
          if (!patch.compositionId && !patch.forceCreateComposition) {
            next.compositionName = match?.compositionName ?? row.compositionName;
            next.compositionId = match?.compositionId ?? row.compositionId;
          }
          next.priceSource =
            row.unitPrice && row.unitPrice > 0 ? "file" : next.compositionName ? "composition" : "none";
        }
        if (patch.compositionId !== undefined) {
          const comp = compositionOptions.find((c) => c.id === patch.compositionId);
          next.compositionName = comp?.name ?? null;
          next.forceCreateComposition = false;
          next.priceSource = row.unitPrice && row.unitPrice > 0 ? "file" : comp ? "composition" : "none";
          next.note = comp ? `Composição ligada manualmente: ${comp.name}` : row.note;
        }
        if (patch.forceCreateComposition === true) {
          next.compositionId = null;
          next.compositionName = `Nova a partir da descrição (${row.description.slice(0, 60)}…)`;
          next.priceSource = row.unitPrice && row.unitPrice > 0 ? "file" : "composition";
          next.note = "Será criada composição nova a partir da descrição — identificar insumos no Catálogo";
        }
        if (patch.action === "create" && patch.forceCreateComposition === undefined && !patch.compositionId) {
          next.targetItemId = null;
        }
        return next;
      }),
    );
  }

  return (
    <Modal
      title="Rever importação de medições"
      subtitle={`${preview.rowsRead} linha(s) lidas — confirme destino e composição. Códigos iguais ao catálogo SIGO não forçam a composição se a descrição for de outro tipo de trabalho.`}
      onClose={onClose}
      maxWidth="max-w-6xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-brand">{summary.map} mapear</span>
          <span className="badge badge-gray">{summary.create} criar</span>
          <span className="badge badge-gray">{summary.ignore} ignorar</span>
          {summary.withFilePrice > 0 && <span className="badge badge-gray">{summary.withFilePrice} c/ preço ficheiro</span>}
          {summary.withComposition > 0 && <span className="badge badge-brand">{summary.withComposition} c/ composição</span>}
          {summary.newCompositions > 0 && <span className="badge badge-gray">{summary.newCompositions} composição nova</span>}
          {summary.suspicious > 0 && <span className="badge badge-yellow">{summary.suspicious} a confirmar</span>}
        </div>

        {applyError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{applyError}</p>
        )}
        {summary.suspicious > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
            Há linhas em que o código do mapa coincide com o catálogo SIGO mas a descrição é diferente (ex.: pintura vs cobertura).
            Escolha a composição correcta ou «Criar pela descrição».
          </p>
        )}
        {summary.withFilePrice === 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-700">
            Este mapa não traz preços unitários. Ao aplicar, cada item será ligado a uma composição SIGO existente ou será criada uma composição nova da empresa — e o preço unitário será calculado automaticamente.
          </p>
        )}

        <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={saveToCompanyTemplate} onChange={(e) => setSaveToCompanyTemplate(e.target.checked)} className="rounded border-slate-300" />
          Guardar itens novos no template da empresa
        </label>

        <div className="max-h-[55vh] overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Excel/PDF</th>
                <th className="px-3 py-2.5">Qtd</th>
                <th className="px-3 py-2.5">Un</th>
                <th className="px-3 py-2.5">Preço</th>
                <th className="px-3 py-2.5">Acção</th>
                <th className="px-3 py-2.5">Destino / composição</th>
                <th className="px-3 py-2.5">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => {
                const creatingComp = willCreateComposition(row);
                const needsAttention = Boolean(row.note?.includes("outro tipo de trabalho")) || (row.matchMethod === "code" && row.confidence < 0.7);
                return (
                  <tr
                    key={row.rowKey}
                    className={`align-top ${creatingComp && row.action !== "ignore" ? "bg-amber-50/40" : needsAttention ? "bg-orange-50/50" : ""}`}
                  >
                    <td className="px-3 py-2.5">
                      <strong className="block text-slate-950">{row.code}</strong>
                      <span className="mt-0.5 block text-xs text-slate-500">{row.description || "—"}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {row.sheet} · L{row.rowNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-900">{row.quantity}</td>
                    <td className="px-3 py-2.5 text-slate-700">{row.unit}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {row.unitPrice != null && row.unitPrice > 0 ? (
                        <span className="tabular-nums text-slate-900">{row.unitPrice.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}</span>
                      ) : row.priceSource === "composition" || creatingComp ? (
                        <span className="text-brand-800">via composição</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
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
                    <td className="min-w-[16rem] px-3 py-2.5">
                      {row.action === "ignore" ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <div className="space-y-2">
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
                          {row.targetDescription && <span className="block text-[11px] text-slate-500">{row.targetDescription}</span>}

                          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Composição</label>
                          <select
                            value={row.forceCreateComposition ? "__create__" : (row.compositionId ?? "")}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === "__create__") {
                                updateRow(row.rowKey, { forceCreateComposition: true });
                              } else if (!value) {
                                updateRow(row.rowKey, { compositionId: null, compositionName: null, forceCreateComposition: false });
                              } else {
                                updateRow(row.rowKey, { compositionId: value, forceCreateComposition: false });
                              }
                            }}
                            className="input text-sm"
                          >
                            <option value="">— escolher / automática —</option>
                            <option value="__create__">Criar pela descrição (nova)</option>
                            {compositionOptions.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {c.category ? ` · ${c.category}` : ""}
                              </option>
                            ))}
                          </select>
                          {row.compositionName && (
                            <span className={`block text-[11px] ${creatingComp ? "font-medium text-amber-800" : "text-brand-800"}`}>
                              {creatingComp ? "Nova comp. (verificar): " : "Comp.: "}
                              {row.compositionName}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
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
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
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
                rows.map(({ rowKey, action, targetCode, targetItemId, compositionId, compositionName, forceCreateComposition }) => ({
                  rowKey,
                  action,
                  targetCode,
                  targetItemId,
                  compositionId: forceCreateComposition ? null : compositionId,
                  compositionName: forceCreateComposition ? null : compositionName,
                  forceCreateComposition: forceCreateComposition || undefined,
                })),
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
