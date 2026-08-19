import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  companies,
  financialEntries,
  procurementBankReconciliations,
  procurementBankStatementImports,
  procurementBankTransactions,
  procurementDocumentSequences,
  procurementPaymentRequests,
  projects,
  supplierAccounts,
  supplierInvoiceCreditNotes,
  supplierInvoiceFiscalDocuments,
  supplierInvoicePayments,
  supplierInvoices,
  suppliers,
  users,
} from "../db/schema.js";
import { requireCompanyUser, requirePermission } from "../auth/middleware.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { emitWorkflowEvent } from "../services/workflowEvents.js";
import { detectImageExtension } from "../services/imageValidation.js";
import { env } from "../env.js";
import { computePayableBalance } from "../services/procurementAccountsPayable.js";
import {
  computeBankMatchScore,
  validateFiscalDocument,
  validatePaymentRequestAmount,
  validatePaymentSeparation,
  validateReconciliation,
  type FiscalDocumentFacts,
} from "../services/procurementFiscalControl.js";
import { extractFiscalDocument } from "../services/fiscalDocumentExtractor.js";
import { parseBankStatement } from "../services/procurementBankImport.js";

const financePermission = requirePermission("materiais.aprovar");
const PAYABLE_STATUSES = new Set(["aprovada", "parcialmente_paga", "paga"]);
const ACTIVE_PAYMENT_RESERVATIONS = new Set(["aprovado"]);
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MAX_BANK_BYTES = 12 * 1024 * 1024;

function companyIdOf(request: FastifyRequest) { return request.currentUser!.companyId!; }
function isAdmin(request: FastifyRequest) { return request.currentUser!.role === "admin_empresa" || request.currentUser!.role === "super_admin"; }
function safeOriginalName(name: string) { return name.slice(0, 300); }

async function activeAdminCount(companyId: string) {
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  return rows.length;
}

async function supplierIdsOwnedByAccount(accountId: string) {
  const rows = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.supplierAccountId, accountId));
  return rows.map((row) => row.id);
}

async function buyerInvoice(invoiceId: string, companyId: string) {
  const [row] = await db
    .select({ invoice: supplierInvoices, supplierName: suppliers.name, supplierNuit: suppliers.nuit, projectName: projects.name, buyerNuit: companies.nuit })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .innerJoin(projects, eq(supplierInvoices.projectId, projects.id))
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(and(eq(supplierInvoices.id, invoiceId), eq(projects.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function supplierInvoiceOwned(invoiceId: string, supplierAccountId: string) {
  const supplierIds = await supplierIdsOwnedByAccount(supplierAccountId);
  if (!supplierIds.length) return null;
  const [row] = await db
    .select({ invoice: supplierInvoices, supplierName: suppliers.name, supplierNuit: suppliers.nuit, companyName: companies.name, buyerNuit: companies.nuit, projectName: projects.name })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .innerJoin(projects, eq(supplierInvoices.projectId, projects.id))
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(and(eq(supplierInvoices.id, invoiceId), inArray(supplierInvoices.supplierId, supplierIds)))
    .limit(1);
  return row ?? null;
}

async function nextReference(tx: any, companyId: string, kind: "PAY") {
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

async function invoiceBalance(executor: any, invoice: typeof supplierInvoices.$inferSelect) {
  const [payments, credits] = await Promise.all([
    executor.select().from(supplierInvoicePayments).where(eq(supplierInvoicePayments.supplierInvoiceId, invoice.id)),
    executor.select().from(supplierInvoiceCreditNotes).where(eq(supplierInvoiceCreditNotes.supplierInvoiceId, invoice.id)),
  ]);
  return computePayableBalance({
    grossAmount: Number(invoice.totalAmount),
    payments: payments.map((row: any) => Number(row.amount)),
    acceptedCreditNotes: credits.filter((row: any) => row.status === "aceite").map((row: any) => Number(row.amount)),
  });
}

async function approvedReservationAmount(executor: any, invoiceId: string, excludeRequestId?: string) {
  const rows = await executor.select().from(procurementPaymentRequests).where(eq(procurementPaymentRequests.supplierInvoiceId, invoiceId));
  return rows
    .filter((row: any) => ACTIVE_PAYMENT_RESERVATIONS.has(row.status) && row.id !== excludeRequestId)
    .reduce((sum: number, row: any) => sum + Number(row.amount), 0);
}

async function paymentRequestOwned(id: string, companyId: string) {
  const [row] = await db
    .select({ request: procurementPaymentRequests, invoice: supplierInvoices, supplierName: suppliers.name })
    .from(procurementPaymentRequests)
    .innerJoin(supplierInvoices, eq(procurementPaymentRequests.supplierInvoiceId, supplierInvoices.id))
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .where(and(eq(procurementPaymentRequests.id, id), eq(procurementPaymentRequests.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

function normalizeFacts(value: unknown): FiscalDocumentFacts {
  const parsed = z.object({
    invoiceNumber: z.string().nullable().optional(), supplierNuit: z.string().nullable().optional(), buyerNuit: z.string().nullable().optional(),
    issueDate: z.string().nullable().optional(), dueDate: z.string().nullable().optional(), currency: z.enum(["MZN", "USD"]).nullable().optional(),
    subtotal: z.number().nullable().optional(), vatRate: z.number().nullable().optional(), vatAmount: z.number().nullable().optional(), totalAmount: z.number().nullable().optional(),
    atcud: z.string().nullable().optional(), qrCodeText: z.string().nullable().optional(),
  }).safeParse(value);
  return parsed.success ? parsed.data : {};
}

function expectedFiscal(row: NonNullable<Awaited<ReturnType<typeof buyerInvoice>>>) {
  return {
    invoiceNumber: row.invoice.invoiceNumber,
    supplierNuit: row.supplierNuit,
    buyerNuit: row.buyerNuit,
    issueDate: row.invoice.issueDate,
    currency: row.invoice.currency as "MZN" | "USD",
    subtotal: Number(row.invoice.subtotal),
    vatRate: Number(row.invoice.ivaRate),
    vatAmount: Number(row.invoice.vatAmount),
    totalAmount: Number(row.invoice.totalAmount),
  };
}

async function storeFiscalUpload(args: { invoiceId: string; companyId: string; buffer: Buffer; filename: string; mimeType: string; supplierAccountId?: string; userId?: string }) {
  if (args.buffer.length > MAX_DOC_BYTES) throw new Error("Documento fiscal excede 8 MB");
  const isPdf = args.buffer.length >= 5 && args.buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const imageExt = isPdf ? null : detectImageExtension(args.buffer);
  const ext = isPdf ? ".pdf" : imageExt;
  if (!ext) throw new Error("Aceite apenas PDF, PNG, JPG, WEBP ou GIF");
  const hash = createHash("sha256").update(args.buffer).digest("hex");
  const existing = await db.select().from(supplierInvoiceFiscalDocuments).where(and(eq(supplierInvoiceFiscalDocuments.companyId, args.companyId), eq(supplierInvoiceFiscalDocuments.sha256, hash))).limit(1);
  if (existing[0]) {
    if (existing[0].supplierInvoiceId === args.invoiceId) return existing[0];
    throw new Error("Este mesmo ficheiro fiscal já está associado a outra factura da empresa");
  }
  const previous = await db.select().from(supplierInvoiceFiscalDocuments).where(eq(supplierInvoiceFiscalDocuments.supplierInvoiceId, args.invoiceId));
  const version = previous.reduce((max, row) => Math.max(max, row.version), 0) + 1;
  const dir = path.join(env.uploadsDir, "supplier-invoice-fiscal");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${randomUUID()}${ext}`);
  await writeFile(filePath, args.buffer);
  const [created] = await db.insert(supplierInvoiceFiscalDocuments).values({
    companyId: args.companyId, supplierInvoiceId: args.invoiceId, version, status: "carregado", filePath,
    originalName: safeOriginalName(args.filename), mimeType: isPdf ? "application/pdf" : args.mimeType, fileSizeBytes: args.buffer.length, sha256: hash,
    uploadedBySupplierAccountId: args.supplierAccountId ?? null, uploadedByUserId: args.userId ?? null,
  }).returning();
  return created;
}

async function fiscalDocumentForBuyer(id: string, companyId: string) {
  const [row] = await db.select({ doc: supplierInvoiceFiscalDocuments, invoice: supplierInvoices })
    .from(supplierInvoiceFiscalDocuments)
    .innerJoin(supplierInvoices, eq(supplierInvoiceFiscalDocuments.supplierInvoiceId, supplierInvoices.id))
    .where(and(eq(supplierInvoiceFiscalDocuments.id, id), eq(supplierInvoiceFiscalDocuments.companyId, companyId))).limit(1);
  return row ?? null;
}
async function fiscalDocumentForSupplier(id: string, accountId: string) {
  const supplierIds = await supplierIdsOwnedByAccount(accountId); if (!supplierIds.length) return null;
  const [row] = await db.select({ doc: supplierInvoiceFiscalDocuments, invoice: supplierInvoices })
    .from(supplierInvoiceFiscalDocuments)
    .innerJoin(supplierInvoices, eq(supplierInvoiceFiscalDocuments.supplierInvoiceId, supplierInvoices.id))
    .where(and(eq(supplierInvoiceFiscalDocuments.id, id), inArray(supplierInvoices.supplierId, supplierIds))).limit(1);
  return row ?? null;
}

async function runExtraction(doc: typeof supplierInvoiceFiscalDocuments.$inferSelect) {
  const buffer = await readFile(doc.filePath);
  const result = await extractFiscalDocument({ buffer, mimeType: doc.mimeType, filename: doc.originalName });
  const [updated] = await db.update(supplierInvoiceFiscalDocuments).set({
    status: result.status === "extracted" ? "extraido" : "requer_revisao",
    extractionProvider: result.provider ?? null,
    extractionConfidence: result.confidence != null ? result.confidence.toFixed(5) : null,
    extractedData: result.facts as Record<string, unknown>,
    extractionMessage: result.message ?? null,
    extractedAt: new Date(),
  }).where(eq(supplierInvoiceFiscalDocuments.id, doc.id)).returning();
  return updated;
}

async function executePaymentTx(tx: any, requestRow: typeof procurementPaymentRequests.$inferSelect, invoice: typeof supplierInvoices.$inferSelect, executorId: string, args: { executionDate: string; reference?: string | null; overrideReason?: string | null }) {
  const [lockedRequest] = await tx.select().from(procurementPaymentRequests).where(eq(procurementPaymentRequests.id, requestRow.id)).limit(1);
  const [lockedInvoice] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id)).limit(1);
  if (!lockedRequest || lockedRequest.status !== "aprovado") throw new Error("O pedido de pagamento já não está aprovado para execução");
  if (!lockedInvoice || !PAYABLE_STATUSES.has(lockedInvoice.status)) throw new Error("A factura já não está disponível para pagamento");
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, requestRow.companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  const separation = validatePaymentSeparation({ requesterId: lockedRequest.requestedByUserId, approverId: lockedRequest.approvedByUserId, executorId, activeAdminCount: admins.length, overrideReason: args.overrideReason });
  if (!separation.ok) throw new Error(separation.error);
  const before = await invoiceBalance(tx, lockedInvoice);
  if (Number(lockedRequest.amount) > before.outstanding + 0.005) throw new Error(`O saldo actual da factura é ${before.outstanding.toFixed(2)} ${lockedInvoice.currency}`);
  const [payment] = await tx.insert(supplierInvoicePayments).values({
    supplierInvoiceId: lockedInvoice.id, amount: lockedRequest.amount, paymentDate: args.executionDate,
    method: lockedRequest.method, reference: args.reference ?? lockedRequest.executionReference ?? lockedRequest.reference,
    notes: `Executado a partir de ${lockedRequest.reference}`, createdByUserId: executorId,
  }).returning();
  const after = computePayableBalance({ grossAmount: Number(lockedInvoice.totalAmount), payments: [before.paid, Number(lockedRequest.amount)], acceptedCreditNotes: [before.credited] });
  await tx.update(supplierInvoices).set({ status: after.status, updatedAt: new Date() }).where(eq(supplierInvoices.id, lockedInvoice.id));
  await tx.update(financialEntries).set({ status: after.status === "paga" ? "pago" : "pendente", paidDate: after.status === "paga" ? args.executionDate : null }).where(and(eq(financialEntries.sourceType, "supplier_invoice"), eq(financialEntries.sourceId, lockedInvoice.id)));
  const [updatedRequest] = await tx.update(procurementPaymentRequests).set({ status: "executado", executedByUserId: executorId, executedAt: new Date(), executionDate: args.executionDate, executionReference: args.reference ?? lockedRequest.executionReference ?? lockedRequest.reference, executionOverrideReason: separation.overrideUsed ? args.overrideReason ?? null : null, supplierInvoicePaymentId: payment.id, updatedAt: new Date() }).where(eq(procurementPaymentRequests.id, lockedRequest.id)).returning();
  return { request: updatedRequest, payment, balance: after };
}

const fiscalFactsSchema = z.object({
  invoiceNumber: z.string().nullable().optional(), supplierNuit: z.string().nullable().optional(), buyerNuit: z.string().nullable().optional(), issueDate: z.string().nullable().optional(), dueDate: z.string().nullable().optional(), currency: z.enum(["MZN", "USD"]).nullable().optional(),
  subtotal: z.number().nullable().optional(), vatRate: z.number().nullable().optional(), vatAmount: z.number().nullable().optional(), totalAmount: z.number().nullable().optional(), atcud: z.string().nullable().optional(), qrCodeText: z.string().nullable().optional(),
});
const paymentRequestInput = z.object({ amount: z.number().positive(), requestedPaymentDate: z.string().optional().nullable(), method: z.string().trim().min(1).max(50).default("transferencia"), payeeBankName: z.string().trim().max(160).optional(), payeeAccountName: z.string().trim().max(200).optional(), payeeAccountNumber: z.string().trim().max(120).optional(), reason: z.string().trim().min(5).max(3000), notes: z.string().trim().max(3000).optional() });
const approvalInput = z.object({ overrideReason: z.string().trim().max(4000).optional() });
const executeInput = z.object({ executionDate: z.string().min(1), reference: z.string().trim().max(160).optional(), overrideReason: z.string().trim().max(4000).optional() });
const rejectInput = z.object({ reason: z.string().trim().min(5).max(3000) });

export async function procurementFiscalControlRoutes(app: FastifyInstance) {
  // ---------- Documento fiscal: fornecedor ----------
  app.get("/api/supplier/invoices/:id/fiscal-documents", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await supplierInvoiceOwned(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    return db.select().from(supplierInvoiceFiscalDocuments).where(eq(supplierInvoiceFiscalDocuments.supplierInvoiceId, id)).orderBy(desc(supplierInvoiceFiscalDocuments.version));
  });
  app.post("/api/supplier/invoices/:id/fiscal-documents", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await supplierInvoiceOwned(id, request.currentSupplier!.id);
    if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    const data = await request.file(); if (!data) return reply.code(400).send({ error: "Documento fiscal em falta" });
    try { const created = await storeFiscalUpload({ invoiceId: id, companyId: row.invoice.companyId, buffer: await data.toBuffer(), filename: data.filename, mimeType: data.mimetype, supplierAccountId: request.currentSupplier!.id }); return reply.code(201).send(created); }
    catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível guardar o documento" }); }
  });
  app.get("/api/supplier/fiscal-documents/:id/file", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await fiscalDocumentForSupplier(id, request.currentSupplier!.id); if (!row) return reply.code(404).send({ error: "Documento não encontrado" });
    const buffer = await readFile(row.doc.filePath); return reply.header("Content-Type", row.doc.mimeType).header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.doc.originalName)}`).send(buffer);
  });
  app.post("/api/supplier/fiscal-documents/:id/extract", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await fiscalDocumentForSupplier(id, request.currentSupplier!.id); if (!row) return reply.code(404).send({ error: "Documento não encontrado" }); return runExtraction(row.doc);
  });
  app.put("/api/supplier/fiscal-documents/:id/facts", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await fiscalDocumentForSupplier(id, request.currentSupplier!.id); if (!row) return reply.code(404).send({ error: "Documento não encontrado" });
    const parsed = fiscalFactsSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [updated] = await db.update(supplierInvoiceFiscalDocuments).set({ extractedData: parsed.data as Record<string, unknown>, status: "extraido", extractionProvider: row.doc.extractionProvider ?? "fornecedor_manual", extractedAt: new Date() }).where(eq(supplierInvoiceFiscalDocuments.id, id)).returning(); return updated;
  });

  // ---------- Documento fiscal: empresa ----------
  app.get("/api/supplier-invoices/:id/fiscal-documents", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string }; if (!(await buyerInvoice(id, companyIdOf(request)))) return reply.code(404).send({ error: "Factura não encontrada" });
    return db.select().from(supplierInvoiceFiscalDocuments).where(eq(supplierInvoiceFiscalDocuments.supplierInvoiceId, id)).orderBy(desc(supplierInvoiceFiscalDocuments.version));
  });
  app.post("/api/supplier-invoices/:id/fiscal-documents", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await buyerInvoice(id, companyIdOf(request)); if (!row) return reply.code(404).send({ error: "Factura não encontrada" });
    const data = await request.file(); if (!data) return reply.code(400).send({ error: "Documento fiscal em falta" });
    try { const created = await storeFiscalUpload({ invoiceId: id, companyId: companyIdOf(request), buffer: await data.toBuffer(), filename: data.filename, mimeType: data.mimetype, userId: request.currentUser!.id }); return reply.code(201).send(created); }
    catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível guardar o documento" }); }
  });
  app.get("/api/fiscal-documents/:id/file", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await fiscalDocumentForBuyer(id, companyIdOf(request)); if (!row) return reply.code(404).send({ error: "Documento não encontrado" });
    const buffer = await readFile(row.doc.filePath); return reply.header("Content-Type", row.doc.mimeType).header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.doc.originalName)}`).send(buffer);
  });
  app.post("/api/fiscal-documents/:id/extract", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await fiscalDocumentForBuyer(id, companyIdOf(request)); if (!row) return reply.code(404).send({ error: "Documento não encontrado" }); return runExtraction(row.doc);
  });
  app.put("/api/fiscal-documents/:id/facts", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await fiscalDocumentForBuyer(id, companyIdOf(request)); if (!row) return reply.code(404).send({ error: "Documento não encontrado" });
    const parsed = fiscalFactsSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [updated] = await db.update(supplierInvoiceFiscalDocuments).set({ reviewedData: parsed.data as Record<string, unknown>, status: "requer_revisao" }).where(eq(supplierInvoiceFiscalDocuments.id, id)).returning(); return updated;
  });
  app.post("/api/fiscal-documents/:id/validate", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const docRow = await fiscalDocumentForBuyer(id, companyIdOf(request)); if (!docRow) return reply.code(404).send({ error: "Documento não encontrado" });
    const invoiceRow = await buyerInvoice(docRow.invoice.id, companyIdOf(request)); if (!invoiceRow) return reply.code(404).send({ error: "Factura não encontrada" });
    const facts = normalizeFacts(docRow.doc.reviewedData ?? docRow.doc.extractedData ?? {}); const validation = validateFiscalDocument(facts, expectedFiscal(invoiceRow));
    const status = validation.status === "validado" ? "validado" : "requer_revisao";
    const [updated] = await db.update(supplierInvoiceFiscalDocuments).set({ status, validationSnapshot: validation as unknown as Record<string, unknown>, validatedByUserId: validation.status === "validado" ? request.currentUser!.id : null, validatedAt: validation.status === "validado" ? new Date() : null, rejectionReason: null }).where(eq(supplierInvoiceFiscalDocuments.id, id)).returning();
    await recordAuditEvent({ companyId: companyIdOf(request), projectId: invoiceRow.invoice.projectId, actorUserId: request.currentUser!.id, entityType: "supplier_invoice_fiscal_document", entityId: id, action: validation.status === "validado" ? "validated" : "review_required", after: { validation } });
    return { document: updated, validation };
  });
  app.post("/api/fiscal-documents/:id/reject", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const parsed = rejectInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await fiscalDocumentForBuyer(id, companyIdOf(request)); if (!row) return reply.code(404).send({ error: "Documento não encontrado" });
    const [updated] = await db.update(supplierInvoiceFiscalDocuments).set({ status: "rejeitado", rejectionReason: parsed.data.reason, validatedByUserId: request.currentUser!.id, validatedAt: new Date() }).where(eq(supplierInvoiceFiscalDocuments.id, id)).returning(); return updated;
  });

  // ---------- Pedidos de pagamento ----------
  app.get("/api/projects/:projectId/payment-requests", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }; if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db.select({ request: procurementPaymentRequests, invoiceNumber: supplierInvoices.invoiceNumber, supplierName: suppliers.name }).from(procurementPaymentRequests).innerJoin(supplierInvoices, eq(procurementPaymentRequests.supplierInvoiceId, supplierInvoices.id)).innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id)).where(eq(procurementPaymentRequests.projectId, projectId)).orderBy(desc(procurementPaymentRequests.createdAt));
  });
  app.get("/api/supplier-invoices/:id/payment-requests", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string }; if (!(await buyerInvoice(id, companyIdOf(request)))) return reply.code(404).send({ error: "Factura não encontrada" });
    return db.select().from(procurementPaymentRequests).where(eq(procurementPaymentRequests.supplierInvoiceId, id)).orderBy(desc(procurementPaymentRequests.createdAt));
  });
  app.post("/api/supplier-invoices/:id/payment-requests", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const parsed = paymentRequestInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await buyerInvoice(id, companyIdOf(request)); if (!row || !PAYABLE_STATUSES.has(row.invoice.status)) return reply.code(404).send({ error: "Factura não disponível para pagamento" });
    const [latestFiscalDoc] = await db.select().from(supplierInvoiceFiscalDocuments).where(eq(supplierInvoiceFiscalDocuments.supplierInvoiceId, id)).orderBy(desc(supplierInvoiceFiscalDocuments.version)).limit(1);
    if (!latestFiscalDoc || latestFiscalDoc.status !== "validado") return reply.code(409).send({ error: "Valide a versão mais recente do documento fiscal da factura" });
    const balance = await invoiceBalance(db, row.invoice); const reserved = await approvedReservationAmount(db, id); const valid = validatePaymentRequestAmount({ outstanding: balance.outstanding, activeApprovedReservations: reserved, requestedAmount: parsed.data.amount }); if (!valid.ok) return reply.code(409).send({ error: valid.error });
    const created = await db.transaction(async (tx) => { const reference = await nextReference(tx, companyIdOf(request), "PAY"); const [item] = await tx.insert(procurementPaymentRequests).values({ companyId: companyIdOf(request), projectId: row.invoice.projectId, supplierInvoiceId: id, reference, amount: parsed.data.amount.toFixed(2), currency: row.invoice.currency, requestedPaymentDate: parsed.data.requestedPaymentDate ?? null, method: parsed.data.method, payeeBankName: parsed.data.payeeBankName ?? null, payeeAccountName: parsed.data.payeeAccountName ?? row.supplierName, payeeAccountNumber: parsed.data.payeeAccountNumber ?? null, reason: parsed.data.reason, notes: parsed.data.notes ?? null, requestedByUserId: request.currentUser!.id }).returning(); return item; });
    return reply.code(201).send(created);
  });
  app.post("/api/payment-requests/:id/submit", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await paymentRequestOwned(id, companyIdOf(request)); if (!row) return reply.code(404).send({ error: "Pedido não encontrado" }); if (row.request.status !== "rascunho") return reply.code(409).send({ error: "Só pedidos em rascunho podem ser submetidos" });
    const [updated] = await db.update(procurementPaymentRequests).set({ status: "submetido", submittedAt: new Date(), updatedAt: new Date() }).where(eq(procurementPaymentRequests.id, id)).returning();
    await emitWorkflowEvent({ event: "payment_request.submitted", companyId: companyIdOf(request), entityId: id, title: updated.reference, link: `/projectos/${updated.projectId}/compras`, actor: { id: request.currentUser!.id, name: request.currentUser!.name, email: request.currentUser!.email }, logger: request.log });
    return updated;
  });
  app.post("/api/payment-requests/:id/approve", { preHandler: financePermission }, async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "A aprovação de pagamento exige administrador da empresa" }); const { id } = request.params as { id: string }; const parsed = approvalInput.safeParse(request.body ?? {}); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await paymentRequestOwned(id, companyIdOf(request)); if (!row || row.request.status !== "submetido") return reply.code(404).send({ error: "Pedido não disponível para aprovação" });
    try { const updated = await db.transaction(async (tx) => { await tx.execute(sql`select id from procurement_payment_requests where id=${id} for update`); await tx.execute(sql`select id from supplier_invoices where id=${row.invoice.id} for update`); const [locked] = await tx.select().from(procurementPaymentRequests).where(eq(procurementPaymentRequests.id, id)).limit(1); if (!locked || locked.status !== "submetido") throw new Error("Pedido já processado"); const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, locked.companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true))); const separation = validatePaymentSeparation({ requesterId: locked.requestedByUserId, approverId: request.currentUser!.id, activeAdminCount: admins.length, overrideReason: parsed.data.overrideReason }); if (!separation.ok) throw new Error(separation.error); const balance = await invoiceBalance(tx, row.invoice); const reserved = await approvedReservationAmount(tx, row.invoice.id, id); const amountValidation = validatePaymentRequestAmount({ outstanding: balance.outstanding, activeApprovedReservations: reserved, requestedAmount: Number(locked.amount) }); if (!amountValidation.ok) throw new Error(amountValidation.error); const [item] = await tx.update(procurementPaymentRequests).set({ status: "aprovado", approvedByUserId: request.currentUser!.id, approvedAt: new Date(), approvalOverrideReason: separation.overrideUsed ? parsed.data.overrideReason ?? null : null, updatedAt: new Date() }).where(eq(procurementPaymentRequests.id, id)).returning(); return item; });
      await emitWorkflowEvent({ event: "payment_request.approved", companyId: companyIdOf(request), entityId: id, title: updated.reference, link: `/projectos/${updated.projectId}/compras`, actor: { id: request.currentUser!.id, name: request.currentUser!.name, email: request.currentUser!.email }, submitterUserId: row.request.requestedByUserId, logger: request.log });
      return updated; }
    catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível aprovar o pedido" }); }
  });
  app.post("/api/payment-requests/:id/reject", { preHandler: financePermission }, async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "A rejeição exige administrador da empresa" }); const { id } = request.params as { id: string }; const parsed = rejectInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); const row = await paymentRequestOwned(id, companyIdOf(request)); if (!row || !["submetido", "aprovado"].includes(row.request.status)) return reply.code(404).send({ error: "Pedido não disponível" }); const [updated] = await db.update(procurementPaymentRequests).set({ status: "rejeitado", rejectedByUserId: request.currentUser!.id, rejectedAt: new Date(), rejectionReason: parsed.data.reason, updatedAt: new Date() }).where(eq(procurementPaymentRequests.id, id)).returning();
    await emitWorkflowEvent({ event: "payment_request.rejected", companyId: companyIdOf(request), entityId: id, title: updated.reference, link: `/projectos/${updated.projectId}/compras`, actor: { id: request.currentUser!.id, name: request.currentUser!.name, email: request.currentUser!.email }, submitterUserId: row.request.requestedByUserId, reason: parsed.data.reason, logger: request.log });
    return updated;
  });
  app.post("/api/payment-requests/:id/execute", { preHandler: financePermission }, async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "A execução exige administrador da empresa" }); const { id } = request.params as { id: string }; const parsed = executeInput.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); const row = await paymentRequestOwned(id, companyIdOf(request)); if (!row || row.request.status !== "aprovado") return reply.code(404).send({ error: "Pedido não aprovado" });
    try { const result = await db.transaction(async (tx) => { await tx.execute(sql`select id from procurement_payment_requests where id=${id} for update`); await tx.execute(sql`select id from supplier_invoices where id=${row.invoice.id} for update`); return executePaymentTx(tx, row.request, row.invoice, request.currentUser!.id, { executionDate: parsed.data.executionDate, reference: parsed.data.reference, overrideReason: parsed.data.overrideReason }); }); await recordAuditEvent({ companyId: companyIdOf(request), projectId: row.invoice.projectId, actorUserId: request.currentUser!.id, entityType: "procurement_payment_request", entityId: id, action: "executed", after: { amount: result.request.amount, executionDate: result.request.executionDate, executionReference: result.request.executionReference } }); return result; }
    catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível executar o pagamento" }); }
  });
  app.post("/api/payment-requests/:id/proof", { preHandler: financePermission }, async (request, reply) => {
    const { id } = request.params as { id: string }; const row = await paymentRequestOwned(id, companyIdOf(request)); if (!row || row.request.status !== "executado") return reply.code(404).send({ error: "Pagamento executado não encontrado" }); if (row.request.executionProofFilePath) return reply.code(409).send({ error: "O comprovativo já foi anexado e é imutável; correcções devem ser registadas por novo evento/pagamento" }); const data = await request.file(); if (!data) return reply.code(400).send({ error: "Comprovativo em falta" }); const buffer = await data.toBuffer(); if (buffer.length > MAX_DOC_BYTES) return reply.code(400).send({ error: "Comprovativo excede 8 MB" }); const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-"; const ext = isPdf ? ".pdf" : detectImageExtension(buffer); if (!ext) return reply.code(400).send({ error: "Aceite apenas PDF ou imagem" }); const dir = path.join(env.uploadsDir, "supplier-payment-proofs"); await mkdir(dir, { recursive: true }); const filePath = path.join(dir, `${randomUUID()}${ext}`); await writeFile(filePath, buffer); const [updated] = await db.update(procurementPaymentRequests).set({ executionProofFilePath: filePath, executionProofOriginalName: safeOriginalName(data.filename), updatedAt: new Date() }).where(eq(procurementPaymentRequests.id, id)).returning(); return updated;
  });
  app.get("/api/payment-requests/:id/proof", { preHandler: requireCompanyUser }, async (request, reply) => { const { id } = request.params as { id: string }; const row = await paymentRequestOwned(id, companyIdOf(request)); if (!row?.request.executionProofFilePath) return reply.code(404).send({ error: "Comprovativo não encontrado" }); return reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.request.executionProofOriginalName ?? "comprovativo")}`).send(await readFile(row.request.executionProofFilePath)); });

  // ---------- Importação / reconciliação bancária ----------
  app.post("/api/projects/:projectId/bank-statements", { preHandler: financePermission }, async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "Importação bancária exige administrador da empresa" }); const { projectId } = request.params as { projectId: string }; const project = await assertProjectOwned(projectId, companyIdOf(request)); if (!project) return reply.code(404).send({ error: "Projecto não encontrado" }); const data = await request.file(); if (!data) return reply.code(400).send({ error: "Extracto em falta" }); const buffer = await data.toBuffer(); if (buffer.length > MAX_BANK_BYTES) return reply.code(400).send({ error: "Extracto excede 12 MB" }); const fields = data.fields as Record<string, any>; const bankName = String(fields.bankName?.value ?? "Banco").trim().slice(0, 160); const accountLabel = String(fields.accountLabel?.value ?? "").trim().slice(0, 160) || null; const defaultCurrency = String(fields.currency?.value ?? project.currency).toUpperCase() === "USD" ? "USD" : "MZN"; let rows; try { rows = await parseBankStatement(buffer, data.filename, defaultCurrency); } catch (cause) { return reply.code(400).send({ error: cause instanceof Error ? cause.message : "Extracto inválido" }); } if (!rows.length) return reply.code(400).send({ error: "Nenhuma transacção válida encontrada" }); const hash = createHash("sha256").update(buffer).digest("hex"); const existing = await db.select().from(procurementBankStatementImports).where(and(eq(procurementBankStatementImports.companyId, companyIdOf(request)), eq(procurementBankStatementImports.sha256, hash))).limit(1); if (existing[0]) return reply.code(409).send({ error: "Este extracto já foi importado" }); const dir = path.join(env.uploadsDir, "bank-statements"); await mkdir(dir, { recursive: true }); const ext = data.filename.toLowerCase().endsWith(".xlsx") ? ".xlsx" : ".csv"; const filePath = path.join(dir, `${randomUUID()}${ext}`); await writeFile(filePath, buffer); const result = await db.transaction(async (tx) => { const [imp] = await tx.insert(procurementBankStatementImports).values({ companyId: companyIdOf(request), projectId, bankName, accountLabel, currency: defaultCurrency, originalName: safeOriginalName(data.filename), filePath, sha256: hash, rowCount: rows.length, importedByUserId: request.currentUser!.id }).returning(); let inserted = 0; for (const row of rows) { const values = { companyId: companyIdOf(request), projectId, statementImportId: imp.id, transactionDate: row.transactionDate, valueDate: row.valueDate, amount: row.amount.toFixed(2), currency: row.currency, description: row.description, reference: row.reference, counterparty: row.counterparty, fingerprint: row.fingerprint } as const; const created = await tx.insert(procurementBankTransactions).values(values).onConflictDoNothing().returning(); inserted += created.length; } return { import: imp, inserted }; }); return reply.code(201).send(result);
  });
  app.get("/api/projects/:projectId/bank-reconciliation", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }; if (!(await assertProjectOwned(projectId, companyIdOf(request)))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const [transactions, requests] = await Promise.all([
      db.select().from(procurementBankTransactions).where(and(eq(procurementBankTransactions.projectId, projectId), inArray(procurementBankTransactions.status, ["importado", "sugerido"]))).orderBy(desc(procurementBankTransactions.transactionDate)),
      db.select({ request: procurementPaymentRequests, invoiceNumber: supplierInvoices.invoiceNumber, supplierName: suppliers.name }).from(procurementPaymentRequests).innerJoin(supplierInvoices, eq(procurementPaymentRequests.supplierInvoiceId, supplierInvoices.id)).innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id)).where(and(eq(procurementPaymentRequests.projectId, projectId), inArray(procurementPaymentRequests.status, ["aprovado", "executado"]))),
    ]);
    const suggestions = transactions.map((transaction) => ({ transactionId: transaction.id, matches: requests.map((item) => ({ paymentRequestId: item.request.id, ...computeBankMatchScore({ id: transaction.id, transactionDate: transaction.transactionDate, amount: Number(transaction.amount), currency: transaction.currency, description: transaction.description, reference: transaction.reference }, { id: item.request.id, amount: Number(item.request.amount), currency: item.request.currency, requestedPaymentDate: item.request.executionDate ?? item.request.requestedPaymentDate, executionReference: item.request.executionReference, supplierName: item.supplierName, invoiceNumber: item.invoiceNumber }), reference: item.request.reference, supplierName: item.supplierName, invoiceNumber: item.invoiceNumber, status: item.request.status })).filter((match) => match.eligible).sort((a,b) => b.score-a.score).slice(0,3) }));
    return { transactions, paymentRequests: requests, suggestions };
  });
  app.post("/api/bank-transactions/:id/reconcile", { preHandler: financePermission }, async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ error: "Reconciliação exige administrador da empresa" }); const { id } = request.params as { id: string }; const parsed = z.object({ paymentRequestId: z.string().uuid(), notes: z.string().trim().max(3000).optional(), overrideReason: z.string().trim().max(4000).optional() }).safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); const [transaction] = await db.select().from(procurementBankTransactions).where(and(eq(procurementBankTransactions.id, id), eq(procurementBankTransactions.companyId, companyIdOf(request)))).limit(1); const paymentRow = await paymentRequestOwned(parsed.data.paymentRequestId, companyIdOf(request)); if (!transaction || !paymentRow || transaction.projectId !== paymentRow.request.projectId) return reply.code(404).send({ error: "Transacção ou pedido não encontrado" }); if (!["aprovado", "executado"].includes(paymentRow.request.status)) return reply.code(409).send({ error: "O pedido deve estar aprovado ou já executado" }); const validation = validateReconciliation({ transactionAmount: Number(transaction.amount), transactionCurrency: transaction.currency, paymentAmount: Number(paymentRow.request.amount), paymentCurrency: paymentRow.request.currency }); if (!validation.ok) return reply.code(409).send({ error: validation.error });
    try { const result = await db.transaction(async (tx) => { await tx.execute(sql`select id from procurement_bank_transactions where id=${id} for update`); await tx.execute(sql`select id from procurement_payment_requests where id=${paymentRow.request.id} for update`); const [freshTx] = await tx.select().from(procurementBankTransactions).where(eq(procurementBankTransactions.id, id)).limit(1); const [freshRequest] = await tx.select().from(procurementPaymentRequests).where(eq(procurementPaymentRequests.id, paymentRow.request.id)).limit(1); if (!freshTx || freshTx.status === "reconciliado") throw new Error("Transacção já reconciliada"); if (!freshRequest || !["aprovado", "executado"].includes(freshRequest.status)) throw new Error("Pedido já não está disponível"); let execution = null; if (freshRequest.status === "aprovado") execution = await executePaymentTx(tx, freshRequest, paymentRow.invoice, request.currentUser!.id, { executionDate: freshTx.transactionDate, reference: freshTx.reference ?? freshRequest.reference, overrideReason: parsed.data.overrideReason }); const score = computeBankMatchScore({ id: freshTx.id, transactionDate: freshTx.transactionDate, amount: Number(freshTx.amount), currency: freshTx.currency, description: freshTx.description, reference: freshTx.reference }, { id: freshRequest.id, amount: Number(freshRequest.amount), currency: freshRequest.currency, requestedPaymentDate: freshRequest.executionDate ?? freshRequest.requestedPaymentDate, executionReference: freshRequest.executionReference, supplierName: paymentRow.supplierName, invoiceNumber: paymentRow.invoice.invoiceNumber }); const [rec] = await tx.insert(procurementBankReconciliations).values({ companyId: companyIdOf(request), bankTransactionId: freshTx.id, paymentRequestId: freshRequest.id, matchMethod: score.eligible ? "suggested_confirmed" : "manual", matchScore: score.score, notes: parsed.data.notes ?? null, reconciledByUserId: request.currentUser!.id }).returning(); await tx.update(procurementBankTransactions).set({ status: "reconciliado" }).where(eq(procurementBankTransactions.id, id)); return { reconciliation: rec, execution }; }); return result; }
    catch (cause) { return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Não foi possível reconciliar" }); }
  });
  app.post("/api/bank-transactions/:id/ignore", { preHandler: financePermission }, async (request, reply) => { const { id } = request.params as { id: string }; const [transaction] = await db.select().from(procurementBankTransactions).where(and(eq(procurementBankTransactions.id, id), eq(procurementBankTransactions.companyId, companyIdOf(request)))).limit(1); if (!transaction) return reply.code(404).send({ error: "Transacção não encontrada" }); if (transaction.status === "reconciliado") return reply.code(409).send({ error: "Transacção já reconciliada" }); const [updated] = await db.update(procurementBankTransactions).set({ status: "ignorado" }).where(eq(procurementBankTransactions.id, id)).returning(); return updated; });
}
