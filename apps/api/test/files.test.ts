import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { projects, plants } from "../src/db/schema.js";
import { truncateAll, createCompany, createUser, loginCookie } from "./helpers.js";

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

describe("Ficheiros privados (plantas, diário de obra)", () => {
  it("pedir uma planta sem sessão devolve 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/files/plants/00000000-0000-0000-0000-000000000000" });
    expect(res.statusCode).toBe(401);
  });

  it("pedir a planta de outra empresa devolve 404, mesmo autenticado", async () => {
    const companyA = await createCompany("Empresa A");
    const companyB = await createCompany("Empresa B");
    await createUser(companyA.id, "admin_empresa", "a@test.local");
    await createUser(companyB.id, "admin_empresa", "b@test.local");
    const [projectB] = await db.insert(projects).values({ companyId: companyB.id, name: "Projecto B", currency: "MZN" }).returning();
    const [plantB] = await db
      .insert(plants)
      .values({ projectId: projectB.id, discipline: "arquitectura", filePath: "/tmp/nao-existe.pdf", originalFileName: "planta.pdf", processingStatus: "concluido" })
      .returning();

    const cookieA = await loginCookie(app, "a@test.local");
    const res = await app.inject({ method: "GET", url: `/api/files/plants/${plantB.id}`, headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(404);
  });

  it("as antigas rotas estáticas públicas de plantas/diário já não existem", async () => {
    const res = await app.inject({ method: "GET", url: "/uploads/plants/qualquer-coisa.pdf" });
    expect(res.statusCode).toBe(404);
  });
});
