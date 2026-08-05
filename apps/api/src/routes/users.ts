import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, count } from "drizzle-orm";
import {
  COMPANY_USER_ROLES,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  PERMISSION_IDS,
  SYSTEM_ROLE_PERMISSIONS,
  getPlanDefinition,
  isCompanyUserRole,
  resolveRoleTemplate,
  type CompanyUserRole,
  type RolePermissionsMap,
} from "@sigo/shared";
import { db } from "../db/index.js";
import { companies, users, subscriptions, sessions } from "../db/schema.js";
import { requireRole } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { recordAuditEvent } from "../services/auditTrail.js";

const roleEnum = z.enum(COMPANY_USER_ROLES);

const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres"),
  role: roleEnum,
  preferredLanguage: z.enum(["pt", "en"]).optional(),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    role: roleEnum.optional(),
    isActive: z.boolean().optional(),
    permissions: z.array(z.string()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Indique pelo menos uma alteração");

const resetPasswordSchema = z.object({
  password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres"),
});

const rolePermissionsSchema = z.object({
  rolePermissions: z.record(z.string(), z.array(z.string())),
});

async function activeAdminCount(companyId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "admin_empresa"), eq(users.isActive, true)));
  return value;
}

async function companyRoleMap(companyId: string): Promise<RolePermissionsMap | null> {
  const [company] = await db
    .select({ rolePermissions: companies.rolePermissions })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return company?.rolePermissions ?? null;
}

function effectivePermissions(
  role: string,
  stored: string[] | null | undefined,
  companyMap: RolePermissionsMap | null,
): string[] {
  if (stored && stored.length > 0) return stored;
  if (isCompanyUserRole(role)) return resolveRoleTemplate(role, companyMap);
  return [];
}

function publicUser(
  user: typeof users.$inferSelect,
  companyMap: RolePermissionsMap | null = null,
) {
  const permissions = effectivePermissions(user.role, user.permissions, companyMap);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as CompanyUserRole,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    hasGoogleLogin: Boolean(user.googleId),
    permissions,
    permissionCount: permissions.length,
    createdAt: user.createdAt,
  };
}

function sanitizePermissionIds(ids: string[]): string[] {
  const allowed = new Set(PERMISSION_IDS);
  return [...new Set(ids.filter((id) => allowed.has(id)))];
}

// Gestão de utilizadores dentro da própria empresa — só admin_empresa.
export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users", { preHandler: requireRole("admin_empresa") }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    const map = await companyRoleMap(companyId);
    const rows = await db.select().from(users).where(eq(users.companyId, companyId));
    return rows.map((row) => publicUser(row, map));
  });

  app.get("/api/users/permission-catalog", { preHandler: requireRole("admin_empresa") }, async (request) => {
    const companyId = request.currentUser!.companyId!;
    const map = await companyRoleMap(companyId);
    const templates: Record<string, string[]> = {};
    for (const role of COMPANY_USER_ROLES) {
      templates[role] = resolveRoleTemplate(role, map);
    }
    return {
      catalog: PERMISSION_CATALOG,
      groups: PERMISSION_GROUPS,
      roleTemplates: templates,
      systemDefaults: SYSTEM_ROLE_PERMISSIONS,
    };
  });

  app.put("/api/users/role-permissions", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = rolePermissionsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = request.currentUser!.companyId!;
    const next: RolePermissionsMap = {};
    for (const role of COMPANY_USER_ROLES) {
      const ids = parsed.data.rolePermissions[role];
      if (ids) next[role] = sanitizePermissionIds(ids);
    }
    const [updated] = await db
      .update(companies)
      .set({ rolePermissions: next })
      .where(eq(companies.id, companyId))
      .returning({ rolePermissions: companies.rolePermissions });
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "company",
      entityId: companyId,
      action: "role_permissions.updated",
      after: next,
    });
    const templates: Record<string, string[]> = {};
    for (const role of COMPANY_USER_ROLES) {
      templates[role] = resolveRoleTemplate(role, updated.rolePermissions);
    }
    return { roleTemplates: templates };
  });

  app.post("/api/users", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const companyId = request.currentUser!.companyId!;
    const { name, email, password, role } = parsed.data;
    const map = await companyRoleMap(companyId);
    const permissions = resolveRoleTemplate(role, map);

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return reply.code(409).send({ error: "Já existe um utilizador com este email" });
    }

    const { getCompanyEntitlements } = await import("../services/subscriptionEntitlements.js");
    const entitlements = await getCompanyEntitlements(companyId);
    const [{ value: currentUsers }] = await db.select({ value: count() }).from(users).where(eq(users.companyId, companyId));
    if (entitlements && !entitlements.teamManagement && currentUsers >= 1) {
      return reply.code(403).send({
        error: "O plano Individual permite 1 utilizador. Para trabalhar em equipa, escolha Profissional.",
        code: "PLAN_TEAM_REQUIRED",
      });
    }
    if (entitlements?.maxUsers != null && currentUsers >= entitlements.maxUsers) {
      return reply.code(403).send({
        error: `O plano "${entitlements.planLabel}" permite até ${entitlements.maxUsers} utilizador(es). Actualize o plano para adicionar a equipa.`,
        code: "PLAN_USER_LIMIT",
      });
    }

    const passwordHash = await hashPassword(password);
    const [company] = await db.select({ defaultLanguage: companies.defaultLanguage }).from(companies).where(eq(companies.id, companyId)).limit(1);
    const [user] = await db
      .insert(users)
      .values({
        companyId,
        name,
        email,
        passwordHash,
        role,
        permissions,
        preferredLanguage: parsed.data.preferredLanguage ?? company?.defaultLanguage ?? "pt",
        mustChangePassword: true,
      })
      .returning();
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "user",
      entityId: user.id,
      action: "created",
      after: { role: user.role, isActive: user.isActive, permissions },
    });

    return reply.code(201).send(publicUser(user, map));
  });

  app.patch("/api/users/:id", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const companyId = request.currentUser!.companyId!;
    const map = await companyRoleMap(companyId);
    const { id } = request.params as { id: string };
    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
    if (!target) return reply.code(404).send({ error: "Utilizador não encontrado" });

    if (id === request.currentUser!.id && (parsed.data.role !== undefined || parsed.data.isActive !== undefined)) {
      return reply.code(400).send({ error: "Não pode alterar o seu próprio perfil de acesso ou estado" });
    }
    const removesActiveAdmin =
      target.role === "admin_empresa" &&
      target.isActive &&
      ((parsed.data.role !== undefined && parsed.data.role !== "admin_empresa") || parsed.data.isActive === false);
    if (removesActiveAdmin && (await activeAdminCount(companyId)) <= 1) {
      return reply.code(400).send({ error: "A empresa deve manter pelo menos um administrador activo" });
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;
    if (parsed.data.role !== undefined) {
      patch.role = parsed.data.role;
      // Mudança de função: reaplica o template da nova função (salvo se vier permissions no mesmo pedido).
      if (parsed.data.permissions === undefined) {
        patch.permissions = resolveRoleTemplate(parsed.data.role, map);
      }
    }
    if (parsed.data.permissions !== undefined) {
      patch.permissions = sanitizePermissionIds(parsed.data.permissions);
    }

    const [updated] = await db.update(users).set(patch).where(eq(users.id, target.id)).returning();
    if (parsed.data.isActive === false) await db.delete(sessions).where(eq(sessions.userId, target.id));
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "user",
      entityId: target.id,
      action: "updated",
      before: { name: target.name, role: target.role, isActive: target.isActive, permissions: target.permissions },
      after: { name: updated.name, role: updated.role, isActive: updated.isActive, permissions: updated.permissions },
    });
    return publicUser(updated, map);
  });

  app.post("/api/users/:id/restore-permissions", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const companyId = request.currentUser!.companyId!;
    const map = await companyRoleMap(companyId);
    const { id } = request.params as { id: string };
    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
    if (!target) return reply.code(404).send({ error: "Utilizador não encontrado" });
    if (!isCompanyUserRole(target.role)) {
      return reply.code(400).send({ error: "Função sem template de permissões" });
    }
    const permissions = resolveRoleTemplate(target.role, map);
    const [updated] = await db.update(users).set({ permissions }).where(eq(users.id, target.id)).returning();
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "user",
      entityId: target.id,
      action: "permissions.restored",
      after: { permissions },
    });
    return publicUser(updated, map);
  });

  app.post("/api/users/:id/reset-password", { preHandler: requireRole("admin_empresa") }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const companyId = request.currentUser!.companyId!;
    const map = await companyRoleMap(companyId);
    const { id } = request.params as { id: string };
    if (id === request.currentUser!.id) {
      return reply.code(400).send({ error: "Use o seu Perfil para alterar a própria palavra-passe" });
    }
    const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId))).limit(1);
    if (!target) return reply.code(404).send({ error: "Utilizador não encontrado" });

    const passwordHash = await hashPassword(parsed.data.password);
    const [updated] = await db.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, target.id)).returning();
    await db.delete(sessions).where(eq(sessions.userId, target.id));
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "user",
      entityId: target.id,
      action: "password_reset",
      after: { mustChangePassword: true, sessionsRevoked: true },
    });
    return publicUser(updated, map);
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
      return reply.code(409).send({
        error: "Este utilizador já tem histórico. Desactive a conta para preservar os registos da obra.",
      });
    }
    if (target.role === "admin_empresa" && target.isActive && (await activeAdminCount(companyId)) <= 1) {
      return reply.code(400).send({ error: "A empresa deve manter pelo menos um administrador activo" });
    }
    await db.delete(users).where(eq(users.id, target.id));
    await recordAuditEvent({
      companyId,
      actorUserId: request.currentUser!.id,
      entityType: "user",
      entityId: target.id,
      action: "deleted",
      before: { role: target.role, isActive: target.isActive, neverLoggedIn: true },
    });
    return { ok: true };
  });
}
