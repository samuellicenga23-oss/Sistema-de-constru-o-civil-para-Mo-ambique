import type { FastifyInstance } from "fastify";
import { requireCompanyUser } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import { getProjectControl } from "../services/projectControl.js";

export async function projectControlRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/control", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await assertProjectOwned(projectId, request.currentUser!.companyId!);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return getProjectControl(projectId, project.currency);
  });
}
