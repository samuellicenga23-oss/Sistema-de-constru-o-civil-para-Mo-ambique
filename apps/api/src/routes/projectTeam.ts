import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireCompanyUser, requireRole } from "../auth/middleware.js";
import { assertProjectOwned } from "../services/accessControl.js";
import {
  cloneProjectTeamAndApprovals,
  listProjectApprovalRoutes,
  listProjectMembers,
  removeProjectMember,
  saveProjectApprovalRoute,
  upsertProjectMember,
} from "../services/projectTeam.js";
import { PROJECT_ROLES, PROJECT_WORKFLOW_TYPES } from "../services/projectWorkflowTypes.js";
import {
  countPendingWorkflowTasks,
  listMyPendingWorkflowTasks,
  markWorkflowTaskPresented,
  reassignWorkflowTask,
} from "../services/workflowTasks.js";

const WRITE_ROLES = ["admin_empresa", "orcamentista"] as const;

function companyIdOf(request: FastifyRequest): string {
  return request.currentUser!.companyId!;
}

export async function projectTeamRoutes(app: FastifyInstance) {
  app.get("/api/projects/:projectId/members", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return { items: await listProjectMembers(companyId, projectId) };
  });

  app.post("/api/projects/:projectId/members", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = z
      .object({
        userId: z.string().uuid(),
        projectRole: z.enum(PROJECT_ROLES),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const result = await upsertProjectMember({
      companyId,
      projectId,
      userId: parsed.data.userId,
      projectRole: parsed.data.projectRole,
      actorUserId: request.currentUser!.id,
    });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.member;
  });

  app.delete("/api/projects/:projectId/members/:memberId", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId, memberId } = request.params as { projectId: string; memberId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    const result = await removeProjectMember({
      companyId,
      projectId,
      memberId,
      actorUserId: request.currentUser!.id,
    });
    if (!result.ok) return reply.code(404).send({ error: result.error });
    return { ok: true };
  });

  app.get("/api/projects/:projectId/approval-routes", { preHandler: requireCompanyUser }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });
    return { items: await listProjectApprovalRoutes(companyId, projectId) };
  });

  app.put("/api/projects/:projectId/approval-routes", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = z
      .object({
        workflowType: z.enum(PROJECT_WORKFLOW_TYPES),
        approvalMode: z.enum(["any", "all", "sequential"]),
        isActive: z.boolean().default(true),
        steps: z
          .array(
            z.object({
              stepOrder: z.number().int().min(1).max(10),
              userIds: z.array(z.string().uuid()).min(1),
            }),
          )
          .min(1)
          .max(10),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const result = await saveProjectApprovalRoute({
      companyId,
      projectId,
      actorUserId: request.currentUser!.id,
      config: parsed.data,
    });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, items: await listProjectApprovalRoutes(companyId, projectId) };
  });

  app.post("/api/projects/:projectId/clone-team", { preHandler: requireRole(...WRITE_ROLES) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const companyId = companyIdOf(request);
    const project = await assertProjectOwned(projectId, companyId);
    if (!project) return reply.code(404).send({ error: "Projecto não encontrado" });

    const parsed = z.object({ sourceProjectId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const result = await cloneProjectTeamAndApprovals({
      companyId,
      targetProjectId: projectId,
      sourceProjectId: parsed.data.sourceProjectId,
      actorUserId: request.currentUser!.id,
    });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return {
      ok: true,
      members: await listProjectMembers(companyId, projectId),
      routes: await listProjectApprovalRoutes(companyId, projectId),
    };
  });
}

export async function workflowTaskRoutes(app: FastifyInstance) {
  app.get("/api/me/workflow-tasks", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = companyIdOf(request);
    const userId = request.currentUser!.id;
    const items = await listMyPendingWorkflowTasks(userId, companyId);
    const unreadModal = items.filter((t) => !t.notificationPresentedAt);
    return {
      items,
      pendingCount: items.length,
      priorityTask: unreadModal[0] ?? null,
    };
  });

  app.get("/api/me/workflow-tasks/count", { preHandler: requireCompanyUser }, async (request) => {
    const count = await countPendingWorkflowTasks(request.currentUser!.id, companyIdOf(request));
    return { pendingCount: count };
  });

  app.post("/api/me/workflow-tasks/:id/presented", { preHandler: requireCompanyUser }, async (request) => {
    const { id } = request.params as { id: string };
    await markWorkflowTaskPresented(id, request.currentUser!.id);
    return { ok: true };
  });

  // Correcção de segurança da release: a reatribuição manual altera quem pode aprovar um
  // documento e, por isso, é uma operação administrativa. Delegações por ausência continuam
  // a ser tratadas automaticamente pelo workflowDelegation; o browser não pode elevar esta
  // permissão através de flags no payload.
  app.post("/api/workflow-tasks/:id/reassign", { preHandler: requireRole("admin_empresa", "super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ toUserId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await reassignWorkflowTask({
      companyId: companyIdOf(request),
      taskId: id,
      toUserId: parsed.data.toUserId,
      actorUserId: request.currentUser!.id,
      // O serviço conserva este argumento por compatibilidade interna; aqui só pode ser true
      // porque o preHandler já derivou a autorização da sessão no servidor.
      allowAssignee: true,
    });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.task;
  });
}
