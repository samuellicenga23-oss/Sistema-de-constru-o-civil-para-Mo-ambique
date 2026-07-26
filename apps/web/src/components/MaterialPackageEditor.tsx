import { useState } from "react";

// Edita a unidade de compra de mercado de um material (ex: "Camião 10m³", "Saco 20kg") — texto
// livre + quantas unidades de medida cabem numa unidade de compra. Ambos opcionais: em branco =
// sem conversão, o material mostra-se apenas na unidade de medida (ex: água, local; materiais
// vendidos ao peso solto).
export default function MaterialPackageEditor({
  label,
  qty,
  onSave,
}: {
  label: string | null;
  qty: string | null;
  onSave: (label: string | null, qty: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(label ?? "");
  const [draftQty, setDraftQty] = useState(qty ?? "");
  const [saving, setSaving] = useState(false);

  async function commit() {
    setSaving(true);
    try {
      const trimmedLabel = draftLabel.trim();
      const numQty = draftQty === "" ? NaN : Number(draftQty);
      await onSave(trimmedLabel === "" ? null : trimmedLabel, !Number.isNaN(numQty) && numQty > 0 ? numQty : null);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          placeholder="ex: Camião 10m³"
          value={draftLabel}
          disabled={saving}
          onChange={(e) => setDraftLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-32 rounded border border-brand-400 px-1 py-0.5 text-xs"
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="qtd"
          value={draftQty}
          disabled={saving}
          onChange={(e) => setDraftQty(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-16 rounded border border-brand-400 px-1 py-0.5 text-xs"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setDraftLabel(label ?? "");
        setDraftQty(qty ?? "");
        setEditing(true);
      }}
      className="hover:bg-brand-50 rounded px-1 -mx-1 text-left text-xs"
      title="Clicar para editar a unidade de compra de mercado (ex: camião, saco, palete)"
    >
      {label ? label : <span className="text-gray-400">definir...</span>}
    </button>
  );
}
