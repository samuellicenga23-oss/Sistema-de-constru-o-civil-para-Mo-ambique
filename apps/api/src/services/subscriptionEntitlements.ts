import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  clampModulesToPlan,
  creditsActionPath,
  getCreditPack,
  resolveEntitlements,
  type CompanyModuleKey,
  type CreditKind,
  type ResolvedEntitlements,
} from "@sigo/shared";
import { db } from "../db/index.js";
import {
  costCompositions,
  plants,
  projects,
  subscriptionCreditBalances,
  subscriptionCreditLedger,
  subscriptions,
  usageEvents,
} from "../db/schema.js";

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
  await consumeCreditAfterUsage(companyId, kind);
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
  const fromEvents = await countUsageThisMonth(companyId, "plant_analysis");
  const [{ value }] = await db
    .select({ value: count() })
    .from(plants)
    .innerJoin(projects, eq(projects.id, plants.projectId))
    .where(and(eq(projects.companyId, companyId), gte(plants.uploadedAt, startOfUtcMonth())));
  return Math.max(fromEvents, value);
}

export type CreditBalances = {
  smartImportCredits: number;
  plantAnalysisCredits: number;
};

export async function getCreditBalances(companyId: string): Promise<CreditBalances> {
  const [row] = await db
    .select()
    .from(subscriptionCreditBalances)
    .where(eq(subscriptionCreditBalances.companyId, companyId))
    .limit(1);
  return {
    smartImportCredits: row?.smartImportCredits ?? 0,
    plantAnalysisCredits: row?.plantAnalysisCredits ?? 0,
  };
}

async function ensureCreditBalanceRow(companyId: string) {
  await db
    .insert(subscriptionCreditBalances)
    .values({ companyId, smartImportCredits: 0, plantAnalysisCredits: 0 })
    .onConflictDoNothing();
}

export async function grantCredits(input: {
  companyId: string;
  smartImports?: number;
  plantAnalyses?: number;
  packId?: string | null;
  reason?: string;
  note?: string | null;
  amountMzn?: number | null;
  recordedByUserId?: string | null;
}): Promise<CreditBalances> {
  const pack = getCreditPack(input.packId);
  const smartDelta = input.smartImports ?? pack?.smartImports ?? 0;
  const plantDelta = input.plantAnalyses ?? pack?.plantAnalyses ?? 0;
  if (smartDelta <= 0 && plantDelta <= 0) {
    throw new Error("Indique uma quantidade de créditos positiva.");
  }

  await ensureCreditBalanceRow(input.companyId);
  const reason = input.reason ?? (pack ? "pack_grant" : "admin_grant");

  await db.transaction(async (tx) => {
    if (smartDelta > 0) {
      await tx
        .update(subscriptionCreditBalances)
        .set({
          smartImportCredits: sql`${subscriptionCreditBalances.smartImportCredits} + ${smartDelta}`,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionCreditBalances.companyId, input.companyId));
      await tx.insert(subscriptionCreditLedger).values({
        companyId: input.companyId,
        kind: "smart_import",
        delta: smartDelta,
        packId: input.packId ?? null,
        reason,
        note: input.note ?? null,
        amountMzn: input.amountMzn != null ? String(input.amountMzn) : null,
        recordedByUserId: input.recordedByUserId ?? null,
      });
    }
    if (plantDelta > 0) {
      await tx
        .update(subscriptionCreditBalances)
        .set({
          plantAnalysisCredits: sql`${subscriptionCreditBalances.plantAnalysisCredits} + ${plantDelta}`,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionCreditBalances.companyId, input.companyId));
      await tx.insert(subscriptionCreditLedger).values({
        companyId: input.companyId,
        kind: "plant_analysis",
        delta: plantDelta,
        packId: input.packId ?? null,
        reason,
        note: input.note ?? null,
        amountMzn: input.amountMzn != null ? String(input.amountMzn) : null,
        recordedByUserId: input.recordedByUserId ?? null,
      });
    }
  });

  return getCreditBalances(input.companyId);
}

async function tryConsumeOneCredit(companyId: string, kind: CreditKind): Promise<boolean> {
  await ensureCreditBalanceRow(companyId);
  const column =
    kind === "smart_import"
      ? subscriptionCreditBalances.smartImportCredits
      : subscriptionCreditBalances.plantAnalysisCredits;

  const updated = await db
    .update(subscriptionCreditBalances)
    .set({
      ...(kind === "smart_import"
        ? { smartImportCredits: sql`${subscriptionCreditBalances.smartImportCredits} - 1` }
        : { plantAnalysisCredits: sql`${subscriptionCreditBalances.plantAnalysisCredits} - 1` }),
      updatedAt: new Date(),
    })
    .where(and(eq(subscriptionCreditBalances.companyId, companyId), gte(column, 1)))
    .returning();

  if (!updated.length) return false;

  await db.insert(subscriptionCreditLedger).values({
    companyId,
    kind,
    delta: -1,
    reason: "usage_consume",
    note: null,
    amountMzn: null,
    recordedByUserId: null,
  });
  return true;
}

/** Depois de gravar usage_event: se o mês já passou do incluído, consome crédito. */
async function consumeCreditAfterUsage(companyId: string, kind: UsageKind) {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return;
  const included = kind === "smart_import" ? ent.smartImportsPerMonth : ent.plantAnalysesPerMonth;
  if (included == null) return;
  const used =
    kind === "smart_import" ? await countUsageThisMonth(companyId, kind) : await countPlantAnalysesThisMonth(companyId);
  if (used > included) {
    await tryConsumeOneCredit(companyId, kind);
  }
}

export async function listCreditLedger(companyId: string, limit = 40) {
  return db
    .select()
    .from(subscriptionCreditLedger)
    .where(eq(subscriptionCreditLedger.companyId, companyId))
    .orderBy(desc(subscriptionCreditLedger.createdAt))
    .limit(limit);
}

export type EntitlementBlock = {
  code: string;
  error: string;
  upgradeHint?: string;
  /** Rota in-app para resolver (créditos ou planos). */
  actionPath?: string;
};

function block(code: string, error: string, upgradeHint?: string): EntitlementBlock {
  return {
    code,
    error,
    upgradeHint,
    actionPath: creditsActionPath(code),
  };
}

export async function assertCanWrite(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  if (ent.status === "suspenso") {
    return block(
      "SUBSCRIPTION_SUSPENDED",
      "A subscrição da empresa está suspensa. Contacte o suporte.",
      "Reactivar o plano em Créditos e planos.",
    );
  }
  if (ent.expired) {
    return block(
      "SUBSCRIPTION_EXPIRED",
      "O período experimental ou a validade do plano terminou. Os dados estão seguros — active um plano para continuar a editar.",
      "Escolha Individual, Profissional ou Empresa para retomar o trabalho.",
    );
  }
  return null;
}

export async function assertUserSeat(_companyId: string): Promise<EntitlementBlock | null> {
  return null;
}

export async function assertActiveProjectSlot(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.maxActiveProjects == null) return null;
  const current = await countActiveProjects(companyId);
  if (current >= ent.maxActiveProjects) {
    return block(
      "PLAN_PROJECT_LIMIT",
      `Atingiu o limite de ${ent.maxActiveProjects} obra(s) activa(s) do plano ${ent.planLabel}. Arquive uma obra ou mude de plano.`,
      "Comparar planos e pedir upgrade",
    );
  }
  return null;
}

export async function assertSmartImportQuota(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.smartImportsPerMonth == null) return null;
  const used = await countUsageThisMonth(companyId, "smart_import");
  if (used < ent.smartImportsPerMonth) return null;
  const credits = await getCreditBalances(companyId);
  if (credits.smartImportCredits > 0) return null;
  return block(
    "PLAN_SMART_IMPORT_LIMIT",
    `Utilizou as ${ent.smartImportsPerMonth} importações inteligentes incluídas neste mês (${ent.planLabel}). Aumente créditos para continuar sem esperar pela renovação mensal.`,
    "Comprar pack de importações",
  );
}

export async function assertPlantAnalysisQuota(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.plantAnalysesPerMonth == null) return null;
  const used = await countPlantAnalysesThisMonth(companyId);
  if (used < ent.plantAnalysesPerMonth) return null;
  const credits = await getCreditBalances(companyId);
  if (credits.plantAnalysisCredits > 0) return null;
  return block(
    "PLAN_PLANT_LIMIT",
    `Utilizou as ${ent.plantAnalysesPerMonth} análises de plantas incluídas neste mês (${ent.planLabel}). Aumente créditos para continuar sem esperar pela renovação mensal.`,
    "Comprar pack de plantas",
  );
}

export async function assertCustomCompositionSlot(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent || ent.customCompositions == null) return null;
  const current = await countCustomCompositions(companyId);
  if (current >= ent.customCompositions) {
    return block(
      "PLAN_COMPOSITION_LIMIT",
      `O plano ${ent.planLabel} permite até ${ent.customCompositions} composições próprias. Mude para Profissional para ilimitadas.`,
      "Comparar planos",
    );
  }
  return null;
}

export async function assertTeamManagement(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  if (!ent.teamManagement) {
    return block(
      "PLAN_TEAM_REQUIRED",
      "O plano Individual permite 1 utilizador. Para trabalhar em equipa, escolha Profissional.",
      "Activar Profissional",
    );
  }
  return null;
}

export async function assertCompanyBranding(companyId: string): Promise<EntitlementBlock | null> {
  const ent = await getCompanyEntitlements(companyId);
  if (!ent) return null;
  if (!ent.companyBranding) {
    return block(
      "PLAN_BRANDING_REQUIRED",
      "Logótipo e branding da empresa estão disponíveis a partir do plano Profissional.",
      "Activar Profissional",
    );
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
  let credits = { smartImportCredits: 0, plantAnalysisCredits: 0 };
  try {
    credits = await getCreditBalances(companyId);
  } catch {
    // Migração ainda não aplicada ou tabela indisponível — não bloquear a página de créditos.
  }
  return {
    ...ent,
    usage: {
      activeProjects,
      smartImportsUsed,
      plantAnalysesUsed,
      customCompositions,
    },
    credits,
  };
}
