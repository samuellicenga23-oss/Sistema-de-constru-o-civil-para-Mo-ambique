import { describe, expect, it } from "vitest";
import { canApproveWithMatrix, DEFAULT_APPROVAL_MATRIX } from "../src/services/approvalMatrix.js";

describe("matriz de aprovação", () => {
  it("reproduz o default: admin aprova auto", () => {
    const ok = canApproveWithMatrix({ entityType: "auto", role: "admin_empresa", isSubmitter: false, adminCount: 2 });
    expect(ok.allowed).toBe(true);
  });

  it("bloqueia o próprio submissor quando há mais do que um admin", () => {
    const blocked = canApproveWithMatrix({ entityType: "auto", role: "admin_empresa", isSubmitter: true, adminCount: 2 });
    expect(blocked.allowed).toBe(false);
  });

  it("excepção de admin único permite auto-aprovação", () => {
    const ok = canApproveWithMatrix({ entityType: "auto", role: "admin_empresa", isSubmitter: true, adminCount: 1 });
    expect(ok.allowed).toBe(true);
  });

  it("defaults cobrem os quatro domínios suportados", () => {
    expect(DEFAULT_APPROVAL_MATRIX.map((row) => row.entityType).sort()).toEqual(["auto", "medicao", "payment_request", "requisicao"].sort());
  });
});
