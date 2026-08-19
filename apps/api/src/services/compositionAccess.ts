import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { compositionShares, costCompositions } from "../db/schema.js";

export type CompositionActor = {
  id: string;
  role: string;
  companyId: string | null;
};

export type CompositionVisibility = "private" | "shared" | "company" | "global";

export async function listSharedCompositionIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ compositionId: compositionShares.compositionId })
    .from(compositionShares)
    .innerJoin(costCompositions, eq(compositionShares.compositionId, costCompositions.id))
    .where(and(eq(compositionShares.userId, userId), eq(costCompositions.visibility, "shared")));
  return rows.map((row) => row.compositionId);
}

export async function compositionVisibleCondition(actor: CompositionActor): Promise<SQL | undefined> {
  if (actor.role === "super_admin") {
    return isNull(costCompositions.companyId);
  }
  if (!actor.companyId) return eq(costCompositions.id, "00000000-0000-0000-0000-000000000000");
  const sharedIds = await listSharedCompositionIds(actor.id);
  const clauses: SQL[] = [
    isNull(costCompositions.companyId),
    and(eq(costCompositions.companyId, actor.companyId), eq(costCompositions.visibility, "company"))!,
    and(eq(costCompositions.companyId, actor.companyId), eq(costCompositions.ownerUserId, actor.id))!,
  ];
  if (sharedIds.length) clauses.push(inArray(costCompositions.id, sharedIds));
  return or(...clauses);
}

export async function getVisibleComposition(compositionId: string, actor: CompositionActor) {
  const [row] = await db.select().from(costCompositions).where(and(eq(costCompositions.id, compositionId), await compositionVisibleCondition(actor))).limit(1);
  return row ?? null;
}

export async function getSharePermission(compositionId: string, userId: string) {
  const [row] = await db.select().from(compositionShares).where(and(eq(compositionShares.compositionId, compositionId), eq(compositionShares.userId, userId))).limit(1);
  return row?.permission ?? null;
}

export async function canEditComposition(composition: typeof costCompositions.$inferSelect, actor: CompositionActor) {
  if (composition.companyId == null) return actor.role === "super_admin";
  if (composition.ownerUserId === actor.id) return true;
  if (composition.visibility === "company" && composition.companyId === actor.companyId) {
    return actor.role === "admin_empresa" || actor.role === "orcamentista";
  }
  return (await getSharePermission(composition.id, actor.id)) === "edit";
}

export function matchesCompositionScope(
  composition: { visibility: CompositionVisibility; ownerUserId: string | null; companyId: string | null },
  scope: string | undefined,
  actor: CompositionActor,
  sharedIds: Set<string>,
  compositionId: string,
) {
  if (!scope || scope === "all") return true;
  if (scope === "mine") return composition.ownerUserId === actor.id;
  if (scope === "company") return composition.visibility === "company" && composition.companyId === actor.companyId;
  if (scope === "shared") return composition.visibility === "shared" && (composition.ownerUserId === actor.id || sharedIds.has(compositionId));
  if (scope === "sigo") return composition.companyId == null;
  return true;
}
