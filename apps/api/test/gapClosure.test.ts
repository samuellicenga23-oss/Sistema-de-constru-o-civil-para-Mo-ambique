import { describe, expect, it } from "vitest";
import { assertVendorNotBlocked } from "../src/services/vendorGovernance.js";
import { canApproveWithMatrix } from "../src/services/approvalMatrix.js";

describe("fecho de gaps — matriz e governação", () => {
  it("matriz de requisição exige admin + permissão", () => {
    const deniedRole = canApproveWithMatrix({
      entityType: "requisicao",
      role: "orcamentista",
      permissions: ["materiais.aprovar"],
      isSubmitter: false,
      adminCount: 2,
    });
    expect(deniedRole.allowed).toBe(false);

    const ok = canApproveWithMatrix({
      entityType: "requisicao",
      role: "admin_empresa",
      permissions: ["materiais.aprovar"],
      isSubmitter: false,
      adminCount: 2,
    });
    expect(ok.allowed).toBe(true);
  });

  it("payment_request bloqueia submissor quando há vários admins", () => {
    const blocked = canApproveWithMatrix({
      entityType: "payment_request",
      role: "admin_empresa",
      isSubmitter: true,
      adminCount: 2,
      amount: 1000,
    });
    expect(blocked.allowed).toBe(false);
  });

  it("assertVendorNotBlocked só rejeita bloqueado", () => {
    expect(() => assertVendorNotBlocked("qualificado")).not.toThrow();
    expect(() => assertVendorNotBlocked("bloqueado", "NUIT inválido")).toThrow(/NUIT inválido/);
  });
});
