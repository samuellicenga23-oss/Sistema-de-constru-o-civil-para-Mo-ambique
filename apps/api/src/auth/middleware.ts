import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@sigo/shared";
import { getSessionUser, type SessionUser } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: SessionUser;
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
    if (!request.currentUser || !roles.includes(request.currentUser.role)) {
      return reply.code(403).send({ error: "Sem permissão para esta acção" });
    }
  };
}

// Garante que o utilizador pertence a uma empresa (todos os perfis excepto super_admin).
export async function requireCompanyUser(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (!request.currentUser?.companyId) {
    return reply.code(403).send({ error: "Utilizador sem empresa associada" });
  }
}
