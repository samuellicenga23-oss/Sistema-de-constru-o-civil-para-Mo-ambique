import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, desc, count, inArray, gte, sum } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { db } from "../db/index.js";
import { companies, users, subscriptions, projects, sessions, platformPayments, paymentProofs } from "../db/schema.js";
import { requireRole, requireCompanyUser, requireAuth } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { getSessionUser, setSessionActingCompany } from "../auth/session.js";
import { env } from "../env.js";
import { COMPANY_MODULE_KEYS, CURRENCIES, SUBSCRIPTION_STATUSES, SUBSCRIPTION_PLAN_KEYS, resolveRoleTemplate, isCompanyUserRole, getPlanDefinition } from "@sigo/shared";
import { detectImageExtension, detectProofFileExtension } from "../services/imageValidation.js";
import { sendEmail, emailLayout, escapeHtml, safeContentDispositionFilename } from "../services/mailer.js";
import { createTrialCompany } from "../services/companyOnboarding.js";
import { syncSigoPricesForCompany } from "../services/sigoPrices.js";
import { recordAuditEvent } from "../services/auditTrail.js";
import {
  buildCompanyBackup,
  getCompaniesUsageMap,
  getCompanyUsage,
  getPaymentsTotalByCompany,
  listCompanyPayments,
} from "../services/companyAdmin.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().min(10);
const BILLING_CYCLES = ["monthly", "annual", "custom", "trial"] as const;
const PAYMENT_METHODS = ["transferencia", "mpesa", "emola", "cash", "cartao", "outro"] as const;

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

async function getCompanyAdminEmails(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  return rows.map((r) => r.email);
}

async function getSuperAdminEmails(): Promise<string[]> {
  const rows = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "super_admin"), eq(users.isActive, true)));
  return rows.map((r) => r.email);
}

export async function companyRoutes(app: FastifyInstance) {
  // ---------- Gestão da plataforma (super_admin) ----------
  app.get("/api/companies", { preHandler: requireRole("super_admin") }, async () => {
    const rows = await db.select().from(companies).orderBy(companies.name);
    const ids = rows.map((c) => c.id);
    const subs = await Promise.all(ids.map(async (id) => [id, await getLatestSubscription(id)] as const));
    const planByCompany = new Map(subs.map(([id, sub]) => [id, sub?.plan ?? "free"]));
    const [usageMap, paidMap] = await Promise.all([
      getCompaniesUsageMap(ids, planByCompany),
      getPaymentsTotalByCompany(ids),
    ]);
    return rows.map((c) => {
      const subscription = subs.find(([id]) => id === c.id)?.[1] ?? null;
      return {
        ...c,
        subscription,
        usage: usageMap.get(c.id) ?? null,
        totalPaidMzn: paidMap.get(c.id) ?? 0,
      };
    });
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
    const sub = await getLatestSubscription(id);
    const patch = { ...parsed.data };
    if (patch.enabledModules) {
      const { clampCompanyModules } = await import("../services/subscriptionEntitlements.js");
      patch.enabledModules = clampCompanyModules(patch.enabledModules, sub?.plan ?? "individual");
    }
    const [updated] = await db.update(companies).set(patch).where(eq(companies.id, id)).returning();
    await recordAuditEvent({ companyId: id, actorUserId: request.currentUser!.id, entityType: "company", entityId: id, action: "platform_settings_updated", before: { name: before.name, enabledModules: before.enabledModules }, after: { name: updated.name, enabledModules: updated.enabledModules } });
    return { ...updated, subscription: sub };
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
    const [created] = await db.insert(users).values({ companyId, name: parsed.data.name, email: parsed.data.email, passwordHash, role: parsed.data.role, preferredLanguage: parsed.data.preferredLanguage, mustChangePassword: true, permissions, emailVerifiedAt: new Date() }).returning();
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

    const passwordHash = await hashPassword(adminPassword);
    const { company, admin } = await createTrialCompany({
      companyName: name,
      nuit,
      address,
      defaultCurrency,
      adminName,
      adminEmail,
      adminPasswordHash: passwordHash,
      mustChangePassword: true,
      emailVerifiedAt: new Date(),
    });

    return reply.code(201).send({
      company,
      admin: { id: admin.id, name: admin.name, email: admin.email },
    });
  });

  // Activar/suspender/mudar de plano — factura fora do sistema; o super_admin regista aqui
  // validade, ciclo e eventualmente o pagamento recebido.
  app.put("/api/companies/:id/subscription", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        status: z.enum(SUBSCRIPTION_STATUSES).optional(),
        plan: z.enum(SUBSCRIPTION_PLAN_KEYS as unknown as [string, ...string[]]).optional(),
        expiresAt: isoDateTime.nullable().optional(),
        billingCycle: z.enum(BILLING_CYCLES).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        payment: z
          .object({
            amount: z.number().positive(),
            currency: z.enum(CURRENCIES).default("MZN"),
            method: z.enum(PAYMENT_METHODS).default("transferencia"),
            reference: z.string().max(120).optional(),
            notes: z.string().max(1000).optional(),
            paidAt: isoDateTime.optional(),
            periodStart: dateOnly.optional(),
            periodEnd: dateOnly.optional(),
          })
          .optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const current = await getLatestSubscription(id);
    if (!current) return reply.code(404).send({ error: "Empresa sem subscrição" });

    const nextStatus = parsed.data.status ?? current.status;
    const nextPlan = parsed.data.plan ?? current.plan;
    const nextExpires =
      parsed.data.expiresAt === undefined
        ? current.expiresAt
        : parsed.data.expiresAt
          ? new Date(parsed.data.expiresAt)
          : null;
    const nextCycle =
      parsed.data.billingCycle === undefined ? current.billingCycle : parsed.data.billingCycle;
    const nextNotes = parsed.data.notes === undefined ? current.notes : parsed.data.notes;

    const [row] = await db
      .update(subscriptions)
      .set({
        status: nextStatus,
        plan: nextPlan,
        expiresAt: nextExpires,
        billingCycle: nextCycle,
        notes: nextNotes,
        activatedAt: nextStatus === "activo" ? (current.activatedAt ?? new Date()) : current.activatedAt,
        activatedByUserId: nextStatus === "activo" ? (current.activatedByUserId ?? request.currentUser!.id) : current.activatedByUserId,
      })
      .where(eq(subscriptions.id, current.id))
      .returning();

    // Ao mudar de plano, módulos da empresa nunca excedem o permitido pelo plano.
    if (parsed.data.plan && parsed.data.plan !== current.plan) {
      const { clampCompanyModules } = await import("../services/subscriptionEntitlements.js");
      const [company] = await db.select({ enabledModules: companies.enabledModules }).from(companies).where(eq(companies.id, id)).limit(1);
      if (company) {
        await db
          .update(companies)
          .set({ enabledModules: clampCompanyModules(company.enabledModules, nextPlan) })
          .where(eq(companies.id, id));
      }
    }

    let payment = null;
    if (parsed.data.payment) {
      const p = parsed.data.payment;
      const [createdPayment] = await db
        .insert(platformPayments)
        .values({
          companyId: id,
          amount: String(p.amount),
          currency: p.currency,
          method: p.method,
          reference: p.reference ?? null,
          notes: p.notes ?? null,
          paidAt: p.paidAt ? new Date(p.paidAt) : new Date(),
          periodStart: p.periodStart ?? null,
          periodEnd: p.periodEnd ?? null,
          plan: nextPlan,
          billingCycle: nextCycle,
          recordedByUserId: request.currentUser!.id,
        })
        .returning();
      payment = createdPayment;
      if (p.periodEnd && !parsed.data.expiresAt) {
        const [extended] = await db
          .update(subscriptions)
          .set({ expiresAt: new Date(`${p.periodEnd}T23:59:59.000Z`) })
          .where(eq(subscriptions.id, current.id))
          .returning();
        Object.assign(row, extended);
      }
    }

    if (nextStatus === "suspenso" && nextStatus !== current.status) {
      const companyUsers = await db.select({ id: users.id }).from(users).where(eq(users.companyId, id));
      const userIds = companyUsers.map((u) => u.id);
      if (userIds.length) {
        await db.delete(sessions).where(inArray(sessions.userId, userIds));
      }
    }

    await recordAuditEvent({
      companyId: id,
      actorUserId: request.currentUser!.id,
      entityType: "subscription",
      entityId: row.id,
      action: "subscription.updated",
      before: {
        plan: current.plan,
        status: current.status,
        expiresAt: current.expiresAt,
        billingCycle: current.billingCycle,
      },
      after: {
        plan: row.plan,
        status: row.status,
        expiresAt: row.expiresAt,
        billingCycle: row.billingCycle,
        paymentId: payment?.id ?? null,
      },
    });

    return { ...row, payment };
  });

  app.get("/api/admin/companies/:id/payments", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });
    return listCompanyPayments(id);
  });

  app.post("/api/admin/companies/:id/payments", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        amount: z.number().positive(),
        currency: z.enum(CURRENCIES).default("MZN"),
        method: z.enum(PAYMENT_METHODS).default("transferencia"),
        reference: z.string().max(120).optional(),
        notes: z.string().max(1000).optional(),
        paidAt: isoDateTime.optional(),
        periodStart: dateOnly.optional(),
        periodEnd: dateOnly.optional(),
        plan: z.enum(SUBSCRIPTION_PLAN_KEYS as unknown as [string, ...string[]]).optional(),
        billingCycle: z.enum(BILLING_CYCLES).optional(),
        extendExpires: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });
    const current = await getLatestSubscription(id);
    if (!current) return reply.code(404).send({ error: "Empresa sem subscrição" });

    const plan = parsed.data.plan ?? current.plan;
    const cycle = parsed.data.billingCycle ?? current.billingCycle;
    const [created] = await db
      .insert(platformPayments)
      .values({
        companyId: id,
        amount: String(parsed.data.amount),
        currency: parsed.data.currency,
        method: parsed.data.method,
        reference: parsed.data.reference ?? null,
        notes: parsed.data.notes ?? null,
        paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
        periodStart: parsed.data.periodStart ?? null,
        periodEnd: parsed.data.periodEnd ?? null,
        plan,
        billingCycle: cycle,
        recordedByUserId: request.currentUser!.id,
      })
      .returning();

    if (parsed.data.extendExpires !== false && parsed.data.periodEnd) {
      await db
        .update(subscriptions)
        .set({ expiresAt: new Date(`${parsed.data.periodEnd}T23:59:59.000Z`), status: current.status === "suspenso" ? current.status : "activo" })
        .where(eq(subscriptions.id, current.id));
    }

    await recordAuditEvent({
      companyId: id,
      actorUserId: request.currentUser!.id,
      entityType: "platform_payment",
      entityId: created.id,
      action: "payment.recorded",
      after: { amount: created.amount, plan: created.plan, periodEnd: created.periodEnd },
    });

    return reply.code(201).send(created);
  });

  // ---------- Comprovativos de pagamento (sem gateway automático) ----------
  // A empresa submete o comprovativo (transferência/M-Pesa/e-Mola) para o plano escolhido;
  // fica "pendente" até o super_admin rever e aprovar — a aprovação regista o pagamento e
  // activa/estende a subscrição pelos mesmos caminhos já usados no registo manual acima.

  app.post("/api/companies/me/payment-proofs", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "Ficheiro em falta" });
    const fields = data.fields as Record<string, { value?: string } | undefined>;
    const fieldValue = (name: string) => {
      const field = fields[name];
      return field && typeof field === "object" && "value" in field ? String(field.value) : undefined;
    };
    const parsed = z
      .object({
        plan: z.enum(SUBSCRIPTION_PLAN_KEYS as unknown as [string, ...string[]]),
        billingCycle: z.enum(BILLING_CYCLES).optional(),
        amount: z.coerce.number().positive(),
        currency: z.enum(CURRENCIES).default("MZN"),
        method: z.enum(PAYMENT_METHODS),
        reference: z.string().max(120).optional(),
        notes: z.string().max(1000).optional(),
      })
      .safeParse({
        plan: fieldValue("plan"),
        billingCycle: fieldValue("billingCycle") || undefined,
        amount: fieldValue("amount"),
        currency: fieldValue("currency") || "MZN",
        method: fieldValue("method"),
        reference: fieldValue("reference") || undefined,
        notes: fieldValue("notes") || undefined,
      });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const buffer = await data.toBuffer();
    const ext = detectProofFileExtension(buffer);
    if (!ext) return reply.code(400).send({ error: "Ficheiro inválido — envie uma imagem (PNG/JPG/WEBP/GIF) ou PDF" });

    const uploadsDir = path.join(env.uploadsDir, "payment-proofs");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${randomUUID()}${ext}`;
    await writeFile(path.join(uploadsDir, fileName), buffer);

    const [created] = await db
      .insert(paymentProofs)
      .values({
        companyId,
        submittedByUserId: request.currentUser!.id,
        plan: parsed.data.plan,
        billingCycle: parsed.data.billingCycle ?? null,
        amount: String(parsed.data.amount),
        currency: parsed.data.currency,
        method: parsed.data.method,
        reference: parsed.data.reference ?? null,
        notes: parsed.data.notes ?? null,
        filePath: `payment-proofs/${fileName}`,
        originalFileName: data.filename?.slice(0, 300) ?? null,
      })
      .returning();

    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "payment_proof",
      entityId: created.id,
      action: "payment_proof.submitted",
      after: { plan: created.plan, amount: created.amount, method: created.method },
    });

    const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
    const superAdminEmails = await getSuperAdminEmails();
    void sendEmail(
      {
        to: superAdminEmails,
        subject: `SIGO — Novo comprovativo: ${company?.name ?? "empresa"}`,
        html: emailLayout(
          "Novo comprovativo de pagamento",
          `<p><strong>${escapeHtml(company?.name ?? "Empresa")}</strong> enviou um comprovativo para o plano <strong>${escapeHtml(getPlanDefinition(created.plan).label)}</strong> (${escapeHtml(String(created.amount))} ${escapeHtml(created.currency)}).</p>
           <p>Reveja o ficheiro e aprove ou rejeite no painel do super admin.</p>`,
          `${env.publicUrl}/admin`,
          "Rever comprovativo",
        ),
      },
      request.log,
    );

    return reply.code(201).send(created);
  });

  app.get("/api/companies/me/payment-proofs", { preHandler: requireRole("admin_empresa") }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    return db.select().from(paymentProofs).where(eq(paymentProofs.companyId, companyId)).orderBy(desc(paymentProofs.createdAt));
  });

  app.get("/api/admin/payment-proofs", { preHandler: requireRole("super_admin") }, async (request) => {
    const query = z.object({ status: z.enum(["pendente", "aprovado", "rejeitado"]).optional() }).safeParse(request.query);
    const statusFilter = query.success ? query.data.status : undefined;
    const rows = await db
      .select({
        proof: paymentProofs,
        companyName: companies.name,
      })
      .from(paymentProofs)
      .innerJoin(companies, eq(paymentProofs.companyId, companies.id))
      .where(statusFilter ? eq(paymentProofs.status, statusFilter) : undefined)
      .orderBy(desc(paymentProofs.createdAt));
    return rows.map((r) => ({ ...r.proof, companyName: r.companyName }));
  });

  app.get("/api/admin/payment-proofs/:id/file", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [proof] = await db.select().from(paymentProofs).where(eq(paymentProofs.id, id)).limit(1);
    if (!proof) return reply.code(404).send({ error: "Comprovativo não encontrado" });
    const fullPath = path.join(env.uploadsDir, proof.filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
    reply.header("Content-Type", contentType);
    reply.header(
      "Content-Disposition",
      `inline; filename="${safeContentDispositionFilename(proof.originalFileName, `comprovativo${ext}`)}"`,
    );
    return reply.send(createReadStream(fullPath));
  });

  app.post("/api/admin/payment-proofs/:id/approve", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        periodEnd: dateOnly.optional(),
        notes: z.string().max(1000).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [proof] = await db.select().from(paymentProofs).where(eq(paymentProofs.id, id)).limit(1);
    if (!proof) return reply.code(404).send({ error: "Comprovativo não encontrado" });
    if (proof.status !== "pendente") return reply.code(409).send({ error: `Este comprovativo já foi ${proof.status}.` });

    const current = await getLatestSubscription(proof.companyId);
    if (!current) return reply.code(404).send({ error: "Empresa sem subscrição" });

    const now = new Date();
    // Estende a partir do fim actual (se ainda vigente); senão a partir de agora — nunca
    // encurtar uma renovação feita antes do vencimento.
    const extensionBase =
      current.expiresAt && current.expiresAt.getTime() > now.getTime() ? current.expiresAt : now;
    const periodEnd = parsed.data.periodEnd
      ? new Date(`${parsed.data.periodEnd}T23:59:59.000Z`)
      : new Date(
          extensionBase.getFullYear(),
          extensionBase.getMonth() + (proof.billingCycle === "annual" ? 12 : 1),
          extensionBase.getDate(),
          23,
          59,
          59,
        );

    let payment;
    let updatedProof;
    try {
      [payment, updatedProof] = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(paymentProofs)
          .where(eq(paymentProofs.id, id))
          .for("update")
          .limit(1);
        if (!locked || locked.status !== "pendente") {
          throw new Error("PROOF_ALREADY_PROCESSED");
        }

        const [createdPayment] = await tx
          .insert(platformPayments)
          .values({
            companyId: proof.companyId,
            amount: proof.amount,
            currency: proof.currency,
            method: proof.method,
            reference: proof.reference,
            notes: parsed.data.notes ?? proof.notes,
            paidAt: now,
            periodEnd: periodEnd.toISOString().slice(0, 10),
            plan: proof.plan,
            billingCycle: proof.billingCycle,
            recordedByUserId: request.currentUser!.id,
          })
          .returning();

        await tx
          .update(subscriptions)
          .set({
            status: "activo",
            plan: proof.plan,
            billingCycle: proof.billingCycle,
            expiresAt: periodEnd,
            activatedAt: current.activatedAt ?? now,
            activatedByUserId: current.activatedByUserId ?? request.currentUser!.id,
          })
          .where(eq(subscriptions.id, current.id));

        const { clampCompanyModules } = await import("../services/subscriptionEntitlements.js");
        const [company] = await tx.select({ enabledModules: companies.enabledModules }).from(companies).where(eq(companies.id, proof.companyId)).limit(1);
        if (company) {
          await tx
            .update(companies)
            .set({ enabledModules: clampCompanyModules(company.enabledModules, proof.plan) })
            .where(eq(companies.id, proof.companyId));
        }

        const [updated] = await tx
          .update(paymentProofs)
          .set({ status: "aprovado", reviewedByUserId: request.currentUser!.id, reviewedAt: now })
          .where(and(eq(paymentProofs.id, id), eq(paymentProofs.status, "pendente")))
          .returning();
        if (!updated) throw new Error("PROOF_ALREADY_PROCESSED");

        return [createdPayment, updated] as const;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "PROOF_ALREADY_PROCESSED") {
        return reply.code(409).send({ error: "Este comprovativo já foi processado." });
      }
      throw error;
    }

    await recordAuditEvent({
      companyId: proof.companyId,
      actorUserId: request.currentUser!.id,
      entityType: "payment_proof",
      entityId: id,
      action: "payment_proof.approved",
      after: { paymentId: payment.id, plan: proof.plan, expiresAt: periodEnd.toISOString() },
    });

    const adminEmails = await getCompanyAdminEmails(proof.companyId);
    void sendEmail(
      {
        to: adminEmails,
        subject: "SIGO — Pagamento confirmado, plano activo",
        html: emailLayout(
          "Pagamento confirmado",
          `<p>Confirmámos o comprovativo enviado para o plano <strong>${escapeHtml(getPlanDefinition(proof.plan).label)}</strong>.</p>
           <p>A subscrição está activa até <strong>${escapeHtml(periodEnd.toLocaleDateString("pt-PT"))}</strong>.</p>`,
          `${env.publicUrl}/creditos`,
          "Ver na plataforma",
        ),
      },
      request.log,
    );

    return { proof: updatedProof, payment };
  });

  app.post("/api/admin/payment-proofs/:id/reject", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [proof] = await db.select().from(paymentProofs).where(eq(paymentProofs.id, id)).limit(1);
    if (!proof) return reply.code(404).send({ error: "Comprovativo não encontrado" });
    if (proof.status !== "pendente") return reply.code(409).send({ error: `Este comprovativo já foi ${proof.status}.` });

    const [updated] = await db
      .update(paymentProofs)
      .set({ status: "rejeitado", reviewedByUserId: request.currentUser!.id, reviewedAt: new Date(), rejectionReason: parsed.data.reason })
      .where(and(eq(paymentProofs.id, id), eq(paymentProofs.status, "pendente")))
      .returning();
    if (!updated) return reply.code(409).send({ error: "Este comprovativo já foi processado." });

    await recordAuditEvent({
      companyId: proof.companyId,
      actorUserId: request.currentUser!.id,
      entityType: "payment_proof",
      entityId: id,
      action: "payment_proof.rejected",
      after: { reason: parsed.data.reason },
    });

    const adminEmails = await getCompanyAdminEmails(proof.companyId);
    void sendEmail(
      {
        to: adminEmails,
        subject: "SIGO — Comprovativo não confirmado",
        html: emailLayout(
          "Comprovativo não confirmado",
          `<p>Não foi possível confirmar o comprovativo enviado para o plano <strong>${escapeHtml(getPlanDefinition(proof.plan).label)}</strong>.</p>
           <p><strong>Motivo:</strong> ${escapeHtml(parsed.data.reason)}</p>
           <p>Pode enviar um novo comprovativo em «Créditos e planos».</p>`,
          `${env.publicUrl}/creditos`,
          "Enviar novo comprovativo",
        ),
      },
      request.log,
    );

    return updated;
  });

  app.get("/api/admin/companies/:id/credits", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });
    const {
      getCreditBalances,
      listCreditLedger,
      buildSubscriptionSummary,
    } = await import("../services/subscriptionEntitlements.js");
    const [balances, ledger, summary] = await Promise.all([
      getCreditBalances(id),
      listCreditLedger(id),
      buildSubscriptionSummary(id),
    ]);
    return { balances, ledger, summary };
  });

  app.post("/api/admin/companies/:id/credits", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });

    const bodySchema = z.object({
      packId: z.string().optional().nullable(),
      smartImports: z.number().int().min(0).optional(),
      plantAnalyses: z.number().int().min(0).optional(),
      note: z.string().max(500).optional().nullable(),
      amount: z.number().positive().optional(),
      method: z.enum(["transferencia", "mpesa", "cash", "cartao", "outro"]).optional(),
      reference: z.string().max(120).optional(),
      recordPayment: z.boolean().optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { getCreditPack } = await import("@sigo/shared");
    const { grantCredits } = await import("../services/subscriptionEntitlements.js");
    const pack = getCreditPack(parsed.data.packId);
    const smartImports = parsed.data.smartImports ?? pack?.smartImports ?? 0;
    const plantAnalyses = parsed.data.plantAnalyses ?? pack?.plantAnalyses ?? 0;
    if (smartImports <= 0 && plantAnalyses <= 0) {
      return reply.code(400).send({ error: "Indique um pack ou quantidades de créditos." });
    }
    const amountMzn = parsed.data.amount ?? pack?.priceMzn ?? null;

    try {
      const balances = await grantCredits({
        companyId: id,
        smartImports,
        plantAnalyses,
        packId: parsed.data.packId ?? null,
        note: parsed.data.note ?? null,
        amountMzn,
        recordedByUserId: request.currentUser!.id,
        reason: pack ? "pack_grant" : "admin_grant",
      });

      let payment = null;
      if (parsed.data.recordPayment && amountMzn != null && amountMzn > 0) {
        const sub = await getLatestSubscription(id);
        const [created] = await db
          .insert(platformPayments)
          .values({
            companyId: id,
            amount: String(amountMzn),
            currency: "MZN",
            plan: sub?.plan ?? "individual",
            billingCycle: "custom",
            method: parsed.data.method ?? "transferencia",
            reference: parsed.data.reference ?? parsed.data.packId ?? null,
            notes: parsed.data.note ?? `Créditos: ${smartImports} imports · ${plantAnalyses} plantas`,
            recordedByUserId: request.currentUser!.id,
          })
          .returning();
        payment = created;
      }

      await recordAuditEvent({
        companyId: id,
        actorUserId: request.currentUser!.id,
        entityType: "subscription_credits",
        entityId: id,
        action: "credits.granted",
        after: { smartImports, plantAnalyses, packId: parsed.data.packId, balances },
      });

      return reply.code(201).send({ balances, payment });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Não foi possível atribuir créditos" });
    }
  });

  app.get("/api/admin/companies/:id/usage", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!company) return reply.code(404).send({ error: "Empresa não encontrada" });
    const sub = await getLatestSubscription(id);
    return getCompanyUsage(id, sub?.plan ?? "individual", sub);
  });

  app.get("/api/admin/companies/:id/backup", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { format?: string };
    // Formato legado JSON (leve) — ?format=json
    if (query.format === "json") {
      const backup = await buildCompanyBackup(id);
      if (!backup) return reply.code(404).send({ error: "Empresa não encontrada" });
      await recordAuditEvent({
        companyId: id,
        actorUserId: request.currentUser!.id,
        entityType: "company",
        entityId: id,
        action: "company.backup_exported",
        metadata: { format: backup.format },
      });
      const slug = backup.company.name.replace(/[^\w\-]+/g, "_").slice(0, 40);
      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="sigo-backup-${slug}-${new Date().toISOString().slice(0, 10)}.json"`);
      return backup;
    }

    const { streamCompanyFullBackupZip } = await import("../services/companyFullBackup.js");
    const zip = await streamCompanyFullBackupZip(id);
    if (!zip) return reply.code(404).send({ error: "Empresa não encontrada" });
    await recordAuditEvent({
      companyId: id,
      actorUserId: request.currentUser!.id,
      entityType: "company",
      entityId: id,
      action: "company.full_backup_exported",
      metadata: { format: "sigo-company-backup-v2", ...zip.totals },
    });
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${zip.filename}"`);
    return reply.send(zip.stream);
  });

  // ---------- Disco e lixo de projectos (super_admin) ----------
  app.get("/api/admin/storage", { preHandler: requireRole("super_admin") }, async () => {
    const { getStorageOverview } = await import("../services/projectStorage.js");
    return getStorageOverview();
  });

  app.get("/api/admin/trash", { preHandler: requireRole("super_admin") }, async () => {
    const { listTrashedProjects } = await import("../services/projectStorage.js");
    return listTrashedProjects();
  });

  app.post("/api/admin/trash/:projectId/restore", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { restoreTrashedProject } = await import("../services/projectStorage.js");
    const result = await restoreTrashedProject(projectId);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (project) {
      await recordAuditEvent({
        companyId: project.companyId,
        actorUserId: request.currentUser!.id,
        entityType: "project",
        entityId: projectId,
        action: "project.trash_restored",
      });
    }
    return { ok: true };
  });

  app.delete("/api/admin/trash/:projectId", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project?.trashedAt) return reply.code(409).send({ error: "Só é possível apagar definitivamente projectos no lixo" });
    const companyId = project.companyId;
    const { permanentlyDeleteProject } = await import("../services/projectStorage.js");
    const result = await permanentlyDeleteProject(projectId);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "project",
      entityId: projectId,
      action: "project.permanently_deleted",
      metadata: { deletedFiles: result.deletedFiles },
    });
    return { ok: true, deletedFiles: result.deletedFiles };
  });

  app.post("/api/admin/trash/run-cleanup", { preHandler: requireRole("super_admin") }, async (request) => {
    const { runWeeklyProjectTrashJob } = await import("../services/projectStorage.js");
    return runWeeklyProjectTrashJob(request.log);
  });

  app.get("/api/admin/mail/status", { preHandler: requireRole("super_admin") }, async () => {
    const { isMailEnabled } = await import("../services/mailer.js");
    return { enabled: isMailEnabled() };
  });

  app.get("/api/admin/monitoring/status", { preHandler: requireRole("super_admin") }, async () => {
    const { isMonitoringEnabled } = await import("../services/monitoring.js");
    return { enabled: isMonitoringEnabled() };
  });

  app.get("/api/admin/operational-health", { preHandler: requireRole("super_admin") }, async (_request, reply) => {
    const { getOperationalHealth } = await import("../services/operationalHealth.js");
    reply.header("Cache-Control", "no-store");
    return getOperationalHealth();
  });

  app.post("/api/admin/monitoring/test", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { isMonitoringEnabled, captureException: capture } = await import("../services/monitoring.js");
    if (!isMonitoringEnabled()) {
      return reply.code(409).send({ error: "Sentry não configurado — defina SENTRY_DSN." });
    }
    capture(new Error("SIGO — erro de teste (Sentry configurado correctamente)"), { triggeredBy: request.currentUser!.email });
    return { ok: true };
  });

  app.post("/api/admin/mail/test", { preHandler: requireRole("super_admin") }, async (request, reply) => {
    const { isMailEnabled, sendEmail: send, emailLayout: layout } = await import("../services/mailer.js");
    if (!isMailEnabled()) {
      return reply.code(409).send({ error: "SMTP não configurado — defina SMTP_HOST, SMTP_USER e SMTP_PASS." });
    }
    const sent = await send(
      {
        to: request.currentUser!.email,
        subject: "SIGO — Email de teste",
        html: layout("Email de teste", "<p>Se está a ler isto, o envio de email do SIGO está a funcionar.</p>"),
      },
      request.log,
    );
    if (!sent) return reply.code(502).send({ error: "Falha ao enviar — verifique as credenciais SMTP." });
    return { ok: true, sentTo: request.currentUser!.email };
  });

  app.post("/api/admin/subscriptions/run-expiry-reminders", { preHandler: requireRole("super_admin") }, async (request) => {
    const { runSubscriptionExpiryReminders } = await import("../services/subscriptionReminders.js");
    return runSubscriptionExpiryReminders(request.log);
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
    let estimatedMonthlyRevenueMzn = 0;
    const planCounts: Record<string, number> = {};
    const now = Date.now();
    const in30d = now + 30 * 24 * 60 * 60 * 1000;
    const expiringSoon: Array<{ id: string; name: string; expiresAt: string; status: string; plan: string }> = [];

    for (const c of allCompanies) {
      const sub = latestByCompany.get(c.id);
      const status = sub?.status ?? "trial";
      if (status === "activo") activeCompanies++;
      else if (status === "suspenso") suspendedCompanies++;
      else trialCompanies++;
      const plan = sub?.plan ?? "free";
      planCounts[plan] = (planCounts[plan] ?? 0) + 1;

      if (status === "activo") {
        const def = getPlanDefinition(plan);
        if (sub?.billingCycle === "annual" && def?.annualPriceMzn != null) {
          estimatedMonthlyRevenueMzn += def.annualPriceMzn / 12;
        } else if (def?.monthlyPriceMzn != null) {
          estimatedMonthlyRevenueMzn += def.monthlyPriceMzn;
        }
      }

      if (sub?.expiresAt) {
        const exp = sub.expiresAt.getTime();
        if (exp >= now && exp <= in30d) {
          expiringSoon.push({
            id: c.id,
            name: c.name,
            expiresAt: sub.expiresAt.toISOString(),
            status,
            plan,
          });
        }
      }
    }

    expiringSoon.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [[totalCollectedRow], [collectedThisMonthRow]] = await Promise.all([
      db.select({ total: sum(platformPayments.amount) }).from(platformPayments).where(eq(platformPayments.currency, "MZN")),
      db
        .select({ total: sum(platformPayments.amount) })
        .from(platformPayments)
        .where(and(eq(platformPayments.currency, "MZN"), gte(platformPayments.paidAt, monthStart))),
    ]);
    const totalCollectedMzn = Number(totalCollectedRow?.total ?? 0);
    const collectedThisMonthMzn = Number(collectedThisMonthRow?.total ?? 0);

    const planByCompany = new Map([...latestByCompany.entries()].map(([id, sub]) => [id, sub.plan]));
    const usageMap = await getCompaniesUsageMap(
      allCompanies.map((c) => c.id),
      planByCompany,
    );
    const nearLimit = allCompanies
      .filter((c) => {
        const u = usageMap.get(c.id);
        return u && (u.usersNearLimit || u.projectsNearLimit);
      })
      .map((c) => {
        const u = usageMap.get(c.id)!;
        return {
          id: c.id,
          name: c.name,
          users: u.users,
          maxUsers: u.maxUsers,
          projects: u.projects,
          maxProjects: u.maxProjects,
        };
      });

    const [{ value: totalUsers }] = await db.select({ value: count() }).from(users);
    const [{ value: totalProjects }] = await db.select({ value: count() }).from(projects);

    return {
      totalCompanies: allCompanies.length,
      activeCompanies,
      trialCompanies,
      suspendedCompanies,
      totalUsers: Number(totalUsers),
      totalProjects: Number(totalProjects),
      planCounts,
      estimatedMonthlyRevenueMzn: Math.round(estimatedMonthlyRevenueMzn),
      totalCollectedMzn: Math.round(totalCollectedMzn),
      collectedThisMonthMzn: Math.round(collectedThisMonthMzn),
      expiringSoon,
      nearLimit,
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

  app.get("/api/companies/me/entitlements", { preHandler: requireCompanyUser }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    const { buildSubscriptionSummary } = await import("../services/subscriptionEntitlements.js");
    const summary = await buildSubscriptionSummary(companyId);
    if (!summary) return { planKey: "individual", expired: false, isTrial: false, usage: null };
    return summary;
  });

  app.post("/api/companies/me/logo", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const { assertCompanyBranding } = await import("../services/subscriptionEntitlements.js");
    const branding = await assertCompanyBranding(companyId);
    if (branding) return reply.code(403).send({ error: branding.error, code: branding.code, upgradeHint: branding.upgradeHint, actionPath: branding.actionPath });
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
