import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { companies, users, subscriptions, sessions } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { getPlanDefinition } from "@sigo/shared";
import { recordAuditEvent } from "../services/auditTrail.js";

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "A password deve ter pelo menos 8 caracteres"),
  role: z.enum(["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"]),
  preferredLanguage: z.enum(["pt", "en"]).optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  role: z.enum(["admin_empresa", "orcamentista", "engenheiro_fiscal", "visualizador"]).optional(),
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, "Indique pelo menos uma alteração");

const resetPasswordSchema = z.object({
  password: z.string().min(8, "A password deve ter pelo menos 8 caracteres"),
});

async function activeAdminCount(companyId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  return value;
}

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    hasGoogleLogin: Boolean(user.googleId),
    createdAt: user.createdAt,
  };
}

// Gestão de utilizadores dentro da própria empresa — só admin_empresa.
export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users", { preHandler: requireRole("admin_empresa") }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.companyId, companyId));
    return rows.map(publicUser);
  });

  app.post("/api/users", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const companyId = request.currentUser!.companyId!;
    const { name, email, password, role } = parsed.data;

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return reply.code(409).send({ error: "Já existe um utilizador com este email" });
    }

    // Limite de utilizadores do plano actual — trial sem subscrição ainda usa o limite mais
    // baixo (Arranque), para nunca deixar passar sem plano nenhum.
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).orderBy(desc(subscriptions.createdAt)).limit(1);
    const plan = getPlanDefinition(sub?.plan ?? "free");
    if (plan?.maxUsers != null) {
      const [{ value: currentUsers }] = await db.select({ value: count() }).from(users).where(eq(users.companyId, companyId));
      if (currentUsers >= plan.maxUsers) {
        return reply.code(403).send({
          error: `O plano "${plan.label}" permite até ${plan.maxUsers} utilizador(es). Contacte o suporte para actualizar de plano.`,
        });
      }
    }

    const passwordHash = await hashPassword(password);
    const [company] = await db.select({ defaultLanguage: companies.defaultLanguage }).from(companies).where(eq(companies.id, companyId)).limit(1);
    const [user] = await db
      .insert(users)
      .values({ companyId, name, email, passwordHash, role, preferredLanguage: parsed.data.preferredLanguage ?? company?.defaultLanguage ?? "pt", mustChangePassword: true })
      .returning();
    await recordAuditEvent({ companyId, actorUserId: request.currentUser!.id, entityType: "user", entityId: user.id, action: "created", after: { role: user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword } });

    return reply.code(201).send(publicUser(user));
  });

  app.patch("/api/users/:id", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = request.currentUser!.companyId!;
    const { id } = request.params as { id: string };
    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
    if (!target) return reply.code(404).send({ error: "Utilizador não encontrado" });

    if (id === request.currentUser!.id && (parsed.data.role !== undefined || parsed.data.isActive !== undefined)) {
      return reply.code(400).send({ error: "Não pode alterar o seu próprio perfil de acesso ou estado" });
    }
    const removesActiveAdmin = target.role === "admin_empresa" && target.isActive
      && ((parsed.data.role !== undefined && parsed.data.role !== "admin_empresa") || parsed.data.isActive === false);
    if (removesActiveAdmin && await activeAdminCount(companyId) <= 1) {
      return reply.code(400).send({ error: "A empresa deve manter pelo menos um administrador activo" });
    }

    const [updated] = await db.update(users).set(parsed.data).where(eq(users.id, target.id)).returning();
    if (parsed.data.isActive === false) await db.delete(sessions).where(eq(sessions.userId, target.id));
    await recordAuditEvent({ companyId, actorUserId: request.currentUser!.id, entityType: "user", entityId: target.id, action: "updated", before: { name: target.name, role: target.role, isActive: target.isActive }, after: { name: updated.name, role: updated.role, isActive: updated.isActive } });
    return publicUser(updated);
  });

  app.post("/api/users/:id/reset-password", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = request.currentUser!.companyId!;
    const { id } = request.params as { id: string };
    if (id === request.currentUser!.id) {
      return reply.code(400).send({ error: "Use o seu Perfil para alterar a própria palavra-passe" });
    }
    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
    if (!target) return reply.code(404).send({ error: "Utilizador não encontrado" });

    const passwordHash = await hashPassword(parsed.data.password);
    const [updated] = await db.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, target.id)).returning();
    await db.delete(sessions).where(eq(sessions.userId, target.id));
    await recordAuditEvent({ companyId, actorUserId: request.currentUser!.id, entityType: "user", entityId: target.id, action: "password_reset", after: { mustChangePassword: true, sessionsRevoked: true } });
    return publicUser(updated);
  });

  app.delete("/api/users/:id", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const { id } = request.params as { id: string };
    if (id === request.currentUser!.id) {
      return reply.code(400).send({ error: "Não pode eliminar o seu próprio utilizador" });
    }
    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
    if (!target) return reply.code(404).send({ error: "Utilizador não encontrado" });
    if (target.lastLoginAt) {
      return reply.code(409).send({ error: "Este utilizador já tem histórico. Desactive a conta para preservar os registos da obra." });
    }
    if (target.role === "admin_empresa" && target.isActive && await activeAdminCount(companyId) <= 1) {
      return reply.code(400).send({ error: "A empresa deve manter pelo menos um administrador activo" });
    }
    await db.delete(users).where(eq(users.id, target.id));
    await recordAuditEvent({ companyId, actorUserId: request.currentUser!.id, entityType: "user", entityId: target.id, action: "deleted", before: { role: target.role, isActive: target.isActive, neverLoggedIn: true } });
    return { ok: true };
  });
}
