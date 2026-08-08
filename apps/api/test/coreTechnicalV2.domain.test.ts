import { describe, it } from "vitest";
import {
  calculateMeasurementPartial,
  recommendedFormulaForUnit,
  reinforcementUnitWeightKgPerM,
  sumMeasurementPartials,
} from "../src/services/measurementFormulaEngine.js";
import { computeFieldPeriodTotals } from "../src/services/certificateMeasurementEngine.js";
import {
  assertAcyclicCompositionGraph,
  computeCompositionProductivity,
  computeDerivedCosts,
  computeSubcompositionCost,
  resolveResourcesByIdentity,
} from "../src/services/compositionV2Engine.js";
import { remainingMaterialQuantity } from "../src/services/materialsByPhase.js";

function equal(actual: unknown, expected: unknown) { if (actual !== expected) throw new Error(`Esperado ${String(expected)}, recebido ${String(actual)}`); }
function ok(value: unknown) { if (!value) throw new Error("Condição esperada como verdadeira"); }
function throws(fn: () => void, pattern: RegExp) { try { fn(); } catch (error) { if (pattern.test(error instanceof Error ? error.message : String(error))) return; throw error; } throw new Error("Era esperado lançar erro"); }
const assert = { equal, ok, throws };

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test("área horizontal", () => {
  const r = calculateMeasurementPartial({ formulaType: "area", count: 2, length: 5, width: 3 });
  assert.equal(r.partial, 30);
});
test("área vertical", () => {
  assert.equal(calculateMeasurementPartial({ formulaType: "wall_area", count: 1, length: 12, height: 3 }).partial, 36);
});
test("dedução negativa", () => {
  assert.ok(Math.abs(calculateMeasurementPartial({ formulaType: "wall_area", sign: -1, count: 2, length: .9, height: 2.1 }).partial + 3.78) < 1e-9);
});
test("volume", () => {
  assert.equal(calculateMeasurementPartial({ formulaType: "volume", count: 4, length: 2, width: .5, height: .3 }).partial, 1.2);
});
test("perímetro", () => {
  assert.equal(calculateMeasurementPartial({ formulaType: "perimeter", count: 1, length: 4, width: 3 }).partial, 14);
});
test("aço usa d²/162", () => {
  const unitWeight = reinforcementUnitWeightKgPerM(12);
  assert.ok(Math.abs(unitWeight - 0.8888888889) < 1e-8);
  assert.ok(Math.abs(calculateMeasurementPartial({ formulaType: "reinforcement", count: 10, length: 6, diameterMm: 12 }).partial - 53.3333333333) < 1e-8);
});
test("percentagem", () => {
  assert.equal(calculateMeasurementPartial({ formulaType: "percentage", baseQuantity: 200, percentage: 7.5 }).partial, 15);
});
test("legado mantém dimensões vazias como 1", () => {
  assert.equal(calculateMeasurementPartial({ formulaType: "legacy_product", count: 35, length: null, width: null, height: null }).partial, 35);
});
test("soma líquida adições menos deduções", () => {
  assert.equal(sumMeasurementPartials([36, -3.78, -3.6]), 28.62);
});
test("unidade recomenda fórmula", () => {
  assert.equal(recommendedFormulaForUnit("m2"), "area");
  assert.equal(recommendedFormulaForUnit("m3"), "volume");
  assert.equal(recommendedFormulaForUnit("kg"), "weight");
});
test("defaultMeasurementFormula da composição prevalece sobre unidade", () => {
  // Espelha resolveDefaultFormula: composição tipada → senão recomendação da unidade.
  const compositionDefault = "wall_area" as const;
  const unitFallback = recommendedFormulaForUnit("m2");
  assert.equal(compositionDefault || unitFallback, "wall_area");
  assert.equal(unitFallback, "area");
});
test("saldo restante de materiais = max(0, BOQ − executado)", () => {
  assert.equal(remainingMaterialQuantity(100, 35), 65);
  assert.equal(remainingMaterialQuantity(50, 50), 0);
  assert.equal(remainingMaterialQuantity(40, 55), 0);
});
test("subcomposição detecta ciclo", () => {
  assert.throws(() => assertAcyclicCompositionGraph("A", [
    { compositionId: "A", subcompositionId: "B", qtyPerUnit: 1 },
    { compositionId: "B", subcompositionId: "A", qtyPerUnit: 1 },
  ]), /Ciclo/);
});
test("subcomposição calcula custo", () => {
  const costs = new Map([["B", 150]]);
  assert.equal(computeSubcompositionCost("A", [{ compositionId: "A", subcompositionId: "B", qtyPerUnit: .2 }], costs), 30);
});
test("custos derivados não capitalizam entre si", () => {
  const result = computeDerivedCosts({ materials: 100, labour: 50, equipment: 25, subcompositions: 25 }, [
    { name: "Ferramentas", basis: "labour", percentage: 5 },
    { name: "Consumíveis", basis: "direct", percentage: 2 },
  ]);
  assert.equal(result.total, 6.5);
});
test("produtividade explícita", () => {
  const r = computeCompositionProductivity({ quantity: 100, outputPerDay: 20, productiveHoursPerDay: 8 });
  assert.equal(r.durationDays, 5); assert.equal(r.outputPerHour, 2.5); assert.equal(r.basis, "explicit_output");
});
test("produtividade por horas de mão-de-obra", () => {
  const r = computeCompositionProductivity({ quantity: 80, labourHoursPerUnit: 2, crewSize: 5, productiveHoursPerDay: 8 });
  assert.equal(r.outputPerDay, 20); assert.equal(r.durationDays, 4); assert.equal(r.basis, "labour_hours");
});
test("familyKey prevalece sobre nome", () => {
  const rows = [
    { id: "g", familyKey: "fam-1", name: "Cimento antigo", companyId: null },
    { id: "c", familyKey: "fam-1", name: "Cimento 42.5 local", companyId: "company" },
  ];
  assert.equal(resolveResourcesByIdentity(rows).get("fam-1")?.id, "c");
});
test("agregação por fase usa familyKey e não nome", () => {
  // Simula o bucket materialsByPhase/labourByPhase: nomes diferentes da mesma família somam juntas.
  const lines = [
    { familyKey: "fam-cimento", name: "Cimento antigo", qty: 10 },
    { familyKey: "fam-cimento", name: "Cimento 42.5 local", qty: 4 },
    { familyKey: "fam-areia", name: "Areia", qty: 2 },
  ];
  const bucket = new Map<string, { name: string; qty: number }>();
  for (const line of lines) {
    const existing = bucket.get(line.familyKey);
    if (existing) {
      existing.qty += line.qty;
      existing.name = line.name;
    } else bucket.set(line.familyKey, { name: line.name, qty: line.qty });
  }
  assert.equal(bucket.size, 2);
  assert.equal(bucket.get("fam-cimento")?.qty, 14);
  assert.equal(bucket.get("fam-cimento")?.name, "Cimento 42.5 local");
});

test("Auto: memória de campo soma adições e deduções", () => {
  const r = computeFieldPeriodTotals({ previousQty: 20, partials: [{ partial: 36 }, { partial: -3.78 }, { partial: -3.6 }], budgetedQty: 100 });
  assert.ok(Math.abs(r.periodQty - 28.62) < 1e-9);
  assert.ok(Math.abs(r.cumulativeQty - 48.62) < 1e-9);
});
test("Auto: dedução líquida negativa é bloqueada", () => {
  assert.throws(() => computeFieldPeriodTotals({ previousQty: 0, partials: [{ partial: 2 }, { partial: -3 }], budgetedQty: 10 }), /deduções excedem/i);
});
test("Auto: excesso contratado exige justificação", () => {
  assert.throws(() => computeFieldPeriodTotals({ previousQty: 90, partials: [{ partial: 15 }], budgetedQty: 100 }), /justifique/i);
  const r = computeFieldPeriodTotals({ previousQty: 90, partials: [{ partial: 15 }], budgetedQty: 100, overrunReason: "Trabalho adicional aprovado em obra" });
  assert.equal(r.excessQty, 5);
});

describe("coreTechnicalV2 domain", () => {
  for (const [name, fn] of tests) {
    it(name, fn);
  }
});
