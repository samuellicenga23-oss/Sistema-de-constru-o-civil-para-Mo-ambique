import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditEvents } from "../db/schema.js";

export type AuditSnapshot = Record<string, unknown> | null;

export type AuditEventInput = {
  companyId: string;
  projectId?: string | null;
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
  metadata?: AuditSnapshot;
};

// Mantém o histórico útil sem levar campos sensíveis de identidade para a auditoria. O serviço é
// também a única porta de escrita usada pelos fluxos de negócio; não expor CRUD para audit_events.
export async function recordAuditEvent(event: AuditEventInput) {
  const [created] = await db
    .insert(auditEvents)
    .values({
      companyId: event.companyId,
      projectId: event.projectId ?? null,
      actorUserId: event.actorUserId ?? null,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      action: event.action,
      beforeData: event.before ?? null,
      afterData: event.after ?? null,
      metadata: event.metadata ?? null,
    })
    .returning();
  return created;
}

export async function getProjectAuditEvents(companyId: string, projectId: string, limit = 100) {
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.companyId, companyId), eq(auditEvents.projectId, projectId)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}
