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
import Modal from "../components/Modal";
import { IconBack, IconPlus, IconTrash } from "../components/icons";
import { calculateVatTotals } from "@sigo/shared";

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

function purchaseOrderTotals(order: PurchaseOrder) {
  return calculateVatTotals(order.lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0), Number(order.ivaRate));
}

function stockMovementTotals(movement: StockMovement, ivaRate: number) {
  return calculateVatTotals(Number(movement.quantity) * Number(movement.unitCost ?? 0), ivaRate);
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
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [movType, setMovType] = useState<"entrada" | "saida">("saida");
  const [movQty, setMovQty] = useState("");
  const [movUnitCost, setMovUnitCost] = useState("");
  const [movNotes, setMovNotes] = useState("");
  const [movDate, setMovDate] = useState(todayStr());

  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const orderDraftTotals = useMemo(() => calculateVatTotals(lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0), Number(project?.ivaRate ?? 0.16)), [lines, project?.ivaRate]);
  const movementDraftTotals = useMemo(() => calculateVatTotals(Number(movQty || 0) * Number(movUnitCost || 0), Number(project?.ivaRate ?? 0.16)), [movQty, movUnitCost, project?.ivaRate]);

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
    setError(null); setSaving(true);
    try {
      await purchasingApi.createStockMovement(projectId, {
        materialId: movMaterialId,
        type: movType,
        quantity: Number(movQty),
        unitCost: movType === "entrada" && Number(movUnitCost) >= 0 ? Number(movUnitCost) : undefined,
        currency: project?.currency,
        notes: movNotes.trim() || undefined,
        date: movDate,
      });
      setMovQty("");
      setMovUnitCost("");
      setMovNotes("");
      setShowMovementForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao registar movimento de stock");
    } finally { setSaving(false); }
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
          <MetricCard label="Total por comprar" value={(procurementPlan?.shortageTotal ?? 0).toLocaleString("pt-MZ", { maximumFractionDigits: 0 })} note={`${project.currency} · inclui IVA ${(Number(project.ivaRate) * 100).toFixed(0)}%`} />
          <MetricCard label="Por aprovar" value={orders.filter((order) => order.status === "rascunho").length} tone="warning" />
          <MetricCard label="Recebidas" value={orders.filter((order) => order.status === "recebido").length} tone="positive" />
        </div>

        {procurementPlan && <section className="card overflow-hidden">
          <SectionHeader title="Necessidades automáticas" description="Composições do orçamento − stock disponível − pedidos em curso" />
          <div className="border-b border-slate-100 bg-blue-50/60 px-5 py-3 text-sm text-blue-900"><strong>O sistema já fez a conferência.</strong> Só propõe a quantidade ainda em falta e escolhe a melhor cotação aplicável à zona da obra. Confirme antes de criar o pedido.</div>
          <div className="divide-y divide-slate-100 md:hidden">{procurementPlan.requirements.filter((item) => item.shortageQty > 0).map((item) => <article key={`mobile-${item.materialId}`} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block text-sm text-slate-950">{item.materialName}</strong><span className="mt-0.5 block text-xs text-slate-500">{item.phases.map((phase) => phase.label).join(" · ")}</span></div><strong className="shrink-0 text-sm tabular-nums text-orange-700">{item.suggestedOrderQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {item.unit}</strong></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs"><span className="text-slate-500">Necessário</span><span className="text-right font-medium">{item.requiredQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {item.unit}</span><span className="text-slate-500">Stock + pedido</span><span className="text-right font-medium">{(item.stockQty + item.orderedQty).toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {item.unit}</span><span className="text-slate-500">Base</span><span className="text-right">{item.estimatedTotal.toLocaleString("pt-MZ", { maximumFractionDigits: 2 })} {procurementPlan.currency}</span><span className="font-semibold text-slate-700">Total com IVA</span><span className="text-right font-bold">{item.estimatedTotalWithVat.toLocaleString("pt-MZ", { maximumFractionDigits: 2 })} {procurementPlan.currency}</span></div>{item.suggestedScheduleTaskName && <small className="mt-2 block font-medium text-blue-700">Necessário em {item.requiredByDate} · {item.suggestedScheduleTaskName}</small>}<div className="mt-3">{item.supplierId ? <button className="btn btn-secondary btn-sm w-full" onClick={() => prepareAutomaticOrder(item)}>Preparar pedido</button> : <Link className="btn btn-secondary btn-sm w-full text-orange-700" to="/fornecedores">Adicionar cotação</Link>}</div></article>)}</div>
          <div className="hidden overflow-x-auto md:block"><table className="min-w-[980px] w-full text-sm"><thead><tr className="table-head-row"><th className="px-5 py-2 text-left font-medium">Material / fase</th><th className="text-right font-medium">Necessário</th><th className="text-right font-medium">Em stock</th><th className="text-right font-medium">Já pedido</th><th className="text-right font-medium">A comprar</th><th className="text-right font-medium">Estimativa com IVA</th><th className="px-5 text-right font-medium">Acção</th></tr></thead><tbody>{procurementPlan.requirements.filter((item) => item.shortageQty > 0).map((item) => <tr key={item.materialId} className="table-row"><td className="px-5 py-3"><strong className="block text-slate-900">{item.materialName}</strong><span className="text-xs text-slate-500">{item.phases.map((phase) => phase.label).join(" · ")}</span>{item.suggestedScheduleTaskName && <small className="mt-1 block font-medium text-blue-700">Necessário em {item.requiredByDate} · {item.suggestedScheduleTaskName}</small>}</td><td className="text-right tabular-nums">{item.requiredQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {item.unit}</td><td className="text-right tabular-nums">{item.stockQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })}</td><td className="text-right tabular-nums">{item.orderedQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })}</td><td className="text-right tabular-nums font-semibold text-orange-700">{item.suggestedOrderQty.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {item.unit}{item.purchaseQty && item.purchasePackageLabel ? <small className="block font-normal">{item.purchaseQty} × {item.purchasePackageLabel}</small> : null}</td><td className="text-right tabular-nums"><strong>{item.estimatedTotalWithVat.toLocaleString("pt-MZ", { maximumFractionDigits: 2 })} {procurementPlan.currency}</strong><small className="block text-slate-500">Base {item.estimatedTotal.toLocaleString("pt-MZ", { maximumFractionDigits: 2 })} + IVA</small><small className="block text-slate-500">{item.supplierName ?? "preço do Catálogo"} · {item.quoteSource}</small></td><td className="px-5 text-right">{item.supplierId ? <button className="btn btn-secondary btn-sm" onClick={() => prepareAutomaticOrder(item)}>Preparar pedido</button> : <Link className="text-xs font-semibold text-orange-700 hover:underline" to="/fornecedores">Adicionar cotação</Link>}</td></tr>)}{!procurementPlan.requirements.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-amber-700">Associe composições aos itens do orçamento para calcular as necessidades de materiais.</td></tr>}{procurementPlan.requirements.length > 0 && !procurementPlan.requirements.some((item) => item.shortageQty > 0) && <tr><td colSpan={7} className="px-5 py-8 text-center text-emerald-700">Materiais totalmente cobertos pelo stock e pelos pedidos em curso.</td></tr>}</tbody></table></div>
          {procurementPlan.missingCompositionItems.length > 0 && <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"><strong>{procurementPlan.missingCompositionItems.length} item(ns) ainda não entram no aprovisionamento.</strong> Associe composições no Mapa de Quantidades para o sistema saber que materiais devem ser comprados.</div>}
        </section>}

        {/* Stock actual */}
        <section className="card">
          <SectionHeader title="Stock actual" description="Saldo disponível e valor das entradas sem IVA recuperável" />
          <div className="divide-y divide-slate-100 sm:hidden">{stockSummary.map((s) => <div key={`mobile-stock-${s.materialId}`} className="flex items-center justify-between gap-3 p-4"><div><strong className="text-sm text-slate-900">{s.materialName}</strong><p className="mt-0.5 text-xs text-slate-500">Entradas: {s.valueIn.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency} sem IVA</p></div><span className={`text-sm font-bold tabular-nums ${s.balance < 0 ? "text-red-600" : "text-slate-900"}`}>{s.balance.toLocaleString("pt-MZ", { maximumFractionDigits: 3 })} {s.unit}</span></div>)}</div>
          <div className="hidden overflow-x-auto sm:block">
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
            <button onClick={() => setShowOrderForm(true)} className="btn btn-secondary btn-sm">
              <IconPlus className="w-3.5 h-3.5" /> Nova ordem
            </button>
          } />

          {showOrderForm && (
            <Modal title="Nova ordem de compra" subtitle={`Fornecedor, entrega e materiais · IVA ${(Number(project.ivaRate) * 100).toFixed(0)}%`} onClose={() => setShowOrderForm(false)} maxWidth="max-w-6xl">
            <form id="purchase-order-form" onSubmit={handleCreateOrder} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                  Linhas do Catálogo — quantidades e preços unitários sem IVA; o total aplica IVA automaticamente
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

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"><div><span className="text-xs text-slate-500">Subtotal</span><strong className="mt-1 block tabular-nums">{orderDraftTotals.subtotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}</strong></div><div><span className="text-xs text-slate-500">IVA {(orderDraftTotals.ivaRate * 100).toFixed(0)}%</span><strong className="mt-1 block tabular-nums">{orderDraftTotals.iva.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}</strong></div><div><span className="text-xs font-semibold text-slate-700">Total da ordem</span><strong className="mt-1 block text-lg tabular-nums text-slate-950">{orderDraftTotals.total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}</strong></div></div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowOrderForm(false)} className="btn btn-secondary">Cancelar</button><button type="submit" disabled={saving || !supplierId || materials.length === 0} className="btn btn-primary">{saving ? "A guardar..." : "Criar ordem de compra"}</button></div>
            </form>
            </Modal>
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
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={`badge ${STATUS_BADGE[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                    {o.status === "rascunho" && (
                      <button onClick={() => handleStatusChange(o, "aprovado")} className="btn btn-secondary btn-sm text-brand-700">
                        Aprovar ordem
                      </button>
                    )}
                    {o.status === "aprovado" && (
                      <button onClick={() => handleStatusChange(o, "recebido")} className="btn btn-secondary btn-sm text-green-700">
                        Receber no stock
                      </button>
                    )}
                    {o.status !== "cancelado" && o.status !== "recebido" && (
                      <button onClick={() => handleStatusChange(o, "cancelado")} className="btn btn-secondary btn-sm text-red-600">
                        Cancelar
                      </button>
                    )}
                    {(o.status === "rascunho" || o.status === "cancelado") && <button onClick={() => handleDeleteOrder(o)} className="icon-btn-danger">
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>}
                  </div>
                </div>
                <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100 sm:hidden">{o.lines.map((line) => <div key={`mobile-order-${line.id}`} className="p-3"><strong className="block text-sm text-slate-800">{line.materialName}</strong><div className="mt-1 flex justify-between gap-3 text-xs text-slate-500"><span>{Number(line.quantity).toLocaleString("pt-MZ")} {line.unit} × {Number(line.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })}</span><span className="font-semibold text-slate-800">{(Number(line.quantity) * Number(line.unitCost)).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} {line.currency}</span></div></div>)}</div>
                <table className="mt-2 hidden w-full text-sm sm:table">
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
                <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-3"><div className="flex justify-between gap-3 sm:block"><span className="text-slate-500">Subtotal</span><strong className="sm:mt-1 sm:block">{purchaseOrderTotals(o).subtotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {o.lines[0]?.currency ?? project.currency}</strong></div><div className="flex justify-between gap-3 sm:block"><span className="text-slate-500">IVA {(Number(o.ivaRate) * 100).toFixed(0)}%</span><strong className="sm:mt-1 sm:block">{purchaseOrderTotals(o).iva.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {o.lines[0]?.currency ?? project.currency}</strong></div><div className="flex justify-between gap-3 border-t border-slate-200 pt-2 sm:block sm:border-0 sm:pt-0"><span className="font-semibold text-slate-700">Total</span><strong className="text-sm text-slate-950 sm:mt-1 sm:block">{purchaseOrderTotals(o).total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {o.lines[0]?.currency ?? project.currency}</strong></div></div>
              </div>
            ))}
            {orders.length === 0 && !showOrderForm && <p className="px-5 py-6 text-sm text-gray-400 text-center">Sem ordens de compra ainda.</p>}
          </div>
        </section>

        {/* Movimentos de stock manuais */}
        <section className="card">
          <SectionHeader title="Movimentos de stock" description="Entradas e saídas manuais não associadas a ordens de compra" actions={<button type="button" onClick={() => setShowMovementForm(true)} className="btn btn-secondary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo movimento</button>} />
          {showMovementForm && <Modal title="Novo movimento de stock" subtitle="Registe uma entrada extraordinária ou o consumo manual de material" onClose={() => setShowMovementForm(false)} maxWidth="max-w-2xl"><form onSubmit={handleCreateMovement} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><label className="label">Tipo</label><select value={movType} onChange={(e) => setMovType(e.target.value as "entrada" | "saida")} className="input"><option value="saida">Saída (consumo)</option><option value="entrada">Entrada</option></select></div><div><label className="label">Data efectiva</label><input type="date" value={movDate} onChange={(e) => setMovDate(e.target.value)} className="input" /></div><div className="sm:col-span-2"><label className="label">Material</label><select value={movMaterialId} onChange={(e) => setMovMaterialId(e.target.value)} className="input">{materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select></div><div><label className="label">Quantidade</label><input type="number" step="0.001" min="0" value={movQty} onChange={(e) => setMovQty(e.target.value)} className="input" /></div>{movType === "entrada" && <div><label className="label">Preço unitário sem IVA ({project.currency})</label><input type="number" step="0.01" min="0" value={movUnitCost} onChange={(e) => setMovUnitCost(e.target.value)} className="input" /></div>}<div className="sm:col-span-2"><label className="label">Origem / observação</label><textarea value={movNotes} onChange={(e) => setMovNotes(e.target.value)} className="input min-h-20 py-3" placeholder="Transferência de outro armazém, ajuste de inventário, frente de trabalho..." /></div></div>{movType === "entrada" && Number(movQty) > 0 && <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-xs"><div><span className="text-slate-500">Base</span><strong className="mt-1 block">{movementDraftTotals.subtotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2 })}</strong></div><div><span className="text-slate-500">IVA {(movementDraftTotals.ivaRate * 100).toFixed(0)}%</span><strong className="mt-1 block">{movementDraftTotals.iva.toLocaleString("pt-MZ", { minimumFractionDigits: 2 })}</strong></div><div><span className="font-semibold">Total</span><strong className="mt-1 block text-sm">{movementDraftTotals.total.toLocaleString("pt-MZ", { minimumFractionDigits: 2 })}</strong></div></div>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="btn btn-secondary" onClick={() => setShowMovementForm(false)}>Cancelar</button><button type="submit" disabled={saving || materials.length === 0 || !(Number(movQty) > 0)} className="btn btn-primary"><IconPlus className="h-4 w-4" /> {saving ? "A guardar..." : "Registar movimento"}</button></div></form></Modal>}

          <div className="divide-y divide-slate-100 md:hidden">{movements.map((m) => <div key={`mobile-movement-${m.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div><span className={`badge ${m.type === "entrada" ? "badge-green" : "badge-yellow"}`}>{m.type === "entrada" ? "Entrada" : "Saída"}</span><strong className="mt-2 block text-sm text-slate-900">{m.materialName}</strong><p className="mt-0.5 text-xs text-slate-500">{m.date} · {m.purchaseOrderId ? "Ordem de compra" : m.diaryEntryId ? "Diário de obra" : "Manual"}</p></div><div className="text-right"><strong className="text-sm tabular-nums">{Number(m.quantity).toLocaleString("pt-MZ")} {m.unit}</strong>{m.type === "entrada" && m.unitCost && <p className="mt-1 text-xs text-slate-500">Total IVA incl.: {stockMovementTotals(m, Number(project.ivaRate)).total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {m.currency}</p>}</div></div>{!m.purchaseOrderId && !m.diaryEntryId && <button type="button" onClick={() => handleDeleteMovement(m)} className="btn btn-secondary btn-sm mt-3 text-red-600">Eliminar movimento</button>}</div>)}</div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="table-head-row">
                  <th className="text-left py-2 px-5 font-medium">Tipo</th>
                  <th className="text-left font-medium">Material</th>
                  <th className="text-right font-medium">Quantidade</th>
                  <th className="text-left font-medium">Data</th>
                  <th className="text-right font-medium">Total com IVA</th>
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
                    <td className="text-right tabular-nums text-slate-600">{m.type === "entrada" && m.unitCost ? `${stockMovementTotals(m, Number(project.ivaRate)).total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${m.currency}` : "—"}</td>
                    <td className="pr-5 text-gray-500 flex items-center justify-between gap-2">
                      <span>{m.purchaseOrderId ? "Ordem de compra" : m.diaryEntryId ? "Diário de obra" : "Manual"}</span>
                      {!m.purchaseOrderId && !m.diaryEntryId && (
                        <button
                          onClick={() => handleDeleteMovement(m)}
                          className="icon-btn-danger"
                        >
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-400">
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
