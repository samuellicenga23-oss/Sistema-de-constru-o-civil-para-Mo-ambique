import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { contractVariations, projectContracts, projects } from "../db/schema.js";
import { recordAuditEvent } from "./auditTrail.js";

export type ClientDecisionStatus = "pendente" | "aprovado" | "rejeitado";

export type ClientDecisionView = {
  id: string;
  title: string;
  description: string;
  valueImpact: number;
  scheduleDaysImpact: number;
  status: ClientDecisionStatus;
  requestedAt: string;
  decisionAt: string | null;
  decisionNote: string | null;
};

function toView(row: typeof contractVariations.$inferSelect): ClientDecisionView {
  const status: ClientDecisionStatus =
    row.clientDecision === "aprovado" || row.clientDecision === "rejeitado"
      ? row.clientDecision
      : "pendente";
  return {
    id: row.id,
    title: row.title,
    description: row.reason,
    valueImpact: Number(row.amount),
    scheduleDaysImpact: row.impactDays ?? 0,
    status,
    requestedAt: row.createdAt.toISOString(),
    decisionAt: row.clientDecidedAt?.toISOString() ?? null,
    decisionNote: row.clientDecisionNote,
  };
}

export async function listClientDecisions(projectId: string): Promise<ClientDecisionView[]> {
  const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.projectId, projectId)).limit(1);
  if (!contract) return [];
  const rows = await db.select().from(contractVariations).where(eq(contractVariations.contractId, contract.id));
  return rows
    .filter((row) => row.status === "submetida" || row.clientDecision)
    .map(toView);
}

export async function recordPublicClientDecision(args: {
  token: string;
  variationId: string;
  decision: "aprovado" | "rejeitado";
  note?: string | null;
}): Promise<ClientDecisionView> {
  const [project] = await db.select().from(projects).where(eq(projects.publicShareToken, args.token)).limit(1);
  if (!project || project.trashedAt) throw Object.assign(new Error("Link inválido ou desactivado"), { statusCode: 404 });
  const [contract] = await db.select().from(projectContracts).where(eq(projectContracts.projectId, project.id)).limit(1);
  if (!contract) throw Object.assign(new Error("Sem alterações pendentes"), { statusCode: 404 });
  const [variation] = await db
    .select()
    .from(contractVariations)
    .where(and(eq(contractVariations.id, args.variationId), eq(contractVariations.contractId, contract.id)))
    .limit(1);
  if (!variation || variation.status !== "submetida") {
    throw Object.assign(new Error("Alteração não encontrada"), { statusCode: 404 });
  }
  if (variation.clientDecision === "aprovado" || variation.clientDecision === "rejeitado") {
    throw Object.assign(new Error("Esta alteração já tem decisão"), { statusCode: 409 });
  }
  const [updated] = await db
    .update(contractVariations)
    .set({
      clientDecision: args.decision,
      clientDecidedAt: new Date(),
      clientDecisionNote: args.note?.trim() || null,
    })
    .where(eq(contractVariations.id, variation.id))
    .returning();
  await recordAuditEvent({
    companyId: project.companyId,
    projectId: project.id,
    actorUserId: null,
    entityType: "contract_variation",
    entityId: updated.id,
    action: `client.${args.decision}`,
    after: { title: updated.title, clientDecision: updated.clientDecision, amount: updated.amount },
  });
  return toView(updated);
}
