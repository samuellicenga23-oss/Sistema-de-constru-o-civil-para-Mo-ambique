import { assertApproversAvailable } from "./resolveProjectApproval.js";
import { createApprovalTasks, completePendingApprovalTasks, createCorrectionTask, assertUserCanActOnEntity } from "./workflowTasks.js";
import type { ProjectWorkflowType } from "./projectWorkflowTypes.js";

/** Submissão → resolve aprovadores do projecto (fallback empresa) → cria tasks + notifica. */
export async function dispatchEntitySubmitted(input: {
  companyId: string;
  projectId: string;
  workflowType: ProjectWorkflowType;
  entityType: string;
  entityId: string;
  title: string;
  body?: string | null;
  link: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string; code?: string }> {
  const check = await assertApproversAvailable({
    companyId: input.companyId,
    projectId: input.projectId,
    workflowType: input.workflowType,
    excludeUserId: input.actorUserId,
  });
  if (!check.ok) return { ok: false, status: 409, error: check.error, code: check.code };
  await createApprovalTasks({
    companyId: input.companyId,
    projectId: input.projectId,
    workflowType: input.workflowType,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    body: input.body,
    link: input.link,
    requestedByUserId: input.actorUserId,
    resolved: check.resolved,
  });
  return { ok: true };
}

export async function dispatchEntityApproved(input: {
  companyId: string;
  projectId: string;
  workflowType: ProjectWorkflowType;
  entityType: string;
  entityId: string;
  actorUserId: string;
  comment?: string | null;
}) {
  await completePendingApprovalTasks({
    companyId: input.companyId,
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: input.actorUserId,
    decision: "approved",
    comment: input.comment,
    projectId: input.projectId,
    workflowType: input.workflowType,
  });
}

export async function dispatchEntityReturned(input: {
  companyId: string;
  projectId: string;
  workflowType: ProjectWorkflowType;
  entityType: string;
  entityId: string;
  actorUserId: string;
  submitterUserId: string | null | undefined;
  title: string;
  reason: string;
  link: string;
}) {
  if (input.submitterUserId) {
    await createCorrectionTask({
      companyId: input.companyId,
      projectId: input.projectId,
      workflowType: input.workflowType,
      entityType: input.entityType,
      entityId: input.entityId,
      assignedUserId: input.submitterUserId,
      title: `Correcção necessária — ${input.title}`,
      body: input.reason,
      link: input.link,
      requestedByUserId: input.actorUserId,
    });
  } else {
    await completePendingApprovalTasks({
      companyId: input.companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
      decision: "returned",
      comment: input.reason,
    });
  }
}

export { assertUserCanActOnEntity };
