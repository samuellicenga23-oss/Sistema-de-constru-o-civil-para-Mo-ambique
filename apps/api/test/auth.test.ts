import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { users } from "../src/db/schema.js";
import { truncateAll, createCompany, createUser } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await app.close();
  await sql.end();
});

beforeEach(async () => {
  await truncateAll();
});

describe("Login", () => {
  it("credenciais erradas devolvem 401", async () => {
    const company = await createCompany("Empresa Login");
    await createUser(company.id, "admin_empresa", "user@test.local", "password123");

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "user@test.local", password: "errada" } });
    expect(res.statusCode).toBe(401);
  });

  it("credenciais correctas criam sessão e devolvem o utilizador", async () => {
    const company = await createCompany("Empresa Login");
    await createUser(company.id, "admin_empresa", "user2@test.local", "password123");

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "user2@test.local", password: "password123" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
    expect((res.json() as { email: string }).email).toBe("user2@test.local");
  });

  it("uma conta desactivada não consegue iniciar sessão", async () => {
    const company = await createCompany("Empresa Inactiva");
    const user = await createUser(company.id, "visualizador", "inactive@test.local", "password123");
    await sql`UPDATE users SET is_active = false WHERE id = ${user.id}`;

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "inactive@test.local", password: "password123" } });
    expect(res.statusCode).toBe(403);
  });

  // Rate limit por IP real (trustProxy) — 10 tentativas por minuto na mesma rota, tal como
  // configurado em routes/auth.ts. Todos os pedidos injectados aqui partilham o mesmo IP
  // simulado, por isso o 11º tem de ser bloqueado.
  it("bloqueia ao fim de 10 tentativas de login por minuto", async () => {
    const company = await createCompany("Empresa Login");
    await createUser(company.id, "admin_empresa", "user3@test.local", "password123");

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "user3@test.local", password: "errada" } });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("Registo público", () => {
  it("cria empresa em trial, mas bloqueia login até confirmar o email", async () => {
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { companyName: "Obra Nova Lda", adminName: "Dono da Obra", email: "novo@test.local", password: "password123" },
    });
    expect(registerRes.statusCode).toBe(201);
    expect(registerRes.json()).toEqual({ ok: true, email: "novo@test.local" });

    const loginBeforeRes = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-forwarded-for": "198.18.1.1" }, payload: { email: "novo@test.local", password: "password123" } });
    expect(loginBeforeRes.statusCode).toBe(403);
    expect(loginBeforeRes.json()).toEqual(expect.objectContaining({ code: "EMAIL_NAO_VERIFICADO" }));

    const [user] = await db.select().from(users).where(eq(users.email, "novo@test.local"));
    expect(user.emailVerificationToken).toBeTruthy();
    expect(user.emailVerifiedAt).toBeNull();

    const verifyRes = await app.inject({ method: "GET", url: `/api/auth/verify-email?token=${user.emailVerificationToken}` });
    expect(verifyRes.statusCode).toBe(302);
    expect(verifyRes.headers["set-cookie"]).toBeDefined();

    const [verifiedUser] = await db.select().from(users).where(eq(users.email, "novo@test.local"));
    expect(verifiedUser.emailVerifiedAt).not.toBeNull();
    expect(verifiedUser.emailVerificationToken).toBeNull();

    const loginAfterRes = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-forwarded-for": "198.18.1.2" }, payload: { email: "novo@test.local", password: "password123" } });
    expect(loginAfterRes.statusCode).toBe(200);
  });

  it("recusa um email de token inválido ou expirado", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/verify-email?token=nao-existe" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("error=token_expirado");
  });

  it("recusa registar um email já existente", async () => {
    const company = await createCompany("Empresa Existente");
    await createUser(company.id, "admin_empresa", "existente@test.local");

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { companyName: "Outra Obra", adminName: "Outro Dono", email: "existente@test.local", password: "password123" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("reenvio de verificação responde de forma genérica, sem revelar se a conta existe", async () => {
    const resKnown = await app.inject({ method: "POST", url: "/api/auth/resend-verification", payload: { email: "nao-existe@test.local" } });
    expect(resKnown.statusCode).toBe(200);
    expect(resKnown.json()).toEqual(expect.objectContaining({ ok: true }));
  });
});
