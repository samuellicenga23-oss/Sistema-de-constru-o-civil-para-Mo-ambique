import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  financialEntries,
  invoiceCreditNotes,
  invoiceReceipts,
  projectClientPaymentInstallments,
  projectClientPaymentPlans,
  projectInvoices,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoiceCreditNotes,
  supplierInvoicePayments,
  supplierInvoices,
} from "../db/schema.js";
import {
  calculateOutstandingBalance,
  calculatePurchaseOrderForecastTotal,
  calculateRemainingCommitment,
} from "./treasuryForecastMath.js";

export type TreasuryForecastLine = {
  id: string;
  kind: "receita" | "despesa";
  source: string;
  label: string;
  dueDate: string | null;
  amount: number;
  currency: string;
  confidence: "alta" | "media" | "baixa";
};

const ACTIVE_CLIENT_INVOICE_STATUSES = new Set(["emitida", "parcial", "paga"]);
const SUPPLIER_INVOICE_PIPELINE_STATUSES = new Set([
  "submetida",
  "em_revisao",
  "divergente",
  "aprovada",
  "parcialmente_paga",
  "paga",
]);
const HIGH_CONFIDENCE_SUPPLIER_STATUSES = new Set(["aprovada", "parcialmente_paga"]);
const COMMITTED_ORDER_STATUSES = new Set(["aprovado", "recebido"]);
const AUTOMATIC_FINANCIAL_SOURCES = new Set(["invoice", "supplier_invoice", "purchase_order"]);

export async function buildTreasuryForecast(projectId: string, currency: string): Promise<TreasuryForecastLine[]> {
  const lines: TreasuryForecastLine[] = [];

  // ---------- Receitas: factura real prevalece sobre parcela planeada ligada à factura ----------
  const clientInvoices = await db.select().from(projectInvoices).where(eq(projectInvoices.projectId, projectId));
  const clientInvoiceIds = clientInvoices.map((invoice) => invoice.id);
  const [clientReceipts, clientCredits] = await Promise.all([
    clientInvoiceIds.length
      ? db.select().from(invoiceReceipts).where(inArray(invoiceReceipts.invoiceId, clientInvoiceIds))
      : Promise.resolve([]),
    clientInvoiceIds.length
      ? db.select().from(invoiceCreditNotes).where(inArray(invoiceCreditNotes.invoiceId, clientInvoiceIds))
      : Promise.resolve([]),
  ]);

  const receivedByClientInvoice = new Map<string, number>();
  for (const receipt of clientReceipts) {
    receivedByClientInvoice.set(receipt.invoiceId, (receivedByClientInvoice.get(receipt.invoiceId) ?? 0) + Number(receipt.amount));
  }
  const creditByClientInvoice = new Map<string, number>();
  for (const credit of clientCredits) {
    if (credit.status !== "emitida") continue;
    creditByClientInvoice.set(credit.invoiceId, (creditByClientInvoice.get(credit.invoiceId) ?? 0) + Number(credit.amount));
  }

  const activeClientInvoiceIds = new Set<string>();
  for (const invoice of clientInvoices) {
    if (!ACTIVE_CLIENT_INVOICE_STATUSES.has(invoice.status)) continue;
    activeClientInvoiceIds.add(invoice.id);
    if (invoice.status === "paga") continue;
    const outstanding = calculateOutstandingBalance(
      Number(invoice.netAmount),
      creditByClientInvoice.get(invoice.id) ?? 0,
      receivedByClientInvoice.get(invoice.id) ?? 0,
    );
    if (outstanding <= 0.005) continue;
    lines.push({
      id: invoice.id,
      kind: "receita",
      source: "invoice",
      label: `Factura ${invoice.invoiceNumber ?? "sem nº"}`,
      dueDate: invoice.dueDate,
      amount: outstanding,
      currency: invoice.currency,
      confidence: "alta",
    });
  }

  const [plan] = await db.select().from(projectClientPaymentPlans).where(eq(projectClientPaymentPlans.projectId, projectId)).limit(1);
  if (plan) {
    const installments = await db
      .select()
      .from(projectClientPaymentInstallments)
      .where(and(eq(projectClientPaymentInstallments.planId, plan.id), inArray(projectClientPaymentInstallments.status, ["prevista", "parcial"])));
    for (const row of installments) {
      // Uma factura ligada é evidência mais forte que a parcela prevista; não contar as duas.
      if (row.invoiceId && activeClientInvoiceIds.has(row.invoiceId)) continue;
      const outstanding = calculateOutstandingBalance(Number(row.amount), 0, Number(row.paidAmount));
      if (outstanding <= 0.005) continue;
      lines.push({
        id: row.id,
        kind: "receita",
        source: "client_installment",
        label: row.title,
        dueDate: row.dueDate,
        amount: outstanding,
        currency: plan.currency,
        confidence: "media",
      });
    }
  }

  // ---------- Despesas: factura fornecedor prevalece; OC entra apenas pelo compromisso não facturado ----------
  const supplierBills = await db.select().from(supplierInvoices).where(eq(supplierInvoices.projectId, projectId));
  const supplierBillIds = supplierBills.map((bill) => bill.id);
  const [supplierPayments, supplierCredits] = await Promise.all([
    supplierBillIds.length
      ? db.select().from(supplierInvoicePayments).where(inArray(supplierInvoicePayments.supplierInvoiceId, supplierBillIds))
      : Promise.resolve([]),
    supplierBillIds.length
      ? db.select().from(supplierInvoiceCreditNotes).where(inArray(supplierInvoiceCreditNotes.supplierInvoiceId, supplierBillIds))
      : Promise.resolve([]),
  ]);

  const paidBySupplierInvoice = new Map<string, number>();
  for (const payment of supplierPayments) {
    paidBySupplierInvoice.set(payment.supplierInvoiceId, (paidBySupplierInvoice.get(payment.supplierInvoiceId) ?? 0) + Number(payment.amount));
  }
  const creditBySupplierInvoice = new Map<string, number>();
  for (const credit of supplierCredits) {
    if (credit.status !== "aceite") continue;
    creditBySupplierInvoice.set(credit.supplierInvoiceId, (creditBySupplierInvoice.get(credit.supplierInvoiceId) ?? 0) + Number(credit.amount));
  }

  const grossInvoicedByOrder = new Map<string, number>();
  for (const bill of supplierBills) {
    if (!SUPPLIER_INVOICE_PIPELINE_STATUSES.has(bill.status)) continue;
    // A factura cobre a parcela correspondente da OC mesmo quando depois recebe nota de crédito;
    // o crédito reduz AP, não recria artificialmente compromisso "não facturado" da OC.
    if (bill.currency === currency) {
      grossInvoicedByOrder.set(bill.purchaseOrderId, (grossInvoicedByOrder.get(bill.purchaseOrderId) ?? 0) + Number(bill.totalAmount ?? 0));
    }
    if (bill.status === "paga") continue;
    const outstanding = calculateOutstandingBalance(
      Number(bill.totalAmount ?? 0),
      creditBySupplierInvoice.get(bill.id) ?? 0,
      paidBySupplierInvoice.get(bill.id) ?? 0,
    );
    if (outstanding <= 0.005) continue;
    lines.push({
      id: bill.id,
      kind: "despesa",
      source: "supplier_invoice",
      label: `Factura fornecedor ${bill.invoiceNumber ?? bill.id.slice(0, 8)}`,
      dueDate: bill.dueDate,
      amount: outstanding,
      currency: bill.currency ?? currency,
      confidence: HIGH_CONFIDENCE_SUPPLIER_STATUSES.has(bill.status) ? "alta" : "media",
    });
  }

  const orders = await db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, projectId));
  const committedOrders = orders.filter((order) => COMMITTED_ORDER_STATUSES.has(order.status));
  const committedOrderIds = committedOrders.map((order) => order.id);
  const orderLines = committedOrderIds.length
    ? await db.select().from(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, committedOrderIds))
    : [];
  const linesByOrder = new Map<string, Array<typeof purchaseOrderLines.$inferSelect>>();
  for (const orderLine of orderLines) {
    const group = linesByOrder.get(orderLine.purchaseOrderId) ?? [];
    group.push(orderLine);
    linesByOrder.set(orderLine.purchaseOrderId, group);
  }

  for (const order of committedOrders) {
    const committedTotal = calculatePurchaseOrderForecastTotal(order, linesByOrder.get(order.id) ?? []);
    const remainingCommitment = calculateRemainingCommitment(committedTotal, grossInvoicedByOrder.get(order.id) ?? 0);
    if (remainingCommitment <= 0.005) continue;
    lines.push({
      id: order.id,
      kind: "despesa",
      source: "purchase_order",
      label: `OC ${order.id.slice(0, 8)}`,
      dueDate: order.promisedDeliveryDate ?? order.requiredByDate ?? order.orderDate,
      amount: remainingCommitment,
      currency,
      confidence: "media",
    });
  }

  // Lançamentos manuais/independentes continuam no forecast. Reflexos automáticos dos
  // documentos acima são excluídos para não duplicar factura, OC ou conta a pagar.
  const pendingEntries = await db
    .select()
    .from(financialEntries)
    .where(and(eq(financialEntries.projectId, projectId), eq(financialEntries.status, "pendente")));
  for (const entry of pendingEntries) {
    if (entry.sourceType && AUTOMATIC_FINANCIAL_SOURCES.has(entry.sourceType)) continue;
    lines.push({
      id: entry.id,
      kind: entry.type,
      source: entry.sourceType ?? "manual",
      label: entry.description ?? entry.category,
      dueDate: entry.dueDate,
      amount: Number(entry.amount),
      currency: entry.currency,
      confidence: "media",
    });
  }

  // Sem snapshot cambial não fazemos conversões implícitas. A consolidação desta rota mantém
  // apenas a moeda pedida; moedas diferentes devem ser tratadas quando existir evidência FX.
  return lines.filter((line) => line.currency === currency && line.amount > 0.005);
}
