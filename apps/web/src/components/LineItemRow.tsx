import { Fragment, useState } from "react";
import type { LineItemNode, LineItemKind } from "../api/boq";
import type { CostComposition } from "../api/catalog";
import { boqApi } from "../api/boq";
import MeasurementGrid from "./MeasurementGrid";
import { IconPlus, IconRuler, IconTrash } from "./icons";

const KIND_LABELS: Record<LineItemKind, string> = {
  capitulo: "Capítulo",
  grupo: "Grupo",
  item: "Item",
  nota: "Nota",
};

const COLUMN_COUNT = 7;

function money(value: number) {
  return value.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Larguras fixas para as colunas numéricas — a DESCRIÇÃO fica com o espaço restante e
// quebra dentro da sua própria coluna, nunca "empurrando" as colunas seguintes.
export function BoqHeaderRow() {
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

export function BoqTableHead() {
  return (
    <thead>
      <tr className="table-head-row">
        <th className="py-2 px-2 font-medium">Item</th>
        <th className="font-medium">Descrição</th>
        <th className="hidden font-medium sm:table-cell">Un</th>
        <th className="text-right font-medium">Quant.</th>
        <th className="hidden text-right font-medium sm:table-cell">P. Unit.</th>
        <th className="text-right font-medium">Total</th>
        <th className="text-right font-medium pr-2">Acções</th>
      </tr>
    </thead>
  );
}

function AddChildForm({
  sectionId,
  parentId,
  compositions,
  onDone,
}: {
  sectionId: string;
  parentId: string | null;
  compositions: CostComposition[];
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
        unitPrice: kind === "item" && !compositionId && unitPrice ? Number(unitPrice) : null,
        compositionId: kind === "item" && compositionId ? compositionId : null,
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
          <input type="number" step="any" placeholder="quant." value={quantity} onChange={(e) => setQuantity(e.target.value)} className="input input-sm w-20" />
          <select value={compositionId} onChange={(e) => setCompositionId(e.target.value)} className="input input-sm w-auto max-w-[180px]">
            <option value="">preço manual</option>
            {compositions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({money(c.unitCost)})
              </option>
            ))}
          </select>
          {!compositionId && (
            <input type="number" step="any" placeholder="preço unit." value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="input input-sm w-24" />
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
}: {
  node: LineItemNode;
  depth: number;
  sectionId: string;
  compositions: CostComposition[];
  onChange: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);

  async function handleDelete() {
    const warning =
      node.children.length > 0
        ? `Eliminar "${node.description}" e os ${node.children.length} sub-item(ns) dentro dele? Esta acção não pode ser desfeita.`
        : `Eliminar "${node.description}"? Esta acção não pode ser desfeita.`;
    if (!window.confirm(warning)) return;
    await boqApi.deleteLineItem(node.id);
    onChange();
  }

  const isChapter = node.kind === "capitulo";
  const isGroup = node.kind === "grupo";
  const isNote = node.kind === "nota";

  const rowBg = isChapter ? "bg-brand-50/80 font-semibold text-brand-950" : isGroup ? "font-medium text-gray-800" : "";

  return (
    <Fragment>
      <tr className={`${rowBg} table-row text-sm group`}>
        <td className={`py-1.5 px-2 text-xs align-top ${isChapter ? "text-brand-700 font-bold" : "text-gray-400"}`}>{node.code}</td>
        <td className={`break-words align-top ${isNote ? "italic text-gray-400 text-xs" : "text-gray-800"}`} style={{ paddingLeft: 8 + depth * 12 }}>
          {node.description}
        </td>
        <td className="hidden align-top text-xs text-gray-400 whitespace-nowrap sm:table-cell">{node.kind === "item" ? node.unit : ""}</td>
        <td className="align-top text-right text-gray-600 tabular-nums whitespace-nowrap">{node.kind === "item" ? node.quantity : ""}</td>
        <td className="hidden align-top text-right text-gray-600 tabular-nums whitespace-nowrap sm:table-cell">{node.kind === "item" ? money(node.unitPrice ?? 0) : ""}</td>
        <td className={`align-top text-right tabular-nums whitespace-nowrap ${isChapter ? "font-bold" : "font-medium"} ${isNote ? "text-transparent" : "text-gray-900"}`}>
          {isNote ? "" : money(node.totalPrice)}
        </td>
        <td className="align-top text-right pr-2 whitespace-nowrap">
          <span className="inline-flex gap-1">
            {node.kind === "item" && (
              <button
                onClick={() => setShowMeasurements((s) => !s)}
                className={`icon-btn ${showMeasurements ? "icon-btn-active opacity-100" : ""}`}
                title="Medições dimensionais (Nº × Comp. × Larg. × Alt.)"
              >
                <IconRuler className="w-4 h-4" />
              </button>
            )}
            {(isChapter || isGroup) && (
              <button onClick={() => setShowAdd((s) => !s)} className="icon-btn" title="Adicionar sub-item">
                <IconPlus className="w-4 h-4" />
              </button>
            )}
            <button onClick={handleDelete} className="icon-btn-danger" title="Eliminar">
              <IconTrash className="w-4 h-4" />
            </button>
          </span>
        </td>
      </tr>

      {showMeasurements && node.kind === "item" && (
        <tr>
          <td colSpan={COLUMN_COUNT} className="bg-white pb-2">
            <MeasurementGrid lineItemId={node.id} onQuantityChange={onChange} />
          </td>
        </tr>
      )}

      {showAdd && (
        <tr>
          <td colSpan={COLUMN_COUNT} className="pb-2" style={{ paddingLeft: depth * 16 }}>
            <AddChildForm
              sectionId={sectionId}
              parentId={node.id}
              compositions={compositions}
              onDone={() => {
                setShowAdd(false);
                onChange();
              }}
            />
          </td>
        </tr>
      )}

      {node.children.map((child) => (
        <LineItemRow key={child.id} node={child} depth={depth + 1} sectionId={sectionId} compositions={compositions} onChange={onChange} />
      ))}
    </Fragment>
  );
}

export { AddChildForm };
