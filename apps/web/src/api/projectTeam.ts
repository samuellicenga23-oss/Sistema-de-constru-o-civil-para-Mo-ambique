import { request } from "./http";

export type ProjectRole =
  | "project_manager"
  | "quantity_surveyor"
  | "estimator"
  | "site_engineer"
  | "supervisor"
  | "procurement"
  | "financial"
  | "viewer";

export type ProjectWorkflowType =
  | "measurement"
  | "budget"
  | "measurement_certificate"
  | "purchase_requisition"
  | "payment_request";

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

export const PROJECT_WORKFLOW_LABELS: Record<ProjectWorkflowType, string> = {
  measurement: "Medições",
  budget: "Orçamentos",
  measurement_certificate: "Autos de medição",
  purchase_requisition: "Requisições",
  payment_request: "Pagamentos",
};

export type ProjectMember = {
  id: string;
  projectId: string;
  userId: string;
  projectRole: ProjectRole | string;
  isActive: boolean;
  userName: string;
  userEmail: string;
  userRole: string;
  userActive: boolean;
};

export type ProjectApprovalRoute = {
  id: string;
  workflowType: ProjectWorkflowType;
  approvalMode: "any" | "all" | "sequential";
  isActive: boolean;
  steps: Array<{
    id: string;
    stepOrder: number;
    users: Array<{ id: string; name: string; email: string; role: string; isActive: boolean } | undefined>;
  }>;
};

export type WorkflowTask = {
  id: string;
  projectId: string;
  workflowType: string;
  entityType: string;
  entityId: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  projectNameSnapshot: string | null;
  requestedAt: string;
  notificationPresentedAt: string | null;
  requesterName: string | null;
  targetType: string | null;
  targetId: string | null;
  priorityScore?: number;
};

export const projectTeamApi = {
  listMembers: (projectId: string) => request<{ items: ProjectMember[] }>(`/projects/${projectId}/members`),
  addMember: (projectId: string, body: { userId: string; projectRole: ProjectRole }) =>
    request(`/projects/${projectId}/members`, { method: "POST", body: JSON.stringify(body) }),
  removeMember: (projectId: string, memberId: string) =>
    request<{ ok: true }>(`/projects/${projectId}/members/${memberId}`, { method: "DELETE" }),
  listRoutes: (projectId: string) => request<{ items: ProjectApprovalRoute[] }>(`/projects/${projectId}/approval-routes`),
  saveRoute: (
    projectId: string,
    body: {
      workflowType: ProjectWorkflowType;
      approvalMode: "any" | "all" | "sequential";
      isActive?: boolean;
      steps: Array<{ stepOrder: number; userIds: string[] }>;
    },
  ) => request<{ ok: true; items: ProjectApprovalRoute[] }>(`/projects/${projectId}/approval-routes`, { method: "PUT", body: JSON.stringify(body) }),
  cloneTeam: (projectId: string, sourceProjectId: string) =>
    request(`/projects/${projectId}/clone-team`, { method: "POST", body: JSON.stringify({ sourceProjectId }) }),
};

export const workflowTasksApi = {
  listMine: () =>
    request<{ items: WorkflowTask[]; pendingCount: number; priorityTask: WorkflowTask | null }>("/me/workflow-tasks"),
  count: () => request<{ pendingCount: number }>("/me/workflow-tasks/count"),
  markPresented: (id: string) => request<{ ok: true }>(`/me/workflow-tasks/${id}/presented`, { method: "POST" }),
};
