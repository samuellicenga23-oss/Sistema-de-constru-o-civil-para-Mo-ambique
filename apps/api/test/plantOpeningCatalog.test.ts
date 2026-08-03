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
      payload: { kind: "janela", code: "J01", designation: "Janela da sala", widthM: 1.5, heightM: 1.2, quantity: 2, floor: "Piso Térreo", location: "exterior", material: "Janela alumínio série 20", materialId: material.id, technicalSpecification: "Alumínio natural, vidro 6 mm, fecho central", page: 3, confirmed: true },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ designation: "Janela da sala", materialId: material.id, technicalSpecification: "Alumínio natural, vidro 6 mm, fecho central", floor: "Piso Térreo" });
  });

  it("guarda lajes físicas com armadura superior e inferior", async () => {
    const company = await createCompany("Empresa Lajes");
    await createUser(company.id, "orcamentista", "lajes@test.local");
    const cookie = await loginCookie(app, "lajes@test.local");
    const projectResponse = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie }, payload: { name: "Obra Lajes", currency: "MZN", projectType: "medicao" } });
    const project = projectResponse.json() as { id: string };
    const [plant] = await db.insert(plants).values({ projectId: project.id, discipline: "estrutura", filePath: "teste/lajes.pdf", processingStatus: "concluido", processingProgress: 100 }).returning();
    const layer = { xDiameterMm: 10, xSpacingCm: 15, yDiameterMm: 12, ySpacingCm: 20 };

    const response = await app.inject({
      method: "PUT",
      url: `/api/plants/${plant.id}/slabs`,
      headers: { cookie },
      payload: { slabs: [
        { name: "Laje do piso térreo", floor: "Piso Térreo", areaM2: 120, thicknessCm: 15, layers: ["inferior", "superior"], pages: [1], concreteClass: "B25", steelGrade: "A400", coverCm: 2.5, bottomRebar: layer, topRebar: layer },
        { name: "Laje do piso superior", floor: "Piso Superior", areaM2: 110, thicknessCm: 18, layers: ["inferior", "superior"], pages: [2], bottomRebar: layer, topRebar: layer },
        { name: "Laje de cobertura", floor: "Cobertura", areaM2: 105, thicknessCm: 12, layers: ["inferior", "superior"], pages: [3], bottomRebar: layer, topRebar: layer },
      ] },
    });

    expect(response.statusCode).toBe(200);
    const summary = response.json().structuralSummary;
    expect(summary).toMatchObject({ slabsCount: 3, slabsAvgThicknessCm: 15 });
    expect(summary.slabs).toHaveLength(3);
    expect(summary.slabs[0]).toMatchObject({ name: "Laje do piso térreo", areaM2: 120, topRebar: layer, bottomRebar: layer });
  });
});
