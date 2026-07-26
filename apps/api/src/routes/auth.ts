import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
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

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_STATE_COOKIE = "g_oauth_state";

function loginErrorUrl(code: string): string {
  return `${env.frontendUrl}/login?error=${code}`;
}

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

  app.get("/api/auth/config", async () => {
    return { googleEnabled: Boolean(env.googleClientId && env.googleClientSecret && env.googleRedirectUri) };
  });

  // Passo 1 do login com Google: reencaminha para o ecrã de consentimento da Google. O "state"
  // é gerado aqui e guardado num cookie de curta duração só para ser comparado no callback —
  // protege contra CSRF (alguém a tentar iniciar sessão na conta de outra pessoa através de um
  // link forjado).
  app.get("/api/auth/google/start", async (request, reply) => {
    if (!env.googleClientId || !env.googleRedirectUri) {
      return reply.code(503).send({ error: "Login com Google não está configurado" });
    }
    const state = randomBytes(24).toString("hex");
    reply.setCookie(GOOGLE_STATE_COOKIE, state, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProduction,
      maxAge: 600,
    });
    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleRedirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state,
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // Passo 2: a Google traz o utilizador de volta aqui com um "code". Só cria sessão se o email
  // devolvido pela Google (já verificado pela própria Google) corresponder a uma conta que já
  // exista — o login com Google nunca cria contas/empresas novas, só é um método alternativo de
  // entrar numa conta que um admin já criou (mesma política do login por password).
  app.get(
    "/api/auth/google/callback",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const query = request.query as { code?: string; state?: string; error?: string };
      const cookieState = request.cookies?.[GOOGLE_STATE_COOKIE];
      reply.clearCookie(GOOGLE_STATE_COOKIE, { path: "/" });

      if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
        return reply.redirect(loginErrorUrl("google_nao_configurado"));
      }
      if (query.error || !query.code || !query.state || query.state !== cookieState) {
        return reply.redirect(loginErrorUrl("falha_google"));
      }

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: query.code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: env.googleRedirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) return reply.redirect(loginErrorUrl("falha_google"));
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) return reply.redirect(loginErrorUrl("falha_google"));

      const profileRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!profileRes.ok) return reply.redirect(loginErrorUrl("falha_google"));
      const profile = (await profileRes.json()) as { sub: string; email?: string; email_verified?: boolean };

      if (!profile.email || !profile.email_verified) {
        return reply.redirect(loginErrorUrl("email_google_nao_verificado"));
      }

      const [user] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
      if (!user) {
        return reply.redirect(loginErrorUrl("conta_google_nao_encontrada"));
      }

      if (user.companyId) {
        const [sub] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.companyId, user.companyId))
          .orderBy(desc(subscriptions.createdAt))
          .limit(1);
        if (sub?.status === "suspenso") {
          return reply.redirect(loginErrorUrl("subscricao_suspensa"));
        }
      }

      if (user.googleId !== profile.sub) {
        await db.update(users).set({ googleId: profile.sub }).where(eq(users.id, user.id));
      }

      const session = await createSession(user.id);
      reply.setCookie("sid", session.id, { ...COOKIE_OPTS, expires: session.expiresAt });
      return reply.redirect(env.frontendUrl || "/");
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
