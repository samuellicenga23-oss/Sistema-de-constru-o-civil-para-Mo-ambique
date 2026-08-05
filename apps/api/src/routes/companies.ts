import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, desc, count, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { companies, users, subscriptions, projects, sessions } from "../db/schema.js";
import { requireRole, requireCompanyUser, requireAuth } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { getSessionUser, setSessionActingCompany } from "../auth/session.js";
import { env } from "../env.js";
import { COMPANY_MODULE_KEYS, CURRENCIES, SUBSCRIPTION_STATUSES, SUBSCRIPTION_PLAN_KEYS, resolveRoleTemplate, isCompanyUserRole } from "@sigo/shared";
import { detectImageExtension } from "../services/imageValidation.js";
import { syncSigoPricesForCompany } from "../services/sigoPrices.js";
import { recordAuditEvent } from "../services/auditTrail.js";

const createCompanySchema = z.object({
  name: z.string().min(1),
  nuit: z.string().optional(),
  address: z.string().optional(),
  defaultCurrency: z.enum(CURRENCIES).default("MZN"),
  adminName: z.string().min(1),
  adminEmail: z.string().trim().toLowerCase().email(),
  adminPassword: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres"),
});

const colourSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use uma cor hexadecimal válida");
const adminCompanySettingsSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  defaultCurrency: z.enum(CURRENCIES).optional(),
  enabledModules: z.array(z.enum(COMPANY_MODULE_KEYS)).min(1).optional(),
  brandName: z.string().trim().max(100).nullable().optional(),
  primaryColor: colourSchema.optional(),
  accentColor: colourSchema.optional(),
  defaultLanguage: z.enum(["pt", "en"]).optional(),
}).refine((data) => Object.keys(data).length > 0, "Indique pelo menos uma alteração");

const adminCreateUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: z.enum(["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"]),
  preferredLanguage: z.enum(["pt", "en"]).default("pt"),
});

const adminUpdateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  role: z.enum(["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"]).optional(),
  isActive: z.boolean().optional(),
  preferredLanguage: z.enum(["pt", "en"]).optional(),
}).refine((data) => Object.keys(data).length > 0, "Indique pelo menos uma alteração");

async function getLatestSubscription(companyId: string) {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.companyId, companyId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return sub ?? null;
}

export async function companyRoutes(app: FastifyInstance) {
  // ---------- Gestão da plataforma (super_admin) ----------
  app.get("/api/companies", { preHandler: requireRole("super_admin") }, async () => {
    const rows = await db.select().from(companies);
    return Promise.all(
      rows.map(async (c) => ({ ...c, subscription: await getLatestSubscription(c.id) }))
    );
  });

  app.get("/api/companies/:id", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });
    const companyUsers = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.companyId, id));
    return { company, subscription: await getLatestSubscription(id), users: companyUsers };
  });

  app.patch("/api/admin/companies/:id", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminCompanySettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [before] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!before) return reply.code(404).send({ error: "Empresa não encontrada" });
    const [updated] = await db.update(companies).set(parsed.data).where(eq(companies.id, id)).returning();
    await recordAuditEvent({ companyId: id, actorUserId: request.currentUser!.id, entityType: "company", entityId: id, action: "platform_settings_updated", before: { name: before.name, enabledModules: before.enabledModules }, after: { name: updated.name, enabledModules: updated.enabledModules } });
    return { ...updated, subscription: await getLatestSubscription(id) };
  });

  app.get("/api/admin/users", { preHandler: requireRole("super_admin") }, async (request) => {
    const { companyId } = request.query as { companyId?: string };
    const rows = await db
      .select({ user: users, companyName: companies.name })
      .from(users)
      .innerJoin(companies, eq(users.companyId, companies.id))
      .where(companyId ? eq(users.companyId, companyId) : undefined)
      .orderBy(companies.name, users.name);
    return rows.map(({ user, companyName }) => ({
      id: user.id, companyId: user.companyId!, companyName, name: user.name, email: user.email,
      role: user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword,
      preferredLanguage: user.preferredLanguage, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
    }));
  });

  app.post("/api/admin/companies/:id/users", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id: companyId } = request.params as { id: string };
    const parsed = adminCreateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (existing) return reply.code(409).send({ error: "Já existe um utilizador com este email" });
    const passwordHash = await hashPassword(parsed.data.password);
    const permissions = isCompanyUserRole(parsed.data.role)
      ? resolveRoleTemplate(parsed.data.role, company.rolePermissions)
      : [];
    const [created] = await db.insert(users).values({ companyId, name: parsed.data.name, email: parsed.data.email, passwordHash, role: parsed.data.role, preferredLanguage: parsed.data.preferredLanguage, mustChangePassword: true, permissions }).returning();
    await recordAuditEvent({ companyId, actorUserId: request.currentUser!.id, entityType: "user", entityId: created.id, action: "platform_user_created", after: { role: created.role, isActive: created.isActive } });
    return reply.code(201).send({ id: created.id, companyId, companyName: company.name, name: created.name, email: created.email, role: created.role, isActive: created.isActive, mustChangePassword: created.mustChangePassword, preferredLanguage: created.preferredLanguage, lastLoginAt: created.lastLoginAt, createdAt: created.createdAt });
  });

  app.patch("/api/admin/users/:id", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminUpdateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target?.companyId) return reply.code(404).send({ error: "Utilizador empresarial não encontrado" });
    const removesAdmin = target.role === "admin_empresa" && target.isActive && ((parsed.data.role && parsed.data.role !== "admin_empresa") || parsed.data.isActive === false);
    if (removesAdmin) {
      const [{ value }] = await db.select({ value: count() }).from(users).where(and(eq(users.companyId, target.companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
      if (value <= 1) return reply.code(409).send({ error: "A empresa deve manter pelo menos um administrador activo" });
    }
    const [updated] = await db.update(users).set(parsed.data).where(eq(users.id, id)).returning();
    if (parsed.data.isActive === false) await db.delete(sessions).where(eq(sessions.userId, id));
    await recordAuditEvent({ companyId: target.companyId, actorUserId: request.currentUser!.id, entityType: "user", entityId: id, action: "platform_user_updated", before: { role: target.role, isActive: target.isActive }, after: { role: updated.role, isActive: updated.isActive } });
    const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, target.companyId)).limit(1);
    return { id: updated.id, companyId: target.companyId, companyName: company?.name ?? "", name: updated.name, email: updated.email, role: updated.role, isActive: updated.isActive, mustChangePassword: updated.mustChangePassword, preferredLanguage: updated.preferredLanguage, lastLoginAt: updated.lastLoginAt, createdAt: updated.createdAt };
  });

  app.post("/api/admin/users/:id/reset-password", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ password: z.string().min(8) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target?.companyId) return reply.code(404).send({ error: "Utilizador empresarial não encontrado" });
    await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password), mustChangePassword: true }).where(eq(users.id, id));
    await db.delete(sessions).where(eq(sessions.userId, id));
    await recordAuditEvent({ companyId: target.companyId, actorUserId: request.currentUser!.id, entityType: "user", entityId: id, action: "platform_password_reset", after: { mustChangePassword: true, sessionsRevoked: true } });
    return { ok: true };
  });

  app.post("/api/companies", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const parsed = createCompanySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { name, nuit, address, defaultCurrency, adminName, adminEmail, adminPassword } = parsed.data;

    const [existing] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existing) {
      return reply.code(409).send({ error: "Já existe um utilizador com este email" });
    }

    const [company] = await db
      .insert(companies)
      .values({ name, nuit, address, defaultCurrency })
      .returning();

    const passwordHash = await hashPassword(adminPassword);
    const [admin] = await db
      .insert(users)
      .values({
        companyId: company.id,
        name: adminName,
        email: adminEmail,
        passwordHash,
        role: "admin_empresa",
        mustChangePassword: true,
        permissions: resolveRoleTemplate("admin_empresa"),
      })
      .returning();

    // Nova empresa criada pelo super_admin começa em trial do plano Profissional (secção 37 do
    // documento comercial) — a contagem automática de 14 dias e a passagem a Free no fim ainda
    // não estão implementadas (precisa de um campo de data de expiração do trial, para adicionar
    // depois); por agora o super_admin muda manualmente o estado quando o trial terminar.
    await db.insert(subscriptions).values({ companyId: company.id, plan: "profissional", status: "trial" });
    await syncSigoPricesForCompany(company.id);

    return reply.code(201).send({
      company,
      admin: { id: admin.id, name: admin.name, email: admin.email },
    });
  });

  // Activar/suspender/mudar de plano manualmente — não há gateway de pagamento em v1, a
  // factura é feita fora do sistema e o super_admin regista aqui o resultado.
  app.put("/api/companies/:id/subscription", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ status: z.enum(SUBSCRIPTION_STATUSES).optional(), plan: z.enum(SUBSCRIPTION_PLAN_KEYS as [string, ...string[]]).optional() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const current = await getLatestSubscription(id);
    if (!current) return reply.code(404).send({ error: "Empresa sem subscrição" });

    const nextStatus = parsed.data.status ?? current.status;
    const [row] = await db
      .update(subscriptions)
      .set({
        status: nextStatus,
        plan: parsed.data.plan ?? current.plan,
        activatedAt: nextStatus === "activo" ? new Date() : current.activatedAt,
        activatedByUserId: nextStatus === "activo" ? request.currentUser!.id : current.activatedByUserId,
      })
      .where(eq(subscriptions.id, current.id))
      .returning();

    // Ao suspender, termina sessões activas da empresa para o bloqueio não depender do TTL.
    if (nextStatus === "suspenso" && nextStatus !== current.status) {
      const companyUsers = await db.select({ id: users.id }).from(users).where(eq(users.companyId, id));
      const userIds = companyUsers.map((u) => u.id);
      if (userIds.length) {
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
      }
    }

    return row;
  });

  // Estatísticas para o painel do super_admin (Fase 1, Etapa 5) — antes o painel só listava
  // empresas, sem nenhum resumo agregado da plataforma.
  app.get("/api/admin/stats", { preHandler: requireRole("super_admin") }, async () => {
    const allCompanies = await db.select().from(companies);
    const allSubscriptions = await db.select().from(subscriptions);

    const latestByCompany = new Map<string, (typeof allSubscriptions)[number]>();
    for (const s of allSubscriptions) {
      const current = latestByCompany.get(s.companyId);
      if (!current || s.createdAt > current.createdAt) latestByCompany.set(s.companyId, s);
    }

    let activeCompanies = 0;
    let trialCompanies = 0;
    let suspendedCompanies = 0;
    const planCounts: Record<string, number> = {};
    for (const c of allCompanies) {
      const sub = latestByCompany.get(c.id);
      const status = sub?.status ?? "trial";
      if (status === "activo") activeCompanies++;
      else if (status === "suspenso") suspendedCompanies++;
      else trialCompanies++;
      const plan = sub?.plan ?? "free";
      planCounts[plan] = (planCounts[plan] ?? 0) + 1;
    }

    const [{ value: totalUsers }] = await db.select({ value: count() }).from(users);
    const [{ value: totalProjects }] = await db.select({ value: count() }).from(projects);

    // Estado dos serviços — a própria API está claramente "no ar" (está a responder a este
    // pedido); o plant-service precisa de um ping real porque corre num processo à parte.
    let plantServiceUp = false;
    let plantAi: unknown = null;
    try {
      const res = await fetch(`${env.plantServiceUrl}/health`, { signal: AbortSignal.timeout(3000) });
      plantServiceUp = res.ok;
      if (res.ok) {
        try {
          const body = (await res.json()) as { ai?: unknown };
          plantAi = body.ai ?? null;
        } catch {
          plantAi = null;
        }
      }
    } catch {
      plantServiceUp = false;
    }

    return {
      totalCompanies: allCompanies.length,
      activeCompanies,
      trialCompanies,
      suspendedCompanies,
      totalUsers: Number(totalUsers),
      totalProjects: Number(totalProjects),
      planCounts,
      services: { api: true, plantService: plantServiceUp, plantAi },
    };
  });

  // Super-admin entra no espaço de uma empresa (sessão com acting_company_id).
  app.post("/api/admin/companies/:id/enter", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id: companyId } = request.params as { id: string };
    const sessionId = request.cookies?.sid;
    if (!sessionId) return reply.code(401).send({ error: "Não autenticado" });

    const [company] = await db
      .select({ id: companies.id, name: companies.name, brandName: companies.brandName })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });

    await setSessionActingCompany(sessionId, company.id);
    await recordAuditEvent({
      companyId: company.id,
      actorUserId: request.currentUser!.id,
      entityType: "company",
      entityId: company.id,
      action: "impersonation.enter",
      metadata: {
        actorEmail: request.currentUser!.email,
        companyName: company.brandName || company.name,
      },
    });

    const refreshed = await getSessionUser(sessionId);
    if (!refreshed) return reply.code(401).send({ error: "Sessão inválida ou expirada" });
    return refreshed;
  });

  app.post("/api/admin/impersonation/exit", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.currentUser!;
    if (user.platformRole !== "super_admin" && user.role !== "super_admin") {
      return reply.code(403).send({ error: "Sem permissão para esta acção" });
    }
    const sessionId = request.cookies?.sid;
    if (!sessionId) return reply.code(401).send({ error: "Não autenticado" });

    const previousCompanyId = user.actingCompanyId ?? user.companyId;
    await setSessionActingCompany(sessionId, null);

    if (previousCompanyId) {
      await recordAuditEvent({
        companyId: previousCompanyId,
        actorUserId: user.id,
        entityType: "company",
        entityId: previousCompanyId,
        action: "impersonation.exit",
        metadata: {
          actorEmail: user.email,
          companyName: user.actingCompanyName ?? null,
        },
      });
    }

    const refreshed = await getSessionUser(sessionId);
    if (!refreshed) return reply.code(401).send({ error: "Sessão inválida ou expirada" });
    return refreshed;
  });

  // ---------- Definições da própria empresa (admin_empresa) ----------
  app.get("/api/companies/me", { preHandler: requireCompanyUser }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });
    return { company, subscription: await getLatestSubscription(companyId) };
  });

  app.put("/api/companies/me", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const parsed = z
      .object({
        name: z.string().min(1).optional(),
        nuit: z.string().optional(),
        address: z.string().optional(),
        province: z.string().optional(),
        district: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().email().or(z.literal("")).optional(),
        website: z.string().optional(),
        bankDetails: z.string().optional(),
        documentFooter: z.string().optional(),
        responsibleName: z.string().optional(),
        defaultCurrency: z.enum(CURRENCIES).optional(),
        workingDaysPerMonth: z.number().int().min(1).max(31).optional(),
        workingHoursPerDay: z.number().min(1).max(24).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { workingDaysPerMonth, workingHoursPerDay, email, ...rest } = parsed.data;

    const [row] = await db
      .update(companies)
      .set({
        ...rest,
        ...(email !== undefined ? { email: email || null } : {}),
        ...(workingDaysPerMonth !== undefined ? { workingDaysPerMonth } : {}),
        ...(workingHoursPerDay !== undefined ? { workingHoursPerDay: workingHoursPerDay.toString() } : {}),
      })
      .where(eq(companies.id, companyId))
      .returning();
    return row;
  });

  app.post("/api/companies/me/logo", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });

    const buffer = await data.toBuffer();
    const ext = detectImageExtension(buffer);
    if (!ext) return reply.code(400).send({ error: "Ficheiro inválido — só são aceites imagens PNG, JPG, WEBP ou GIF" });

    const uploadsDir = path.join(env.uploadsDir, "logos");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${randomUUID()}${ext}`;
    await writeFile(path.join(uploadsDir, fileName), buffer);

    const logoUrl = `/uploads/logos/${fileName}`;
    const [row] = await db.update(companies).set({ logoUrl }).where(eq(companies.id, companyId)).returning();
    return row;
  });
}
