import { and, eq, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, financialEntries, invoiceCreditNotes, invoiceReceipts, measurementCertificateLines, measurementCertificates, projectInvoices, projects } from "../db/schema.js";
import { calculateBudgetTotals } from "./budgetTotals.js";

export async function createDraftInvoiceForCertificate(certificateId: string, actorUserId: string) {
  const [existing] = await db.select().from(projectInvoices).where(eq(projectInvoices.measurementCertificateId, certificateId)).limit(1);
  if (existing) return existing;
  const [certificate] = await db.select().from(measurementCertificates).where(eq(measurementCertificates.id, certificateId)).limit(1);
  if (!certificate) throw new Error("Auto de medição não encontrado");
  const [[document], [project], lines] = await Promise.all([
    db.select().from(budgetDocuments).where(eq(budgetDocuments.id, certificate.budgetDocumentId)).limit(1),
    db.select().from(projects).where(eq(projects.id, certificate.projectId)).limit(1),
    db.select({ qty: measurementCertificateLines.periodQty }).from(measurementCertificateLines).where(eq(measurementCertificateLines.certificateId, certificateId)),
  ]);
  if (!document || !project) throw new Error("Dados comerciais do Auto não encontrados");
  // O valor do Auto é calculado pela mesma origem da emissão financeira: linhas já trazem o
  // valor do período no motor de medição, mas a factura congela o total comercial no momento da aprovação.
  const { getCertificateDetail } = await import("./measurementEngine.js");
  const detail = await getCertificateDetail(certificateId);
  const periodSubtotal = detail?.lines.reduce((total, line) => total + line.periodValue, 0) ?? lines.reduce((total, line) => total + Number(line.qty), 0);
  const grossAmount = calculateBudgetTotals(periodSubtotal, {
    siteCostsRate: Number(document.siteCostsRate), indirectCostsRate: Number(document.indirectCostsRate),
    contingenciasRate: Number(document.contingenciasRate), profitMarginRate: Number(document.profitMarginRate), ivaRate: Number(document.ivaRate),
  }).total;
  const [invoice] = await db.insert(projectInvoices).values({
    projectId: certificate.projectId, measurementCertificateId: certificateId, clientName: project.client,
    grossAmount: grossAmount.toFixed(2), ivaRate: document.ivaRate, netAmount: grossAmount.toFixed(2),
    currency: document.currency, createdByUserId: actorUserId,
  }).returning();
  return invoice;
}

export async function invoicePaidAmount(invoiceId: string) {
  const [row] = await db.select({ value: sum(invoiceReceipts.amount) }).from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, invoiceId));
  return Number(row?.value ?? 0);
}

export async function invoiceCreditAmount(invoiceId: string) {
  const rows = await db.select().from(invoiceCreditNotes).where(and(eq(invoiceCreditNotes.invoiceId, invoiceId), eq(invoiceCreditNotes.status, "emitida")));
  return rows.reduce((total, row) => total + Number(row.amount), 0);
}

export async function invoiceEffectiveAmount(invoiceId: string, netAmount: number) {
  return Math.max(0, netAmount - await invoiceCreditAmount(invoiceId));
}

export async function syncInvoiceReceivable(invoiceId: string) {
  const [invoice] = await db.select().from(projectInvoices).where(eq(projectInvoices.id, invoiceId)).limit(1);
  if (!invoice || invoice.status === "rascunho" || invoice.status === "cancelada") return;
  const paid = await invoicePaidAmount(invoiceId);
  const effectiveAmount = await invoiceEffectiveAmount(invoiceId, Number(invoice.netAmount));
  const outstanding = Math.max(0, effectiveAmount - paid);
  const [entry] = await db.select().from(financialEntries).where(and(eq(financialEntries.projectId, invoice.projectId), eq(financialEntries.sourceType, "invoice"), eq(financialEntries.sourceId, invoiceId))).limit(1);
  if (outstanding <= 0) {
    if (entry) await db.update(financialEntries).set({ status: "pago", paidDate: new Date().toISOString().slice(0, 10) }).where(eq(financialEntries.id, entry.id));
    return;
  }
  if (!entry) await db.insert(financialEntries).values({
    projectId: invoice.projectId, type: "receita", category: "Factura emitida", description: `Factura ${invoice.invoiceNumber ?? "sem número"}`,
    amount: effectiveAmount.toFixed(2), currency: invoice.currency, dueDate: invoice.dueDate ?? invoice.issueDate, status: "pendente", sourceType: "invoice", sourceId: invoice.id, createdByUserId: invoice.issuedByUserId,
  });
  else await db.update(financialEntries).set({ amount: effectiveAmount.toFixed(2), status: outstanding <= 0 ? "pago" : "pendente" }).where(eq(financialEntries.id, entry.id));
}
