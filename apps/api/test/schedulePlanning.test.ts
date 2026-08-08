import { describe, expect, it } from "vitest";
import {
  buildExecutionPlan,
  validateValueShares,
  type PlanningSourceNode,
  type PlanningSourceSection,
} from "../src/services/schedulePlanning.js";

function leaf(code: string, name: string, durationDays = 6, quantity = 10): PlanningSourceNode {
  return {
    id: `item-${code}`,
    kind: "item",
    code,
    name,
    quantity,
    durationDays,
    durationBasis: "horas",
    sortOrder: Number(code.split(".").at(-1) ?? 0),
    children: [],
  };
}

function chapter(code: string, name: string, items: PlanningSourceNode[]): PlanningSourceNode {
  return {
    id: `chapter-${code}`,
    kind: "capitulo",
    code,
    name,
    quantity: null,
    durationDays: items.reduce((sum, item) => sum + item.durationDays, 0),
    durationBasis: "soma",
    sortOrder: Number(code),
    children: items,
  };
}

function standardSection(roots: PlanningSourceNode[]): PlanningSourceSection {
  return { id: "section-1", name: "Edifício Principal", sortOrder: 0, templateKey: "sigo_padrao_v2", roots };
}

function activities(plan: ReturnType<typeof buildExecutionPlan>) {
  const result: ReturnType<typeof buildExecutionPlan>["roots"] = [];
  const walk = (nodes: ReturnType<typeof buildExecutionPlan>["roots"]) => {
    for (const node of nodes) {
      if (node.kind === "activity") result.push(node);
      walk(node.children);
    }
  };
  walk(plan.roots);
  return result;
}

function byCode(plan: ReturnType<typeof buildExecutionPlan>, code: string) {
  return activities(plan).filter((node) => node.sourceCode === code);
}

function depExists(plan: ReturnType<typeof buildExecutionPlan>, predecessorKey: string, successorKey: string) {
  return plan.dependencies.some((dep) => dep.predecessorKey === predecessorKey && dep.successorKey === successorKey);
}

function expectSharesClose(plan: ReturnType<typeof buildExecutionPlan>) {
  for (const row of validateValueShares(plan.roots)) expect(row.totalShare).toBe(1);
}

describe("Motor profissional de WBS", () => {
  it("gera chapa de 1 piso sem inventar estrutura de cobertura", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([
        chapter("1", "TRABALHOS PRELIMINARES", [leaf("1.1", "Limpeza"), leaf("1.2", "Implantação")]),
        chapter("2", "MOVIMENTOS DE TERRA", [leaf("2.1", "Escavação")]),
        chapter("3", "BETÕES, AÇOS E COFRAGENS", [
          leaf("3.2", "Betão B25 em sapatas"),
          leaf("3.3", "Betão estrutural B25 em pilares"),
          leaf("3.4", "Betão B25 em vigas e lintéis"),
        ]),
        chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria de bloco 20 cm")]),
        chapter("10", "COBERTURA", [
          leaf("10.1", "Impermeabilização da cobertura"),
          leaf("10.2", "Cobertura em chapa metálica"),
          leaf("10.3", "Cumeeira e remates de cobertura"),
        ]),
      ])],
      floors: 1,
      startDate: "2026-08-10",
    });

    expect(plan.roofKind).toBe("sheet");
    expect(byCode(plan, "3.3")[0].name).toBe("Betão estrutural B25 em pilares — Piso 0");
    expect(byCode(plan, "10.2")[0].name).toBe("Cobertura em chapa metálica — Cobertura");
    expect(activities(plan).some((node) => /estrutura de cobertura/i.test(node.name))).toBe(false);
    expect(depExists(plan, byCode(plan, "10.1")[0].key, byCode(plan, "10.2")[0].key)).toBe(true);
    expect(depExists(plan, byCode(plan, "10.2")[0].key, byCode(plan, "10.3")[0].key)).toBe(true);
    expectSharesClose(plan);
  });

  it("gera chapa multi-piso com suporte vertical e valueShare = 100%", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([
        chapter("2", "MOVIMENTOS DE TERRA", [leaf("2.1", "Escavação", 4)]),
        chapter("3", "BETÕES, AÇOS E COFRAGENS", [
          leaf("3.2", "Betão B25 em sapatas", 4),
          leaf("3.3", "Betão estrutural B25 em pilares", 9),
          leaf("3.4", "Betão B25 em vigas e lintéis", 9),
          leaf("3.5", "Betão estrutural B25 em lajes", 6),
        ]),
        chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria de bloco 20 cm", 9)]),
        chapter("10", "COBERTURA", [leaf("10.2", "Cobertura em chapa metálica", 5), leaf("10.3", "Cumeeira e remates", 2)]),
      ])],
      floors: 3,
      startDate: "2026-08-10",
    });

    expect(plan.roofKind).toBe("sheet");
    expect(byCode(plan, "3.3")).toHaveLength(3);
    expect(byCode(plan, "3.4")).toHaveLength(3);
    expect(byCode(plan, "3.5")).toHaveLength(2);
    expect(byCode(plan, "4.1")).toHaveLength(3);
    const slab0 = byCode(plan, "3.5").find((node) => node.floorIndex === 0)!;
    const columns1 = byCode(plan, "3.3").find((node) => node.floorIndex === 1)!;
    expect(depExists(plan, slab0.key, columns1.key)).toBe(true);
    expect(plan.dependencies.find((dep) => dep.predecessorKey === slab0.key && dep.successorKey === columns1.key)?.lagDays).toBe(6);
    const columns2 = byCode(plan, "3.3").find((node) => node.floorIndex === 2)!;
    const slab1 = byCode(plan, "3.5").find((node) => node.floorIndex === 1)!;
    expect(depExists(plan, slab1.key, columns2.key)).toBe(true);
    expectSharesClose(plan);
  });

  it("gera laje de cobertura em 1 piso e impermeabilização após a laje", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([
        chapter("2", "MOVIMENTOS DE TERRA", [leaf("2.1", "Escavação", 3)]),
        chapter("3", "BETÕES, AÇOS E COFRAGENS", [
          leaf("3.2", "Betão B25 em sapatas", 3),
          leaf("3.3", "Betão estrutural B25 em pilares", 5),
          leaf("3.4", "Betão B25 em vigas e lintéis", 5),
          leaf("3.5", "Betão estrutural B25 em lajes", 5),
          leaf("3.7", "Malhasol AQ38 aplicado", 2),
        ]),
        chapter("10", "COBERTURA", [leaf("10.1", "Impermeabilização da cobertura", 3)]),
      ])],
      floors: 1,
      startDate: "2026-08-10",
    });

    expect(plan.roofKind).toBe("slab");
    const slab = byCode(plan, "3.5")[0];
    expect(slab.name).toBe("Betão estrutural B25 em lajes — Cobertura");
    const roofMesh = byCode(plan, "3.7")[0];
    expect(roofMesh.name).toBe("Malhasol AQ38 aplicado — Cobertura");
    expect(depExists(plan, roofMesh.key, slab.key)).toBe(true);
    expect(depExists(plan, slab.key, byCode(plan, "10.1")[0].key)).toBe(true);
    expect(plan.dependencies.find((dep) => dep.predecessorKey === slab.key && dep.successorKey === byCode(plan, "10.1")[0].key)?.lagDays).toBe(6);
    expectSharesClose(plan);
  });


  it("reconhece laje de cobertura pelo código explícito 3.7 mesmo sem impermeabilização", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([chapter("3", "BETÕES, AÇOS E COFRAGENS", [
        leaf("3.3", "Betão estrutural B25 em pilares", 4),
        leaf("3.4", "Betão B25 em vigas e lintéis", 4),
        leaf("3.5", "Betão estrutural B25 em lajes", 4),
        leaf("3.7", "Malhasol AQ38 aplicado", 2),
      ])])],
      floors: 1,
      startDate: "2026-08-10",
    });
    expect(plan.roofKind).toBe("slab");
    expect(byCode(plan, "3.5")[0].name).toMatch(/Cobertura$/);
    expect(depExists(plan, byCode(plan, "3.7")[0].key, byCode(plan, "3.5")[0].key)).toBe(true);
    expectSharesClose(plan);
  });

  it("gera laje multi-piso: laje intermédia suporta piso superior e última laje é cobertura", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([
        chapter("2", "MOVIMENTOS DE TERRA", [leaf("2.1", "Escavação", 3)]),
        chapter("3", "BETÕES, AÇOS E COFRAGENS", [
          leaf("3.2", "Betão B25 em sapatas", 4),
          leaf("3.3", "Betão estrutural B25 em pilares", 8),
          leaf("3.4", "Betão B25 em vigas e lintéis", 8),
          leaf("3.5", "Betão estrutural B25 em lajes", 8),
        ]),
        chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria de bloco 20 cm", 8)]),
        chapter("10", "COBERTURA", [leaf("10.1", "Impermeabilização da cobertura", 3)]),
      ])],
      floors: 2,
      startDate: "2026-08-10",
    });

    const slabs = byCode(plan, "3.5");
    expect(slabs).toHaveLength(2);
    expect(slabs.find((node) => node.floorIndex === 1)?.name).toMatch(/Cobertura$/);
    const slab0 = slabs.find((node) => node.floorIndex === 0)!;
    const columns1 = byCode(plan, "3.3").find((node) => node.floorIndex === 1)!;
    expect(depExists(plan, slab0.key, columns1.key)).toBe(true);
    const roofSlab = slabs.find((node) => node.floorIndex === 1)!;
    expect(depExists(plan, roofSlab.key, byCode(plan, "10.1")[0].key)).toBe(true);
    expectSharesClose(plan);
  });

  it("num mapa importado não inventa pisos nem renomeia actividades", () => {
    const imported: PlanningSourceSection = {
      id: "imp",
      name: "Importado",
      sortOrder: 0,
      templateKey: null,
      roots: [chapter("A", "Capítulo do empreiteiro", [
        { ...leaf("A.1", "Trabalho X", 4), sortOrder: 0 },
        { ...leaf("A.2", "Trabalho Y", 5), sortOrder: 1 },
      ])],
    };
    const plan = buildExecutionPlan({ sections: [imported], floors: 5, startDate: "2026-08-10" });
    expect(activities(plan).map((node) => node.name)).toEqual(["Trabalho X", "Trabalho Y"]);
    expect(activities(plan).every((node) => node.floorIndex === null)).toBe(true);
    expect(plan.dependencies).toHaveLength(1);
    expectSharesClose(plan);
  });

  it("não infla dias quando um item agregado é curto demais para repartir por pisos", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 2)])])],
      floors: 4,
      startDate: "2026-08-10",
    });
    expect(byCode(plan, "4.1")).toHaveLength(1);
    expect(byCode(plan, "4.1")[0].durationDays).toBe(2);
    expect(plan.warnings.some((warning) => warning.code === "UNSPLIT_FLOOR_ACTIVITY")).toBe(true);
    expectSharesClose(plan);
  });

  it("avisa sobre folhas >20 dias e escala prazo pela duração real do grafo", () => {
    const base = standardSection([
      chapter("3", "BETÕES, AÇOS E COFRAGENS", [leaf("3.3", "Pilares", 24), leaf("3.4", "Vigas", 24)]),
      chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 24)]),
    ]);
    const natural = buildExecutionPlan({ sections: [base], floors: 1, startDate: "2026-08-10" });
    const target = natural.durationDays + 12;
    const scaled = buildExecutionPlan({ sections: [base], floors: 1, startDate: "2026-08-10", totalDurationDays: target });
    expect(scaled.durationDays).toBeGreaterThanOrEqual(natural.durationDays);
    expect(Math.abs(scaled.durationDays - target)).toBeLessThanOrEqual(2);
    expect(scaled.warnings.some((warning) => warning.code === "LONG_ACTIVITY")).toBe(true);
  });
  it("valueShare é fracção do item e não proporção dos dias", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 10)])])],
      floors: 3,
      startDate: "2026-08-10",
    });
    const split = byCode(plan, "4.1");
    expect(split.map((node) => node.durationDays)).toEqual([4, 3, 3]);
    expect(split.map((node) => node.valueShare)).toEqual([0.3334, 0.3333, 0.3333]);
    expect(split[0].valueShare).not.toBe(0.4);
    expectSharesClose(plan);
  });

  it("mantém aço/cofragem agregados como pacotes transversais, sem fingir elemento/piso", () => {
    const plan = buildExecutionPlan({
      sections: [standardSection([
        chapter("2", "MOVIMENTOS DE TERRA", [leaf("2.1", "Escavação", 4)]),
        chapter("3", "BETÕES, AÇOS E COFRAGENS", [
          leaf("3.1", "Betão de limpeza", 3),
          leaf("3.2", "Betão B25 em sapatas", 4),
          leaf("3.3", "Betão B25 em pilares", 8),
          leaf("3.4", "Betão B25 em vigas", 8),
          leaf("3.5", "Betão B25 em lajes", 8),
          leaf("3.6", "Aço A400 aplicado", 20),
          leaf("3.8", "Cofragem de elementos estruturais", 20),
        ]),
        chapter("10", "COBERTURA", [leaf("10.1", "Impermeabilização", 3)]),
      ])],
      floors: 2,
      startDate: "2026-08-10",
    });
    expect(byCode(plan, "3.6")).toHaveLength(1);
    expect(byCode(plan, "3.8")).toHaveLength(1);
    expect(byCode(plan, "3.6")[0].floorIndex).toBeNull();
    expect(plan.warnings.some((warning) => warning.code === "GENERIC_STRUCTURAL_RESOURCE")).toBe(true);
    expectSharesClose(plan);
  });

});
