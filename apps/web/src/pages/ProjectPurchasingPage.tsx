import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { boqApi, type Project } from "../api/boq";
import { suppliersApi, type Supplier, type SupplierMaterialPrice } from "../api/suppliers";
import { catalogApi, type Material } from "../api/catalog";
import {
  purchasingApi,
  type PurchaseOrder,
  type PurchaseOrderLineInput,
  type StockMovement,
  type StockSummaryLine,
} from "../api/purchasing";
import Layout from "../components/Layout";
import { IconBack, IconPlus, IconTrash } from "../components/icons";

const STATUS_LABELS: Record<PurchaseOrder["status"], string> = {
  rascunho: "Rascunho",
  aprovado: "Aprovado",
  recebido: "Recebido",
  cancelado: "Cancelado",
};
const STATUS_BADGE: Record<PurchaseOrder["status"], string> = {
  rascunho: "badge-gray",
  aprovado: "badge-brand",
  recebido: "badge-green",
  cancelado: "badge-red",
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyLine(materials: Material[]): PurchaseOrderLineInput {
  return { materialId: materials[0]?.id ?? "", quantity: 1, unitCost: 0 };
}

export default function ProjectPurchasingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummaryLine[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<SupplierMaterialPrice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(todayStr());
  const [orderNotes, setOrderNotes] = useState("");
  const [lines, setLines] = useState<PurchaseOrderLineInput[]>([]);

  const [movMaterialId, setMovMaterialId] = useState("");
  const [movType, setMovType] = useState<"entrada" | "saida">("saida");
  const [movQty, setMovQty] = useState("");
  const [movDate, setMovDate] = useState(todayStr());

  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  async function reload() {
    if (!projectId) return;
    const [proj, sups, mats, ords, movs, summary] = await Promise.all([
      boqApi.getProject(projectId),
      suppliersApi.list(),
      catalogApi.listMaterials(),
      purchasingApi.listOrders(projectId),
      purchasingApi.listStockMovements(projectId),
      purchasingApi.stockSummary(projectId),
    ]);
    setProject(proj);
    setSuppliers(sups);
    setMaterials(mats);
    setOrders(ords);
    setMovements(movs);
    setStockSummary(summary);
    if (!supplierId && sups.length) setSupplierId(sups[0].id);
    if (!movMaterialId && mats.length) setMovMaterialId(mats[0].id);
    if (lines.length === 0 && mats.length) setLines([emptyLine(mats)]);
  }

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [projectId]);

  // Preços conhecidos deste fornecedor — usados para sugerir automaticamente o preço unitário
  // quando se escolhe um material já cadastrado no fornecedor (ver handleLineMaterialChange).
  useEffect(() => {
    if (!supplierId) return;
    suppliersApi.listMaterialPrices(supplierId).then(setSupplierPrices).catch(() => setSupplierPrices([]));
  }, [supplierId]);

  function updateLine(index: number, patch: Partial<PurchaseOrderLineInput>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function handleLineMaterialChange(index: number, materialId: string) {
    const known = supplierPrices.find((p) => p.materialId === materialId && (p.zoneId === null || p.zoneId === project?.zoneId));
    updateLine(index, { materialId, unitCost: known ? Number(known.unitCost) : 0 });
  }

  async function handleCreateOrder(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !supplierId) return;
    const validLines = lines.filter((l) => l.materialId && l.quantity > 0);
    if (!validLines.length) {
      setError("Adicione pelo menos uma linha com material e quantidade.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Todas as linhas de uma ordem usam sempre a moeda do projecto — evita uma ordem de compra
      // com linhas em moedas diferentes do resto da obra, que não se poderia somar de forma
      // honesta no resumo de stock.
      const linesInProjectCurrency = validLines.map((l) => ({ ...l, currency: project?.currency ?? "MZN" }));
      await purchasingApi.createOrder(projectId, { supplierId, orderDate, notes: orderNotes.trim() || undefined, lines: linesInProjectCurrency });
      setOrderNotes("");
      setLines([emptyLine(materials)]);
      setShowOrderForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar ordem de compra");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(order: PurchaseOrder, status: PurchaseOrder["status"]) {
    setError(null);
    try {
      await purchasingApi.updateOrderStatus(order.id, status);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao actualizar estado");
    }
  }

  async function handleDeleteOrder(order: PurchaseOrder) {
    if (!window.confirm(`Eliminar a ordem de compra de "${order.supplierName}"? Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await purchasingApi.deleteOrder(order.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar ordem de compra");
    }
  }

  async function handleCreateMovement(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !movMaterialId || !(Number(movQty) > 0)) return;
    setError(null);
    try {
      await purchasingApi.createStockMovement(projectId, {
        materialId: movMaterialId,
        type: movType,
        quantity: Number(movQty),
        date: movDate,
      });
      setMovQty("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar movimento de stock");
    }
  }

  async function handleDeleteMovement(m: StockMovement) {
    if (!window.confirm(`Eliminar este movimento de stock (${m.materialName})? Esta acção não pode ser desfeita.`)) return;
    setError(null);
    try {
      await purchasingApi.deleteStockMovement(m.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao eliminar movimento");
    }
  }

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }

  return (
    <Layout
      title={`Compras e Armazém — ${project.name}`}
      subtitle="Ordens de compra a fornecedores e stock de materiais desta obra — ligado ao Catálogo de Preços"
      actions={
        <Link to={`/projectos/${projectId}`} className="btn btn-ghost btn-sm">
          <IconBack className="w-3.5 h-3.5" />
          Projecto
        </Link>
      }
    >
      <div className="space-y-5 max-w-6xl">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Stock actual */}
        <section className="card">
          <div className="px-5 pt-4 pb-2 border-b border-gray-100">
            <h2 className="section-title text-base">Stock Actual</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-5 font-medium">Material</th>
                  <th className="text-right font-medium">Saldo</th>
                  <th className="text-right font-medium pr-5">Valor das entradas</th>
                </tr>
              </thead>
              <tbody>
                {stockSummary.map((s) => (
                  <tr key={s.materialId} className="table-row">
                    <td className="py-2 px-5">{s.materialName}</td>
                    <td className={`text-right tabular-nums font-medium ${s.balance < 0 ? "text-red-600" : ""}`}>
                      {s.balance.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {s.unit}
                    </td>
                    <td className="text-right pr-5 tabular-nums text-gray-500">
                      {s.valueIn.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}
                    </td>
                  </tr>
                ))}
                {stockSummary.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-gray-400">
                      Sem movimentos de stock ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Ordens de compra */}
        <section className="card">
          <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-gray-100">
            <h2 className="section-title text-base">Ordens de Compra</h2>
            <button onClick={() => setShowOrderForm((s) => !s)} className="btn btn-secondary btn-sm">
              <IconPlus className="w-3.5 h-3.5" />
              Nova ordem
            </button>
          </div>

          {showOrderForm && (
            <form onSubmit={handleCreateOrder} className="px-5 py-4 border-b border-gray-100 space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Fornecedor</label>
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
                    {suppliers.length === 0 && <option value="">Sem fornecedores — crie um primeiro</option>}
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Data</label>
                  <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Notas</label>
                  <input value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} className="input" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="label">
                  Linhas (materiais do Catálogo) — o preço sugere-se automaticamente se este fornecedor já tiver um preço
                  cadastrado para o material
                </label>
                {materials.length === 0 ? (
                  <p className="text-xs text-gray-400">Sem materiais no Catálogo ainda — adicione materiais no Catálogo de Preços primeiro.</p>
                ) : (
                  lines.map((line, i) => {
                    const material = materialById.get(line.materialId);
                    return (
                      <div key={i} className="grid gap-2 sm:grid-cols-12 items-end">
                        <div className="sm:col-span-5">
                          <select value={line.materialId} onChange={(e) => handleLineMaterialChange(i, e.target.value)} className="input">
                            {materials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.unit})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Quantidade"
                            value={line.quantity || ""}
                            onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                            className="input"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Preço unit."
                            value={line.unitCost || ""}
                            onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) })}
                            className="input"
                          />
                          {material && <span className="text-[11px] text-gray-400">por {material.unit}</span>}
                        </div>
                        <div className="sm:col-span-2 flex gap-2">
                          <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine(materials)])} className="btn btn-secondary btn-sm">
                            <IconPlus className="w-3.5 h-3.5" />
                          </button>
                          {lines.length > 1 && (
                            <button type="button" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} className="icon-btn-danger">
                              <IconTrash className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <button type="submit" disabled={saving || !supplierId || materials.length === 0} className="btn btn-primary">
                {saving ? "A guardar..." : "Criar ordem de compra"}
              </button>
            </form>
          )}

          <div className="divide-y divide-gray-100">
            {orders.map((o) => (
              <div key={o.id} className="px-5 py-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-medium text-gray-900">{o.supplierName}</span>{" "}
                    <span className="text-gray-400 text-sm">— {o.orderDate}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${STATUS_BADGE[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                    {o.status === "rascunho" && (
                      <button onClick={() => handleStatusChange(o, "aprovado")} className="text-brand-700 text-xs font-medium hover:underline">
                        aprovar
                      </button>
                    )}
                    {o.status === "aprovado" && (
                      <button onClick={() => handleStatusChange(o, "recebido")} className="text-green-700 text-xs font-medium hover:underline">
                        marcar recebido (entra em stock)
                      </button>
                    )}
                    {o.status !== "cancelado" && o.status !== "recebido" && (
                      <button onClick={() => handleStatusChange(o, "cancelado")} className="text-red-600 text-xs font-medium hover:underline">
                        cancelar
                      </button>
                    )}
                    <button onClick={() => handleDeleteOrder(o)} className="icon-btn-danger">
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <table className="w-full text-sm mt-2">
                  <tbody>
                    {o.lines.map((l) => (
                      <tr key={l.id} className="text-gray-600">
                        <td className="py-1">{l.materialName}</td>
                        <td className="py-1 text-right">
                          {Number(l.quantity).toLocaleString("pt-MZ")} {l.unit}
                        </td>
                        <td className="py-1 text-right">
                          {Number(l.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {l.currency}
                        </td>
                        <td className="py-1 text-right font-medium text-gray-800">
                          {(Number(l.quantity) * Number(l.unitCost)).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {l.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {orders.length === 0 && !showOrderForm && <p className="px-5 py-6 text-sm text-gray-400 text-center">Sem ordens de compra ainda.</p>}
          </div>
        </section>

        {/* Movimentos de stock manuais */}
        <section className="card">
          <div className="px-5 pt-4 pb-2 border-b border-gray-100">
            <h2 className="section-title text-base">Registar Movimento de Stock (manual)</h2>
          </div>
          <form onSubmit={handleCreateMovement} className="grid gap-3 sm:grid-cols-4 items-end px-5 py-4 border-b border-gray-100">
            <div>
              <label className="label">Tipo</label>
              <select value={movType} onChange={(e) => setMovType(e.target.value as "entrada" | "saida")} className="input">
                <option value="saida">Saída (consumo)</option>
                <option value="entrada">Entrada</option>
              </select>
            </div>
            <div>
              <label className="label">Material</label>
              <select value={movMaterialId} onChange={(e) => setMovMaterialId(e.target.value)} className="input">
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Quantidade</label>
              <input type="number" step="0.01" min="0" value={movQty} onChange={(e) => setMovQty(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Data</label>
              <input type="date" value={movDate} onChange={(e) => setMovDate(e.target.value)} className="input" />
            </div>
            <div className="sm:col-span-4">
              <button type="submit" disabled={materials.length === 0} className="btn btn-primary">
                <IconPlus className="w-4 h-4" />
                Registar
              </button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-5 font-medium">Tipo</th>
                  <th className="text-left font-medium">Material</th>
                  <th className="text-right font-medium">Quantidade</th>
                  <th className="text-left font-medium">Data</th>
                  <th className="text-left font-medium pr-5">Origem</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="table-row group">
                    <td className="py-2 px-5">
                      <span className={`badge ${m.type === "entrada" ? "badge-green" : "badge-yellow"}`}>{m.type === "entrada" ? "Entrada" : "Saída"}</span>
                    </td>
                    <td>{m.materialName}</td>
                    <td className="text-right tabular-nums">
                      {Number(m.quantity).toLocaleString("pt-MZ")} {m.unit}
                    </td>
                    <td className="text-gray-500">{m.date}</td>
                    <td className="pr-5 text-gray-500 flex items-center justify-between gap-2">
                      <span>{m.purchaseOrderId ? "Ordem de compra" : "Manual"}</span>
                      {!m.purchaseOrderId && (
                        <button
                          onClick={() => handleDeleteMovement(m)}
                          className="icon-btn-danger opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 transition-opacity"
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-400">
                      Sem movimentos ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
}
