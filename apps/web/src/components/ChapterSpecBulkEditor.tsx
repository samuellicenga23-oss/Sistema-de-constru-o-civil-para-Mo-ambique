import { useMemo, useState } from "react";
import type { LineItemNode } from "../api/boq";
import { boqApi } from "../api/boq";
import ModalPortal from "./ModalPortal";

function collectItems(node: LineItemNode): LineItemNode[] {
  if (node.kind === "item") return [node];
  return node.children.flatMap(collectItems);
}

type SpecRow = { id: string; code: string | null; description: string; spec: string };

export default function ChapterSpecBulkEditor({
  chapter,
  chapterLabel,
  onClose,
  onSaved,
}: {
  chapter: LineItemNode;
  chapterLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const items = useMemo(() => collectItems(chapter), [chapter]);
  const [rows, setRows] = useState<SpecRow[]>(() =>
    items.map((item) => ({
      id: item.id,
      code: item.code,
      description: item.description,
      spec: item.technicalSpecification ?? "",
    })),
  );
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyBulkToAll() {
    if (!bulkText.trim()) return;
    setRows((prev) => prev.map((r) => ({ ...r, spec: bulkText.trim() })));
  }

  function applyBulkToEmpty() {
    if (!bulkText.trim()) return;
    setRows((prev) => prev.map((r) => (r.spec.trim() ? r : { ...r, spec: bulkText.trim() })));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await boqApi.bulkUpdateSpecifications(
        rows.map((r) => ({ id: r.id, technicalSpecification: r.spec.trim() || null })),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao guardar especificações");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-slate-950/55 p-3 sm:p-6">
        <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0" />
        <section className="relative my-auto flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <header className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950">Especificações — {chapterLabel}</h2>
            <p className="mt-1 text-xs text-slate-500">{items.length} item(ns) neste capítulo</p>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3 space-y-2">
              <label className="text-xs font-semibold text-brand-900">Texto para aplicar em massa</label>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={3}
                placeholder="Ex: acabamento e cor conforme memória descritiva; ou equivalente aprovado."
                className="input w-full text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={applyBulkToAll} className="btn btn-secondary btn-sm">
                  Aplicar a todos
                </button>
                <button type="button" onClick={applyBulkToEmpty} className="btn btn-ghost btn-sm">
                  Só aos vazios
                </button>
              </div>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-slate-500">Este capítulo não tem itens com especificação editável.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((row, index) => (
                  <li key={row.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1.5 flex items-baseline gap-2 text-xs">
                      <span className="font-mono text-slate-400">{row.code ?? "—"}</span>
                      <span className="font-medium text-slate-800 line-clamp-2">{row.description}</span>
                    </div>
                    <textarea
                      value={row.spec}
                      onChange={(e) =>
                        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, spec: e.target.value } : r)))
                      }
                      rows={2}
                      placeholder="Especificação técnica deste item..."
                      className="input w-full text-sm"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving || items.length === 0} className="btn btn-primary">
              {saving ? "A guardar..." : "Guardar especificações"}
            </button>
          </footer>
        </section>
      </div>
    </ModalPortal>
  );
}
