export type CurrencyCode = "MZN" | "USD";

export type FiscalDocumentFacts = {
  invoiceNumber?: string | null;
  supplierNuit?: string | null;
  buyerNuit?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  currency?: CurrencyCode | null;
  subtotal?: number | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
  atcud?: string | null;
  qrCodeText?: string | null;
};

export type FiscalValidationExpected = {
  invoiceNumber: string;
  supplierNuit?: string | null;
  buyerNuit?: string | null;
  issueDate: string;
  currency: CurrencyCode;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
};

export type FiscalValidationResult = {
  status: "validado" | "requer_revisao" | "bloqueado";
  hardBlocks: string[];
  warnings: string[];
  checks: Array<{ field: string; status: "ok" | "warning" | "error" | "missing"; expected?: string | number | null; actual?: string | number | null }>;
};

const MONEY_EPSILON = 0.02;
const RATE_EPSILON = 0.0001;

export function normalizeNuit(value?: string | null): string | null {
  const normalized = (value ?? "").replace(/\D/g, "");
  return normalized || null;
}

export function normalizeDocumentNumber(value?: string | null): string {
  return (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function pushCheck(
  result: FiscalValidationResult,
  field: string,
  status: "ok" | "warning" | "error" | "missing",
  expected?: string | number | null,
  actual?: string | number | null,
  message?: string,
) {
  result.checks.push({ field, status, expected, actual });
  if (status === "error" && message) result.hardBlocks.push(message);
  if ((status === "warning" || status === "missing") && message) result.warnings.push(message);
}

export function validateFiscalDocument(facts: FiscalDocumentFacts, expected: FiscalValidationExpected): FiscalValidationResult {
  const result: FiscalValidationResult = { status: "validado", hardBlocks: [], warnings: [], checks: [] };

  const actualNumber = normalizeDocumentNumber(facts.invoiceNumber);
  const expectedNumber = normalizeDocumentNumber(expected.invoiceNumber);
  if (!actualNumber) pushCheck(result, "invoiceNumber", "missing", expectedNumber, null, "Número da factura não foi identificado no documento fiscal.");
  else if (actualNumber !== expectedNumber) pushCheck(result, "invoiceNumber", "error", expectedNumber, actualNumber, "Número da factura fiscal não corresponde à factura submetida no SIGO.");
  else pushCheck(result, "invoiceNumber", "ok", expectedNumber, actualNumber);

  const supplierExpected = normalizeNuit(expected.supplierNuit);
  const supplierActual = normalizeNuit(facts.supplierNuit);
  if (!supplierExpected) pushCheck(result, "supplierNuit", "warning", null, supplierActual, "O fornecedor não tem NUIT preenchido na ficha SIGO; confirme o cadastro antes do pagamento.");
  else if (!supplierActual) pushCheck(result, "supplierNuit", "missing", supplierExpected, null, "NUIT do fornecedor não foi identificado no documento fiscal.");
  else if (supplierActual !== supplierExpected) pushCheck(result, "supplierNuit", "error", supplierExpected, supplierActual, "NUIT do emitente não corresponde ao fornecedor da OC.");
  else pushCheck(result, "supplierNuit", "ok", supplierExpected, supplierActual);

  const buyerExpected = normalizeNuit(expected.buyerNuit);
  const buyerActual = normalizeNuit(facts.buyerNuit);
  if (!buyerExpected) pushCheck(result, "buyerNuit", "warning", null, buyerActual, "A empresa compradora não tem NUIT preenchido no SIGO; a validação fiscal fica incompleta.");
  else if (!buyerActual) pushCheck(result, "buyerNuit", "missing", buyerExpected, null, "NUIT do adquirente não foi identificado no documento fiscal.");
  else if (buyerActual !== buyerExpected) pushCheck(result, "buyerNuit", "error", buyerExpected, buyerActual, "NUIT do adquirente não corresponde à empresa da obra.");
  else pushCheck(result, "buyerNuit", "ok", buyerExpected, buyerActual);

  if (!facts.issueDate) pushCheck(result, "issueDate", "missing", expected.issueDate, null, "Data de emissão não foi identificada.");
  else if (facts.issueDate !== expected.issueDate) pushCheck(result, "issueDate", "error", expected.issueDate, facts.issueDate, "Data de emissão do documento não corresponde à factura submetida.");
  else pushCheck(result, "issueDate", "ok", expected.issueDate, facts.issueDate);

  if (!facts.currency) pushCheck(result, "currency", "missing", expected.currency, null, "Moeda não foi identificada no documento fiscal.");
  else if (facts.currency !== expected.currency) pushCheck(result, "currency", "error", expected.currency, facts.currency, "Moeda do documento fiscal não corresponde à factura submetida.");
  else pushCheck(result, "currency", "ok", expected.currency, facts.currency);

  const monetaryChecks: Array<[keyof Pick<FiscalDocumentFacts, "subtotal" | "vatAmount" | "totalAmount">, number, string]> = [
    ["subtotal", expected.subtotal, "Subtotal"],
    ["vatAmount", expected.vatAmount, "IVA"],
    ["totalAmount", expected.totalAmount, "Total"],
  ];
  for (const [field, expectedValue, label] of monetaryChecks) {
    const actual = facts[field];
    if (actual === null || actual === undefined || !Number.isFinite(actual)) pushCheck(result, field, "missing", expectedValue, null, `${label} não foi identificado no documento fiscal.`);
    else if (Math.abs(actual - expectedValue) > MONEY_EPSILON) pushCheck(result, field, "error", expectedValue, actual, `${label} fiscal diverge do valor submetido no SIGO.`);
    else pushCheck(result, field, "ok", expectedValue, actual);
  }

  if (facts.vatRate === null || facts.vatRate === undefined || !Number.isFinite(facts.vatRate)) pushCheck(result, "vatRate", "missing", expected.vatRate, null, "Taxa de IVA não foi identificada no documento fiscal.");
  else if (Math.abs(facts.vatRate - expected.vatRate) > RATE_EPSILON) pushCheck(result, "vatRate", "error", expected.vatRate, facts.vatRate, "Taxa de IVA fiscal diverge da factura submetida.");
  else pushCheck(result, "vatRate", "ok", expected.vatRate, facts.vatRate);

  if (result.hardBlocks.length) result.status = "bloqueado";
  else if (result.warnings.length || result.checks.some((check) => check.status === "missing")) result.status = "requer_revisao";
  return result;
}

export function validatePaymentRequestAmount(args: {
  outstanding: number;
  activeApprovedReservations: number;
  requestedAmount: number;
}) {
  if (!(args.requestedAmount > 0)) return { ok: false as const, error: "O valor solicitado deve ser positivo.", available: 0 };
  const available = Math.max(0, Math.round((args.outstanding - args.activeApprovedReservations + Number.EPSILON) * 100) / 100);
  if (args.requestedAmount > available + MONEY_EPSILON) {
    return { ok: false as const, error: `O pedido excede o saldo disponível para autorização (${available.toFixed(2)}).`, available };
  }
  return { ok: true as const, availableBeforeRequest: available, remainingAfterRequest: Math.max(0, available - args.requestedAmount) };
}

export function validatePaymentSeparation(args: {
  requesterId: string;
  approverId?: string | null;
  executorId?: string | null;
  activeAdminCount: number;
  overrideReason?: string | null;
}) {
  const needsOverride = args.activeAdminCount <= 1;
  if (args.approverId && args.approverId === args.requesterId && !needsOverride) {
    return { ok: false as const, error: "Quem solicitou o pagamento não pode aprová-lo quando existe outro administrador activo." };
  }
  if (args.executorId && args.approverId && args.executorId === args.approverId && !needsOverride) {
    return { ok: false as const, error: "Quem aprovou o pagamento não pode executá-lo quando existe outro administrador activo." };
  }
  if (needsOverride && ((args.approverId === args.requesterId) || (args.executorId && args.executorId === args.approverId))) {
    if ((args.overrideReason?.trim().length ?? 0) < 10) {
      return { ok: false as const, error: "Empresa com um único administrador: indique uma justificação de controlo interno para o override." };
    }
    return { ok: true as const, overrideUsed: true };
  }
  return { ok: true as const, overrideUsed: false };
}

export type BankTransactionCandidate = {
  id: string;
  transactionDate: string;
  amount: number;
  currency: string;
  description?: string | null;
  reference?: string | null;
};
export type PaymentRequestCandidate = {
  id: string;
  amount: number;
  currency: string;
  requestedPaymentDate?: string | null;
  executionReference?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
};

function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const at = Date.parse(`${a}T00:00:00Z`); const bt = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return null;
  return Math.abs(Math.round((at - bt) / 86_400_000));
}
function normalizeSearch(value?: string | null) { return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

export function computeBankMatchScore(transaction: BankTransactionCandidate, payment: PaymentRequestCandidate) {
  const reasons: string[] = [];
  if (transaction.amount >= 0) return { score: 0, eligible: false, reasons: ["Movimento não é débito"] };
  if (transaction.currency !== payment.currency) return { score: 0, eligible: false, reasons: ["Moeda diferente"] };
  const bankAmount = Math.abs(transaction.amount);
  const diff = Math.abs(bankAmount - payment.amount);
  let score = 0;
  if (diff <= MONEY_EPSILON) { score += 60; reasons.push("Valor exacto"); }
  else return { score: 0, eligible: false, reasons: ["Valor diferente"] };

  const days = daysBetween(transaction.transactionDate, payment.requestedPaymentDate);
  if (days === 0) { score += 20; reasons.push("Mesma data"); }
  else if (days !== null && days <= 3) { score += 10; reasons.push(`Data próxima (${days} dia(s))`); }

  const haystack = normalizeSearch(`${transaction.reference ?? ""} ${transaction.description ?? ""}`);
  const reference = normalizeSearch(payment.executionReference);
  if (reference && haystack.includes(reference)) { score += 20; reasons.push("Referência bancária coincide"); }
  else {
    const invoiceNumber = normalizeSearch(payment.invoiceNumber);
    if (invoiceNumber && haystack.includes(invoiceNumber)) { score += 10; reasons.push("Número da factura encontrado"); }
    const supplier = normalizeSearch(payment.supplierName);
    if (supplier && supplier.length >= 5 && haystack.includes(supplier.slice(0, Math.min(12, supplier.length)))) { score += 5; reasons.push("Fornecedor reconhecido") }
  }
  return { score, eligible: score >= 70, reasons };
}

export function validateReconciliation(args: {
  transactionAmount: number;
  transactionCurrency: string;
  paymentAmount: number;
  paymentCurrency: string;
}) {
  if (args.transactionCurrency !== args.paymentCurrency) return { ok: false as const, error: "A moeda da transacção não corresponde ao pedido de pagamento." };
  if (args.transactionAmount >= 0) return { ok: false as const, error: "A reconciliação de pagamento exige um débito bancário." };
  const difference = Math.abs(Math.abs(args.transactionAmount) - args.paymentAmount);
  if (difference > MONEY_EPSILON) return { ok: false as const, error: `O valor bancário diverge do pagamento em ${difference.toFixed(2)}.` };
  return { ok: true as const };
}
