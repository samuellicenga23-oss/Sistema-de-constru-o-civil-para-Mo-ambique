import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import {
  clampModulesToPlan,
  resolveEntitlements,
  type CompanyModuleKey,
  type ResolvedEntitlements,
} from "@sigo/shared";
import { db } from "../db/index.js";
import { costCompositions, plants, projects, subscriptions, usageEvents } from "../db/schema.js";

export type UsageKind = "smart_import" | "plant_analysis";

export async function getCompanySubscription(companyId: string) {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.companyId, companyId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return sub ?? null;
}

export async function getCompanyEntitlements(companyId: string): Promise<ResolvedEntitlements | null> {
  const sub = await getCompanySubscription(companyId);
  if (!sub) return null;
  return resolveEntitlements({
    plan: sub.plan,
    status: sub.status,
    expiresAt: sub.expiresAt,
  });
}

function startOfUtcMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function countUsageThisMonth(companyId: string, kind: UsageKind): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.companyId, companyId), eq(usageEvents.kind, kind), gte(usageEvents.createdAt, startOfUtcMonth())),
    );
  return value;
}

export async function recordUsage(companyId: string, kind: UsageKind) {
  await db.insert(usageEvents).values({ companyId, kind });
}

export async function countActiveProjects(companyId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt)));
  return value;
}

export async function countCustomCompositions(companyId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(costCompositions)
    .where(eq(costCompositions.companyId, companyId));
  return value;
}

export async function countPlantAnalysesThisMonth(companyId: string): Promise<number> {
  // Combinar eventos e plantas do mês (legado) — evita subcontagem na transição.
  const fromEvents = await countUsageThisMonth(companyId, "plant_analysis");
  const [{ value }] = await db
    .select({ value: count() })
    .from(plants)
    .innerJoin(projects, eq(projects.id, plants.projectId))
    .where(and(eq(projects.companyId, companyId), gte(plants.uploadedAt, startOfUtcMonth())));
  return Math.max(fromEvents, value);
}

export type EntitlementBlock = {
  code: string;
  error: string;
  upgradeHint?: string;
};

export async function assertCanWrite(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  if (ent.status === "suspenso") {
    return { code: "SUBSCRIPTION_SUSPENDED", error: "A subscrição da empresa está suspensa. Contacte o suporte." };
  }
  if (ent.expired) {
    return {
      code: "SUBSCRIPTION_EXPIRED",
      error:
        "O período experimental ou a validade do plano terminou. Os dados estão seguros — active um plano para continuar a editar.",
      upgradeHint: "Escolha Individual, Profissional ou Empresa para retomar o trabalho.",
    };
  }
  return null;
}

export async function assertUserSeat(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  if (!ent.teamManagement && ent.maxUsers === 1) {
    // Ainda permite o 1.º utilizador; o limite é contado no route.
  }
  return null;
}

export async function assertActiveProjectSlot(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.maxActiveProjects == null) return null;
  const current = await countActiveProjects(companyId);
  if (current >= ent.maxActiveProjects) {
    return {
      code: "PLAN_PROJECT_LIMIT",
      error: `Atingiu o limite de ${ent.maxActiveProjects} obra(s) activa(s) do plano ${ent.planLabel}. Arquive uma obra ou mude de plano.`,
      upgradeHint: "Comparar planos",
    };
  }
  return null;
}

export async function assertSmartImportQuota(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.smartImportsPerMonth == null) return null;
  const used = await countUsageThisMonth(companyId, "smart_import");
  if (used >= ent.smartImportsPerMonth) {
    return {
      code: "PLAN_SMART_IMPORT_LIMIT",
      error: `Utilizou as ${ent.smartImportsPerMonth} importações inteligentes incluídas neste mês (${ent.planLabel}).`,
      upgradeHint: "Aguarde a renovação mensal ou mude de plano.",
    };
  }
  return null;
}

export async function assertPlantAnalysisQuota(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.plantAnalysesPerMonth == null) return null;
  const used = await countPlantAnalysesThisMonth(companyId);
  if (used >= ent.plantAnalysesPerMonth) {
    return {
      code: "PLAN_PLANT_LIMIT",
      error: `Utilizou as ${ent.plantAnalysesPerMonth} análises de plantas incluídas neste mês (${ent.planLabel}).`,
      upgradeHint: "Aguarde a renovação mensal ou mude de plano.",
    };
  }
  return null;
}

export async function assertCustomCompositionSlot(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.customCompositions == null) return null;
  const current = await countCustomCompositions(companyId);
  if (current >= ent.customCompositions) {
    return {
      code: "PLAN_COMPOSITION_LIMIT",
      error: `O plano ${ent.planLabel} permite até ${ent.customCompositions} composições próprias. Mude para Profissional para ilimitadas.`,
    };
  }
  return null;
}

export async function assertTeamManagement(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  if (!ent.teamManagement) {
    return {
      code: "PLAN_TEAM_REQUIRED",
      error: "O plano Individual permite 1 utilizador. Para trabalhar em equipa, escolha Profissional.",
      upgradeHint: "Activar Profissional",
    };
  }
  return null;
}

export async function assertCompanyBranding(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  if (!ent.companyBranding) {
    return {
      code: "PLAN_BRANDING_REQUIRED",
      error: "Logótipo e branding da empresa estão disponíveis a partir do plano Profissional.",
    };
  }
  return null;
}

export function clampCompanyModules(
  requested: CompanyModuleKey[] | null | undefined,
  planKey: string | null | undefined,
): CompanyModuleKey[] {
  return clampModulesToPlan(requested, planKey);
}

export async function buildSubscriptionSummary(companyId: string) {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  const [activeProjects, smartImportsUsed, plantAnalysesUsed, customCompositions] = await Promise.all([
    countActiveProjects(companyId),
    countUsageThisMonth(companyId, "smart_import"),
    countPlantAnalysesThisMonth(companyId),
    countCustomCompositions(companyId),
  ]);
  return {
    ...ent,
    usage: {
      activeProjects,
      smartImportsUsed,
      plantAnalysesUsed,
      customCompositions,
    },
  };
}
