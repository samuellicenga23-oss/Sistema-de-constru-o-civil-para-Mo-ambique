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
};

export type OperationalLevel = "ok" | "warning" | "critical";
export type OperationalHealth = {
  status: OperationalLevel;
  checkedAt: string;
  release: string;
  uptimeSeconds: number;
  services: {
    database: { level: OperationalLevel; latencyMs: number };
    plantService: { level: OperationalLevel; latencyMs: number; parserVersion?: string; ai?: { enabled?: boolean; reachable?: boolean; model?: string } };
  };
  queues: { available: boolean; plantsActive: number; plantsStuck: number; plantsFailed24h: number; importsActive: number; importsStuck: number; importsFailed24h: number; reviewsOverdue: number };
  storage: { availableBytes: number | null; totalBytes: number | null; usedPercent: number | null };
  backup: { configured: boolean; latestAt: string | null; ageHours: number | null };
  http: { windowMinutes: number; requests: number; serverErrors: number; errorRatePercent: number; averageLatencyMs: number; slowRequests: number };
  integrations: { email: boolean; sentry: boolean };
  checks: Array<{ key: string; label: string; level: OperationalLevel; detail: string; action?: string }>;
};

export const dashboardApi = {
  get: () => request<DashboardData>("/dashboard"),
  adminStats: () => request<AdminStats>("/admin/stats"),
  operationalHealth: () => request<OperationalHealth>("/admin/operational-health", { timeoutMs: 10_000 }),
};
