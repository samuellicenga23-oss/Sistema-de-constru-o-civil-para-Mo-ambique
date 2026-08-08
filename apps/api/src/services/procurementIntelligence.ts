export type AgingBucketKey = "nao_vencido" | "1_30" | "31_60" | "61_90" | "mais_90" | "sem_vencimento";
export type ForecastConfidence = "alta" | "media" | "baixa";
export type ForecastSource = "pedido_pagamento" | "factura" | "factura_em_revisao" | "ordem_compra" | "necessidade_cronograma";

export type OutstandingInvoiceFact = {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  dueDate: string | null;
  issueDate: string;
  currency: string;
  outstanding: number;
};

export type AgingBucket = {
  key: AgingBucketKey;
  label: string;
  amount: number;
  count: number;
  invoices: OutstandingInvoiceFact[];
};

export type ForecastItem = {
  id: string;
  source: ForecastSource;
  confidence: ForecastConfidence;
  supplierId: string | null;
  supplierName: string | null;
  reference: string;
  amount: number;
  currency: string;
  forecastDate: string | null;
  dateBasis: string;
  projectId?: string;
  scheduleTaskId?: string | null;
  scheduleTaskName?: string | null;
};

export type WeeklyForecastBucket = {
  weekIndex: number;
  startDate: string;
  endDate: string;
  amount: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  items: ForecastItem[];
};

export type CompetitiveRfqInput = {
  rfqId: string;
  reference: string;
  awardedCost: number;
  comparableQuoteTotals: number[];
};

export type CompetitiveRfqMetric = {
  rfqId: string;
  reference: string;
  awardedCost: number;
  comparableQuoteCount: number;
  lowestComparable: number | null;
  medianComparable: number | null;
  savingsVsMedian: number | null;
  savingsVsMedianPct: number | null;
  premiumVsLowest: number | null;
  premiumVsLowestPct: number | null;
};

export type MaterialVarianceInput = {
  materialId: string;
  materialName: string;
  unit: string;
  requiredQty: number;
  baselineValue: number;
  orderedQty: number;
  orderedValue: number;
};

export type MaterialVariance = MaterialVarianceInput & {
  baselineUnitCost: number;
  baselineForOrderedQty: number;
  variance: number;
  variancePct: number | null;
  procurementCoveragePct: number;
};

export type SupplierRiskInput = {
  concentrationPct: number;
  overdueAmount: number;
  openNcrCount: number;
  completedOrders: number;
  onTimeRatePct: number | null;
};

export type SupplierRiskResult = {
  score: number;
  level: "baixo" | "medio" | "alto";
  flags: string[];
};

export type SupplierStatementEvent = {
  id: string;
  date: string;
  kind: "factura" | "nota_credito" | "pagamento" | "compromisso";
  reference: string;
  description: string;
  debit: number;
  credit: number;
  affectsBalance: boolean;
};

export type SupplierStatementRow = SupplierStatementEvent & { balance: number };

export type PaymentRequestForecastCandidate = {
  id: string;
  status: "submetido" | "aprovado";
  amount: number;
  createdAt: string | Date;
};

export type PaymentRequestForecastAllocation = PaymentRequestForecastCandidate & { allocatedAmount: number; capped: boolean };

export function allocatePaymentRequestForecast(outstanding: number, requests: PaymentRequestForecastCandidate[]): PaymentRequestForecastAllocation[] {
  let remaining = Math.max(0, outstanding);
  const ordered = [...requests].sort((a, b) => {
    const priority = (a.status === "aprovado" ? 0 : 1) - (b.status === "aprovado" ? 0 : 1);
    if (priority) return priority;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const result: PaymentRequestForecastAllocation[] = [];
  for (const request of ordered) {
    const requested = Math.max(0, request.amount);
    const allocatedAmount = Math.min(requested, remaining);
    if (allocatedAmount <= 0.005) continue;
    remaining -= allocatedAmount;
    result.push({ ...request, allocatedAmount: roundMoney(allocatedAmount), capped: allocatedAmount + 0.005 < requested });
  }
  return result;
}

const DAY_MS = 86_400_000;

function asUtcDay(value: string): number {
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(parsed)) throw new Error(`Data inválida: ${value}`);
  return parsed;
}

export function daysPastDue(dueDate: string, asOfDate: string): number {
  return Math.floor((asUtcDay(asOfDate) - asUtcDay(dueDate)) / DAY_MS);
}

export function agingKey(dueDate: string | null, asOfDate: string): AgingBucketKey {
  if (!dueDate) return "sem_vencimento";
  const days = daysPastDue(dueDate, asOfDate);
  if (days <= 0) return "nao_vencido";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "mais_90";
}

const AGING_LABELS: Record<AgingBucketKey, string> = {
  nao_vencido: "Não vencido",
  "1_30": "1–30 dias",
  "31_60": "31–60 dias",
  "61_90": "61–90 dias",
  mais_90: "> 90 dias",
  sem_vencimento: "Sem vencimento",
};

export function buildAging(invoices: OutstandingInvoiceFact[], asOfDate: string): AgingBucket[] {
  const keys: AgingBucketKey[] = ["nao_vencido", "1_30", "31_60", "61_90", "mais_90", "sem_vencimento"];
  const buckets = new Map<AgingBucketKey, AgingBucket>(keys.map((key) => [key, { key, label: AGING_LABELS[key], amount: 0, count: 0, invoices: [] }]));
  for (const invoice of invoices) {
    if (!(invoice.outstanding > 0)) continue;
    const bucket = buckets.get(agingKey(invoice.dueDate, asOfDate))!;
    bucket.amount += invoice.outstanding;
    bucket.count += 1;
    bucket.invoices.push(invoice);
  }
  for (const bucket of buckets.values()) bucket.invoices.sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"));
  return keys.map((key) => ({ ...buckets.get(key)!, amount: roundMoney(buckets.get(key)!.amount) }));
}

function mondayOf(value: string): Date {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }

export function buildWeeklyCashForecast(items: ForecastItem[], asOfDate: string, weeks = 12): { weeks: WeeklyForecastBucket[]; undated: ForecastItem[]; outsideHorizon: ForecastItem[]; totalInHorizon: number } {
  const safeWeeks = Math.max(1, Math.min(52, Math.floor(weeks)));
  const anchor = mondayOf(asOfDate);
  const buckets: WeeklyForecastBucket[] = Array.from({ length: safeWeeks }, (_, weekIndex) => {
    const start = new Date(anchor); start.setUTCDate(start.getUTCDate() + weekIndex * 7);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    return { weekIndex, startDate: isoDate(start), endDate: isoDate(end), amount: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, items: [] };
  });
  const undated: ForecastItem[] = [];
  const outsideHorizon: ForecastItem[] = [];
  const horizonEnd = asUtcDay(buckets[buckets.length - 1].endDate);
  const anchorMs = asUtcDay(buckets[0].startDate);

  for (const item of items) {
    if (!(item.amount > 0)) continue;
    if (!item.forecastDate) { undated.push(item); continue; }
    const raw = asUtcDay(item.forecastDate);
    if (raw > horizonEnd) { outsideHorizon.push(item); continue; }
    const effective = Math.max(raw, asUtcDay(asOfDate), anchorMs);
    const index = Math.min(safeWeeks - 1, Math.max(0, Math.floor((effective - anchorMs) / (7 * DAY_MS))));
    const bucket = buckets[index];
    bucket.items.push(item);
    bucket.amount += item.amount;
    if (item.confidence === "alta") bucket.highConfidence += item.amount;
    else if (item.confidence === "media") bucket.mediumConfidence += item.amount;
    else bucket.lowConfidence += item.amount;
  }
  for (const bucket of buckets) {
    bucket.amount = roundMoney(bucket.amount);
    bucket.highConfidence = roundMoney(bucket.highConfidence);
    bucket.mediumConfidence = roundMoney(bucket.mediumConfidence);
    bucket.lowConfidence = roundMoney(bucket.lowConfidence);
    bucket.items.sort((a, b) => (a.forecastDate ?? "").localeCompare(b.forecastDate ?? "") || b.amount - a.amount);
  }
  return { weeks: buckets, undated, outsideHorizon, totalInHorizon: roundMoney(buckets.reduce((sum, bucket) => sum + bucket.amount, 0)) };
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function computeCompetitiveRfqMetric(input: CompetitiveRfqInput): CompetitiveRfqMetric {
  const valid = input.comparableQuoteTotals.filter((value) => Number.isFinite(value) && value >= 0);
  const lowest = valid.length ? Math.min(...valid) : null;
  const med = median(valid);
  // Uma única proposta não é concorrência. Mantemos menor/mediana como contexto, mas só
  // calculamos "savings"/premium quando existem pelo menos duas propostas comparáveis.
  const hasCompetitiveBaseline = valid.length >= 2;
  const savings = hasCompetitiveBaseline && med != null ? roundMoney(med - input.awardedCost) : null;
  const premium = hasCompetitiveBaseline && lowest != null ? roundMoney(Math.max(0, input.awardedCost - lowest)) : null;
  return {
    rfqId: input.rfqId,
    reference: input.reference,
    awardedCost: roundMoney(input.awardedCost),
    comparableQuoteCount: valid.length,
    lowestComparable: lowest == null ? null : roundMoney(lowest),
    medianComparable: med == null ? null : roundMoney(med),
    savingsVsMedian: savings,
    savingsVsMedianPct: med && savings != null ? roundPercent((savings / med) * 100) : null,
    premiumVsLowest: premium,
    premiumVsLowestPct: lowest && premium != null ? roundPercent((premium / lowest) * 100) : null,
  };
}

export function computeMaterialVariance(input: MaterialVarianceInput): MaterialVariance {
  const baselineUnitCost = input.requiredQty > 0 ? input.baselineValue / input.requiredQty : 0;
  const baselineForOrderedQty = baselineUnitCost * Math.max(0, input.orderedQty);
  const variance = input.orderedValue - baselineForOrderedQty;
  return {
    ...input,
    baselineUnitCost: roundMoney(baselineUnitCost),
    baselineForOrderedQty: roundMoney(baselineForOrderedQty),
    variance: roundMoney(variance),
    variancePct: baselineForOrderedQty > 0 ? roundPercent((variance / baselineForOrderedQty) * 100) : null,
    procurementCoveragePct: input.requiredQty > 0 ? roundPercent(Math.min(1, Math.max(0, input.orderedQty / input.requiredQty)) * 100) : 100,
  };
}

export function computeSupplierRisk(input: SupplierRiskInput): SupplierRiskResult {
  let score = 0;
  const flags: string[] = [];
  if (input.concentrationPct >= 50) { score += 30; flags.push(`Concentração elevada (${roundPercent(input.concentrationPct)}%)`); }
  else if (input.concentrationPct >= 35) { score += 15; flags.push(`Concentração relevante (${roundPercent(input.concentrationPct)}%)`); }
  if (input.overdueAmount > 0) { score += 25; flags.push("AP vencido com este fornecedor"); }
  if (input.openNcrCount >= 3) { score += 25; flags.push(`${input.openNcrCount} não-conformidades abertas`); }
  else if (input.openNcrCount > 0) { score += 10; flags.push(`${input.openNcrCount} não-conformidade(s) aberta(s)`); }
  if (input.completedOrders >= 2 && input.onTimeRatePct != null) {
    if (input.onTimeRatePct < 60) { score += 25; flags.push(`Entrega no prazo baixa (${roundPercent(input.onTimeRatePct)}%)`); }
    else if (input.onTimeRatePct < 80) { score += 15; flags.push(`Entrega no prazo abaixo de 80% (${roundPercent(input.onTimeRatePct)}%)`); }
  }
  score = Math.min(100, score);
  return { score, level: score >= 50 ? "alto" : score >= 25 ? "medio" : "baixo", flags };
}

export function buildSupplierStatement(events: SupplierStatementEvent[]): SupplierStatementRow[] {
  let balance = 0;
  const kindOrder: Record<SupplierStatementEvent["kind"], number> = { compromisso: 0, factura: 1, nota_credito: 2, pagamento: 3 };
  return [...events]
    .sort((a, b) => a.date.localeCompare(b.date) || kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id))
    .map((event) => {
      if (event.affectsBalance) balance += event.debit - event.credit;
      return { ...event, debit: roundMoney(event.debit), credit: roundMoney(event.credit), balance: roundMoney(balance) };
    });
}

export function concentrationPct(value: number, total: number): number { return total > 0 ? roundPercent((value / total) * 100) : 0; }
export function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
export function roundPercent(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
