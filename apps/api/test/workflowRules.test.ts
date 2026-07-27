import { describe, expect, it } from "vitest";
import { validateMeasuredQuantity } from "../src/services/measurementEngine.js";
import { addWorkingDays, allocateDurations, allocateDurationsWithMinimums } from "../src/services/scheduleEngine.js";
import { calculateProcurementQuantity } from "../src/services/procurementEngine.js";

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
});

describe("Regras de Aprovisionamento", () => {
  it("não volta a comprar o material já consumido e arredonda à embalagem comercial", () => {
    expect(calculateProcurementQuantity({ requiredQty: 100, consumedQty: 20, stockQty: 30, orderedQty: 10, packageSize: 25 })).toEqual({ shortageQty: 40, suggestedOrderQty: 50 });
  });
});
