import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import LoadingState from "../components/LoadingState";
import AlertBanner from "../components/AlertBanner";
import Modal from "../components/Modal";
import PageSearch from "../components/PageSearch";
import ProjectWorkspaceNav from "../components/ProjectWorkspaceNav";
import { MetricCard, SectionHeader } from "../components/WorkspaceUI";
import { IconBack, IconPlus } from "../components/icons";
import { boqApi, type Project } from "../api/boq";
import { catalogApi, type Material } from "../api/catalog";
import { purchasingApi, type ProcurementPlan, type ProcurementRequirement, type PurchaseOrder, type StockSummaryLine } from "../api/purchasing";
import { procurementApi, type ProcurementComparison, type ProcurementRfq, type PurchaseRequisition } from "../api/procurement";
import { marketplaceApi, type MarketplaceSupplier } from "../api/marketplace";
import { useAuth } from "../auth/AuthContext";
import { can } from "../permissions";
import ProcurementFulfillmentPanel from "../components/ProcurementFulfillmentPanel";
import ProcurementAccountsPayablePanel from "../components/ProcurementAccountsPayablePanel";
import ProcurementIntelligencePanel from "../components/ProcurementIntelligencePanel";

type View = "necessidades" | "requisicoes" | "cotacoes" | "ordens" | "recepcoes" | "facturas" | "stock" | "inteligencia";
type Stage = "comprar" | "pedidos" | "stock" | "controlo";
type DraftRequisitionLine = { materialId: string; materialName: string; unit: string; quantity: number; specification?: string };
type AwardDraft = Record<string, Array<{ quoteId: string; quantity: string }>>;
type NextStep = { title: string; detail: string; view: View; actionLabel?: string; onAction?: () => void };

const REQ_LABEL: Record<PurchaseRequisition["status"], string> = {
  rascunho: "Rascunho",
  submetida: "Aguarda aprovação",
  aprovada: "Aprovada",
  em_cotacao: "Em cotação",
  adjudicada: "Adjudicada",
  comprada: "Pedido criado",
  fechada: "Fechada",
  cancelada: "Cancelada",
};
const RFQ_LABEL: Record<ProcurementRfq["status"], string> = {
  rascunho: "Rascunho",
  aberta: "Aberta",
  em_avaliacao: "Em avaliação",
  adjudicada: "Adjudicada",
  cancelada: "Cancelada",
  expirada: "Expirada",
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-MZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
function defaultDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return d.toISOString().slice(0, 10);
}

const STAGE_DEFAULT_VIEW: Record<Stage, View> = {
  comprar: "necessidades",
  pedidos: "ordens",
  stock: "stock",
  controlo: "inteligencia",
};

function stageForView(view: View): Stage {
  if (view === "necessidades" || view === "requisicoes" || view === "cotacoes") return "comprar";
  if (view === "ordens" || view === "recepcoes") return "pedidos";
  if (view === "stock") return "stock";
  return "controlo";
}

function sortInviteableSuppliers(suppliers: MarketplaceSupplier[], projectZoneId: string | null | undefined) {
  return [...suppliers].sort((a, b) => {
    const aZone = projectZoneId && a.zoneId === projectZoneId ? 0 : 1;
    const bZone = projectZoneId && b.zoneId === projectZoneId ? 0 : 1;
    if (aZone !== bZone) return aZone - bZone;
    const aMat = a.offersMaterials === false ? 1 : 0;
    const bMat = b.offersMaterials === false ? 1 : 0;
    if (aMat !== bMat) return aMat - bMat;
    return a.name.localeCompare(b.name, "pt");
  });
}

function EmptyState({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{detail}</p>
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export default function ProjectProcurementPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const canRequest = can(user, "materiais.requisitar");
  const canApprove = can(user, "materiais.aprovar") || user?.role === "admin_empresa";
  const faseQuery = searchParams.get("fase") === "gestao" ? "?fase=gestao" : "";

  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<ProcurementPlan | null>(null);
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>([]);
  const [rfqs, setRfqs] = useState<ProcurementRfq[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [stock, setStock] = useState<StockSummaryLine[]>([]);
  const [marketSuppliers, setMarketSuppliers] = useState<MarketplaceSupplier[]>([]);
  const [catalogMaterials, setCatalogMaterials] = useState<Material[]>([]);
  const [manualMaterialId, setManualMaterialId] = useState("");
  const [marketLocked, setMarketLocked] = useState<string | null>(null);
  const [view, setView] = useState<View>("necessidades");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rfqError, setRfqError] = useState<string | null>(null);
  const [rfqSupplierQuery, setRfqSupplierQuery] = useState("");

  const [reqOpen, setReqOpen] = useState(false);
  const [reqLines, setReqLines] = useState<DraftRequisitionLine[]>([]);
  const [reqPriority, setReqPriority] = useState<PurchaseRequisition["priority"]>("normal");
  const [reqSource, setReqSource] = useState<"manual" | "plano_compras">("manual");
  const [reqRequiredBy, setReqRequiredBy] = useState("");
  const [reqJustification, setReqJustification] = useState("");

  const [rfqOpen, setRfqOpen] = useState(false);
  const [rfqReq, setRfqReq] = useState<PurchaseRequisition | null>(null);
  const [rfqTitle, setRfqTitle] = useState("");
  const [rfqDeadline, setRfqDeadline] = useState(defaultDeadline());
  const [rfqSupplierIds, setRfqSupplierIds] = useState<string[]>([]);
  const [rfqMessage, setRfqMessage] = useState("");
  const [rfqPartialQuotes, setRfqPartialQuotes] = useState(true);
  const [rfqPartialAward, setRfqPartialAward] = useState(true);
  const [singleSourceReason, setSingleSourceReason] = useState("");

  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparison, setComparison] = useState<ProcurementComparison | null>(null);
  const [awardDraft, setAwardDraft] = useState<AwardDraft>({});
  const [awardReason, setAwardReason] = useState("");

  async function reload() {
    if (!projectId) return;
    setLoading(true);
    try {
      const projectData = await boqApi.getProject(projectId);
      const marketResult = await marketplaceApi
        .listSuppliers({ inviteable: true })
        .then((data) => ({ ok: true as const, data }))
        .catch((cause: unknown) => ({
          ok: false as const,
          message: cause instanceof Error ? cause.message : "Não foi possível carregar fornecedores do marketplace",
        }));

      const [planData, reqData, rfqData, orderData, stockData, materialData] = await Promise.all([
        purchasingApi.procurementPlan(projectId).catch(() => null),
        procurementApi.requisitions(projectId),
        procurementApi.rfqs(projectId),
        purchasingApi.listOrders(projectId),
        purchasingApi.stockSummary(projectId),
        catalogApi.listMaterials(projectData.zoneId ?? undefined),
      ]);
      setProject(projectData);
      setPlan(planData);
      setRequisitions(reqData);
      setRfqs(rfqData);
      setOrders(orderData);
      setStock(stockData);
      setCatalogMaterials(materialData);
      if (!manualMaterialId && materialData.length) setManualMaterialId(materialData[0].id);

      if (!marketResult.ok) {
        setMarketLocked(null);
        setMarketSuppliers([]);
        setError(marketResult.message);
      } else if (marketResult.data.locked) {
        setMarketLocked(marketResult.data.error);
        setMarketSuppliers([]);
      } else {
        setMarketLocked(null);
        setMarketSuppliers(sortInviteableSuppliers(marketResult.data.suppliers, projectData.zoneId));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as compras");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [projectId]);

  const needle = query.trim().toLocaleLowerCase("pt");
  const requirements = useMemo(
    () => (plan?.requirements ?? []).filter((item) => item.shortageQty > 0 && (!needle || `${item.materialName} ${item.phases.map((p) => p.label).join(" ")}`.toLocaleLowerCase("pt").includes(needle))),
    [plan, needle],
  );
  const visibleReqs = useMemo(
    () => requisitions.filter((r) => !needle || `${r.reference} ${REQ_LABEL[r.status]} ${r.lines.map((l) => l.materialName).join(" ")}`.toLocaleLowerCase("pt").includes(needle)),
    [requisitions, needle],
  );
  const visibleRfqs = useMemo(
    () => rfqs.filter((r) => !needle || `${r.reference} ${r.title} ${RFQ_LABEL[r.status]}`.toLocaleLowerCase("pt").includes(needle)),
    [rfqs, needle],
  );
  const visibleOrders = useMemo(
    () => orders.filter((o) => !needle || `${o.supplierName} ${o.status} ${o.lines.map((l) => l.materialName).join(" ")}`.toLocaleLowerCase("pt").includes(needle)),
    [orders, needle],
  );
  const visibleStock = useMemo(
    () => stock.filter((s) => !needle || s.materialName.toLocaleLowerCase("pt").includes(needle)),
    [stock, needle],
  );

  const inviteableSuppliers = useMemo(() => {
    const q = rfqSupplierQuery.trim().toLocaleLowerCase("pt");
    const base = marketSuppliers.filter((s) => Boolean(s.supplierAccountId));
    if (!q) return base;
    return base.filter((s) =>
      `${s.name} ${s.zoneName ?? ""} ${s.location ?? ""}`.toLocaleLowerCase("pt").includes(q),
    );
  }, [marketSuppliers, rfqSupplierQuery]);

  const openRfqs = rfqs.filter((r) => r.status === "aberta" || r.status === "em_avaliacao");
  const reqApproval = requisitions.filter((r) => r.status === "submetida");
  const approvedForRfq = requisitions.filter((r) => r.status === "aprovada");
  const draftReqs = requisitions.filter((r) => r.status === "rascunho");
  const awaitingReceipt = orders.filter((o) => o.status === "aprovado");
  const rfqsReadyToCompare = openRfqs.filter((r) => (r.responseCount ?? 0) > 0);
  const hasShortage = requirements.length > 0 || (plan?.shortageTotal ?? 0) > 0;
  const stage = stageForView(view);

  const nextStep = useMemo((): NextStep | null => {
    if (reqApproval.length) {
      return {
        title: "Aprovar requisição",
        detail: `${reqApproval.length} requisição(ões) aguardam aprovação antes de contactar o mercado.`,
        view: "requisicoes",
        actionLabel: canApprove ? "Ver requisições" : undefined,
        onAction: canApprove ? () => setView("requisicoes") : undefined,
      };
    }
    if (draftReqs.length && canRequest) {
      return {
        title: "Submeter requisição",
        detail: "Há rascunhos prontos — submeta para aprovação.",
        view: "requisicoes",
        actionLabel: "Ver rascunhos",
        onAction: () => setView("requisicoes"),
      };
    }
    if (approvedForRfq.length && canRequest) {
      return {
        title: "Pedir cotações",
        detail: `${approvedForRfq[0].reference} está aprovada. Convide fornecedores do marketplace com conta no Portal.`,
        view: "requisicoes",
        actionLabel: "Pedir preços",
        onAction: () => startRfq(approvedForRfq[0]),
      };
    }
    if (rfqsReadyToCompare.length) {
      return {
        title: "Comparar e adjudicar",
        detail: `${rfqsReadyToCompare[0].reference} já tem propostas — abra o comparativo.`,
        view: "cotacoes",
        actionLabel: "Ver cotações",
        onAction: () => setView("cotacoes"),
      };
    }
    if (openRfqs.length) {
      return {
        title: "Aguardar propostas",
        detail: `${openRfqs.length} pedido(s) de cotação aguardam resposta dos fornecedores.`,
        view: "cotacoes",
        actionLabel: "Ver cotações",
        onAction: () => setView("cotacoes"),
      };
    }
    if (awaitingReceipt.length) {
      return {
        title: "Confirmar recepção",
        detail: `${awaitingReceipt.length} ordem(ns) aprovada(s) por receber — o stock só actualiza após a entrada.`,
        view: "recepcoes",
        actionLabel: "Ir a recepções",
        onAction: () => setView("recepcoes"),
      };
    }
    if (hasShortage && canRequest && requisitions.length === 0) {
      return {
        title: "Preparar a próxima compra",
        detail: "Há materiais em falta. Confirme as quantidades antes de pedir preços.",
        view: "necessidades",
        actionLabel: "Ver necessidades",
        onAction: () => setView("necessidades"),
      };
    }
    if (stock.length === 0 && hasShortage) {
      return {
        title: "Stock ainda vazio",
        detail: "O saldo aparece depois de receber materiais. Comece pelas necessidades ou confirme entregas pendentes.",
        view: stock.length === 0 && awaitingReceipt.length ? "recepcoes" : "necessidades",
        actionLabel: awaitingReceipt.length ? "Recepções" : "Necessidades",
        onAction: () => setView(awaitingReceipt.length ? "recepcoes" : "necessidades"),
      };
    }
    return null;
  }, [
    reqApproval.length,
    draftReqs.length,
    approvedForRfq,
    rfqsReadyToCompare,
    openRfqs.length,
    awaitingReceipt.length,
    hasShortage,
    canRequest,
    canApprove,
    requisitions.length,
    stock.length,
  ]);

  function addRequirementToRequisition(item: ProcurementRequirement) {
    setReqLines((current) => {
      const existing = current.find((line) => line.materialId === item.materialId);
      if (existing) return current.map((line) => line.materialId === item.materialId ? { ...line, quantity: Math.max(line.quantity, item.suggestedOrderQty) } : line);
      return [...current, { materialId: item.materialId, materialName: item.materialName, unit: item.unit, quantity: item.suggestedOrderQty }];
    });
    setReqRequiredBy((current) => current || item.requiredByDate || "");
    setReqSource("plano_compras");
    setReqOpen(true);
  }

  function addManualMaterial() {
    const material = catalogMaterials.find((item) => item.id === manualMaterialId);
    if (!material) return;
    setReqLines((current) => current.some((line) => line.materialId === material.id)
      ? current
      : [...current, { materialId: material.id, materialName: material.name, unit: material.unit, quantity: 1 }]);
  }

  function openManualRequisition() {
    setReqLines([]);
    setReqRequiredBy("");
    setReqPriority("normal");
    setReqJustification("");
    setReqSource("manual");
    setReqOpen(true);
  }

  async function createRequisition() {
    if (!projectId || !reqLines.length) return;
    setSaving(true); setError(null);
    try {
      await procurementApi.createRequisition(projectId, {
        priority: reqPriority,
        requiredByDate: reqRequiredBy || null,
        justification: reqJustification || undefined,
        source: reqSource,
        lines: reqLines.map((line) => ({ materialId: line.materialId, quantity: line.quantity, specification: line.specification })),
      });
      setReqOpen(false); setReqLines([]); setReqJustification(""); setReqPriority("normal"); setReqRequiredBy(""); setReqSource("manual");
      setView("requisicoes");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar a requisição"); }
    finally { setSaving(false); }
  }

  async function submitReq(req: PurchaseRequisition) {
    setSaving(true); setError(null);
    try { await procurementApi.submitRequisition(req.id); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao submeter requisição"); }
    finally { setSaving(false); }
  }
  async function approveReq(req: PurchaseRequisition) {
    setSaving(true); setError(null);
    try { await procurementApi.approveRequisition(req.id); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao aprovar requisição"); }
    finally { setSaving(false); }
  }

  function startRfq(req: PurchaseRequisition) {
    const zoneMatches = sortInviteableSuppliers(
      marketSuppliers.filter((s) => Boolean(s.supplierAccountId)),
      project?.zoneId,
    ).filter((s) => project?.zoneId && s.zoneId === project.zoneId);
    setRfqReq(req);
    setRfqTitle(`Fornecimento — ${req.reference}`);
    setRfqDeadline(defaultDeadline());
    setRfqSupplierIds(zoneMatches.map((s) => s.id));
    setRfqMessage(req.notes ?? "");
    setSingleSourceReason("");
    setRfqPartialQuotes(true);
    setRfqPartialAward(true);
    setRfqSupplierQuery("");
    setRfqError(null);
    setRfqOpen(true);
  }

  async function createRfq() {
    if (!rfqReq || !rfqSupplierIds.length) return;
    setSaving(true); setRfqError(null); setError(null);
    try {
      await procurementApi.createRfq(rfqReq.id, {
        title: rfqTitle,
        message: rfqMessage || undefined,
        supplierIds: rfqSupplierIds,
        deadlineDate: rfqDeadline,
        requiredByDate: rfqReq.requiredByDate,
        allowPartialQuotes: rfqPartialQuotes,
        allowPartialAward: rfqPartialAward,
        singleSourceJustification: rfqSupplierIds.length === 1 ? (singleSourceReason.trim() || "Fornecedor seleccionado directamente para esta compra") : undefined,
      });
      setRfqOpen(false); setView("cotacoes"); await reload();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível pedir as cotações";
      setRfqError(message);
      setError(message);
    } finally { setSaving(false); }
  }

  async function openComparison(rfq: ProcurementRfq) {
    setSaving(true); setError(null);
    try {
      const data = await procurementApi.comparison(rfq.id);
      setComparison(data);
      const initial: AwardDraft = {};
      for (const line of data.lines) {
        const best = data.comparison.find((row) => row.isCheapest && data.quotes.find((q) => q.id === row.quoteId)?.lines.some((ql) => ql.rfqLineId === line.id && ql.available));
        initial[line.id] = best ? [{ quoteId: best.quoteId, quantity: line.quantity }] : [{ quoteId: "", quantity: line.quantity }];
      }
      setAwardDraft(initial); setAwardReason(""); setComparisonOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar comparativo"); }
    finally { setSaving(false); }
  }

  function addSplit(lineId: string) {
    setAwardDraft((current) => ({ ...current, [lineId]: [...(current[lineId] ?? []), { quoteId: "", quantity: "0" }] }));
  }
  function patchAllocation(lineId: string, index: number, patch: Partial<{ quoteId: string; quantity: string }>) {
    setAwardDraft((current) => ({ ...current, [lineId]: (current[lineId] ?? []).map((row, i) => i === index ? { ...row, ...patch } : row) }));
  }
  function removeAllocation(lineId: string, index: number) {
    setAwardDraft((current) => ({ ...current, [lineId]: (current[lineId] ?? []).filter((_, i) => i !== index) }));
  }

  async function awardRfq() {
    if (!comparison) return;
    const allocations = Object.entries(awardDraft).flatMap(([rfqLineId, rows]) => rows
      .filter((row) => row.quoteId && Number(row.quantity) > 0)
      .map((row) => ({ rfqLineId, quoteId: row.quoteId, quantityAwarded: Number(row.quantity) })));
    setSaving(true); setError(null);
    try {
      await procurementApi.award(comparison.rfq.id, { decisionReason: awardReason, allocations });
      setComparisonOpen(false); setView("ordens"); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível escolher o fornecedor"); }
    finally { setSaving(false); }
  }

  if (loading || !project) return <LoadingState fullScreen label="A carregar compras..." />;

  return (
    <Layout
      title={`Compras e stock — ${project.name}`}
      actions={<div className="flex flex-wrap items-center gap-2">{canRequest && <button type="button" className="btn btn-primary btn-sm" onClick={openManualRequisition}><IconPlus className="h-4 w-4" /> Adicionar compra</button>}<Link className="btn btn-secondary btn-sm" to="/gestao/fornecedores">Fornecedores</Link><Link className="btn btn-ghost btn-sm" to={`/projectos/${project.id}${faseQuery}`}><IconBack className="h-4 w-4" /> Projecto</Link></div>}
    >
      <div className="mx-auto w-full max-w-[1500px] space-y-5">
        <ProjectWorkspaceNav projectId={project.id} />
        {error && <AlertBanner tone="error" onDismiss={() => setError(null)}>{error}</AlertBanner>}
        {marketLocked && <AlertBanner tone="warning">{marketLocked}</AlertBanner>}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Falta comprar" value={money(plan?.shortageTotal ?? 0, project.currency)} />
          <MetricCard label="Por aprovar" value={reqApproval.length} tone={reqApproval.length ? "warning" : "neutral"} />
          <MetricCard label="Cotações abertas" value={openRfqs.length} note="Aguardam fornecedores" />
          <MetricCard label="Por receber" value={awaitingReceipt.length} note="Pedidos já aprovados" />
        </div>

        {nextStep && (
          <section className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-brand-600 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Próximo passo</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{nextStep.title}</p>
              <p className="mt-1 text-sm text-slate-600">{nextStep.detail}</p>
            </div>
            {nextStep.onAction && nextStep.actionLabel
              ? <button type="button" className="btn btn-primary btn-sm" onClick={nextStep.onAction}>{nextStep.actionLabel}</button>
              : <button type="button" className="btn btn-primary btn-sm" onClick={() => setView(nextStep.view)}>Continuar</button>}
          </section>
        )}

        <section className="card p-2">
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ["comprar", "Preparar compra", requirements.length + requisitions.length],
              ["pedidos", "Pedir e receber", orders.length],
              ["stock", "Stock", stock.length],
              ["controlo", "Custos", null],
            ] as Array<[Stage, string, number | null]>).map(([id, label, count]) => (
              <button key={id} type="button" onClick={() => { setView(STAGE_DEFAULT_VIEW[id]); setQuery(""); }} className={`flex items-center justify-between rounded-lg px-3 py-3 text-sm font-semibold ${stage === id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                <span>{label}</span>{count !== null && <span className={`rounded-full px-2 py-0.5 text-xs ${stage === id ? "bg-white/15" : "bg-slate-100 text-slate-500"}`}>{count}</span>}
              </button>
            ))}
          </div>
          {stage === "comprar" && <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
            <button type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === "necessidades" ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50"}`} onClick={() => setView("necessidades")}>A comprar ({requirements.length})</button>
            <button type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === "requisicoes" ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50"}`} onClick={() => setView("requisicoes")}>Aprovações ({requisitions.length})</button>
            <button type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === "cotacoes" ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50"}`} onClick={() => setView("cotacoes")}>Preços recebidos ({rfqs.length})</button>
          </div>}
          {stage === "pedidos" && <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
            <button type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === "ordens" ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50"}`} onClick={() => setView("ordens")}>Pedidos ({orders.length})</button>
            <button type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === "recepcoes" ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50"}`} onClick={() => setView("recepcoes")}>Receber ({awaitingReceipt.length})</button>
          </div>}
          {stage === "controlo" && <div className="mt-2 flex gap-1 border-t border-slate-100 pt-2">
            <button type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === "inteligencia" ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50"}`} onClick={() => setView("inteligencia")}>Análise</button>
            <button type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === "facturas" ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50"}`} onClick={() => setView("facturas")}>Pagamentos</button>
          </div>}
        </section>

        {view !== "inteligencia" && view !== "facturas" && <section className="card p-3"><PageSearch value={query} onChange={setQuery} placeholder="Pesquisar materiais, pedidos ou fornecedores…" resultLabel="" /></section>}

        {view === "necessidades" && (
          <section className="card overflow-hidden">
            <SectionHeader title="Necessidades da obra" description={plan?.sourceCertificate ? `Saldo restante = BOQ − Auto aprovado n.º ${plan.sourceCertificate.number}` : "Saldo restante do projecto (ainda sem Auto aprovado — igual ao BOQ)"} />
            {requirements.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title={needle ? "Nenhum material corresponde à pesquisa" : "Sem necessidades por adquirir"}
                  detail={needle ? "Limpe a pesquisa ou escolha outro termo." : "Quando houver materiais em falta, prepare a compra a partir daqui."}
                >
                  {canRequest && <button type="button" className="btn btn-secondary btn-sm" onClick={openManualRequisition}>Adicionar compra manual</button>}
                </EmptyState>
              </div>
            ) : (
              <div className="grid gap-px bg-slate-200 lg:grid-cols-2">
                {requirements.map((item) => (
                  <article key={item.materialId} className="bg-white p-5">
                    <div className="flex items-start justify-between gap-3"><div><strong>{item.materialName}</strong><p className="mt-1 text-xs text-slate-500">{item.phases.map((p) => p.label).join(" · ")}</p></div><span className="badge badge-brand">{item.suggestedOrderQty.toLocaleString("pt-MZ")} {item.unit}</span></div>
                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-xs"><div><span className="text-slate-500">Saldo restante</span><strong className="block">{item.requiredQty.toLocaleString("pt-MZ")} {item.unit}</strong><small className="text-slate-400">BOQ {(item.designQty ?? item.requiredQty).toLocaleString("pt-MZ")} − exec. {(item.executedQty ?? 0).toLocaleString("pt-MZ")}</small></div><div><span className="text-slate-500">Coberto</span><strong className="block">{(item.stockQty + item.orderedQty).toLocaleString("pt-MZ")} {item.unit}</strong></div><div><span className="text-slate-500">Comprar</span><strong className="block text-orange-700">{item.suggestedOrderQty.toLocaleString("pt-MZ")} {item.unit}</strong></div></div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-slate-500">{item.requiredByDate ? <>Necessário até <strong>{dateLabel(item.requiredByDate)}</strong></> : "Sem data crítica definida"}</div>{canRequest && <button className="btn btn-primary btn-sm" type="button" onClick={() => addRequirementToRequisition(item)}><IconPlus className="h-4 w-4" /> Preparar compra</button>}</div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {view === "requisicoes" && (
          <section className="space-y-3">
            <SectionHeader title="Aprovações de compra" />
            {visibleReqs.length === 0 ? (
              <EmptyState
                title="Ainda não há compras para aprovar"
                detail="Prepare uma compra com os materiais necessários ou adicione-a manualmente."
              >
                {canRequest && (
                  <>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setView("necessidades")}>Ver necessidades</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={openManualRequisition}>Adicionar manualmente</button>
                  </>
                )}
              </EmptyState>
            ) : visibleReqs.map((req) => (
              <article key={req.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-base">{req.reference}</strong><span className="badge badge-gray">{REQ_LABEL[req.status]}</span><span className="badge badge-gray">{req.priority}</span></div><p className="mt-1 text-xs text-slate-500">Necessário até {dateLabel(req.requiredByDate)} · {req.lines.length} item(ns)</p></div><div className="flex flex-wrap gap-2">{req.status === "rascunho" && canRequest && <button className="btn btn-secondary btn-sm" onClick={() => submitReq(req)}>Enviar para aprovação</button>}{req.status === "submetida" && canApprove && <button className="btn btn-primary btn-sm" onClick={() => approveReq(req)}>Aprovar</button>}{req.status === "aprovada" && canRequest && <button className="btn btn-primary btn-sm" onClick={() => startRfq(req)}>Pedir preços</button>}</div></div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{req.lines.map((line) => <div key={line.id} className="rounded-lg border border-slate-200 p-3 text-sm"><strong>{line.materialName}</strong><span className="ml-2 text-slate-500">{Number(line.requestedQty).toLocaleString("pt-MZ")} {line.unit}</span>{line.specification && <p className="mt-1 text-xs text-slate-500">{line.specification}</p>}</div>)}</div>
              </article>
            ))}
          </section>
        )}

        {view === "cotacoes" && (
          <section className="space-y-3">
            <SectionHeader title="Cotações" />
            {visibleRfqs.length === 0 ? (
              <EmptyState
                title="Ainda não há pedidos de cotação"
                detail="Aprove uma compra e envie os mesmos itens aos fornecedores para comparar preços."
              >
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setView("requisicoes")}>Ver aprovações</button>
              </EmptyState>
            ) : visibleRfqs.map((rfq) => (
              <article key={rfq.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2"><strong>{rfq.reference}</strong><span className="badge badge-gray">{RFQ_LABEL[rfq.status]}</span></div>
                    <h3 className="mt-1 text-sm font-semibold text-slate-800">{rfq.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">Prazo: {dateLabel(rfq.deadlineDate)} · {rfq.responseCount ?? 0}/{rfq.invitationCount ?? 0} resposta(s)</p>
                  </div>
                  <button className="btn btn-secondary btn-sm" disabled={!rfq.responseCount || rfq.status === "cancelada"} onClick={() => openComparison(rfq)}>Comparar propostas</button>
                </div>
              </article>
            ))}
          </section>
        )}

        {view === "ordens" && (
          <section className="space-y-3">
            <SectionHeader title="Pedidos aos fornecedores" />
            {visibleOrders.length === 0 ? (
              <EmptyState
                title="Ainda não há pedidos aos fornecedores"
                detail="Depois de escolher um fornecedor, o pedido de compra aparece aqui automaticamente."
              >
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView("cotacoes")}>Ver cotações</button>
              </EmptyState>
            ) : visibleOrders.map((order) => (
              <article key={order.id} className="card p-5">
                <div className="flex items-start justify-between"><div><strong>{order.supplierName}</strong><p className="text-xs text-slate-500">{dateLabel(order.orderDate)} · entrega {dateLabel(order.requiredByDate)}</p></div><span className="badge badge-gray">{order.status}</span></div>
                <div className="mt-3 text-sm">{order.lines.map((line) => <div key={line.id} className="flex justify-between border-t border-slate-100 py-2"><span>{line.materialName} · {Number(line.quantity).toLocaleString("pt-MZ")} {line.unit}</span><strong>{money(Number(line.quantity) * Number(line.unitCost), line.currency)}</strong></div>)}{Number(order.transportCost ?? 0) > 0 && <div className="flex justify-between border-t border-slate-100 py-2"><span>Transporte adjudicado</span><strong>{money(Number(order.transportCost), order.lines[0]?.currency ?? project.currency)}</strong></div>}</div>
              </article>
            ))}
          </section>
        )}

        {view === "recepcoes" && (
          <ProcurementFulfillmentPanel
            projectId={projectId!}
            canReceive={Boolean(canRequest || canApprove)}
            onChanged={reload}
          />
        )}

        {view === "facturas" && (
          <ProcurementAccountsPayablePanel
            projectId={projectId!}
            canApprove={Boolean(canApprove)}
            onChanged={reload}
          />
        )}

        {view === "stock" && (
          <section className="card overflow-hidden">
            <SectionHeader title="Stock da obra" />
            {visibleStock.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title={needle ? "Nenhum material no stock corresponde à pesquisa" : "Stock vazio nesta obra"}
                  detail={
                    hasShortage
                      ? "O stock actualiza quando a entrega é confirmada. Existem materiais por comprar ou receber."
                      : "Quando houver entradas de material, o saldo aparece aqui."
                  }
                >
                  {hasShortage && (
                    <>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setView("necessidades")}>Ver necessidades</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView("recepcoes")}>Ir a recepções</button>
                    </>
                  )}
                </EmptyState>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleStock.map((line) => (
                  <div key={line.materialId} className="flex items-center justify-between px-5 py-4">
                    <strong className="text-sm">{line.materialName}</strong>
                    <span className="tabular-nums text-sm">{line.balance.toLocaleString("pt-MZ")} {line.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {view === "inteligencia" && <ProcurementIntelligencePanel projectId={projectId!} />}
      </div>

      {reqOpen && (
        <Modal onClose={() => setReqOpen(false)} title="Preparar compra" maxWidth="max-w-4xl">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label><span className="label">Prioridade</span><select className="input" value={reqPriority} onChange={(e) => setReqPriority(e.target.value as PurchaseRequisition["priority"])}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
              <label><span className="label">Necessário até</span><input className="input" type="date" value={reqRequiredBy} onChange={(e) => setReqRequiredBy(e.target.value)} /></label>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="label">Adicionar outro material</span>
              <div className="flex gap-2">
                <select className="input flex-1" value={manualMaterialId} onChange={(e) => setManualMaterialId(e.target.value)}>{catalogMaterials.map((material) => <option key={material.id} value={material.id}>{material.name} · {material.unit}</option>)}</select>
                <button type="button" className="btn btn-secondary" onClick={addManualMaterial}>Adicionar</button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Use esta opção apenas para materiais que não aparecem na lista automática.</p>
            </div>
            <div className="space-y-2">
              {reqLines.map((line, index) => (
                <div key={line.materialId} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1fr_150px_40px]">
                  <div>
                    <strong className="text-sm">{line.materialName}</strong>
                    <input className="input mt-2" placeholder="Especificação técnica / marca equivalente / observação" value={line.specification ?? ""} onChange={(e) => setReqLines((cur) => cur.map((x, i) => i === index ? { ...x, specification: e.target.value } : x))} />
                  </div>
                  <label><span className="label">Quantidade ({line.unit})</span><input className="input" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => setReqLines((cur) => cur.map((x, i) => i === index ? { ...x, quantity: Number(e.target.value) } : x))} /></label>
                  <button type="button" className="btn btn-ghost self-end" onClick={() => setReqLines((cur) => cur.filter((_, i) => i !== index))}>×</button>
                </div>
              ))}
            </div>
            <label><span className="label">Justificação / contexto da obra</span><textarea className="input min-h-24" value={reqJustification} onChange={(e) => setReqJustification(e.target.value)} /></label>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setReqOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" disabled={saving || !reqLines.length} onClick={createRequisition}>Guardar compra</button>
            </div>
          </div>
        </Modal>
      )}

      {rfqOpen && (
        <Modal onClose={() => setRfqOpen(false)} title="Escolher fornecedores" maxWidth="max-w-3xl">
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{rfqReq?.lines.length ?? 0} material(is)</strong> · necessários em {dateLabel(rfqReq?.requiredByDate ?? null)}</div>
            {rfqError && <AlertBanner tone="error" onDismiss={() => setRfqError(null)}>{rfqError}</AlertBanner>}
            <label className="block max-w-xs"><span className="label">Responder até</span><input className="input" type="date" value={rfqDeadline} onChange={(e) => setRfqDeadline(e.target.value)} /></label>
            <div>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <span className="label mb-0">Fornecedores convidados</span>
                <input
                  className="input max-w-xs"
                  placeholder="Pesquisar nome ou zona…"
                  value={rfqSupplierQuery}
                  onChange={(e) => setRfqSupplierQuery(e.target.value)}
                  disabled={Boolean(marketLocked)}
                />
              </div>
              <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
                {marketLocked ? (
                  <div className="px-2 py-6 text-center text-sm text-slate-600">
                    <p className="font-semibold text-slate-800">Marketplace indisponível neste plano</p>
                    <p className="mt-2">{marketLocked}</p>
                    <Link to="/empresa" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">Ver planos / upgrade</Link>
                  </div>
                ) : inviteableSuppliers.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-slate-600">
                    <p className="font-semibold text-slate-800">
                      {rfqSupplierQuery.trim() ? "Nenhum fornecedor corresponde à pesquisa" : "Nenhum fornecedor convidável encontrado"}
                    </p>
                    <p className="mt-2">
                      Apenas fornecedores activos no SIGO podem receber este pedido
                      {project.zoneId ? " (todas as zonas; os da zona da obra aparecem primeiro)" : ""}.
                    </p>
                    <Link to="/gestao/fornecedores" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">
                      Abrir SIGO Fornecedores
                    </Link>
                  </div>
                ) : (
                  inviteableSuppliers.map((supplier) => {
                    const sameZone = Boolean(project.zoneId && supplier.zoneId === project.zoneId);
                    return (
                      <label key={supplier.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={rfqSupplierIds.includes(supplier.id)}
                          onChange={(e) => setRfqSupplierIds((cur) => e.target.checked ? [...cur, supplier.id] : cur.filter((id) => id !== supplier.id))}
                        />
                        <span className="min-w-0 flex-1">
                          <strong className="text-sm">{supplier.name}</strong>
                          <span className="ml-2 text-xs text-slate-500">{supplier.zoneName ?? supplier.location ?? "Moçambique"}</span>
                          <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sameZone ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                            {sameZone ? "Zona da obra" : "Outra zona"}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              {!marketLocked && inviteableSuppliers.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {rfqSupplierIds.length} seleccionado(s) · {inviteableSuppliers.length} disponível(eis)
                  {project.zoneId ? " · prioridade à zona da obra" : ""}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setRfqOpen(false)}>Cancelar</button>
              <button
                className="btn btn-primary"
                disabled={saving || Boolean(marketLocked) || !rfqTitle || !rfqDeadline || !rfqSupplierIds.length}
                onClick={createRfq}
              >
                Pedir preço a {rfqSupplierIds.length} fornecedor(es)
              </button>
            </div>
          </div>
        </Modal>
      )}

      {comparisonOpen && (
        <Modal onClose={() => setComparisonOpen(false)} title={`Comparar cotações — ${comparison?.rfq.reference ?? "Pedido"}`} maxWidth="max-w-7xl">
          {comparison && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs text-slate-500">Valores comerciais comparados sem IVA; o IVA da obra é aplicado na Ordem de Compra e no compromisso financeiro.</p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="p-3">Fornecedor</th>
                        <th className="p-3 text-right">Subtotal</th>
                        <th className="p-3 text-right">Transporte</th>
                        <th className="p-3 text-right">Total</th>
                        <th className="p-3">Entrega</th>
                        <th className="p-3">Pagamento</th>
                        <th className="p-3">Validade</th>
                        <th className="p-3">Cobertura</th>
                        <th className="p-3">Destaque</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.comparison.map((row) => (
                        <tr key={row.quoteId} className="border-t">
                          <td className="p-3 font-semibold">{row.supplierName}</td>
                          <td className="p-3 text-right">{money(row.subtotal, row.currency)}</td>
                          <td className="p-3 text-right">{money(row.transportCost, row.currency)}</td>
                          <td className="p-3 text-right font-semibold">{money(row.total, row.currency)}</td>
                          <td className="p-3">{row.leadTimeDays == null ? "—" : `${row.leadTimeDays} dias`}</td>
                          <td className="p-3">{row.paymentTerms ?? "—"}</td>
                          <td className="p-3">{dateLabel(row.validUntil)}</td>
                          <td className="p-3">{row.quantityCoveragePct.toFixed(0)}%</td>
                          <td className="p-3">
                            <div className="flex gap-1">
                              {row.isCheapest && <span className="badge badge-green">Menor custo</span>}
                              {row.isFastest && <span className="badge badge-brand">Mais rápido</span>}
                              {row.isExpired && <span className="badge badge-red">Expirada</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="font-semibold">Adjudicação</h3>
                <div className="mt-3 space-y-3">
                  {comparison.lines.map((line) => {
                    const sum = (awardDraft[line.id] ?? []).reduce((s, a) => s + Number(a.quantity || 0), 0);
                    return (
                      <div key={line.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex justify-between">
                          <div>
                            <strong>{line.description}</strong>
                            <span className="ml-2 text-xs text-slate-500">Solicitado {Number(line.quantity).toLocaleString("pt-MZ")} {line.unit}</span>
                          </div>
                          <span className={`text-xs font-semibold ${Math.abs(sum - Number(line.quantity)) < 0.001 ? "text-green-700" : "text-orange-700"}`}>
                            Alocado {sum.toLocaleString("pt-MZ")}/{Number(line.quantity).toLocaleString("pt-MZ")}
                          </span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {(awardDraft[line.id] ?? []).map((allocation, index) => (
                            <div key={index} className="grid gap-2 md:grid-cols-[1fr_150px_auto]">
                              <select className="input" value={allocation.quoteId} onChange={(e) => patchAllocation(line.id, index, { quoteId: e.target.value })}>
                                <option value="">Seleccionar proposta...</option>
                                {comparison.quotes.filter((q) => !comparison.comparison.find((row) => row.quoteId === q.id)?.isExpired && q.lines.some((ql) => ql.rfqLineId === line.id && ql.available)).map((q) => (
                                  <option key={q.id} value={q.id}>{q.supplierName} · v{q.version}</option>
                                ))}
                              </select>
                              <input className="input" type="number" min="0" step="0.001" value={allocation.quantity} onChange={(e) => patchAllocation(line.id, index, { quantity: e.target.value })} />
                              <button className="btn btn-ghost" onClick={() => removeAllocation(line.id, index)}>Remover</button>
                            </div>
                          ))}
                        </div>
                        {comparison.rfq.allowPartialAward && (
                          <button className="mt-2 text-xs font-semibold text-blue-700" onClick={() => addSplit(line.id)}>+ Dividir por outro fornecedor</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <label>
                <span className="label">Justificação da decisão</span>
                <textarea className="input min-h-24" placeholder="Ex.: segunda melhor proposta em preço, mas inclui transporte e pagamento a 30 dias." value={awardReason} onChange={(e) => setAwardReason(e.target.value)} />
              </label>
              <div className="flex justify-end gap-2">
                <button className="btn btn-secondary" onClick={() => setComparisonOpen(false)}>Fechar</button>
                <button className="btn btn-primary" disabled={saving || awardReason.trim().length < 8} onClick={awardRfq}>Escolher e criar pedido</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </Layout>
  );
}
