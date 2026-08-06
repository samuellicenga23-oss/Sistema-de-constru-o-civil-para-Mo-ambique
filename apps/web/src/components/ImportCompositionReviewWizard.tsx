import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "./Modal";
import type { CreatedImportComposition } from "../api/boq";
import { catalogApi, type CompositionSaveInput, type CostCompositionDetail, type Material } from "../api/catalog";

type EditableMaterial = { refId: string; qtyPerUnit: number; wastePct: number; notes?: string | null };

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ImportCompositionReviewWizard({
  compositions,
  onClose,
}: {
  compositions: CreatedImportComposition[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<CostCompositionDetail | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialLines, setMaterialLines] = useState<EditableMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMaterialId, setNewMaterialId] = useState("");
  const [doneIds, setDoneIds] = useState<string[]>([]);

  const current = compositions[index] ?? null;
  const progressLabel = `${Math.min(index + 1, compositions.length)} / ${compositions.length}`;

  useEffect(() => {
    void catalogApi.listMaterials().then(setMaterials).catch(() => setMaterials([]));
  }, []);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void catalogApi
      .getComposition(current.id)
      .then((comp) => {
        if (cancelled) return;
        setDetail(comp);
        setMaterialLines(
          comp.materialLines.map((l) => ({
            refId: l.refId,
            qtyPerUnit: Number(l.qtyPerUnit) || 0,
            wastePct: Number(l.wastePct ?? 0) || 0,
            notes: l.notes ?? null,
          })),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível carregar a composição.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  const materialOptions = useMemo(
    () => materials.slice().sort((a, b) => a.name.localeCompare(b.name, "pt")),
    [materials],
  );

  function materialLabel(refId: string) {
    return materials.find((m) => m.id === refId)?.name ?? detail?.materialLines.find((l) => l.refId === refId)?.name ?? refId;
  }

  function materialHint(refId: string) {
    const mat = materials.find((m) => m.id === refId);
    if (mat) return `${money(mat.baseUnitCost)} ${mat.currency}/${mat.unit}`;
    const line = detail?.materialLines.find((l) => l.refId === refId);
    if (line) return `${money(line.unitCost)} ${detail?.currency ?? ""}/${line.unit ?? "un"}`;
    return null;
  }

  async function saveCurrent(): Promise<boolean> {
    if (!detail || !current) return false;
    setSaving(true);
    setError(null);
    try {
      const payload: CompositionSaveInput = {
        name: detail.name,
        category: detail.category,
        code: detail.code,
        description: detail.description,
        measurementCriteria: detail.measurementCriteria,
        executionNotes: detail.executionNotes,
        outputUnit: detail.outputUnit,
        currency: detail.currency,
        auxiliaryCostPct: Number(detail.auxiliaryCostPct) || 0,
        indirectCostPct: Number(detail.indirectCostPct) || 0,
        profitMarginPct: Number(detail.profitMarginPct) || 0,
        sourceName: detail.sourceName,
        sourceReference: detail.sourceReference,
        isActive: detail.isActive,
        labourLines: detail.labourLines.map((l) => ({
          refId: l.refId,
          qtyPerUnit: Number(l.qtyPerUnit) || 0,
          notes: l.notes ?? null,
        })),
        materialLines: materialLines.map((l) => ({
          refId: l.refId,
          qtyPerUnit: l.qtyPerUnit,
          wastePct: l.wastePct,
          notes: l.notes ?? null,
        })),
        equipmentLines: detail.equipmentLines.map((l) => ({
          refId: l.refId,
          qtyPerUnit: Number(l.qtyPerUnit) || 0,
          notes: l.notes ?? null,
        })),
      };
      await catalogApi.updateComposition(current.id, payload);
      setDoneIds((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function goNext(save: boolean) {
    if (save) {
      const ok = await saveCurrent();
      if (!ok) return;
    } else {
      setDoneIds((ids) => (current && !ids.includes(current.id) ? [...ids, current.id] : ids));
    }
    if (index >= compositions.length - 1) {
      onClose();
      return;
    }
    setIndex((i) => i + 1);
  }

  if (!current) {
    return null;
  }

  return (
    <Modal
      title="Rever insumos das composições novas"
      subtitle={`Passo ${progressLabel} — confirme materiais e rendimentos antes de usar no orçamento.`}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
          <p className="font-semibold">{current.name}</p>
          {current.itemCodes.length > 0 && (
            <p className="mt-0.5 text-amber-900/80">Item(ns) do mapa: {current.itemCodes.join(", ")}</p>
          )}
          <Link to={`/catalogo/composicoes/${current.id}`} className="mt-1 inline-flex font-medium text-brand-800 hover:underline">
            Abrir no Catálogo (completo) →
          </Link>
        </div>

        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        {loading || !detail ? (
          <p className="py-8 text-center text-sm text-slate-500">A carregar composição…</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Insumos (materiais)</h3>
              <span className="text-[11px] text-slate-500">
                Unidade de saída: {detail.outputUnit} · {money(detail.unitCost ?? 0)} {detail.currency}/un
              </span>
            </div>

            <div className="max-h-[40vh] overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Qtd / un</th>
                    <th className="px-3 py-2">Desperdício %</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {materialLines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-500">
                        Sem materiais — adicione insumos abaixo.
                      </td>
                    </tr>
                  ) : (
                    materialLines.map((line, i) => {
                      return (
                        <tr key={`${line.refId}-${i}`}>
                          <td className="px-3 py-2">
                            <select
                              className="input text-sm"
                              value={line.refId}
                              onChange={(e) => {
                                const next = [...materialLines];
                                next[i] = { ...line, refId: e.target.value };
                                setMaterialLines(next);
                              }}
                            >
                              {!materials.some((m) => m.id === line.refId) && (
                                <option value={line.refId}>{materialLabel(line.refId)}</option>
                              )}
                              {materialOptions.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                            {materialHint(line.refId) && (
                              <span className="mt-0.5 block text-[11px] text-slate-400">{materialHint(line.refId)}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              className="input w-24 text-sm"
                              value={line.qtyPerUnit}
                              onChange={(e) => {
                                const next = [...materialLines];
                                next[i] = { ...line, qtyPerUnit: Number(e.target.value) || 0 };
                                setMaterialLines(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              className="input w-20 text-sm"
                              value={line.wastePct}
                              onChange={(e) => {
                                const next = [...materialLines];
                                next[i] = { ...line, wastePct: Number(e.target.value) || 0 };
                                setMaterialLines(next);
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-xs text-red-700 hover:underline"
                              onClick={() => setMaterialLines(materialLines.filter((_, j) => j !== i))}
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[14rem] flex-1 text-xs text-slate-600">
                Adicionar material
                <select className="input mt-1 text-sm" value={newMaterialId} onChange={(e) => setNewMaterialId(e.target.value)}>
                  <option value="">— escolher —</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!newMaterialId}
                onClick={() => {
                  if (!newMaterialId) return;
                  setMaterialLines((lines) => [...lines, { refId: newMaterialId, qtyPerUnit: 1, wastePct: 0 }]);
                  setNewMaterialId("");
                }}
              >
                Adicionar
              </button>
            </div>

            {(detail.labourLines.length > 0 || detail.equipmentLines.length > 0) && (
              <p className="text-[11px] text-slate-500">
                Mão-de-obra ({detail.labourLines.length}) e equipamento ({detail.equipmentLines.length}) mantêm-se; edite no
                Catálogo se precisar.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <span className="text-[11px] text-slate-500">
            {doneIds.length} de {compositions.length} revista(s)
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" disabled={saving || loading} onClick={() => void goNext(false)}>
              Saltar
            </button>
            <button type="button" className="btn btn-primary" disabled={saving || loading} onClick={() => void goNext(true)}>
              {saving ? "A guardar…" : index >= compositions.length - 1 ? "Guardar e concluir" : "Guardar e seguinte"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
