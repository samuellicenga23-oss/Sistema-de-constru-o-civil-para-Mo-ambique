import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { companies, users, subscriptions } from "../db/schema.js";
import { requireRole, requireCompanyUser } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { env } from "../env.js";
import { CURRENCIES, SUBSCRIPTION_STATUSES, SUBSCRIPTION_PLAN_KEYS } from "@sigo/shared";
import { detectImageExtension } from "../services/imageValidation.js";

const createCompanySchema = z.object({
  name: z.string().min(1),
  nuit: z.string().optional(),
  address: z.string().optional(),
  defaultCurrency: z.enum(CURRENCIES).default("MZN"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8, "A password deve ter pelo menos 8 caracteres"),
});

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
      })
      .returning();

    // Nova empresa criada pelo super_admin começa em trial do plano Profissional (secção 37 do
    // documento comercial) — a contagem automática de 14 dias e a passagem a Free no fim ainda
    // não estão implementadas (precisa de um campo de data de expiração do trial, para adicionar
    // depois); por agora o super_admin muda manualmente o estado quando o trial terminar.
    await db.insert(subscriptions).values({ companyId: company.id, plan: "profissional", status: "trial" });

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

    const [row] = await db
      .update(subscriptions)
      .set({
        status: parsed.data.status ?? current.status,
        plan: parsed.data.plan ?? current.plan,
        activatedAt: parsed.data.status === "activo" ? new Date() : current.activatedAt,
        activatedByUserId: parsed.data.status === "activo" ? request.currentUser!.id : current.activatedByUserId,
      })
      .where(eq(subscriptions.id, current.id))
      .returning();
    return row;
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
      .object({ name: z.string().min(1).optional(), nuit: z.string().optional(), address: z.string().optional() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [row] = await db.update(companies).set(parsed.data).where(eq(companies.id, companyId)).returning();
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
