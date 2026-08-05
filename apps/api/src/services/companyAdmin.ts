import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getPlanDefinition } from "@sigo/shared";
import { db } from "../db/index.js";
import {
  budgetDocuments,
  companies,
  plants,
  platformPayments,
  practiceClients,
  practiceEngagements,
  practiceQuotes,
  projects,
  subscriptions,
  users,
} from "../db/schema.js";

export type CompanyUsage = {
  users: number;
  activeUsers: number;
  projects: number;
  budgets: number;
  plants: number;
  practiceClients: number;
  practiceQuotes: number;
  practiceEngagements: number;
  maxUsers: number | null;
  maxProjects: number | null;
  usersNearLimit: boolean;
  projectsNearLimit: boolean;
  lastLoginAt: string | null;
};

export async function getCompanyUsage(companyId: string, planKey: string): Promise<CompanyUsage> {
  const plan = getPlanDefinition(planKey);
  const [
    [{ value: userCount }],
    [{ value: activeUserCount }],
    [{ value: projectCount }],
    [{ value: budgetCount }],
    [{ value: plantCount }],
    [{ value: clientCount }],
    [{ value: quoteCount }],
    [{ value: engagementCount }],
    [lastLogin],
  ] = await Promise.all([
    db.select({ value: count() }).from(users).where(eq(users.companyId, companyId)),
    db.select({ value: count() }).from(users).where(and(eq(users.companyId, companyId), eq(users.isActive, true))),
    db.select({ value: count() }).from(projects).where(eq(projects.companyId, companyId)),
    db
      .select({ value: count() })
      .from(budgetDocuments)
      .innerJoin(projects, eq(budgetDocuments.projectId, projects.id))
      .where(eq(projects.companyId, companyId)),
    db
      .select({ value: count() })
      .from(plants)
      .innerJoin(projects, eq(plants.projectId, projects.id))
      .where(eq(projects.companyId, companyId)),
    db.select({ value: count() }).from(practiceClients).where(eq(practiceClients.companyId, companyId)),
    db.select({ value: count() }).from(practiceQuotes).where(eq(practiceQuotes.companyId, companyId)),
    db.select({ value: count() }).from(practiceEngagements).where(eq(practiceEngagements.companyId, companyId)),
    db
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.companyId, companyId))
      .orderBy(desc(users.lastLoginAt))
      .limit(1),
  ]);

  const usersN = Number(userCount);
  const projectsN = Number(projectCount);
  const maxUsers = plan?.maxUsers ?? null;
  const maxProjects = plan?.maxProjects ?? null;

  return {
    users: usersN,
    activeUsers: Number(activeUserCount),
    projects: projectsN,
    budgets: Number(budgetCount),
    plants: Number(plantCount),
    practiceClients: Number(clientCount),
    practiceQuotes: Number(quoteCount),
    practiceEngagements: Number(engagementCount),
    maxUsers,
    maxProjects,
    usersNearLimit: maxUsers != null && usersN >= Math.max(1, maxUsers - 1),
    projectsNearLimit: maxProjects != null && projectsN >= Math.max(1, maxProjects - 1),
    lastLoginAt: lastLogin?.lastLoginAt ? lastLogin.lastLoginAt.toISOString() : null,
  };
}

export async function getCompaniesUsageMap(companyIds: string[], planByCompany: Map<string, string>) {
  if (!companyIds.length) return new Map<string, CompanyUsage>();

  const [userRows, activeRows, projectRows, loginRows] = await Promise.all([
    db
      .select({ companyId: users.companyId, value: count() })
      .from(users)
      .where(inArray(users.companyId, companyIds))
      .groupBy(users.companyId),
    db
      .select({ companyId: users.companyId, value: count() })
      .from(users)
      .where(and(inArray(users.companyId, companyIds), eq(users.isActive, true)))
      .groupBy(users.companyId),
    db
      .select({ companyId: projects.companyId, value: count() })
      .from(projects)
      .where(inArray(projects.companyId, companyIds))
      .groupBy(projects.companyId),
    db
      .select({
        companyId: users.companyId,
        lastLoginAt: sql<Date | null>`max(${users.lastLoginAt})`,
      })
      .from(users)
      .where(inArray(users.companyId, companyIds))
      .groupBy(users.companyId),
  ]);

  const usersMap = new Map(userRows.map((r) => [r.companyId!, Number(r.value)]));
  const activeMap = new Map(activeRows.map((r) => [r.companyId!, Number(r.value)]));
  const projectsMap = new Map(projectRows.map((r) => [r.companyId!, Number(r.value)]));
  const loginMap = new Map(
    loginRows.map((r) => [r.companyId!, r.lastLoginAt ? new Date(r.lastLoginAt).toISOString() : null]),
  );

  const result = new Map<string, CompanyUsage>();
  for (const id of companyIds) {
    const plan = getPlanDefinition(planByCompany.get(id) ?? "free");
    const usersN = usersMap.get(id) ?? 0;
    const projectsN = projectsMap.get(id) ?? 0;
    const maxUsers = plan?.maxUsers ?? null;
    const maxProjects = plan?.maxProjects ?? null;
    result.set(id, {
      users: usersN,
      activeUsers: activeMap.get(id) ?? 0,
      projects: projectsN,
      budgets: 0,
      plants: 0,
      practiceClients: 0,
      practiceQuotes: 0,
      practiceEngagements: 0,
      maxUsers,
      maxProjects,
      usersNearLimit: maxUsers != null && usersN >= Math.max(1, maxUsers - 1),
      projectsNearLimit: maxProjects != null && projectsN >= Math.max(1, maxProjects - 1),
      lastLoginAt: loginMap.get(id) ?? null,
    });
  }
  return result;
}

export async function getPaymentsTotalByCompany(companyIds: string[]) {
  if (!companyIds.length) return new Map<string, number>();
  const rows = await db
    .select({
      companyId: platformPayments.companyId,
      total: sql<string>`coalesce(sum(${platformPayments.amount}), 0)`,
    })
    .from(platformPayments)
    .where(inArray(platformPayments.companyId, companyIds))
    .groupBy(platformPayments.companyId);
  return new Map(rows.map((r) => [r.companyId, Number(r.total)]));
}

export async function listCompanyPayments(companyId: string) {
  return db
    .select()
    .from(platformPayments)
    .where(eq(platformPayments.companyId, companyId))
    .orderBy(desc(platformPayments.paidAt));
}

export async function buildCompanyBackup(companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return null;

  const [subRows, paymentRows, userRows, projectRows, clientRows, quoteRows, engagementRows] = await Promise.all([
    db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).orderBy(desc(subscriptions.createdAt)),
    listCompanyPayments(companyId),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
        preferredLanguage: users.preferredLanguage,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.companyId, companyId)),
    db.select().from(projects).where(eq(projects.companyId, companyId)),
    db.select().from(practiceClients).where(eq(practiceClients.companyId, companyId)),
    db.select().from(practiceQuotes).where(eq(practiceQuotes.companyId, companyId)),
    db.select().from(practiceEngagements).where(eq(practiceEngagements.companyId, companyId)),
  ]);

  const usage = await getCompanyUsage(companyId, subRows[0]?.plan ?? "free");

  return {
    exportedAt: new Date().toISOString(),
    format: "sigo-company-backup-v1",
    company,
    subscription: subRows[0] ?? null,
    subscriptionHistory: subRows,
    payments: paymentRows,
    users: userRows,
    projects: projectRows,
    practice: {
      clients: clientRows,
      quotes: quoteRows,
      engagements: engagementRows,
    },
    usage,
  };
}
