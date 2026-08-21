import { describe, expect, it } from "vitest";
import { computeStockBalances, fuelLowStockAlerts } from "../src/services/stockFuel.js";

describe("stock combustível", () => {
  it("alerta quando SKU combustível está abaixo do mínimo", () => {
    const balances = computeStockBalances([
      { materialId: "m1", materialName: "Gasóleo", unit: "l", skuType: "combustivel", minStockQty: "500", type: "entrada", quantity: "400" },
    ]);
    const alerts = fuelLowStockAlerts(balances);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.code).toBe("fuel_low_stock");
  });

  it("ignora materiais standard sem mínimo", () => {
    const balances = computeStockBalances([
      { materialId: "m2", materialName: "Cimento", unit: "un", skuType: "standard", minStockQty: null, type: "entrada", quantity: "10" },
    ]);
    expect(fuelLowStockAlerts(balances)).toEqual([]);
  });
});
