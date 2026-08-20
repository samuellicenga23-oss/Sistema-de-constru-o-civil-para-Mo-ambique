import { resolveRoleTemplate } from "@sigo/shared";

export const PROJECT_ROLES = [
  "project_manager",
  "quantity_surveyor",
  "estimator",
  "site_engineer",
  "supervisor",
  "procurement",
  "financial",
  "viewer",
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  project_manager: "Gestor da obra",
  quantity_surveyor: "Medições",
  estimator: "Orçamentação",
  site_engineer: "Engenheiro de obra",
  supervisor: "Fiscalização",
  procurement: "Compras",
  financial: "Financeiro",
  viewer: "Consulta",
};

export const PROJECT_WORKFLOW_TYPES = [
  "measurement",
  "budget",
  "measurement_certificate",
  "purchase_requisition",
  "payment_request",
] as const;

export type ProjectWorkflowType = (typeof PROJECT_WORKFLOW_TYPES)[number];

export const PROJECT_WORKFLOW_LABELS: Record<ProjectWorkflowType, string> = {
  measurement: "Medições",
  budget: "Orçamentos",
  measurement_certificate: "Autos de medição",
  purchase_requisition: "Requisições",
  payment_request: "Pagamentos",
};

export type ApprovalMode = "any" | "all" | "sequential";

/** Permission requerida para poder ser aprovador deste workflow (além de activo + mesma empresa). */
export const WORKFLOW_APPROVE_PERMISSION: Record<ProjectWorkflowType, string | null> = {
  measurement: "orcamentos.aprovar",
  budget: "orcamentos.aprovar",
  measurement_certificate: "diario.aprovar",
  purchase_requisition: "materiais.aprovar",
  payment_request: "materiais.aprovar",
};

export function workflowTypeFromDocumentType(documentType: string): ProjectWorkflowType {
  return documentType === "medicao" ? "measurement" : "budget";
}

export function matrixEntityFromWorkflow(workflowType: ProjectWorkflowType): "medicao" | "auto" | "requisicao" | "payment_request" {
  switch (workflowType) {
    case "measurement":
    case "budget":
      return "medicao";
    case "measurement_certificate":
      return "auto";
    case "purchase_requisition":
      return "requisicao";
    case "payment_request":
      return "payment_request";
  }
}

export function userHasApprovePermission(user: {
  role: string;
  permissions?: string[] | null;
}, workflowType: ProjectWorkflowType): boolean {
  if (user.role === "admin_empresa" || user.role === "super_admin") return true;
  const required = WORKFLOW_APPROVE_PERMISSION[workflowType];
  if (!required) return true;
  const effective = user.permissions?.length
    ? user.permissions
    : resolveRoleTemplate(user.role as "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador") ?? [];
  return effective.includes(required);
}

export const WORKFLOW_TASK_PRIORITY: Record<string, number> = {
  correction: 1,
  payment_request: 3,
  measurement_certificate: 4,
  measurement: 5,
  budget: 5,
  purchase_requisition: 6,
};
