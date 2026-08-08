export type PurchaseOrderMatchLine = {
  id: string;
  materialId: string;
  description?: string;
  orderedQty: number;
  unitCost: number;
  currency: string;
};

export type SupplierInvoiceMatchLine = {
  purchaseOrderLineId: string;
  quantity: number;
  unitCost: number;
};

export type InvoiceLineMatch = {
  purchaseOrderLineId: string;
  orderedQty: number;
  acceptedQty: number;
  previouslyInvoicedQty: number;
  availableToInvoiceQty: number;
  invoicedQty: number;
  poUnitCost: number;
  invoiceUnitCost: number;
  quantityStatus: "ok" | "excede_recebido" | "excede_oc" | "linha_desconhecida";
  priceStatus: "ok" | "divergente" | "linha_desconhecida";
  hardBlock: boolean;
  variance: boolean;
};

export type ThreeWayMatchInput = {
  poLines: PurchaseOrderMatchLine[];
  acceptedQtyByLine: Record<string, number>;
  previouslyInvoicedQtyByLine?: Record<string, number>;
  invoiceLines: SupplierInvoiceMatchLine[];
  poTransportCost: number;
  previouslyInvoicedTransport?: number;
  invoiceTransportCost: number;
  poIvaRate: number;
  invoiceIvaRate: number;
};

export type ThreeWayMatchResult = {
  lineMatches: InvoiceLineMatch[];
  hardBlocks: string[];
  softVariances: string[];
  exactMatch: boolean;
  canApprove: boolean;
  canApproveWithVariance: boolean;
  subtotal: number;
  transport: number;
  taxableBase: number;
  vatAmount: number;
  total: number;
};

const QTY_EPSILON = 0.0001;
const MONEY_EPSILON = 0.005;
const RATE_EPSILON = 0.000001;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeThreeWayMatch(input: ThreeWayMatchInput): ThreeWayMatchResult {
  const poById = new Map(input.poLines.map((line) => [line.id, line]));
  const hardBlocks: string[] = [];
  const softVariances: string[] = [];
  const lineMatches: InvoiceLineMatch[] = [];

  for (const invoiceLine of input.invoiceLines) {
    const poLine = poById.get(invoiceLine.purchaseOrderLineId);
    if (!poLine) {
      hardBlocks.push(`Linha de OC desconhecida: ${invoiceLine.purchaseOrderLineId}`);
      lineMatches.push({
        purchaseOrderLineId: invoiceLine.purchaseOrderLineId,
        orderedQty: 0,
        acceptedQty: 0,
        previouslyInvoicedQty: 0,
        availableToInvoiceQty: 0,
        invoicedQty: invoiceLine.quantity,
        poUnitCost: 0,
        invoiceUnitCost: invoiceLine.unitCost,
        quantityStatus: "linha_desconhecida",
        priceStatus: "linha_desconhecida",
        hardBlock: true,
        variance: false,
      });
      continue;
    }

    const acceptedQty = Math.max(0, input.acceptedQtyByLine[poLine.id] ?? 0);
    const previouslyInvoicedQty = Math.max(0, input.previouslyInvoicedQtyByLine?.[poLine.id] ?? 0);
    const availableToInvoiceQty = Math.max(0, acceptedQty - previouslyInvoicedQty);

    let quantityStatus: InvoiceLineMatch["quantityStatus"] = "ok";
    if (invoiceLine.quantity > poLine.orderedQty + QTY_EPSILON) quantityStatus = "excede_oc";
    else if (invoiceLine.quantity > availableToInvoiceQty + QTY_EPSILON) quantityStatus = "excede_recebido";

    const priceStatus: InvoiceLineMatch["priceStatus"] = Math.abs(invoiceLine.unitCost - poLine.unitCost) <= MONEY_EPSILON ? "ok" : "divergente";
    const hardBlock = quantityStatus !== "ok";
    const variance = priceStatus === "divergente";

    if (quantityStatus === "excede_recebido") {
      hardBlocks.push(`A quantidade facturada da linha ${poLine.id} excede a quantidade aceite ainda disponível (${availableToInvoiceQty.toFixed(3)}).`);
    } else if (quantityStatus === "excede_oc") {
      hardBlocks.push(`A quantidade facturada da linha ${poLine.id} excede a quantidade da OC (${poLine.orderedQty.toFixed(3)}).`);
    }
    if (variance) {
      softVariances.push(`Preço unitário divergente na linha ${poLine.id}: OC ${poLine.unitCost.toFixed(4)} vs factura ${invoiceLine.unitCost.toFixed(4)}.`);
    }

    lineMatches.push({
      purchaseOrderLineId: poLine.id,
      orderedQty: poLine.orderedQty,
      acceptedQty,
      previouslyInvoicedQty,
      availableToInvoiceQty,
      invoicedQty: invoiceLine.quantity,
      poUnitCost: poLine.unitCost,
      invoiceUnitCost: invoiceLine.unitCost,
      quantityStatus,
      priceStatus,
      hardBlock,
      variance,
    });
  }

  const availableTransport = Math.max(0, input.poTransportCost - (input.previouslyInvoicedTransport ?? 0));
  if (input.invoiceTransportCost > availableTransport + MONEY_EPSILON) {
    softVariances.push(`Transporte facturado (${input.invoiceTransportCost.toFixed(2)}) excede o saldo de transporte da OC (${availableTransport.toFixed(2)}).`);
  }
  if (Math.abs(input.invoiceIvaRate - input.poIvaRate) > RATE_EPSILON) {
    softVariances.push(`Taxa de IVA divergente: OC ${(input.poIvaRate * 100).toFixed(2)}% vs factura ${(input.invoiceIvaRate * 100).toFixed(2)}%.`);
  }

  const subtotal = roundMoney(input.invoiceLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0));
  const transport = roundMoney(input.invoiceTransportCost);
  const taxableBase = roundMoney(subtotal + transport);
  const vatAmount = roundMoney(taxableBase * input.invoiceIvaRate);
  const total = roundMoney(taxableBase + vatAmount);

  return {
    lineMatches,
    hardBlocks,
    softVariances,
    exactMatch: hardBlocks.length === 0 && softVariances.length === 0,
    canApprove: hardBlocks.length === 0 && softVariances.length === 0,
    canApproveWithVariance: hardBlocks.length === 0,
    subtotal,
    transport,
    taxableBase,
    vatAmount,
    total,
  };
}

export type PayableBalanceInput = {
  grossAmount: number;
  payments: number[];
  acceptedCreditNotes: number[];
};

export function computePayableBalance(input: PayableBalanceInput) {
  const paid = roundMoney(input.payments.reduce((sum, value) => sum + value, 0));
  const credited = roundMoney(input.acceptedCreditNotes.reduce((sum, value) => sum + value, 0));
  const netPayable = roundMoney(Math.max(0, input.grossAmount - credited));
  const outstanding = roundMoney(Math.max(0, netPayable - paid));
  const overpaid = roundMoney(Math.max(0, paid - netPayable));
  const status = outstanding <= MONEY_EPSILON ? "paga" : paid > MONEY_EPSILON ? "parcialmente_paga" : "aprovada";
  return { grossAmount: roundMoney(input.grossAmount), credited, netPayable, paid, outstanding, overpaid, status } as const;
}

export type NonconformityResolution = "substituicao" | "nota_credito" | "devolucao" | "aceite_com_desconto" | "outro";

export function validateNonconformityResolution(args: {
  rejectedQty: number;
  resolution: NonconformityResolution;
  replacementQty?: number;
  creditAmount?: number;
  reason?: string;
}) {
  if (!(args.rejectedQty > 0)) return { ok: false as const, error: "A não-conformidade deve ter quantidade positiva." };
  if (args.resolution === "substituicao") {
    const qty = args.replacementQty ?? 0;
    if (!(qty > 0) || qty > args.rejectedQty + QTY_EPSILON) {
      return { ok: false as const, error: "A quantidade de substituição deve ser positiva e não pode exceder a quantidade rejeitada." };
    }
  }
  if (args.resolution === "nota_credito" || args.resolution === "aceite_com_desconto") {
    if (!((args.creditAmount ?? 0) > 0)) return { ok: false as const, error: "Indique o valor do crédito/desconto proposto." };
  }
  if (args.resolution === "outro" && (args.reason?.trim().length ?? 0) < 5) {
    return { ok: false as const, error: "Descreva a solução proposta." };
  }
  return { ok: true as const };
}

export type InvoiceReservationStatus = "rascunho" | "submetida" | "em_revisao" | "divergente" | "aprovada" | "rejeitada" | "parcialmente_paga" | "paga" | "cancelada";

const RESERVING_INVOICE_STATUSES = new Set<InvoiceReservationStatus>([
  "submetida", "em_revisao", "divergente", "aprovada", "parcialmente_paga", "paga",
]);
const IRREVERSIBLE_RESERVATION_STATUSES = new Set<InvoiceReservationStatus>(["aprovada", "parcialmente_paga", "paga"]);

/**
 * Determina se outra factura deve reservar capacidade da mesma OC para o match actual.
 * Facturas já aprovadas reservam sempre. Facturas ainda em revisão só reservam contra facturas
 * criadas depois delas, evitando que uma submissão posterior bloqueie retroactivamente uma anterior.
 */
export function shouldReserveInvoice(args: {
  candidateId: string;
  candidateStatus: InvoiceReservationStatus;
  candidateCreatedAt: Date | string;
  excludeInvoiceId?: string;
  currentCreatedAt?: Date | string;
}): boolean {
  if (args.candidateId === args.excludeInvoiceId) return false;
  if (!RESERVING_INVOICE_STATUSES.has(args.candidateStatus)) return false;
  if (IRREVERSIBLE_RESERVATION_STATUSES.has(args.candidateStatus)) return true;
  if (!args.currentCreatedAt) return true;
  return new Date(args.candidateCreatedAt).getTime() <= new Date(args.currentCreatedAt).getTime();
}

/** Quantidade rejeitada pode ser devolvida em várias parcelas, mas nunca acima do rejeitado. */
export function validateGoodsReturn(args: { rejectedQty: number; alreadyReturnedQty: number; quantity: number }) {
  if (!(args.quantity > 0)) return { ok: false as const, error: "A quantidade devolvida deve ser positiva." };
  if (args.alreadyReturnedQty < 0 || args.rejectedQty <= 0) return { ok: false as const, error: "Quantidades de referência inválidas." };
  const available = Math.max(0, args.rejectedQty - args.alreadyReturnedQty);
  if (args.quantity > available + QTY_EPSILON) {
    return { ok: false as const, error: `A devolução excede a quantidade rejeitada disponível (${available.toFixed(3)}).`, available };
  }
  return { ok: true as const, availableBeforeReturn: available, remainingAfterReturn: Math.max(0, available - args.quantity) };
}
