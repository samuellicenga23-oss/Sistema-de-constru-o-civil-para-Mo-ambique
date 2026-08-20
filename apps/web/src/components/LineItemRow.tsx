import { Fragment, useEffect, useRef, useState } from "react";
import type { LineItemNode, LineItemKind } from "../api/boq";
import type { CostComposition } from "../api/catalog";
import { boqApi } from "../api/boq";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { isItemMissingPrice } from "../utils/boqHelpers";
import MeasurementGrid from "./MeasurementGrid";
import ChapterSpecBulkEditor from "./ChapterSpecBulkEditor";
import LineItemSidePanel from "./LineItemSidePanel";
import DocumentReviewCommentsPanel from "./DocumentReviewCommentsPanel";
import { IconPlus, IconPencil, IconRuler, IconTrash } from "./icons";
import MoneyInput from "./MoneyInput";
import { boqProvenanceBadge } from "../utils/boqProvenance";

export type BoqLineMutations = {
  createItem: (
    sectionId: string,
    parentId: string | null,
    data: {
      kind: LineItemKind;
      code?: string | null;
      description: string;
      unit?: string | null;
      quantity?: number | null;
      unitPrice?: number | null;
      compositionId?: string | null;
    },
  ) => void | Promise<unknown>;
  updateItem: (
    id: string,
    data: Partial<{
      description: string;
      technicalSpecification: string | null;
      quantity: number | null;
      unitPrice: number | null;
      compositionId: string | null;
    }>,
  ) => void | Promise<unknown>;
  deleteItem: (id: string) => void | Promise<unknown>;
};

export const defaultBoqLineMutations: BoqLineMutations = {
  createItem: async (sectionId, parentId, data) => {
    await boqApi.createLineItem(sectionId, { ...data, parentId });
  },
  updateItem: async (id, data) => {
    await boqApi.updateLineItem(id, {
      ...data,
      quantity: data.quantity === null ? undefined : data.quantity,
      unitPrice: data.unitPrice === null ? undefined : data.unitPrice,
    });
  },
  deleteItem: async (id) => {
    await boqApi.deleteLineItem(id);
  },
};

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
    return <colgroup><col className="w-16" /><col /><col className="w-14" /><col className="w-28" /><col className="w-20" /><col className="w-28" /></colgroup>;
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
        <th className="text-right font-medium">Quantidade</th>
        {measurementOnly && <th className="hidden text-right font-medium sm:table-cell">Origem</th>}
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
  mutations = defaultBoqLineMutations,
  onDone,
}: {
  sectionId: string;
  parentId: string | null;
  compositions: CostComposition[];
  measurementOnly?: boolean;
  mutations?: BoqLineMutations;
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
      await mutations.createItem(sectionId, parentId, {
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
            <MoneyInput className="input input-sm w-36" placeholder="custo directo" title="Custo directo interno, antes de estaleiro, indirectos e margem" value={unitPrice} onValueChange={setUnitPrice} />
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
  allowLivePersistence = true,
  mutations = defaultBoqLineMutations,
  activeEditId = null,
  onRequestEdit,
  onEditDirtyChange,
  documentId = null,
}: {
  node: LineItemNode;
  depth: number;
  sectionId: string;
  compositions: CostComposition[];
  onChange: () => void;
  readOnly?: boolean;
  measurementOnly?: boolean;
  hasPlantRooms?: boolean;
  allowLivePersistence?: boolean;
  mutations?: BoqLineMutations;
  /** Only one line may be in edit mode at a time (lifted state). */
  activeEditId?: string | null;
  onRequestEdit?: (id: string | null, dirty: boolean) => Promise<boolean> | boolean;
  /** Report whether the active edit row has unsaved changes (for click-outside / switch). */
  onEditDirtyChange?: (id: string, dirty: boolean) => void;
  documentId?: string | null;
}) {
  const { confirm, dialog } = useConfirmDialog();
  const [showAdd, setShowAdd] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showChapterSpecs, setShowChapterSpecs] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<"spec" | "apu" | "comments" | null>(null);
  const [descDraft, setDescDraft] = useState(node.description);
  const [qtyDraft, setQtyDraft] = useState(node.quantity != null ? String(node.quantity) : "");
  const [unitPriceDraft, setUnitPriceDraft] = useState(
    node.sellingUnitPrice != null ? String(node.sellingUnitPrice) : node.unitPrice != null ? String(node.unitPrice) : "",
  );
  const [specDraft, setSpecDraft] = useState(node.technicalSpecification ?? "");
  const [saving, setSaving] = useState(false);
  const [linkingComposition, setLinkingComposition] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const editBlockRef = useRef<HTMLTableRowElement>(null);
  const measureBlockRef = useRef<HTMLTableRowElement>(null);

  const canEdit = !readOnly;
  const isEditing = activeEditId === node.id;
  const isChapter = node.kind === "capitulo";
  const isGroup = node.kind === "grupo";
  const isNote = node.kind === "nota";
  const missingPrice = !measurementOnly && isItemMissingPrice(node);
  const provenance = boqProvenanceBadge(node.origin, node.quantitySource);
  const hasSpec = Boolean(node.technicalSpecification?.trim());

  const dirty =
    isEditing &&
    (descDraft.trim() !== node.description ||
      (node.kind === "item" && (qtyDraft === "" ? null : Number(qtyDraft)) !== node.quantity) ||
      (!measurementOnly && node.kind === "item" && !node.compositionId && unitPriceDraft !== String(node.unitPrice ?? "")));

  useEffect(() => {
    if (!isEditing) {
      setDescDraft(node.description);
      setQtyDraft(node.quantity != null ? String(node.quantity) : "");
      setUnitPriceDraft(node.sellingUnitPrice != null ? String(node.sellingUnitPrice) : node.unitPrice != null ? String(node.unitPrice) : "");
    }
  }, [node.description, node.quantity, node.unitPrice, node.sellingUnitPrice, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    onEditDirtyChange?.(node.id, dirty);
  }, [isEditing, dirty, node.id, onEditDirtyChange]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (!isEditing || dirty) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (editBlockRef.current?.contains(target)) return;
      if (measureBlockRef.current?.contains(target)) return;
      void cancelEdit();
      setShowMeasurements(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isEditing, dirty]);

  useEffect(() => {
    if (!showMeasurements || isEditing) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (editBlockRef.current?.contains(target)) return;
      if (measureBlockRef.current?.contains(target)) return;
      setShowMeasurements(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showMeasurements, isEditing]);

  const editHistoryRef = useRef<{ desc: string[]; qty: string[]; idx: number }>({
    desc: [],
    qty: [],
    idx: -1,
  });

  useEffect(() => {
    if (!isEditing) {
      editHistoryRef.current = { desc: [], qty: [], idx: -1 };
      return;
    }
    if (editHistoryRef.current.idx < 0) {
      editHistoryRef.current = {
        desc: [node.description],
        qty: [node.quantity != null ? String(node.quantity) : ""],
        idx: 0,
      };
    }
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const hist = editHistoryRef.current;
      e.preventDefault();
      if (e.shiftKey) {
        if (hist.idx >= hist.desc.length - 1) return;
        hist.idx += 1;
      } else {
        if (hist.idx <= 0) return;
        hist.idx -= 1;
      }
      setDescDraft(hist.desc[hist.idx] ?? "");
      setQtyDraft(hist.qty[hist.idx] ?? "");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isEditing, node.description, node.quantity]);

  function pushEditHistory(nextDesc: string, nextQty: string) {
    const hist = editHistoryRef.current;
    if (hist.desc[hist.idx] === nextDesc && hist.qty[hist.idx] === nextQty) return;
    hist.desc = hist.desc.slice(0, hist.idx + 1);
    hist.qty = hist.qty.slice(0, hist.idx + 1);
    hist.desc.push(nextDesc);
    hist.qty.push(nextQty);
    hist.idx = hist.desc.length - 1;
  }

  async function beginEdit() {
    if (!canEdit || node.kind === "nota") return;
    if (onRequestEdit) {
      const ok = await onRequestEdit(node.id, dirty);
      if (!ok) return;
    }
    setDescDraft(node.description);
    setQtyDraft(node.quantity != null ? String(node.quantity) : "");
    setUnitPriceDraft(node.unitPrice != null ? String(node.unitPrice) : "");
    // Em medições, editar o item abre também a memória de cálculo (não só o título).
    if (measurementOnly && node.kind === "item" && allowLivePersistence) {
      setShowMeasurements(true);
    }
  }

  async function openMeasurements() {
    if (!canEdit || node.kind !== "item" || !allowLivePersistence) return;
    if (measurementOnly) {
      await beginEdit();
      return;
    }
    setShowMeasurements((current) => !current);
  }

  async function cancelEdit() {
    if (onRequestEdit) await onRequestEdit(null, false);
    setDescDraft(node.description);
    setQtyDraft(node.quantity != null ? String(node.quantity) : "");
  }

  async function saveEdit() {
    setSaving(true);
    try {
      const payload: Parameters<BoqLineMutations["updateItem"]>[1] = { description: descDraft.trim() };
      if (node.kind === "item") {
        const nextQty = qtyDraft === "" ? null : Number(qtyDraft);
        payload.quantity = Number.isFinite(nextQty as number) ? nextQty : null;
      }
      if (!measurementOnly && node.kind === "item" && !node.compositionId && unitPriceDraft !== "") {
        payload.unitPrice = Number(unitPriceDraft);
      }
      await mutations.updateItem(node.id, payload);
      if (onRequestEdit) await onRequestEdit(null, false);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkComposition(compositionId: string) {
    if (!compositionId) return;
    setLinkingComposition(true);
    try {
      await mutations.updateItem(node.id, { compositionId });
      onChange();
    } finally {
      setLinkingComposition(false);
    }
  }

  async function handleSaveSpecification() {
    await mutations.updateItem(node.id, { technicalSpecification: specDraft.trim() || null });
    setPanel(null);
    onChange();
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
    await mutations.deleteItem(node.id);
    onChange();
  }

  const rowBg = missingPrice
    ? "bg-amber-50 ring-1 ring-inset ring-amber-300"
    : isChapter
      ? "bg-brand-50/80 font-semibold text-brand-950"
      : isGroup
        ? "font-medium text-gray-800"
        : isEditing
          ? "bg-sky-50/80 ring-1 ring-inset ring-sky-200"
          : "";

  const colSpan = measurementOnly ? 6 : 7;

  return (
    <Fragment>
      <tr
        ref={editBlockRef}
        id={node.kind === "item" ? `line-item-${node.id}` : undefined}
        className={`${rowBg} table-row text-sm group scroll-mt-24`}
      >
        <td className={`py-2 px-2 text-xs align-top ${isChapter ? "text-brand-700 font-bold" : missingPrice ? "text-amber-800 font-bold" : "text-gray-400"}`}>
          {node.code}
        </td>
        <td className={`break-words align-top ${isNote ? "italic text-gray-400 text-xs" : "text-gray-800"}`} style={{ paddingLeft: 8 + depth * 12 }}>
          {isEditing ? (
            <textarea
              value={descDraft}
              onChange={(e) => {
                setDescDraft(e.target.value);
                pushEditHistory(e.target.value, qtyDraft);
              }}
              rows={2}
              className="input input-sm w-full text-sm"
            />
          ) : (
            <div className="flex items-start gap-1.5">
              <span className="min-w-0 flex-1">{node.description}</span>
              {node.kind === "item" && hasSpec && (
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-[10px] font-bold uppercase tracking-wide text-brand-700 hover:bg-brand-50"
                  title="Ver especificação"
                  onClick={() => { setSpecDraft(node.technicalSpecification ?? ""); setPanel("spec"); }}
                >
                  ESP
                </button>
              )}
              {missingPrice && (
                <span className="shrink-0 rounded bg-amber-200 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-950" title="Sem preço / APU">
                  !
                </span>
              )}
            </div>
          )}
        </td>
        <td className="hidden align-top text-xs text-gray-400 whitespace-nowrap sm:table-cell">{node.kind === "item" ? node.unit : ""}</td>
        <td className="align-top text-right text-gray-600 tabular-nums whitespace-nowrap">
          {node.kind === "item" ? (
            isEditing ? (
              <input
                className="input input-sm w-24 text-right"
                type="number"
                min="0"
                step="any"
                value={qtyDraft}
                onChange={(e) => {
                  setQtyDraft(e.target.value);
                  pushEditHistory(descDraft, e.target.value);
                }}
              />
            ) : measurementOnly && canEdit && allowLivePersistence ? (
              <button
                type="button"
                className="tabular-nums text-brand-800 hover:underline"
                title="Abrir memória de cálculo"
                onClick={() => void openMeasurements()}
              >
                {node.quantity ?? "—"}
              </button>
            ) : (
              <span className="tabular-nums">{node.quantity ?? "—"}</span>
            )
          ) : null}
        </td>
        {measurementOnly && (
          <td className="hidden align-top text-right sm:table-cell">
            {node.kind === "item" && provenance ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600" title={provenance.title}>
                {provenance.label}
              </span>
            ) : null}
          </td>
        )}
        {!measurementOnly && (
          <td className="hidden align-top text-right tabular-nums whitespace-nowrap sm:table-cell">
            {node.kind === "item" ? (
              isEditing && !node.compositionId ? (
                <MoneyInput className="input input-sm w-28 text-right" value={unitPriceDraft} onValueChange={setUnitPriceDraft} />
              ) : missingPrice ? (
                <button type="button" className="text-xs font-semibold text-amber-700" onClick={() => setPanel("apu")} title="Associar APU">
                  —
                </button>
              ) : (
                <button
                  type="button"
                  className="text-gray-600 hover:text-brand-800 hover:underline"
                  title="Ver APU"
                  onClick={() => setPanel("apu")}
                >
                  {money(node.sellingUnitPrice ?? node.unitPrice ?? 0)}
                </button>
              )
            ) : (
              ""
            )}
          </td>
        )}
        {!measurementOnly && (
          <td className={`align-top text-right tabular-nums whitespace-nowrap ${isChapter ? "font-bold" : "font-medium"} ${isNote ? "text-transparent" : missingPrice ? "text-amber-700" : "text-gray-900"}`}>
            {isNote ? "" : missingPrice && node.kind === "item" ? <span className="text-xs font-semibold">—</span> : money(node.sellingTotalPrice ?? node.totalPrice)}
          </td>
        )}
        <td className="align-top text-right pr-2 whitespace-nowrap">
          {isEditing ? (
            <span className="inline-flex gap-1">
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void saveEdit()}>
                {saving ? "…" : "Guardar"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancelEdit()}>
                Cancelar
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center justify-end gap-0.5">
              {canEdit && node.kind === "item" && allowLivePersistence && (
                <button
                  type="button"
                  className="icon-btn"
                  title={measurementOnly ? "Editar medição e memória de cálculo" : "Memória de cálculo"}
                  onClick={() => void openMeasurements()}
                >
                  <IconRuler className="h-3.5 w-3.5" />
                </button>
              )}
              {canEdit && node.kind !== "nota" && !(measurementOnly && node.kind === "item") && (
                <button type="button" className="icon-btn" title="Editar linha" onClick={() => void beginEdit()}>
                  <IconPencil className="h-3.5 w-3.5" />
                </button>
              )}
              {canEdit && measurementOnly && node.kind !== "item" && node.kind !== "nota" && (
                <button type="button" className="icon-btn" title="Editar descrição" onClick={() => void beginEdit()}>
                  <IconPencil className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="relative" ref={menuRef}>
                <button type="button" className="icon-btn" title="Mais acções" onClick={() => setMenuOpen((v) => !v)}>
                  ⋯
                </button>
                {menuOpen && (
                  <div className="absolute right-0 z-20 mt-1 min-w-[11rem] rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
                    {node.kind === "item" && (
                      <button type="button" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setMenuOpen(false); setSpecDraft(node.technicalSpecification ?? ""); setPanel("spec"); }}>
                        Especificação
                      </button>
                    )}
                    {!measurementOnly && node.kind === "item" && (
                      <button type="button" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setMenuOpen(false); setPanel("apu"); }}>
                        {node.compositionId ? "Ver APU" : "Associar APU"}
                      </button>
                    )}
                    {canEdit && allowLivePersistence && node.kind === "item" && (
                      <button type="button" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setMenuOpen(false); void openMeasurements(); }}>
                        <span className="inline-flex items-center gap-1"><IconRuler className="h-3.5 w-3.5" /> Memória de cálculo</span>
                      </button>
                    )}
                    {canEdit && allowLivePersistence && isChapter && !measurementOnly && (
                      <button type="button" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setMenuOpen(false); setShowChapterSpecs(true); }}>
                        Specs do capítulo
                      </button>
                    )}
                    {canEdit && (isChapter || isGroup) && (
                      <button type="button" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setMenuOpen(false); setShowAdd(true); }}>
                        <span className="inline-flex items-center gap-1"><IconPlus className="h-3.5 w-3.5" /> Adicionar</span>
                      </button>
                    )}
                    <button type="button" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setMenuOpen(false); setPanel("comments"); }}>
                      Comentários
                    </button>
                    {canEdit && (
                      <button type="button" className="block w-full px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50" onClick={() => { setMenuOpen(false); void handleDelete(); }}>
                        <span className="inline-flex items-center gap-1"><IconTrash className="h-3.5 w-3.5" /> Eliminar</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </span>
          )}
        </td>
      </tr>

      {isEditing && !measurementOnly && node.kind === "item" && missingPrice && (
        <tr>
          <td colSpan={colSpan} className="bg-amber-50/80 px-4 pb-3">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-amber-900">Ligar composição (APU)</label>
            <select defaultValue="" disabled={linkingComposition} onChange={(e) => { if (e.target.value) void handleLinkComposition(e.target.value); }} className="input input-sm w-full max-w-md text-xs">
              <option value="">Escolher composição…</option>
              {compositions.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({money(c.unitCost ?? 0)}/{c.outputUnit})</option>
              ))}
            </select>
          </td>
        </tr>
      )}

      {showMeasurements && node.kind === "item" && (
        <tr ref={measureBlockRef}>
          <td colSpan={colSpan} className="bg-white pb-2">
            <div className="sm:ml-14">
              <MeasurementGrid
                lineItemId={node.id}
                itemCode={node.code}
                itemUnit={node.unit}
                compositionId={node.compositionId}
                compositions={compositions}
                hasPlantRooms={hasPlantRooms}
                onQuantityChange={onChange}
              />
            </div>
          </td>
        </tr>
      )}

      {showAdd && (
        <tr>
          <td colSpan={colSpan} className="pb-2" style={{ paddingLeft: depth * 16 }}>
            <AddChildForm
              sectionId={sectionId}
              parentId={node.id}
              compositions={compositions}
              measurementOnly={measurementOnly}
              mutations={mutations}
              onDone={() => { setShowAdd(false); onChange(); }}
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
          allowLivePersistence={allowLivePersistence}
          mutations={mutations}
          activeEditId={activeEditId}
          onRequestEdit={onRequestEdit}
          onEditDirtyChange={onEditDirtyChange}
          documentId={documentId}
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

      <LineItemSidePanel
        open={panel != null}
        kind={panel}
        title={`${node.code ?? ""} ${node.description}`.trim()}
        subtitle={node.unit ? `${node.unit}` : undefined}
        specification={node.technicalSpecification}
        lineItemId={node.id}
        allowEditSpec={canEdit && panel === "spec"}
        specDraft={specDraft}
        onSpecDraftChange={setSpecDraft}
        onSaveSpec={() => void handleSaveSpecification()}
        onClose={() => setPanel(null)}
      >
        {panel === "comments" && documentId ? (
          <DocumentReviewCommentsPanel
            documentId={documentId}
            targetType="line_item"
            targetId={node.id}
            targetLabel={`${node.code ?? ""} ${node.description}`.trim()}
            canWrite
          />
        ) : null}
      </LineItemSidePanel>
      {dialog}
    </Fragment>
  );
}

export { AddChildForm };
