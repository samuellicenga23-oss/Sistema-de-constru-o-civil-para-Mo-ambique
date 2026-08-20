import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, users, workflowTasks } from "../db/schema.js";
import { recordAuditEvent } from "./auditTrail.js";
import { notifyUsers } from "./notifications.js";
import { emailLayout, escapeHtml, sendEmail } from "./mailer.js";
import { env } from "../env.js";
import { companies } from "../db/schema.js";
import type { ApprovalMode, ProjectWorkflowType } from "./projectWorkflowTypes.js";
import { WORKFLOW_TASK_PRIORITY, PROJECT_WORKFLOW_LABELS } from "./projectWorkflowTypes.js";
import type { ResolvedApprovalRoute, ResolvedApprover } from "./resolveProjectApproval.js";
import { resolveProjectApprovalRoute } from "./resolveProjectApproval.js";

export type WorkflowTaskKind = "approval" | "correction";

export async function createApprovalTasks(input: {
  companyId: string;
  projectId: string;
  workflowType: ProjectWorkflowType;
  entityType: string;
  entityId: string;
  title: string;
  body?: string | null;
  link: string;
  requestedByUserId: string;
  resolved: ResolvedApprovalRoute;
  notify?: boolean;
}): Promise<{ taskIds: string[]; notifiedUserIds: string[] }> {
  const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, input.projectId)).limit(1);

  // Cancelar tasks pendentes anteriores para a mesma entidade (re-submissão).
  await db
    .update(workflowTasks)
    .set({ status: "superseded", updatedAt: new Date(), actedAt: new Date(), decision: "superseded" })
    .where(
      and(
        eq(workflowTasks.companyId, input.companyId),
        eq(workflowTasks.entityType, input.entityType),
        eq(workflowTasks.entityId, input.entityId),
        eq(workflowTasks.status, "pending"),
      ),
    );

  const values = input.resolved.approvers.map((approver) => ({
    companyId: input.companyId,
    projectId: input.projectId,
    workflowType: input.workflowType,
    entityType: input.entityType,
    entityId: input.entityId,
    assignedUserId: approver.id,
    stepOrder: input.resolved.stepOrder,
    status: "pending" as const,
    kind: "approval" as const,
    title: input.title,
    body: input.body ?? null,
    link: input.link,
    projectNameSnapshot: project?.name ?? null,
    requestedByUserId: input.requestedByUserId,
  }));

  if (!values.length) return { taskIds: [], notifiedUserIds: [] };

  const created = await db.insert(workflowTasks).values(values).returning({ id: workflowTasks.id, assignedUserId: workflowTasks.assignedUserId });

  await recordAuditEvent({
    companyId: input.companyId,
    projectId: input.projectId,
    actorUserId: input.requestedByUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: "workflow.task.created",
    after: { count: created.length, workflowType: input.workflowType, stepOrder: input.resolved.stepOrder },
  });

  const notifiedUserIds = created.map((c) => c.assignedUserId);
  if (input.notify !== false && notifiedUserIds.length) {
    const label = PROJECT_WORKFLOW_LABELS[input.workflowType] ?? "Documento";
    await notifyUsers(
      notifiedUserIds,
      "Aprovação necessária",
      input.body?.trim()
        ? `${input.title} · ${project?.name ?? ""}\n${input.body.trim()}`
        : `${label}: ${input.title}${project?.name ? ` · ${project.name}` : ""}`,
      input.link,
      { priority: "high" },
    );
    await maybeMailApprovers(input.companyId, input.resolved.approvers, input.title, input.body, input.link, project?.name);
  }

  return { taskIds: created.map((c) => c.id), notifiedUserIds };
}

async function maybeMailApprovers(
  companyId: string,
  approvers: ResolvedApprover[],
  title: string,
  body: string | null | undefined,
  link: string,
  projectName?: string | null,
) {
  try {
    const [company] = await db.select({ prefs: companies.emailNotificationPrefs }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (company?.prefs?.workflow === false) return;
    const emails = [...new Set(approvers.map((a) => a.email).filter(Boolean))];
    if (!emails.length) return;
    const href = link.startsWith("http") ? link : `${env.publicUrl}${link}`;
    await sendEmail({
      to: emails,
      subject: `SIGO — Aprovação necessária · ${title}`,
      html: emailLayout(
        "Aprovação necessária",
        `<p><strong>${escapeHtml(title)}</strong>${projectName ? ` · ${escapeHtml(projectName)}` : ""}</p>${
          body?.trim() ? `<p>${escapeHtml(body.trim())}</p>` : ""
        }`,
        href,
        "Rever no SIGO",
      ),
    });
  } catch {
    // Email é secundário.
  }
}

export async function createCorrectionTask(input: {
  companyId: string;
  projectId: string;
  workflowType: ProjectWorkflowType;
  entityType: string;
  entityId: string;
  assignedUserId: string;
  title: string;
  body: string;
  link: string;
  requestedByUserId: string;
  targetType?: string | null;
  targetId?: string | null;
}) {
  // Completar approvals pendentes desta entidade.
  await completePendingApprovalTasks({
    companyId: input.companyId,
    entityType: input.entityType,
    entityId: input.entityId,
    actorUserId: input.requestedByUserId,
    decision: "returned",
    comment: input.body,
  });

  const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
  const [created] = await db
    .insert(workflowTasks)
    .values({
      companyId: input.companyId,
      projectId: input.projectId,
      workflowType: input.workflowType,
      entityType: input.entityType,
      entityId: input.entityId,
      assignedUserId: input.assignedUserId,
      stepOrder: 0,
      status: "pending",
      kind: "correction",
      title: input.title,
      body: input.body,
      link: input.link,
      projectNameSnapshot: project?.name ?? null,
      requestedByUserId: input.requestedByUserId,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
    })
    .returning();

  await notifyUsers(
    [input.assignedUserId],
    "Correcção necessária",
    `${input.title}${project?.name ? ` · ${project.name}` : ""}\n${input.body}`,
    input.link,
    { priority: "high" },
  );

  await recordAuditEvent({
    companyId: input.companyId,
    projectId: input.projectId,
    actorUserId: input.requestedByUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: "workflow.task.created",
    after: { kind: "correction", taskId: created.id },
  });

  return created;
}

export async function completePendingApprovalTasks(input: {
  companyId: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  decision: "approved" | "returned" | "cancelled";
  comment?: string | null;
  mode?: ApprovalMode;
  workflowType?: ProjectWorkflowType;
  projectId?: string;
}) {
  const pending = await db
    .select()
    .from(workflowTasks)
    .where(
      and(
        eq(workflowTasks.companyId, input.companyId),
        eq(workflowTasks.entityType, input.entityType),
        eq(workflowTasks.entityId, input.entityId),
        eq(workflowTasks.status, "pending"),
        eq(workflowTasks.kind, "approval"),
      ),
    );

  if (!pending.length) return { completed: 0, advanced: false };

  const actorTasks = pending.filter((t) => t.assignedUserId === input.actorUserId);
  const others = pending.filter((t) => t.assignedUserId !== input.actorUserId);
  const now = new Date();

  if (input.decision === "returned" || input.decision === "cancelled") {
    await db
      .update(workflowTasks)
      .set({
        status: "completed",
        decision: input.decision,
        comment: input.comment ?? null,
        actedAt: now,
        updatedAt: now,
      })
      .where(inArray(workflowTasks.id, pending.map((t) => t.id)));
    return { completed: pending.length, advanced: false };
  }

  // approved
  const mode = input.mode ?? "any";
  if (mode === "all") {
    for (const task of actorTasks) {
      await db
        .update(workflowTasks)
        .set({ status: "completed", decision: "approved", comment: input.comment ?? null, actedAt: now, updatedAt: now })
        .where(eq(workflowTasks.id, task.id));
    }
    const stillPending = others.length; // others not yet acted
    // Re-check remaining pending for entity
    const remaining = await db
      .select({ id: workflowTasks.id })
      .from(workflowTasks)
      .where(
        and(
          eq(workflowTasks.entityType, input.entityType),
          eq(workflowTasks.entityId, input.entityId),
          eq(workflowTasks.status, "pending"),
          eq(workflowTasks.kind, "approval"),
        ),
      );
    return { completed: actorTasks.length, advanced: remaining.length === 0 };
  }

  if (mode === "sequential" && input.workflowType && input.projectId) {
    for (const task of actorTasks) {
      await db
        .update(workflowTasks)
        .set({ status: "completed", decision: "approved", comment: input.comment ?? null, actedAt: now, updatedAt: now })
        .where(eq(workflowTasks.id, task.id));
    }
    // Supersede siblings on same step
    if (others.length) {
      await db
        .update(workflowTasks)
        .set({ status: "superseded", decision: "superseded", actedAt: now, updatedAt: now })
        .where(inArray(workflowTasks.id, others.map((t) => t.id)));
    }
    const currentStep = actorTasks[0]?.stepOrder ?? 1;
    const resolved = await resolveProjectApprovalRoute({
      companyId: input.companyId,
      projectId: input.projectId,
      workflowType: input.workflowType,
      excludeUserId: null,
      stepOrder: currentStep + 1,
    });
    const nextStep = resolved.steps.find((s) => s.stepOrder === currentStep + 1);
    if (nextStep && nextStep.userIds.length) {
      const nextResolved = await resolveProjectApprovalRoute({
        companyId: input.companyId,
        projectId: input.projectId,
        workflowType: input.workflowType,
        stepOrder: currentStep + 1,
      });
      await createApprovalTasks({
        companyId: input.companyId,
        projectId: input.projectId,
        workflowType: input.workflowType,
        entityType: input.entityType,
        entityId: input.entityId,
        title: actorTasks[0]?.title ?? "Aprovação",
        body: null,
        link: actorTasks[0]?.link ?? "/",
        requestedByUserId: actorTasks[0]?.requestedByUserId ?? input.actorUserId,
        resolved: nextResolved,
      });
      return { completed: actorTasks.length, advanced: false, nextStep: true as const };
    }
    return { completed: actorTasks.length, advanced: true };
  }

  // ANY: complete actor, supersede others
  for (const task of actorTasks) {
    await db
      .update(workflowTasks)
      .set({ status: "completed", decision: "approved", comment: input.comment ?? null, actedAt: now, updatedAt: now })
      .where(eq(workflowTasks.id, task.id));
  }
  if (others.length) {
    await db
      .update(workflowTasks)
      .set({ status: "superseded", decision: "superseded", actedAt: now, updatedAt: now })
      .where(inArray(workflowTasks.id, others.map((t) => t.id)));
  }

  await recordAuditEvent({
    companyId: input.companyId,
    projectId: pending[0]?.projectId ?? null,
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: "workflow.task.completed",
    after: { decision: input.decision },
  });

  return { completed: actorTasks.length || pending.length, advanced: true };
}

export async function listMyPendingWorkflowTasks(userId: string, companyId: string, limit = 50) {
  const rows = await db
    .select({
      id: workflowTasks.id,
      companyId: workflowTasks.companyId,
      projectId: workflowTasks.projectId,
      workflowType: workflowTasks.workflowType,
      entityType: workflowTasks.entityType,
      entityId: workflowTasks.entityId,
      assignedUserId: workflowTasks.assignedUserId,
      stepOrder: workflowTasks.stepOrder,
      status: workflowTasks.status,
      kind: workflowTasks.kind,
      title: workflowTasks.title,
      body: workflowTasks.body,
      link: workflowTasks.link,
      projectNameSnapshot: workflowTasks.projectNameSnapshot,
      requestedByUserId: workflowTasks.requestedByUserId,
      requestedAt: workflowTasks.requestedAt,
      notificationPresentedAt: workflowTasks.notificationPresentedAt,
      targetType: workflowTasks.targetType,
      targetId: workflowTasks.targetId,
      requesterName: users.name,
    })
    .from(workflowTasks)
    .leftJoin(users, eq(users.id, workflowTasks.requestedByUserId))
    .where(
      and(
        eq(workflowTasks.assignedUserId, userId),
        eq(workflowTasks.companyId, companyId),
        eq(workflowTasks.status, "pending"),
      ),
    )
    .orderBy(desc(workflowTasks.requestedAt))
    .limit(limit);

  return rows
    .map((row) => ({
      ...row,
      priorityScore:
        (row.kind === "correction" ? 0 : 10) +
        (WORKFLOW_TASK_PRIORITY[row.workflowType] ?? 9) +
        (Date.now() - new Date(row.requestedAt).getTime()) / 86_400_000 / 100,
    }))
    .sort((a, b) => a.priorityScore - b.priorityScore);
}

export async function markWorkflowTaskPresented(taskId: string, userId: string) {
  await db
    .update(workflowTasks)
    .set({ notificationPresentedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workflowTasks.id, taskId),
        eq(workflowTasks.assignedUserId, userId),
        isNull(workflowTasks.notificationPresentedAt),
      ),
    );
}

export async function reassignWorkflowTask(input: {
  companyId: string;
  taskId: string;
  toUserId: string;
  actorUserId: string;
}) {
  const [task] = await db
    .select()
    .from(workflowTasks)
    .where(and(eq(workflowTasks.id, input.taskId), eq(workflowTasks.companyId, input.companyId), eq(workflowTasks.status, "pending")))
    .limit(1);
  if (!task) return { ok: false as const, error: "Tarefa não encontrada" };

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, input.toUserId), eq(users.companyId, input.companyId), eq(users.isActive, true)))
    .limit(1);
  if (!user) return { ok: false as const, error: "Utilizador inválido" };

  const [updated] = await db
    .update(workflowTasks)
    .set({ assignedUserId: input.toUserId, updatedAt: new Date(), notificationPresentedAt: null })
    .where(eq(workflowTasks.id, task.id))
    .returning();

  await notifyUsers([input.toUserId], "Aprovação reatribuída", `${task.title}`, task.link ?? undefined, { priority: "high" });
  await recordAuditEvent({
    companyId: input.companyId,
    projectId: task.projectId,
    actorUserId: input.actorUserId,
    entityType: task.entityType,
    entityId: task.entityId,
    action: "workflow.task.reassigned",
    before: { assignedUserId: task.assignedUserId },
    after: { assignedUserId: input.toUserId },
  });

  return { ok: true as const, task: updated };
}

export async function assertUserCanActOnEntity(input: {
  companyId: string;
  entityType: string;
  entityId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [task] = await db
    .select({ id: workflowTasks.id })
    .from(workflowTasks)
    .where(
      and(
        eq(workflowTasks.companyId, input.companyId),
        eq(workflowTasks.entityType, input.entityType),
        eq(workflowTasks.entityId, input.entityId),
        eq(workflowTasks.assignedUserId, input.userId),
        eq(workflowTasks.status, "pending"),
        eq(workflowTasks.kind, "approval"),
      ),
    )
    .limit(1);
  if (task) return { ok: true };

  // Sem task (legado): deixar passar para a matriz da empresa.
  const anyPending = await db
    .select({ id: workflowTasks.id })
    .from(workflowTasks)
    .where(
      and(
        eq(workflowTasks.entityType, input.entityType),
        eq(workflowTasks.entityId, input.entityId),
        eq(workflowTasks.status, "pending"),
        eq(workflowTasks.kind, "approval"),
      ),
    )
    .limit(1);
  if (anyPending.length) {
    return { ok: false, error: "Esta aprovação está atribuída a outro responsável nesta obra." };
  }
  return { ok: true };
}

export async function countPendingWorkflowTasks(userId: string, companyId: string) {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(workflowTasks)
    .where(
      and(eq(workflowTasks.assignedUserId, userId), eq(workflowTasks.companyId, companyId), eq(workflowTasks.status, "pending")),
    );
  return row?.value ?? 0;
}
