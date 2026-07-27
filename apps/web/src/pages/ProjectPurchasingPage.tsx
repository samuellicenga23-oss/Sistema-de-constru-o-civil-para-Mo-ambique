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
  type ProcurementPlan,
  type ProcurementRequirement,
} from "../api/purchasing";
import { scheduleApi, type ScheduleTask } from "../api/schedule";
import Layout from "../components/Layout";
import { MetricCard, SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
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

function preferredSupplierPrice(
  prices: SupplierMaterialPrice[],
  materialId: string,
  zoneId: string | null | undefined,
  currency: string | undefined,
) {
  const compatible = prices
    .filter((price) => price.materialId === materialId && price.currency === currency)
    .sort((a, b) => Number(a.unitCost) - Number(b.unitCost));
  const exactZone = zoneId ? compatible.find((price) => price.zoneId === zoneId) : undefined;
  return exactZone ?? compatible.find((price) => price.zoneId === null);
}

export default function ProjectPurchasingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummaryLine[]>([]);
  const [procurementPlan, setProcurementPlan] = useState<ProcurementPlan | null>(null);
  const [scheduleTasks, setScheduleTasks] = useState<ScheduleTask[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<SupplierMaterialPrice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(todayStr());
  const [requiredByDate, setRequiredByDate] = useState("");
  const [scheduleTaskId, setScheduleTaskId] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [lines, setLines] = useState<PurchaseOrderLineInput[]>([]);

  const [movMaterialId, setMovMaterialId] = useState("");
  const [movType, setMovType] = useState<"entrada" | "saida">("saida");
  const [movQty, setMovQty] = useState("");
  const [movDate, setMovDate] = useState(todayStr());

  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  async function reload() {
    if (!projectId) return;
    const [proj, sups, mats, ords, movs, summary, plan, schedule] = await Promise.all([
      boqApi.getProject(projectId),
      suppliersApi.list(),
      catalogApi.listMaterials(),
      purchasingApi.listOrders(projectId),
      purchasingApi.listStockMovements(projectId),
      purchasingApi.stockSummary(projectId),
      purchasingApi.procurementPlan(projectId).catch(() => null),
      scheduleApi.get(projectId).catch(() => null),
    ]);
    setProject(proj);
    setSuppliers(sups);
    setMaterials(mats);
    setOrders(ords);
    setMovements(movs);
    setStockSummary(summary);
    setProcurementPlan(plan);
    setScheduleTasks(schedule?.tasks ?? []);
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
    suppliersApi
      .listMaterialPrices(supplierId)
      .then((prices) => {
        setSupplierPrices(prices);
        // Mudar o fornecedor é uma decisão explícita: reaplica a melhor cotação compatível
        // (zona exacta primeiro, depois geral) e nunca mascara uma moeda diferente como MZN/USD.
        setLines((current) =>
          current.map((line) => {
            const known = preferredSupplierPrice(prices, line.materialId, project?.zoneId, project?.currency);
            return { ...line, unitCost: known ? Number(known.unitCost) : 0 };
          }),
        );
      })
      .catch(() => {
        setSupplierPrices([]);
        setLines((current) => current.map((line) => ({ ...line, unitCost: 0 })));
      });
  }, [supplierId, project?.zoneId, project?.currency]);

  function updateLine(index: number, patch: Partial<PurchaseOrderLineInput>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function handleLineMaterialChange(index: number, materialId: string) {
    const known = preferredSupplierPrice(supplierPrices, materialId, project?.zoneId, project?.currency);
    updateLine(index, { materialId, unitCost: known ? Number(known.unitCost) : 0 });
  }

  function prepareAutomaticOrder(suggestion: ProcurementRequirement) {
    const firstPhase = suggestion.phases[0]?.key;
    const requirements = procurementPlan?.requirements.filter((item) => item.supplierId === suggestion.supplierId && item.suggestedOrderQty > 0 && (
      suggestion.suggestedScheduleTaskId
        ? item.suggestedScheduleTaskId === suggestion.suggestedScheduleTaskId
        : item.phases[0]?.key === firstPhase
    )) ?? [];
    if (!requirements.length) return;
    setSupplierId(suggestion.supplierId!);
    setScheduleTaskId(suggestion.suggestedScheduleTaskId ?? "");
    setRequiredByDate(suggestion.requiredByDate ?? "");
    setLines(requirements.map((item) => ({ materialId: item.materialId, quantity: item.suggestedOrderQty, unitCost: item.estimatedUnitCost, currency: project?.currency })));
    setOrderNotes("Pedido preparado automaticamente a partir das composições e do stock actual");
    setShowOrderForm(true);
    window.setTimeout(() => document.getElementById("purchase-order-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
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
      await purchasingApi.createOrder(projectId, { supplierId, orderDate, requiredByDate: requiredByDate || undefined, scheduleTaskId: scheduleTaskId || null, notes: orderNotes.trim() || undefined, lines: linesInProjectCurrency });
      setOrderNotes("");
      setRequiredByDate("");
      setScheduleTaskId("");
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
      <div className="space-y-5 max-w-7xl">
        <ProjectWorkspaceNav projectId={projectId!} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!project.zoneId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-semibold">Zona de preços em falta.</span> Enquanto a obra não tiver zona, as ordens só podem sugerir
            cotações gerais do fornecedor. Defina a zona na página principal do projecto para usar cotações locais.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Cobertura de materiais" value={procurementPlan?.requirements.length ? `${procurementPlan.coveragePercent.toFixed(0)}%` : "—"} note={procurementPlan?.requirements.length ? "Stock + pedidos em curso" : "Composições por associar"} />
          <MetricCard label="Necessidade por comprar" value={(procurementPlan?.shortageValue ?? 0).toLocaleString("pt-MZ", { maximumFractionDigits: 0 })} note={project.currency} />
          <MetricCard label="Por aprovar" value={orders.filter((order) => order.status === "rascunho").length} tone="warning" />
          <MetricCard label="Recebidas" value={orders.filter((order) => order.status === "recebido").length} tone="positive" />
        </div>

        {procurementPlan && <section className="card overflow-hidden">
          <SectionHeader title="Necessidades automáticas" description="Composições do orçamento − stock disponível − pedidos em curso" />
          <div className="border-b border-slate-100 bg-blue-50/60 px-5 py-3 text-sm text-blue-900"><strong>O sistema já fez a conferência.</strong> Só propõe a quantidade ainda em falta e escolhe a melhor cotação aplicável à zona da obra. Confirme antes de criar o pedido.</div>
          <div className="overflow-x-auto"><table className="min-w-[980px] w-full text-sm"><thead><tr className="table-head-row"><th className="px-5 py-2 text-left font-medium">Material / fase</th><th className="text-right font-medium">Necessário</th><th className="text-right font-medium">Em stock</th><th className="text-right font-medium">Já pedido</th><th className="text-right font-medium">A comprar</th><th className="text-right font-medium">Estimativa</th><th className="px-5 text-right font-medium">Acção</th></tr></thead><tbody>{procurementPlan.requirements.filter((item) => item.shortageQty > 0).map((item) => <tr key={item.materialId} className="table-row"><td className="px-5 py-3"><strong className="block text-slate-900">{item.materialName}</strong><span className="text-xs text-slate-500">{item.phases.map((phase) => phase.label).join(" · ")}</span>{item.suggestedScheduleTaskName && <small className="mt-1 block font-medium text-blue-700">Necessário em {item.requiredByDate} · {item.suggestedScheduleTaskName}</small>}</td><td className="text-right tabular-nums">{item.requiredQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {item.unit}</td><td className="text-right tabular-nums">{item.stockQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })}</td><td className="text-right tabular-nums">{item.orderedQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })}</td><td className="text-right tabular-nums font-semibold text-orange-700">{item.suggestedOrderQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {item.unit}{item.purchaseQty && item.purchasePackageLabel ? <small className="block font-normal">{item.purchaseQty} × {item.purchasePackageLabel}</small> : null}</td><td className="text-right tabular-nums"><strong>{item.estimatedTotal.toLocaleString("pt-MZ", { maximumFractionDigits: 2 })} {procurementPlan.currency}</strong><small className="block text-slate-500">{item.supplierName ?? "preço do Catálogo"} · {item.quoteSource}</small></td><td className="px-5 text-right">{item.supplierId ? <button className="btn btn-secondary btn-sm" onClick={() => prepareAutomaticOrder(item)}>Preparar pedido</button> : <Link className="text-xs font-semibold text-orange-700 hover:underline" to="/fornecedores">Adicionar cotação</Link>}</td></tr>)}{!procurementPlan.requirements.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-amber-700">Associe composições aos itens do orçamento para calcular as necessidades de materiais.</td></tr>}{procurementPlan.requirements.length > 0 && !procurementPlan.requirements.some((item) => item.shortageQty > 0) && <tr><td colSpan={7} className="px-5 py-8 text-center text-emerald-700">Materiais totalmente cobertos pelo stock e pelos pedidos em curso.</td></tr>}</tbody></table></div>
          {procurementPlan.missingCompositionItems.length > 0 && <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"><strong>{procurementPlan.missingCompositionItems.length} item(ns) ainda não entram no aprovisionamento.</strong> Associe composições no Mapa de Quantidades para o sistema saber que materiais devem ser comprados.</div>}
        </section>}

        {/* Stock actual */}
        <section className="card">
          <SectionHeader title="Stock actual" description="Saldo disponível e valor acumulado das entradas" />
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
          <SectionHeader title="Ordens de compra" description="Aprovação, recepção e entrada automática em stock" actions={
            <button onClick={() => setShowOrderForm((s) => !s)} className="btn btn-secondary btn-sm">
              <IconPlus className="w-3.5 h-3.5" /> Nova ordem
            </button>
          } />

          {showOrderForm && (
            <form id="purchase-order-form" onSubmit={handleCreateOrder} className="px-5 py-4 border-b border-gray-100 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
                  {suppliers.length === 0 && (
                    <Link to="/fornecedores" className="mt-1.5 inline-flex text-xs font-semibold text-brand-700 hover:underline">
                      Abrir fornecedores e registar cotações →
                    </Link>
                  )}
                </div>
                <div>
                  <label className="label">Data do pedido</label>
                  <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Actividade do cronograma</label>
                  <select value={scheduleTaskId} onChange={(event) => { const id = event.target.value; setScheduleTaskId(id); const task = scheduleTasks.find((item) => item.id === id); if (task) setRequiredByDate(task.startDate); }} className="input"><option value="">Sem actividade associada</option>{scheduleTasks.map((task) => <option key={task.id} value={task.id}>{task.code} · {task.name}</option>)}</select>
                </div>
                <div>
                  <label className="label">Necessário na obra até</label>
                  <input type="date" value={requiredByDate} onChange={(event) => setRequiredByDate(event.target.value)} className="input" />
                </div>
                <div>
                  <label className="label">Notas</label>
                  <input value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} className="input" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="label">
                  Linhas do Catálogo — a sugestão respeita fornecedor, zona da obra e moeda; pode ser ajustada antes de criar a ordem
                </label>
                {materials.length === 0 ? (
                  <p className="text-xs text-gray-400">Sem materiais no Catálogo ainda — adicione materiais no Catálogo de Preços primeiro.</p>
                ) : (
                  lines.map((line, i) => {
                    const material = materialById.get(line.materialId);
                    const quotedPrice = preferredSupplierPrice(supplierPrices, line.materialId, project.zoneId, project.currency);
                    const incompatibleCurrencies = Array.from(
                      new Set(supplierPrices.filter((price) => price.materialId === line.materialId).map((price) => price.currency)),
                    ).filter((currency) => currency !== project.currency);
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
                          {quotedPrice ? (
                            <span className="text-[11px] font-medium text-emerald-700">
                              {quotedPrice.zoneId ? `Cotação para ${quotedPrice.zoneName ?? "a zona da obra"}` : "Cotação geral do fornecedor"} · por {material?.unit}
                            </span>
                          ) : incompatibleCurrencies.length > 0 ? (
                            <span className="text-[11px] text-amber-700">
                              Cotação em {incompatibleCurrencies.join("/")} não aplicada; introduza o preço em {project.currency}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">Sem cotação aplicável · por {material?.unit}</span>
                          )}
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
              <div key={o.id} className="px-5 py-4 hover:bg-slate-50/70 transition-colors">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-medium text-gray-900">{o.supplierName}</span>{" "}
                    <span className="text-gray-400 text-sm">— {o.orderDate}</span>
                    {(o.scheduleTaskId || o.requiredByDate) && <small className="block mt-1 text-xs text-blue-700">{o.scheduleTaskId ? scheduleTasks.find((task) => task.id === o.scheduleTaskId)?.name ?? "Actividade do cronograma" : "Entrega planeada"}{o.requiredByDate ? ` · necessário até ${o.requiredByDate}` : ""}</small>}
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
                    {(o.status === "rascunho" || o.status === "cancelado") && <button onClick={() => handleDeleteOrder(o)} className="icon-btn-danger">
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>}
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
          <SectionHeader title="Movimentos de stock" description="Entradas e saídas manuais não associadas a ordens de compra" />
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
                      <span>{m.purchaseOrderId ? "Ordem de compra" : m.diaryEntryId ? "Diário de obra" : "Manual"}</span>
                      {!m.purchaseOrderId && !m.diaryEntryId && (
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
