export type RequisitionStatus =
  | "rascunho"
  | "submetida"
  | "aprovada"
  | "em_cotacao"
  | "adjudicada"
  | "comprada"
  | "fechada"
  | "cancelada";

export type ProcurementRfqStatus = "rascunho" | "aberta" | "em_avaliacao" | "adjudicada" | "cancelada" | "expirada";
export type ProcurementInvitationStatus = "convidado" | "visualizado" | "respondido" | "recusado" | "expirado";
export type SupplierQuoteStatus = "rascunho" | "submetida" | "substituida" | "retirada";

export type RfqLineSnapshot = {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
};

export type SupplierQuoteLineSnapshot = {
  rfqLineId: string;
  quantityOffered: number;
  unitCost: number;
  discountPct?: number | null;
  leadTimeDays?: number | null;
  available?: boolean;
};

export type SupplierQuoteSnapshot = {
  id: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  transportCost: number;
  transportIncluded: boolean;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  validUntil: string | null;
  status: SupplierQuoteStatus;
  version: number;
  lines: SupplierQuoteLineSnapshot[];
};

export type QuoteComparisonRow = {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  subtotal: number;
  transportCost: number;
  total: number;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  validUntil: string | null;
  lineCoveragePct: number;
  quantityCoveragePct: number;
  isCheapest: boolean;
  isFastest: boolean;
  isExpired: boolean;
};

export type AwardAllocation = {
  rfqLineId: string;
  quoteId: string;
  supplierId: string;
  quantityAwarded: number;
  unitCost: number;
};

const REQUISITION_TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  rascunho: ["submetida", "cancelada"],
  submetida: ["aprovada", "rascunho", "cancelada"],
  aprovada: ["em_cotacao", "cancelada"],
  em_cotacao: ["adjudicada", "cancelada"],
  adjudicada: ["comprada", "cancelada"],
  comprada: ["fechada"],
  fechada: [],
  cancelada: [],
};

const RFQ_TRANSITIONS: Record<ProcurementRfqStatus, ProcurementRfqStatus[]> = {
  rascunho: ["aberta", "cancelada"],
  aberta: ["em_avaliacao", "cancelada", "expirada"],
  em_avaliacao: ["adjudicada", "aberta", "cancelada", "expirada"],
  adjudicada: [],
  cancelada: [],
  expirada: [],
};

export function assertRequisitionTransition(from: RequisitionStatus, to: RequisitionStatus): void {
  if (from === to) return;
  if (!REQUISITION_TRANSITIONS[from].includes(to)) {
    throw new Error(`A requisição ${from} não pode passar para ${to}`);
  }
}

export function assertRfqTransition(from: ProcurementRfqStatus, to: ProcurementRfqStatus): void {
  if (from === to) return;
  if (!RFQ_TRANSITIONS[from].includes(to)) {
    throw new Error(`A RFQ ${from} não pode passar para ${to}`);
  }
}

export function quoteLineNetUnitCost(line: SupplierQuoteLineSnapshot): number {
  const discount = Math.min(100, Math.max(0, Number(line.discountPct ?? 0)));
  return roundMoney(line.unitCost * (1 - discount / 100));
}

export function quoteSubtotal(lines: SupplierQuoteLineSnapshot[]): number {
  return roundMoney(
    lines
      .filter((line) => line.available !== false)
      .reduce((sum, line) => sum + line.quantityOffered * quoteLineNetUnitCost(line), 0),
  );
}

export function quoteTotal(quote: SupplierQuoteSnapshot): number {
  const subtotal = quoteSubtotal(quote.lines);
  return roundMoney(subtotal + Math.max(0, quote.transportIncluded ? 0 : quote.transportCost));
}

export function buildQuoteComparison(
  rfqLines: RfqLineSnapshot[],
  quotes: SupplierQuoteSnapshot[],
  currency: string,
  asOfDate?: string,
): QuoteComparisonRow[] {
  const submitted = quotes.filter((quote) => quote.status === "submetida" && quote.currency === currency);
  if (!submitted.length) return [];

  const byLine = new Map(rfqLines.map((line) => [line.id, line]));
  const rows = submitted.map((quote) => {
    const validLines = quote.lines.filter((line) => byLine.has(line.rfqLineId) && line.available !== false);
    const coveredLineIds = new Set(validLines.filter((line) => line.quantityOffered > 0).map((line) => line.rfqLineId));
    const requestedQty = rfqLines.reduce((sum, line) => sum + Math.max(0, line.quantity), 0);
    const offeredQty = validLines.reduce((sum, line) => {
      const requested = byLine.get(line.rfqLineId)?.quantity ?? 0;
      return sum + Math.min(Math.max(0, line.quantityOffered), Math.max(0, requested));
    }, 0);

    const subtotal = quoteSubtotal(validLines);
    const transportCost = quote.transportIncluded ? 0 : Math.max(0, quote.transportCost);
    return {
      quoteId: quote.id,
      supplierId: quote.supplierId,
      supplierName: quote.supplierName,
      currency: quote.currency,
      subtotal,
      transportCost: roundMoney(transportCost),
      total: roundMoney(subtotal + transportCost),
      leadTimeDays: quote.leadTimeDays,
      paymentTerms: quote.paymentTerms,
      validUntil: quote.validUntil,
      lineCoveragePct: rfqLines.length ? roundPercent((coveredLineIds.size / rfqLines.length) * 100) : 100,
      quantityCoveragePct: requestedQty > 0 ? roundPercent((offeredQty / requestedQty) * 100) : 100,
      isCheapest: false,
      isFastest: false,
      isExpired: Boolean(asOfDate && quote.validUntil && quote.validUntil < asOfDate),
    } satisfies QuoteComparisonRow;
  });

  const eligibleCost = rows.filter((row) => !row.isExpired && row.quantityCoveragePct >= 99.999 && row.lineCoveragePct >= 99.999);
  const cheapest = eligibleCost.length ? Math.min(...eligibleCost.map((row) => row.total)) : null;
  const timed = rows.filter((row) => !row.isExpired && row.leadTimeDays != null);
  const fastest = timed.length ? Math.min(...timed.map((row) => row.leadTimeDays as number)) : null;

  return rows
    .map((row) => ({
      ...row,
      isCheapest: cheapest != null && Math.abs(row.total - cheapest) < 0.005,
      isFastest: fastest != null && row.leadTimeDays === fastest,
    }))
    .sort((a, b) => {
      const aFull = a.quantityCoveragePct >= 99.999 && a.lineCoveragePct >= 99.999 ? 0 : 1;
      const bFull = b.quantityCoveragePct >= 99.999 && b.lineCoveragePct >= 99.999 ? 0 : 1;
      return aFull - bFull || a.total - b.total || (a.leadTimeDays ?? 999999) - (b.leadTimeDays ?? 999999);
    });
}

export function validateAwardAllocations(
  rfqLines: RfqLineSnapshot[],
  quotes: SupplierQuoteSnapshot[],
  allocations: AwardAllocation[],
  allowPartialAward: boolean,
  awardDate?: string,
): { complete: boolean; awardedByLine: Record<string, number>; supplierIds: string[] } {
  if (!allocations.length) throw new Error("Seleccione pelo menos uma linha para adjudicar");
  const lineById = new Map(rfqLines.map((line) => [line.id, line]));
  const quoteById = new Map(quotes.filter((quote) => quote.status === "submetida").map((quote) => [quote.id, quote]));
  const awardedByLine: Record<string, number> = {};
  const supplierIds = new Set<string>();
  const allocationKeys = new Set<string>();

  for (const allocation of allocations) {
    const allocationKey = `${allocation.quoteId}:${allocation.rfqLineId}`;
    if (allocationKeys.has(allocationKey)) throw new Error("Agrupe a mesma proposta/material numa única alocação");
    allocationKeys.add(allocationKey);
    const rfqLine = lineById.get(allocation.rfqLineId);
    if (!rfqLine) throw new Error("A adjudicação contém uma linha que não pertence à RFQ");
    const quote = quoteById.get(allocation.quoteId);
    if (!quote) throw new Error("A adjudicação aponta para uma proposta inexistente ou não submetida");
    if (awardDate && quote.validUntil && quote.validUntil < awardDate) throw new Error(`A proposta de ${quote.supplierName} expirou em ${quote.validUntil}`);
    if (quote.supplierId !== allocation.supplierId) throw new Error("Fornecedor e proposta não correspondem");
    const quoteLine = quote.lines.find((line) => line.rfqLineId === allocation.rfqLineId && line.available !== false);
    if (!quoteLine) throw new Error(`O fornecedor ${quote.supplierName} não cotou uma das linhas adjudicadas`);
    if (!(allocation.quantityAwarded > 0)) throw new Error("A quantidade adjudicada deve ser positiva");
    if (allocation.quantityAwarded > quoteLine.quantityOffered + 0.0001) {
      throw new Error(`Quantidade adjudicada excede a quantidade oferecida por ${quote.supplierName}`);
    }
    const quotedNet = quoteLineNetUnitCost(quoteLine);
    if (Math.abs(allocation.unitCost - quotedNet) > 0.01) {
      throw new Error(`O preço adjudicado não corresponde à proposta submetida por ${quote.supplierName}`);
    }
    awardedByLine[allocation.rfqLineId] = (awardedByLine[allocation.rfqLineId] ?? 0) + allocation.quantityAwarded;
    if (awardedByLine[allocation.rfqLineId] > rfqLine.quantity + 0.0001) {
      throw new Error(`A soma adjudicada de ${rfqLine.description} excede a quantidade solicitada`);
    }
    supplierIds.add(allocation.supplierId);
  }

  const complete = rfqLines.every((line) => Math.abs((awardedByLine[line.id] ?? 0) - line.quantity) <= 0.0001);
  if (!complete) {
    throw new Error("A adjudicação final tem de cobrir 100% das quantidades da RFQ");
  }
  if (!allowPartialAward) {
    if (supplierIds.size !== 1) throw new Error("Esta RFQ não permite repartir a adjudicação entre fornecedores");
    for (const line of rfqLines) {
      const allocationsForLine = allocations.filter((allocation) => allocation.rfqLineId === line.id);
      if (allocationsForLine.length !== 1) throw new Error("Esta RFQ exige uma única adjudicação por item");
    }
  }
  return { complete, awardedByLine, supplierIds: [...supplierIds] };
}

export function groupAllocationsBySupplier(allocations: AwardAllocation[]): Map<string, AwardAllocation[]> {
  const groups = new Map<string, AwardAllocation[]>();
  for (const allocation of allocations) {
    const list = groups.get(allocation.supplierId) ?? [];
    list.push(allocation);
    groups.set(allocation.supplierId, list);
  }
  return groups;
}

export function requiresDecisionReason(
  comparison: QuoteComparisonRow[],
  selectedSupplierIds: string[],
): boolean {
  if (!selectedSupplierIds.length) return true;
  const cheapestIds = new Set(comparison.filter((row) => row.isCheapest).map((row) => row.supplierId));
  if (!cheapestIds.size) return true;
  return selectedSupplierIds.some((id) => !cheapestIds.has(id)) || selectedSupplierIds.length > 1;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
