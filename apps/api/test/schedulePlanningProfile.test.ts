import { describe, expect, it } from "vitest";
import {
  buildPlanningQuestions,
  defaultSchedulePlanningProfile,
  validateSchedulePlanningProfile,
  type PlanningContext,
} from "../src/services/schedulePlanningProfile.js";

function context(overrides: Partial<PlanningContext> = {}): PlanningContext {
  return {
    floors: 3,
    floorLabels: ["Piso 0", "Piso 1", "Piso 2"],
    measuredItemCount: 20,
    hasSigoTemplate: true,
    hasImportedScope: false,
    supportsFloorPlanning: true,
    detectedRoofKind: "sheet",
    hasStructure: true,
    hasMasonry: true,
    hasMep: true,
    hasFinishes: true,
    hasRoof: true,
    hasExternal: true,
    activeTrades: ["structure", "masonry", "mep", "roofing", "finishes"],
    aggregatedFloorCodes: ["3.3", "3.4", "4.1"],
    aggregatedStructuralCodes: ["3.6", "3.8"],
    ...overrides,
  };
}

const startDate = "2026-08-10";

describe("Assistente de Planeamento", () => {
  it("propõe planeamento por piso quando o BOQ tem metadados seguros", () => {
    const ctx = context();
    const profile = defaultSchedulePlanningProfile(ctx, startDate);
    expect(profile.locationStrategy).toBe("floors");
    const questionKeys = buildPlanningQuestions(ctx).map((question) => question.key);
    expect(questionKeys).toContain("locationStrategy");
    expect(questionKeys).toContain("floorLabels");
    expect(questionKeys).toContain("floorShares");
    expect(questionKeys).toContain("sequencePolicy");
    expect(questionKeys).toContain("tradeResources");
    expect(questionKeys).toContain("cureLags");
    expect(questionKeys).not.toContain("roofKindOverride");
  });

  it("pergunta pela tipologia da cobertura apenas quando o BOQ não a determina", () => {
    const ctx = context({ detectedRoofKind: "unknown" });
    expect(buildPlanningQuestions(ctx).map((question) => question.key)).toContain("roofKindOverride");
  });

  it("não oferece repartição automática por piso num mapa importado sem metadados seguros", () => {
    const ctx = context({ hasSigoTemplate: false, hasImportedScope: true, supportsFloorPlanning: false });
    const profile = defaultSchedulePlanningProfile(ctx, startDate);
    expect(profile.locationStrategy).toBe("boq");
    expect(buildPlanningQuestions(ctx).map((question) => question.key)).not.toContain("locationStrategy");
  });

  it("bloqueia perfil piso/zona sem zonas", () => {
    const ctx = context();
    const profile = { ...defaultSchedulePlanningProfile(ctx, startDate), locationStrategy: "floors_zones" as const, zones: [] };
    const errors = validateSchedulePlanningProfile(profile, ctx);
    expect(errors.join(" ")).toMatch(/zona/i);
  });

  it("aceita percentagens normalizadas por piso", () => {
    const ctx = context();
    const profile = { ...defaultSchedulePlanningProfile(ctx, startDate), floorShares: [0.4, 0.35, 0.25] };
    expect(validateSchedulePlanningProfile(profile, ctx)).toEqual([]);
  });

  it("recusa percentagens que não fecham em 100%", () => {
    const ctx = context();
    const profile = { ...defaultSchedulePlanningProfile(ctx, startDate), floorShares: [0.4, 0.35, 0.2] };
    expect(validateSchedulePlanningProfile(profile, ctx).join(" ")).toMatch(/100%/i);
  });

  it("mantém 1 piso como localização estruturada e permite zonas quando o template é seguro", () => {
    const ctx = context({ floors: 1, floorLabels: ["Piso 0"] });
    expect(defaultSchedulePlanningProfile(ctx, startDate).locationStrategy).toBe("floors");
    const keys = buildPlanningQuestions(ctx).map((question) => question.key);
    expect(keys).toContain("locationStrategy");
    expect(keys).toContain("floorLabels");
    expect(keys).toContain("zones");
  });

  it("obriga cada piso/nível a ter uma designação", () => {
    const ctx = context();
    const profile = defaultSchedulePlanningProfile(ctx, startDate);
    profile.floorLabels[1] = "";
    expect(validateSchedulePlanningProfile(profile, ctx).join(" ")).toMatch(/designação/i);
  });
});
