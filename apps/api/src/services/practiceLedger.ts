import { and, eq, sum } from "drizzle-orm";
import { db } from "../db/index.js";
import { financialEntries, practiceInvoices, practiceReceipts, projects } from "../db/schema.js";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

const SOURCE_TYPE = "practice_invoice";

/**
 * Espelha facturas Comercial no ledger da obra quando há projectId.
 * Contratos só-escritório (sem obra) não geram lançamentos — evita dupla contagem
 * e mantém o financeiro da obra alinhado com Autos/OC.
 */
export async function syncPracticeInvoiceReceivable(invoiceId: string, executor: DbExecutor = db) {
  const [invoice] = await executor
    .select()
    .from(practiceInvoices)
    .where(eq(practiceInvoices.id, invoiceId))
    .limit(1);
  if (!invoice?.projectId) return;

  const [project] = await executor
    .select({ id: projects.id, currency: projects.currency })
    .from(projects)
    .where(eq(projects.id, invoice.projectId))
    .limit(1);
  if (!project) return;

  const [entry] = await executor
    .select()
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.projectId, invoice.projectId),
        eq(financialEntries.sourceType, SOURCE_TYPE),
        eq(financialEntries.sourceId, invoiceId),
      ),
    )
    .limit(1);

  if (invoice.status === "rascunho" || invoice.status === "cancelada") {
    if (entry) await executor.delete(financialEntries).where(eq(financialEntries.id, entry.id));
    return;
  }

  // Moeda diferente da obra: não misturar no ledger filtrado por project.currency.
  if (invoice.currency !== project.currency) {
    if (entry) await executor.delete(financialEntries).where(eq(financialEntries.id, entry.id));
    return;
  }

  const [paidRow] = await executor
    .select({ value: sum(practiceReceipts.amount) })
    .from(practiceReceipts)
    .where(eq(practiceReceipts.invoiceId, invoiceId));
  const paid = Number(paidRow?.value ?? 0);
  const net = Number(invoice.netAmount);
  const outstanding = Math.max(0, net - paid);

  const description = `Factura Comercial ${invoice.invoiceNumber ?? "sem número"} · ${invoice.clientName}`;
  const dueDate = invoice.dueDate ?? invoice.issueDate;

  if (outstanding <= 0.009) {
    if (entry) {
      await executor
        .update(financialEntries)
        .set({
          amount: net.toFixed(2),
          description,
          dueDate,
          status: "pago",
          paidDate: new Date().toISOString().slice(0, 10),
        })
        .where(eq(financialEntries.id, entry.id));
    } else {
      await executor.insert(financialEntries).values({
        projectId: invoice.projectId,
        type: "receita",
        category: "Factura Comercial",
        description,
        amount: net.toFixed(2),
        currency: invoice.currency,
        dueDate,
        paidDate: new Date().toISOString().slice(0, 10),
        status: "pago",
        sourceType: SOURCE_TYPE,
        sourceId: invoice.id,
        createdByUserId: invoice.createdByUserId,
      });
    }
    return;
  }

  if (!entry) {
    await executor.insert(financialEntries).values({
      projectId: invoice.projectId,
      type: "receita",
      category: "Factura Comercial",
      description,
      amount: net.toFixed(2),
      currency: invoice.currency,
      dueDate,
      status: "pendente",
      sourceType: SOURCE_TYPE,
      sourceId: invoice.id,
      createdByUserId: invoice.createdByUserId,
    });
  } else {
    await executor
      .update(financialEntries)
      .set({
        amount: net.toFixed(2),
        description,
        dueDate,
        status: "pendente",
        paidDate: null,
      })
      .where(eq(financialEntries.id, entry.id));
  }
}
