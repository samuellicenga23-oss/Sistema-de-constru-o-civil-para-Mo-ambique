import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  companies,
  materials,
  procurementAwardLines,
  procurementAwards,
  procurementDocumentSequences,
  procurementRfqInvitations,
  procurementRfqLines,
  procurementRfqs,
  procurementSupplierQuoteLines,
  procurementSupplierQuotes,
  projects,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequisitionLines,
  purchaseRequisitions,
  scheduleTasks,
  suppliers,
  users,
} from "../db/schema.js";
import { requireCompanyUser, requirePermission } from "../auth/middleware.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { assertApprovedOrcamentoForSite } from "../services/siteGate.js";
import { assertSupplierMarketplaceAccess } from "../services/subscriptionEntitlements.js";
import { assertVendorNotBlocked } from "../services/vendorGovernance.js";
import { assertMatrixApproval } from "../services/companyApproval.js";
import { resolveEffectiveVendorGovernance } from "../services/companyVendorGovernance.js";
import { notifySupplierAccount, notifyUsers } from "../services/notifications.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { emitWorkflowEvent } from "../services/workflowEvents.js";
import {
  buildQuoteComparison,
  groupAllocationsBySupplier,
  quoteLineNetUnitCost,
  requiresDecisionReason,
  validateAwardAllocations,
  type RfqLineSnapshot,
  type SupplierQuoteSnapshot,
} from "../services/procurementWorkflow.js";

const canRequestMaterials = requirePermission("materiais.requisitar");
const canApproveMaterials = requirePermission("materiais.aprovar");

function companyIdOf(request: FastifyRequest) {
  return request.currentUser!.companyId!;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function nextReference(
  tx: any,
  companyId: string,
  kind: "RC" | "RFQ",
) {
  const year = new Date().getUTCFullYear();
  const [row] = await tx
    .insert(procurementDocumentSequences)
    .values({ companyId, kind, year, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [procurementDocumentSequences.companyId, procurementDocumentSequences.kind, procurementDocumentSequences.year],
      set: { nextNumber: sql`${procurementDocumentSequences.nextNumber} + 1` },
    })
    .returning({ nextNumber: procurementDocumentSequences.nextNumber });
  const number = Math.max(1, row.nextNumber - 1);
  return `${kind}-${year}-${String(number).padStart(4, "0")}`;
}

async function requisitionOwned(id: string, companyId: string) {
  const [row] = await db
    .select()
    .from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function rfqOwned(id: string, companyId: string) {
  const [row] = await db
    .select()
    .from(procurementRfqs)
    .where(and(eq(procurementRfqs.id, id), eq(procurementRfqs.companyId, companyId)))
    .limit(1);
  return row ?? null;
}

async function supplierIdsOwnedByAccount(accountId: string) {
  const rows = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.supplierAccountId, accountId));
  return rows.map((row) => row.id);
}

async function notifyCompanyUsers(companyId: string, title: string, body: string, link: string) {
  const rows = await db.select({ id: users.id, role: users.role, permissions: users.permissions }).from(users).where(and(eq(users.companyId, companyId), eq(users.isActive, true)));
  const recipients = rows
    .filter((row) => row.role === "admin_empresa" || row.role === "orcamentista" || row.permissions.includes("materiais.aprovar") || row.permissions.includes("materiais.requisitar"))
    .map((row) => row.id);
  await notifyUsers(recipients, title, body, link);
}

async function loadRfqLines(rfqId: string) {
  return db
    .select({
      line: procurementRfqLines,
      materialName: materials.name,
      materialUnit: materials.unit,
    })
    .from(procurementRfqLines)
    .innerJoin(materials, eq(procurementRfqLines.materialId, materials.id))
    .where(eq(procurementRfqLines.rfqId, rfqId))
    .orderBy(procurementRfqLines.sortOrder);
}

async function loadSubmittedQuotes(rfqId: string): Promise<SupplierQuoteSnapshot[]> {
  const quoteRows = await db
    .select({ quote: procurementSupplierQuotes, supplierName: suppliers.name })
    .from(procurementSupplierQuotes)
    .innerJoin(suppliers, eq(procurementSupplierQuotes.supplierId, suppliers.id))
    .where(and(eq(procurementSupplierQuotes.rfqId, rfqId), eq(procurementSupplierQuotes.status, "submetida")))
    .orderBy(procurementSupplierQuotes.createdAt);

  const quoteIds = quoteRows.map((row) => row.quote.id);
  const lines = quoteIds.length
    ? await db.select().from(procurementSupplierQuoteLines).where(inArray(procurementSupplierQuoteLines.quoteId, quoteIds))
    : [];
  const linesByQuote = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesByQuote.get(line.quoteId) ?? [];
    list.push(line);
    linesByQuote.set(line.quoteId, list);
  }

  return quoteRows.map(({ quote, supplierName }) => ({
    id: quote.id,
    supplierId: quote.supplierId,
    supplierName,
    currency: quote.currency,
    transportCost: Number(quote.transportCost),
    transportIncluded: quote.transportIncluded,
    leadTimeDays: quote.leadTimeDays,
    paymentTerms: quote.paymentTerms,
    validUntil: quote.validUntil,
    status: quote.status,
    version: quote.version,
    lines: (linesByQuote.get(quote.id) ?? []).map((line) => ({
      rfqLineId: line.rfqLineId,
      quantityOffered: Number(line.quantityOffered),
      unitCost: Number(line.unitCost),
      discountPct: Number(line.discountPct),
      leadTimeDays: line.leadTimeDays,
      available: line.available,
    })),
  }));
}

const requisitionLineInput = z.object({
  materialId: z.string().uuid(),
  quantity: z.number().positive(),
  specification: z.string().trim().max(3000).optional(),
  notes: z.string().trim().max(1000).optional(),
  sourceScheduleTaskId: z.string().uuid().nullable().optional(),
});

const createRequisitionInput = z.object({
  priority: z.enum(["baixa", "normal", "alta", "urgente"]).default("normal"),
  requiredByDate: z.string().optional().nullable(),
  scheduleTaskId: z.string().uuid().nullable().optional(),
  justification: z.string().trim().max(3000).optional(),
  notes: z.string().trim().max(3000).optional(),
  source: z.enum(["manual", "plano_compras", "cronograma"]).default("manual"),
  lines: z.array(requisitionLineInput).min(1).max(200),
});

const createRfqInput = z.object({
  title: z.string().trim().min(3).max(240),
  message: z.string().trim().max(5000).optional(),
  supplierIds: z.array(z.string().uuid()).min(1).max(30),
  deadlineDate: z.string().min(1),
  deliveryLocation: z.string().trim().max(1000).optional(),
  requiredByDate: z.string().optional().nullable(),
  allowPartialQuotes: z.boolean().default(false),
  allowPartialAward: z.boolean().default(false),
  paymentRequirements: z.string().trim().max(3000).optional(),
  commercialTerms: z.string().trim().max(5000).optional(),
  singleSourceJustification: z.string().trim().max(3000).optional(),
});

const submitSupplierQuoteInput = z.object({
  validUntil: z.string().optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  paymentTerms: z.string().trim().max(2000).optional(),
  transportIncluded: z.boolean().default(true),
  transportCost: z.number().nonnegative().default(0),
  supplierNotes: z.string().trim().max(3000).optional(),
  lines: z.array(z.object({
    rfqLineId: z.string().uuid(),
    available: z.boolean().default(true),
    quantityOffered: z.number().nonnegative(),
    unitCost: z.number().nonnegative(),
    discountPct: z.number().min(0).max(100).default(0),
    brand: z.string().trim().max(160).optional(),
    leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
    notes: z.string().trim().max(1000).optional(),
  })).min(1).max(200),
});

const awardInput = z.object({
  decisionReason: z.string().trim().min(8).max(5000),
  allocations: z.array(z.object({
    rfqLineId: z.string().uuid(),
    quoteId: z.string().uuid(),
    quantityAwarded: z.number().positive(),
  })).min(1).max(500),
});

export async function procurementWorkflowRoutes(app: FastifyInstance) {
  // ---------- Empresa / obra: Requisições ----------
  app.get("/api/projects/:projectId/procurement/requisitions", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });

    const rows = await db.select().from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.projectId, projectId), eq(purchaseRequisitions.companyId, companyId)))
      .orderBy(desc(purchaseRequisitions.createdAt));
    const ids = rows.map((row) => row.id);
    const lines = ids.length
      ? await db.select({ line: purchaseRequisitionLines, materialName: materials.name, unit: materials.unit })
          .from(purchaseRequisitionLines)
          .innerJoin(materials, eq(purchaseRequisitionLines.materialId, materials.id))
          .where(inArray(purchaseRequisitionLines.requisitionId, ids))
      : [];
    return rows.map((row) => ({
      ...row,
      lines: lines.filter((entry) => entry.line.requisitionId === row.id).map((entry) => ({ ...entry.line, materialName: entry.materialName, unit: entry.unit })),
    }));
  });

  app.post("/api/projects/:projectId/procurement/requisitions", { preHandler: canRequestMaterials }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const gate = await assertApprovedOrcamentoForSite(projectId, companyId);
    if (!gate.ok) return reply.code(gate.status).send({ error: gate.error });
    const parsed = createRequisitionInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (new Set(parsed.data.lines.map((line) => line.materialId)).size !== parsed.data.lines.length) {
      return reply.code(400).send({ error: "Agrupe o mesmo material numa única linha da requisição" });
    }
    if (parsed.data.requiredByDate && parsed.data.requiredByDate < today()) {
      return reply.code(400).send({ error: "A data em que o material é necessário não pode estar no passado" });
    }
    const scheduleTaskIds = [...new Set([
      parsed.data.scheduleTaskId,
      ...parsed.data.lines.map((line) => line.sourceScheduleTaskId),
    ].filter((value): value is string => Boolean(value)))];
    if (scheduleTaskIds.length) {
      const taskRows = await db.select({ id: scheduleTasks.id }).from(scheduleTasks)
        .where(and(inArray(scheduleTasks.id, scheduleTaskIds), eq(scheduleTasks.projectId, projectId)));
      if (taskRows.length !== scheduleTaskIds.length) return reply.code(400).send({ error: "Uma ou mais actividades indicadas não pertencem ao cronograma desta obra" });
    }

    const materialIds = parsed.data.lines.map((line) => line.materialId);
    const materialRows = await db.select({ id: materials.id }).from(materials)
      .where(and(inArray(materials.id, materialIds), or(isNull(materials.companyId), eq(materials.companyId, companyId))));
    if (materialRows.length !== materialIds.length) return reply.code(404).send({ error: "Um ou mais materiais não existem no catálogo desta empresa" });

    const created = await db.transaction(async (tx) => {
      const reference = await nextReference(tx, companyId, "RC");
      const [requisition] = await tx.insert(purchaseRequisitions).values({
        companyId,
        projectId,
        reference,
        status: "rascunho",
        source: parsed.data.source,
        priority: parsed.data.priority,
        requiredByDate: parsed.data.requiredByDate || null,
        scheduleTaskId: parsed.data.scheduleTaskId ?? null,
        justification: parsed.data.justification ?? null,
        notes: parsed.data.notes ?? null,
        createdByUserId: request.currentUser!.id,
      }).returning();
      await tx.insert(purchaseRequisitionLines).values(parsed.data.lines.map((line, index) => ({
        requisitionId: requisition.id,
        materialId: line.materialId,
        requestedQty: line.quantity.toString(),
        specification: line.specification ?? null,
        notes: line.notes ?? null,
        sourceScheduleTaskId: line.sourceScheduleTaskId ?? null,
        sortOrder: index,
      })));
      return requisition;
    });
    await recordAuditEvent({ companyId, projectId, actorUserId: request.currentUser!.id, entityType: "purchase_requisition", entityId: created.id, action: "created", after: { reference: created.reference, status: created.status, lineCount: parsed.data.lines.length } });
    return reply.code(201).send(created);
  });

  app.post("/api/procurement/requisitions/:id/submit", { preHandler: canRequestMaterials }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const row = await requisitionOwned(id, companyId);
    if (!row) return reply.code(404).send({ error: "Requisição não encontrada" });
    if (row.status !== "rascunho") return reply.code(409).send({ error: "Só uma requisição em rascunho pode ser submetida" });
    const [updated] = await db.update(purchaseRequisitions).set({ status: "submetida", submittedAt: new Date(), submittedByUserId: request.currentUser!.id, updatedAt: new Date() }).where(eq(purchaseRequisitions.id, id)).returning();
    await emitWorkflowEvent({
      event: "requisition.submitted",
      companyId,
      entityId: id,
      title: updated.reference,
      link: `/projectos/${updated.projectId}/compras`,
      actor: { id: request.currentUser!.id, name: request.currentUser!.name, email: request.currentUser!.email },
      logger: request.log,
    });
    return updated;
  });

  app.post("/api/procurement/requisitions/:id/approve", { preHandler: canApproveMaterials }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const row = await requisitionOwned(id, companyId);
    if (!row) return reply.code(404).send({ error: "Requisição não encontrada" });
    if (row.status !== "submetida") return reply.code(409).send({ error: "Só uma requisição submetida pode ser aprovada" });
    const user = request.currentUser!;
    const decision = await assertMatrixApproval({
      companyId,
      entityType: "requisicao",
      role: user.role,
      permissions: user.permissions ?? [],
      isSubmitter: (row.submittedByUserId ?? row.createdByUserId) === user.id,
    });
    if (!decision.ok) return reply.code(decision.status).send({ error: decision.error });
    const [updated] = await db.update(purchaseRequisitions).set({ status: "aprovada", approvedAt: new Date(), approvedByUserId: user.id, updatedAt: new Date() }).where(eq(purchaseRequisitions.id, id)).returning();
    await recordAuditEvent({ companyId, projectId: row.projectId, actorUserId: user.id, entityType: "purchase_requisition", entityId: id, action: "approved", before: { status: row.status }, after: { status: updated.status } });
    await emitWorkflowEvent({
      event: "requisition.approved",
      companyId,
      entityId: id,
      title: updated.reference,
      link: `/projectos/${updated.projectId}/compras`,
      actor: { id: user.id, name: user.name, email: user.email },
      submitterUserId: row.submittedByUserId ?? row.createdByUserId,
      logger: request.log,
    });
    return updated;
  });

  app.post("/api/procurement/requisitions/:id/return", { preHandler: canApproveMaterials }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const parsed = z.object({ reason: z.string().trim().min(3).max(1000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const row = await requisitionOwned(id, companyId);
    if (!row) return reply.code(404).send({ error: "Requisição não encontrada" });
    if (row.status !== "submetida") return reply.code(409).send({ error: "Só uma requisição submetida pode ser devolvida" });
    const [updated] = await db.update(purchaseRequisitions).set({ status: "rascunho", submittedAt: null, submittedByUserId: null, notes: parsed.data.reason, updatedAt: new Date() }).where(eq(purchaseRequisitions.id, id)).returning();
    await recordAuditEvent({ companyId, projectId: row.projectId, actorUserId: request.currentUser!.id, entityType: "purchase_requisition", entityId: id, action: "returned", before: { status: row.status }, after: { status: updated.status }, metadata: { reason: parsed.data.reason } });
    await emitWorkflowEvent({
      event: "requisition.returned",
      companyId,
      entityId: id,
      title: updated.reference,
      link: `/projectos/${updated.projectId}/compras`,
      actor: { id: request.currentUser!.id, name: request.currentUser!.name, email: request.currentUser!.email },
      submitterUserId: row.submittedByUserId ?? row.createdByUserId,
      reason: parsed.data.reason,
      logger: request.log,
    });
    return updated;
  });

  // ---------- Empresa / obra: RFQ multi-fornecedor ----------
  app.post("/api/procurement/requisitions/:id/rfqs", { preHandler: canRequestMaterials }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const requisition = await requisitionOwned(id, companyId);
    if (!requisition) return reply.code(404).send({ error: "Requisição não encontrada" });
    if (requisition.status !== "aprovada") return reply.code(409).send({ error: "A requisição deve estar aprovada antes de abrir cotação" });
    const parsed = createRfqInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const supplierIds = [...new Set(parsed.data.supplierIds)];
    if (parsed.data.deadlineDate < today()) return reply.code(400).send({ error: "O prazo de resposta da RFQ não pode estar no passado" });
    const effectiveRequiredBy = parsed.data.requiredByDate || requisition.requiredByDate;
    if (effectiveRequiredBy && parsed.data.deadlineDate > effectiveRequiredBy) {
      return reply.code(400).send({ error: "O prazo para responder à RFQ não pode ser posterior à data em que o material é necessário em obra" });
    }
    if (supplierIds.length === 1 && !parsed.data.singleSourceJustification?.trim()) {
      return reply.code(400).send({ error: "Indique a justificação de fonte única quando apenas um fornecedor é convidado" });
    }
    const marketplaceBlocked = await assertSupplierMarketplaceAccess(companyId);
    if (marketplaceBlocked) return reply.code(402).send(marketplaceBlocked);
    const supplierRows = await db.select().from(suppliers)
      .where(and(inArray(suppliers.id, supplierIds), isNull(suppliers.companyId)));
    if (supplierRows.length !== supplierIds.length || supplierRows.some((supplier) => !supplier.supplierAccountId)) {
      return reply.code(409).send({ error: "Todas as RFQs formais devem ser enviadas a fornecedores reais com conta activa no Portal do Fornecedor" });
    }
    for (const supplier of supplierRows) {
      const governance = await resolveEffectiveVendorGovernance(companyId, supplier);
      try { assertVendorNotBlocked(governance.governanceStatus, governance.blockedReason); } catch (cause) {
        return reply.code(409).send({ error: cause instanceof Error ? cause.message : "Fornecedor bloqueado" });
      }
    }
    const requisitionLines = await db.select({ line: purchaseRequisitionLines, materialName: materials.name, unit: materials.unit })
      .from(purchaseRequisitionLines)
      .innerJoin(materials, eq(purchaseRequisitionLines.materialId, materials.id))
      .where(eq(purchaseRequisitionLines.requisitionId, id))
      .orderBy(purchaseRequisitionLines.sortOrder);
    if (!requisitionLines.length) return reply.code(409).send({ error: "A requisição não tem linhas" });

    let rfq: typeof procurementRfqs.$inferSelect;
    try {
      rfq = await db.transaction(async (tx) => {
      // Serializa a passagem aprovada -> em_cotacao: duas janelas/browser não podem abrir
      // duas RFQs concorrentes para a mesma requisição por acidente.
      await tx.execute(sql`select id from purchase_requisitions where id = ${requisition.id} for update`);
      const [lockedRequisition] = await tx.select({ status: purchaseRequisitions.status }).from(purchaseRequisitions).where(eq(purchaseRequisitions.id, requisition.id)).limit(1);
      if (!lockedRequisition || lockedRequisition.status !== "aprovada") throw new Error("A requisição já deixou de estar disponível para abrir uma nova RFQ");
      const reference = await nextReference(tx, companyId, "RFQ");
      const [created] = await tx.insert(procurementRfqs).values({
        companyId,
        projectId: requisition.projectId,
        requisitionId: requisition.id,
        reference,
        title: parsed.data.title,
        message: parsed.data.message ?? null,
        status: "aberta",
        deadlineDate: parsed.data.deadlineDate,
        deliveryLocation: parsed.data.deliveryLocation ?? null,
        requiredByDate: effectiveRequiredBy,
        currency: (await tx.select({ currency: projects.currency }).from(projects).where(eq(projects.id, requisition.projectId)).limit(1))[0]?.currency ?? "MZN",
        allowPartialQuotes: parsed.data.allowPartialQuotes,
        allowPartialAward: parsed.data.allowPartialAward,
        paymentRequirements: parsed.data.paymentRequirements ?? null,
        commercialTerms: [parsed.data.commercialTerms, parsed.data.singleSourceJustification ? `Fonte única: ${parsed.data.singleSourceJustification}` : null].filter(Boolean).join("\n\n") || null,
        createdByUserId: request.currentUser!.id,
        openedAt: new Date(),
      }).returning();
      await tx.insert(procurementRfqLines).values(requisitionLines.map((entry, index) => ({
        rfqId: created.id,
        requisitionLineId: entry.line.id,
        materialId: entry.line.materialId,
        description: entry.materialName,
        unit: entry.unit,
        quantity: entry.line.requestedQty,
        specification: entry.line.specification,
        requiredByDate: requisition.requiredByDate,
        sortOrder: index,
      })));
      await tx.insert(procurementRfqInvitations).values(supplierRows.map((supplier) => ({ rfqId: created.id, supplierId: supplier.id, status: "convidado" as const })));
      await tx.update(purchaseRequisitions).set({ status: "em_cotacao", updatedAt: new Date() }).where(eq(purchaseRequisitions.id, requisition.id));
      return created;
      });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível abrir a RFQ" });
    }

    for (const supplier of supplierRows) {
      if (supplier.supplierAccountId) {
        await notifySupplierAccount(supplier.supplierAccountId, "Nova oportunidade de cotação", `${rfq.reference} — ${rfq.title}. Responda até ${rfq.deadlineDate}.`, `/oportunidades/${rfq.id}`);
      }
    }
    await recordAuditEvent({ companyId, projectId: requisition.projectId, actorUserId: request.currentUser!.id, entityType: "procurement_rfq", entityId: rfq.id, action: "opened", after: { reference: rfq.reference, supplierCount: supplierRows.length, requisitionId: requisition.id } });
    return reply.code(201).send(rfq);
  });

  app.get("/api/projects/:projectId/procurement/rfqs", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    if (!(await assertProjectOwned(projectId, companyId))) return reply.code(404).send({ error: "Projecto não encontrado" });
    const rows = await db.select().from(procurementRfqs)
      .where(and(eq(procurementRfqs.projectId, projectId), eq(procurementRfqs.companyId, companyId)))
      .orderBy(desc(procurementRfqs.createdAt));
    const ids = rows.map((row) => row.id);
    const invitations = ids.length ? await db.select().from(procurementRfqInvitations).where(inArray(procurementRfqInvitations.rfqId, ids)) : [];
    const quotes = ids.length ? await db.select().from(procurementSupplierQuotes).where(and(inArray(procurementSupplierQuotes.rfqId, ids), eq(procurementSupplierQuotes.status, "submetida"))) : [];
    return rows.map((row) => ({ ...row, invitationCount: invitations.filter((x) => x.rfqId === row.id).length, responseCount: quotes.filter((x) => x.rfqId === row.id).length }));
  });

  app.get("/api/procurement/rfqs/:id/comparison", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const rfq = await rfqOwned(id, companyId);
    if (!rfq) return reply.code(404).send({ error: "RFQ não encontrada" });
    const lineRows = await loadRfqLines(id);
    const lines: RfqLineSnapshot[] = lineRows.map((entry) => ({ id: entry.line.id, description: entry.line.description, quantity: Number(entry.line.quantity), unit: entry.line.unit }));
    const quotes = await loadSubmittedQuotes(id);
    const comparison = buildQuoteComparison(lines, quotes, rfq.currency, today());
    return { rfq, lines: lineRows.map((entry) => ({ ...entry.line, materialName: entry.materialName, materialUnit: entry.materialUnit })), comparison, quotes };
  });

  app.post("/api/procurement/rfqs/:id/award", { preHandler: canApproveMaterials }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = companyIdOf(request);
    const rfq = await rfqOwned(id, companyId);
    if (!rfq) return reply.code(404).send({ error: "RFQ não encontrada" });
    if (rfq.status !== "aberta" && rfq.status !== "em_avaliacao") return reply.code(409).send({ error: "Esta RFQ já não pode ser adjudicada" });
    const parsed = awardInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const lineRows = await loadRfqLines(id);
    const rfqLines: RfqLineSnapshot[] = lineRows.map((entry) => ({ id: entry.line.id, description: entry.line.description, quantity: Number(entry.line.quantity), unit: entry.line.unit }));
    const quotes = await loadSubmittedQuotes(id);
    const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
    let allocations;
    let validation;
    try {
      allocations = parsed.data.allocations.map((allocation) => {
        const quote = quoteById.get(allocation.quoteId);
        const quoteLine = quote?.lines.find((line) => line.rfqLineId === allocation.rfqLineId && line.available !== false);
        if (!quote || !quoteLine) throw new Error("Uma das linhas adjudicadas não existe na proposta submetida");
        return {
          rfqLineId: allocation.rfqLineId,
          quoteId: allocation.quoteId,
          supplierId: quote.supplierId,
          quantityAwarded: allocation.quantityAwarded,
          unitCost: quoteLineNetUnitCost(quoteLine),
        };
      });
      validation = validateAwardAllocations(rfqLines, quotes, allocations, rfq.allowPartialAward, today());
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Adjudicação inválida" });
    }
    const comparison = buildQuoteComparison(rfqLines, quotes, rfq.currency, today());
    if (requiresDecisionReason(comparison, validation.supplierIds) && parsed.data.decisionReason.trim().length < 15) {
      return reply.code(400).send({ error: "Justifique claramente a decisão quando não selecciona apenas a proposta de menor custo" });
    }
    const lineById = new Map(lineRows.map((entry) => [entry.line.id, entry.line]));
    const grouped = groupAllocationsBySupplier(allocations);
    for (const supplierAllocations of grouped.values()) {
      const quoteIds = new Set(supplierAllocations.map((allocation) => allocation.quoteId));
      if (quoteIds.size !== 1) return reply.code(409).send({ error: "Cada fornecedor deve ser adjudicado a partir de uma única versão de proposta" });
    }

    let createdOrders: Array<typeof purchaseOrders.$inferSelect>;
    try {
      createdOrders = await db.transaction(async (tx) => {
      // Award é uma operação de fecho: serializa com novas versões de propostas e impede dupla
      // adjudicação por pedidos simultâneos.
      await tx.execute(sql`select id from procurement_rfqs where id = ${id} for update`);
      const [lockedRfq] = await tx.select({ status: procurementRfqs.status }).from(procurementRfqs).where(eq(procurementRfqs.id, id)).limit(1);
      if (!lockedRfq || (lockedRfq.status !== "aberta" && lockedRfq.status !== "em_avaliacao")) throw new Error("Esta RFQ já não pode ser adjudicada");
      const results: Array<typeof purchaseOrders.$inferSelect> = [];
      for (const [supplierId, supplierAllocations] of grouped) {
        const firstQuoteId = supplierAllocations[0].quoteId;
        const quote = quoteById.get(firstQuoteId)!;
        const [award] = await tx.insert(procurementAwards).values({
          rfqId: id,
          supplierQuoteId: quote.id,
          supplierId,
          decisionReason: parsed.data.decisionReason,
          awardedByUserId: request.currentUser!.id,
        }).returning();

        const quoteLineRows = await tx.select().from(procurementSupplierQuoteLines).where(eq(procurementSupplierQuoteLines.quoteId, quote.id));
        const quoteLineByRfqLine = new Map(quoteLineRows.map((line) => [line.rfqLineId, line]));
        await tx.insert(procurementAwardLines).values(supplierAllocations.map((allocation) => {
          const rfqLine = lineById.get(allocation.rfqLineId)!;
          const quoteLine = quoteLineByRfqLine.get(allocation.rfqLineId)!;
          return {
            awardId: award.id,
            rfqLineId: allocation.rfqLineId,
            quoteLineId: quoteLine.id,
            materialId: rfqLine.materialId,
            quantityAwarded: allocation.quantityAwarded.toString(),
            unitCost: allocation.unitCost.toFixed(4),
            currency: rfq.currency,
          };
        }));

        const [order] = await tx.insert(purchaseOrders).values({
          projectId: rfq.projectId,
          supplierId,
          status: "rascunho",
          orderDate: today(),
          requiredByDate: rfq.requiredByDate,
          procurementAwardId: award.id,
          purchaseRequisitionId: rfq.requisitionId,
          // Se o fornecedor cotou transporte à parte, este valor acompanha a OC e entra no
          // compromisso financeiro. Quando transporte está incluído, fica 0.
          transportCost: (quote.transportIncluded ? 0 : quote.transportCost).toFixed(2),
          notes: `Gerada automaticamente por adjudicação ${rfq.reference}. ${parsed.data.decisionReason}`,
          ivaRate: (await tx.select({ ivaRate: projects.ivaRate }).from(projects).where(eq(projects.id, rfq.projectId)).limit(1))[0]?.ivaRate ?? "0.16",
          createdByUserId: request.currentUser!.id,
        }).returning();
        await tx.insert(purchaseOrderLines).values(supplierAllocations.map((allocation) => {
          const rfqLine = lineById.get(allocation.rfqLineId)!;
          return {
            purchaseOrderId: order.id,
            materialId: rfqLine.materialId,
            quantity: allocation.quantityAwarded.toString(),
            unitCost: allocation.unitCost.toFixed(4),
            currency: rfq.currency,
          };
        }));
        results.push(order);
      }
      await tx.update(procurementRfqs).set({ status: "adjudicada", closedAt: new Date(), updatedAt: new Date() }).where(eq(procurementRfqs.id, id));
      if (rfq.requisitionId) {
        await tx.update(purchaseRequisitions).set({ status: "adjudicada", updatedAt: new Date() }).where(eq(purchaseRequisitions.id, rfq.requisitionId));
      }
      return results;
      });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível concluir a adjudicação" });
    }

    for (const order of createdOrders) {
      const [supplier] = await db.select({ supplierAccountId: suppliers.supplierAccountId }).from(suppliers).where(eq(suppliers.id, order.supplierId)).limit(1);
      if (supplier?.supplierAccountId) {
        await notifySupplierAccount(supplier.supplierAccountId, "Cotação adjudicada", `${rfq.reference} foi adjudicada à sua empresa. Foi criada uma Ordem de Compra no SIGO.`, "/painel");
      }
    }
    await recordAuditEvent({ companyId, projectId: rfq.projectId, actorUserId: request.currentUser!.id, entityType: "procurement_rfq", entityId: id, action: "awarded", after: { supplierIds: validation.supplierIds, orderIds: createdOrders.map((order) => order.id), reason: parsed.data.decisionReason } });
    return { rfqId: id, status: "adjudicada", purchaseOrders: createdOrders };
  });

  // ---------- Portal do Fornecedor: oportunidades e propostas versionadas ----------
  app.get("/api/supplier/procurement/rfqs", { preHandler: requireSupplierAuth }, async (request) => {
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    if (!supplierIds.length) return [];
    const rows = await db
      .select({ invitation: procurementRfqInvitations, rfq: procurementRfqs, companyName: companies.name, projectName: projects.name, supplierName: suppliers.name })
      .from(procurementRfqInvitations)
      .innerJoin(procurementRfqs, eq(procurementRfqInvitations.rfqId, procurementRfqs.id))
      .innerJoin(companies, eq(procurementRfqs.companyId, companies.id))
      .innerJoin(projects, eq(procurementRfqs.projectId, projects.id))
      .innerJoin(suppliers, eq(procurementRfqInvitations.supplierId, suppliers.id))
      .where(inArray(procurementRfqInvitations.supplierId, supplierIds))
      .orderBy(desc(procurementRfqs.createdAt));
    return rows.map((row) => ({ ...row.rfq, invitationId: row.invitation.id, invitationStatus: row.invitation.status, companyName: row.companyName, projectName: row.projectName, supplierName: row.supplierName }));
  });

  app.get("/api/supplier/procurement/rfqs/:id", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    const [row] = await db
      .select({ invitation: procurementRfqInvitations, rfq: procurementRfqs, companyName: companies.name, projectName: projects.name, buyerName: users.name })
      .from(procurementRfqInvitations)
      .innerJoin(procurementRfqs, eq(procurementRfqInvitations.rfqId, procurementRfqs.id))
      .innerJoin(companies, eq(procurementRfqs.companyId, companies.id))
      .innerJoin(projects, eq(procurementRfqs.projectId, projects.id))
      .leftJoin(users, eq(procurementRfqs.createdByUserId, users.id))
      .where(and(eq(procurementRfqs.id, id), inArray(procurementRfqInvitations.supplierId, supplierIds.length ? supplierIds : ["00000000-0000-0000-0000-000000000000"])))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Oportunidade não encontrada" });
    if (row.invitation.status === "convidado") {
      await db.update(procurementRfqInvitations).set({ status: "visualizado", viewedAt: new Date() }).where(eq(procurementRfqInvitations.id, row.invitation.id));
    }
    const lines = await loadRfqLines(id);
    const quotes = await db.select().from(procurementSupplierQuotes)
      .where(and(eq(procurementSupplierQuotes.rfqId, id), eq(procurementSupplierQuotes.supplierId, row.invitation.supplierId)))
      .orderBy(desc(procurementSupplierQuotes.version));
    return { ...row.rfq, companyName: row.companyName, projectName: row.projectName, buyerName: row.buyerName, invitation: row.invitation, lines: lines.map((entry) => ({ ...entry.line, materialName: entry.materialName, materialUnit: entry.materialUnit })), quoteVersions: quotes };
  });

  app.post("/api/supplier/procurement/rfqs/:id/quotes", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const supplierIds = await supplierIdsOwnedByAccount(request.currentSupplier!.id);
    const [invitation] = await db.select().from(procurementRfqInvitations)
      .where(and(eq(procurementRfqInvitations.rfqId, id), inArray(procurementRfqInvitations.supplierId, supplierIds.length ? supplierIds : ["00000000-0000-0000-0000-000000000000"]))).limit(1);
    if (!invitation) return reply.code(404).send({ error: "Oportunidade não encontrada" });
    const [rfq] = await db.select().from(procurementRfqs).where(eq(procurementRfqs.id, id)).limit(1);
    if (!rfq || rfq.status !== "aberta") return reply.code(409).send({ error: "Esta oportunidade já não aceita propostas" });
    if (rfq.deadlineDate && rfq.deadlineDate < today()) return reply.code(409).send({ error: "O prazo desta RFQ terminou" });
    const parsed = submitSupplierQuoteInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.validUntil && parsed.data.validUntil < today()) {
      return reply.code(400).send({ error: "A validade da proposta não pode terminar antes da data de submissão" });
    }
    const rfqLines = await db.select().from(procurementRfqLines).where(eq(procurementRfqLines.rfqId, id)).orderBy(procurementRfqLines.sortOrder);
    const lineById = new Map(rfqLines.map((line) => [line.id, line]));
    const inputById = new Map(parsed.data.lines.map((line) => [line.rfqLineId, line]));
    if (inputById.size !== rfqLines.length || rfqLines.some((line) => !inputById.has(line.id))) {
      return reply.code(400).send({ error: "Responda explicitamente a todos os itens; marque indisponível quando não conseguir fornecer" });
    }
    for (const inputLine of parsed.data.lines) {
      const line = lineById.get(inputLine.rfqLineId)!;
      if (!inputLine.available) continue;
      if (!(inputLine.quantityOffered > 0) || !(inputLine.unitCost >= 0)) return reply.code(400).send({ error: "Itens disponíveis precisam de quantidade e preço" });
      if (inputLine.quantityOffered > Number(line.quantity) + 0.0001) return reply.code(400).send({ error: `Quantidade oferecida de ${line.description} excede a solicitada` });
      if (!rfq.allowPartialQuotes && inputLine.quantityOffered + 0.0001 < Number(line.quantity)) return reply.code(400).send({ error: `Esta RFQ não permite proposta parcial para ${line.description}` });
    }
    if (!rfq.allowPartialQuotes && parsed.data.lines.some((line) => !line.available)) {
      return reply.code(400).send({ error: "Esta RFQ exige proposta completa para todos os itens" });
    }

    let quote: typeof procurementSupplierQuotes.$inferSelect;
    try {
      quote = await db.transaction(async (tx) => {
      // A mesma linha da RFQ é bloqueada também na adjudicação. Assim uma nova versão não pode
      // entrar exactamente no instante em que a empresa fecha a decisão.
      await tx.execute(sql`select id from procurement_rfqs where id = ${id} for update`);
      const [lockedRfq] = await tx.select({ status: procurementRfqs.status, deadlineDate: procurementRfqs.deadlineDate }).from(procurementRfqs).where(eq(procurementRfqs.id, id)).limit(1);
      if (!lockedRfq || lockedRfq.status !== "aberta") throw new Error("Esta oportunidade já não aceita propostas");
      if (lockedRfq.deadlineDate && lockedRfq.deadlineDate < today()) throw new Error("O prazo desta RFQ terminou");
      const previous = await tx.select().from(procurementSupplierQuotes)
        .where(and(eq(procurementSupplierQuotes.rfqId, id), eq(procurementSupplierQuotes.supplierId, invitation.supplierId)))
        .orderBy(desc(procurementSupplierQuotes.version));
      const version = (previous[0]?.version ?? 0) + 1;
      await tx.update(procurementSupplierQuotes).set({ status: "substituida" })
        .where(and(eq(procurementSupplierQuotes.rfqId, id), eq(procurementSupplierQuotes.supplierId, invitation.supplierId), eq(procurementSupplierQuotes.status, "submetida")));
      const [created] = await tx.insert(procurementSupplierQuotes).values({
        rfqId: id,
        invitationId: invitation.id,
        supplierId: invitation.supplierId,
        version,
        status: "submetida",
        currency: rfq.currency,
        validUntil: parsed.data.validUntil || null,
        leadTimeDays: parsed.data.leadTimeDays ?? null,
        paymentTerms: parsed.data.paymentTerms ?? null,
        transportIncluded: parsed.data.transportIncluded,
        transportCost: (parsed.data.transportIncluded ? 0 : parsed.data.transportCost).toFixed(2),
        supplierNotes: parsed.data.supplierNotes ?? null,
        submittedAt: new Date(),
      }).returning();
      await tx.insert(procurementSupplierQuoteLines).values(parsed.data.lines.map((line) => ({
        quoteId: created.id,
        rfqLineId: line.rfqLineId,
        available: line.available,
        quantityOffered: line.quantityOffered.toString(),
        unitCost: line.unitCost.toFixed(4),
        discountPct: line.discountPct.toFixed(3),
        brand: line.brand ?? null,
        leadTimeDays: line.leadTimeDays ?? null,
        notes: line.notes ?? null,
      })));
      await tx.update(procurementRfqInvitations).set({ status: "respondido", respondedAt: new Date() }).where(eq(procurementRfqInvitations.id, invitation.id));
      return created;
      });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível submeter a proposta" });
    }
    await notifyCompanyUsers(rfq.companyId, "Nova proposta recebida", `${rfq.reference} recebeu uma proposta de fornecedor.`, `/projectos/${rfq.projectId}/compras`);
    return reply.code(201).send(quote);
  });
}
