import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, measurementCertificateFieldLines, measurementCertificateLines, measurementCertificates, users } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertCertificateOwned, assertDocumentOwned, assertProjectOwned } from "../services/accessControl.js";
import {
  createMeasurementCertificate,
  getCertificateDetail,
  getMeasurementDashboard,
  updateCertificateLinePeriod,
} from "../services/measurementEngine.js";
import { computeLabourByPhase } from "../services/labourByPhase.js";
import { calculateBudgetTotals } from "../services/budgetTotals.js";
import { createDraftInvoiceForCertificate } from "../services/invoicing.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import { emitWorkflowEvent } from "../services/workflowEvents.js";
import { buildCertificateFieldMeasurementPdf } from "../services/certificateFieldMeasurementPdf.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista", "engenheiro_fiscal"] as const;
const createSchema = z.object({
  budgetDocumentId: z.string().uuid(),
  periodStartDate: z.string().optional(),
  periodDate: z.string(),
  notes: z.string().optional(),
});

export async function measurementCertificateRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/measurement-certificates", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, request.currentUser!.companyId!);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return db.select().from(measurementCertificates).where(eq(measurementCertificates.projectId, projectId)).orderBy(measurementCertificates.number);
  });

  app.post("/api/projects/:projectId/measurement-certificates", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const document = await assertDocumentOwned(parsed.data.budgetDocumentId, companyId);
    if (!document) return reply.code(404).send({ error: "Mapa de Quantidades não encontrado" });
    if (document.projectId !== projectId) return reply.code(409).send({ error: "O Mapa de Quantidades não pertence a este projecto" });
    if (document.documentType !== "orcamento") return reply.code(409).send({ error: "Seleccione um orçamento, não uma medição técnica" });
    if (document.status !== "aprovado") {
      return reply.code(409).send({ error: "Aprove o orçamento antes de abrir o primeiro Auto de Medição" });
    }
    try {
      const certificate = await createMeasurementCertificate({ projectId, ...parsed.data });
      await recordAuditEvent({
        companyId,
        projectId,
        actorUserId: request.currentUser!.id,
        entityType: "measurement_certificate",
        entityId: certificate.id,
        action: "created",
        after: { number: certificate.number, status: certificate.status, budgetDocumentId: certificate.budgetDocumentId, periodDate: certificate.periodDate },
      });
      return reply.code(201).send(certificate);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível abrir o auto" });
    }
  });

  app.get("/api/measurement-certificates/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const certificate = await assertCertificateOwned(id, request.currentUser!.companyId!);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    const detail = await getCertificateDetail(id);
    const [document] = await db.select({
      currency: budgetDocuments.currency,
      ivaRate: budgetDocuments.ivaRate,
      contingenciasRate: budgetDocuments.contingenciasRate,
      siteCostsRate: budgetDocuments.siteCostsRate,
      indirectCostsRate: budgetDocuments.indirectCostsRate,
      profitMarginRate: budgetDocuments.profitMarginRate,
    }).from(budgetDocuments).where(eq(budgetDocuments.id, certificate.budgetDocumentId)).limit(1);
    const commercialRates = {
      siteCostsRate: Number(document?.siteCostsRate ?? 0),
      indirectCostsRate: Number(document?.indirectCostsRate ?? 0),
      profitMarginRate: Number(document?.profitMarginRate ?? 0),
    };
    const unitPriceFactor = calculateBudgetTotals(1, commercialRates).unitPriceFactor;
    const clientLines = detail?.lines.map((line) => ({
      ...line,
      unitPrice: line.unitPrice * unitPriceFactor,
      periodValue: line.periodValue * unitPriceFactor,
      cumulativeValue: line.cumulativeValue * unitPriceFactor,
    })) ?? [];
    return {
      ...detail,
      lines: clientLines,
      financialParameters: {
        currency: document?.currency ?? "MZN",
        ivaRate: Number(document?.ivaRate ?? 0.16),
        contingenciasRate: Number(document?.contingenciasRate ?? 0),
        // O auto é um documento contratual: recebe o preço de venda carregado,
        // nunca a decomposição interna de estaleiro, indirectos e margem.
        siteCostsRate: 0,
        indirectCostsRate: 0,
        profitMarginRate: 0,
      },
    };
  });

  app.get("/api/measurement-certificates/:id/field-measurements.pdf", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const certificate = await assertCertificateOwned(id, companyId);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    const result = await buildCertificateFieldMeasurementPdf(id, companyId);
    if (!result) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${result.filename}"`)
      .send(result.buffer);
  });

  app.get("/api/measurement-certificates/:id/labour-by-phase", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await computeLabourByPhase(id, request.currentUser!.companyId!);
    if (!result) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    return result;
  });

  app.put("/api/measurement-certificates/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const certificate = await assertCertificateOwned(id, request.currentUser!.companyId!);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    const parsed = z.object({ status: z.enum(["rascunho", "submetido", "aprovado"]), decisionNote: z.string().trim().max(1000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const transitions: Record<typeof certificate.status, typeof certificate.status[]> = {
      rascunho: ["submetido"],
      submetido: ["rascunho", "aprovado"],
      aprovado: [],
    };
    if (parsed.data.status === "aprovado") {
      if (request.currentUser!.role !== "admin_empresa") {
        return reply.code(403).send({ error: "A aprovação do Auto exige um administrador da empresa" });
      }
      if (certificate.submittedByUserId === request.currentUser!.id) {
        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.companyId, request.currentUser!.companyId!),
              eq(users.role, "admin_empresa"),
              eq(users.isActive, true),
            ),
          );
        if (admins.length > 1) {
          return reply.code(409).send({ error: "Quem submeteu o Auto não pode aprová-lo" });
        }
      }
    }
    if (parsed.data.status !== certificate.status && !transitions[certificate.status].includes(parsed.data.status)) {
      return reply.code(409).send({ error: `O auto ${certificate.status} não pode passar para ${parsed.data.status}` });
    }
    const detail = await getCertificateDetail(id);
    if (parsed.data.status === "submetido" && !detail!.lines.some((line) => line.periodQty > 0)) {
      return reply.code(409).send({ error: "Introduza pelo menos uma quantidade executada neste período antes de submeter" });
    }
    if (parsed.data.status === "rascunho" && certificate.status === "submetido" && !parsed.data.decisionNote?.trim()) {
      return reply.code(400).send({ error: "Indique o motivo da devolução para correcção" });
    }

    const now = new Date();
    const timestamps = parsed.data.status === "submetido"
      ? { submittedAt: now }
      : parsed.data.status === "aprovado"
        ? { approvedAt: now }
        : { submittedAt: null, notes: parsed.data.decisionNote ? `${certificate.notes ?? ""}\nDevolvido: ${parsed.data.decisionNote}`.trim() : certificate.notes };
    const [updated] = await db.update(measurementCertificates).set({
      status: parsed.data.status,
      ...timestamps,
      submittedByUserId:
        parsed.data.status === "submetido"
          ? request.currentUser!.id
          : parsed.data.status === "rascunho"
            ? null
            : certificate.submittedByUserId,
      approvedByUserId: parsed.data.status === "aprovado" ? request.currentUser!.id : certificate.approvedByUserId,
      approvalNote: parsed.data.decisionNote ?? certificate.approvalNote,
    }).where(eq(measurementCertificates.id, id)).returning();

    // Um Auto aprovado tem sempre uma factura em rascunho. Se a criação financeira falhar,
    // devolvemos o Auto ao estado submetido para não deixar a execução e o financeiro divergirem.
    if (parsed.data.status === "aprovado") {
      try {
        await createDraftInvoiceForCertificate(id, request.currentUser!.id);
      } catch (error) {
        await db.update(measurementCertificates).set({ status: "submetido", approvedAt: null, approvedByUserId: null }).where(eq(measurementCertificates.id, id));
        app.log.error({ err: error, certificateId: id }, "Falha ao criar factura do Auto aprovado; aprovação revertida");
        return reply.code(500).send({ error: "Não foi possível concluir a aprovação porque a factura não foi criada. O Auto continua submetido." });
      }
    }
    await recordAuditEvent({
      companyId: request.currentUser!.companyId!,
      projectId: certificate.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "measurement_certificate",
      entityId: id,
      action: `status.${parsed.data.status}`,
      before: { number: certificate.number, status: certificate.status, periodDate: certificate.periodDate },
      after: { number: updated.number, status: updated.status, periodDate: updated.periodDate },
      metadata: parsed.data.decisionNote ? { decisionNote: parsed.data.decisionNote } : null,
    });
    const actor = { id: request.currentUser!.id, name: request.currentUser!.name, email: request.currentUser!.email };
    const autoTitle = `n.º ${updated.number}`;
    if (parsed.data.status === "submetido") {
      await emitWorkflowEvent({
        event: "certificate.submitted",
        companyId: request.currentUser!.companyId!,
        entityId: id,
        title: autoTitle,
        link: `/autos/${id}`,
        actor,
        logger: request.log,
      });
    } else if (parsed.data.status === "aprovado") {
      await emitWorkflowEvent({
        event: "certificate.approved",
        companyId: request.currentUser!.companyId!,
        entityId: id,
        title: autoTitle,
        link: `/autos/${id}`,
        actor,
        submitterUserId: certificate.submittedByUserId,
        logger: request.log,
      });
    } else if (parsed.data.status === "rascunho" && certificate.status === "submetido") {
      await emitWorkflowEvent({
        event: "certificate.returned",
        companyId: request.currentUser!.companyId!,
        entityId: id,
        title: autoTitle,
        link: `/autos/${id}`,
        actor,
        submitterUserId: certificate.submittedByUserId,
        reason: parsed.data.decisionNote,
        logger: request.log,
      });
    }
    return updated;
  });

  app.delete("/api/measurement-certificates/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const certificate = await assertCertificateOwned(id, request.currentUser!.companyId!);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    if (certificate.status !== "rascunho") return reply.code(409).send({ error: "Só é possível eliminar autos em rascunho" });
    await db.delete(measurementCertificates).where(eq(measurementCertificates.id, id));
    await recordAuditEvent({
      companyId: request.currentUser!.companyId!,
      projectId: certificate.projectId,
      actorUserId: request.currentUser!.id,
      entityType: "measurement_certificate",
      entityId: id,
      action: "deleted",
      before: { number: certificate.number, status: certificate.status, periodDate: certificate.periodDate },
    });
    return { ok: true };
  });

  app.put("/api/measurement-certificate-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({
      periodQty: z.number().nonnegative(),
      notes: z.string().nullable().optional(),
      overrunReason: z.string().nullable().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [line] = await db.select().from(measurementCertificateLines).where(eq(measurementCertificateLines.id, id)).limit(1);
    if (!line || !(await assertCertificateOwned(line.certificateId, request.currentUser!.companyId!))) {
      return reply.code(404).send({ error: "Linha não encontrada" });
    }
    const [fieldMemory] = await db.select({ id: measurementCertificateFieldLines.id })
      .from(measurementCertificateFieldLines)
      .where(and(eq(measurementCertificateFieldLines.certificateLineId, id), eq(measurementCertificateFieldLines.isActive, true)))
      .limit(1);
    if (fieldMemory && Math.abs(Number(line.periodQty) - parsed.data.periodQty) > 0.0001) {
      return reply.code(409).send({ error: "Este item tem memória de campo. Altere as linhas da memória; a quantidade do período é calculada automaticamente." });
    }
    try {
      return await updateCertificateLinePeriod(id, parsed.data);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Erro ao actualizar" });
    }
  });

  app.get("/api/projects/:projectId/measurement-dashboard", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const { budgetDocumentId } = request.query as { budgetDocumentId?: string };
    if (!budgetDocumentId) return reply.code(400).send({ error: "budgetDocumentId em falta" });
    const document = await assertDocumentOwned(budgetDocumentId, companyId);
    if (!document || document.projectId !== projectId) return reply.code(404).send({ error: "Mapa de Quantidades não encontrado" });
    return getMeasurementDashboard(budgetDocumentId);
  });
}
