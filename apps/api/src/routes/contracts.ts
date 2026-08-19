import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { contractVariations, invoiceCreditNotes, invoiceReceipts, projectContracts, projectInvoices } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { recordAuditEvent } from "../services/auditTrail.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;
const contractInput = z.object({ contractNumber: z.string().trim().min(1).max(100), clientName: z.string().trim().min(1).max(200), awardDate: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional(), originalAmount: z.number().positive(), advanceAmount: z.number().min(0).default(0), retentionRate: z.number().min(0).max(1).default(0), notes: z.string().max(3000).optional() });

async function contractForProject(projectId: string, companyId: string) {
  if (!(await assertProjectOwned(projectId, companyId))) return null;
  const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.projectId, projectId)).limit(1);
  return contract ?? null;
}

export async function contractRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/contract", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const contract = await contractForProject(projectId, request.currentUser!.companyId!);
    if (!contract) return reply.send(null);
    const variations = await db.select().from(contractVariations).where(eq(contractVariations.contractId, contract.id));
    const approvedVariations = variations.filter((variation) => variation.status === "aprovada").reduce((sum, variation) => sum + Number(variation.amount), 0);
    return { ...contract, variations, approvedVariations, revisedAmount: Number(contract.originalAmount) + approvedVariations };
  });

  app.put("/api/projects/:projectId/contract", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    if (!(await assertProjectOwned(projectId, request.currentUser!.companyId!))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = contractInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [existing] = await db.select().from(projectContracts).where(eq(projectContracts.projectId, projectId)).limit(1);
    if (existing?.status === "activo" || existing?.status === "concluido") return reply.code(409).send({ error: "O contrato activo não pode ser reescrito; use uma adenda" });
    const values = { ...parsed.data, originalAmount: parsed.data.originalAmount.toFixed(2), advanceAmount: parsed.data.advanceAmount.toFixed(2), retentionRate: parsed.data.retentionRate.toString(), currency: (await assertProjectOwned(projectId, request.currentUser!.companyId!))!.currency, createdByUserId: existing?.createdByUserId ?? request.currentUser!.id };
    const [contract] = existing
      ? await db.update(projectContracts).set(values).where(eq(projectContracts.id, existing.id)).returning()
      : await db.insert(projectContracts).values({ ...values, projectId }).returning();
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId, actorUserId: request.currentUser!.id, entityType: "contract", entityId: contract.id, action: existing ? "updated" : "created", after: { contractNumber: contract.contractNumber, originalAmount: contract.originalAmount } });
    return contract;
  });

  app.put("/api/contracts/:id/status", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.id, id)).limit(1);
    if (!contract || !(await assertProjectOwned(contract.projectId, request.currentUser!.companyId!))) return reply.code(404).send({ error: "Contrato não encontrado" });
    const parsed = z.object({ status: z.enum(["activo", "concluido", "cancelado"]), decisionNote: z.string().max(1000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (contract.createdByUserId === request.currentUser!.id && parsed.data.status === "activo") return reply.code(409).send({ error: "Quem preparou o contrato não pode activá-lo" });
    const [updated] = await db.update(projectContracts).set({ status: parsed.data.status, approvedByUserId: parsed.data.status === "activo" ? request.currentUser!.id : contract.approvedByUserId, notes: parsed.data.decisionNote ? `${contract.notes ?? ""}\n${parsed.data.decisionNote}`.trim() : contract.notes }).where(eq(projectContracts.id, id)).returning();
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: contract.projectId, actorUserId: request.currentUser!.id, entityType: "contract", entityId: id, action: `status.${updated.status}` });
    return updated;
  });

  app.post("/api/contracts/:id/variations", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.id, id)).limit(1);
    if (!contract || !(await assertProjectOwned(contract.projectId, request.currentUser!.companyId!))) return reply.code(404).send({ error: "Contrato não encontrado" });
    if (contract.status !== "activo") return reply.code(409).send({ error: "Active o contrato antes de criar uma adenda" });
    const parsed = z.object({ title: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(3000), amount: z.number(), impactDays: z.number().int().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [variation] = await db.insert(contractVariations).values({ contractId: id, title: parsed.data.title, reason: parsed.data.reason, amount: parsed.data.amount.toFixed(2), impactDays: parsed.data.impactDays ?? 0 }).returning();
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: contract.projectId, actorUserId: request.currentUser!.id, entityType: "contract_variation", entityId: variation.id, action: "created", after: { title: variation.title, amount: variation.amount } });
    return reply.code(201).send(variation);
  });

  app.put("/api/contract-variations/:id/status", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [variation] = await db.select().from(contractVariations).where(eq(contractVariations.id, id)).limit(1);
    if (!variation) return reply.code(404).send({ error: "Adenda não encontrada" });
    const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.id, variation.contractId)).limit(1);
    if (!contract || !(await assertProjectOwned(contract.projectId, request.currentUser!.companyId!))) return reply.code(404).send({ error: "Adenda não encontrada" });
    const parsed = z.object({ status: z.enum(["submetida", "aprovada", "rejeitada"]), decisionNote: z.string().max(1000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [updated] = await db.update(contractVariations).set({ status: parsed.data.status, submittedByUserId: parsed.data.status === "submetida" ? request.currentUser!.id : variation.submittedByUserId, approvedByUserId: parsed.data.status === "aprovada" ? request.currentUser!.id : variation.approvedByUserId, decisionNote: parsed.data.decisionNote }).where(eq(contractVariations.id, id)).returning();
    await recordAuditEvent({ companyId: request.currentUser!.companyId!, projectId: contract.projectId, actorUserId: request.currentUser!.id, entityType: "contract_variation", entityId: id, action: `status.${updated.status}` });
    return updated;
  });

  app.get("/api/projects/:projectId/client-statement", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const contract = await contractForProject(projectId, request.currentUser!.companyId!);
    if (!contract) return reply.code(404).send({ error: "Configure primeiro o contrato" });
    const invoices = await db.select().from(projectInvoices).where(eq(projectInvoices.projectId, projectId));
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const [receipts, creditNotes] = invoiceIds.length
      ? await Promise.all([
          db.select().from(invoiceReceipts).where(inArray(invoiceReceipts.invoiceId, invoiceIds)),
          db.select().from(invoiceCreditNotes).where(inArray(invoiceCreditNotes.invoiceId, invoiceIds)),
        ])
      : [[], []];
    const receiptByInvoice = new Map<string, number>();
    const creditByInvoice = new Map<string, number>();
    for (const receipt of receipts) receiptByInvoice.set(receipt.invoiceId, (receiptByInvoice.get(receipt.invoiceId) ?? 0) + Number(receipt.amount));
    for (const note of creditNotes) if (note.status === "emitida") creditByInvoice.set(note.invoiceId, (creditByInvoice.get(note.invoiceId) ?? 0) + Number(note.amount));
    const lines = invoices.filter((invoice) => invoice.status !== "rascunho" && invoice.status !== "cancelada").map((invoice) => ({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, issueDate: invoice.issueDate, dueDate: invoice.dueDate, netAmount: Number(invoice.netAmount), creditAmount: creditByInvoice.get(invoice.id) ?? 0, paidAmount: receiptByInvoice.get(invoice.id) ?? 0, outstandingAmount: Math.max(0, Number(invoice.netAmount) - (creditByInvoice.get(invoice.id) ?? 0) - (receiptByInvoice.get(invoice.id) ?? 0)), status: invoice.status }));
    const approvedVariations = (await db.select().from(contractVariations).where(and(eq(contractVariations.contractId, contract.id), eq(contractVariations.status, "aprovada")))).reduce((sum, variation) => sum + Number(variation.amount), 0);
    return { currency: contract.currency, contract: { originalAmount: Number(contract.originalAmount), approvedVariations, revisedAmount: Number(contract.originalAmount) + approvedVariations, advanceAmount: Number(contract.advanceAmount), retentionRate: Number(contract.retentionRate) }, lines, totals: { invoiced: lines.reduce((sum, line) => sum + line.netAmount, 0), credited: lines.reduce((sum, line) => sum + line.creditAmount, 0), received: lines.reduce((sum, line) => sum + line.paidAmount, 0), outstanding: lines.reduce((sum, line) => sum + line.outstandingAmount, 0) } };
  });
}
