import { useEffect, useMemo, useState, type FormEvent } from "react";
import Modal from "./Modal";
import { catalogApi, type Material, type LabourCategory, type Equipment } from "../api/catalog";
import { quoteRequestsApi, type QuoteRequestLineInput, type QuoteRequestLineKind } from "../api/quoteRequests";
import type { Supplier } from "../api/suppliers";
import { IconTrash } from "./icons";

type PickedLine = QuoteRequestLineInput & { key: string; description: string; unit: string };

const KIND_LABELS: Record<QuoteRequestLineKind, string> = { material: "Material", labour: "Mão-de-obra", equipment: "Equipamento" };

export default function QuoteRequestModal({
  supplier,
  projectId,
  onClose,
  onCreated,
}: {
  supplier: Supplier;
  projectId?: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [labour, setLabour] = useState<LabourCategory[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [kind, setKind] = useState<QuoteRequestLineKind>("material");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<PickedLine[]>([]);
  const [title, setTitle] = useState(`Cotação — ${supplier.name}`);
  const [message, setMessage] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([catalogApi.listMaterials(), catalogApi.listLabourCategories(), catalogApi.listEquipment()])
      .then(([m, l, eq]) => {
        setMaterials(m);
        setLabour(l);
        setEquipment(eq);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar catálogo"));
  }, []);

  const options = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt");
    const source: Array<{ id: string; name: string; unit: string }> =
      kind === "material"
        ? materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))
        : kind === "labour"
          ? labour.map((l) => ({ id: l.id, name: l.name, unit: "h" }))
          : equipment.map((e) => ({ id: e.id, name: e.name, unit: "h" }));
    const filtered = needle ? source.filter((s) => s.name.toLocaleLowerCase("pt").includes(needle)) : source;
    return filtered.slice(0, 40);
  }, [kind, search, materials, labour, equipment]);

  function addLine(item: { id: string; name: string; unit: string }) {
    const key = `${kind}:${item.id}`;
    if (picked.some((p) => p.key === key)) return;
    setPicked((prev) => [...prev, { key, kind, resourceId: item.id, description: item.name, unit: item.unit, quantity: undefined }]);
  }

  function removeLine(key: string) {
    setPicked((prev) => prev.filter((p) => p.key !== key));
  }

  function updateQuantity(key: string, quantity: string) {
    const num = quantity.trim() === "" ? undefined : Number(quantity);
    setPicked((prev) => prev.map((p) => (p.key === key ? { ...p, quantity: num } : p)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!picked.length) {
      setError("Adicione pelo menos um item ao pedido");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await quoteRequestsApi.create({
        supplierId: supplier.id,
        projectId: projectId || undefined,
        title: title.trim(),
        message: message.trim() || undefined,
        deadlineDate: deadlineDate || undefined,
        lines: picked.map(({ kind: k, resourceId, quantity }) => ({ kind: k, resourceId, quantity })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar pedido de cotação");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Pedir cotação"
      subtitle={`Enviar a «${supplier.name}» — no Profissional+ o SIGO pode juntar fornecedores da zona num PDF ordenado por preço`}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2.5 text-[12.5px] leading-relaxed text-teal-950">
          O pedido lista os materiais/serviços e contacta o fornecedor. Com Profissional ou superior, o sistema destaca
          quem tem o item na região da obra e organiza do melhor preço ao mais caro (PDF com contactos).
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Título do pedido</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Prazo de resposta (opcional)</label>
            <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label className="label">Mensagem (opcional)</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="input" rows={2} />
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
            {(Object.keys(KIND_LABELS) as QuoteRequestLineKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setKind(k); setSearch(""); }}
                className={`btn btn-sm ${kind === k ? "btn-primary" : "btn-secondary"}`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar…" className="input ml-auto max-w-xs" />
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
            {options.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addLine(item)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span>{item.name}</span>
                <span className="text-xs text-slate-400">{item.unit}</span>
              </button>
            ))}
            {options.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-400">Nenhum item encontrado</p>}
          </div>
        </div>

        {picked.length > 0 && (
          <div className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 p-3 text-xs font-semibold text-slate-600">Itens do pedido ({picked.length})</div>
            <div className="divide-y divide-slate-100">
              {picked.map((line) => (
                <div key={line.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="badge badge-neutral shrink-0">{KIND_LABELS[line.kind]}</span>
                  <span className="min-w-0 flex-1 truncate">{line.description}</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Qtd."
                    value={line.quantity ?? ""}
                    onChange={(e) => updateQuantity(line.key, e.target.value)}
                    className="input w-24 shrink-0 text-right"
                  />
                  <span className="w-8 shrink-0 text-xs text-slate-400">{line.unit}</span>
                  <button type="button" onClick={() => removeLine(line.key)} className="icon-btn-danger shrink-0">
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
          <button type="submit" disabled={saving} className="btn btn-primary">{saving ? "A enviar..." : "Enviar pedido de cotação"}</button>
        </div>
      </form>
    </Modal>
  );
}
