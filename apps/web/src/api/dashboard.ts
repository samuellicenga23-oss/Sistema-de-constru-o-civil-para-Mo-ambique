import { request } from "./http";

export type CurrencyTotals = Record<string, number>;

export type DashboardData = {
  totalProjects: number;
  totalDocuments: number;
  totalCertificates: number;
  totalPlants: number;
  projects: Array<{ id: string; name: string; currency: string; documentCount: number; total: number }>;
  contasAPagar: CurrencyTotals;
  contasAReceber: CurrencyTotals;
  valorRecebido: CurrencyTotals;
  despesas: CurrencyTotals;
  contasVencidas: number;
  ordensCompraPendentes: number;
  recentCertificates: Array<{ id: string; number: number; periodDate: string; status: string; projectId: string; projectName: string }>;
};

export type AdminStats = {
  totalCompanies: number;
  activeCompanies: number;
  trialCompanies: number;
  suspendedCompanies: number;
  totalUsers: number;
  totalProjects: number;
  planCounts: Record<string, number>;
  services: { api: boolean; plantService: boolean };
};

export const dashboardApi = {
  get: () => request<DashboardData>("/dashboard"),
  adminStats: () => request<AdminStats>("/admin/stats"),
};
