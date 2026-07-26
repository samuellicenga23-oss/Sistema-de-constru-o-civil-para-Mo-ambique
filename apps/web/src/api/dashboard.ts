import { request } from "./http";

export type DashboardData = {
  totalProjects: number;
  totalDocuments: number;
  totalCertificates: number;
  totalPlants: number;
  projects: Array<{ id: string; name: string; currency: string; documentCount: number; total: number }>;
};

export const dashboardApi = {
  get: () => request<DashboardData>("/dashboard"),
};
