import { describe, expect, it } from "vitest";
import {
  computeBankMatchScore,
  normalizeNuit,
  validateFiscalDocument,
  validatePaymentRequestAmount,
  validatePaymentSeparation,
  validateReconciliation,
} from "../src/services/procurementFiscalControl.js";

const expected = {
  invoiceNumber: "FT 2026/014",
  supplierNuit: "400123456",
  buyerNuit: "400987654",
  issueDate: "2026-08-08",
  currency: "MZN" as const,
  subtotal: 100_000,
  vatRate: 0.16,
  vatAmount: 16_000,
  totalAmount: 116_000,
};

const exactFacts = { ...expected, dueDate: "2026-09-08", atcud: "ABC-123" };

describe("procurement fiscal control", () => {
  it("normaliza NUIT", () => expect(normalizeNuit("400 123 456")).toBe("400123456"));
  it("valida documento fiscal exacto", () => expect(validateFiscalDocument(exactFacts, expected).status).toBe("validado"));
  it("bloqueia NUIT do fornecedor diferente", () => expect(validateFiscalDocument({ ...exactFacts, supplierNuit: "499999999" }, expected).hardBlocks.some((m) => m.includes("emitente"))).toBe(true));
  it("bloqueia total fiscal diferente", () => expect(validateFiscalDocument({ ...exactFacts, totalAmount: 120_000 }, expected).status).toBe("bloqueado"));
  it("pede revisão quando o cadastro não tem NUIT", () => expect(validateFiscalDocument(exactFacts, { ...expected, supplierNuit: null }).status).toBe("requer_revisao"));
  it("não deixa pedidos de pagamento ultrapassarem saldo reservado", () => expect(validatePaymentRequestAmount({ outstanding: 1000, activeApprovedReservations: 700, requestedAmount: 400 }).ok).toBe(false));
  it("permite pedido dentro do saldo disponível", () => expect(validatePaymentRequestAmount({ outstanding: 1000, activeApprovedReservations: 700, requestedAmount: 300 }).ok).toBe(true));
  it("segrega solicitante e aprovador quando há mais de um admin", () => expect(validatePaymentSeparation({ requesterId: "u1", approverId: "u1", activeAdminCount: 2 }).ok).toBe(false));
  it("segrega aprovador e executor quando há mais de um admin", () => expect(validatePaymentSeparation({ requesterId: "u1", approverId: "u2", executorId: "u2", activeAdminCount: 2 }).ok).toBe(false));
  it("permite override controlado para empresa de um admin", () => expect(validatePaymentSeparation({ requesterId: "u1", approverId: "u1", executorId: "u1", activeAdminCount: 1, overrideReason: "Empresa opera com um administrador activo" }).ok).toBe(true));
  it("exige justificação no override de um admin", () => expect(validatePaymentSeparation({ requesterId: "u1", approverId: "u1", activeAdminCount: 1 }).ok).toBe(false));
  it("sugere reconciliação por valor/data/referência", () => {
    const result = computeBankMatchScore(
      { id: "b1", transactionDate: "2026-08-10", amount: -116000, currency: "MZN", description: "TRF FT2026014", reference: "PAY-88" },
      { id: "p1", amount: 116000, currency: "MZN", requestedPaymentDate: "2026-08-10", executionReference: "PAY-88", invoiceNumber: "FT 2026/014" },
    );
    expect(result.eligible).toBe(true); expect(result.score).toBe(100);
  });
  it("não sugere crédito bancário como pagamento", () => expect(computeBankMatchScore({ id: "b", transactionDate: "2026-08-10", amount: 116000, currency: "MZN" }, { id: "p", amount: 116000, currency: "MZN" }).eligible).toBe(false));
  it("não sugere valor bancário diferente", () => expect(computeBankMatchScore({ id: "b", transactionDate: "2026-08-10", amount: -110000, currency: "MZN" }, { id: "p", amount: 116000, currency: "MZN" }).eligible).toBe(false));
  it("bloqueia reconciliação de crédito bancário", () => expect(validateReconciliation({ transactionAmount: 116000, transactionCurrency: "MZN", paymentAmount: 116000, paymentCurrency: "MZN" }).ok).toBe(false));
  it("aceita débito exacto na mesma moeda", () => expect(validateReconciliation({ transactionAmount: -116000, transactionCurrency: "MZN", paymentAmount: 116000, paymentCurrency: "MZN" }).ok).toBe(true));
});
