export type PurchaseOrderForecastLineInput = {
  quantity: number | string;
  unitCost: number | string;
};

export type PurchaseOrderForecastHeaderInput = {
  transportCost?: number | string | null;
  ivaRate?: number | string | null;
};

export function roundForecastMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateOutstandingBalance(total: number, credits = 0, paid = 0): number {
  return roundForecastMoney(Math.max(0, total - Math.max(0, credits) - Math.max(0, paid)));
}

export function calculatePurchaseOrderForecastTotal(
  order: PurchaseOrderForecastHeaderInput,
  lines: PurchaseOrderForecastLineInput[],
): number {
  const lineSubtotal = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unitCost);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return sum;
    return sum + Math.max(0, quantity) * Math.max(0, unitCost);
  }, 0);
  const transport = Math.max(0, Number(order.transportCost ?? 0) || 0);
  const ivaRate = Math.max(0, Number(order.ivaRate ?? 0) || 0);
  return roundForecastMoney((lineSubtotal + transport) * (1 + ivaRate));
}

export function calculateRemainingCommitment(committedTotal: number, alreadyInvoiced: number): number {
  return roundForecastMoney(Math.max(0, committedTotal - Math.max(0, alreadyInvoiced)));
}
