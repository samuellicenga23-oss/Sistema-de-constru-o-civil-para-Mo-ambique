import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgetDocuments,
  goodsReceipts,
  procurementAwards,
  procurementAwardLines,
  procurementNonconformities,
  procurementPaymentRequests,
  procurementRfqInvitations,
  procurementRfqLines,
  procurementRfqs,
  procurementSupplierQuoteLines,
  procurementSupplierQuotes,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoiceCreditNotes,
  supplierInvoicePayments,
  supplierInvoices,
  suppliers,
} from "../db/schema.js";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { computeProcurementPlan } from "../services/procurementEngine.js";
import { computeMaterialsByPhase } from "../services/materialsByPhase.js";
import { buildQuoteComparison, type RfqLineSnapshot, type SupplierQuoteSnapshot } from "../services/procurementWorkflow.js";
import {
  allocatePaymentRequestForecast,
  buildAging,
  buildSupplierStatement,
  buildWeeklyCashForecast,
  computeCompetitiveRfqMetric,
  computeMaterialVariance,
  computeSupplierRisk,
  concentrationPct,
  roundMoney,
  roundPercent,
  type ForecastItem,
  type OutstandingInvoiceFact,
  type SupplierStatementEvent,
} from "../services/procurementIntelligence.js";

const PAYABLE_STATUSES = new Set(["aprovada", "parcialmente_paga", "paga"]);
const INVOICE_PIPELINE_STATUSES = new Set(["submetida", "em_revisao", "divergente", "aprovada", "parcialmente_paga", "paga"]);
const FORECAST_PAYMENT_REQUEST_STATUSES = new Set(["submetido", "aprovado"]);
const COMMITTED_ORDER_STATUSES = new Set(["aprovado", "recebido"]);

function companyIdOf(request: FastifyRequest) { return request.currentUser!.companyId!; }
function today() { return new Date().toISOString().slice(0, 10); }
function parseWeeks(value: string | undefined) {
  const parsed = Number(value ?? 12);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(52, Math.floor(parsed))) : 12;
}

function daysBetween(start: string | Date | null, end: string | Date | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime(); const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function orderGrossTotal(order: typeof purchaseOrders.$inferSelect, lines: Array<typeof purchaseOrderLines.$inferSelect>) {
  const subtotal = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unitCost), 0) + Number(order.transportCost ?? 0);
  return roundMoney(subtotal * (1 + Number(order.ivaRate ?? 0)));
}

async function buildProjectIntelligence(projectId: string, companyId: string, weeks: number) {
  const project = await assertProjectOwned(projectId, companyId);
  if (!project) return null;
  const asOfDate = today();

  const documents = await db.select().from(budgetDocuments)
    .where(and(eq(budgetDocuments.projectId, projectId), eq(budgetDocuments.documentType, "orcamento")))
    .orderBy(desc(budgetDocuments.createdAt));
  // Inteligência financeira nunca mistura moedas. Se não existir BOQ aprovado na moeda da obra,
  // o dashboard continua com AP/OCs reais, mas omite baseline/shortage em vez de converter sem taxa.
  const budgetDocument = documents.find((row) => row.status === "aprovado" && row.currency === project.currency) ?? null;

  const [orderRows, invoiceRows, paymentRequests, rfqs, invitations, ncrRows, receiptRows] = await Promise.all([
    db.select({ order: purchaseOrders, supplierName: suppliers.name })
      .from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(eq(purchaseOrders.projectId, projectId)).orderBy(desc(purchaseOrders.orderDate)),
    db.select({ invoice: supplierInvoices, supplierName: suppliers.name })
      .from(supplierInvoices).innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .where(eq(supplierInvoices.projectId, projectId)).orderBy(desc(supplierInvoices.createdAt)),
    db.select().from(procurementPaymentRequests).where(eq(procurementPaymentRequests.projectId, projectId)),
    db.select().from(procurementRfqs).where(eq(procurementRfqs.projectId, projectId)),
    db.select({ invitation: procurementRfqInvitations, rfqProjectId: procurementRfqs.projectId })
      .from(procurementRfqInvitations).innerJoin(procurementRfqs, eq(procurementRfqInvitations.rfqId, procurementRfqs.id))
      .where(eq(procurementRfqs.projectId, projectId)),
    db.select({ ncr: procurementNonconformities, supplierId: purchaseOrders.supplierId })
      .from(procurementNonconformities).innerJoin(purchaseOrders, eq(procurementNonconformities.purchaseOrderId, purchaseOrders.id))
      .where(eq(procurementNonconformities.projectId, projectId)),
    db.select().from(goodsReceipts).where(eq(goodsReceipts.projectId, projectId)),
  ]);

  const orderIds = orderRows.map((row) => row.order.id);
  const invoiceIds = invoiceRows.map((row) => row.invoice.id);
  const rfqIds = rfqs.map((row) => row.id);

  const [orderLines, payments, credits, rfqLines, quotes, awards] = await Promise.all([
    orderIds.length ? db.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds)) : Promise.resolve([]),
    invoiceIds.length ? db.select().from(supplierInvoicePayments).where(inArray(supplierInvoicePayments.supplierInvoiceId, invoiceIds)) : Promise.resolve([]),
    invoiceIds.length ? db.select().from(supplierInvoiceCreditNotes).where(inArray(supplierInvoiceCreditNotes.supplierInvoiceId, invoiceIds)) : Promise.resolve([]),
    rfqIds.length ? db.select().from(procurementRfqLines).where(inArray(procurementRfqLines.rfqId, rfqIds)) : Promise.resolve([]),
    rfqIds.length ? db.select().from(procurementSupplierQuotes).where(inArray(procurementSupplierQuotes.rfqId, rfqIds)) : Promise.resolve([]),
    rfqIds.length ? db.select().from(procurementAwards).where(inArray(procurementAwards.rfqId, rfqIds)) : Promise.resolve([]),
  ]);
  const quoteIds = quotes.map((row) => row.id);
  const awardIds = awards.map((row) => row.id);
  const [quoteLines, awardLines] = await Promise.all([
    quoteIds.length ? db.select().from(procurementSupplierQuoteLines).where(inArray(procurementSupplierQuoteLines.quoteId, quoteIds)) : Promise.resolve([]),
    awardIds.length ? db.select().from(procurementAwardLines).where(inArray(procurementAwardLines.awardId, awardIds)) : Promise.resolve([]),
  ]);

  const paymentByInvoice = new Map<string, number>();
  for (const payment of payments) paymentByInvoice.set(payment.supplierInvoiceId, (paymentByInvoice.get(payment.supplierInvoiceId) ?? 0) + Number(payment.amount));
  const creditByInvoice = new Map<string, number>();
  for (const credit of credits) if (credit.status === "aceite") creditByInvoice.set(credit.supplierInvoiceId, (creditByInvoice.get(credit.supplierInvoiceId) ?? 0) + Number(credit.amount));

  const invoiceOutstanding = new Map<string, number>();
  const outstandingFacts: OutstandingInvoiceFact[] = [];
  for (const { invoice, supplierName } of invoiceRows) {
    const net = Math.max(0, Number(invoice.totalAmount) - (creditByInvoice.get(invoice.id) ?? 0));
    const outstanding = Math.max(0, net - (paymentByInvoice.get(invoice.id) ?? 0));
    invoiceOutstanding.set(invoice.id, outstanding);
    if (PAYABLE_STATUSES.has(invoice.status) && outstanding > 0.005) {
      outstandingFacts.push({ id: invoice.id, supplierId: invoice.supplierId, supplierName, invoiceNumber: invoice.invoiceNumber, dueDate: invoice.dueDate, issueDate: invoice.issueDate, currency: invoice.currency, outstanding });
    }
  }
  const aging = buildAging(outstandingFacts, asOfDate);

  // ---------- Forecast sem dupla contagem ----------
  const forecastItems: ForecastItem[] = [];
  const paymentRequestsByInvoice = new Map<string, number>();
  // Pedidos aprovados têm prioridade; submetidos entram só até ao saldo ainda não coberto.
  // Isto evita que dois pedidos ainda em aprovação façam o forecast exceder o AP real.
  const requestsByInvoice = new Map<string, Array<typeof procurementPaymentRequests.$inferSelect>>();
  for (const request of paymentRequests) if (FORECAST_PAYMENT_REQUEST_STATUSES.has(request.status)) {
    const list = requestsByInvoice.get(request.supplierInvoiceId) ?? []; list.push(request); requestsByInvoice.set(request.supplierInvoiceId, list);
  }
  for (const [invoiceId, requests] of requestsByInvoice) {
    const invoiceRow = invoiceRows.find((row) => row.invoice.id === invoiceId);
    const allocations = allocatePaymentRequestForecast(invoiceOutstanding.get(invoiceId) ?? Number(invoiceRow?.invoice.totalAmount ?? 0), requests.map((request) => ({ id: request.id, status: request.status as "submetido" | "aprovado", amount: Number(request.amount), createdAt: request.createdAt })));
    const requestById = new Map(requests.map((request) => [request.id, request]));
    for (const allocation of allocations) {
      const request = requestById.get(allocation.id)!;
      paymentRequestsByInvoice.set(invoiceId, (paymentRequestsByInvoice.get(invoiceId) ?? 0) + allocation.allocatedAmount);
      forecastItems.push({
        id: request.id, source: "pedido_pagamento", confidence: request.status === "aprovado" ? "alta" : "media",
        supplierId: invoiceRow?.invoice.supplierId ?? null, supplierName: invoiceRow?.supplierName ?? null, reference: request.reference,
        amount: allocation.allocatedAmount, currency: request.currency, forecastDate: request.requestedPaymentDate ?? invoiceRow?.invoice.dueDate ?? null,
        dateBasis: `${request.requestedPaymentDate ? "data solicitada no pedido" : invoiceRow?.invoice.dueDate ? "vencimento da factura" : "sem data"}${allocation.capped ? " · limitado ao saldo disponível" : ""}`,
        projectId,
      });
    }
  }

  const activeInvoiceAmountByOrder = new Map<string, number>();
  for (const { invoice, supplierName } of invoiceRows) {
    if (!INVOICE_PIPELINE_STATUSES.has(invoice.status)) continue;
    // Para cobrir commitment da OC usa-se o bruto facturado. Um crédito reduz AP, mas não
    // transforma retroactivamente essa parte numa quantidade "ainda não facturada".
    const grossInvoiced = Number(invoice.totalAmount);
    activeInvoiceAmountByOrder.set(invoice.purchaseOrderId, (activeInvoiceAmountByOrder.get(invoice.purchaseOrderId) ?? 0) + grossInvoiced);
    const outstanding = invoiceOutstanding.get(invoice.id) ?? Math.max(0, grossInvoiced - (creditByInvoice.get(invoice.id) ?? 0));
    const coveredByRequests = paymentRequestsByInvoice.get(invoice.id) ?? 0;
    const residual = Math.max(0, outstanding - coveredByRequests);
    if (residual <= 0.005 || invoice.status === "paga") continue;
    forecastItems.push({
      id: invoice.id,
      source: PAYABLE_STATUSES.has(invoice.status) ? "factura" : "factura_em_revisao",
      confidence: PAYABLE_STATUSES.has(invoice.status) ? "alta" : "media",
      supplierId: invoice.supplierId,
      supplierName,
      reference: invoice.invoiceNumber,
      amount: residual,
      currency: invoice.currency,
      forecastDate: invoice.dueDate ?? invoice.issueDate,
      dateBasis: invoice.dueDate ? "vencimento da factura" : "data de emissão (sem vencimento definido)",
      projectId,
    });
  }

  const linesByOrder = new Map<string, Array<typeof purchaseOrderLines.$inferSelect>>();
  for (const line of orderLines) { const list = linesByOrder.get(line.purchaseOrderId) ?? []; list.push(line); linesByOrder.set(line.purchaseOrderId, list); }
  const committedOrderTotalById = new Map<string, number>();
  for (const { order, supplierName } of orderRows) {
    if (!COMMITTED_ORDER_STATUSES.has(order.status)) continue;
    const total = orderGrossTotal(order, linesByOrder.get(order.id) ?? []);
    committedOrderTotalById.set(order.id, total);
    const unInvoiced = Math.max(0, total - (activeInvoiceAmountByOrder.get(order.id) ?? 0));
    if (unInvoiced <= 0.005) continue;
    forecastItems.push({
      id: order.id,
      source: "ordem_compra",
      confidence: "media",
      supplierId: order.supplierId,
      supplierName,
      reference: `OC ${order.id.slice(0, 8)}`,
      amount: unInvoiced,
      currency: project.currency,
      forecastDate: order.promisedDeliveryDate ?? order.requiredByDate ?? order.orderDate,
      dateBasis: order.promisedDeliveryDate ? "data prometida pelo fornecedor" : order.requiredByDate ? "data necessária em obra" : "data da OC",
      projectId,
      scheduleTaskId: order.scheduleTaskId,
    });
  }

  let procurementPlan: Awaited<ReturnType<typeof computeProcurementPlan>> = null;
  if (budgetDocument) {
    procurementPlan = await computeProcurementPlan({ projectId, documentId: budgetDocument.id, companyId, zoneId: project.zoneId, currency: project.currency, ivaRate: Number(project.ivaRate) });
    for (const need of procurementPlan?.requirements ?? []) {
      if (!(need.shortageQty > 0) || !(need.estimatedTotalWithVat > 0)) continue;
      forecastItems.push({
        id: `need:${need.materialId}`,
        source: "necessidade_cronograma",
        confidence: "baixa",
        supplierId: need.supplierId,
        supplierName: need.supplierName,
        reference: need.materialName,
        amount: need.estimatedTotalWithVat,
        currency: project.currency,
        forecastDate: need.requiredByDate,
        dateBasis: need.requiredByDate ? "início da actividade no cronograma" : "necessidade sem data crítica",
        projectId,
        scheduleTaskId: need.suggestedScheduleTaskId,
        scheduleTaskName: need.suggestedScheduleTaskName,
      });
    }
  }
  const cashForecast = buildWeeklyCashForecast(forecastItems, asOfDate, weeks);

  // ---------- Exposição e desempenho por fornecedor ----------
  const allSupplierIds = new Set<string>([
    ...orderRows.map((row) => row.order.supplierId),
    ...invoiceRows.map((row) => row.invoice.supplierId),
    ...invitations.map((row) => row.invitation.supplierId),
  ]);
  const supplierNames = new Map<string, string>();
  for (const row of orderRows) supplierNames.set(row.order.supplierId, row.supplierName);
  for (const row of invoiceRows) supplierNames.set(row.invoice.supplierId, row.supplierName);
  if (allSupplierIds.size) {
    const rows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, [...allSupplierIds]));
    for (const row of rows) supplierNames.set(row.id, row.name);
  }

  const confirmedReceiptsByOrder = new Map<string, string[]>();
  for (const receipt of receiptRows) if (receipt.status === "confirmado") {
    const list = confirmedReceiptsByOrder.get(receipt.purchaseOrderId) ?? []; list.push(receipt.receiptDate); confirmedReceiptsByOrder.set(receipt.purchaseOrderId, list);
  }
  const totalCommitted = [...committedOrderTotalById.values()].reduce((sum, value) => sum + value, 0);
  const supplierExposure = [...allSupplierIds].map((supplierId) => {
    const supplierOrders = orderRows.filter((row) => row.order.supplierId === supplierId && COMMITTED_ORDER_STATUSES.has(row.order.status));
    const committed = supplierOrders.reduce((sum, row) => sum + (committedOrderTotalById.get(row.order.id) ?? 0), 0);
    const supplierInvoicesRows = invoiceRows.filter((row) => row.invoice.supplierId === supplierId && PAYABLE_STATUSES.has(row.invoice.status));
    const invoicedNet = supplierInvoicesRows.reduce((sum, row) => sum + Math.max(0, Number(row.invoice.totalAmount) - (creditByInvoice.get(row.invoice.id) ?? 0)), 0);
    const paid = supplierInvoicesRows.reduce((sum, row) => sum + (paymentByInvoice.get(row.invoice.id) ?? 0), 0);
    const openAP = supplierInvoicesRows.reduce((sum, row) => sum + (invoiceOutstanding.get(row.invoice.id) ?? 0), 0);
    const overdue = supplierInvoicesRows.reduce((sum, row) => row.invoice.dueDate && row.invoice.dueDate < asOfDate ? sum + (invoiceOutstanding.get(row.invoice.id) ?? 0) : sum, 0);
    const completed = supplierOrders.filter((row) => ["recebido", "fechado"].includes(row.order.fulfillmentStatus) || row.order.status === "recebido");
    let onTime = 0; let evaluated = 0;
    for (const row of completed) {
      const target = row.order.promisedDeliveryDate ?? row.order.requiredByDate; if (!target) continue;
      const receipts = confirmedReceiptsByOrder.get(row.order.id) ?? []; if (!receipts.length) continue;
      const lastReceipt = [...receipts].sort().at(-1)!; evaluated += 1; if (lastReceipt <= target) onTime += 1;
    }
    const invitationCount = invitations.filter((row) => row.invitation.supplierId === supplierId).length;
    const responseCount = invitations.filter((row) => row.invitation.supplierId === supplierId && row.invitation.status === "respondido").length;
    const wins = awards.filter((award) => award.supplierId === supplierId).length;
    const openNcrCount = ncrRows.filter((row) => row.supplierId === supplierId && !["resolvida", "cancelada"].includes(row.ncr.status)).length;
    const concentration = concentrationPct(committed, totalCommitted);
    const onTimeRatePct = evaluated ? roundPercent((onTime / evaluated) * 100) : null;
    const risk = computeSupplierRisk({ concentrationPct: concentration, overdueAmount: overdue, openNcrCount, completedOrders: evaluated, onTimeRatePct });
    return {
      supplierId,
      supplierName: supplierNames.get(supplierId) ?? "Fornecedor",
      committed: roundMoney(committed),
      invoicedNet: roundMoney(invoicedNet),
      paid: roundMoney(paid),
      openAP: roundMoney(openAP),
      overdue: roundMoney(overdue),
      unInvoicedCommitment: roundMoney(supplierOrders.reduce((sum, row) => sum + Math.max(0, (committedOrderTotalById.get(row.order.id) ?? 0) - (activeInvoiceAmountByOrder.get(row.order.id) ?? 0)), 0)),
      concentrationPct: concentration,
      orderCount: supplierOrders.length,
      invitationCount,
      responseRatePct: invitationCount ? roundPercent((Math.min(invitationCount, responseCount) / invitationCount) * 100) : null,
      wins,
      winRatePct: invitationCount ? roundPercent((wins / invitationCount) * 100) : null,
      onTimeRatePct,
      openNcrCount,
      risk,
    };
  }).sort((a, b) => b.committed - a.committed);

  // ---------- Eficiência de sourcing / RFQ ----------
  const supplierNameById = supplierNames;
  const rfqMetrics = rfqs.filter((rfq) => rfq.status === "adjudicada").map((rfq) => {
    const lines = rfqLines.filter((line) => line.rfqId === rfq.id);
    const rfqLineSnapshots: RfqLineSnapshot[] = lines.map((line) => ({ id: line.id, description: line.description, quantity: Number(line.quantity), unit: line.unit }));
    const rfqQuotes = quotes.filter((quote) => quote.rfqId === rfq.id).map((quote): SupplierQuoteSnapshot => ({
      id: quote.id,
      supplierId: quote.supplierId,
      supplierName: supplierNameById.get(quote.supplierId) ?? "Fornecedor",
      currency: quote.currency,
      transportCost: Number(quote.transportCost),
      transportIncluded: quote.transportIncluded,
      leadTimeDays: quote.leadTimeDays,
      paymentTerms: quote.paymentTerms,
      validUntil: quote.validUntil,
      status: quote.status,
      version: quote.version,
      lines: quoteLines.filter((line) => line.quoteId === quote.id).map((line) => ({ rfqLineId: line.rfqLineId, quantityOffered: Number(line.quantityOffered), unitCost: Number(line.unitCost), discountPct: Number(line.discountPct), leadTimeDays: line.leadTimeDays, available: line.available })),
    }));
    const comparison = buildQuoteComparison(rfqLineSnapshots, rfqQuotes, rfq.currency, asOfDate);
    const comparable = comparison.filter((row) => !row.isExpired && row.lineCoveragePct >= 99.999 && row.quantityCoveragePct >= 99.999).map((row) => row.total);
    const rfqAwards = awards.filter((award) => award.rfqId === rfq.id);
    const selectedAwardIds = new Set(rfqAwards.map((award) => award.id));
    const awardedLinesTotal = awardLines.filter((line) => selectedAwardIds.has(line.awardId)).reduce((sum, line) => sum + Number(line.quantityAwarded) * Number(line.unitCost), 0);
    const awardedTransport = orderRows.filter((row) => row.order.procurementAwardId && selectedAwardIds.has(row.order.procurementAwardId)).reduce((sum, row) => sum + Number(row.order.transportCost ?? 0), 0);
    const metric = computeCompetitiveRfqMetric({ rfqId: rfq.id, reference: rfq.reference, awardedCost: awardedLinesTotal + awardedTransport, comparableQuoteTotals: comparable });
    const awardDates = rfqAwards.map((award) => award.awardedAt).sort();
    return { ...metric, title: rfq.title, supplierCount: invitations.filter((row) => row.invitation.rfqId === rfq.id).length, responseCount: comparison.length, sourcingDays: daysBetween(rfq.openedAt, awardDates[0] ?? null) };
  });
  const comparableRfqs = rfqMetrics.filter((row) => row.comparableQuoteCount >= 2 && row.savingsVsMedian != null);
  const sourcingSummary = {
    rfqCount: rfqs.length,
    awardedRfqCount: rfqMetrics.length,
    invitationCount: invitations.length,
    responseCount: invitations.filter((row) => row.invitation.status === "respondido").length,
    responseRatePct: invitations.length ? roundPercent((invitations.filter((row) => row.invitation.status === "respondido").length / invitations.length) * 100) : null,
    averageSourcingDays: rfqMetrics.filter((row) => row.sourcingDays != null).length ? roundMoney(rfqMetrics.filter((row) => row.sourcingDays != null).reduce((sum, row) => sum + (row.sourcingDays ?? 0), 0) / rfqMetrics.filter((row) => row.sourcingDays != null).length) : null,
    competitiveSavingsVsMedian: roundMoney(comparableRfqs.reduce((sum, row) => sum + (row.savingsVsMedian ?? 0), 0)),
    comparableRfqCount: comparableRfqs.length,
  };

  // ---------- BOQ vs compra real ----------
  let materialVariances: ReturnType<typeof computeMaterialVariance>[] = [];
  if (budgetDocument) {
    const phaseReport = await computeMaterialsByPhase(budgetDocument.id, companyId);
    if (phaseReport) {
      const baseline = new Map<string, { materialId: string; materialName: string; unit: string; requiredQty: number; baselineValue: number }>();
      for (const phase of phaseReport.phases) for (const line of phase.materials) {
        if (!line.materialId) continue;
        const current = baseline.get(line.materialId) ?? { materialId: line.materialId, materialName: line.name, unit: line.unit, requiredQty: 0, baselineValue: 0 };
        current.requiredQty += line.quantity; current.baselineValue += line.value; baseline.set(line.materialId, current);
      }
      const purchased = new Map<string, { qty: number; value: number }>();
      for (const line of orderLines) {
        const order = orderRows.find((row) => row.order.id === line.purchaseOrderId)?.order;
        if (!order || !COMMITTED_ORDER_STATUSES.has(order.status)) continue;
        const current = purchased.get(line.materialId) ?? { qty: 0, value: 0 };
        current.qty += Number(line.quantity); current.value += Number(line.quantity) * Number(line.unitCost); purchased.set(line.materialId, current);
      }
      materialVariances = [...baseline.values()].map((item) => {
        const actual = purchased.get(item.materialId) ?? { qty: 0, value: 0 };
        return computeMaterialVariance({ ...item, orderedQty: actual.qty, orderedValue: actual.value });
      }).filter((item) => item.orderedQty > 0).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
    }
  }
  const boqBaselineForOrdered = materialVariances.reduce((sum, row) => sum + row.baselineForOrderedQty, 0);
  const boqOrderedValue = materialVariances.reduce((sum, row) => sum + row.orderedValue, 0);
  const boqVariance = boqOrderedValue - boqBaselineForOrdered;

  const openAp = outstandingFacts.reduce((sum, row) => sum + row.outstanding, 0);
  const overdue = aging.filter((bucket) => ["1_30", "31_60", "61_90", "mais_90"].includes(bucket.key)).reduce((sum, bucket) => sum + bucket.amount, 0);
  const executedPayments = payments.reduce((sum, row) => sum + Number(row.amount), 0);
  const approvedPaymentRequests = paymentRequests.filter((row) => row.status === "aprovado").reduce((sum, row) => sum + Number(row.amount), 0);
  const unInvoicedCommitments = supplierExposure.reduce((sum, row) => sum + row.unInvoicedCommitment, 0);

  return {
    asOfDate,
    project: { id: project.id, name: project.name, currency: project.currency, zoneId: project.zoneId },
    evidence: {
      budgetDocumentId: budgetDocument?.id ?? null,
      budgetDocumentStatus: budgetDocument?.status ?? null,
      forecastWeeks: weeks,
      rule: "realizado != previsto; previsão não altera caixa nem financeiro",
    },
    executive: {
      openAp: roundMoney(openAp), overdue: roundMoney(overdue), approvedPaymentRequests: roundMoney(approvedPaymentRequests),
      unInvoicedCommitments: roundMoney(unInvoicedCommitments), scheduledShortage: roundMoney(procurementPlan?.shortageTotal ?? 0),
      forecastInHorizon: cashForecast.totalInHorizon, executedPayments: roundMoney(executedPayments), supplierCount: supplierExposure.length,
      highRiskSuppliers: supplierExposure.filter((row) => row.risk.level === "alto").length,
      competitiveSavingsVsMedian: sourcingSummary.competitiveSavingsVsMedian,
      boqProcurementVariance: roundMoney(boqVariance),
      boqProcurementVariancePct: boqBaselineForOrdered > 0 ? roundPercent((boqVariance / boqBaselineForOrdered) * 100) : null,
    },
    aging,
    cashForecast,
    suppliers: supplierExposure,
    sourcing: { summary: sourcingSummary, rfqs: rfqMetrics.sort((a, b) => Math.abs(b.savingsVsMedian ?? 0) - Math.abs(a.savingsVsMedian ?? 0)) },
    boqVariance: { baselineForOrderedQty: roundMoney(boqBaselineForOrdered), orderedValue: roundMoney(boqOrderedValue), variance: roundMoney(boqVariance), variancePct: boqBaselineForOrdered > 0 ? roundPercent((boqVariance / boqBaselineForOrdered) * 100) : null, materials: materialVariances },
  };
}

export async function procurementIntelligenceRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/procurement-intelligence", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { weeks?: string };
    const weeks = parseWeeks(query.weeks);
    const data = await buildProjectIntelligence(projectId, companyIdOf(request), weeks);
    if (!data) return reply.code(404).send({ error: "Projecto não encontrado" });
    return data;
  });

  app.get("/api/projects/:projectId/procurement-intelligence/suppliers/:supplierId/statement", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId, supplierId } = request.params as { projectId: string; supplierId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
    if (!supplier) return reply.code(404).send({ error: "Fornecedor não encontrado" });
    const [orders, invoices] = await Promise.all([
      db.select().from(purchaseOrders).where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.supplierId, supplierId))).orderBy(purchaseOrders.orderDate),
      db.select().from(supplierInvoices).where(and(eq(supplierInvoices.projectId, projectId), eq(supplierInvoices.supplierId, supplierId))).orderBy(supplierInvoices.issueDate),
    ]);
    if (!orders.length && !invoices.length) return reply.code(404).send({ error: "Fornecedor sem relação de compras com esta obra" });
    const orderIds = orders.map((row) => row.id); const invoiceIds = invoices.map((row) => row.id);
    const [lines, payments, credits] = await Promise.all([
      orderIds.length ? db.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds)) : Promise.resolve([]),
      invoiceIds.length ? db.select().from(supplierInvoicePayments).where(inArray(supplierInvoicePayments.supplierInvoiceId, invoiceIds)) : Promise.resolve([]),
      invoiceIds.length ? db.select().from(supplierInvoiceCreditNotes).where(inArray(supplierInvoiceCreditNotes.supplierInvoiceId, invoiceIds)) : Promise.resolve([]),
    ]);
    const events: SupplierStatementEvent[] = [];
    for (const order of orders) if (COMMITTED_ORDER_STATUSES.has(order.status)) {
      events.push({ id: `oc:${order.id}`, date: order.orderDate, kind: "compromisso", reference: `OC ${order.id.slice(0, 8)}`, description: "Compromisso de compra (não altera saldo AP)", debit: orderGrossTotal(order, lines.filter((line) => line.purchaseOrderId === order.id)), credit: 0, affectsBalance: false });
    }
    for (const invoice of invoices) if (PAYABLE_STATUSES.has(invoice.status)) events.push({ id: `ft:${invoice.id}`, date: invoice.issueDate, kind: "factura", reference: invoice.invoiceNumber, description: "Factura aprovada", debit: Number(invoice.totalAmount), credit: 0, affectsBalance: true });
    for (const credit of credits) if (credit.status === "aceite") events.push({ id: `nc:${credit.id}`, date: credit.issueDate, kind: "nota_credito", reference: credit.creditNumber, description: credit.reason, debit: 0, credit: Number(credit.amount), affectsBalance: true });
    for (const payment of payments) events.push({ id: `pg:${payment.id}`, date: payment.paymentDate, kind: "pagamento", reference: payment.reference ?? `Pagamento ${payment.id.slice(0, 8)}`, description: payment.method, debit: 0, credit: Number(payment.amount), affectsBalance: true });
    const statement = buildSupplierStatement(events);
    return { supplier: { id: supplier.id, name: supplier.name, nuit: supplier.nuit }, projectId, currency: project.currency, balance: statement.at(-1)?.balance ?? 0, rows: statement };
  });

  app.get("/api/projects/:projectId/procurement-intelligence/cash-forecast.csv", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { weeks?: string };
    const weeks = parseWeeks(query.weeks);
    const data = await buildProjectIntelligence(projectId, companyIdOf(request), weeks);
    if (!data) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = ["Semana início;Semana fim;Confiança;Origem;Fornecedor;Referência;Data prevista;Valor;Moeda;Base da data"];
    for (const bucket of data.cashForecast.weeks) for (const item of bucket.items) {
      const clean = (value: unknown) => String(value ?? "").replaceAll(";", ",").replaceAll("\n", " ");
      rows.push([bucket.startDate, bucket.endDate, item.confidence, item.source, clean(item.supplierName), clean(item.reference), item.forecastDate ?? "", item.amount.toFixed(2), item.currency, clean(item.dateBasis)].join(";"));
    }
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="procurement-cash-forecast-${projectId.slice(0, 8)}.csv"`).send(`\uFEFF${rows.join("\n")}`);
  });
}
