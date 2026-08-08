import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  financialEntries,
  budgetDocuments,
  invoiceCreditNotes,
  invoiceReceipts,
  practiceInvoices,
  practiceReceipts,
  projectInvoices,
  supplierInvoiceCreditNotes,
  supplierInvoicePayments,
  supplierInvoices,
} from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { getBudgetDocumentSummary } from "../services/boqEngine.js";
import { CURRENCIES } from "@sigo/shared";
import { recordAuditEvent } from "../services/auditTrail.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

const entrySchema = z.object({
  type: z.enum(["receita", "despesa"]),
  category: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().positive(),
  currency: z.enum(CURRENCIES).default("MZN"),
  dueDate: z.string().optional(),
  paidDate: z.string().optional(),
  status: z.enum(["pendente", "pago"]).default("pendente"),
});
const entryUpdateSchema = entrySchema.partial();

async function assertEntryOwned(entryId: string, companyId: string) {
  const [entry] = await db.select().from(financialEntries).where(eq(financialEntries.id, entryId)).limit(1);
  if (!entry) return null;
  const project = await assertProjectOwned(entry.projectId, companyId);
  return project ? entry : null;
}

export async function financialRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/financial-entries", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.projectId, projectId))
      .orderBy(desc(financialEntries.dueDate), desc(financialEntries.createdAt));
  });

  app.post("/api/projects/:projectId/financial-entries", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = entrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { amount, ...rest } = parsed.data;
    const [row] = await db
      .insert(financialEntries)
      .values({ ...rest, projectId, amount: amount.toString(), createdByUserId: request.currentUser!.id })
      .returning();
    await recordAuditEvent({
      companyId: companyIdOf(request), projectId, actorUserId: request.currentUser!.id,
      entityType: "financial_entry", entityId: row.id, action: "created",
      after: { type: row.type, category: row.category, amount: row.amount, currency: row.currency, status: row.status, sourceType: row.sourceType },
    });
    return reply.code(201).send(row);
  });

  app.put("/api/financial-entries/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return reply.code(404).send({ error: "Lançamento não encontrado" });

    const parsed = entryUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (entry.sourceType === "supplier_invoice" && (parsed.data.status !== undefined || parsed.data.paidDate !== undefined)) {
      return reply.code(409).send({ error: "Registe pagamentos na factura do fornecedor; este lançamento é apenas o reflexo da conta a pagar" });
    }
    if (parsed.data.status === "pago" && entry.status !== "pago") {
      if (request.currentUser!.role !== "admin_empresa") {
        return reply.code(403).send({ error: "A baixa de um pagamento exige um administrador da empresa" });
      }
      if (!entry.sourceType && entry.createdByUserId === request.currentUser!.id) {
        return reply.code(409).send({ error: "Quem criou este lançamento não pode confirmar o seu próprio pagamento" });
      }
    }
    if (entry.sourceType && (parsed.data.type || parsed.data.category || parsed.data.description !== undefined || parsed.data.amount !== undefined || parsed.data.currency)) {
      return reply.code(409).send({ error: "O valor deste lançamento é sincronizado com o documento de origem; altere apenas o pagamento" });
    }
    const { amount, ...rest } = parsed.data;
    const [row] = await db
      .update(financialEntries)
      .set({ ...rest, amount: amount !== undefined ? amount.toString() : undefined })
      .where(eq(financialEntries.id, id))
      .returning();
    await recordAuditEvent({
      companyId: companyIdOf(request), projectId: entry.projectId, actorUserId: request.currentUser!.id,
      entityType: "financial_entry", entityId: id, action: "updated",
      before: { type: entry.type, category: entry.category, amount: entry.amount, currency: entry.currency, status: entry.status, dueDate: entry.dueDate, paidDate: entry.paidDate },
      after: { type: row.type, category: row.category, amount: row.amount, currency: row.currency, status: row.status, dueDate: row.dueDate, paidDate: row.paidDate },
    });
    return row;
  });

  app.delete("/api/financial-entries/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await assertEntryOwned(id, companyIdOf(request));
    if (!entry) return { ok: true };
    if (entry.sourceType) return reply.code(409).send({ error: "Lançamentos automáticos devem ser corrigidos no documento de origem" });
    await db.delete(financialEntries).where(eq(financialEntries.id, id));
    await recordAuditEvent({
      companyId: companyIdOf(request), projectId: entry.projectId, actorUserId: request.currentUser!.id,
      entityType: "financial_entry", entityId: id, action: "deleted",
      before: { type: entry.type, category: entry.category, amount: entry.amount, currency: entry.currency, status: entry.status },
    });
    return { ok: true };
  });

  // Resumo financeiro do projecto: valor contratado (do Mapa de Quantidades mais recente),
  // valor recebido/pago (lançamentos com status "pago"), contas a pagar/receber (lançamentos
  // "pendente"), saldo e margem operacional realizada. A margem aqui é sempre recebido − pago
  // com dinheiro real — não existe no sistema uma distinção entre "preço de venda" e "custo
  // interno" por item do orçamento, por isso não se calcula (nem se inventa) uma margem
  // "prevista" a partir do Mapa de Quantidades.
  app.get("/api/projects/:projectId/financial-summary", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, companyIdOf(request));
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const documents = await db
      .select()
      .from(budgetDocuments)
      .where(eq(budgetDocuments.projectId, projectId))
      .orderBy(desc(budgetDocuments.createdAt));
    const latestDocument = documents.find((document) => document.status === "aprovado" && document.currency === project.currency)
      ?? documents.find((document) => document.currency === project.currency);
    const summary = latestDocument ? await getBudgetDocumentSummary(latestDocument.id) : null;
    const valorContratado = summary?.total ?? 0;

    const [entries, invoices, commercialInvoices, supplierBills] = await Promise.all([
      db.select().from(financialEntries).where(eq(financialEntries.projectId, projectId)),
      db.select().from(projectInvoices).where(eq(projectInvoices.projectId, projectId)),
      db.select().from(practiceInvoices).where(eq(practiceInvoices.projectId, projectId)),
      db.select().from(supplierInvoices).where(eq(supplierInvoices.projectId, projectId)),
    ]);
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const commercialIds = commercialInvoices.map((invoice) => invoice.id);
    const supplierBillIds = supplierBills.map((invoice) => invoice.id);
    const [receipts, creditNotes, commercialReceipts, supplierPayments, supplierCredits] = await Promise.all([
      invoiceIds.length
        ? db.select().from(invoiceReceipts).where(inArray(invoiceReceipts.invoiceId, invoiceIds))
        : Promise.resolve([]),
      invoiceIds.length
        ? db.select().from(invoiceCreditNotes).where(inArray(invoiceCreditNotes.invoiceId, invoiceIds))
        : Promise.resolve([]),
      commercialIds.length
        ? db.select().from(practiceReceipts).where(inArray(practiceReceipts.invoiceId, commercialIds))
        : Promise.resolve([]),
      supplierBillIds.length
        ? db.select().from(supplierInvoicePayments).where(inArray(supplierInvoicePayments.supplierInvoiceId, supplierBillIds))
        : Promise.resolve([]),
      supplierBillIds.length
        ? db.select().from(supplierInvoiceCreditNotes).where(inArray(supplierInvoiceCreditNotes.supplierInvoiceId, supplierBillIds))
        : Promise.resolve([]),
    ]);

    let valorRecebido = 0;
    let custoRealizado = 0;
    let contasAReceber = 0;
    let contasAPagar = 0;
    let compromissosCompra = 0;
    const cashFlowByMonth = new Map<string, { receitas: number; despesas: number }>();

    for (const e of entries) {
      const amount = Number(e.amount);
      if (e.type === "receita") {
        // Facturas (obra e Comercial) têm lançamento de rastreio; o valor real vem dos recibos.
        if (e.sourceType === "invoice" || e.sourceType === "practice_invoice") continue;
        if (e.status === "pago") {
          valorRecebido += amount;
          const month = (e.paidDate ?? e.createdAt.toISOString().slice(0, 10)).slice(0, 7);
          const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
          bucket.receitas += amount;
          cashFlowByMonth.set(month, bucket);
        } else {
          contasAReceber += amount;
        }
      } else {
        // Fase 3: OC = compromisso; factura aprovada = conta a pagar. Os dois documentos não
        // podem entrar juntos nas contas a pagar/custo realizado, senão duplicam a mesma compra.
        if (e.sourceType === "purchase_order" || e.sourceType === "supplier_invoice") continue;
        if (e.status === "pago") {
          custoRealizado += amount;
          const month = (e.paidDate ?? e.createdAt.toISOString().slice(0, 10)).slice(0, 7);
          const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
          bucket.despesas += amount;
          cashFlowByMonth.set(month, bucket);
        } else {
          contasAPagar += amount;
        }
      }
    }

    // Facturas de fornecedor aprovadas têm pagamentos parciais próprios, tal como as facturas
    // ao cliente têm recibos. O tracking em financial_entries é ignorado no cálculo para não
    // transformar uma factura parcialmente paga num lançamento binário.
    const supplierPaymentsByInvoice = new Map<string, number>();
    const supplierCreditsByInvoice = new Map<string, number>();
    const approvedInvoiceNetByOrder = new Map<string, number>();
    for (const payment of supplierPayments) {
      supplierPaymentsByInvoice.set(payment.supplierInvoiceId, (supplierPaymentsByInvoice.get(payment.supplierInvoiceId) ?? 0) + Number(payment.amount));
      const invoice = supplierBills.find((row) => row.id === payment.supplierInvoiceId);
      if (!invoice || invoice.currency !== project.currency || ["rejeitada", "cancelada", "rascunho"].includes(invoice.status)) continue;
      const amount = Number(payment.amount);
      custoRealizado += amount;
      const month = payment.paymentDate.slice(0, 7);
      const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
      bucket.despesas += amount;
      cashFlowByMonth.set(month, bucket);
    }
    for (const credit of supplierCredits) {
      if (credit.status !== "aceite") continue;
      supplierCreditsByInvoice.set(credit.supplierInvoiceId, (supplierCreditsByInvoice.get(credit.supplierInvoiceId) ?? 0) + Number(credit.amount));
    }
    for (const invoice of supplierBills) {
      if (invoice.currency !== project.currency || !["aprovada", "parcialmente_paga", "paga"].includes(invoice.status)) continue;
      const net = Math.max(0, Number(invoice.totalAmount) - (supplierCreditsByInvoice.get(invoice.id) ?? 0));
      approvedInvoiceNetByOrder.set(invoice.purchaseOrderId, (approvedInvoiceNetByOrder.get(invoice.purchaseOrderId) ?? 0) + net);
      const paid = supplierPaymentsByInvoice.get(invoice.id) ?? 0;
      contasAPagar += Math.max(0, net - paid);
    }

    // Mantém o valor ainda comprometido por OCs mas não transformado em factura aprovada.
    // OCs legadas já marcadas como pagas continuam a contar como custo real apenas quando não
    // existe uma factura de fornecedor no novo fluxo para a mesma OC.
    for (const entry of entries.filter((row) => row.type === "despesa" && row.sourceType === "purchase_order")) {
      const orderId = entry.sourceId;
      if (!orderId) continue;
      const invoiced = approvedInvoiceNetByOrder.get(orderId) ?? 0;
      if (entry.status === "pendente") {
        compromissosCompra += Math.max(0, Number(entry.amount) - invoiced);
      } else if (entry.status === "pago" && invoiced <= 0) {
        const amount = Number(entry.amount);
        custoRealizado += amount;
        const month = (entry.paidDate ?? entry.createdAt.toISOString().slice(0, 10)).slice(0, 7);
        const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
        bucket.despesas += amount;
        cashFlowByMonth.set(month, bucket);
      }
    }
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const receiptsByInvoice = new Map<string, number>();
    const creditsByInvoice = new Map<string, number>();
    for (const receipt of receipts) {
      const invoice = invoiceById.get(receipt.invoiceId);
      if (!invoice || invoice.status === "cancelada" || invoice.currency !== project.currency) continue;
      const amount = Number(receipt.amount);
      receiptsByInvoice.set(receipt.invoiceId, (receiptsByInvoice.get(receipt.invoiceId) ?? 0) + amount);
      valorRecebido += amount;
      const month = receipt.receivedDate.slice(0, 7);
      const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
      bucket.receitas += amount;
      cashFlowByMonth.set(month, bucket);
    }
    for (const note of creditNotes) {
      if (note.status !== "emitida") continue;
      creditsByInvoice.set(note.invoiceId, (creditsByInvoice.get(note.invoiceId) ?? 0) + Number(note.amount));
    }
    for (const invoice of invoices) {
      if (invoice.status === "rascunho" || invoice.status === "cancelada" || invoice.currency !== project.currency) continue;
      contasAReceber += Math.max(0, Number(invoice.netAmount) - (creditsByInvoice.get(invoice.id) ?? 0) - (receiptsByInvoice.get(invoice.id) ?? 0));
    }

    const commercialById = new Map(commercialInvoices.map((invoice) => [invoice.id, invoice]));
    const commercialReceiptsByInvoice = new Map<string, number>();
    for (const receipt of commercialReceipts) {
      const invoice = commercialById.get(receipt.invoiceId);
      if (!invoice || invoice.status === "cancelada" || invoice.currency !== project.currency) continue;
      const amount = Number(receipt.amount);
      commercialReceiptsByInvoice.set(receipt.invoiceId, (commercialReceiptsByInvoice.get(receipt.invoiceId) ?? 0) + amount);
      valorRecebido += amount;
      const month = receipt.receivedDate.slice(0, 7);
      const bucket = cashFlowByMonth.get(month) ?? { receitas: 0, despesas: 0 };
      bucket.receitas += amount;
      cashFlowByMonth.set(month, bucket);
    }
    for (const invoice of commercialInvoices) {
      if (["rascunho", "cancelada"].includes(invoice.status) || invoice.currency !== project.currency) continue;
      contasAReceber += Math.max(0, Number(invoice.netAmount) - (commercialReceiptsByInvoice.get(invoice.id) ?? 0));
    }

    const fluxoCaixaMensal = Array.from(cashFlowByMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, receitas: v.receitas, despesas: v.despesas, saldo: v.receitas - v.despesas }));

    return {
      currency: project.currency,
      valorContratado,
      valorRecebido,
      custoRealizado,
      contasAReceber,
      contasAPagar,
      compromissosCompra,
      saldo: valorRecebido - custoRealizado,
      margemRealizada: valorRecebido - custoRealizado,
      fluxoCaixaMensal,
    };
  });
}
