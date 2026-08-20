import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  projectApprovalRoutes,
  projectApprovalSteps,
  projectApprovalStepUsers,
  projectMembers,
  projects,
  users,
} from "../db/schema.js";
import { recordAuditEvent } from "./auditTrail.js";
import {
  PROJECT_ROLES,
  PROJECT_WORKFLOW_TYPES,
  userHasApprovePermission,
  type ApprovalMode,
  type ProjectRole,
  type ProjectWorkflowType,
} from "./projectWorkflowTypes.js";

export async function listProjectMembers(companyId: string, projectId: string) {
  return db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      projectRole: projectMembers.projectRole,
      isActive: projectMembers.isActive,
      createdAt: projectMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
      userActive: users.isActive,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.companyId, companyId), eq(projectMembers.projectId, projectId)))
    .orderBy(asc(users.name));
}

export async function upsertProjectMember(input: {
  companyId: string;
  projectId: string;
  userId: string;
  projectRole: ProjectRole;
  actorUserId: string;
}) {
  if (!PROJECT_ROLES.includes(input.projectRole)) {
    return { ok: false as const, error: "Função de obra inválida" };
  }
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, input.userId), eq(users.companyId, input.companyId), eq(users.isActive, true)))
    .limit(1);
  if (!user) return { ok: false as const, error: "Utilizador inválido para esta empresa" };

  const [existing] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)))
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(projectMembers)
      .set({ projectRole: input.projectRole, isActive: true, updatedAt: new Date() })
      .where(eq(projectMembers.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(projectMembers)
      .values({
        companyId: input.companyId,
        projectId: input.projectId,
        userId: input.userId,
        projectRole: input.projectRole,
        addedByUserId: input.actorUserId,
      })
      .returning();
  }

  await recordAuditEvent({
    companyId: input.companyId,
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    entityType: "project",
    entityId: input.projectId,
    action: existing ? "project.member.updated" : "project.member.added",
    after: { userId: input.userId, projectRole: input.projectRole },
  });

  return { ok: true as const, member: row };
}

export async function removeProjectMember(input: {
  companyId: string;
  projectId: string;
  memberId: string;
  actorUserId: string;
}) {
  const [row] = await db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.id, input.memberId),
        eq(projectMembers.projectId, input.projectId),
        eq(projectMembers.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false as const, error: "Membro não encontrado" };

  await db.delete(projectMembers).where(eq(projectMembers.id, row.id));
  await recordAuditEvent({
    companyId: input.companyId,
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    entityType: "project",
    entityId: input.projectId,
    action: "project.member.removed",
    before: { userId: row.userId, projectRole: row.projectRole },
  });
  return { ok: true as const };
}

export type ProjectRouteConfig = {
  workflowType: ProjectWorkflowType;
  approvalMode: ApprovalMode;
  isActive: boolean;
  steps: Array<{ stepOrder: number; userIds: string[] }>;
};

export async function listProjectApprovalRoutes(companyId: string, projectId: string) {
  const routes = await db
    .select()
    .from(projectApprovalRoutes)
    .where(and(eq(projectApprovalRoutes.companyId, companyId), eq(projectApprovalRoutes.projectId, projectId)));

  if (!routes.length) return [];

  const routeIds = routes.map((r) => r.id);
  const steps = await db
    .select()
    .from(projectApprovalSteps)
    .where(inArray(projectApprovalSteps.routeId, routeIds))
    .orderBy(asc(projectApprovalSteps.stepOrder));
  const stepIds = steps.map((s) => s.id);
  const stepUsers = stepIds.length
    ? await db.select().from(projectApprovalStepUsers).where(inArray(projectApprovalStepUsers.stepId, stepIds))
    : [];

  const userIds = [...new Set(stepUsers.map((su) => su.userId))];
  const userRows = userIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive }).from(users).where(inArray(users.id, userIds))
    : [];
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  return routes.map((route) => {
    const routeSteps = steps.filter((s) => s.routeId === route.id);
    return {
      id: route.id,
      workflowType: route.workflowType as ProjectWorkflowType,
      approvalMode: route.approvalMode as ApprovalMode,
      isActive: route.isActive,
      steps: routeSteps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        users: stepUsers
          .filter((su) => su.stepId === step.id)
          .map((su) => userMap.get(su.userId))
          .filter(Boolean),
      })),
    };
  });
}

export async function saveProjectApprovalRoute(input: {
  companyId: string;
  projectId: string;
  actorUserId: string;
  config: ProjectRouteConfig;
}) {
  const { config } = input;
  if (!PROJECT_WORKFLOW_TYPES.includes(config.workflowType)) {
    return { ok: false as const, error: "Tipo de workflow inválido" };
  }
  if (!["any", "all", "sequential"].includes(config.approvalMode)) {
    return { ok: false as const, error: "Modo de aprovação inválido" };
  }

  const flatUserIds = [...new Set(config.steps.flatMap((s) => s.userIds))];
  if (!flatUserIds.length) {
    return { ok: false as const, error: "Indique pelo menos um aprovador" };
  }

  const candidates = await db
    .select({
      id: users.id,
      role: users.role,
      permissions: users.permissions,
      isActive: users.isActive,
      companyId: users.companyId,
    })
    .from(users)
    .where(inArray(users.id, flatUserIds));

  for (const userId of flatUserIds) {
    const user = candidates.find((c) => c.id === userId);
    if (!user || user.companyId !== input.companyId || !user.isActive) {
      return { ok: false as const, error: "Aprovador inválido ou inactivo" };
    }
    if (!userHasApprovePermission(user, config.workflowType)) {
      return { ok: false as const, error: `«${user.id}» sem permissão para aprovar ${config.workflowType}` };
    }
  }

  const [existing] = await db
    .select()
    .from(projectApprovalRoutes)
    .where(
      and(
        eq(projectApprovalRoutes.projectId, input.projectId),
        eq(projectApprovalRoutes.workflowType, config.workflowType),
      ),
    )
    .limit(1);

  let routeId: string;
  if (existing) {
    await db
      .update(projectApprovalRoutes)
      .set({
        approvalMode: config.approvalMode,
        isActive: config.isActive,
        updatedAt: new Date(),
      })
      .where(eq(projectApprovalRoutes.id, existing.id));
    routeId = existing.id;
    const oldSteps = await db.select({ id: projectApprovalSteps.id }).from(projectApprovalSteps).where(eq(projectApprovalSteps.routeId, routeId));
    if (oldSteps.length) {
      await db.delete(projectApprovalStepUsers).where(inArray(projectApprovalStepUsers.stepId, oldSteps.map((s) => s.id)));
      await db.delete(projectApprovalSteps).where(eq(projectApprovalSteps.routeId, routeId));
    }
  } else {
    const [created] = await db
      .insert(projectApprovalRoutes)
      .values({
        companyId: input.companyId,
        projectId: input.projectId,
        workflowType: config.workflowType,
        approvalMode: config.approvalMode,
        isActive: config.isActive,
      })
      .returning();
    routeId = created.id;
  }

  for (const step of config.steps) {
    const [createdStep] = await db
      .insert(projectApprovalSteps)
      .values({
        routeId,
        stepOrder: step.stepOrder,
        minimumApprovals: config.approvalMode === "all" ? Math.max(1, step.userIds.length) : 1,
      })
      .returning();
    if (step.userIds.length) {
      await db.insert(projectApprovalStepUsers).values(step.userIds.map((userId) => ({ stepId: createdStep.id, userId })));
    }
  }

  await recordAuditEvent({
    companyId: input.companyId,
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    entityType: "project",
    entityId: input.projectId,
    action: "project.approval_route.updated",
    after: { workflowType: config.workflowType, approvalMode: config.approvalMode, userIds: flatUserIds },
  });

  return { ok: true as const };
}

export async function cloneProjectTeamAndApprovals(input: {
  companyId: string;
  targetProjectId: string;
  sourceProjectId: string;
  actorUserId: string;
}) {
  if (input.targetProjectId === input.sourceProjectId) {
    return { ok: false as const, error: "Projecto de origem inválido" };
  }
  const [source, target] = await Promise.all([
    db.select().from(projects).where(and(eq(projects.id, input.sourceProjectId), eq(projects.companyId, input.companyId))).limit(1),
    db.select().from(projects).where(and(eq(projects.id, input.targetProjectId), eq(projects.companyId, input.companyId))).limit(1),
  ]);
  if (!source[0] || !target[0]) return { ok: false as const, error: "Projecto não encontrado" };

  const members = await listProjectMembers(input.companyId, input.sourceProjectId);
  for (const member of members.filter((m) => m.isActive && m.userActive)) {
    await upsertProjectMember({
      companyId: input.companyId,
      projectId: input.targetProjectId,
      userId: member.userId,
      projectRole: member.projectRole as ProjectRole,
      actorUserId: input.actorUserId,
    });
  }

  const routes = await listProjectApprovalRoutes(input.companyId, input.sourceProjectId);
  for (const route of routes.filter((r) => r.isActive)) {
    await saveProjectApprovalRoute({
      companyId: input.companyId,
      projectId: input.targetProjectId,
      actorUserId: input.actorUserId,
      config: {
        workflowType: route.workflowType,
        approvalMode: route.approvalMode,
        isActive: true,
        steps: route.steps.map((step) => ({
          stepOrder: step.stepOrder,
          userIds: step.users.map((u) => u!.id),
        })),
      },
    });
  }

  return { ok: true as const };
}
