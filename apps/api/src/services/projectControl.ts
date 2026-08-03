import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, financialEntries, materials, purchaseOrders, stockMovements } from "../db/schema.js";
import { getBudgetDocumentSummary } from "./boqEngine.js";
import { getProjectSchedule } from "./scheduleEngine.js";

type AlertLevel = "critical" | "warning" | "info";
type ControlAlert = { code: string; level: AlertLevel; title: string; detail: string; href: string };

function today() {
  return new Date().toISOString().slice(0, 10);
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
  const [documents, entries, movements, orders, schedule] = await Promise.all([
    db.select().from(budgetDocuments).where(eq(budgetDocuments.projectId, projectId)),
    db.select().from(financialEntries).where(eq(financialEntries.projectId, projectId)),
    db.select({ movement: stockMovements, materialName: materials.name, unit: materials.unit })
      .from(stockMovements)
      .innerJoin(materials, eq(stockMovements.materialId, materials.id))
      .where(eq(stockMovements.projectId, projectId)),
    db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, projectId)),
    getProjectSchedule(projectId),
  ]);

  const approvedDocument = documents.filter((document) => document.status === "aprovado" && document.documentType === "orcamento")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const budgetSummary = approvedDocument ? await getBudgetDocumentSummary(approvedDocument.id) : null;
  const contractedValue = budgetSummary?.total ?? 0;

  const financial = entries.filter((entry) => entry.currency === currency).reduce((acc, entry) => {
    const amount = Number(entry.amount);
    if (entry.type === "receita") {
      if (entry.status === "pago") acc.received += amount;
      else acc.receivable += amount;
      if (entry.sourceType === "measurement_certificate") acc.certified += amount;
    } else {
      if (entry.status === "pago") acc.paidCost += amount;
      else acc.committedCost += amount;
    }
    return acc;
  }, { received: 0, receivable: 0, certified: 0, paidCost: 0, committedCost: 0 });

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
  if (expectedProgress >= 10 && progressGap <= -10) alerts.push({ code: "schedule_delay", level: "warning", title: "Execução abaixo do planeado", detail: `Previsto ${expectedProgress.toFixed(1)}%; realizado ${actualProgress.toFixed(1)}%.`, href: `/projectos/${projectId}/cronograma` });
  if (contractedValue > 0 && financial.paidCost > contractedValue) alerts.push({ code: "cost_over_contract", level: "critical", title: "Custo pago acima do contrato", detail: "Os pagamentos de despesa já ultrapassaram o valor contratado.", href: `/projectos/${projectId}/financeiro` });
  const overdueOrders = orders.filter((order) => order.status === "aprovado" && order.requiredByDate && order.requiredByDate < date);
  if (overdueOrders.length) alerts.push({ code: "purchase_overdue", level: "warning", title: "Compras em atraso", detail: `${overdueOrders.length} ordem(ns) aprovada(s) ultrapassou(aram) a data necessária.`, href: `/projectos/${projectId}/compras` });
  const exhausted = stock.filter((item) => item.consumedQty > 0 && item.balance <= 0);
  if (exhausted.length) alerts.push({ code: "stock_exhausted", level: "warning", title: "Material sem saldo", detail: `${exhausted.slice(0, 2).map((item) => item.materialName).join(", ")}${exhausted.length > 2 ? " e outros" : ""}.`, href: `/projectos/${projectId}/compras` });
  if (financial.certified > financial.received + 0.01) alerts.push({ code: "certified_unpaid", level: "info", title: "Autos por receber", detail: "Existem autos aprovados ainda não recebidos financeiramente.", href: `/projectos/${projectId}/financeiro` });

  return {
    currency,
    basis: { approvedBudgetDocumentId: approvedDocument?.id ?? null, referenceDate: date, stockConsumptionEstimated: stock.some((item) => item.estimatedCost) },
    commercial: { contractedValue, certifiedValue: financial.certified, receivedValue: financial.received, receivableValue: financial.receivable },
    cost: { paidValue: financial.paidCost, committedValue: financial.committedCost, consumedStockValue, cashMargin: financial.received - financial.paidCost },
    schedule: { expectedProgress, actualProgress, progressGap, plannedValue: schedule.plannedValue, executedValue: schedule.executedValue },
    stock: stock.slice(0, 8),
    alerts,
  };
}
