import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sql } from "../src/db/index.js";
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
