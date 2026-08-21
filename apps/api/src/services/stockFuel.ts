export type StockBalanceRow = {
  materialId: string;
  materialName: string;
  unit: string;
  skuType: "standard" | "combustivel";
  minStockQty: number | null;
  balance: number;
};

export function computeStockBalances(
  rows: Array<{ materialId: string; materialName: string; unit: string; skuType: "standard" | "combustivel"; minStockQty: string | null; type: "entrada" | "saida"; quantity: string }>,
): StockBalanceRow[] {
  const map = new Map<string, StockBalanceRow>();
  for (const row of rows) {
    const item = map.get(row.materialId) ?? {
      materialId: row.materialId,
      materialName: row.materialName,
      unit: row.unit,
      skuType: row.skuType,
      minStockQty: row.minStockQty != null ? Number(row.minStockQty) : null,
      balance: 0,
    };
    item.balance += row.type === "entrada" ? Number(row.quantity) : -Number(row.quantity);
    map.set(row.materialId, item);
  }
  return Array.from(map.values());
}

export function fuelLowStockAlerts(balances: StockBalanceRow[]) {
  return balances
    .filter((item) => item.skuType === "combustivel" && item.minStockQty != null && item.balance <= item.minStockQty + 0.0001)
    .map((item) => ({
      code: "fuel_low_stock" as const,
      level: "warning" as const,
      title: "Combustível abaixo do mínimo",
      detail: `${item.materialName}: ${item.balance.toFixed(1)} ${item.unit} (mín. ${item.minStockQty!.toFixed(1)}).`,
      materialId: item.materialId,
    }));
}
