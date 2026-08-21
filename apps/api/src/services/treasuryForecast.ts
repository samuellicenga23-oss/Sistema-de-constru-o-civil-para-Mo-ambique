import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  financialEntries,
  projectClientPaymentInstallments,
  projectClientPaymentPlans,
  projectInvoices,
  purchaseOrders,
  supplierInvoices,
} from "../db/schema.js";

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

export async function buildTreasuryForecast(projectId: string, currency: string): Promise<TreasuryForecastLine[]> {
  const lines: TreasuryForecastLine[] = [];

  const [plan] = await db.select().from(projectClientPaymentPlans).where(eq(projectClientPaymentPlans.projectId, projectId)).limit(1);
  if (plan) {
    const installments = await db
      .select()
      .from(projectClientPaymentInstallments)
      .where(and(eq(projectClientPaymentInstallments.planId, plan.id), inArray(projectClientPaymentInstallments.status, ["prevista", "parcial"])));
    for (const row of installments) {
      const outstanding = Math.max(0, Number(row.amount) - Number(row.paidAmount));
      if (outstanding <= 0) continue;
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

  const invoices = await db
    .select()
    .from(projectInvoices)
    .where(and(eq(projectInvoices.projectId, projectId), inArray(projectInvoices.status, ["emitida", "parcial"])));
  for (const invoice of invoices) {
    lines.push({
      id: invoice.id,
      kind: "receita",
      source: "invoice",
      label: `Factura ${invoice.invoiceNumber ?? "sem nº"}`,
      dueDate: invoice.dueDate,
      amount: Number(invoice.netAmount),
      currency: invoice.currency,
      confidence: "alta",
    });
  }

  const supplierBills = await db
    .select()
    .from(supplierInvoices)
    .where(and(eq(supplierInvoices.projectId, projectId), inArray(supplierInvoices.status, ["aprovada", "parcialmente_paga", "submetida"])));
  for (const bill of supplierBills) {
    lines.push({
      id: bill.id,
      kind: "despesa",
      source: "supplier_invoice",
      label: `Factura fornecedor ${bill.invoiceNumber ?? bill.id.slice(0, 8)}`,
      dueDate: bill.dueDate,
      amount: Number(bill.totalAmount ?? 0),
      currency: bill.currency ?? currency,
      confidence: "alta",
    });
  }

  const pos = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseOrders.status, "aprovado")));
  for (const po of pos) {
    lines.push({
      id: po.id,
      kind: "despesa",
      source: "purchase_order",
      label: `OC ${po.id.slice(0, 8)}`,
      dueDate: po.requiredByDate ?? po.promisedDeliveryDate,
      amount: Number(po.transportCost ?? 0),
      currency,
      confidence: "baixa",
    });
  }

  const pendingEntries = await db
    .select()
    .from(financialEntries)
    .where(and(eq(financialEntries.projectId, projectId), eq(financialEntries.status, "pendente")));
  for (const entry of pendingEntries) {
    if (entry.sourceType === "invoice" || entry.sourceType === "supplier_invoice") continue;
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

  return lines.filter((line) => line.currency === currency);
}
