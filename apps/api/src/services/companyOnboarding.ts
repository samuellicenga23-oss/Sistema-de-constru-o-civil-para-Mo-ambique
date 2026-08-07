import { db } from "../db/index.js";
import { companies, users, subscriptions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { resolveRoleTemplate } from "@sigo/shared";
import { syncSigoPricesForCompany } from "./sigoPrices.js";

export type CreateTrialCompanyInput = {
  companyName: string;
  nuit?: string;
  address?: string;
  defaultCurrency?: "MZN" | "USD";
  adminName: string;
  adminEmail: string;
  adminPasswordHash: string;
  mustChangePassword: boolean;
  emailVerifiedAt: Date | null;
  emailVerificationToken?: string | null;
  emailVerificationExpiresAt?: Date | null;
};

/**
 * Cria uma empresa nova com o primeiro utilizador (admin_empresa) e trial de 14 dias no plano
 * Individual — mesmo caminho usado tanto pela criação manual do super_admin como pelo registo
 * público (self-service). A única diferença entre os dois é se a conta já nasce verificada.
 */
export async function createTrialCompany(input: CreateTrialCompanyInput) {
  const [company] = await db
    .insert(companies)
    .values({
      name: input.companyName,
      nuit: input.nuit,
      address: input.address,
      defaultCurrency: input.defaultCurrency ?? "MZN",
    })
    .returning();

  const [admin] = await db
    .insert(users)
    .values({
      companyId: company.id,
      name: input.adminName,
      email: input.adminEmail,
      passwordHash: input.adminPasswordHash,
      role: "admin_empresa",
      mustChangePassword: input.mustChangePassword,
      permissions: resolveRoleTemplate("admin_empresa"),
      emailVerifiedAt: input.emailVerifiedAt,
      emailVerificationToken: input.emailVerificationToken ?? null,
      emailVerificationExpiresAt: input.emailVerificationExpiresAt ?? null,
    })
    .returning();

  // Trial 14 dias no plano Individual — entitlements de trial (limites baixos) vêm de resolveEntitlements.
  const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const { clampCompanyModules } = await import("./subscriptionEntitlements.js");
  const trialModules = clampCompanyModules(undefined, "individual");
  await db.update(companies).set({ enabledModules: trialModules }).where(eq(companies.id, company.id));
  await db.insert(subscriptions).values({
    companyId: company.id,
    plan: "individual",
    status: "trial",
    billingCycle: "trial",
    expiresAt: trialEnds,
  });
  try {
    await syncSigoPricesForCompany(company.id);
  } catch (error) {
    // Cotação automática / contas de fornecedor podem ainda não existir (migração pendente).
    // A empresa e o trial têm de ficar criados na mesma — o sync corre depois nos jobs manuais.
    console.warn("[companyOnboarding] syncSigoPricesForCompany falhou (não bloqueia o trial)", error);
  }

  return { company, admin };
}
