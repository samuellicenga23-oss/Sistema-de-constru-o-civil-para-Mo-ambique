import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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
  type ProcurementQuote,
} from "../api/purchasing";
import { scheduleApi, type ScheduleTask } from "../api/schedule";
import Layout from "../components/Layout";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { MetricCard, SectionHeader } from "../components/WorkspaceUI";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import { IconBack, IconPlus, IconTrash } from "../components/icons";
import { calculateVatTotals } from "@sigo/shared";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";

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
type PurchasingView = "necessidades" | "pedidos" | "stock";

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
  const { confirm, dialog } = useConfirmDialog();
  const { user } = useAuth();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const canRequest = can(user, "materiais.requisitar");
  const canApprove = can(user, "materiais.aprovar") || user?.role === "admin_empresa";
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
  const [view, setView] = useState<PurchasingView>("necessidades");
  const [query, setQuery] = useState("");

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(todayStr());
  const [requiredByDate, setRequiredByDate] = useState("");
  const [scheduleTaskId, setScheduleTaskId] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [lines, setLines] = useState<PurchaseOrderLineInput[]>([]);
  const [quoteRequirement, setQuoteRequirement] = useState<ProcurementRequirement | null>(null);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestNotes, setRequestNotes] = useState("");
  const [requestLines, setRequestLines] = useState<Array<{ materialId: string; quantity: string }>>([
    { materialId: "", quantity: "1" },
  ]);

  const [movMaterialId, setMovMaterialId] = useState("");
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [movType, setMovType] = useState<"entrada" | "saida">("saida");
  const [movQty, setMovQty] = useState("");
  const [movUnitCost, setMovUnitCost] = useState("");
  const [movNotes, setMovNotes] = useState("");
  const [movDate, setMovDate] = useState(todayStr());

  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const orderSuppliers = useMemo(() => suppliers, [suppliers]);
  const orderDraftTotals = useMemo(() => calculateVatTotals(lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0), Number(project?.ivaRate ?? 0.16)), [lines, project?.ivaRate]);
  const movementDraftTotals = useMemo(() => calculateVatTotals(Number(movQty || 0) * Number(movUnitCost || 0), Number(project?.ivaRate ?? 0.16)), [movQty, movUnitCost, project?.ivaRate]);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt");
  const filteredRequirements = useMemo(() => (procurementPlan?.requirements ?? []).filter((item) =>
    item.shortageQty > 0 && (!normalizedQuery || [
      item.materialName,
      item.supplierName,
      item.quoteSource,
      ...(item.quotes ?? []).map((quote) => quote.supplierName),
      ...item.phases.map((phase) => phase.label),
    ].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(normalizedQuery))),
  ), [normalizedQuery, procurementPlan?.requirements]);
  const filteredRebar = useMemo(() => (procurementPlan?.rebarPurchasePlan?.lines ?? []).filter((line) =>
    !normalizedQuery || `aço armadura varão Ø${line.diameterMm} ${line.diameterMm}mm`.toLocaleLowerCase("pt").includes(normalizedQuery),
  ), [normalizedQuery, procurementPlan?.rebarPurchasePlan?.lines]);
  const filteredOrders = useMemo(() => orders.filter((order) =>
    !normalizedQuery || [
      order.supplierName,
      STATUS_LABELS[order.status],
      order.orderDate,
      order.requiredByDate,
      ...order.lines.map((line) => line.materialName),
    ].some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(normalizedQuery)),
  ), [normalizedQuery, orders]);
  const filteredStock = useMemo(() => stockSummary.filter((line) =>
    !normalizedQuery || line.materialName.toLocaleLowerCase("pt").includes(normalizedQuery),
  ), [normalizedQuery, stockSummary]);
  const filteredMovements = useMemo(() => movements.filter((movement) =>
    !normalizedQuery || [movement.materialName, movement.type, movement.date, movement.notes]
      .some((value) => String(value ?? "").toLocaleLowerCase("pt").includes(normalizedQuery)),
  ), [movements, normalizedQuery]);

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
    const selectedSupplier = sups.find((supplier) => supplier.id === supplierId);
    if (!selectedSupplier) {
      setSupplierId(sups[0]?.id ?? "");
    }
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

  function prepareOrderFromQuote(suggestion: ProcurementRequirement, quote: ProcurementQuote) {
    if (!quote.supplierId) return;
    setSupplierId(quote.supplierId);
    setScheduleTaskId(suggestion.suggestedScheduleTaskId ?? "");
    setRequiredByDate(suggestion.requiredByDate ?? "");
    setLines([{ materialId: suggestion.materialId, quantity: suggestion.suggestedOrderQty, unitCost: quote.unitCost, currency: project?.currency }]);
    setOrderNotes(quote.isReference ? `Pedido com preços SIGO (${quote.supplierName})` : `Cotação escolhida: ${quote.supplierName}`);
    setQuoteRequirement(null);
    setView("pedidos");
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

  async function handleMaterialRequest(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    const linesPayload = requestLines
      .map((line) => ({ materialId: line.materialId, quantity: Number(line.quantity) }))
      .filter((line) => line.materialId && line.quantity > 0);
    if (!linesPayload.length) {
      setError("Indique pelo menos um material com quantidade.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await purchasingApi.createMaterialRequest(projectId, {
        notes: requestNotes.trim() || undefined,
        lines: linesPayload,
      });
      setRequestNotes("");
      setRequestLines([{ materialId: materials[0]?.id ?? "", quantity: "1" }]);
      setShowRequestForm(false);
      setView("pedidos");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar pedido de materiais");
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
    const ok = await confirm({
      title: "Eliminar ordem de compra?",
      message: `Eliminar ordem de "${order.supplierName}"?`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: "Eliminar movimento?",
      message: `Eliminar movimento de stock (${m.materialName})?`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!ok) return;
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
    <>
    <Layout
      title={`Compras e Armazém — ${project.name}`}
      subtitle="Peça materiais, aprove pedidos e acompanhe o stock"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canRequest && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setRequestLines([{ materialId: materials[0]?.id ?? "", quantity: "1" }]);
                setShowRequestForm(true);
                setView("pedidos");
              }}
            >
              <IconPlus className="h-3.5 w-3.5" /> Pedir materiais
            </button>
          )}
          <Link
            to={`/projectos/${projectId}${searchParams.get("fase") === "gestao" ? "?fase=gestao" : ""}`}
            className="btn btn-ghost btn-sm"
          >
            <IconBack className="w-3.5 h-3.5" />
            Projecto
          </Link>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <ProjectWorkspaceNav projectId={projectId!} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!project.zoneId && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span><strong>Zona de preços em falta.</strong> Serão usadas apenas cotações gerais.</span>
            <Link className="font-semibold text-amber-900 underline underline-offset-2" to={`/projectos/${projectId}`}>Definir zona</Link>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Cobertura de materiais" value={procurementPlan?.requirements.length ? `${procurementPlan.coveragePercent.toFixed(2)}%` : "—"} note={procurementPlan?.requirements.length ? "Stock + pedidos em curso" : "Composições por associar"} />
          <MetricCard label="Total por comprar" value={(procurementPlan?.shortageTotal ?? 0).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} note={`${project.currency} · inclui IVA ${(Number(project.ivaRate) * 100).toFixed(2)}%`} />
          <MetricCard label="Por aprovar" value={orders.filter((order) => order.status === "rascunho").length} tone="warning" />
          <MetricCard label="Recebidas" value={orders.filter((order) => order.status === "recebido").length} tone="positive" />
        </div>

        <section className="card p-2">
          <div className="grid gap-1 sm:grid-cols-3">
            {([
              ["necessidades", "1. O que comprar", filteredRequirements.length],
              ["pedidos", "2. Pedidos", orders.length],
              ["stock", "3. Stock e movimentos", stockSummary.length],
            ] as Array<[PurchasingView, string, number]>).map(([id, label, count]) => (
              <button key={id} type="button" onClick={() => { setView(id); setQuery(""); }} className={`flex items-center justify-between rounded-lg px-4 py-3 text-left text-sm font-semibold ${view === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                <span>{label}</span><span className={`rounded-full px-2 py-0.5 text-xs ${view === id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <PageSearch
            value={query}
            onChange={setQuery}
            placeholder={view === "necessidades" ? "Pesquisar material, fase ou fornecedor…" : view === "pedidos" ? "Pesquisar fornecedor, material, estado ou data…" : "Pesquisar material ou movimento…"}
            resultLabel={`${view === "necessidades" ? filteredRequirements.length : view === "pedidos" ? filteredOrders.length : filteredStock.length + filteredMovements.length} resultado(s)`}
          />
        </section>

        {procurementPlan?.rebarPurchasePlan && view === "necessidades" && filteredRebar.length > 0 && (
          <section className="card overflow-hidden">
            <SectionHeader title="Armadura por diâmetro" description={`Lista de compra · ${procurementPlan.rebarPurchasePlan.sourceFileName ?? "projecto estrutural"}`} />
            <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-3">
              {filteredRebar.map((line) => (
                <article key={line.diameterMm} className="bg-white p-5">
                  <div className="flex items-start justify-between gap-3"><strong className="text-base text-slate-950">Aço Ø{line.diameterMm} mm</strong><span className="badge badge-brand">Varão {line.commercialBarLengthM} m</span></div>
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
                    <div><span className="block text-slate-500">Mapa</span><strong className="mt-1 block tabular-nums">{line.scheduledWeightKg.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</strong></div>
                    <div><span className="block text-slate-500">Comprimento</span><strong className="mt-1 block tabular-nums">{line.requiredLengthM.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m</strong></div>
                    <div><span className="block text-slate-500">Comprar</span><strong className="mt-1 block text-base tabular-nums text-orange-700">{line.barsToBuy} varões</strong></div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Peso comercial: {line.purchaseWeightKg.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg · sobra de corte: {line.cuttingSurplusKg.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</p>
                </article>
              ))}
            </div>
            <div className="border-t border-blue-100 bg-blue-50 px-5 py-3 text-xs text-blue-900">Use esta discriminação para pedir cotações por diâmetro. O item genérico “Aço A400” do orçamento continua a representar o custo aplicado total e não deve ser somado novamente.</div>
          </section>
        )}

        {procurementPlan && view === "necessidades" && <section className="card overflow-hidden">
          <SectionHeader title="Necessidades" description="Orçamento menos stock e pedidos em curso" />
          <div className="border-b border-slate-100 bg-blue-50/60 px-5 py-2.5 text-xs text-blue-900"><strong>Quantidade em falta já calculada.</strong> Confirme antes de preparar o pedido.</div>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
            {filteredRequirements.map((item) => (
              <article key={item.materialId} className="flex min-w-0 flex-col bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block break-words text-sm text-slate-950">{item.materialName}</strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{item.phases.map((phase) => phase.label).join(" · ")}</span>
                  </div>
                  {(() => {
                    const quoteCount = (item.quotes ?? []).length;
                    const hasSigoQuote = (item.quotes ?? []).some((quote) => quote.isReference);
                    return <span className={`badge shrink-0 ${quoteCount ? "badge-green" : "badge-gray"}`}>{quoteCount ? `${quoteCount} fornecedor(es)${hasSigoQuote ? " · incl. SIGO" : ""}` : "Sem cotação"}</span>;
                  })()}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
                  <div><span className="block text-slate-500">Necessário</span><strong className="mt-1 block tabular-nums">{item.requiredQty.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {item.unit}</strong></div>
                  <div><span className="block text-slate-500">Coberto</span><strong className="mt-1 block tabular-nums">{(item.stockQty + item.orderedQty).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {item.unit}</strong></div>
                  <div><span className="block text-slate-500">A comprar</span><strong className="mt-1 block tabular-nums text-orange-700">{item.suggestedOrderQty.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {item.unit}</strong></div>
                </div>
                {item.purchaseQty && item.purchasePackageLabel && <p className="mt-2 text-xs font-medium text-orange-700">Compra sugerida: {item.purchaseQty} × {item.purchasePackageLabel}</p>}
                {item.suggestedScheduleTaskName && <p className="mt-2 text-xs text-blue-700">Necessário até {item.requiredByDate} · {item.suggestedScheduleTaskName}</p>}
                <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
                  <div><span className="block text-xs text-slate-500">{item.supplierId ? (item.supplierName === "SIGO Preços" ? "Melhor: SIGO Preços" : "Melhor cotação") : "Preço do catálogo"}</span><strong className="mt-0.5 block tabular-nums text-slate-950">{item.estimatedTotalWithVat.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {procurementPlan.currency}</strong><small className="text-slate-400">IVA incluído</small></div>
                  <button className="btn btn-primary btn-sm shrink-0" onClick={() => setQuoteRequirement(item)}>Comparar preços</button>
                </div>
              </article>
            ))}
            {filteredRequirements.length === 0 && <div className="bg-white px-5 py-10 text-center text-sm text-slate-500 sm:col-span-2">{query ? "Nenhuma necessidade corresponde à pesquisa." : procurementPlan.requirements.length ? "Materiais totalmente cobertos pelo stock e pelos pedidos." : "Associe composições aos itens do orçamento para calcular as necessidades."}</div>}
          </div>
          {procurementPlan.missingCompositionItems.length > 0 && <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900"><strong>{procurementPlan.missingCompositionItems.length} item(ns) ainda não entram no aprovisionamento.</strong> Associe composições no Mapa de Quantidades para o sistema saber que materiais devem ser comprados.</div>}
        </section>}

        {quoteRequirement && procurementPlan && (
          <Modal
            title="Comparar fornecedores"
            subtitle={`${quoteRequirement.materialName} · ${quoteRequirement.suggestedOrderQty.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quoteRequirement.unit}`}
            onClose={() => setQuoteRequirement(null)}
            maxWidth="max-w-4xl"
          >
            <div className="space-y-3">
              {(quoteRequirement.quotes ?? []).map((quote, index) => (
                <article key={`${quote.supplierName}-${quote.zoneId ?? "geral"}`} className={`rounded-xl border p-4 ${index === 0 ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-base text-slate-950">{quote.supplierName}</strong>
                        {quote.isReference && <span className="badge badge-brand">SIGO</span>}
                        {index === 0 && <span className="badge badge-green">Menor preço</span>}
                        <span className="badge badge-gray">{quote.quoteSource === "zona" ? "Preço da zona" : quote.quoteSource === "geral" ? "Preço geral" : "Catálogo SIGO"}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{quote.unitCost.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {quote.currency} / {quoteRequirement.unit}</p>
                    </div>
                    <div className="flex items-center justify-between gap-5 sm:justify-end">
                      <div className="text-right">
                        <span className="block text-xs text-slate-500">Total com IVA {(procurementPlan.ivaRate * 100).toFixed(2)}%</span>
                        <strong className="mt-1 block text-lg tabular-nums text-slate-950">{quote.estimatedTotalWithVat.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {quote.currency}</strong>
                        <small className="text-slate-400">Base {quote.estimatedSubtotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + IVA {quote.estimatedVat.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small>
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" disabled={!quote.supplierId} onClick={() => prepareOrderFromQuote(quoteRequirement, quote)}>
                        Escolher
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {(quoteRequirement.quotes ?? []).length === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Ainda não há cotação para este material. <Link to="/gestao/cotacoes" className="font-semibold underline">Ver cotações</Link>
                </div>
              )}
            </div>
          </Modal>
        )}

        {/* Stock actual */}
        {view === "stock" && <section className="card">
          <SectionHeader title="Stock actual" description="Saldo disponível e valor das entradas sem IVA recuperável" />
          <div className="divide-y divide-slate-100 sm:hidden">{filteredStock.map((s) => <div key={`mobile-stock-${s.materialId}`} className="flex items-center justify-between gap-3 p-4"><div><strong className="text-sm text-slate-900">{s.materialName}</strong><p className="mt-0.5 text-xs text-slate-500">Entradas: {s.valueIn.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency} sem IVA</p></div><span className={`text-sm font-bold tabular-nums ${s.balance < 0 ? "text-red-600" : "text-slate-900"}`}>{s.balance.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {s.unit}</span></div>)}</div>
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
                {filteredStock.map((s) => (
                  <tr key={s.materialId} className="table-row">
                    <td className="py-2 px-5">{s.materialName}</td>
                    <td className={`text-right tabular-nums font-medium ${s.balance < 0 ? "text-red-600" : ""}`}>
                      {s.balance.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {s.unit}
                    </td>
                    <td className="text-right pr-5 tabular-nums text-gray-500">
                      {s.valueIn.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}
                    </td>
                  </tr>
                ))}
                {filteredStock.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-gray-400">
                      Sem movimentos de stock ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>}

        {/* Ordens de compra */}
        {view === "pedidos" && <section className="card">
          <SectionHeader title="Pedidos de materiais" description="Pedidos simples da obra e ordens com fornecedor" actions={
            <div className="flex flex-wrap gap-2">
              {canRequest && (
                <button
                  type="button"
                  onClick={() => {
                    setRequestLines([{ materialId: materials[0]?.id ?? "", quantity: "1" }]);
                    setShowRequestForm(true);
                  }}
                  className="btn btn-primary btn-sm"
                >
                  <IconPlus className="w-3.5 h-3.5" /> Pedir materiais
                </button>
              )}
              {canRequest && (
                <button onClick={() => setShowOrderForm(true)} className="btn btn-secondary btn-sm">
                  <IconPlus className="w-3.5 h-3.5" /> Ordem com fornecedor
                </button>
              )}
            </div>
          } />

          {showRequestForm && (
            <Modal title="Pedir materiais" subtitle="Pedido rápido — fica em rascunho até ser aprovado" onClose={() => setShowRequestForm(false)} maxWidth="max-w-lg">
              <form className="space-y-4" onSubmit={handleMaterialRequest}>
                <div className="space-y-2">
                  {requestLines.map((line, index) => (
                    <div key={index} className="grid grid-cols-[1fr_100px_auto] gap-2">
                      <select
                        className="input"
                        value={line.materialId}
                        onChange={(e) =>
                          setRequestLines(requestLines.map((row, i) => (i === index ? { ...row, materialId: e.target.value } : row)))
                        }
                      >
                        <option value="">Material…</option>
                        {materials.map((material) => (
                          <option key={material.id} value={material.id}>
                            {material.name} ({material.unit})
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        type="number"
                        min={0.001}
                        step="0.001"
                        value={line.quantity}
                        onChange={(e) =>
                          setRequestLines(requestLines.map((row, i) => (i === index ? { ...row, quantity: e.target.value } : row)))
                        }
                      />
                      <button
                        type="button"
                        className="icon-btn-danger"
                        disabled={requestLines.length <= 1}
                        onClick={() => setRequestLines(requestLines.filter((_, i) => i !== index))}
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setRequestLines([...requestLines, { materialId: "", quantity: "1" }])}
                  >
                    <IconPlus className="h-3.5 w-3.5" /> Linha
                  </button>
                </div>
                <div>
                  <label className="label">Nota (opcional)</label>
                  <input className="input" value={requestNotes} onChange={(e) => setRequestNotes(e.target.value)} placeholder="Urgente para a laje…" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowRequestForm(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving || !materials.length}>
                    {saving ? "A guardar…" : "Enviar pedido"}
                  </button>
                </div>
              </form>
            </Modal>
          )}

          {showOrderForm && (
            <Modal title="Nova ordem de compra" subtitle={`Fornecedor, entrega e materiais · IVA ${(Number(project.ivaRate) * 100).toFixed(2)}%`} onClose={() => setShowOrderForm(false)} maxWidth="max-w-6xl">
            <form id="purchase-order-form" onSubmit={handleCreateOrder} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="label">Fornecedor</label>
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
                    {orderSuppliers.length === 0 && <option value="">Sem fornecedores</option>}
                    {orderSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.isReference ? `${s.name} (catálogo SIGO)` : s.name}
                      </option>
                    ))}
                  </select>
                  {orderSuppliers.length === 0 && (
                    <Link to="/gestao/cotacoes" className="mt-1.5 inline-flex text-xs font-semibold text-brand-700 hover:underline">
                      Ver cotações no Portal SIGO Fornecedores →
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

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"><div><span className="text-xs text-slate-500">Subtotal</span><strong className="mt-1 block tabular-nums">{orderDraftTotals.subtotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}</strong></div><div><span className="text-xs text-slate-500">IVA {(orderDraftTotals.ivaRate * 100).toFixed(2)}%</span><strong className="mt-1 block tabular-nums">{orderDraftTotals.iva.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}</strong></div><div><span className="text-xs font-semibold text-slate-700">Total da ordem</span><strong className="mt-1 block text-lg tabular-nums text-slate-950">{orderDraftTotals.total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {project.currency}</strong></div></div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowOrderForm(false)} className="btn btn-secondary">Cancelar</button><button type="submit" disabled={saving || !supplierId || materials.length === 0} className="btn btn-primary">{saving ? "A guardar..." : "Criar ordem de compra"}</button></div>
            </form>
            </Modal>
          )}

          <div className="divide-y divide-gray-100">
            {filteredOrders.map((o) => (
              <div key={o.id} className="px-5 py-4 hover:bg-slate-50/70">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="font-medium text-gray-900">{o.supplierName}</span>{" "}
                    <span className="text-gray-400 text-sm">— {o.orderDate}</span>
                    {(o.scheduleTaskId || o.requiredByDate) && <small className="block mt-1 text-xs text-blue-700">{o.scheduleTaskId ? scheduleTasks.find((task) => task.id === o.scheduleTaskId)?.name ?? "Actividade do cronograma" : "Entrega planeada"}{o.requiredByDate ? ` · necessário até ${o.requiredByDate}` : ""}</small>}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={`badge ${STATUS_BADGE[o.status]}`}>{STATUS_LABELS[o.status]}</span>
                    {o.status === "rascunho" && canApprove && (
                      <button onClick={() => handleStatusChange(o, "aprovado")} className="btn btn-secondary btn-sm text-brand-700">
                        Aprovar
                      </button>
                    )}
                    {o.status === "aprovado" && canApprove && (
                      <button onClick={() => handleStatusChange(o, "recebido")} className="btn btn-secondary btn-sm text-green-700">
                        Receber no stock
                      </button>
                    )}
                    {o.status !== "cancelado" && o.status !== "recebido" && canRequest && (
                      <button onClick={() => handleStatusChange(o, "cancelado")} className="btn btn-secondary btn-sm text-red-600">
                        Cancelar
                      </button>
                    )}
                    {(o.status === "rascunho" || o.status === "cancelado") && <button onClick={() => handleDeleteOrder(o)} className="icon-btn-danger">
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>}
                  </div>
                </div>
                <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100 sm:hidden">{o.lines.map((line) => <div key={`mobile-order-${line.id}`} className="p-3"><strong className="block text-sm text-slate-800">{line.materialName}</strong><div className="mt-1 flex justify-between gap-3 text-xs text-slate-500"><span>{Number(line.quantity).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {line.unit} × {Number(line.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span className="font-semibold text-slate-800">{(Number(line.quantity) * Number(line.unitCost)).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {line.currency}</span></div></div>)}</div>
                <table className="mt-2 hidden w-full text-sm sm:table">
                  <tbody>
                    {o.lines.map((l) => (
                      <tr key={l.id} className="text-gray-600">
                        <td className="py-1">{l.materialName}</td>
                        <td className="py-1 text-right">
                          {Number(l.quantity).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {l.unit}
                        </td>
                        <td className="py-1 text-right">
                          {Number(l.unitCost).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {l.currency}
                        </td>
                        <td className="py-1 text-right font-medium text-gray-800">
                          {(Number(l.quantity) * Number(l.unitCost)).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {l.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-3"><div className="flex justify-between gap-3 sm:block"><span className="text-slate-500">Subtotal</span><strong className="sm:mt-1 sm:block">{purchaseOrderTotals(o).subtotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {o.lines[0]?.currency ?? project.currency}</strong></div><div className="flex justify-between gap-3 sm:block"><span className="text-slate-500">IVA {(Number(o.ivaRate) * 100).toFixed(2)}%</span><strong className="sm:mt-1 sm:block">{purchaseOrderTotals(o).iva.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {o.lines[0]?.currency ?? project.currency}</strong></div><div className="flex justify-between gap-3 border-t border-slate-200 pt-2 sm:block sm:border-0 sm:pt-0"><span className="font-semibold text-slate-700">Total</span><strong className="text-sm text-slate-950 sm:mt-1 sm:block">{purchaseOrderTotals(o).total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {o.lines[0]?.currency ?? project.currency}</strong></div></div>
              </div>
            ))}
            {filteredOrders.length === 0 && !showOrderForm && <p className="px-5 py-8 text-center text-sm text-gray-400">{query ? "Nenhuma ordem corresponde à pesquisa." : "Sem ordens de compra ainda."}</p>}
          </div>
        </section>}

        {/* Movimentos de stock manuais */}
        {view === "stock" && <section className="card">
          <SectionHeader title="Movimentos de stock" description="Entradas e saídas manuais não associadas a ordens de compra" actions={<button type="button" onClick={() => setShowMovementForm(true)} className="btn btn-secondary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Novo movimento</button>} />
          {showMovementForm && <Modal title="Novo movimento de stock" subtitle="Registe uma entrada extraordinária ou o consumo manual de material" onClose={() => setShowMovementForm(false)} maxWidth="max-w-2xl"><form onSubmit={handleCreateMovement} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><label className="label">Tipo</label><select value={movType} onChange={(e) => setMovType(e.target.value as "entrada" | "saida")} className="input"><option value="saida">Saída (consumo)</option><option value="entrada">Entrada</option></select></div><div><label className="label">Data efectiva</label><input type="date" value={movDate} onChange={(e) => setMovDate(e.target.value)} className="input" /></div><div className="sm:col-span-2"><label className="label">Material</label><select value={movMaterialId} onChange={(e) => setMovMaterialId(e.target.value)} className="input">{materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select></div><div><label className="label">Quantidade</label><input type="number" step="0.01" min="0" value={movQty} onChange={(e) => setMovQty(e.target.value)} className="input" /></div>{movType === "entrada" && <div><label className="label">Preço unitário sem IVA ({project.currency})</label><input type="number" step="0.01" min="0" value={movUnitCost} onChange={(e) => setMovUnitCost(e.target.value)} className="input" /></div>}<div className="sm:col-span-2"><label className="label">Origem / observação</label><textarea value={movNotes} onChange={(e) => setMovNotes(e.target.value)} className="input min-h-20 py-3" placeholder="Transferência de outro armazém, ajuste de inventário, frente de trabalho..." /></div></div>{movType === "entrada" && Number(movQty) > 0 && <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-xs"><div><span className="text-slate-500">Base</span><strong className="mt-1 block">{movementDraftTotals.subtotal.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div><div><span className="text-slate-500">IVA {(movementDraftTotals.ivaRate * 100).toFixed(2)}%</span><strong className="mt-1 block">{movementDraftTotals.iva.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div><div><span className="font-semibold">Total</span><strong className="mt-1 block text-sm">{movementDraftTotals.total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div></div>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" className="btn btn-secondary" onClick={() => setShowMovementForm(false)}>Cancelar</button><button type="submit" disabled={saving || materials.length === 0 || !(Number(movQty) > 0)} className="btn btn-primary"><IconPlus className="h-4 w-4" /> {saving ? "A guardar..." : "Registar movimento"}</button></div></form></Modal>}

          <div className="divide-y divide-slate-100 md:hidden">{filteredMovements.map((m) => <div key={`mobile-movement-${m.id}`} className="p-4"><div className="flex items-start justify-between gap-3"><div><span className={`badge ${m.type === "entrada" ? "badge-green" : "badge-yellow"}`}>{m.type === "entrada" ? "Entrada" : "Saída"}</span><strong className="mt-2 block text-sm text-slate-900">{m.materialName}</strong><p className="mt-0.5 text-xs text-slate-500">{m.date} · {m.purchaseOrderId ? "Ordem de compra" : m.diaryEntryId ? "Diário de obra" : "Manual"}</p></div><div className="text-right"><strong className="text-sm tabular-nums">{Number(m.quantity).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {m.unit}</strong>{m.type === "entrada" && m.unitCost && <p className="mt-1 text-xs text-slate-500">Total IVA incl.: {stockMovementTotals(m, Number(project.ivaRate)).total.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {m.currency}</p>}</div></div>{!m.purchaseOrderId && !m.diaryEntryId && <button type="button" onClick={() => handleDeleteMovement(m)} className="btn btn-secondary btn-sm mt-3 text-red-600">Eliminar movimento</button>}</div>)}</div>
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
                {filteredMovements.map((m) => (
                  <tr key={m.id} className="table-row group">
                    <td className="py-2 px-5">
                      <span className={`badge ${m.type === "entrada" ? "badge-green" : "badge-yellow"}`}>{m.type === "entrada" ? "Entrada" : "Saída"}</span>
                    </td>
                    <td>{m.materialName}</td>
                    <td className="text-right tabular-nums">
                      {Number(m.quantity).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {m.unit}
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
                {filteredMovements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-400">
                      Sem movimentos ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>}
      </div>
    </Layout>
    {dialog}
    </>
  );
}
