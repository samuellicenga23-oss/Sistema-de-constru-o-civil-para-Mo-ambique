import { and, asc, eq, inArray } from "drizzle-orm";
import { isCompanyUserRole, resolveRoleTemplate } from "@sigo/shared";
import { db } from "../db/index.js";
import {
  projectApprovalRoutes,
  projectApprovalSteps,
  projectApprovalStepUsers,
  users,
} from "../db/schema.js";
import { loadCompanyApprovalRules } from "./companyApproval.js";
import { approvalRulesFor } from "./approvalMatrix.js";
import {
  matrixEntityFromWorkflow,
  userHasApprovePermission,
  type ApprovalMode,
  type ProjectWorkflowType,
} from "./projectWorkflowTypes.js";

export type ResolvedApprover = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ResolvedApprovalRoute = {
  source: "project" | "company" | "legacy";
  mode: ApprovalMode;
  /** Step actual a notificar (1-based). */
  stepOrder: number;
  /** Utilizadores da etapa actual. */
  approvers: ResolvedApprover[];
  /** Todas as etapas (para sequencial). */
  steps: Array<{ stepOrder: number; userIds: string[] }>;
  routeConfigured: boolean;
};

function effectivePermissions(role: string, permissions: string[] | null | undefined): string[] {
  if (permissions?.length) return permissions;
  if (!isCompanyUserRole(role)) return [];
  return resolveRoleTemplate(role) ?? [];
}

async function loadActiveUsers(companyId: string, userIds: string[]): Promise<ResolvedApprover[]> {
  if (!userIds.length) return [];
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      permissions: users.permissions,
      isActive: users.isActive,
      companyId: users.companyId,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  return rows
    .filter((u) => u.companyId === companyId && u.isActive)
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
}

/**
 * Ordem: project route → company matrix roles → legacy permission fan-out.
 */
export async function resolveProjectApprovalRoute(input: {
  companyId: string;
  projectId: string;
  workflowType: ProjectWorkflowType;
  excludeUserId?: string | null;
  stepOrder?: number;
}): Promise<ResolvedApprovalRoute> {
  const stepOrder = input.stepOrder ?? 1;

  const [route] = await db
    .select()
    .from(projectApprovalRoutes)
    .where(
      and(
        eq(projectApprovalRoutes.companyId, input.companyId),
        eq(projectApprovalRoutes.projectId, input.projectId),
        eq(projectApprovalRoutes.workflowType, input.workflowType),
        eq(projectApprovalRoutes.isActive, true),
      ),
    )
    .limit(1);

  if (route) {
    const steps = await db
      .select()
      .from(projectApprovalSteps)
      .where(eq(projectApprovalSteps.routeId, route.id))
      .orderBy(asc(projectApprovalSteps.stepOrder));
    const stepIds = steps.map((s) => s.id);
    const stepUsers = stepIds.length
      ? await db.select().from(projectApprovalStepUsers).where(inArray(projectApprovalStepUsers.stepId, stepIds))
      : [];

    const structured = steps.map((step) => ({
      stepOrder: step.stepOrder,
      userIds: stepUsers.filter((su) => su.stepId === step.id).map((su) => su.userId),
    }));

    const mode = route.approvalMode as ApprovalMode;
    const activeStep =
      mode === "sequential"
        ? structured.find((s) => s.stepOrder === stepOrder) ?? structured[0]
        : { stepOrder: 1, userIds: [...new Set(structured.flatMap((s) => s.userIds))] };

    let approvers = await loadActiveUsers(input.companyId, activeStep?.userIds ?? []);
    // Preferir quem tem permission; admin_empresa sempre válido.
    const fullUsers = await db
      .select({ id: users.id, role: users.role, permissions: users.permissions })
      .from(users)
      .where(inArray(users.id, approvers.map((a) => a.id)));
    const allowedIds = new Set(
      fullUsers
        .filter((u) => userHasApprovePermission({ role: u.role, permissions: u.permissions }, input.workflowType))
        .map((u) => u.id),
    );
    approvers = approvers.filter((a) => allowedIds.has(a.id));
    if (input.excludeUserId) {
      approvers = approvers.filter((a) => a.id !== input.excludeUserId);
    }

    return {
      source: "project",
      mode,
      stepOrder: activeStep?.stepOrder ?? 1,
      approvers,
      steps: structured,
      routeConfigured: true,
    };
  }

  // Fallback empresa: roles da matriz
  const rules = await loadCompanyApprovalRules(input.companyId);
  const matrixEntity = matrixEntityFromWorkflow(input.workflowType);
  const rule = approvalRulesFor(matrixEntity, rules)[0];
  const companyUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      permissions: users.permissions,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.companyId, input.companyId), eq(users.isActive, true)));

  let approvers: ResolvedApprover[] = [];
  if (rule) {
    approvers = companyUsers
      .filter((u) => {
        if (input.excludeUserId && u.id === input.excludeUserId) return false;
        if (!rule.approveRoles.includes(u.role)) return false;
        if (rule.approvePermission) {
          const perms = effectivePermissions(u.role, u.permissions);
          if (!perms.includes(rule.approvePermission) && u.role !== "admin_empresa") return false;
        }
        return true;
      })
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
  }

  if (!approvers.length) {
    // Legacy: permission fan-out (igual ao emitWorkflowEvent)
    const permission =
      input.workflowType === "measurement_certificate"
        ? "diario.aprovar"
        : input.workflowType === "purchase_requisition" || input.workflowType === "payment_request"
          ? "materiais.aprovar"
          : "orcamentos.aprovar";
    approvers = companyUsers
      .filter((u) => {
        if (input.excludeUserId && u.id === input.excludeUserId) return false;
        if (u.role === "admin_empresa") return true;
        return effectivePermissions(u.role, u.permissions).includes(permission);
      })
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
  }

  return {
    source: rule ? "company" : "legacy",
    mode: "any",
    stepOrder: 1,
    approvers,
    steps: [{ stepOrder: 1, userIds: approvers.map((a) => a.id) }],
    routeConfigured: false,
  };
}

/** Bloqueia submissão se a obra tem rota activa sem aprovadores válidos. */
export async function assertApproversAvailable(input: {
  companyId: string;
  projectId: string;
  workflowType: ProjectWorkflowType;
  excludeUserId?: string | null;
}): Promise<{ ok: true; resolved: ResolvedApprovalRoute } | { ok: false; error: string; code: string }> {
  const resolved = await resolveProjectApprovalRoute(input);
  if (resolved.routeConfigured && resolved.approvers.length === 0) {
    return {
      ok: false,
      code: "NO_PROJECT_APPROVER",
      error: `Sem aprovador configurado para ${input.workflowType} nesta obra.`,
    };
  }
  if (!resolved.approvers.length) {
    return {
      ok: false,
      code: "NO_APPROVER",
      error: "Sem aprovador disponível. Configure a equipa da obra ou a matriz da empresa.",
    };
  }
  return { ok: true, resolved };
}
