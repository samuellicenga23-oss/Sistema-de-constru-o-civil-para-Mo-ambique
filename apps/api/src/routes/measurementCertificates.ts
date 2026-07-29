import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgetDocuments, financialEntries, measurementCertificateLines, measurementCertificates } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertCertificateOwned, assertDocumentOwned, assertProjectOwned } from "../services/accessControl.js";
import {
  createMeasurementCertificate,
  getCertificateDetail,
  getMeasurementDashboard,
  updateCertificateLinePeriod,
} from "../services/measurementEngine.js";
import { computeLabourByPhase } from "../services/labourByPhase.js";

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
    try {
      return reply.code(201).send(await createMeasurementCertificate({ projectId, ...parsed.data }));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Não foi possível abrir o auto" });
    }
  });

  app.get("/api/measurement-certificates/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const certificate = await assertCertificateOwned(id, request.currentUser!.companyId!);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    const detail = await getCertificateDetail(id);
    const [document] = await db.select({ currency: budgetDocuments.currency, ivaRate: budgetDocuments.ivaRate, contingenciasRate: budgetDocuments.contingenciasRate }).from(budgetDocuments).where(eq(budgetDocuments.id, certificate.budgetDocumentId)).limit(1);
    return { ...detail, financialParameters: { currency: document?.currency ?? "MZN", ivaRate: Number(document?.ivaRate ?? 0.16), contingenciasRate: Number(document?.contingenciasRate ?? 0) } };
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
    const parsed = z.object({ status: z.enum(["rascunho", "submetido", "aprovado"]), decisionNote: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const transitions: Record<typeof certificate.status, typeof certificate.status[]> = {
      rascunho: ["submetido"],
      submetido: ["rascunho", "aprovado"],
      aprovado: [],
    };
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
    const [updated] = await db.update(measurementCertificates).set({ status: parsed.data.status, ...timestamps }).where(eq(measurementCertificates.id, id)).returning();

    if (parsed.data.status === "aprovado") {
      const [document] = await db.select().from(budgetDocuments).where(eq(budgetDocuments.id, certificate.budgetDocumentId)).limit(1);
      const periodSubtotal = detail!.lines.reduce((sum, line) => sum + line.periodValue, 0);
      const grossAmount = periodSubtotal * (1 + Number(document?.contingenciasRate ?? 0)) * (1 + Number(document?.ivaRate ?? 0));
      const [existing] = await db.select().from(financialEntries).where(and(
        eq(financialEntries.projectId, certificate.projectId),
        eq(financialEntries.sourceType, "measurement_certificate"),
        eq(financialEntries.sourceId, id)
      )).limit(1);
      if (!existing && grossAmount > 0) {
        await db.insert(financialEntries).values({
          projectId: certificate.projectId,
          type: "receita",
          category: "Autos de medição",
          description: `Receita automática do Auto de Medição n.º ${certificate.number}`,
          amount: grossAmount.toFixed(2),
          currency: document?.currency ?? "MZN",
          dueDate: certificate.periodDate,
          status: "pendente",
          sourceType: "measurement_certificate",
          sourceId: id,
          createdByUserId: request.currentUser!.id,
        });
      }
    }
    return updated;
  });

  app.delete("/api/measurement-certificates/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const certificate = await assertCertificateOwned(id, request.currentUser!.companyId!);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    if (certificate.status !== "rascunho") return reply.code(409).send({ error: "Só é possível eliminar autos em rascunho" });
    await db.delete(measurementCertificates).where(eq(measurementCertificates.id, id));
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
