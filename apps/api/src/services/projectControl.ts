import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, financialEntries, invoiceCreditNotes, invoiceReceipts, materials, measurementCertificates, projectInvoices, purchaseOrders, siteDiaryEntries, stockMovements, supplierInvoiceCreditNotes, supplierInvoicePayments, supplierInvoices } from "../db/schema.js";
import { getBudgetDocumentSummary } from "./boqEngine.js";
import { getProjectSchedule } from "./scheduleEngine.js";

type AlertLevel = "critical" | "warning" | "info";
type ControlAlert = { code: string; level: AlertLevel; title: string; detail: string; href: string };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(earlier: string, later: string) {
  return Math.floor((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

function plannedPercent(start: string, end: string, referenceDate: string) {
  if (referenceDate < start) return 0;
  if (referenceDate >= end) return 100;
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  const currentTime = Date.parse(`${referenceDate}T00:00:00Z`);
  return Math.max(0, Math.min(100, ((currentTime - startTime) / Math.max(1, endTime - startTime)) * 100));
}

// Consolida dados que já são operacionais no SIGO. Não inventa custo real: quando uma saída do
// diário não traz custo próprio, valoriza-a pelo custo médio das entradas efectivamente registadas
// para aquele material na mesma obra e identifica-a como estimativa no consumidor da API.
export async function getProjectControl(projectId: string, currency: string) {
  const [documents, entries, movements, orders, supplierBills, clientInvoices, certificates, diaryEntries, schedule] = await Promise.all([
    db.select().from(budgetDocuments).where(eq(budgetDocuments.projectId, projectId)),
    db.select().from(financialEntries).where(eq(financialEntries.projectId, projectId)),
    db.select({ movement: stockMovements, materialName: materials.name, unit: materials.unit })
      .from(stockMovements)
      .innerJoin(materials, eq(stockMovements.materialId, materials.id))
      .where(eq(stockMovements.projectId, projectId)),
    db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, projectId)),
    db.select().from(supplierInvoices).where(eq(supplierInvoices.projectId, projectId)),
    db.select().from(projectInvoices).where(eq(projectInvoices.projectId, projectId)),
    db.select().from(measurementCertificates).where(eq(measurementCertificates.projectId, projectId)),
    db.select().from(siteDiaryEntries).where(eq(siteDiaryEntries.projectId, projectId)),
    getProjectSchedule(projectId),
  ]);

  const supplierBillIds = supplierBills.map((invoice) => invoice.id);
  const clientInvoiceIds = clientInvoices.map((invoice) => invoice.id);
  const [supplierPayments, supplierCredits, clientReceipts, clientCredits] = await Promise.all([
    supplierBillIds.length ? db.select().from(supplierInvoicePayments).where(inArray(supplierInvoicePayments.supplierInvoiceId, supplierBillIds)) : Promise.resolve([]),
    supplierBillIds.length ? db.select().from(supplierInvoiceCreditNotes).where(inArray(supplierInvoiceCreditNotes.supplierInvoiceId, supplierBillIds)) : Promise.resolve([]),
    clientInvoiceIds.length ? db.select().from(invoiceReceipts).where(inArray(invoiceReceipts.invoiceId, clientInvoiceIds)) : Promise.resolve([]),
    clientInvoiceIds.length ? db.select().from(invoiceCreditNotes).where(inArray(invoiceCreditNotes.invoiceId, clientInvoiceIds)) : Promise.resolve([]),
  ]);

  const approvedDocument = documents.filter((document) => document.status === "aprovado" && document.documentType === "orcamento")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const budgetSummary = approvedDocument ? await getBudgetDocumentSummary(approvedDocument.id) : null;
  const contractedValue = budgetSummary?.total ?? 0;

  const financial = entries.filter((entry) => entry.currency === currency).reduce((acc, entry) => {
    const amount = Number(entry.amount);
    if (entry.type === "receita") {
      if (entry.sourceType === "invoice") return acc;
      // Lançamentos de factura (obra / Comercial) reflectem o estado agregado; pagamentos
      // parciais detalham-se no resumo financeiro via recibos.
      if (entry.status === "pago") acc.received += amount;
      else acc.receivable += amount;
      if (entry.sourceType === "measurement_certificate") acc.certified += amount;
    } else {
      if (entry.sourceType === "purchase_order" || entry.sourceType === "supplier_invoice") return acc;
      if (entry.status === "pago") acc.paidCost += amount;
      else acc.committedCost += amount;
    }
    return acc;
  }, { received: 0, receivable: 0, certified: 0, paidCost: 0, committedCost: 0 });

  // Um Auto aprovado cria imediatamente uma factura em rascunho. O valor certificado vem
  // dessa factura mesmo antes da emissão; recebimentos e saldo vêm dos movimentos próprios,
  // permitindo pagamentos parciais sem depender do lançamento financeiro agregado.
  if (clientInvoices.length > 0) {
    financial.certified = clientInvoices
      .filter((invoice) => invoice.currency === currency && invoice.status !== "cancelada")
      .reduce((sum, invoice) => sum + Number(invoice.grossAmount), 0);
    const receivedByInvoice = new Map<string, number>();
    const creditedByInvoice = new Map<string, number>();
    for (const receipt of clientReceipts) receivedByInvoice.set(receipt.invoiceId, (receivedByInvoice.get(receipt.invoiceId) ?? 0) + Number(receipt.amount));
    for (const credit of clientCredits) if (credit.status === "emitida") creditedByInvoice.set(credit.invoiceId, (creditedByInvoice.get(credit.invoiceId) ?? 0) + Number(credit.amount));
    for (const invoice of clientInvoices) {
      if (invoice.currency !== currency || invoice.status === "cancelada") continue;
      const received = receivedByInvoice.get(invoice.id) ?? 0;
      financial.received += received;
      if (invoice.status !== "rascunho") {
        financial.receivable += Math.max(0, Number(invoice.netAmount) - (creditedByInvoice.get(invoice.id) ?? 0) - received);
      }
    }
  }

  const paidByInvoice = new Map<string, number>();
  const creditByInvoice = new Map<string, number>();
  for (const payment of supplierPayments) paidByInvoice.set(payment.supplierInvoiceId, (paidByInvoice.get(payment.supplierInvoiceId) ?? 0) + Number(payment.amount));
  for (const credit of supplierCredits) if (credit.status === "aceite") creditByInvoice.set(credit.supplierInvoiceId, (creditByInvoice.get(credit.supplierInvoiceId) ?? 0) + Number(credit.amount));
  const invoicedNetByOrder = new Map<string, number>();
  for (const invoice of supplierBills) {
    if (invoice.currency !== currency || !["aprovada", "parcialmente_paga", "paga"].includes(invoice.status)) continue;
    const net = Math.max(0, Number(invoice.totalAmount) - (creditByInvoice.get(invoice.id) ?? 0));
    const paid = paidByInvoice.get(invoice.id) ?? 0;
    financial.paidCost += paid;
    financial.committedCost += Math.max(0, net - paid);
    invoicedNetByOrder.set(invoice.purchaseOrderId, (invoicedNetByOrder.get(invoice.purchaseOrderId) ?? 0) + net);
  }
  for (const entry of entries.filter((row) => row.type === "despesa" && row.sourceType === "purchase_order" && row.currency === currency)) {
    if (!entry.sourceId) continue;
    const invoiced = invoicedNetByOrder.get(entry.sourceId) ?? 0;
    if (entry.status === "pendente") financial.committedCost += Math.max(0, Number(entry.amount) - invoiced);
    else if (entry.status === "pago" && invoiced <= 0) financial.paidCost += Number(entry.amount);
  }

  const stockByMaterial = new Map<string, { name: string; unit: string; incomingQty: number; incomingValue: number; outgoingQty: number; outgoingValue: number; estimatedOutgoingQty: number; outgoingEstimated: boolean }>();
  for (const { movement, materialName, unit } of movements) {
    const item = stockByMaterial.get(movement.materialId) ?? { name: materialName, unit, incomingQty: 0, incomingValue: 0, outgoingQty: 0, outgoingValue: 0, estimatedOutgoingQty: 0, outgoingEstimated: false };
    const quantity = Number(movement.quantity);
    if (movement.type === "entrada") {
      item.incomingQty += quantity;
      item.incomingValue += quantity * Number(movement.unitCost ?? 0);
    } else {
      item.outgoingQty += quantity;
      if (movement.unitCost === null) {
        item.estimatedOutgoingQty += quantity;
        item.outgoingEstimated = true;
      } else {
        item.outgoingValue += quantity * Number(movement.unitCost);
      }
    }
    stockByMaterial.set(movement.materialId, item);
  }
  // Calcula a média depois de conhecer todas as entradas; a ordem devolvida pela base de dados
  // não pode alterar o valor apresentado para o mesmo conjunto de movimentos.
  for (const item of stockByMaterial.values()) {
    item.outgoingValue += item.estimatedOutgoingQty * (item.incomingQty > 0 ? item.incomingValue / item.incomingQty : 0);
  }
  const stock = Array.from(stockByMaterial.values()).map((item) => ({
    materialName: item.name,
    unit: item.unit,
    balance: item.incomingQty - item.outgoingQty,
    consumedQty: item.outgoingQty,
    consumedValue: item.outgoingValue,
    estimatedCost: item.outgoingEstimated,
  })).sort((a, b) => b.consumedValue - a.consumedValue);
  const consumedStockValue = stock.reduce((sum, item) => sum + item.consumedValue, 0);

  const leaves = schedule.tasks.filter((task) => !task.isSummary);
  const date = today();
  const scheduleWeight = leaves.reduce((sum, task) => sum + task.plannedValue, 0);
  const expectedProgress = scheduleWeight > 0
    ? leaves.reduce((sum, task) => sum + task.plannedValue * plannedPercent(task.startDate, task.endDate, date) / 100, 0) / scheduleWeight * 100
    : 0;
  const actualProgress = schedule.overallProgress;
  const progressGap = actualProgress - expectedProgress;

  const alerts: ControlAlert[] = [];
  if (!approvedDocument) alerts.push({ code: "budget_missing", level: "critical", title: "Orçamento por aprovar", detail: "A obra ainda não tem referência contratual para controlo físico-financeiro.", href: `/projectos/${projectId}` });
  if (approvedDocument && contractedValue <= 0) alerts.push({ code: "contract_value_zero", level: "critical", title: "Valor contratado inválido", detail: "O orçamento aprovado tem total igual a zero. Corrija preços e quantidades antes de controlar a obra.", href: `/documentos/${approvedDocument.id}?fase=orcamento` });
  if (!leaves.length) alerts.push({ code: "schedule_missing", level: "critical", title: "Cronograma em falta", detail: "Gere ou importe o cronograma antes de iniciar o acompanhamento da execução.", href: `/projectos/${projectId}/cronograma?fase=gestao` });
  const unlinkedTasks = leaves.filter((task) => !task.budgetLineItemId && !task.budgetChapterCode);
  if (unlinkedTasks.length) alerts.push({ code: "schedule_unlinked", level: "warning", title: "Actividades sem orçamento", detail: `${unlinkedTasks.length} actividade(s) não têm ligação ao mapa de quantidades; o avanço financeiro pode ficar incompleto.`, href: `/projectos/${projectId}/cronograma?fase=gestao` });
  if (expectedProgress >= 10 && progressGap <= -10) alerts.push({ code: "schedule_delay", level: "warning", title: "Execução abaixo do planeado", detail: `Previsto ${expectedProgress.toFixed(2)}%; realizado ${actualProgress.toFixed(2)}%.`, href: `/projectos/${projectId}/cronograma` });
  if (contractedValue > 0 && financial.paidCost > contractedValue) alerts.push({ code: "cost_over_contract", level: "critical", title: "Custo pago acima do contrato", detail: "Os pagamentos de despesa já ultrapassaram o valor contratado.", href: `/projectos/${projectId}/financeiro` });
  const overdueOrders = orders.filter((order) => order.status === "aprovado" && order.requiredByDate && order.requiredByDate < date);
  if (overdueOrders.length) alerts.push({ code: "purchase_overdue", level: "warning", title: "Compras em atraso", detail: `${overdueOrders.length} ordem(ns) aprovada(s) ultrapassou(aram) a data necessária.`, href: `/projectos/${projectId}/compras` });
  const exhausted = stock.filter((item) => item.consumedQty > 0 && item.balance <= 0);
  if (exhausted.length) alerts.push({ code: "stock_exhausted", level: "warning", title: "Material sem saldo", detail: `${exhausted.slice(0, 2).map((item) => item.materialName).join(", ")}${exhausted.length > 2 ? " e outros" : ""}.`, href: `/projectos/${projectId}/compras` });
  const negativeStock = stock.filter((item) => item.balance < -0.0001);
  if (negativeStock.length) alerts.push({ code: "stock_negative", level: "critical", title: "Stock negativo", detail: `${negativeStock.length} material(is) têm saídas superiores às entradas. Reveja os movimentos.`, href: `/projectos/${projectId}/compras?fase=gestao` });
  if (stock.some((item) => item.estimatedCost)) alerts.push({ code: "stock_cost_estimated", level: "info", title: "Consumo com custo estimado", detail: "Há saídas valorizadas pelo custo médio porque não possuem custo unitário próprio.", href: `/projectos/${projectId}/compras?fase=gestao` });
  const submittedCertificates = certificates.filter((certificate) => certificate.status === "submetido");
  if (submittedCertificates.length) alerts.push({ code: "certificate_pending", level: "warning", title: "Autos aguardam decisão", detail: `${submittedCertificates.length} Auto(s) submetido(s) precisam de aprovação ou devolução.`, href: `/projectos/${projectId}?fase=gestao#certificados-obra` });
  const draftInvoices = clientInvoices.filter((invoice) => invoice.status === "rascunho");
  if (draftInvoices.length) alerts.push({ code: "client_invoice_draft", level: "info", title: "Facturas por emitir", detail: `${draftInvoices.length} factura(s) de Auto estão em rascunho.`, href: `/projectos/${projectId}/financeiro?fase=gestao` });
  const overdueClientInvoices = clientInvoices.filter((invoice) => ["emitida", "parcial"].includes(invoice.status) && invoice.dueDate && invoice.dueDate < date);
  if (overdueClientInvoices.length) alerts.push({ code: "client_invoice_overdue", level: "warning", title: "Recebimentos vencidos", detail: `${overdueClientInvoices.length} factura(s) ao cliente ultrapassaram o vencimento.`, href: `/projectos/${projectId}/financeiro?fase=gestao` });
  const overdueSupplierInvoices = supplierBills.filter((invoice) => ["aprovada", "parcialmente_paga"].includes(invoice.status) && invoice.dueDate && invoice.dueDate < date);
  if (overdueSupplierInvoices.length) alerts.push({ code: "supplier_invoice_overdue", level: "warning", title: "Pagamentos vencidos", detail: `${overdueSupplierInvoices.length} factura(s) de fornecedor ultrapassaram o vencimento.`, href: `/projectos/${projectId}/compras?fase=gestao` });
  const lastDiaryDate = diaryEntries.reduce<string | null>((latest, entry) => !latest || entry.date > latest ? entry.date : latest, null);
  const scheduleStarted = Boolean(schedule.startDate && schedule.startDate <= date);
  const scheduleOpen = !schedule.endDate || schedule.endDate >= date || actualProgress < 99.99;
  if (scheduleStarted && scheduleOpen && (!lastDiaryDate || daysBetween(lastDiaryDate, date) >= 3)) {
    alerts.push({ code: "diary_stale", level: "warning", title: "Diário desactualizado", detail: lastDiaryDate ? `Último relatório há ${daysBetween(lastDiaryDate, date)} dias.` : "Ainda não existe relatório diário nesta obra.", href: `/projectos/${projectId}/diario?fase=gestao` });
  }
  if (financial.certified > financial.received + 0.01) alerts.push({ code: "certified_unpaid", level: "info", title: "Autos por receber", detail: "Existem autos aprovados ainda não recebidos financeiramente.", href: `/projectos/${projectId}/financeiro` });

  const alertRank: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => alertRank[a.level] - alertRank[b.level]);
  const nextAction = alerts[0] ?? (actualProgress < 100
    ? { code: "diary_continue", level: "info" as const, title: "Registar andamento", detail: "Actualize os trabalhos, consumos e progresso do dia.", href: `/projectos/${projectId}/diario?fase=gestao` }
    : { code: "project_review", level: "info" as const, title: "Rever encerramento", detail: "Confirme saldos, facturas e documentos finais da obra.", href: `/projectos/${projectId}?fase=gestao` });

  return {
    currency,
    basis: { approvedBudgetDocumentId: approvedDocument?.id ?? null, referenceDate: date, stockConsumptionEstimated: stock.some((item) => item.estimatedCost) },
    commercial: { contractedValue, certifiedValue: financial.certified, receivedValue: financial.received, receivableValue: financial.receivable },
    cost: { paidValue: financial.paidCost, committedValue: financial.committedCost, consumedStockValue, cashMargin: financial.received - financial.paidCost },
    schedule: {
      expectedProgress, actualProgress, progressGap, plannedValue: schedule.plannedValue, executedValue: schedule.executedValue,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      phases: schedule.tasks.filter((task) => !task.parentId).map((task) => ({
        id: task.id, name: task.name, startDate: task.startDate, endDate: task.endDate, progress: task.progress, status: task.status,
      })),
    },
    stock: stock.slice(0, 8),
    alerts,
    operations: {
      nextAction,
      criticalCount: alerts.filter((alert) => alert.level === "critical").length,
      warningCount: alerts.filter((alert) => alert.level === "warning").length,
      lastDiaryDate,
      openPurchaseOrders: orders.filter((order) => order.status === "aprovado").length,
      pendingClientInvoices: clientInvoices.filter((invoice) => ["rascunho", "emitida", "parcial"].includes(invoice.status)).length,
      pendingSupplierInvoices: supplierBills.filter((invoice) => ["submetida", "em_revisao", "divergente", "aprovada", "parcialmente_paga"].includes(invoice.status)).length,
    },
  };
}
