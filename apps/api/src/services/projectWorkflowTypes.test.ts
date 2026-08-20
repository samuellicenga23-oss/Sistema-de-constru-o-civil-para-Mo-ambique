import { describe, expect, it } from "vitest";
import {
  PROJECT_WORKFLOW_TYPES,
  userHasApprovePermission,
  workflowTypeFromDocumentType,
  WORKFLOW_APPROVE_PERMISSION,
} from "./projectWorkflowTypes.js";

describe("projectWorkflowTypes", () => {
  it("mapeia documento para workflow", () => {
    expect(workflowTypeFromDocumentType("medicao")).toBe("measurement");
    expect(workflowTypeFromDocumentType("orcamento")).toBe("budget");
  });

  it("define permission de aprovação por workflow", () => {
    expect(WORKFLOW_APPROVE_PERMISSION.measurement).toBe("orcamentos.aprovar");
    expect(WORKFLOW_APPROVE_PERMISSION.measurement_certificate).toBe("diario.aprovar");
    expect(WORKFLOW_APPROVE_PERMISSION.purchase_requisition).toBe("materiais.aprovar");
    expect(PROJECT_WORKFLOW_TYPES).toContain("payment_request");
  });

  it("admin_empresa pode aprovar qualquer workflow", () => {
    expect(userHasApprovePermission({ role: "admin_empresa", permissions: [] }, "measurement")).toBe(true);
    expect(userHasApprovePermission({ role: "visualizador", permissions: [] }, "measurement")).toBe(false);
    expect(
      userHasApprovePermission({ role: "orcamentista", permissions: ["orcamentos.aprovar"] }, "budget"),
    ).toBe(true);
  });
});
