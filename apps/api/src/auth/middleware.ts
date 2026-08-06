import type { FastifyRequest, FastifyReply } from "fastify";
import { desc, eq } from "drizzle-orm";
import type { UserRole } from "@sigo/shared";
import type { CompanyModuleKey } from "@sigo/shared";
import { db } from "../db/index.js";
import { subscriptions } from "../db/schema.js";
import { getSessionUser, type SessionUser } from "./session.js";
import { assertCanWrite } from "../services/subscriptionEntitlements.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: SessionUser;
  }
}

const MODULE_ROUTES: Array<{ module: CompanyModuleKey; match: RegExp }> = [
  { module: "measurements", match: /\/(plants|plant-files|measurement-lines|quick-estimate)(\/|\?|$)/ },
  { module: "budgets", match: /\/(budget-documents|documents|line-items|materials-by-phase|exports?)(\/|\?|$)/ },
  { module: "catalog", match: /\/(materials|labour-categories|equipment|cost-compositions|price-zones|work-chapters)(\/|\?|$)/ },
  { module: "suppliers", match: /\/suppliers(\/|\?|$)/ },
  { module: "purchasing", match: /\/(purchase-orders|procurement-plan|stock-movements|stock-summary)(\/|\?|$)/ },
  { module: "schedule", match: /\/schedule(\/|\?|$)/ },
  { module: "site_diary", match: /\/site-diary(\/|\?|$)/ },
  { module: "financial", match: /\/(financial|invoices|invoice-receipts|credit-notes|contracts|contract-variations)(\/|\?|$)/ },
  { module: "quick_calculations", match: /\/quick-calc(\/|\?|$)/ },
  { module: "practice", match: /\/practice(\/|\?|$)/ },
];

function requiredModule(url: string): CompanyModuleKey | null {
  return MODULE_ROUTES.find((entry) => entry.match.test(url))?.module ?? null;
}

function isPlatformSuperAdmin(user: SessionUser): boolean {
  return user.role === "super_admin" || user.platformRole === "super_admin";
}

function roleMatches(user: SessionUser, roles: UserRole[]): boolean {
  return roles.includes(user.role) || Boolean(user.platformRole && roles.includes(user.platformRole));
}

async function requireEnabledModule(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser?.companyId) return;
  const module = requiredModule(request.raw.url ?? "");
  if (module && !request.currentUser.enabledModules.includes(module)) {
    return reply.code(403).send({ error: "Este módulo está desactivado para a sua empresa. Contacte o administrador da plataforma." });
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const sessionId = request.cookies?.sid;
  if (!sessionId) {
    return reply.code(401).send({ error: "Não autenticado" });
  }
  const user = await getSessionUser(sessionId);
  if (!user) {
    return reply.code(401).send({ error: "Sessão inválida ou expirada" });
  }
  // Subscrição suspensa bloqueia a API (não só o login). Logout não usa requireAuth.
  // Super-admin (incl. em impersonação) pode continuar a entrar para suporte.
  if (!isPlatformSuperAdmin(user) && user.companyId) {
    const [sub] = await db
      .select({ status: subscriptions.status, expiresAt: subscriptions.expiresAt, plan: subscriptions.plan })
      .from(subscriptions)
      .where(eq(subscriptions.companyId, user.companyId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    if (sub?.status === "suspenso") {
      return reply.code(403).send({
        error: "A subscrição da empresa está suspensa. Contacte o suporte.",
        code: "SUBSCRIPTION_SUSPENDED",
      });
    }
    // Trial/plano expirado: leitura permitida; escrita bloqueada (excepto auth/perfil).
    const method = (request.method ?? "GET").toUpperCase();
    const url = request.raw.url ?? "";
    const isWrite = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    const writeAllowedWhenExpired =
      url.startsWith("/api/auth/") ||
      url.startsWith("/api/companies/exit-impersonation");
    if (isWrite && !writeAllowedWhenExpired && sub) {
      const block = await assertCanWrite(user.companyId);
      if (block?.code === "SUBSCRIPTION_EXPIRED") {
        return reply.code(402).send({
          error: block.error,
          code: block.code,
          upgradeHint: block.upgradeHint,
          actionPath: block.actionPath,
        });
      }
    }
  }
  request.currentUser = user;
}

export function requireRole(...roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireEnabledModule(request, reply);
    if (reply.sent) return;
    if (!request.currentUser || !roleMatches(request.currentUser, roles)) {
      return reply.code(403).send({ error: "Sem permissão para esta acção" });
    }
  };
}

/** Exige uma permissão estável (ex.: `equipa.gerir`). Super admin da plataforma passa sempre. */
export function requirePermission(...permissionIds: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireEnabledModule(request, reply);
    if (reply.sent) return;
    const user = request.currentUser;
    if (!user) return reply.code(403).send({ error: "Sem permissão para esta acção" });
    if (isPlatformSuperAdmin(user)) return;
    if (!permissionIds.some((id) => user.permissions.includes(id))) {
      return reply.code(403).send({ error: "Sem permissão para esta acção" });
    }
  };
}

// Garante que o utilizador pertence a uma empresa (todos os perfis excepto super_admin).
export async function requireCompanyUser(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  await requireEnabledModule(request, reply);
  if (reply.sent) return;
  if (!request.currentUser?.companyId) {
    return reply.code(403).send({ error: "Utilizador sem empresa associada" });
  }
}
