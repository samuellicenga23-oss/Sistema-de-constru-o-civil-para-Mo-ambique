import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { maputoTodayIso } from "@sigo/shared";
import { recordAuditEvent } from "./auditTrail.js";

export type UserDelegationSettings = {
  absentFrom: string | null;
  absentTo: string | null;
  delegateUserId: string | null;
  delegateTaskTypes: string[];
  notificationPrefs: { digestEmail?: boolean };
};

export function isUserAbsent(row: {
  absentFrom: string | null;
  absentTo: string | null;
}, onDate = maputoTodayIso()): boolean {
  if (!row.absentFrom && !row.absentTo) return false;
  if (row.absentFrom && onDate < row.absentFrom) return false;
  if (row.absentTo && onDate > row.absentTo) return false;
  return Boolean(row.absentFrom || row.absentTo);
}

export async function resolveTaskAssignee(input: {
  companyId: string;
  intendedUserId: string;
  workflowType: string;
  onDate?: string;
}): Promise<{ userId: string; delegatedFrom?: string }> {
  const [assignee] = await db
    .select({
      id: users.id,
      absentFrom: users.absentFrom,
      absentTo: users.absentTo,
      delegateUserId: users.delegateUserId,
      delegateTaskTypes: users.delegateTaskTypes,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.id, input.intendedUserId), eq(users.companyId, input.companyId), eq(users.isActive, true)))
    .limit(1);
  if (!assignee) return { userId: input.intendedUserId };

  const absent = isUserAbsent(
    { absentFrom: assignee.absentFrom, absentTo: assignee.absentTo },
    input.onDate,
  );
  if (!absent || !assignee.delegateUserId) return { userId: input.intendedUserId };

  const allowed = assignee.delegateTaskTypes ?? [];
  if (allowed.length && !allowed.includes(input.workflowType) && !allowed.includes("*")) {
    return { userId: input.intendedUserId };
  }

  const delegateId = await validateDelegateChain({
    companyId: input.companyId,
    fromUserId: input.intendedUserId,
    toUserId: assignee.delegateUserId,
  });
  if (!delegateId) return { userId: input.intendedUserId };
  return { userId: delegateId, delegatedFrom: input.intendedUserId };
}

async function validateDelegateChain(input: {
  companyId: string;
  fromUserId: string;
  toUserId: string;
}): Promise<string | null> {
  if (input.fromUserId === input.toUserId) return null;
  const seen = new Set<string>([input.fromUserId]);
  let current = input.toUserId;
  for (let depth = 0; depth < 5; depth++) {
    if (seen.has(current)) return null;
    seen.add(current);
    const [row] = await db
      .select({ id: users.id, delegateUserId: users.delegateUserId, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, current), eq(users.companyId, input.companyId), eq(users.isActive, true)))
      .limit(1);
    if (!row) return null;
    if (!row.delegateUserId || row.delegateUserId === input.fromUserId) return row.id;
    current = row.delegateUserId;
  }
  return null;
}

export async function saveUserDelegationSettings(input: {
  userId: string;
  companyId: string;
  settings: UserDelegationSettings;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.settings.delegateUserId) {
    if (input.settings.delegateUserId === input.userId) {
      return { ok: false, error: "Não pode delegar para si próprio." };
    }
    const [delegate] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.settings.delegateUserId), eq(users.companyId, input.companyId), eq(users.isActive, true)))
      .limit(1);
    if (!delegate) return { ok: false, error: "Delegado inválido ou inactivo." };
    const chainOk = await validateDelegateChain({
      companyId: input.companyId,
      fromUserId: input.userId,
      toUserId: input.settings.delegateUserId,
    });
    if (!chainOk) return { ok: false, error: "Delegação criaria um ciclo — escolha outro utilizador." };
  }

  const [before] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  await db
    .update(users)
    .set({
      absentFrom: input.settings.absentFrom,
      absentTo: input.settings.absentTo,
      delegateUserId: input.settings.delegateUserId,
      delegateTaskTypes: input.settings.delegateTaskTypes,
      notificationPrefs: input.settings.notificationPrefs,
    })
    .where(eq(users.id, input.userId));

  await recordAuditEvent({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    entityType: "user",
    entityId: input.userId,
    action: "user.delegation.updated",
    before: {
      absentFrom: before?.absentFrom,
      absentTo: before?.absentTo,
      delegateUserId: before?.delegateUserId,
      delegateTaskTypes: before?.delegateTaskTypes,
      notificationPrefs: before?.notificationPrefs,
    },
    after: input.settings,
  });

  return { ok: true };
}

export async function getUserDelegationSettings(userId: string): Promise<UserDelegationSettings | null> {
  const [row] = await db
    .select({
      absentFrom: users.absentFrom,
      absentTo: users.absentTo,
      delegateUserId: users.delegateUserId,
      delegateTaskTypes: users.delegateTaskTypes,
      notificationPrefs: users.notificationPrefs,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return {
    absentFrom: row.absentFrom,
    absentTo: row.absentTo,
    delegateUserId: row.delegateUserId,
    delegateTaskTypes: row.delegateTaskTypes ?? [],
    notificationPrefs: row.notificationPrefs ?? { digestEmail: false },
  };
}
