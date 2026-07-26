import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, subscriptions } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSession, deleteSession, deleteAllSessionsForUser } from "../auth/session.js";
import { requireAuth } from "../auth/middleware.js";
import { env } from "../env.js";

// Hash bcrypt real (de uma password arbitrária, nunca usada por ninguém) só para gastar o mesmo
// tempo do bcrypt verdadeiro quando o email não existe — sem isto, responder mais depressa
// quando o email não existe do que quando existe (mas a password está errada) permite adivinhar
// quais emails têm conta só pelo tempo de resposta (achado da auditoria).
const DUMMY_HASH = "$2a$10$Wk.PLjCCVu7jKfCuHmfaPOvft.m9DLXdLZstHSxUud2CgNyKPQZwC";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "A password deve ter pelo menos 8 caracteres"),
});

// `secure` só em produção (HTTPS) — em dev corre em http://localhost, onde um cookie "secure"
// nunca seria enviado de volta pelo browser.
const COOKIE_OPTS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.isProduction,
};

export async function authRoutes(app: FastifyInstance) {
  // Limite de tentativas — encapsulado neste plugin, não afecta as restantes rotas da API.
  // "global: false" só aplica onde a rota indicar explicitamente `config.rateLimit`.
  await app.register(rateLimit, { global: false });

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Email/palavra-passe inválidos" });
      }
      const { email, password } = parsed.data;

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      // Corre sempre o bcrypt.compare, mesmo quando o email não existe (contra o hash de
      // mentira), para o tempo de resposta não denunciar quais emails têm conta.
      const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !passwordOk) {
        return reply.code(401).send({ error: "Credenciais inválidas" });
      }

      if (user.companyId) {
        const [sub] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.companyId, user.companyId))
          .orderBy(desc(subscriptions.createdAt))
          .limit(1);
        if (sub?.status === "suspenso") {
          return reply.code(403).send({ error: "A subscrição da sua empresa está suspensa. Contacte o suporte." });
        }
      }

      const session = await createSession(user.id);
      reply.setCookie("sid", session.id, { ...COOKIE_OPTS, expires: session.expiresAt });

      return {
        id: user.id,
        companyId: user.companyId,
        name: user.name,
        email: user.email,
        role: user.role,
      };
    }
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionId = request.cookies?.sid;
    if (sessionId) {
      await deleteSession(sessionId);
      reply.clearCookie("sid", { path: "/" });
    }
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    return request.currentUser;
  });

  // Mudar a própria password — antes disto só era possível editando a base de dados
  // directamente (achado da auditoria: "gestão de login"). Termina todas as outras sessões
  // deste utilizador (qualquer sessão eventualmente roubada deixa de ser válida) e emite uma
  // sessão nova para o próprio pedido, para quem mudou a password não ficar deslogado.
  app.post("/api/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { currentPassword, newPassword } = parsed.data;

    const userId = request.currentUser!.id;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: "Palavra-passe actual incorrecta" });
    }

    const newHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
    await deleteAllSessionsForUser(userId);

    const session = await createSession(userId);
    reply.setCookie("sid", session.id, { ...COOKIE_OPTS, expires: session.expiresAt });
    return { ok: true };
  });
}
