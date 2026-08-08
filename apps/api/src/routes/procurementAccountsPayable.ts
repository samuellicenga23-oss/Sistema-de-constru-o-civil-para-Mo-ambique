import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  companies,
  financialEntries,
  goodsReceiptLines,
  goodsReceipts,
  materials,
  procurementDocumentSequences,
  procurementGoodsReturns,
  procurementNonconformities,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoiceCreditNotes,
  supplierInvoiceLines,
  supplierInvoicePayments,
  supplierInvoices,
  suppliers,
  users,
} from "../db/schema.js";
import { requireCompanyUser, requirePermission } from "../auth/middleware.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { notifySupplierAccount, notifyUsers } from "../services/notifications.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import {
  computePayableBalance,
  computeThreeWayMatch,
  shouldReserveInvoice,
  validateGoodsReturn,
  validateNonconformityResolution,
  type NonconformityResolution,
  type PurchaseOrderMatchLine,
  type SupplierInvoiceMatchLine,
  type ThreeWayMatchResult,
} from "../services/procurementAccountsPayable.js";

const reviewPermission = requirePermission("materiais.aprovar");
const receivePermission = requirePermission("materiais.requisitar", "materiais.aprovar");
const ACTIVE_INVOICE_STATUSES = new Set(["submetida", "em_revisao", "divergente", "aprovada", "parcialmente_paga", "paga"]);
const PAYABLE_INVOICE_STATUSES = new Set(["aprovada", "parcialmente_paga", "paga"]);

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

function isFinanceApprover(request: FastifyRequest): boolean {
  const role = request.currentUser!.role;
  return role === "admin_empresa" || role === "super_admin";
}

async function nextReference(tx: any, companyId: string, kind: "DEV") {
  const year = new Date().getUTCFullYear();
  const [row] = await tx
    .insert(procurementDocumentSequences)
    .values({ companyId, kind, year, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [procurementDocumentSequences.companyId, procurementDocumentSequences.kind, procurementDocumentSequences.year],
      set: { nextNumber: sql`${procurementDocumentSequences.nextNumber} + 1` },
    })
    .returning({ nextNumber: procurementDocumentSequences.nextNumber });
  return `${kind}-${year}-${String(Math.max(1, row.nextNumber - 1)).padStart(4, "0")}`;
}

async function supplierIdsOwnedByAccount(accountId: string) {
  const rows = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.supplierAccountId, accountId));
  return rows.map((row) => row.id);
}

async function supplierOrder(orderId: string, supplierAccountId: string) {
  const supplierIds = await supplierIdsOwnedByAccount(supplierAccountId);
  if (!supplierIds.length) return null;
  const [row] = await db
    .select({ order: purchaseOrders, supplierName: suppliers.name, companyId: projects.companyId, companyName: companies.name, projectName: projects.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .innerJoin(projects, eq(purchaseOrders.projectId, projects.id))
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(and(eq(purchaseOrders.id, orderId), inArray(purchaseOrders.supplierId, supplierIds)))
    .limit(1);
  return row ?? null;
}

async function buyerInvoice(invoiceId: string, companyId: string) {
  const [row] = await db
    .select({ invoice: supplierInvoices, supplierName: suppliers.name, projectCompanyId: projects.companyId, projectName: projects.name })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .innerJoin(projects, eq(supplierInvoices.projectId, projects.id))
    .where(and(eq(supplierInvoices.id, invoiceId), eq(projects.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function supplierInvoiceOwned(invoiceId: string, supplierAccountId: string) {
  const supplierIds = await supplierIdsOwnedByAccount(supplierAccountId);
  if (!supplierIds.length) return null;
  const [row] = await db
    .select({ invoice: supplierInvoices, supplierName: suppliers.name, companyName: companies.name, projectName: projects.name })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .innerJoin(projects, eq(supplierInvoices.projectId, projects.id))
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(and(eq(supplierInvoices.id, invoiceId), inArray(supplierInvoices.supplierId, supplierIds)))
    .limit(1);
  return row ?? null;
}

async function loadAcceptedQtyByOrderLine(executor: any, orderId: string) {
  const rows = await executor
    .select({ purchaseOrderLineId: goodsReceiptLines.purchaseOrderLineId, acceptedQty: goodsReceiptLines.acceptedQty, status: goodsReceipts.status })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceiptLines.goodsReceiptId, goodsReceipts.id))
    .where(eq(goodsReceipts.purchaseOrderId, orderId));
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.status !== "confirmado") continue;
    result[row.purchaseOrderLineId] = (result[row.purchaseOrderLineId] ?? 0) + Number(row.acceptedQty);
  }
  return result;
}

async function loadInvoiceReservations(executor: any, orderId: string, excludeInvoiceId?: string, currentCreatedAt?: Date) {
  const invoices = await executor.select().from(supplierInvoices).where(eq(supplierInvoices.purchaseOrderId, orderId));
  const active = invoices.filter((invoice: any) => shouldReserveInvoice({
    candidateId: invoice.id,
    candidateStatus: invoice.status,
    candidateCreatedAt: invoice.createdAt,
    excludeInvoiceId,
    currentCreatedAt,
  }));
  const ids = active.map((invoice: any) => invoice.id);
  const lines = ids.length ? await executor.select().from(supplierInvoiceLines).where(inArray(supplierInvoiceLines.supplierInvoiceId, ids)) : [];
  const qtyByLine: Record<string, number> = {};
  for (const line of lines) qtyByLine[line.purchaseOrderLineId] = (qtyByLine[line.purchaseOrderLineId] ?? 0) + Number(line.quantity);
  const transport = active.reduce((sum: number, invoice: any) => sum + Number(invoice.transportCost), 0);
  return { qtyByLine, transport };
}

async function loadOrderMatchLines(executor: any, orderId: string): Promise<PurchaseOrderMatchLine[]> {
  const rows = await executor
    .select({ line: purchaseOrderLines, materialName: materials.name })
    .from(purchaseOrderLines)
    .innerJoin(materials, eq(purchaseOrderLines.materialId, materials.id))
    .where(eq(purchaseOrderLines.purchaseOrderId, orderId));
  return rows.map(({ line, materialName }: any) => ({
    id: line.id,
    materialId: line.materialId,
    description: materialName,
    orderedQty: Number(line.quantity),
    unitCost: Number(line.unitCost),
    currency: line.currency,
  }));
}

async function computeInvoiceMatch(executor: any, invoice: typeof supplierInvoices.$inferSelect): Promise<ThreeWayMatchResult> {
  const [order, poLines, acceptedQtyByLine, reservations, invoiceLines] = await Promise.all([
    executor.select().from(purchaseOrders).where(eq(purchaseOrders.id, invoice.purchaseOrderId)).limit(1).then((rows: any[]) => rows[0]),
    loadOrderMatchLines(executor, invoice.purchaseOrderId),
    loadAcceptedQtyByOrderLine(executor, invoice.purchaseOrderId),
    loadInvoiceReservations(executor, invoice.purchaseOrderId, invoice.id, invoice.createdAt),
    executor.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.supplierInvoiceId, invoice.id)),
  ]);
  if (!order) throw new Error("Ordem de compra não encontrada");
  return computeThreeWayMatch({
    poLines,
    acceptedQtyByLine,
    previouslyInvoicedQtyByLine: reservations.qtyByLine,
    invoiceLines: invoiceLines.map((line: any): SupplierInvoiceMatchLine => ({ purchaseOrderLineId: line.purchaseOrderLineId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
    poTransportCost: Number(order.transportCost ?? 0),
    previouslyInvoicedTransport: reservations.transport,
    invoiceTransportCost: Number(invoice.transportCost),
    poIvaRate: Number(order.ivaRate),
    invoiceIvaRate: Number(invoice.ivaRate),
  });
}

async function loadInvoiceDetail(invoice: typeof supplierInvoices.$inferSelect) {
  const [lines, payments, credits, match] = await Promise.all([
    db.select({ line: supplierInvoiceLines, materialName: materials.name }).from(supplierInvoiceLines).innerJoin(materials, eq(supplierInvoiceLines.materialId, materials.id)).where(eq(supplierInvoiceLines.supplierInvoiceId, invoice.id)),
    db.select().from(supplierInvoicePayments).where(eq(supplierInvoicePayments.supplierInvoiceId, invoice.id)).orderBy(desc(supplierInvoicePayments.paymentDate)),
    db.select().from(supplierInvoiceCreditNotes).where(eq(supplierInvoiceCreditNotes.supplierInvoiceId, invoice.id)).orderBy(desc(supplierInvoiceCreditNotes.createdAt)),
    computeInvoiceMatch(db, invoice),
  ]);
  const balance = computePayableBalance({
    grossAmount: Number(invoice.totalAmount),
    payments: payments.map((payment) => Number(payment.amount)),
    acceptedCreditNotes: credits.filter((credit) => credit.status === "aceite").map((credit) => Number(credit.amount)),
  });
  return { ...invoice, lines: lines.map(({ line, materialName }) => ({ ...line, materialName })), payments, creditNotes: credits, currentMatch: match, balance };
}

async function notifyBuyerTeam(projectId: string, title: string, body: string) {
  const [project] = await db.select({ companyId: projects.companyId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return;
  const recipients = await db.select({ id: users.id, role: users.role, permissions: users.permissions }).from(users).where(and(eq(users.companyId, project.companyId), eq(users.isActive, true)));
  const ids = recipients.filter((row) => row.role === "admin_empresa" || row.role === "orcamentista" || row.permissions.includes("materiais.aprovar")).map((row) => row.id);
  await notifyUsers(ids, title, body, `/projectos/${projectId}/compras`);
}

const invoiceInput = z.object({
  invoiceNumber: z.string().trim().min(1).max(120),
  issueDate: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  ivaRate: z.number().min(0).max(1),
  transportCost: z.number().nonnegative().default(0),
  notes: z.string().trim().max(5000).optional(),
  lines: z.array(z.object({ purchaseOrderLineId: z.string().uuid(), quantity: z.number().positive(), unitCost: z.number().nonnegative() })).min(1).max(300),
});
const rejectInput = z.object({ reason: z.string().trim().min(5).max(3000) });
const approvalInput = z.object({ varianceReason: z.string().trim().min(8).max(4000).optional(), buyerNotes: z.string().trim().max(4000).optional() });
const paymentInput = z.object({ amount: z.number().positive(), paymentDate: z.string().min(1), method: z.string().trim().min(1).max(50).default("transferencia"), reference: z.string().trim().max(160).optional(), notes: z.string().trim().max(3000).optional() });
const creditNoteInput = z.object({ creditNumber: z.string().trim().min(1).max(120), issueDate: z.string().min(1), amount: z.number().positive(), reason: z.string().trim().min(5).max(3000), nonconformityId: z.string().uuid().optional().nullable() });
const ncrResponseInput = z.object({ resolutionType: z.enum(["substituicao", "nota_credito", "devolucao", "aceite_com_desconto", "outro"]), replacementQty: z.number().positive().optional(), creditAmount: z.number().positive().optional(), response: z.string().trim().min(5).max(4000) });
const resolveInput = z.object({ notes: z.string().trim().min(5).max(4000) });
const returnInput = z.object({ quantity: z.number().positive(), returnDate: z.string().min(1), reason: z.string().trim().min(5).max(3000), trackingReference: z.string().trim().max(160).optional() });

export async function procurementAccountsPayableRoutes(app: FastifyInstance) {
  // ---------- Portal do fornecedor: facturas ----------
  app.get("/api/supplier/purchase-orders/:id/invoicing-context", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await supplierOrder(id, request.currentSupplier!.id);
    if (!row || !["aprovado", "recebido"].includes(row.order.status)) return reply.code(404).send({ error: "Ordem de compra não disponível para facturação" });
    const [poLines, accepted, reservations] = await Promise.all([loadOrderMatchLines(db, id), loadAcceptedQtyByOrderLine(db, id), loadInvoiceReservations(db, id)]);
    return {
      order: row.order,
      supplierName: row.supplierName,
      companyName: row.companyName,
      projectName: row.projectName,
      lines: poLines.map((line) => ({ ...line, acceptedQty: accepted[line.id] ?? 0, alreadyInvoicedQty: reservations.qtyByLine[line.id] ?? 0, invoiceableQty: Math.max(0, (accepted[line.id] ?? 0) - (reservations.qtyByLine[line.id] ?? 0)) })),
      transportInvoiceable: Math.max(0, Number(row.order.transportCost ?? 0) - reservations.transport),
    };
  });

  app.get("/api/supplier/invoices", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    if (!supplierIds.length) return [];
    const rows = await db.select({ invoice: supplierInvoices, projectName: projects.name, companyName: companies.name }).from(supplierInvoices).innerJoin(projects, eq(supplierInvoices.projectId, projects.id)).innerJoin(companies, eq(projects.companyId, companies.id)).where(inArray(supplierInvoices.supplierId, supplierIds)).orderBy(desc(supplierInvoices.createdAt));
    return Promise.all(rows.map(async ({ invoice, projectName, companyName }) => ({ ...invoice, projectName, companyName, balance: (await loadInvoiceDetail(invoice)).balance })));
  });

  app.get("/api/supplier/invoices/:id", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await supplierInvoiceOwned(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    return { ...(await loadInvoiceDetail(row.invoice)), supplierName: row.supplierName, companyName: row.companyName, projectName: row.projectName };
  });

  app.post("/api/supplier/purchase-orders/:id/invoices", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await supplierOrder(id, request.currentSupplier!.id);
    if (!row || !["aprovado", "recebido"].includes(row.order.status)) return reply.code(404).send({ error: "Ordem de compra não disponível para facturação" });
    const parsed = invoiceInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const poLines = await loadOrderMatchLines(db, id);
    const poById = new Map(poLines.map((line) => [line.id, line]));
    if (new Set(parsed.data.lines.map((line) => line.purchaseOrderLineId)).size !== parsed.data.lines.length) return reply.code(400).send({ error: "Agrupe cada linha da OC uma única vez" });
    for (const line of parsed.data.lines) {
      const poLine = poById.get(line.purchaseOrderLineId);
      if (!poLine) return reply.code(400).send({ error: "A factura contém uma linha que não pertence à OC" });
      if (poLine.currency !== (poLines[0]?.currency ?? "MZN")) return reply.code(409).send({ error: "A OC contém moedas inconsistentes" });
    }
    let created: typeof supplierInvoices.$inferSelect;
    try {
      created = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from purchase_orders where id = ${id} for update`);
        // Submissões concorrentes também reservam quantidades para evitar dupla facturação.
        // Recalcular sob lock garante que duas facturas simultâneas não usam o mesmo aceite.
        const [freshAccepted, freshReservations] = await Promise.all([
          loadAcceptedQtyByOrderLine(tx, id),
          loadInvoiceReservations(tx, id),
        ]);
        const freshMatch = computeThreeWayMatch({
          poLines,
          acceptedQtyByLine: freshAccepted,
          previouslyInvoicedQtyByLine: freshReservations.qtyByLine,
          invoiceLines: parsed.data.lines,
          poTransportCost: Number(row.order.transportCost ?? 0),
          previouslyInvoicedTransport: freshReservations.transport,
          invoiceTransportCost: parsed.data.transportCost,
          poIvaRate: Number(row.order.ivaRate),
          invoiceIvaRate: parsed.data.ivaRate,
        });
        const [invoice] = await tx.insert(supplierInvoices).values({
          companyId: row.companyId,
          projectId: row.order.projectId,
          purchaseOrderId: id,
          supplierId: row.order.supplierId,
          invoiceNumber: parsed.data.invoiceNumber,
          issueDate: parsed.data.issueDate,
          dueDate: parsed.data.dueDate ?? null,
          status: "submetida",
          currency: (poLines[0]?.currency ?? "MZN") as "MZN" | "USD",
          ivaRate: parsed.data.ivaRate.toString(),
          transportCost: parsed.data.transportCost.toFixed(2),
          subtotal: freshMatch.subtotal.toFixed(2),
          vatAmount: freshMatch.vatAmount.toFixed(2),
          totalAmount: freshMatch.total.toFixed(2),
          supplierNotes: parsed.data.notes ?? null,
          matchStatus: freshMatch.exactMatch ? "correspondente" : freshMatch.hardBlocks.length ? "bloqueada" : "divergente",
          matchSnapshot: freshMatch as unknown as Record<string, unknown>,
          matchedAt: new Date(),
          submittedBySupplierAccountId: request.currentSupplier!.id,
          submittedAt: new Date(),
        }).returning();
        await tx.insert(supplierInvoiceLines).values(parsed.data.lines.map((line) => {
          const poLine = poById.get(line.purchaseOrderLineId)!;
          return { supplierInvoiceId: invoice.id, purchaseOrderLineId: line.purchaseOrderLineId, materialId: poLine.materialId, description: poLine.description ?? "Material", quantity: line.quantity.toString(), unitCost: line.unitCost.toString(), lineTotal: (line.quantity * line.unitCost).toFixed(2) };
        }));
        return invoice;
      });
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível submeter a factura" });
    }
    await notifyBuyerTeam(row.order.projectId, "Nova factura de fornecedor", `${row.supplierName} submeteu a factura ${created.invoiceNumber}.`);
    return reply.code(201).send(await loadInvoiceDetail(created));
  });

  app.post("/api/supplier/invoices/:id/credit-notes", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await supplierInvoiceOwned(id, request.currentSupplier!.id);
    if (!row || !PAYABLE_INVOICE_STATUSES.has(row.invoice.status)) return reply.code(404).send({ error: "Factura não disponível para nota de crédito" });
    const parsed = creditNoteInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.amount > Number(row.invoice.totalAmount) + 0.005) return reply.code(400).send({ error: "A nota de crédito não pode exceder o total da factura" });
    if (parsed.data.nonconformityId) {
      const [ncr] = await db.select().from(procurementNonconformities).where(and(eq(procurementNonconformities.id, parsed.data.nonconformityId), eq(procurementNonconformities.purchaseOrderId, row.invoice.purchaseOrderId))).limit(1);
      if (!ncr) return reply.code(400).send({ error: "A não-conformidade não pertence à OC desta factura" });
    }
    const [created] = await db.insert(supplierInvoiceCreditNotes).values({ supplierInvoiceId: id, nonconformityId: parsed.data.nonconformityId ?? null, creditNumber: parsed.data.creditNumber, issueDate: parsed.data.issueDate, amount: parsed.data.amount.toFixed(2), reason: parsed.data.reason, submittedBySupplierAccountId: request.currentSupplier!.id }).returning();
    await notifyBuyerTeam(row.invoice.projectId, "Nota de crédito recebida", `${row.supplierName} submeteu ${created.creditNumber} para a factura ${row.invoice.invoiceNumber}.`);
    return reply.code(201).send(created);
  });

  // ---------- Empresa: facturas / three-way match / contas a pagar ----------
  app.get("/api/projects/:projectId/supplier-invoices", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select({ invoice: supplierInvoices, supplierName: suppliers.name }).from(supplierInvoices).innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id)).where(eq(supplierInvoices.projectId, projectId)).orderBy(desc(supplierInvoices.createdAt));
    return Promise.all(rows.map(async ({ invoice, supplierName }) => ({ ...invoice, supplierName, balance: (await loadInvoiceDetail(invoice)).balance })));
  });

  app.get("/api/supplier-invoices/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await buyerInvoice(id, companyIdOf(request));
    if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    return { ...(await loadInvoiceDetail(row.invoice)), supplierName: row.supplierName, projectName: row.projectName };
  });

  app.post("/api/supplier-invoices/:id/review", { preHandler: reviewPermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await buyerInvoice(id, companyIdOf(request));
    if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    if (!["submetida", "em_revisao", "divergente"].includes(row.invoice.status)) return reply.code(409).send({ error: "Esta factura já não está em revisão" });
    const match = await computeInvoiceMatch(db, row.invoice);
    const status = match.exactMatch ? "em_revisao" : "divergente";
    const [updated] = await db.update(supplierInvoices).set({ status, matchStatus: match.exactMatch ? "correspondente" : match.hardBlocks.length ? "bloqueada" : "divergente", matchSnapshot: match as unknown as Record<string, unknown>, matchedAt: new Date(), reviewedByUserId: request.currentUser!.id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(supplierInvoices.id, id)).returning();
    return { ...updated, match };
  });

  app.post("/api/supplier-invoices/:id/approve", { preHandler: reviewPermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isFinanceApprover(request)) return reply.code(403).send({ error: "A aprovação de uma factura de fornecedor exige administrador da empresa" });
    const parsed = approvalInput.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await buyerInvoice(id, companyIdOf(request));
    if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    if (!["submetida", "em_revisao", "divergente"].includes(row.invoice.status)) return reply.code(409).send({ error: "Esta factura já não pode ser aprovada" });

    let approved: typeof supplierInvoices.$inferSelect;
    let match: ThreeWayMatchResult;
    try {
      ({ approved, match } = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from supplier_invoices where id = ${id} for update`);
        await tx.execute(sql`select id from purchase_orders where id = ${row.invoice.purchaseOrderId} for update`);
        const [locked] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).limit(1);
        if (!locked || !["submetida", "em_revisao", "divergente"].includes(locked.status)) throw new Error("A factura já foi processada");
        const freshMatch = await computeInvoiceMatch(tx, locked);
        if (freshMatch.hardBlocks.length) throw new Error(`Factura bloqueada: ${freshMatch.hardBlocks.join(" ")}`);
        if (freshMatch.softVariances.length && !parsed.data.varianceReason) throw new Error("Existem divergências de preço/condições; indique a justificação para aprovação excepcional");
        const now = new Date();
        const [updated] = await tx.update(supplierInvoices).set({
          status: "aprovada",
          matchStatus: freshMatch.exactMatch ? "correspondente" : "divergencia_aprovada",
          matchSnapshot: freshMatch as unknown as Record<string, unknown>,
          matchedAt: now,
          buyerNotes: parsed.data.buyerNotes ?? null,
          varianceReason: freshMatch.softVariances.length ? parsed.data.varianceReason! : null,
          varianceApprovedByUserId: freshMatch.softVariances.length ? request.currentUser!.id : null,
          varianceApprovedAt: freshMatch.softVariances.length ? now : null,
          reviewedByUserId: request.currentUser!.id,
          reviewedAt: now,
          approvedByUserId: request.currentUser!.id,
          approvedAt: now,
          updatedAt: now,
        }).where(eq(supplierInvoices.id, id)).returning();
        await tx.insert(financialEntries).values({
          projectId: locked.projectId,
          type: "despesa",
          category: "Fornecedores — Facturas",
          description: `Factura de fornecedor ${locked.invoiceNumber} · ${row.supplierName}`,
          amount: locked.totalAmount,
          currency: locked.currency,
          dueDate: locked.dueDate,
          status: "pendente",
          sourceType: "supplier_invoice",
          sourceId: locked.id,
          createdByUserId: request.currentUser!.id,
        }).onConflictDoNothing();
        return { approved: updated, match: freshMatch };
      }));
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível aprovar a factura" });
    }
    await recordAuditEvent({ companyId: companyIdOf(request), projectId: approved.projectId, actorUserId: request.currentUser!.id, entityType: "supplier_invoice", entityId: id, action: "approved", after: { invoiceNumber: approved.invoiceNumber, totalAmount: approved.totalAmount, matchStatus: approved.matchStatus, varianceReason: approved.varianceReason } });
    const [supplier] = await db.select({ accountId: suppliers.supplierAccountId }).from(suppliers).where(eq(suppliers.id, approved.supplierId)).limit(1);
    if (supplier?.accountId) await notifySupplierAccount(supplier.accountId, "Factura aprovada", `A factura ${approved.invoiceNumber} foi aprovada.`, `/facturas/${approved.id}`);
    return { ...approved, match };
  });

  app.post("/api/supplier-invoices/:id/reject", { preHandler: reviewPermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = rejectInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await buyerInvoice(id, companyIdOf(request));
    if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    if (! ["submetida", "em_revisao", "divergente"].includes(row.invoice.status)) return reply.code(409).send({ error: "A factura já foi processada" });
    const [updated] = await db.update(supplierInvoices).set({ status: "rejeitada", rejectionReason: parsed.data.reason, rejectedByUserId: request.currentUser!.id, rejectedAt: new Date(), updatedAt: new Date() }).where(eq(supplierInvoices.id, id)).returning();
    const [supplier] = await db.select({ accountId: suppliers.supplierAccountId }).from(suppliers).where(eq(suppliers.id, row.invoice.supplierId)).limit(1);
    if (supplier?.accountId) await notifySupplierAccount(supplier.accountId, "Factura rejeitada", `${row.invoice.invoiceNumber}: ${parsed.data.reason}`, `/facturas/${id}`);
    return updated;
  });

  app.post("/api/supplier-invoices/:id/payments", { preHandler: reviewPermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isFinanceApprover(request)) return reply.code(403).send({ error: "O registo de pagamento exige administrador da empresa" });
    const parsed = paymentInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await buyerInvoice(id, companyIdOf(request));
    if (!row || !PAYABLE_INVOICE_STATUSES.has(row.invoice.status)) return reply.code(404).send({ error: "Factura não disponível para pagamento" });
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from supplier_invoices where id = ${id} for update`);
        const [locked] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).limit(1);
        if (!locked || !PAYABLE_INVOICE_STATUSES.has(locked.status)) throw new Error("A factura já não está disponível para pagamento");
        const [payments, credits] = await Promise.all([
          tx.select().from(supplierInvoicePayments).where(eq(supplierInvoicePayments.supplierInvoiceId, id)),
          tx.select().from(supplierInvoiceCreditNotes).where(eq(supplierInvoiceCreditNotes.supplierInvoiceId, id)),
        ]);
        const before = computePayableBalance({ grossAmount: Number(locked.totalAmount), payments: payments.map((p: any) => Number(p.amount)), acceptedCreditNotes: credits.filter((c: any) => c.status === "aceite").map((c: any) => Number(c.amount)) });
        if (parsed.data.amount > before.outstanding + 0.005) throw new Error(`Pagamento excede o saldo da factura (${before.outstanding.toFixed(2)} ${locked.currency})`);
        const [payment] = await tx.insert(supplierInvoicePayments).values({ supplierInvoiceId: id, amount: parsed.data.amount.toFixed(2), paymentDate: parsed.data.paymentDate, method: parsed.data.method, reference: parsed.data.reference ?? null, notes: parsed.data.notes ?? null, createdByUserId: request.currentUser!.id }).returning();
        const after = computePayableBalance({ grossAmount: Number(locked.totalAmount), payments: [...payments.map((p: any) => Number(p.amount)), parsed.data.amount], acceptedCreditNotes: credits.filter((c: any) => c.status === "aceite").map((c: any) => Number(c.amount)) });
        await tx.update(supplierInvoices).set({ status: after.status, updatedAt: new Date() }).where(eq(supplierInvoices.id, id));
        await tx.update(financialEntries).set({ status: after.status === "paga" ? "pago" : "pendente", paidDate: after.status === "paga" ? parsed.data.paymentDate : null }).where(and(eq(financialEntries.sourceType, "supplier_invoice"), eq(financialEntries.sourceId, id)));
        return { payment, balance: after };
      });
      await recordAuditEvent({ companyId: companyIdOf(request), projectId: row.invoice.projectId, actorUserId: request.currentUser!.id, entityType: "supplier_invoice_payment", entityId: result.payment.id, action: "created", after: { invoiceId: id, amount: result.payment.amount, paymentDate: result.payment.paymentDate, method: result.payment.method } });
      return reply.code(201).send(result);
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível registar o pagamento" });
    }
  });

  app.post("/api/supplier-invoice-credit-notes/:id/review", { preHandler: reviewPermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isFinanceApprover(request)) return reply.code(403).send({ error: "A revisão de nota de crédito exige administrador da empresa" });
    const parsed = z.object({ decision: z.enum(["aceite", "rejeitada"]), notes: z.string().trim().max(3000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [credit] = await db.select().from(supplierInvoiceCreditNotes).where(eq(supplierInvoiceCreditNotes.id, id)).limit(1);
    if (!credit) return reply.code(404).send({ error: "Nota de crédito não encontrada" });
    const invoiceRow = await buyerInvoice(credit.supplierInvoiceId, companyIdOf(request));
    if (!invoiceRow) return reply.code(404).send({ error: "Nota de crédito não encontrada" });
    if (credit.status !== "submetida") return reply.code(409).send({ error: "A nota de crédito já foi revista" });
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from supplier_invoices where id = ${credit.supplierInvoiceId} for update`);
      const [updatedCredit] = await tx.update(supplierInvoiceCreditNotes).set({ status: parsed.data.decision, reviewedByUserId: request.currentUser!.id, reviewedAt: new Date() }).where(eq(supplierInvoiceCreditNotes.id, id)).returning();
      if (parsed.data.decision === "aceite") {
        const [payments, credits] = await Promise.all([
          tx.select().from(supplierInvoicePayments).where(eq(supplierInvoicePayments.supplierInvoiceId, credit.supplierInvoiceId)),
          tx.select().from(supplierInvoiceCreditNotes).where(eq(supplierInvoiceCreditNotes.supplierInvoiceId, credit.supplierInvoiceId)),
        ]);
        const acceptedCredits = credits.filter((c: any) => c.status === "aceite" || c.id === id).map((c: any) => Number(c.amount));
        const balance = computePayableBalance({ grossAmount: Number(invoiceRow.invoice.totalAmount), payments: payments.map((p: any) => Number(p.amount)), acceptedCreditNotes: acceptedCredits });
        if (balance.overpaid > 0.005) throw new Error(`A nota de crédito criaria um pagamento em excesso de ${balance.overpaid.toFixed(2)} ${invoiceRow.invoice.currency}`);
        await tx.update(financialEntries).set({ amount: balance.netPayable.toFixed(2), status: balance.status === "paga" ? "pago" : "pendente" }).where(and(eq(financialEntries.sourceType, "supplier_invoice"), eq(financialEntries.sourceId, credit.supplierInvoiceId)));
        await tx.update(supplierInvoices).set({ status: balance.status, updatedAt: new Date() }).where(eq(supplierInvoices.id, credit.supplierInvoiceId));
        if (credit.nonconformityId) await tx.update(procurementNonconformities).set({ status: "resolvida", buyerResolutionNotes: parsed.data.notes ?? "Resolvida por nota de crédito aceite", resolvedByUserId: request.currentUser!.id, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(procurementNonconformities.id, credit.nonconformityId));
        return { credit: updatedCredit, balance };
      }
      return { credit: updatedCredit, balance: null };
    });
    return result;
  });

  // ---------- Não-conformidades / devoluções ----------
  app.get("/api/projects/:projectId/nonconformities", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select({ ncr: procurementNonconformities, supplierName: suppliers.name, materialName: materials.name }).from(procurementNonconformities).innerJoin(purchaseOrders, eq(procurementNonconformities.purchaseOrderId, purchaseOrders.id)).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).innerJoin(materials, eq(procurementNonconformities.materialId, materials.id)).where(eq(procurementNonconformities.projectId, projectId)).orderBy(desc(procurementNonconformities.createdAt));
    const ids = rows.map((row) => row.ncr.id);
    const returns = ids.length ? await db.select().from(procurementGoodsReturns).where(inArray(procurementGoodsReturns.nonconformityId, ids)) : [];
    return rows.map((row) => ({ ...row, returns: returns.filter((ret) => ret.nonconformityId === row.ncr.id) }));
  });

  app.get("/api/supplier/nonconformities", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    if (!supplierIds.length) return [];
    const rows = await db.select({ ncr: procurementNonconformities, materialName: materials.name, companyName: companies.name, projectName: projects.name }).from(procurementNonconformities).innerJoin(purchaseOrders, eq(procurementNonconformities.purchaseOrderId, purchaseOrders.id)).innerJoin(projects, eq(procurementNonconformities.projectId, projects.id)).innerJoin(companies, eq(projects.companyId, companies.id)).innerJoin(materials, eq(procurementNonconformities.materialId, materials.id)).where(inArray(purchaseOrders.supplierId, supplierIds)).orderBy(desc(procurementNonconformities.createdAt));
    const ids = rows.map((row) => row.ncr.id);
    const returns = ids.length ? await db.select().from(procurementGoodsReturns).where(inArray(procurementGoodsReturns.nonconformityId, ids)) : [];
    return rows.map((row) => ({ ...row, returns: returns.filter((ret) => ret.nonconformityId === row.ncr.id) }));
  });

  app.post("/api/supplier/nonconformities/:id/respond", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    const [row] = supplierIds.length ? await db.select({ ncr: procurementNonconformities, supplierId: purchaseOrders.supplierId }).from(procurementNonconformities).innerJoin(purchaseOrders, eq(procurementNonconformities.purchaseOrderId, purchaseOrders.id)).where(and(eq(procurementNonconformities.id, id), inArray(purchaseOrders.supplierId, supplierIds))).limit(1) : [];
    if (!row) return reply.code(404).send({ error: "Não-conformidade não encontrada" });
    if (["resolvida", "cancelada"].includes(row.ncr.status)) return reply.code(409).send({ error: "A não-conformidade já foi encerrada" });
    const parsed = ncrResponseInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const validation = validateNonconformityResolution({ rejectedQty: Number(row.ncr.rejectedQty), resolution: parsed.data.resolutionType as NonconformityResolution, replacementQty: parsed.data.replacementQty, creditAmount: parsed.data.creditAmount, reason: parsed.data.response });
    if (!validation.ok) return reply.code(400).send({ error: validation.error });
    const [updated] = await db.update(procurementNonconformities).set({ status: "solucao_proposta", resolutionType: parsed.data.resolutionType, proposedReplacementQty: parsed.data.replacementQty?.toString() ?? null, proposedCreditAmount: parsed.data.creditAmount?.toFixed(2) ?? null, supplierResponse: parsed.data.response, respondedBySupplierAccountId: request.currentSupplier!.id, respondedAt: new Date(), updatedAt: new Date() }).where(eq(procurementNonconformities.id, id)).returning();
    await notifyBuyerTeam(row.ncr.projectId, "Solução proposta para não-conformidade", `${updated.reference}: o fornecedor respondeu à rejeição.`);
    return updated;
  });

  app.post("/api/nonconformities/:id/accept-solution", { preHandler: receivePermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const [row] = await db.select({ ncr: procurementNonconformities, projectCompanyId: projects.companyId }).from(procurementNonconformities).innerJoin(projects, eq(procurementNonconformities.projectId, projects.id)).where(and(eq(procurementNonconformities.id, id), eq(projects.companyId, companyId))).limit(1);
    if (!row) return reply.code(404).send({ error: "Não-conformidade não encontrada" });
    if (row.ncr.status !== "solucao_proposta" || !row.ncr.resolutionType) return reply.code(409).send({ error: "Não existe solução do fornecedor pronta para aprovação" });
    const nextStatus = row.ncr.resolutionType === "substituicao" ? "aguarda_substituicao" : row.ncr.resolutionType === "devolucao" ? "devolucao_pendente" : ["nota_credito", "aceite_com_desconto"].includes(row.ncr.resolutionType) ? "aguarda_credito" : "resolvida";
    const [updated] = await db.update(procurementNonconformities).set({ status: nextStatus as any, resolvedByUserId: nextStatus === "resolvida" ? request.currentUser!.id : null, resolvedAt: nextStatus === "resolvida" ? new Date() : null, updatedAt: new Date() }).where(eq(procurementNonconformities.id, id)).returning();
    return updated;
  });

  app.post("/api/nonconformities/:id/resolve", { preHandler: receivePermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = resolveInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = companyIdOf(request);
    const [row] = await db.select({ ncr: procurementNonconformities, projectCompanyId: projects.companyId }).from(procurementNonconformities).innerJoin(projects, eq(procurementNonconformities.projectId, projects.id)).where(and(eq(procurementNonconformities.id, id), eq(projects.companyId, companyId))).limit(1);
    if (!row) return reply.code(404).send({ error: "Não-conformidade não encontrada" });
    if (["resolvida", "cancelada"].includes(row.ncr.status)) return reply.code(409).send({ error: "A não-conformidade já foi encerrada" });
    const [updated] = await db.update(procurementNonconformities).set({ status: "resolvida", buyerResolutionNotes: parsed.data.notes, resolvedByUserId: request.currentUser!.id, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(procurementNonconformities.id, id)).returning();
    return updated;
  });

  app.post("/api/nonconformities/:id/returns", { preHandler: receivePermission }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = returnInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = companyIdOf(request);
    const [row] = await db.select({ ncr: procurementNonconformities, projectCompanyId: projects.companyId }).from(procurementNonconformities).innerJoin(projects, eq(procurementNonconformities.projectId, projects.id)).where(and(eq(procurementNonconformities.id, id), eq(projects.companyId, companyId))).limit(1);
    if (!row) return reply.code(404).send({ error: "Não-conformidade não encontrada" });
    if (row.ncr.status !== "devolucao_pendente" && row.ncr.resolutionType !== "devolucao") return reply.code(409).send({ error: "A solução desta não-conformidade não prevê devolução" });
    try {
      const created = await db.transaction(async (tx) => {
        await tx.execute(sql`select id from procurement_nonconformities where id = ${id} for update`);
        const existing = await tx.select().from(procurementGoodsReturns).where(eq(procurementGoodsReturns.nonconformityId, id));
        const alreadyReturned = existing.filter((entry: any) => entry.status !== "cancelada").reduce((sum: number, entry: any) => sum + Number(entry.quantity), 0);
        const returnValidation = validateGoodsReturn({ rejectedQty: Number(row.ncr.rejectedQty), alreadyReturnedQty: alreadyReturned, quantity: parsed.data.quantity });
        if (!returnValidation.ok) throw new Error(returnValidation.error);
        const reference = await nextReference(tx, companyId, "DEV");
        const [ret] = await tx.insert(procurementGoodsReturns).values({ companyId, nonconformityId: id, purchaseOrderId: row.ncr.purchaseOrderId, goodsReceiptLineId: row.ncr.goodsReceiptLineId, reference, quantity: parsed.data.quantity.toString(), status: "expedida", returnDate: parsed.data.returnDate, reason: parsed.data.reason, trackingReference: parsed.data.trackingReference ?? null, createdByUserId: request.currentUser!.id }).returning();
        await tx.update(procurementNonconformities).set({ status: "devolucao_pendente", updatedAt: new Date() }).where(eq(procurementNonconformities.id, id));
        return ret;
      });
      const [supplier] = await db.select({ accountId: suppliers.supplierAccountId }).from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(eq(purchaseOrders.id, row.ncr.purchaseOrderId)).limit(1);
      if (supplier?.accountId) await notifySupplierAccount(supplier.accountId, "Material devolvido", `${created.reference} foi expedida para devolução.`, `/nao-conformidades`);
      return reply.code(201).send(created);
    } catch (cause) {
      return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível registar a devolução" });
    }
  });

  app.post("/api/supplier/goods-returns/:id/confirm", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    const [row] = supplierIds.length ? await db.select({ ret: procurementGoodsReturns, supplierId: purchaseOrders.supplierId, ncrId: procurementGoodsReturns.nonconformityId }).from(procurementGoodsReturns).innerJoin(purchaseOrders, eq(procurementGoodsReturns.purchaseOrderId, purchaseOrders.id)).where(and(eq(procurementGoodsReturns.id, id), inArray(purchaseOrders.supplierId, supplierIds))).limit(1) : [];
    if (!row) return reply.code(404).send({ error: "Devolução não encontrada" });
    if (row.ret.status !== "expedida") return reply.code(409).send({ error: "A devolução já foi processada" });
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from procurement_nonconformities where id = ${row.ncrId} for update`);
      const [updated] = await tx.update(procurementGoodsReturns).set({ status: "recebida_fornecedor", confirmedBySupplierAccountId: request.currentSupplier!.id, supplierConfirmedAt: new Date(), updatedAt: new Date() }).where(eq(procurementGoodsReturns.id, id)).returning();
      const [ncr] = await tx.select().from(procurementNonconformities).where(eq(procurementNonconformities.id, row.ncrId)).limit(1);
      const returns = await tx.select().from(procurementGoodsReturns).where(eq(procurementGoodsReturns.nonconformityId, row.ncrId));
      const confirmedQty = returns.filter((ret: any) => ret.status === "recebida_fornecedor" || ret.id === id).reduce((sum: number, ret: any) => sum + Number(ret.quantity), 0);
      if (ncr && ncr.resolutionType === "devolucao" && confirmedQty + 0.0001 >= Number(ncr.rejectedQty)) {
        await tx.update(procurementNonconformities).set({ status: "resolvida", buyerResolutionNotes: "Devolução integral confirmada pelo fornecedor", resolvedAt: new Date(), updatedAt: new Date() }).where(eq(procurementNonconformities.id, row.ncrId));
      }
      return updated;
    });
    return result;
  });
}
