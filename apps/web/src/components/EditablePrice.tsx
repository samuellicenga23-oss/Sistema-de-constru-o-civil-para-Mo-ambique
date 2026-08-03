import { useState } from "react";

export default function EditablePrice({
  value,
  suffix,
  onSave,
}: {
  value: string | number;
  suffix?: string;
  onSave: (newValue: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  async function commit() {
    const num = Number(draft);
    setSaving(true);
    try {
      if (!Number.isNaN(num) && num >= 0) {
        await onSave(num);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 rounded border border-brand-400 px-1 py-0.5 text-sm"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-2 py-1 text-left font-semibold text-brand-800 hover:border-brand-500 hover:bg-brand-50"
      title="Editar preço"
    >
      <span>{Number(value).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{suffix ? ` ${suffix}` : ""}</span>
      <small className="text-[9px] font-bold uppercase tracking-wide text-brand-600">Editar</small>
    </button>
  );
}
