import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@sigo/shared";
import type { CompanyModuleKey } from "@sigo/shared";
import { getSessionUser, type SessionUser } from "./session.js";

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
];

function requiredModule(url: string): CompanyModuleKey | null {
  return MODULE_ROUTES.find((entry) => entry.match.test(url))?.module ?? null;
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
  request.currentUser = user;
}

export function requireRole(...roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireEnabledModule(request, reply);
    if (reply.sent) return;
    if (!request.currentUser || !roles.includes(request.currentUser.role)) {
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
