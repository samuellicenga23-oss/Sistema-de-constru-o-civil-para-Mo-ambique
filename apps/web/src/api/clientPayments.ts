import { request } from "./http";

export type ClientInstallment = {
  id: string;
  sequence: number;
  title: string;
  dueDate: string;
  amount: number;
  status: "prevista" | "parcial" | "paga" | "atrasada";
  paidAmount: number;
  paidAt: string | null;
  invoiceId: string | null;
};

export type ClientPaymentPlan = {
  id: string;
  projectId: string;
  mode: "total" | "parcelado";
  currency: string;
  totalAmount: number;
  notes: string | null;
  installments: ClientInstallment[];
};

export type ClientPaymentPlanResponse = {
  plan: ClientPaymentPlan | null;
  suggestion: { amount: number; currency: string } | null;
};

export const clientPaymentsApi = {
  get: (projectId: string) => request<ClientPaymentPlanResponse>(`/projects/${projectId}/client-payment-plan`),
  savePlan: (
    projectId: string,
    data: {
      mode: "total" | "parcelado";
      currency: "MZN" | "USD";
      totalAmount: number;
      notes?: string | null;
      singleDueDate?: string;
      singleTitle?: string;
    },
  ) => request<ClientPaymentPlan>(`/projects/${projectId}/client-payment-plan`, { method: "PUT", body: JSON.stringify(data) }),
  addInstallment: (projectId: string, data: { title: string; dueDate: string; amount: number; sequence?: number }) =>
    request<ClientInstallment>(`/projects/${projectId}/client-payment-plan/installments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateInstallment: (
    projectId: string,
    id: string,
    data: Partial<{ title: string; dueDate: string; amount: number; sequence: number }>,
  ) =>
    request<ClientInstallment>(`/projects/${projectId}/client-payment-plan/installments/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteInstallment: (projectId: string, id: string) =>
    request<{ ok: true }>(`/projects/${projectId}/client-payment-plan/installments/${id}`, { method: "DELETE" }),
  markPaid: (projectId: string, id: string, data?: { paidAmount?: number; paidAt?: string; invoiceId?: string | null }) =>
    request<ClientInstallment>(`/projects/${projectId}/client-payment-plan/installments/${id}/mark-paid`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
};
