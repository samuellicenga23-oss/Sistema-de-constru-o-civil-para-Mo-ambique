import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import type { ImportApplyDecision, MeasurementImportPreview, MeasurementImportResult } from "../api/boq";

type FilterId = "all" | "review" | "create" | "newComp" | "collision";

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
  codeCollision: boolean;
  needsReview: boolean;
  willCreateComposition: boolean;
};

function normalizeSearch(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function isCreatingComposition(row: DecisionState) {
  return row.forceCreateComposition || row.willCreateComposition;
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
  const [filter, setFilter] = useState<FilterId>("all");
  const [sheetFilter, setSheetFilter] = useState<string>("");
  const [compQuery, setCompQuery] = useState("");
  const compositionOptions = preview.compositionOptions ?? [];

  useEffect(() => {
    setApplyError(null);
    setFilter("all");
    setSheetFilter("");
    setCompQuery("");
    setRows(
      preview.rows.map((row) => {
        const codeCollision = row.codeCollision === true;
        const willCreate = row.willCreateComposition === true;
        const needsReview =
          row.needsReview === true ||
          codeCollision ||
          willCreate ||
          row.matchMethod === "description" ||
          row.matchMethod === "none" ||
          (row.matchMethod === "code" && row.confidence < 0.7);
        return {
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
          codeCollision,
          needsReview,
          willCreateComposition: willCreate,
        };
      }),
    );
  }, [preview]);

  const sheets = useMemo(() => [...new Set(rows.map((r) => r.sheet))].sort((a, b) => a.localeCompare(b, "pt")), [rows]);

  const summary = useMemo(() => {
    const map = rows.filter((r) => r.action === "map").length;
    const create = rows.filter((r) => r.action === "create").length;
    const ignore = rows.filter((r) => r.action === "ignore").length;
    const withFilePrice = rows.filter((r) => r.unitPrice != null && r.unitPrice > 0).length;
    const withComposition = rows.filter((r) => r.compositionName).length;
    const newCompositions = rows.filter((r) => r.action !== "ignore" && isCreatingComposition(r)).length;
    const suspicious = rows.filter((r) => r.needsReview || r.codeCollision).length;
    const templateCandidates = rows.filter((r) => r.action === "create").length;
    return { map, create, ignore, withFilePrice, withComposition, newCompositions, suspicious, templateCandidates };
  }, [rows]);

  const filteredRows = useMemo(() => {
    let list = rows.filter((r) => {
      if (sheetFilter && r.sheet !== sheetFilter) return false;
      if (filter === "review") return r.needsReview || r.codeCollision;
      if (filter === "create") return r.action === "create";
      if (filter === "newComp") return r.action !== "ignore" && isCreatingComposition(r);
      if (filter === "collision") return r.codeCollision;
      return true;
    });
    list = [...list].sort((a, b) => {
      const ar = a.needsReview || a.codeCollision ? 0 : 1;
      const br = b.needsReview || b.codeCollision ? 0 : 1;
      if (ar !== br) return ar - br;
      if (a.sheet !== b.sheet) return a.sheet.localeCompare(b.sheet, "pt");
      return a.rowNumber - b.rowNumber;
    });
    return list;
  }, [rows, filter, sheetFilter]);

  const filteredCompositions = useMemo(() => {
    const q = normalizeSearch(compQuery);
    if (!q) return compositionOptions.slice(0, 80);
    return compositionOptions
      .filter((c) => normalizeSearch(`${c.name} ${c.category ?? ""}`).includes(q))
      .slice(0, 80);
  }, [compositionOptions, compQuery]);

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
          next.willCreateComposition = false;
          next.priceSource = row.unitPrice && row.unitPrice > 0 ? "file" : comp ? "composition" : "none";
          next.note = comp ? `Composição ligada manualmente: ${comp.name}` : row.note;
          next.needsReview = next.codeCollision;
        }
        if (patch.forceCreateComposition === true) {
          next.compositionId = null;
          next.compositionName = `Nova a partir da descrição (${row.description.slice(0, 60)}…)`;
          next.willCreateComposition = true;
          next.priceSource = row.unitPrice && row.unitPrice > 0 ? "file" : "composition";
          next.note = "Será criada composição nova a partir da descrição — identificar insumos no Catálogo";
          next.needsReview = true;
        }
        if (patch.action === "create" && patch.forceCreateComposition === undefined && !patch.compositionId) {
          next.targetItemId = null;
        }
        return next;
      }),
    );
  }

  function applyCompositionToSameCode(sourceRowKey: string) {
    setRows((current) => {
      const source = current.find((r) => r.rowKey === sourceRowKey);
      if (!source) return current;
      let changed = 0;
      const next = current.map((row) => {
        if (row.rowKey === sourceRowKey || row.code !== source.code || row.action === "ignore") return row;
        changed += 1;
        return {
          ...row,
          compositionId: source.compositionId,
          compositionName: source.compositionName,
          forceCreateComposition: source.forceCreateComposition,
          willCreateComposition: source.willCreateComposition || source.forceCreateComposition,
          needsReview: row.codeCollision,
          note: source.compositionName
            ? `Composição alinhada ao código ${source.code}: ${source.compositionName}`
            : row.note,
          priceSource: row.unitPrice && row.unitPrice > 0 ? "file" : source.compositionName ? "composition" : "none",
        };
      });
      if (changed === 0) return current;
      return next;
    });
  }

  const filterButtons: Array<{ id: FilterId; label: string; count: number }> = [
    { id: "all", label: "Todas", count: rows.length },
    { id: "review", label: "A confirmar", count: summary.suspicious },
    { id: "collision", label: "Código igual", count: rows.filter((r) => r.codeCollision).length },
    { id: "create", label: "Criar item", count: summary.create },
    { id: "newComp", label: "Comp. nova", count: summary.newCompositions },
  ];

  return (
    <Modal
      title="Rever importação de medições"
      subtitle={`${preview.rowsRead} linha(s) — confirme destino e composição. Código igual ao SIGO com outra descrição: mantém-se só nesta medição.`}
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

        <div className="flex flex-wrap items-center gap-2">
          {filterButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setFilter(btn.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                filter === btn.id
                  ? "border-brand-600 bg-brand-50 text-brand-900"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {btn.label}
              {btn.count > 0 ? ` (${btn.count})` : ""}
            </button>
          ))}
          {sheets.length > 1 && (
            <select
              value={sheetFilter}
              onChange={(e) => setSheetFilter(e.target.value)}
              className="input ml-auto max-w-[12rem] text-xs"
            >
              <option value="">Todas as folhas</option>
              {sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>

        {applyError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{applyError}</p>
        )}
        {summary.suspicious > 0 && filter === "all" && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
            Há linhas a confirmar (código igual com outro significado, match por descrição ou composição nova). Use o filtro
            «A confirmar» — as linhas críticas aparecem primeiro. Pode alinhar a mesma composição a todas as linhas com o
            mesmo código.
          </p>
        )}
        {summary.withFilePrice === 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-700">
            Este mapa não traz preços unitários. Ao aplicar, cada item será ligado a uma composição existente ou será criada
            uma composição nova — o preço unitário calcula-se automaticamente.
          </p>
        )}

        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={saveToCompanyTemplate}
              onChange={(e) => setSaveToCompanyTemplate(e.target.checked)}
              className="mt-0.5 rounded border-slate-300"
            />
            <span>
              <span className="font-medium text-slate-900">Guardar itens novos no template da empresa</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Só códigos novos ({summary.templateCandidates}). Não altera itens já existentes no template nem o modelo SIGO.
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <label className="min-w-[14rem] flex-1 text-xs text-slate-600">
            Pesquisar composição (para o select abaixo)
            <input
              value={compQuery}
              onChange={(e) => setCompQuery(e.target.value)}
              className="input mt-1 text-sm"
              placeholder="Ex.: pintura, muro, ligação…"
            />
          </label>
          <span className="pb-2 text-[11px] text-slate-500">
            {filteredCompositions.length}
            {compQuery ? ` resultado(s)` : ` primeiras (de ${compositionOptions.length})`}
          </span>
        </div>

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
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                    Nenhuma linha neste filtro.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const creatingComp = isCreatingComposition(row);
                  const needsAttention = row.needsReview || row.codeCollision;
                  const sameCodeCount = rows.filter((r) => r.code === row.code && r.rowKey !== row.rowKey && r.action !== "ignore").length;
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
                          {row.codeCollision ? " · código local" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-900">{row.quantity}</td>
                      <td className="px-3 py-2.5 text-slate-700">{row.unit}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {row.unitPrice != null && row.unitPrice > 0 ? (
                          <span className="tabular-nums text-slate-900">
                            {row.unitPrice.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}
                          </span>
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
                            {row.targetDescription && (
                              <span className="block text-[11px] text-slate-500">{row.targetDescription}</span>
                            )}

                            <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Composição
                            </label>
                            <select
                              value={row.forceCreateComposition ? "__create__" : (row.compositionId ?? "")}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === "__create__") {
                                  updateRow(row.rowKey, { forceCreateComposition: true });
                                } else if (!value) {
                                  updateRow(row.rowKey, {
                                    compositionId: null,
                                    compositionName: null,
                                    forceCreateComposition: false,
                                    willCreateComposition: false,
                                  });
                                } else {
                                  updateRow(row.rowKey, { compositionId: value, forceCreateComposition: false });
                                }
                              }}
                              className="input text-sm"
                            >
                              <option value="">— escolher / automática —</option>
                              <option value="__create__">Criar pela descrição (nova)</option>
                              {row.compositionId &&
                                !filteredCompositions.some((c) => c.id === row.compositionId) &&
                                compositionOptions
                                  .filter((c) => c.id === row.compositionId)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                      {c.category ? ` · ${c.category}` : ""}
                                    </option>
                                  ))}
                              {filteredCompositions.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                  {c.category ? ` · ${c.category}` : ""}
                                </option>
                              ))}
                            </select>
                            {row.compositionName && (
                              <span
                                className={`block text-[11px] ${creatingComp ? "font-medium text-amber-800" : "text-brand-800"}`}
                              >
                                {creatingComp ? "Nova comp. (verificar): " : "Comp.: "}
                                {row.compositionName}
                              </span>
                            )}
                            {sameCodeCount > 0 && (row.compositionId || row.forceCreateComposition) && (
                              <button
                                type="button"
                                className="text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline"
                                onClick={() => applyCompositionToSameCode(row.rowKey)}
                              >
                                Aplicar a {sameCodeCount} linha(s) com código {row.code}
                              </button>
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
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-slate-500">
          A mostrar {filteredRows.length} de {rows.length} linha(s).
        </p>

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
                rows.map(
                  ({ rowKey, action, targetCode, targetItemId, compositionId, compositionName, forceCreateComposition }) => ({
                    rowKey,
                    action,
                    targetCode,
                    targetItemId,
                    compositionId: forceCreateComposition ? null : compositionId,
                    compositionName: forceCreateComposition ? null : compositionName,
                    forceCreateComposition: forceCreateComposition || undefined,
                  }),
                ),
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
