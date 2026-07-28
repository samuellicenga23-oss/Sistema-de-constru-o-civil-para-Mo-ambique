import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sql } from "../src/db/index.js";
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

describe("Permissões por perfil", () => {
  it("visualizador não consegue criar um projecto", async () => {
    const company = await createCompany("Empresa Perfis");
    await createUser(company.id, "visualizador", "viewer@test.local");

    const cookie = await loginCookie(app, "viewer@test.local");
    const res = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie }, payload: { name: "Projecto Visualizador" } });
    expect(res.statusCode).toBe(403);
  });

  it("orçamentista consegue criar um projecto", async () => {
    const company = await createCompany("Empresa Perfis");
    await createUser(company.id, "orcamentista", "orc@test.local");

    const cookie = await loginCookie(app, "orc@test.local");
    const res = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie }, payload: { name: "Projecto Orçamentista" } });
    expect(res.statusCode).toBe(201);
  });

  it("admin_empresa consegue criar e remover um utilizador da própria empresa", async () => {
    const company = await createCompany("Empresa Perfis");
    await createUser(company.id, "admin_empresa", "admin@test.local");
    const cookie = await loginCookie(app, "admin@test.local");

    const createRes = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie },
      payload: { name: "Novo", email: "novo@test.local", password: "password123", role: "visualizador" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; mustChangePassword: boolean };
    expect(created.mustChangePassword).toBe(true);

    const deleteRes = await app.inject({ method: "DELETE", url: `/api/users/${created.id}`, headers: { cookie } });
    expect(deleteRes.statusCode).toBe(200);
  });

  it("protege o último administrador activo da empresa", async () => {
    const company = await createCompany("Empresa Administrador Único");
    const admin = await createUser(company.id, "admin_empresa", "only-admin@test.local");
    const cookie = await loginCookie(app, "only-admin@test.local");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/users/${admin.id}`,
      headers: { cookie },
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("próprio perfil");
  });

  it("administrador suspende outro acesso e termina as suas sessões", async () => {
    const company = await createCompany("Empresa Suspensão");
    await createUser(company.id, "admin_empresa", "manager@test.local");
    const member = await createUser(company.id, "engenheiro_fiscal", "field@test.local");
    const managerCookie = await loginCookie(app, "manager@test.local");
    const memberCookie = await loginCookie(app, "field@test.local");

    const suspend = await app.inject({ method: "PATCH", url: `/api/users/${member.id}`, headers: { cookie: managerCookie }, payload: { isActive: false } });
    expect(suspend.statusCode).toBe(200);
    expect((suspend.json() as { isActive: boolean }).isActive).toBe(false);

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: memberCookie } });
    expect(me.statusCode).toBe(401);
  });

  it("orcamentista não consegue gerir utilizadores da empresa", async () => {
    const company = await createCompany("Empresa Perfis");
    await createUser(company.id, "orcamentista", "orc2@test.local");
    const cookie = await loginCookie(app, "orc2@test.local");

    const res = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie },
      payload: { name: "Novo", email: "novo2@test.local", password: "password123", role: "visualizador" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("super_admin consegue criar uma empresa nova", async () => {
    await createUser(null, "super_admin", "super@test.local");
    const cookie = await loginCookie(app, "super@test.local");

    const res = await app.inject({
      method: "POST",
      url: "/api/companies",
      headers: { cookie },
      payload: { name: "Empresa Criada Pelo Super Admin", adminName: "Admin", adminEmail: "admin-nova@test.local", adminPassword: "password123" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("admin_empresa não consegue aceder ao painel da plataforma", async () => {
    const company = await createCompany("Empresa Perfis");
    await createUser(company.id, "admin_empresa", "admin3@test.local");
    const cookie = await loginCookie(app, "admin3@test.local");

    const res = await app.inject({ method: "GET", url: "/api/companies", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
