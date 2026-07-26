import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurementCertificates, measurementCertificateLines } from "../db/schema.js";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned, assertDocumentOwned, assertCertificateOwned } from "../services/accessControl.js";
import {
  createMeasurementCertificate,
  updateCertificateLineCumulative,
  getCertificateDetail,
  getMeasurementDashboard,
} from "../services/measurementEngine.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

const createSchema = z.object({ budgetDocumentId: z.string().uuid(), periodDate: z.string() });

export async function measurementCertificateRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/measurement-certificates", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = request.currentUser!.companyId!;
    const project = await assertProjectOwned(projectId, companyId);
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
    if (!document) return reply.code(404).send({ error: "Mapa de quantidades não encontrado" });

    const certificate = await createMeasurementCertificate(projectId, parsed.data.budgetDocumentId, parsed.data.periodDate);
    return reply.code(201).send(certificate);
  });

  app.get("/api/measurement-certificates/:id", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const certificate = await assertCertificateOwned(id, companyId);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    return getCertificateDetail(id);
  });

  app.put("/api/measurement-certificates/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const certificate = await assertCertificateOwned(id, companyId);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });

    const parsed = z.object({ status: z.enum(["rascunho", "submetido", "aprovado"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [row] = await db.update(measurementCertificates).set({ status: parsed.data.status }).where(eq(measurementCertificates.id, id)).returning();
    return row;
  });

  app.delete("/api/measurement-certificates/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const certificate = await assertCertificateOwned(id, companyId);
    if (!certificate) return reply.code(404).send({ error: "Auto de medição não encontrado" });
    await db.delete(measurementCertificates).where(eq(measurementCertificates.id, id));
    return { ok: true };
  });

  app.put("/api/measurement-certificate-lines/:id", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.currentUser!.companyId!;
    const parsed = z.object({ cumulativeQty: z.number().nonnegative() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [line] = await db.select().from(measurementCertificateLines).where(eq(measurementCertificateLines.id, id)).limit(1);
    if (!line) return reply.code(404).send({ error: "Linha não encontrada" });
    const certificate = await assertCertificateOwned(line.certificateId, companyId);
    if (!certificate) return reply.code(404).send({ error: "Linha não encontrada" });

    try {
      const row = await updateCertificateLineCumulative(id, parsed.data.cumulativeQty);
      return row;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Erro ao actualizar" });
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
    if (!document) return reply.code(404).send({ error: "Mapa de quantidades não encontrado" });

    return getMeasurementDashboard(budgetDocumentId);
  });
}
