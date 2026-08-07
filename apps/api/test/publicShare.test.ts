import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

async function projectContext() {
  const company = await createCompany("Empresa Partilha Pública");
  await createUser(company.id, "admin_empresa", "admin-partilha@test.local");
  await createUser(company.id, "visualizador", "visualizador-partilha@test.local");
  const cookie = await loginCookie(app, "admin-partilha@test.local");
  const viewerCookie = await loginCookie(app, "visualizador-partilha@test.local");
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "Obra Partilha Pública", currency: "MZN", projectType: "orcamento" },
  });
  expect(projectResponse.statusCode).toBe(201);
  const project = projectResponse.json() as { id: string };
  return { cookie, viewerCookie, project };
}

describe("Link público do dono da obra", () => {
  it("gera, consulta e revoga o link — só admin_empresa pode gerir", async () => {
    const { cookie, viewerCookie, project } = await projectContext();

    const forbiddenResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/public-share`,
      headers: { cookie: viewerCookie },
    });
    expect(forbiddenResponse.statusCode).toBe(403);

    const statusBeforeResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/public-share`,
      headers: { cookie },
    });
    expect(statusBeforeResponse.json()).toEqual({ enabled: false, token: null });

    const generateResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/public-share`,
      headers: { cookie },
    });
    expect(generateResponse.statusCode).toBe(200);
    const { token } = generateResponse.json() as { token: string };
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const publicResponse = await app.inject({ method: "GET", url: `/api/public/obra/${token}` });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json()).toEqual(
      expect.objectContaining({
        projectName: "Obra Partilha Pública",
        progress: expect.objectContaining({ hasCertificates: false }),
        diary: [],
      }),
    );

    const revokeResponse = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/public-share`,
      headers: { cookie },
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(revokeResponse.json()).toEqual({ enabled: false });

    const publicAfterRevokeResponse = await app.inject({ method: "GET", url: `/api/public/obra/${token}` });
    expect(publicAfterRevokeResponse.statusCode).toBe(404);
  });

  it("recusa um token inválido ou inexistente", async () => {
    const res = await app.inject({ method: "GET", url: "/api/public/obra/token-que-nao-existe" });
    expect(res.statusCode).toBe(404);
  });

  it("gerar de novo invalida o link anterior imediatamente", async () => {
    const { cookie, project } = await projectContext();

    const firstResponse = await app.inject({ method: "POST", url: `/api/projects/${project.id}/public-share`, headers: { cookie } });
    const firstToken = (firstResponse.json() as { token: string }).token;

    const secondResponse = await app.inject({ method: "POST", url: `/api/projects/${project.id}/public-share`, headers: { cookie } });
    const secondToken = (secondResponse.json() as { token: string }).token;
    expect(secondToken).not.toBe(firstToken);

    const oldTokenResponse = await app.inject({ method: "GET", url: `/api/public/obra/${firstToken}` });
    expect(oldTokenResponse.statusCode).toBe(404);

    const newTokenResponse = await app.inject({ method: "GET", url: `/api/public/obra/${secondToken}` });
    expect(newTokenResponse.statusCode).toBe(200);
  });
});
