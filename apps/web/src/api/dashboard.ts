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
  estimatedMonthlyRevenueMzn: number;
  totalCollectedMzn: number;
  collectedThisMonthMzn: number;
  expiringSoon: Array<{ id: string; name: string; expiresAt: string; status: string; plan: string }>;
  nearLimit: Array<{ id: string; name: string; users: number; maxUsers: number | null; projects: number; maxProjects: number | null }>;
  services: { api: boolean; plantService: boolean; plantAi?: unknown };
};

export const dashboardApi = {
  get: () => request<DashboardData>("/dashboard"),
  adminStats: () => request<AdminStats>("/admin/stats"),
};
