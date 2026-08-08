import { describe, expect, it } from "vitest";
import { validateMeasuredQuantity } from "../src/services/measurementEngine.js";
import { addWorkingDays, computeItemDurationDays, computeNodeDurations } from "../src/services/scheduleEngine.js";
import type { LineItemNode } from "../src/services/boqEngine.js";
import { resolveSchedulePrintOptions } from "../src/services/schedulePdf.js";
import { calculateProcurementQuantity, rankProcurementQuotes } from "../src/services/procurementEngine.js";
import { calculateVatTotals, DEFAULT_IVA_RATE, priceExcludingVat } from "@sigo/shared";
import { documentLockedMessage, evaluateDocumentReadiness } from "../src/services/documentRules.js";

describe("Regras de aprovação de documentos", () => {
  it("não permite submeter uma medição vazia", () => {
    const result = evaluateDocumentReadiness("medicao", [
      { kind: "item", description: "Escavação", unit: "m3", quantity: 0, unitPrice: null },
    ]);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/quantidade/i);
  });

  it("exige unidade e preço apenas nos itens realmente medidos do orçamento", () => {
    const result = evaluateDocumentReadiness("orcamento", [
      { kind: "item", description: "Aplicável", unit: null, quantity: 10, unitPrice: 0 },
      { kind: "item", description: "Não aplicável", unit: null, quantity: 0, unitPrice: null },
    ]);
    expect(result).toMatchObject({ ready: false, measuredItems: 1, missingUnit: 1, missingPrice: 1 });
  });

  it("aceita um orçamento medido, com unidade e preço positivo", () => {
    expect(evaluateDocumentReadiness("orcamento", [
      { kind: "item", description: "Betão B25", unit: "m3", quantity: 12.5, unitPrice: 9_850 },
    ]).ready).toBe(true);
  });

  it("explica por que documentos fora do rascunho estão protegidos", () => {
    expect(documentLockedMessage("aprovado")).toMatch(/nova revisão/i);
    expect(documentLockedMessage("submetido")).toMatch(/rascunho/i);
  });
});

describe("Regras dos Autos de Medição", () => {
  it("calcula o acumulado a partir do período actual", () => {
    expect(validateMeasuredQuantity({ previousQty: 12.5, periodQty: 3.25, budgetedQty: 20 })).toEqual({ cumulativeQty: 15.75, overrunQty: 0 });
  });

  it("bloqueia excedentes sem justificação e permite trabalhos adicionais justificados", () => {
    expect(() => validateMeasuredQuantity({ previousQty: 9, periodQty: 2, budgetedQty: 10 })).toThrow(/justificação/i);
    expect(validateMeasuredQuantity({ previousQty: 9, periodQty: 2, budgetedQty: 10, overrunReason: "Trabalho adicional aprovado" })).toEqual({ cumulativeQty: 11, overrunQty: 1 });
  });
});

function itemNode(overrides: Partial<LineItemNode> = {}): LineItemNode {
  return {
    id: "item-1", sectionId: "sec-1", parentId: "cap-1", kind: "item", code: "01.001",
    description: "Item de teste", unit: "m3", quantity: 1, unitPrice: 0, sellingUnitPrice: 0,
    compositionId: null, origin: "manual", sortOrder: 0, totalPrice: 0, sellingTotalPrice: 0,
    children: [], ...overrides,
  };
}

describe("Regras do Cronograma", () => {
  it("usa calendário de obra de segunda a sábado", () => {
    expect(addWorkingDays("2026-07-25", 1)).toBe("2026-07-27"); // sábado + 1 dia útil = segunda
  });

  it("calcula a duração de um pacote de trabalho a partir das suas próprias horas, não de uma fatia de um total maior", () => {
    const hoursCache = new Map([["comp-1", 8]]); // 8 h/m3
    const small = itemNode({ compositionId: "comp-1", quantity: 5 }); // 40 h / equipa disponível na frente
    const large = itemNode({ compositionId: "comp-1", quantity: 200 }); // 1600 h / equipa disponível na frente
    const smallResult = computeItemDurationDays(small, hoursCache);
    const largeResult = computeItemDurationDays(large, hoursCache);
    expect(smallResult.basis).toBe("horas");
    expect(largeResult.days).toBeGreaterThan(smallResult.days);
  });

  it("cai para uma estimativa por valor quando o item não tem composição, e para o mínimo quando não há dados", () => {
    const withValue = computeItemDurationDays(itemNode({ compositionId: null, totalPrice: 24_000 }), new Map());
    expect(withValue.basis).toBe("valor");
    expect(withValue.days).toBeGreaterThanOrEqual(1);

    const withNothing = computeItemDurationDays(itemNode({ compositionId: null, totalPrice: 0 }), new Map());
    expect(withNothing).toEqual({ days: 1, basis: "minimo" });
  });

  it("soma as subactividades para obter a duração do capítulo — nunca reparte um total pré-calculado", () => {
    const hoursCache = new Map([["comp-1", 8]]);
    const chapter: LineItemNode = {
      ...itemNode({ id: "cap-1", kind: "capitulo", parentId: null, quantity: null }),
      children: [
        itemNode({ id: "item-1", compositionId: "comp-1", quantity: 40 }),
        itemNode({ id: "item-2", compositionId: "comp-1", quantity: 80 }),
      ],
    };
    const scheduled = computeNodeDurations(chapter, hoursCache)!;
    const childSum = scheduled.children.reduce((sum, child) => sum + child.durationDays, 0);
    expect(scheduled.durationDays).toBe(childSum);
    expect(scheduled.basis).toBe("soma");
  });

  it("ignora notas ao calcular a WBS", () => {
    const note = itemNode({ id: "nota-1", kind: "nota" });
    expect(computeNodeDurations(note, new Map())).toBeNull();
  });

  it("escolhe a folha pela densidade e respeita uma folha manual com ajuste de escala", () => {
    const compact = resolveSchedulePrintOptions({ tasks: Array(20), startDate: "2026-01-01", endDate: "2026-10-01" });
    const complex = resolveSchedulePrintOptions({ tasks: Array(90), startDate: "2026-01-01", endDate: "2028-06-01" });
    const forcedA3 = resolveSchedulePrintOptions({ tasks: Array(90), startDate: "2026-01-01", endDate: "2028-06-01" }, { paper: "A3", scale: "fit" });

    expect(compact.paper).toBe("A3");
    expect(complex.paper).toBe("A1");
    expect(forcedA3.paper).toBe("A3");
    expect(forcedA3.scalePercent).toBeLessThan(100);
  });
});

describe("Regras de Aprovisionamento", () => {
  it("não volta a comprar o material já consumido e arredonda à embalagem comercial", () => {
    expect(calculateProcurementQuantity({ requiredQty: 100, consumedQty: 20, stockQty: 30, orderedQty: 10, packageSize: 25 })).toEqual({ shortageQty: 40, suggestedOrderQty: 50 });
  });

  it("aplica IVA de 16% e separa subtotal, imposto e total", () => {
    expect(DEFAULT_IVA_RATE).toBe(0.16);
    expect(calculateVatTotals(100_000)).toEqual({ subtotal: 100_000, ivaRate: 0.16, iva: 16_000, total: 116_000 });
    expect(priceExcludingVat(116_000, true)).toBe(100_000);
    expect(priceExcludingVat(100_000, false)).toBe(100_000);
  });

  it("permite que o preço SIGO forme a cotação quando é o menor aplicável", () => {
    const ranked = rankProcurementQuotes([
      { supplier: "Fornecedor comercial", zoneId: null, unitCost: 120 },
      { supplier: "SIGO Preços", zoneId: null, unitCost: 100 },
    ], null);
    expect(ranked[0]).toMatchObject({ supplier: "SIGO Preços", unitCost: 100 });
  });

  it("prioriza a cotação da zona antes do menor preço geral", () => {
    const ranked = rankProcurementQuotes([
      { supplier: "SIGO Preços", zoneId: null, unitCost: 90 },
      { supplier: "Fornecedor da zona", zoneId: "zona-maputo", unitCost: 110 },
    ], "zona-maputo");
    expect(ranked[0]).toMatchObject({ supplier: "Fornecedor da zona", zoneId: "zona-maputo" });
  });
});
