export type FieldMeasurementPartial = { partial: number };

export type FieldPeriodValidation = {
  periodQty: number;
  cumulativeQty: number;
  excessQty: number;
  requiresOverrunReason: boolean;
};

/**
 * Consolida a memória de campo de um item do Auto.
 * As linhas já chegam com o sinal incorporado no `partial` (+ adição / - dedução).
 * Não permite um período líquido negativo e exige justificação para ultrapassar o contratado.
 */
export function computeFieldPeriodTotals(args: {
  previousQty: number;
  partials: FieldMeasurementPartial[];
  budgetedQty: number | null;
  overrunReason?: string | null;
}): FieldPeriodValidation {
  if (!Number.isFinite(args.previousQty) || args.previousQty < 0) {
    throw new Error("O acumulado anterior da medição é inválido");
  }
  const periodQty = args.partials.reduce((sum, row) => {
    if (!Number.isFinite(row.partial)) throw new Error("Uma medição de campo tem parcial inválido");
    return sum + row.partial;
  }, 0);
  if (periodQty < -0.000001) {
    throw new Error("As deduções excedem as quantidades positivas deste item no período");
  }
  const normalizedPeriod = Math.abs(periodQty) < 0.000001 ? 0 : periodQty;
  const cumulativeQty = args.previousQty + normalizedPeriod;
  const excessQty = args.budgetedQty === null ? 0 : Math.max(0, cumulativeQty - args.budgetedQty);
  const requiresOverrunReason = excessQty > 0.0001;
  if (requiresOverrunReason && !args.overrunReason?.trim()) {
    throw new Error(`A medição excede o contratado em ${excessQty.toFixed(4)}; justifique o trabalho adicional`);
  }
  return { periodQty: normalizedPeriod, cumulativeQty, excessQty, requiresOverrunReason };
}
