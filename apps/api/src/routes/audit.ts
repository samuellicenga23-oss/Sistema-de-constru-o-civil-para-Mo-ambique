import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { getProjectAuditEvents } from "../services/auditTrail.js";

// Leitura contextual por obra. A UI pode mostrar esta lista como "Histórico" sem dar ao
// utilizador a ilusão de que é editável; a imutabilidade é garantida pela ausência de rotas de
// alteração/remoção e pela retenção independente das entidades de origem.
export async function auditRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/audit-events", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, request.currentUser!.companyId!);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return getProjectAuditEvents(request.currentUser!.companyId!, projectId, parsed.data.limit);
  });
}
