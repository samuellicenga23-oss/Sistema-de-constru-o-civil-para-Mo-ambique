import { describe, expect, it } from "vitest";
import { validateMeasuredQuantity } from "../src/services/measurementEngine.js";
import { addWorkingDays, allocateDurations, allocateDurationsWithMinimums } from "../src/services/scheduleEngine.js";
import { resolveSchedulePrintOptions } from "../src/services/schedulePdf.js";
import { calculateProcurementQuantity } from "../src/services/procurementEngine.js";
import { calculateVatTotals, DEFAULT_IVA_RATE, priceExcludingVat } from "@sigo/shared";

describe("Regras dos Autos de Medição", () => {
  it("calcula o acumulado a partir do período actual", () => {
    expect(validateMeasuredQuantity({ previousQty: 12.5, periodQty: 3.25, budgetedQty: 20 })).toEqual({ cumulativeQty: 15.75, overrunQty: 0 });
  });

  it("bloqueia excedentes sem justificação e permite trabalhos adicionais justificados", () => {
    expect(() => validateMeasuredQuantity({ previousQty: 9, periodQty: 2, budgetedQty: 10 })).toThrow(/justificação/i);
    expect(validateMeasuredQuantity({ previousQty: 9, periodQty: 2, budgetedQty: 10, overrunReason: "Trabalho adicional aprovado" })).toEqual({ cumulativeQty: 11, overrunQty: 1 });
  });
});

describe("Regras do Cronograma", () => {
  it("distribui exactamente o prazo total mesmo quando os capítulos não têm valor", () => {
    const durations = allocateDurations([0, 0, 0], 30);
    expect(durations).toHaveLength(3);
    expect(durations.reduce((sum, value) => sum + value, 0)).toBe(30);
    expect(durations.every((value) => value >= 3)).toBe(true);
  });

  it("usa calendário de obra de segunda a sábado", () => {
    expect(addWorkingDays("2026-07-25", 1)).toBe("2026-07-27"); // sábado + 1 dia útil = segunda
  });

  it("reserva duração suficiente para todas as subactividades da WBS", () => {
    const durations = allocateDurationsWithMinimums([70, 30], 12, [8, 2]);
    expect(durations.reduce((sum, value) => sum + value, 0)).toBe(12);
    expect(durations[0]).toBeGreaterThanOrEqual(8);
    expect(durations[1]).toBeGreaterThanOrEqual(2);
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
});
