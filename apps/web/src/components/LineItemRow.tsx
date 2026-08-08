import { Fragment, useState } from "react";
import type { LineItemNode, LineItemKind } from "../api/boq";
import type { CostComposition } from "../api/catalog";
import { boqApi } from "../api/boq";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { isItemMissingPrice } from "../utils/boqHelpers";
import MeasurementGrid from "./MeasurementGrid";
import LineItemCostSnapshotPanel from "./LineItemCostSnapshotPanel";
import ChapterSpecBulkEditor from "./ChapterSpecBulkEditor";
import { IconPlus, IconPencil, IconRuler, IconTrash } from "./icons";

const KIND_LABELS: Record<LineItemKind, string> = {
  capitulo: "Capítulo",
  grupo: "Grupo",
  item: "Item",
  nota: "Nota",
};

function money(value: number, currency = "") {
  const formatted = value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

// Larguras fixas para as colunas numéricas — a DESCRIÇÃO fica com o espaço restante e
// quebra dentro da sua própria coluna, nunca "empurrando" as colunas seguintes.
export function BoqHeaderRow({ measurementOnly = false }: { measurementOnly?: boolean }) {
  if (measurementOnly) {
    return <colgroup><col className="w-16" /><col /><col className="w-14" /><col className="w-28" /><col className="w-24" /></colgroup>;
  }
  return (
    <colgroup>
      <col className="w-16" />
      <col />
      <col className="hidden w-12 sm:table-column" />
      <col className="w-24" />
      <col className="hidden w-28 sm:table-column" />
      <col className="w-28" />
      <col className="w-28" />
    </colgroup>
  );
}

export function BoqTableHead({ readOnly = false, measurementOnly = false }: { readOnly?: boolean; measurementOnly?: boolean }) {
  return (
    <thead>
      <tr className="table-head-row">
        <th className="py-2 px-2 font-medium">Item</th>
        <th className="font-medium">Descrição</th>
        <th className="hidden font-medium sm:table-cell">Un</th>
        <th className="text-right font-medium">Quant.</th>
        {!measurementOnly && <th className="hidden text-right font-medium sm:table-cell">P. Unit.</th>}
        {!measurementOnly && <th className="text-right font-medium">Total</th>}
        <th className="text-right font-medium pr-2">{readOnly ? "" : "Acções"}</th>
      </tr>
    </thead>
  );
}

function AddChildForm({
  sectionId,
  parentId,
  compositions,
  measurementOnly,
  onDone,
}: {
  sectionId: string;
  parentId: string | null;
  compositions: CostComposition[];
  measurementOnly?: boolean;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<LineItemKind>("item");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("m2");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [compositionId, setCompositionId] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await boqApi.createLineItem(sectionId, {
        parentId,
        kind,
        code: code || null,
        description,
        unit: kind === "item" ? (unit as any) : null,
        quantity: kind === "item" && quantity ? Number(quantity) : null,
        unitPrice: !measurementOnly && kind === "item" && !compositionId && unitPrice ? Number(unitPrice) : null,
        compositionId: !measurementOnly && kind === "item" && compositionId ? compositionId : null,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-1.5 items-end bg-brand-50/70 border border-brand-100 rounded-lg p-2.5">
      <select value={kind} onChange={(e) => setKind(e.target.value as LineItemKind)} className="input input-sm w-auto">
        {Object.entries(KIND_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <input placeholder="código" value={code} onChange={(e) => setCode(e.target.value)} className="input input-sm w-20" />
      <input
        required
        placeholder="descrição"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="input input-sm flex-1 min-w-[160px]"
      />
      {kind === "item" && (
        <>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="input input-sm w-auto">
            {["m", "m2", "m3", "ml", "kg", "un", "vg", "h"].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <input type="number" step="0.01" placeholder="quant." value={quantity} onChange={(e) => setQuantity(e.target.value)} className="input input-sm w-20" />
          {!measurementOnly && <select value={compositionId} onChange={(e) => setCompositionId(e.target.value)} className="input input-sm w-auto max-w-[180px]">
            <option value="">preço manual</option>
            {compositions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({money(c.unitCost)})
              </option>
            ))}
          </select>}
          {!measurementOnly && !compositionId && (
            <input type="number" step="0.01" placeholder="custo directo" title="Custo directo interno, antes de estaleiro, indirectos e margem" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="input input-sm w-28" />
          )}
        </>
      )}
      <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
        <IconPlus className="w-3.5 h-3.5" />
        Adicionar
      </button>
    </form>
  );
}

export default function LineItemRow({
  node,
  depth,
  sectionId,
  compositions,
  onChange,
  readOnly = false,
  measurementOnly = false,
  hasPlantRooms = false,
}: {
  node: LineItemNode;
  depth: number;
  sectionId: string;
  compositions: CostComposition[];
  onChange: () => void;
  readOnly?: boolean;
  measurementOnly?: boolean;
  hasPlantRooms?: boolean;
}) {
  const { confirm, dialog } = useConfirmDialog();
  const [showAdd, setShowAdd] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [showChapterSpecs, setShowChapterSpecs] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingSpec, setEditingSpec] = useState(false);
  const [descDraft, setDescDraft] = useState(node.description);
  const [specDraft, setSpecDraft] = useState(node.technicalSpecification ?? "");
  const [savingDesc, setSavingDesc] = useState(false);
  const [savingSpec, setSavingSpec] = useState(false);
  const [linkingComposition, setLinkingComposition] = useState(false);

  const canEdit = !readOnly;

  async function handleLinkComposition(compositionId: string) {
    if (!compositionId) return;
    setLinkingComposition(true);
    try {
      await boqApi.updateLineItem(node.id, { compositionId });
      onChange();
    } finally {
      setLinkingComposition(false);
    }
  }

  async function handleSaveDescription() {
    if (descDraft.trim() === node.description) {
      setEditingDesc(false);
      return;
    }
    setSavingDesc(true);
    try {
      await boqApi.updateLineItem(node.id, { description: descDraft.trim() });
      setEditingDesc(false);
      onChange();
    } finally {
      setSavingDesc(false);
    }
  }

  async function handleSaveSpecification() {
    const next = specDraft.trim();
    const current = node.technicalSpecification?.trim() ?? "";
    if (next === current) {
      setEditingSpec(false);
      return;
    }
    setSavingSpec(true);
    try {
      await boqApi.updateLineItem(node.id, { technicalSpecification: next || null });
      setEditingSpec(false);
      onChange();
    } finally {
      setSavingSpec(false);
    }
  }

  function startEditDescription() {
    if (!canEdit) return;
    setDescDraft(node.description);
    setEditingDesc(true);
    setEditingSpec(false);
  }

  function startEditSpecification() {
    if (!canEdit || node.kind !== "item") return;
    setSpecDraft(node.technicalSpecification ?? "");
    setEditingSpec(true);
    setEditingDesc(false);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Eliminar linha?",
      message: `Eliminar “${node.description}”?`,
      confirmLabel: "Eliminar",
      danger: true,
      details: node.children.length > 0 ? [`${node.children.length} sub-item(ns) também serão removidos`] : undefined,
    });
    if (!ok) return;
    await boqApi.deleteLineItem(node.id);
    onChange();
  }

  const isChapter = node.kind === "capitulo";
  const isGroup = node.kind === "grupo";
  const isNote = node.kind === "nota";
  const missingPrice = !measurementOnly && isItemMissingPrice(node);

  const rowBg = missingPrice
    ? "bg-amber-50 ring-1 ring-inset ring-amber-300"
    : isChapter
      ? "bg-brand-50/80 font-semibold text-brand-950"
      : isGroup
        ? "font-medium text-gray-800"
        : "";

  return (
    <Fragment>
      <tr id={node.kind === "item" ? `line-item-${node.id}` : undefined} className={`${rowBg} table-row text-sm group scroll-mt-24`}>
        <td className={`py-1.5 px-2 text-xs align-top ${isChapter ? "text-brand-700 font-bold" : missingPrice ? "text-amber-800 font-bold" : "text-gray-400"}`}>
          <span className="inline-flex flex-col gap-0.5">
            <span>{node.code}</span>
            {missingPrice && (
              <span className="rounded bg-amber-200 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-950">
                Sem preço
              </span>
            )}
          </span>
        </td>
        <td className={`break-words align-top ${isNote ? "italic text-gray-400 text-xs" : "text-gray-800"}`} style={{ paddingLeft: 8 + depth * 12 }}>
          {!readOnly && editingDesc ? (
            <div className="space-y-1">
              <textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} rows={isNote ? 2 : 3} className="input input-sm w-full text-sm" />
              <div className="flex gap-1">
                <button type="button" onClick={handleSaveDescription} disabled={savingDesc} className="btn btn-primary btn-sm">{savingDesc ? "..." : "Guardar"}</button>
                <button type="button" onClick={() => { setEditingDesc(false); setDescDraft(node.description); }} className="btn btn-ghost btn-sm">Cancelar</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-1.5">
                <span
                  className={canEdit ? "cursor-pointer hover:text-brand-800 flex-1 min-w-0" : "flex-1 min-w-0"}
                  onClick={startEditDescription}
                  title={canEdit ? "Clique para editar" : undefined}
                >
                  {node.description}
                </span>
                {canEdit && (
                  <button type="button" onClick={startEditDescription} className="icon-btn shrink-0 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100" title="Editar descrição">
                    <IconPencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {node.kind === "item" && !editingSpec && (
                node.technicalSpecification ? (
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-500 border-l-2 border-brand-200 pl-2">
                    <div className="flex items-start gap-1">
                      <p className="flex-1 min-w-0">
                        <span className="font-semibold text-brand-700">Especificação: </span>
                        {node.technicalSpecification}
                      </p>
                      {canEdit && (
                        <button type="button" onClick={startEditSpecification} className="icon-btn shrink-0 !h-6 !w-6" title="Editar especificação">
                          <IconPencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ) : canEdit ? (
                  <button type="button" onClick={startEditSpecification} className="mt-1 text-[11px] font-medium text-brand-700 hover:text-brand-900">
                    + Adicionar especificação técnica
                  </button>
                ) : null
              )}
              {node.kind === "item" && missingPrice && canEdit && !measurementOnly && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-100/60 p-2">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                    Ligar composição do catálogo
                  </label>
                  <select
                    defaultValue=""
                    disabled={linkingComposition}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) void handleLinkComposition(id);
                    }}
                    className="input input-sm w-full max-w-md text-xs"
                  >
                    <option value="">Escolher composição…</option>
                    {compositions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({money(c.unitCost ?? 0)}/{c.outputUnit})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {node.kind === "item" && editingSpec && (
                <div className="mt-1 space-y-1 border-l-2 border-brand-200 pl-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-brand-700">Especificação técnica</label>
                  <textarea value={specDraft} onChange={(e) => setSpecDraft(e.target.value)} rows={3} className="input input-sm w-full text-xs" placeholder="Marca, norma, acabamento, cor, dimensões do equipamento..." />
                  <div className="flex gap-1">
                    <button type="button" onClick={handleSaveSpecification} disabled={savingSpec} className="btn btn-primary btn-sm">{savingSpec ? "..." : "Guardar"}</button>
                    <button type="button" onClick={() => { setEditingSpec(false); setSpecDraft(node.technicalSpecification ?? ""); }} className="btn btn-ghost btn-sm">Cancelar</button>
                  </div>
                </div>
              )}
            </>
          )}
        </td>
        <td className="hidden align-top text-xs text-gray-400 whitespace-nowrap sm:table-cell">{node.kind === "item" ? node.unit : ""}</td>
        <td className="align-top text-right text-gray-600 tabular-nums whitespace-nowrap">{node.kind === "item" ? node.quantity : ""}</td>
        {!measurementOnly && (
          <td className="hidden align-top text-right tabular-nums whitespace-nowrap sm:table-cell">
            {node.kind === "item" ? (
              missingPrice ? (
                <span className="text-xs font-semibold text-amber-700">— sem preço</span>
              ) : (
                <span className="text-gray-600">{money(node.sellingUnitPrice ?? node.unitPrice ?? 0)}</span>
              )
            ) : (
              ""
            )}
          </td>
        )}
        {!measurementOnly && <td className={`align-top text-right tabular-nums whitespace-nowrap ${isChapter ? "font-bold" : "font-medium"} ${isNote ? "text-transparent" : missingPrice ? "text-amber-700" : "text-gray-900"}`}>
          {isNote ? "" : missingPrice && node.kind === "item" ? (
            <span className="text-xs font-semibold">—</span>
          ) : (
            money(node.sellingTotalPrice ?? node.totalPrice)
          )}
        </td>}
        <td className="align-top text-right pr-2 whitespace-nowrap">
          <span className="inline-flex gap-1">
            {!readOnly && node.kind === "item" && (
              <button
                onClick={() => setShowMeasurements((s) => !s)}
                className={`icon-btn ${showMeasurements ? "icon-btn-active opacity-100" : ""}`}
                title="Medições dimensionais (Nº × Comp. × Larg. × Alt.)"
              >
                <IconRuler className="w-4 h-4" />
              </button>
            )}
            {node.kind === "item" && node.compositionId && (
              <button
                onClick={() => { setShowSnapshot((s) => !s); setShowMeasurements(false); }}
                className={`icon-btn ${showSnapshot ? "icon-btn-active opacity-100" : ""}`}
                title="Snapshot APU — custo unitário e fontes de preço capturados"
              >
                <span className="text-[9px] font-bold tracking-wide">APU</span>
              </button>
            )}
            {!readOnly && isChapter && !measurementOnly && (
              <button
                onClick={() => setShowChapterSpecs(true)}
                className="icon-btn"
                title="Editar especificações de todos os itens deste capítulo"
              >
                <IconPencil className="w-4 h-4" />
              </button>
            )}
            {!readOnly && (isChapter || isGroup) && (
              <button onClick={() => setShowAdd((s) => !s)} className="icon-btn" title="Adicionar sub-item">
                <IconPlus className="w-4 h-4" />
              </button>
            )}
            {!readOnly && <button onClick={handleDelete} className="icon-btn-danger" title="Eliminar">
              <IconTrash className="w-4 h-4" />
            </button>}
          </span>
        </td>
      </tr>

      {showSnapshot && node.kind === "item" && (
        <tr>
          <td colSpan={measurementOnly ? 5 : 7} className="bg-white pb-2">
            <div className="sm:ml-14">
              <LineItemCostSnapshotPanel lineItemId={node.id} />
            </div>
          </td>
        </tr>
      )}

      {showMeasurements && node.kind === "item" && (
        <tr>
          <td colSpan={measurementOnly ? 5 : 7} className="bg-white pb-2">
            <MeasurementGrid
              lineItemId={node.id}
              itemCode={node.code}
              itemUnit={node.unit}
              compositionId={node.compositionId}
              compositions={compositions}
              hasPlantRooms={hasPlantRooms}
              onQuantityChange={onChange}
            />
          </td>
        </tr>
      )}

      {showAdd && (
        <tr>
          <td colSpan={measurementOnly ? 5 : 7} className="pb-2" style={{ paddingLeft: depth * 16 }}>
            <AddChildForm
              sectionId={sectionId}
              parentId={node.id}
              compositions={compositions}
              measurementOnly={measurementOnly}
              onDone={() => {
                setShowAdd(false);
                onChange();
              }}
            />
          </td>
        </tr>
      )}

      {node.children.map((child) => (
          <LineItemRow
            key={child.id}
            node={child}
            depth={depth + 1}
            sectionId={sectionId}
            compositions={compositions}
            onChange={onChange}
            readOnly={readOnly}
            measurementOnly={measurementOnly}
            hasPlantRooms={hasPlantRooms}
          />
      ))}
      {showChapterSpecs && isChapter && (
        <ChapterSpecBulkEditor
          chapter={node}
          chapterLabel={`${node.code ?? ""} ${node.description}`.trim()}
          onClose={() => setShowChapterSpecs(false)}
          onSaved={onChange}
        />
      )}
      {dialog}
    </Fragment>
  );
}

export { AddChildForm };
