import { request } from "./http";

export type FinancialEntry = {
  id: string;
  projectId: string;
  type: "receita" | "despesa";
  category: string;
  description: string | null;
  amount: string;
  currency: string;
  dueDate: string | null;
  paidDate: string | null;
  status: "pendente" | "pago";
  createdAt: string;
};

export type FinancialEntryInput = {
  type: "receita" | "despesa";
  category: string;
  description?: string;
  amount: number;
  currency?: string;
  dueDate?: string;
  paidDate?: string;
  status?: "pendente" | "pago";
};

export type FinancialSummary = {
  currency: string;
  valorContratado: number;
  valorRecebido: number;
  custoRealizado: number;
  contasAReceber: number;
  contasAPagar: number;
  saldo: number;
  margemRealizada: number;
  fluxoCaixaMensal: { month: string; receitas: number; despesas: number; saldo: number }[];
};

export const financialApi = {
  list: (projectId: string) => request<FinancialEntry[]>(`/projects/${projectId}/financial-entries`),
  create: (projectId: string, data: FinancialEntryInput) =>
    request<FinancialEntry>(`/projects/${projectId}/financial-entries`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<FinancialEntryInput>) =>
    request<FinancialEntry>(`/financial-entries/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: true }>(`/financial-entries/${id}`, { method: "DELETE" }),
  summary: (projectId: string) => request<FinancialSummary>(`/projects/${projectId}/financial-summary`),
};
