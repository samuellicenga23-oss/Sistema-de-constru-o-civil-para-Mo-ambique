import { describe, expect, it } from "vitest";
import {
  buildExecutionPlan,
  buildPlanningContext,
  validateValueShares,
  type PlanningSourceNode,
  type PlanningSourceSection,
} from "../src/services/schedulePlanning.js";
import { buildPlanningQuestions, defaultSchedulePlanningProfile, validateSchedulePlanningProfile, type SchedulePlanningProfile } from "../src/services/schedulePlanningProfile.js";

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

function makePlan(args: Omit<Parameters<typeof buildExecutionPlan>[0], "profile"> & { profile?: SchedulePlanningProfile }) {
  const context = buildPlanningContext(args.sections, args.floors);
  const profile = args.profile ?? defaultSchedulePlanningProfile(context, args.startDate);
  return buildExecutionPlan({ ...args, profile });
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
    const plan = makePlan({
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
    expect(byCode(plan, "3.3")[0].name).toBe("Armar, cofrar e betonar pilares — Piso térreo");
    expect(byCode(plan, "10.2")[0].name).toBe("Montar a cobertura metálica — Cobertura");
    expect(activities(plan).some((node) => /estrutura de cobertura/i.test(node.name))).toBe(false);
    expect(depExists(plan, byCode(plan, "10.1")[0].key, byCode(plan, "10.2")[0].key)).toBe(true);
    expect(depExists(plan, byCode(plan, "10.2")[0].key, byCode(plan, "10.3")[0].key)).toBe(true);
    expectSharesClose(plan);
  });

  it("gera chapa multi-piso com suporte vertical e valueShare = 100%", () => {
    const plan = makePlan({
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
    const plan = makePlan({
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
    expect(slab.name).toBe("Armar, cofrar e betonar a laje — Cobertura");
    const roofMesh = byCode(plan, "3.7")[0];
    expect(roofMesh.name).toBe("Montar malha de armadura da laje — Cobertura");
    expect(depExists(plan, roofMesh.key, slab.key)).toBe(true);
    expect(depExists(plan, slab.key, byCode(plan, "10.1")[0].key)).toBe(true);
    expect(plan.dependencies.find((dep) => dep.predecessorKey === slab.key && dep.successorKey === byCode(plan, "10.1")[0].key)?.lagDays).toBe(6);
    expectSharesClose(plan);
  });


  it("reconhece laje de cobertura pelo código explícito 3.7 mesmo sem impermeabilização", () => {
    const plan = makePlan({
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
    const plan = makePlan({
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

  it("num mapa importado não inventa pisos e converte descrições em acções curtas", () => {
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
    const plan = makePlan({ sections: [imported], floors: 5, startDate: "2026-08-10" });
    expect(activities(plan).map((node) => node.name)).toEqual(["Executar trabalho X", "Executar trabalho Y"]);
    expect(activities(plan).every((node) => node.floorIndex === null)).toBe(true);
    expect(plan.dependencies).toHaveLength(1);
    expectSharesClose(plan);
  });

  it("mantém todos os pisos quando um item agregado tem menos dias do que localizações", () => {
    const plan = makePlan({
      sections: [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 2)])])],
      floors: 4,
      startDate: "2026-08-10",
    });
    expect(byCode(plan, "4.1")).toHaveLength(4);
    expect(byCode(plan, "4.1").map((node) => node.durationDays)).toEqual([1, 1, 1, 1]);
    expect(plan.warnings.some((warning) => warning.code === "LOCATION_DURATION_MINIMUM")).toBe(true);
    expectSharesClose(plan);
  });

  it("gera uma linha de balanço completa para um edifício de dez pisos", () => {
    const plan = makePlan({
      sections: [standardSection([
        chapter("3", "ESTRUTURA", [leaf("3.3", "Pilares", 30), leaf("3.4", "Vigas", 30), leaf("3.5", "Lajes", 27)]),
        chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 20)]),
        chapter("13", "ELECTRICIDADE", [leaf("13.2", "Pontos de iluminação", 20)]),
        chapter("7", "PINTURAS", [leaf("7.2", "Pintura interior", 20)]),
      ])],
      floors: 10,
      startDate: "2026-08-10",
    });
    expect(byCode(plan, "3.3")).toHaveLength(10);
    expect(byCode(plan, "4.1")).toHaveLength(10);
    expect(byCode(plan, "13.2")).toHaveLength(10);
    expect(byCode(plan, "7.2")).toHaveLength(10);
    expect(new Set(byCode(plan, "3.3").map((node) => node.floorIndex)).size).toBe(10);
    expectSharesClose(plan);
  });

  it("avisa sobre folhas >20 dias e escala prazo pela duração real do grafo", () => {
    const base = standardSection([
      chapter("3", "BETÕES, AÇOS E COFRAGENS", [leaf("3.3", "Pilares", 24), leaf("3.4", "Vigas", 24)]),
      chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 24)]),
    ]);
    const natural = makePlan({ sections: [base], floors: 1, startDate: "2026-08-10" });
    const target = natural.durationDays + 12;
    const scaled = makePlan({ sections: [base], floors: 1, startDate: "2026-08-10", totalDurationDays: target });
    expect(scaled.durationDays).toBeGreaterThanOrEqual(natural.durationDays);
    expect(Math.abs(scaled.durationDays - target)).toBeLessThanOrEqual(2);
    expect(scaled.warnings.some((warning) => warning.code === "LONG_ACTIVITY")).toBe(true);
  });
  it("valueShare é fracção do item e não proporção dos dias", () => {
    const plan = makePlan({
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

  it("reparte aço/cofragem agregados por piso sem duplicar valor", () => {
    const plan = makePlan({
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
    expect(byCode(plan, "3.6")).toHaveLength(2);
    expect(byCode(plan, "3.8")).toHaveLength(2);
    expect(byCode(plan, "3.6").map((task) => task.floorIndex)).toEqual([0, 1]);
    expect(byCode(plan, "3.6").reduce((sum, task) => sum + task.valueShare, 0)).toBeCloseTo(1, 4);
    expect(depExists(plan, byCode(plan, "3.6")[0].key, byCode(plan, "3.3")[0].key)).toBe(true);
    expect(plan.warnings.some((warning) => warning.code === "GENERIC_STRUCTURAL_RESOURCE")).toBe(true);
    expectSharesClose(plan);
  });


  it("o assistente trata distribuição uniforme como hipótese, não como dado informado", () => {
    const sections = [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 12)])])];
    const context = buildPlanningContext(sections, 3);
    const profile = defaultSchedulePlanningProfile(context, "2026-08-10");
    expect(profile.floorShares).toBeNull();
    const plan = buildExecutionPlan({ sections, floors: 3, startDate: profile.startDate, profile });
    expect(byCode(plan, "4.1").map((node) => node.valueShare)).toEqual([0.3334, 0.3333, 0.3333]);
    expect(byCode(plan, "4.1").every((node) => node.allocationBasis === "assumido")).toBe(true);
    expect(plan.assumptions.some((text) => text.includes("Distribuição por piso não informada"))).toBe(true);
  });

  it("usa percentagens por piso informadas sem relacionar valueShare com a duração", () => {
    const sections = [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 10)])])];
    const context = buildPlanningContext(sections, 3);
    const profile = defaultSchedulePlanningProfile(context, "2026-08-10");
    profile.floorShares = [0.5, 0.3, 0.2];
    const plan = buildExecutionPlan({ sections, floors: 3, startDate: profile.startDate, profile });
    expect(byCode(plan, "4.1").map((node) => node.valueShare)).toEqual([0.5, 0.3, 0.2]);
    expect(byCode(plan, "4.1").map((node) => node.durationDays)).toEqual([5, 3, 2]);
    expect(byCode(plan, "4.1").every((node) => node.allocationBasis === "informado")).toBe(true);
    expectSharesClose(plan);
  });

  it("permite zonas sem percentagens conhecidas e marca a repartição como assumida", () => {
    const sections = [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 12)])])];
    const context = buildPlanningContext(sections, 2);
    const profile = defaultSchedulePlanningProfile(context, "2026-08-10");
    profile.locationStrategy = "floors_zones";
    profile.zones = [
      { id: "a", label: "Bloco A", share: null },
      { id: "b", label: "Bloco B", share: null },
    ];
    expect(validateSchedulePlanningProfile(profile, context)).toEqual([]);
    const plan = buildExecutionPlan({ sections, floors: 2, startDate: profile.startDate, profile });
    const split = byCode(plan, "4.1");
    expect(split).toHaveLength(4);
    expect(split.map((node) => node.valueShare)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(split.every((node) => node.allocationBasis === "assumido")).toBe(true);
    expect(split.some((node) => node.name.includes("Bloco A"))).toBe(true);
    expectSharesClose(plan);
  });

  it("aplica uma frente padrão sem obrigar o utilizador a preencher recursos", () => {
    const sections = [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 12)])])];
    const context = buildPlanningContext(sections, 3);
    const profile = defaultSchedulePlanningProfile(context, "2026-08-10");
    expect(profile.tradeFronts.masonry).toBe(1);
    const plan = buildExecutionPlan({ sections, floors: 3, startDate: profile.startDate, profile });
    expect(plan.warnings.some((warning) => warning.code === "FRONT_COUNT_DEFAULT")).toBe(false);
    expect(plan.warnings.some((warning) => warning.code === "FRONT_CAPACITY_APPLIED")).toBe(true);
  });

  it("aplica capacidade de frentes entre localizações da mesma especialidade", () => {
    const sections = [standardSection([chapter("4", "ALVENARIAS", [leaf("4.1", "Alvenaria", 12)])])];
    const context = buildPlanningContext(sections, 3);
    const oneFront = defaultSchedulePlanningProfile(context, "2026-08-10");
    oneFront.tradeFronts.masonry = 1;
    const serial = buildExecutionPlan({ sections, floors: 3, startDate: oneFront.startDate, profile: oneFront });
    expect(serial.warnings.some((warning) => warning.code === "FRONT_CAPACITY_APPLIED")).toBe(true);
    const serialFloors = byCode(serial, "4.1");
    expect(depExists(serial, serialFloors[0].key, serialFloors[1].key)).toBe(true);
    expect(depExists(serial, serialFloors[1].key, serialFloors[2].key)).toBe(true);

    const threeFronts = defaultSchedulePlanningProfile(context, "2026-08-10");
    threeFronts.tradeFronts.masonry = 3;
    const parallel = buildExecutionPlan({ sections, floors: 3, startDate: threeFronts.startDate, profile: threeFronts });
    const parallelFloors = byCode(parallel, "4.1");
    expect(parallel.warnings.some((warning) => warning.code === "FRONT_CAPACITY_APPLIED")).toBe(false);
    expect(depExists(parallel, parallelFloors[0].key, parallelFloors[1].key)).toBe(false);
    expect(depExists(parallel, parallelFloors[1].key, parallelFloors[2].key)).toBe(false);
    expect(parallel.durationDays).toBeLessThanOrEqual(serial.durationDays);
  });

  it("faz perguntas adaptativas a partir do BOQ e não por palavras da descrição", () => {
    const sections = [standardSection([
      chapter("3", "QUALQUER TÍTULO", [leaf("3.3", "Descrição arbitrária", 8), leaf("3.4", "Outra descrição", 8), leaf("3.8", "Pacote", 4)]),
      chapter("10", "OUTRO TÍTULO", [leaf("10.2", "Item X", 4)]),
    ])];
    const context = buildPlanningContext(sections, 2);
    const questions = buildPlanningQuestions(context);
    expect(context.activeTrades).toContain("structure");
    expect(context.activeTrades).toContain("roofing");
    expect(context.detectedRoofKind).toBe("sheet");
    expect(context.aggregatedStructuralCodes).toContain("3.8");
    expect(questions.map((question) => question.key)).toEqual(["floorLabels", "sequencePolicy"]);
    expect(questions).toHaveLength(2);
  });

  it("num mapa importado preserva o BOQ e o assistente não oferece falsa precisão por piso", () => {
    const imported: PlanningSourceSection = {
      id: "imp-2",
      name: "Importado",
      sortOrder: 0,
      templateKey: null,
      roots: [chapter("A", "Capítulo", [{ ...leaf("A.1", "Trabalho", 5), sortOrder: 0 }])],
    };
    const context = buildPlanningContext([imported], 4);
    const questions = buildPlanningQuestions(context);
    const profile = defaultSchedulePlanningProfile(context, "2026-08-10");
    expect(context.supportsFloorPlanning).toBe(false);
    expect(profile.locationStrategy).toBe("boq");
    expect(questions.some((question) => question.key === "locationStrategy")).toBe(false);
    expect(questions.some((question) => question.key === "tradeResources")).toBe(false);
  });

  it("expõe prazo natural separadamente do prazo contratual ajustado", () => {
    const sections = [standardSection([
      chapter("3", "ESTRUTURA", [leaf("3.3", "Pilares", 18), leaf("3.4", "Vigas", 18)]),
      chapter("4", "ALVENARIA", [leaf("4.1", "Alvenaria", 18)]),
    ])];
    const context = buildPlanningContext(sections, 1);
    const profile = defaultSchedulePlanningProfile(context, "2026-08-10");
    const natural = buildExecutionPlan({ sections, floors: 1, startDate: profile.startDate, profile });
    const targetProfile = { ...profile, targetDurationDays: natural.durationDays + 10 };
    const adjusted = buildExecutionPlan({ sections, floors: 1, startDate: profile.startDate, profile: targetProfile });
    expect(adjusted.naturalDurationDays).toBe(natural.durationDays);
    expect(adjusted.targetDurationDays).toBe(natural.durationDays + 10);
    expect(adjusted.durationDays).toBeGreaterThanOrEqual(natural.durationDays);
  });

});
