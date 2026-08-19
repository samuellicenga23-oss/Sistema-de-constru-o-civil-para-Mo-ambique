import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  catalogApi,
  type CostComposition,
  type Equipment,
  type LabourCategory,
  type Material,
  type WorkChapter,
  type WorkChapterInput,
} from "../api/catalog";
import { useAuth } from "../auth/AuthContext";
import Modal from "./Modal";
import { IconPlus, IconTrash } from "./icons";

const DISCIPLINES: Array<[WorkChapter["discipline"], string]> = [
  ["all", "Todos os projectos"],
  ["arquitectura", "Arquitectura"],
  ["estrutura", "Estrutura"],
  ["hidrossanitario", "Hidrossanitário"],
  ["electricidade", "Electricidade"],
  ["outro", "Outra disciplina"],
];
const UNITS = ["m", "m2", "m3", "ml", "kg", "un", "vg", "h"];

type DraftItem = { code: string; description: string; unit: string; compositionId: string };
type Draft = {
  originalCode: string | null;
  code: string;
  name: string;
  discipline: WorkChapter["discipline"];
  tags: string;
  requiresTagMatch: boolean;
  items: DraftItem[];
};

type QuickLine = { kind: "material" | "labour" | "equipment"; refId: string; qtyPerUnit: number; wastePct: number };
type QuickDraft = {
  itemIndex: number;
  name: string;
  category: string;
  outputUnit: string;
  lines: QuickLine[];
  newKind: QuickLine["kind"];
  newRefId: string;
  newQty: string;
  newWaste: string;
};

function money(value: string | number) {
  return Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyDraft(): Draft {
  return {
    originalCode: null,
    code: "",
    name: "",
    discipline: "outro",
    tags: "",
    requiresTagMatch: true,
    items: [{ code: "", description: "", unit: "un", compositionId: "" }],
  };
}

function chapterUnpricedCount(chapter: WorkChapter) {
  return chapter.items.filter((item) => !item.compositionId && !item.composition).length;
}

export default function WorkChapterLibrary({
  compositions: compositionsProp,
  onCount,
  onError,
  onSaved,
  onCompositionsChanged,
}: {
  compositions: CostComposition[];
  onCount?: (count: number) => void;
  onError: (message: string) => void;
  onSaved: (message: string) => void;
  onCompositionsChanged?: () => void;
}) {
  const { user } = useAuth();
  const [chapters, setChapters] = useState<WorkChapter[]>([]);
  const [compositions, setCompositions] = useState(compositionsProp);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [quick, setQuick] = useState<QuickDraft | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [labour, setLabour] = useState<LabourCategory[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [resourcesLoaded, setResourcesLoaded] = useState(false);

  useEffect(() => {
    setCompositions(compositionsProp);
  }, [compositionsProp]);

  async function reload() {
    const rows = await catalogApi.listWorkChapters();
    setChapters(rows);
    onCount?.(rows.length);
  }

  useEffect(() => {
    reload().catch((error) => onError(error.message));
  }, []);

  const compositionById = useMemo(() => new Map(compositions.map((row) => [row.id, row])), [compositions]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt");
    if (!needle) return chapters;
    return chapters.filter((chapter) =>
      `${chapter.code} ${chapter.name} ${chapter.discipline} ${chapter.detectionTags.join(" ")} ${chapter.items.map((item) => item.description).join(" ")}`
        .toLocaleLowerCase("pt")
        .includes(needle),
    );
  }, [chapters, query]);

  function edit(chapter: WorkChapter) {
    setDraft({
      originalCode: chapter.code,
      code: chapter.code,
      name: chapter.name,
      discipline: chapter.discipline,
      tags: chapter.detectionTags.join(", "),
      requiresTagMatch: chapter.requiresTagMatch,
      items: chapter.items.map((item) => ({
        code: item.code,
        description: item.description,
        unit: item.unit,
        compositionId: item.compositionId ?? compositions.find((composition) => composition.name === item.composition)?.id ?? "",
      })),
    });
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setDraft((current) =>
      current
        ? { ...current, items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) }
        : current,
    );
  }

  async function ensureResources() {
    if (resourcesLoaded) return;
    const [m, l, e] = await Promise.all([
      catalogApi.listMaterials(),
      catalogApi.listLabourCategories(),
      catalogApi.listEquipment(),
    ]);
    setMaterials(m);
    setLabour(l);
    setEquipment(e);
    setResourcesLoaded(true);
  }

  async function openQuickComposition(itemIndex: number) {
    if (!draft) return;
    try {
      await ensureResources();
      const item = draft.items[itemIndex];
      setQuick({
        itemIndex,
        name: item.description.trim() || `Composição ${item.code || itemIndex + 1}`,
        category: "Capítulos de trabalho",
        outputUnit: item.unit || "un",
        lines: [],
        newKind: "material",
        newRefId: "",
        newQty: "1",
        newWaste: "0",
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível carregar recursos do catálogo");
    }
  }

  function resourceOptions(kind: QuickLine["kind"]) {
    if (kind === "material") return materials.map((row) => ({ id: row.id, label: `${row.name} (${money(row.effectiveUnitCost)} MZN/${row.unit})`, cost: row.effectiveUnitCost }));
    if (kind === "labour") return labour.map((row) => ({ id: row.id, label: `${row.name} (${money(row.hourlyRate)} MZN/h)`, cost: Number(row.hourlyRate) }));
    return equipment.map((row) => ({ id: row.id, label: `${row.name} (${money(row.hourlyCost)} MZN/${row.unit})`, cost: Number(row.hourlyCost) }));
  }

  function lineUnitCost(line: QuickLine) {
    if (line.kind === "material") return materials.find((row) => row.id === line.refId)?.effectiveUnitCost ?? 0;
    if (line.kind === "labour") return Number(labour.find((row) => row.id === line.refId)?.hourlyRate ?? 0);
    return Number(equipment.find((row) => row.id === line.refId)?.hourlyCost ?? 0);
  }

  function lineName(line: QuickLine) {
    if (line.kind === "material") return materials.find((row) => row.id === line.refId)?.name ?? "Material";
    if (line.kind === "labour") return labour.find((row) => row.id === line.refId)?.name ?? "Mão-de-obra";
    return equipment.find((row) => row.id === line.refId)?.name ?? "Equipamento";
  }

  const quickEstimate = useMemo(() => {
    if (!quick) return 0;
    return quick.lines.reduce((sum, line) => {
      const waste = line.kind === "material" ? 1 + line.wastePct / 100 : 1;
      return sum + line.qtyPerUnit * waste * lineUnitCost(line);
    }, 0);
  }, [quick, materials, labour, equipment]);

  function addQuickLine() {
    if (!quick || !quick.newRefId || !quick.newQty) return;
    if (quick.lines.some((line) => line.kind === quick.newKind && line.refId === quick.newRefId)) {
      onError("Esse recurso já está na composição rápida.");
      return;
    }
    setQuick({
      ...quick,
      lines: [
        ...quick.lines,
        {
          kind: quick.newKind,
          refId: quick.newRefId,
          qtyPerUnit: Number(quick.newQty),
          wastePct: quick.newKind === "material" ? Number(quick.newWaste || 0) : 0,
        },
      ],
      newRefId: "",
      newQty: "1",
      newWaste: "0",
    });
  }

  async function saveQuickComposition(event: FormEvent) {
    event.preventDefault();
    if (!quick || !draft) return;
    if (!quick.lines.length) {
      onError("Adicione pelo menos um recurso (material, mão-de-obra ou equipamento).");
      return;
    }
    setQuickSaving(true);
    try {
      const created = await catalogApi.createComposition({
        name: quick.name.trim(),
        category: quick.category.trim() || "Capítulos de trabalho",
        outputUnit: quick.outputUnit,
        currency: "MZN",
        labourLines: quick.lines
          .filter((line) => line.kind === "labour")
          .map((line) => ({ refId: line.refId, qtyPerUnit: line.qtyPerUnit })),
        materialLines: quick.lines
          .filter((line) => line.kind === "material")
          .map((line) => ({ refId: line.refId, qtyPerUnit: line.qtyPerUnit, wastePct: line.wastePct })),
        equipmentLines: quick.lines
          .filter((line) => line.kind === "equipment")
          .map((line) => ({ refId: line.refId, qtyPerUnit: line.qtyPerUnit })),
      });
      const refreshed = await catalogApi.listCompositions();
      setCompositions(refreshed);
      onCompositionsChanged?.();
      updateItem(quick.itemIndex, { compositionId: created.id });
      setQuick(null);
      onSaved(`Composição «${created.name}» criada e ligada ao item (${money(created.unitCost)} MZN/${created.outputUnit}).`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível criar a composição");
    } finally {
      setQuickSaving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const input: WorkChapterInput = {
        code: draft.code.trim(),
        name: draft.name.trim(),
        discipline: draft.discipline,
        detectionTags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        requiresTagMatch: draft.requiresTagMatch,
        items: draft.items.map((item) => ({
          code: item.code.trim(),
          description: item.description.trim(),
          unit: item.unit,
          compositionId: item.compositionId || null,
        })),
      };
      if (draft.originalCode) await catalogApi.updateWorkChapter(draft.originalCode, input);
      else await catalogApi.createWorkChapter(input);
      setDraft(null);
      await reload();
      onSaved(draft.originalCode ? "Capítulo actualizado." : "Capítulo criado e disponível para novas medições.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível guardar o capítulo");
    } finally {
      setSaving(false);
    }
  }

  async function remove(chapter: WorkChapter) {
    try {
      await catalogApi.deleteWorkChapter(chapter.code);
      await reload();
      onSaved("Capítulo próprio removido.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível remover o capítulo");
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pesquisar capítulo, item ou disciplina..."
          className="input max-w-sm"
        />
        <button type="button" onClick={() => setDraft(emptyDraft())} className="btn btn-primary btn-sm">
          <IconPlus className="h-3.5 w-3.5" /> Novo capítulo
        </button>
      </div>
      <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x 2xl:grid-cols-3">
        {filtered.map((chapter) => {
          const own = user?.role === "super_admin" ? chapter.companyId === null : chapter.companyId === user?.companyId;
          const unpriced = chapterUnpricedCount(chapter);
          return (
            <article key={chapter.code} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-bold text-brand-700">{chapter.code}</span>
                  <strong className="mt-1 block text-sm text-slate-950">{chapter.name}</strong>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`badge ${own ? "badge-brand" : "badge-gray"}`}>{own ? "Empresa" : "SIGO"}</span>
                  {unpriced > 0 ? (
                    <span className="badge badge-yellow">{unpriced} sem preço</span>
                  ) : (
                    <span className="badge badge-green">com custo</span>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {DISCIPLINES.find(([value]) => value === chapter.discipline)?.[1]} · {chapter.items.length} item(ns)
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {chapter.detectionTags.slice(0, 4).map((tag) => (
                  <span key={tag} className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                <button type="button" onClick={() => edit(chapter)} className="btn btn-secondary btn-sm flex-1">
                  {own ? "Editar" : "Personalizar"}
                </button>
                {own && (
                  <button type="button" onClick={() => remove(chapter)} className="btn btn-danger btn-sm">
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!filtered.length && <p className="p-6 text-sm text-slate-500">Nenhum capítulo encontrado.</p>}
      </div>

      {draft && (
        <Modal
          title={draft.originalCode ? "Editar capítulo" : "Novo capítulo"}
          onClose={() => setDraft(null)}
        >
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
              <div>
                <label className="label">Código</label>
                <input
                  required
                  disabled={!!draft.originalCode}
                  value={draft.code}
                  onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Nome</label>
                <input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="input" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Disciplina</label>
                <select
                  value={draft.discipline}
                  onChange={(event) => setDraft({ ...draft, discipline: event.target.value as WorkChapter["discipline"] })}
                  className="input"
                >
                  {DISCIPLINES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Palavras de detecção</label>
                <input
                  value={draft.tags}
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  placeholder="ex: incêndio, extintor, hidrante"
                  className="input"
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={draft.requiresTagMatch}
                    onChange={(event) => setDraft({ ...draft, requiresTagMatch: event.target.checked })}
                  />
                  Incluir apenas quando uma destas palavras aparecer na planta
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="label !mb-0">Itens do capítulo</label>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, items: [...draft.items, { code: "", description: "", unit: "un", compositionId: "" }] })}
                  className="btn btn-secondary btn-sm"
                >
                  <IconPlus className="h-3.5 w-3.5" /> Item
                </button>
              </div>

              {draft.items.map((item, index) => {
                const composition = item.compositionId ? compositionById.get(item.compositionId) : undefined;
                return (
                  <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div className="grid gap-2 sm:grid-cols-[90px_1fr_80px_auto]">
                      <input
                        required
                        value={item.code}
                        onChange={(event) => updateItem(index, { code: event.target.value })}
                        placeholder="14.1"
                        className="input input-sm"
                      />
                      <input
                        required
                        value={item.description}
                        onChange={(event) => updateItem(index, { description: event.target.value })}
                        placeholder="Descrição do trabalho"
                        className="input input-sm"
                      />
                      <select value={item.unit} onChange={(event) => updateItem(index, { unit: event.target.value })} className="input input-sm">
                        {UNITS.map((unit) => (
                          <option key={unit}>{unit}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={draft.items.length === 1}
                        onClick={() => setDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}
                        className="btn btn-ghost btn-sm"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <select
                        value={item.compositionId}
                        onChange={(event) => updateItem(index, { compositionId: event.target.value })}
                        className="input input-sm"
                      >
                        <option value="">Preço por definir</option>
                        {compositions.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name} — {money(row.unitCost)} MZN/{row.outputUnit}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => openQuickComposition(index)} className="btn btn-secondary btn-sm whitespace-nowrap">
                        Nova composição
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      {composition ? (
                        <span className="text-emerald-700">
                          Custo unitário: <strong className="tabular-nums">{money(composition.unitCost)} MZN</strong> / {composition.outputUnit}
                          {!composition.isReady && <span className="ml-2 text-amber-700">(composição incompleta)</span>}
                        </span>
                      ) : (
                        <span className="text-amber-700">Sem composição — o item entrará nas medições sem preço.</span>
                      )}
                      {composition && (
                        <a href={`/catalogo/composicoes/${composition.id}`} className="font-medium text-brand-700 hover:underline">
                          Abrir composição →
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setDraft(null)} className="btn btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? "A guardar..." : "Guardar capítulo"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {quick && (
        <Modal
          title="Composição rápida"
          onClose={() => setQuick(null)}
        >
          <form onSubmit={saveQuickComposition} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_140px_90px]">
              <div>
                <label className="label">Nome da composição</label>
                <input required value={quick.name} onChange={(event) => setQuick({ ...quick, name: event.target.value })} className="input" />
              </div>
              <div>
                <label className="label">Categoria</label>
                <input value={quick.category} onChange={(event) => setQuick({ ...quick, category: event.target.value })} className="input" />
              </div>
              <div>
                <label className="label">Unidade</label>
                <select value={quick.outputUnit} onChange={(event) => setQuick({ ...quick, outputUnit: event.target.value })} className="input">
                  {UNITS.map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <strong className="text-sm text-slate-800">Parâmetros de cálculo</strong>
                <span className="text-sm font-semibold tabular-nums text-brand-800">{money(quickEstimate)} MZN / {quick.outputUnit}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {quick.lines.map((line, index) => (
                  <div key={`${line.kind}-${line.refId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <strong className="block text-slate-900">{lineName(line)}</strong>
                      <span className="text-xs text-slate-500">
                        {line.kind === "material" ? "Material" : line.kind === "labour" ? "Mão-de-obra" : "Equipamento"}
                        {" · "}
                        {line.qtyPerUnit}
                        {line.kind === "material" && line.wastePct ? ` (+${line.wastePct}% perda)` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-slate-700">
                        {money(line.qtyPerUnit * (line.kind === "material" ? 1 + line.wastePct / 100 : 1) * lineUnitCost(line))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuick({ ...quick, lines: quick.lines.filter((_, i) => i !== index) })}
                        className="btn btn-ghost btn-sm"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {!quick.lines.length && <p className="px-3 py-4 text-xs text-slate-500">Ainda sem recursos. Adicione materiais, mão-de-obra ou equipamento.</p>}
              </div>
              <div className="grid gap-2 border-t border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-[120px_1fr_90px_90px_auto]">
                <select
                  value={quick.newKind}
                  onChange={(event) => setQuick({ ...quick, newKind: event.target.value as QuickLine["kind"], newRefId: "" })}
                  className="input input-sm"
                >
                  <option value="material">Material</option>
                  <option value="labour">Mão-de-obra</option>
                  <option value="equipment">Equipamento</option>
                </select>
                <select value={quick.newRefId} onChange={(event) => setQuick({ ...quick, newRefId: event.target.value })} className="input input-sm">
                  <option value="">Escolher recurso...</option>
                  {resourceOptions(quick.newKind).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quick.newQty}
                  onChange={(event) => setQuick({ ...quick, newQty: event.target.value })}
                  placeholder="Qtd/un"
                  className="input input-sm"
                />
                {quick.newKind === "material" ? (
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={quick.newWaste}
                    onChange={(event) => setQuick({ ...quick, newWaste: event.target.value })}
                    placeholder="Perda %"
                    className="input input-sm"
                  />
                ) : (
                  <div />
                )}
                <button type="button" onClick={addQuickLine} className="btn btn-secondary btn-sm">
                  Adicionar
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              O detalhe fino (critérios, notas, margens) pode ser ajustado depois na ficha da composição.
            </p>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button type="button" onClick={() => setQuick(null)} className="btn btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={quickSaving} className="btn btn-primary">
                {quickSaving ? "A criar..." : "Criar e ligar ao item"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
