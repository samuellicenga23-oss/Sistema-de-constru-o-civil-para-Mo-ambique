import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { invoiceCreditNotes, invoiceReceipts, measurementCertificates, projectInvoices } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertCertificateOwned, assertProjectOwned } from "../services/accessControl.js";
import { invoiceCreditAmount, invoicePaidAmount, syncInvoiceReceivable } from "../services/invoicing.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { buildInvoicePdf } from "../services/invoicePdf.js";
import { projects } from "../db/schema.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";
import { detectImageExtension } from "../services/imageValidation.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

async function findInvoice(id: string, companyId: string) {
  const [invoice] = await db.select().from(projectInvoices).where(eq(projectInvoices.id, id)).limit(1);
  if (!invoice || !(await assertProjectOwned(invoice.projectId, companyId))) return null;
  return invoice;
}

export async function invoiceRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/invoices", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, request.currentUser!.companyId!))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const invoices = await db.select().from(projectInvoices).where(eq(projectInvoices.projectId, projectId)).orderBy(desc(projectInvoices.createdAt));
    return Promise.all(invoices.map(async (invoice) => {
      const [receipts, creditNotes] = await Promise.all([
        db.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, invoice.id)).orderBy(desc(invoiceReceipts.receivedDate)),
        db.select().from(invoiceCreditNotes).where(eq(invoiceCreditNotes.invoiceId, invoice.id)).orderBy(desc(invoiceCreditNotes.createdAt)),
      ]);
      const paidAmount = receipts.reduce((total, receipt) => total + Number(receipt.amount), 0);
      const creditAmount = creditNotes.filter((note) => note.status === "emitida").reduce((total, note) => total + Number(note.amount), 0);
      return { ...invoice, receipts: receipts.map((receipt) => ({ ...receipt, proofUrl: receipt.proofFilePath ? `/api/invoice-receipts/${receipt.id}/proof` : null })), creditNotes, paidAmount, creditAmount, outstandingAmount: Math.max(0, Number(invoice.netAmount) - creditAmount - paidAmount) };
    }));
  });

  app.get("/api/invoices/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await findInvoice(id, request.currentUser!.companyId!);
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    const [receipts, creditNotes] = await Promise.all([db.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, id)).orderBy(desc(invoiceReceipts.receivedDate)), db.select().from(invoiceCreditNotes).where(eq(invoiceCreditNotes.invoiceId, id)).orderBy(desc(invoiceCreditNotes.createdAt))]);
    const paidAmount = receipts.reduce((total, receipt) => total + Number(receipt.amount), 0);
    const creditAmount = creditNotes.filter((note) => note.status === "emitida").reduce((total, note) => total + Number(note.amount), 0);
    return { ...invoice, receipts: receipts.map((receipt) => ({ ...receipt, proofUrl: receipt.proofFilePath ? `/api/invoice-receipts/${receipt.id}/proof` : null })), creditNotes, paidAmount, creditAmount, outstandingAmount: Math.max(0, Number(invoice.netAmount) - creditAmount - paidAmount) };
  });

  app.get("/api/invoices/:id/export.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await findInvoice(id, request.currentUser!.companyId!);
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    if (invoice.status === "rascunho" || invoice.status === "cancelada") return reply.code(409).send({ error: "Emita a factura antes de exportar" });
    const [[project], receipts, creditNotes] = await Promise.all([db.select().from(projects).where(eq(projects.id, invoice.projectId)).limit(1), db.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, id)), db.select().from(invoiceCreditNotes).where(and(eq(invoiceCreditNotes.invoiceId, id), eq(invoiceCreditNotes.status, "emitida")))]);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const paidAmount = receipts.reduce((total, receipt) => total + Number(receipt.amount), 0);
    const creditAmount = creditNotes.reduce((total, note) => total + Number(note.amount), 0);
    const buffer = await buildInvoicePdf({ invoice, project, paidAmount, creditAmount, outstandingAmount: Math.max(0, Number(invoice.netAmount) - creditAmount - paidAmount) });
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="Factura-${(invoice.invoiceNumber ?? id).replace(/[^\\w-]/g, "")}.pdf"`).send(buffer);
  });

  app.post("/api/measurement-certificates/:id/invoice", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const certificate = await assertCertificateOwned(id, request.currentUser!.companyId!);
    if (!certificate) return reply.code(404).send({ error: "Auto não encontrado" });
    if (certificate.status !== "aprovado") return reply.code(409).send({ error: "A factura só pode ser preparada a partir de um Auto aprovado" });
    const { createDraftInvoiceForCertificate } = await import("../services/invoicing.js");
    const invoice = await createDraftInvoiceForCertificate(id, request.currentUser!.id);
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: certificate.projectId, actorUserId: request.currentUser!.id, entityType: "invoice", entityId: invoice.id, action: "draft_created", after: { grossAmount: invoice.grossAmount, currency: invoice.currency, certificateId: id } });
    return reply.code(201).send(invoice);
  });

  app.put("/api/invoices/:id/issue", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await findInvoice(id, request.currentUser!.companyId!);
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    if (invoice.status !== "rascunho") return reply.code(409).send({ error: "Apenas facturas em rascunho podem ser emitidas" });
    const parsed = z.object({ invoiceNumber: z.string().trim().min(1).max(80), issueDate: z.string().min(1), dueDate: z.string().optional(), retentionRate: z.number().min(0).max(1).default(0), notes: z.string().max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (invoice.createdByUserId === request.currentUser!.id) return reply.code(409).send({ error: "Quem preparou a factura não pode emiti-la" });
    const retentionAmount = Number(invoice.grossAmount) * parsed.data.retentionRate;
    const netAmount = Number(invoice.grossAmount) - retentionAmount;
    const [updated] = await db.update(projectInvoices).set({ status: "emitida", invoiceNumber: parsed.data.invoiceNumber, issueDate: parsed.data.issueDate, dueDate: parsed.data.dueDate, retentionRate: parsed.data.retentionRate.toString(), retentionAmount: retentionAmount.toFixed(2), netAmount: netAmount.toFixed(2), notes: parsed.data.notes, issuedByUserId: request.currentUser!.id }).where(eq(projectInvoices.id, id)).returning();
    await syncInvoiceReceivable(id);
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: updated.projectId, actorUserId: request.currentUser!.id, entityType: "invoice", entityId: id, action: "issued", before: { status: invoice.status }, after: { status: updated.status, invoiceNumber: updated.invoiceNumber, netAmount: updated.netAmount, retentionAmount: updated.retentionAmount } });
    return updated;
  });

  app.post("/api/invoices/:id/receipts", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await findInvoice(id, request.currentUser!.companyId!);
    if (!invoice) return reply.code(404).send({ error: "Factura não encontrada" });
    const parsed = z.object({ amount: z.number().positive(), receivedDate: z.string().min(1), reference: z.string().max(150).optional(), notes: z.string().max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" ? rawKey.trim().slice(0, 100) || null : null;
    const result = await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`select id from project_invoices where id = ${id} for update`);
      const [lockedInvoice] = await tx.select().from(projectInvoices).where(eq(projectInvoices.id, id)).limit(1);
      if (!lockedInvoice || (lockedInvoice.status !== "emitida" && lockedInvoice.status !== "parcial")) return { error: "Só facturas emitidas podem receber pagamentos" } as const;
      if (idempotencyKey) {
        const [existing] = await tx.select().from(invoiceReceipts).where(and(eq(invoiceReceipts.invoiceId, id), eq(invoiceReceipts.idempotencyKey, idempotencyKey))).limit(1);
        if (existing) {
          const receipts = await tx.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, id));
          const credits = await tx.select().from(invoiceCreditNotes).where(and(eq(invoiceCreditNotes.invoiceId, id), eq(invoiceCreditNotes.status, "emitida")));
          const paidAmount = receipts.reduce((sum, row) => sum + Number(row.amount), 0);
          const effectiveAmount = Math.max(0, Number(lockedInvoice.netAmount) - credits.reduce((sum, row) => sum + Number(row.amount), 0));
          return { receipt: existing, invoice: lockedInvoice, paidAmount, outstandingAmount: Math.max(0, effectiveAmount - paidAmount), existing: true } as const;
        }
      }
      const [receipts, credits] = await Promise.all([
        tx.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, id)),
        tx.select().from(invoiceCreditNotes).where(and(eq(invoiceCreditNotes.invoiceId, id), eq(invoiceCreditNotes.status, "emitida"))),
      ]);
      const paid = receipts.reduce((sum, row) => sum + Number(row.amount), 0);
      const effectiveAmount = Math.max(0, Number(lockedInvoice.netAmount) - credits.reduce((sum, row) => sum + Number(row.amount), 0));
      if (paid + parsed.data.amount > effectiveAmount + 0.01) return { error: "O recebimento ultrapassa o saldo líquido da factura" } as const;
      const [receipt] = await tx.insert(invoiceReceipts).values({ invoiceId: id, amount: parsed.data.amount.toFixed(2), receivedDate: parsed.data.receivedDate, reference: parsed.data.reference, notes: parsed.data.notes, idempotencyKey, createdByUserId: request.currentUser!.id }).returning();
      const totalPaid = paid + parsed.data.amount;
      const status = totalPaid + 0.01 >= effectiveAmount ? "paga" : "parcial";
      const [updated] = await tx.update(projectInvoices).set({ status }).where(eq(projectInvoices.id, id)).returning();
      return { receipt, invoice: updated, paidAmount: totalPaid, outstandingAmount: Math.max(0, effectiveAmount - totalPaid), existing: false } as const;
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    await syncInvoiceReceivable(id);
    if (!result.existing) await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: invoice.projectId, actorUserId: request.currentUser!.id, entityType: "invoice_receipt", entityId: result.receipt.id, action: "received", after: { invoiceId: id, amount: result.receipt.amount, receivedDate: result.receipt.receivedDate, reference: result.receipt.reference, invoiceStatus: result.invoice.status, idempotencyKey } });
    return reply.code(result.existing ? 200 : 201).send(result);
  });

  app.post("/api/invoice-receipts/:id/proof", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [receipt] = await db.select().from(invoiceReceipts).where(eq(invoiceReceipts.id, id)).limit(1);
    if (!receipt) return reply.code(404).send({ error: "Recebimento não encontrado" });
    const invoice = await findInvoice(receipt.invoiceId, request.currentUser!.companyId!);
    if (!invoice) return reply.code(404).send({ error: "Recebimento não encontrado" });
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const buffer = await data.toBuffer();
    const isPdf = buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    const ext = isPdf ? ".pdf" : detectImageExtension(buffer);
    if (!ext) return reply.code(400).send({ error: "Aceite apenas PDF, PNG, JPG, WEBP ou GIF" });
    const uploadDir = path.join(env.uploadsDir, "invoice-receipts");
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, `${randomUUID()}${ext}`);
    await writeFile(filePath, buffer);
    const [updated] = await db.update(invoiceReceipts).set({ proofFilePath: filePath, proofOriginalName: data.filename.slice(0, 300) }).where(eq(invoiceReceipts.id, id)).returning();
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: invoice.projectId, actorUserId: request.currentUser!.id, entityType: "invoice_receipt", entityId: id, action: "proof_attached", after: { originalName: updated.proofOriginalName } });
    return { ...updated, proofUrl: `/api/invoice-receipts/${id}/proof` };
  });

  app.get("/api/invoice-receipts/:id/proof", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [receipt] = await db.select().from(invoiceReceipts).where(eq(invoiceReceipts.id, id)).limit(1);
    if (!receipt?.proofFilePath || !(await findInvoice(receipt.invoiceId, request.currentUser!.companyId!))) return reply.code(404).send({ error: "Comprovativo não encontrado" });
    const buffer = await readFile(receipt.proofFilePath);
    const ext = path.extname(receipt.proofFilePath).toLowerCase();
    const mime = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    return reply.header("Content-Type", mime).send(buffer);
  });

  app.post("/api/invoices/:id/credit-notes", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const invoice = await findInvoice(id, request.currentUser!.companyId!);
    if (!invoice || invoice.status === "rascunho" || invoice.status === "cancelada") return reply.code(409).send({ error: "A nota de crédito exige uma factura emitida" });
    const parsed = z.object({ creditNumber: z.string().trim().min(1).max(80), issueDate: z.string().min(1), amount: z.number().positive(), reason: z.string().trim().min(5).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const paid = await invoicePaidAmount(id);
    const credits = await invoiceCreditAmount(id);
    if (credits + parsed.data.amount > Number(invoice.netAmount) - paid + 0.01) return reply.code(409).send({ error: "A nota de crédito ultrapassa o saldo ainda não recebido" });
    const [note] = await db.insert(invoiceCreditNotes).values({ invoiceId: id, creditNumber: parsed.data.creditNumber, issueDate: parsed.data.issueDate, amount: parsed.data.amount.toFixed(2), reason: parsed.data.reason, createdByUserId: request.currentUser!.id }).returning();
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: invoice.projectId, actorUserId: request.currentUser!.id, entityType: "invoice_credit_note", entityId: note.id, action: "draft_created", after: { invoiceId: id, creditNumber: note.creditNumber, amount: note.amount, reason: note.reason } });
    return reply.code(201).send(note);
  });

  app.put("/api/credit-notes/:id/issue", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [note] = await db.select().from(invoiceCreditNotes).where(eq(invoiceCreditNotes.id, id)).limit(1);
    if (!note) return reply.code(404).send({ error: "Nota de crédito não encontrada" });
    const invoice = await findInvoice(note.invoiceId, request.currentUser!.companyId!);
    if (!invoice) return reply.code(404).send({ error: "Nota de crédito não encontrada" });
    if (note.createdByUserId === request.currentUser!.id) return reply.code(409).send({ error: "Quem preparou a nota de crédito não pode emiti-la" });
    const result = await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`select id from project_invoices where id = ${invoice.id} for update`);
      const [[lockedNote], receipts, credits] = await Promise.all([
        tx.select().from(invoiceCreditNotes).where(eq(invoiceCreditNotes.id, id)).limit(1),
        tx.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, invoice.id)),
        tx.select().from(invoiceCreditNotes).where(and(eq(invoiceCreditNotes.invoiceId, invoice.id), eq(invoiceCreditNotes.status, "emitida"))),
      ]);
      if (!lockedNote || lockedNote.status !== "rascunho") return { error: "A nota de crédito já foi decidida" } as const;
      const paid = receipts.reduce((sum, row) => sum + Number(row.amount), 0);
      const issuedCredits = credits.reduce((sum, row) => sum + Number(row.amount), 0);
      if (issuedCredits + Number(lockedNote.amount) > Number(invoice.netAmount) - paid + 0.01) return { error: "O saldo da factura mudou; reveja o valor da nota de crédito" } as const;
      const [updated] = await tx.update(invoiceCreditNotes).set({ status: "emitida", issuedByUserId: request.currentUser!.id }).where(eq(invoiceCreditNotes.id, id)).returning();
      const effectiveAmount = Math.max(0, Number(invoice.netAmount) - issuedCredits - Number(lockedNote.amount));
      await tx.update(projectInvoices).set({ status: paid + 0.01 >= effectiveAmount ? "paga" : paid > 0 ? "parcial" : "emitida" }).where(eq(projectInvoices.id, invoice.id));
      return { updated } as const;
    });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    const updated = result.updated;
    await syncInvoiceReceivable(invoice.id);
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: invoice.projectId, actorUserId: request.currentUser!.id, entityType: "invoice_credit_note", entityId: id, action: "issued", after: { invoiceId: invoice.id, amount: updated.amount, reason: updated.reason } });
    return updated;
  });
}
