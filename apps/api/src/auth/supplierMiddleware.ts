import type { FastifyRequest, FastifyReply } from "fastify";
import { getSupplierSessionUser, type SupplierSessionUser } from "./supplierSession.js";

declare module "fastify" {
  interface FastifyRequest {
    currentSupplier?: SupplierSessionUser;
  }
}

export async function requireSupplierAuth(request: FastifyRequest, reply: FastifyReply) {
  const sessionId = request.cookies?.sid_sup;
  if (!sessionId) {
    return reply.code(401).send({ error: "Não autenticado" });
  }
  const supplier = await getSupplierSessionUser(sessionId);
  if (!supplier) {
    return reply.code(401).send({ error: "Sessão inválida ou expirada" });
  }
  request.currentSupplier = supplier;
}
