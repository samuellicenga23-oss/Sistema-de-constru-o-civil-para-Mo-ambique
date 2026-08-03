import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sql } from "../src/db/index.js";
import { plants } from "../src/db/schema.js";
import { createCompany, createUser, loginCookie, truncateAll } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp({ logger: false }); });
afterAll(async () => { await app.close(); await sql.end(); });
beforeEach(async () => { await truncateAll(); });

describe("portas e janelas ligadas ao catálogo", () => {
  it("guarda material e especificação técnica no vão", async () => {
    const company = await createCompany("Empresa Vãos");
    await createUser(company.id, "orcamentista", "vaos@test.local");
    const cookie = await loginCookie(app, "vaos@test.local");
    const projectResponse = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie }, payload: { name: "Obra Vãos", currency: "MZN", projectType: "medicao" } });
    const project = projectResponse.json() as { id: string };
    const [plant] = await db.insert(plants).values({ projectId: project.id, discipline: "arquitectura", filePath: "teste/vaos.pdf", processingStatus: "concluido", processingProgress: 100 }).returning();
    const materialResponse = await app.inject({ method: "POST", url: "/api/catalog/materials", headers: { cookie }, payload: { name: "Janela alumínio série 20", category: "Portas e Janelas", specification: "Vidro 6 mm", unit: "m2", baseUnitCost: 6500 } });
    const material = materialResponse.json() as { id: string };

    const response = await app.inject({
      method: "POST",
      url: `/api/plants/${plant.id}/openings`,
      headers: { cookie },
      payload: { kind: "janela", code: "J01", widthM: 1.5, heightM: 1.2, quantity: 2, floor: "Piso Térreo", location: "exterior", material: "Janela alumínio série 20", materialId: material.id, technicalSpecification: "Alumínio natural, vidro 6 mm, fecho central", page: 3, confirmed: true },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ materialId: material.id, technicalSpecification: "Alumínio natural, vidro 6 mm, fecho central", floor: "Piso Térreo" });
  });
});
