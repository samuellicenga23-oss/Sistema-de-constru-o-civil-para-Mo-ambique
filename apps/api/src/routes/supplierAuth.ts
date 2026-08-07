import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { supplierAccounts, suppliers, priceZones } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  createSupplierSession,
  deleteSupplierSession,
  deleteAllSupplierSessions,
} from "../auth/supplierSession.js";
import { requireSupplierAuth } from "../auth/supplierMiddleware.js";
import { env } from "../env.js";

function sessionMetaOf(request: FastifyRequest) {
  return { userAgent: request.headers["user-agent"] ?? null, ipAddress: request.ip };
}

// Hash de mentira para não denunciar por tempo de resposta quais emails têm conta — mesmo
// truque usado em routes/auth.ts.
const DUMMY_HASH = "$2a$10$Wk.PLjCCVu7jKfCuHmfaPOvft.m9DLXdLZstHSxUud2CgNyKPQZwC";

// Cookie próprio ("sid_sup"), nunca "sid" — o portal do fornecedor é um sistema de sessão
// totalmente à parte do painel da empresa/super-admin, para impedir qualquer fuga de
// privilégios entre os dois lados.
const SUPPLIER_COOKIE_OPTS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.isProduction,
};

export async function supplierAuthRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });

  const acceptInviteSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres"),
  });

  // O fornecedor recebe este token por email (convite enviado pela empresa) e define aqui a
  // sua própria password — a partir deste momento a conta fica activa e consegue entrar.
  app.post(
    "/api/supplier/auth/accept-invite",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const parsed = acceptInviteSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.inviteToken, parsed.data.token)).limit(1);
      if (!account || !account.inviteTokenExpiresAt || account.inviteTokenExpiresAt < new Date()) {
        return reply.code(400).send({ error: "Convite inválido ou expirado. Peça à empresa para reenviar o convite." });
      }

      const passwordHash = await hashPassword(parsed.data.password);
      await db
        .update(supplierAccounts)
        .set({ passwordHash, emailVerifiedAt: new Date(), inviteToken: null, inviteTokenExpiresAt: null })
        .where(eq(supplierAccounts.id, account.id));

      const session = await createSupplierSession(account.id, sessionMetaOf(request));
      reply.setCookie("sid_sup", session.id, { ...SUPPLIER_COOKIE_OPTS, expires: session.expiresAt });
      return reply.code(201).send({ id: account.id, name: account.name, email: account.email });
    },
  );

  const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
  });

  app.post(
    "/api/supplier/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Email/palavra-passe inválidos" });

      const [account] = await db.select().from(supplierAccounts).where(eq(supplierAccounts.email, parsed.data.email)).limit(1);
      const passwordOk = await verifyPassword(parsed.data.password, account?.passwordHash ?? DUMMY_HASH);
      if (!account || !passwordOk) return reply.code(401).send({ error: "Credenciais inválidas" });
      if (!account.isActive) return reply.code(403).send({ error: "Esta conta foi desactivada." });
      if (!account.passwordHash) return reply.code(403).send({ error: "Aceite o convite recebido por email antes de entrar." });

      const session = await createSupplierSession(account.id, sessionMetaOf(request));
      reply.setCookie("sid_sup", session.id, { ...SUPPLIER_COOKIE_OPTS, expires: session.expiresAt });
      return { id: account.id, name: account.name, email: account.email, phone: account.phone };
    },
  );

  const registerSchema = z.object({
    name: z.string().trim().min(2).max(150),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres"),
    phone: z.string().trim().max(60).optional(),
    nuit: z.string().trim().max(30).optional(),
    zoneId: z.string().uuid(),
  });

  // Registo público — o fornecedor cria a sua própria conta e ficha no SIGO Fornecedores, sem
  // depender de nenhuma empresa o convidar. Fica logo activo (sem aprovação prévia); indica já a
  // zona onde opera, porque é essa indicação que substitui a antiga gestão de zonas por empresa.
  app.post(
    "/api/supplier/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const [existing] = await db.select({ id: supplierAccounts.id }).from(supplierAccounts).where(eq(supplierAccounts.email, parsed.data.email)).limit(1);
      if (existing) {
        return reply.code(409).send({ error: "Já existe uma conta de fornecedor com este email. Experimente entrar." });
      }

      const [zone] = await db.select().from(priceZones).where(and(eq(priceZones.id, parsed.data.zoneId), isNull(priceZones.companyId))).limit(1);
      if (!zone) return reply.code(400).send({ error: "Zona inválida" });

      const passwordHash = await hashPassword(parsed.data.password);
      const [account] = await db
        .insert(supplierAccounts)
        .values({
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          phone: parsed.data.phone || null,
          emailVerifiedAt: new Date(),
        })
        .returning();

      await db.insert(suppliers).values({
        companyId: null,
        name: parsed.data.name,
        contact: parsed.data.phone || null,
        location: zone.name,
        nuit: parsed.data.nuit || null,
        zoneId: zone.id,
        supplierAccountId: account.id,
      });

      const session = await createSupplierSession(account.id, sessionMetaOf(request));
      reply.setCookie("sid_sup", session.id, { ...SUPPLIER_COOKIE_OPTS, expires: session.expiresAt });
      return reply.code(201).send({ id: account.id, name: account.name, email: account.email });
    },
  );

  app.post("/api/supplier/auth/logout", async (request, reply) => {
    const sessionId = request.cookies?.sid_sup;
    if (sessionId) {
      await deleteSupplierSession(sessionId);
      reply.clearCookie("sid_sup", { path: "/" });
    }
    return { ok: true };
  });

  app.get("/api/supplier/auth/me", { preHandler: requireSupplierAuth }, async (request) => {
    return request.currentSupplier;
  });

  app.post("/api/supplier/auth/logout-others", { preHandler: requireSupplierAuth }, async (request, reply) => {
    const sessionId = request.cookies?.sid_sup;
    if (!sessionId) return reply.code(401).send({ error: "Não autenticado" });
    await deleteAllSupplierSessions(request.currentSupplier!.id);
    const session = await createSupplierSession(request.currentSupplier!.id, sessionMetaOf(request));
    reply.setCookie("sid_sup", session.id, { ...SUPPLIER_COOKIE_OPTS, expires: session.expiresAt });
    return { ok: true };
  });
}
