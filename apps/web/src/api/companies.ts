import { request, ApiError } from "./http";
import type { CurrentUser } from "./client";

export type Subscription = {
  id: string;
  companyId: string;
  plan: string;
  status: "trial" | "activo" | "suspenso";
  activatedAt: string | null;
  activatedByUserId?: string | null;
  expiresAt?: string | null;
  billingCycle?: "monthly" | "annual" | "custom" | "trial" | null;
  notes?: string | null;
  createdAt?: string;
};

export type CompanyUsage = {
  users: number;
  activeUsers: number;
  projects: number;
  budgets: number;
  plants: number;
  practiceClients: number;
  practiceQuotes: number;
  practiceEngagements: number;
  maxUsers: number | null;
  maxProjects: number | null;
  usersNearLimit: boolean;
  projectsNearLimit: boolean;
  lastLoginAt: string | null;
};

export type PlatformPayment = {
  id: string;
  companyId: string;
  amount: string;
  currency: string;
  paidAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  plan: string;
  billingCycle: string | null;
  method: string;
  reference: string | null;
  notes: string | null;
  recordedByUserId: string | null;
  createdAt: string;
};

export type PaymentProof = {
  id: string;
  companyId: string;
  companyName?: string;
  submittedByUserId: string;
  plan: string;
  billingCycle: string | null;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  filePath: string;
  originalFileName: string | null;
  status: "pendente" | "aprovado" | "rejeitado";
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export type CommercialLead = {
  id: string;
  companyId: string | null;
  source: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  nuit: string | null;
  city: string | null;
  teamSize: string | null;
  planOrPack: string | null;
  billingCycle: string | null;
  notes: string | null;
  proofFilePath: string | null;
  proofOriginalFileName: string | null;
  status: "novo" | "contactado" | "resolvido";
  createdAt: string;
};

export type Company = {
  id: string;
  name: string;
  nuit: string | null;
  address: string | null;
  logoUrl: string | null;
  defaultCurrency: string;
  workingDaysPerMonth: number;
  workingHoursPerDay: string;
  province: string | null;
  district: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bankDetails: string | null;
  documentFooter: string | null;
  responsibleName: string | null;
  enabledModules: CompanyModuleKey[];
  brandName: string | null;
  primaryColor: string;
  accentColor: string;
  defaultLanguage: "pt" | "en";
  createdAt: string;
  emailNotificationPrefs?: { workflow: boolean };
  subscription?: Subscription | null;
  usage?: CompanyUsage | null;
  totalPaidMzn?: number;
};

export type CompanyModuleKey = "dashboard" | "measurements" | "budgets" | "catalog" | "suppliers" | "purchasing" | "schedule" | "site_diary" | "financial" | "quick_calculations" | "practice";

export type AdminCompanyUser = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  email: string;
  role: "admin_empresa" | "orcamentista" | "engenheiro_fiscal" | "visualizador";
  isActive: boolean;
  mustChangePassword: boolean;
  preferredLanguage: "pt" | "en";
  lastLoginAt: string | null;
  createdAt: string;
};

export type CompanyUpdateInput = Partial<{
  name: string;
  nuit: string;
  address: string;
  province: string;
  district: string;
  phone: string;
  email: string;
  website: string;
  bankDetails: string;
  documentFooter: string;
  responsibleName: string;
  defaultCurrency: string;
  workingDaysPerMonth: number;
  workingHoursPerDay: number;
  emailNotificationPrefs: { workflow: boolean };
}>;

export type SubscriptionUpdateInput = {
  status?: "trial" | "activo" | "suspenso";
  plan?: string;
  expiresAt?: string | null;
  billingCycle?: "monthly" | "annual" | "custom" | "trial" | null;
  notes?: string | null;
  payment?: {
    amount: number;
    currency?: "MZN" | "USD";
    method?: "transferencia" | "mpesa" | "cash" | "cartao" | "outro";
    reference?: string;
    notes?: string;
    paidAt?: string;
    periodStart?: string;
    periodEnd?: string;
  };
};

export type PaymentCreateInput = {
  amount: number;
  currency?: "MZN" | "USD";
  method?: "transferencia" | "mpesa" | "cash" | "cartao" | "outro";
  reference?: string;
  notes?: string;
  paidAt?: string;
  periodStart?: string;
  periodEnd?: string;
  plan?: string;
  billingCycle?: "monthly" | "annual" | "custom" | "trial";
  extendExpires?: boolean;
};

export const companiesApi = {
  list: () => request<Company[]>("/companies"),
  create: (data: { name: string; adminName: string; adminEmail: string; adminPassword: string; defaultCurrency?: string }) =>
    request<{ company: Company }>("/companies", { method: "POST", body: JSON.stringify(data) }),
  updateSubscription: (companyId: string, data: SubscriptionUpdateInput) =>
    request<Subscription & { payment?: PlatformPayment | null }>(`/companies/${companyId}/subscription`, { method: "PUT", body: JSON.stringify(data) }),
  updateAdminSettings: (companyId: string, data: Partial<Pick<Company, "name" | "defaultCurrency" | "enabledModules" | "brandName" | "primaryColor" | "accentColor" | "defaultLanguage">>) =>
    request<Company>(`/admin/companies/${companyId}`, { method: "PATCH", body: JSON.stringify(data) }),
  listAdminUsers: (companyId?: string) => request<AdminCompanyUser[]>(`/admin/users${companyId ? `?companyId=${companyId}` : ""}`),
  createAdminUser: (companyId: string, data: { name: string; email: string; password: string; role: AdminCompanyUser["role"]; preferredLanguage: "pt" | "en" }) =>
    request<AdminCompanyUser>(`/admin/companies/${companyId}/users`, { method: "POST", body: JSON.stringify(data) }),
  updateAdminUser: (userId: string, data: Partial<Pick<AdminCompanyUser, "name" | "role" | "isActive" | "preferredLanguage">>) =>
    request<AdminCompanyUser>(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(data) }),
  resetAdminUserPassword: (userId: string, password: string) => request<{ ok: true }>(`/admin/users/${userId}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  listPayments: (companyId: string) => request<PlatformPayment[]>(`/admin/companies/${companyId}/payments`),
  createPayment: (companyId: string, data: PaymentCreateInput) =>
    request<PlatformPayment>(`/admin/companies/${companyId}/payments`, { method: "POST", body: JSON.stringify(data) }),
  getUsage: (companyId: string) => request<CompanyUsage>(`/admin/companies/${companyId}/usage`),
  getCredits: (companyId: string) =>
    request<{
      balances: { smartImportCredits: number; plantAnalysisCredits: number };
      ledger: Array<{
        id: string;
        kind: string;
        delta: number;
        packId: string | null;
        reason: string;
        note: string | null;
        amountMzn: string | null;
        createdAt: string;
      }>;
      summary: {
        planLabel?: string;
        usage?: {
          smartImportsUsed: number;
          plantAnalysesUsed: number;
          activeProjects: number;
          customCompositions: number;
        };
        smartImportsPerMonth?: number | null;
        plantAnalysesPerMonth?: number | null;
        maxActiveProjects?: number | null;
        customCompositions?: number | null;
        credits?: { smartImportCredits: number; plantAnalysisCredits: number };
      } | null;
    }>(`/admin/companies/${companyId}/credits`),
  grantCredits: (
    companyId: string,
    data: {
      packId?: string | null;
      smartImports?: number;
      plantAnalyses?: number;
      note?: string | null;
      amount?: number;
      method?: PaymentCreateInput["method"];
      reference?: string;
      recordPayment?: boolean;
    },
  ) =>
    request<{
      balances: { smartImportCredits: number; plantAnalysisCredits: number };
      payment: PlatformPayment | null;
    }>(`/admin/companies/${companyId}/credits`, { method: "POST", body: JSON.stringify(data) }),
  downloadBackup: async (companyId: string, fileNameHint?: string) => {
    const res = await fetch(`/api/admin/companies/${companyId}/backup`, { credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="?([^"]+)"?/i);
    a.download = match?.[1] ?? (fileNameHint ? `sigo-backup-full-${fileNameHint}.zip` : `sigo-backup-full-${companyId}.zip`);
    a.click();
    URL.revokeObjectURL(url);
  },

  getStorage: () =>
    request<{
      uploadsRoot: string;
      totalBytes: number;
      byCategory: Record<string, number>;
      folders: Array<{ name: string; bytes: number; fileCount: number }>;
      companies: Array<{
        companyId: string;
        companyName: string;
        bytes: number;
        byCategory: Record<string, number>;
        activeProjects: number;
        trashedProjects: number;
      }>;
      orphanBytes: number;
      attributedBytes: number;
      trashCount: number;
      eligibleForTrashCount: number;
      idleDays: number;
    }>("/admin/storage"),

  listTrash: () =>
    request<
      Array<{
        id: string;
        name: string;
        client: string | null;
        companyId: string;
        companyName: string;
        trashedAt: string;
        trashReason: string | null;
        filesPurgedAt: string | null;
        archivedAt: string | null;
        createdAt: string;
        plantCount: number;
      }>
    >("/admin/trash"),

  restoreTrash: (projectId: string) => request<{ ok: true }>(`/admin/trash/${projectId}/restore`, { method: "POST" }),

  permanentlyDeleteTrash: (projectId: string) =>
    request<{ ok: true; deletedFiles: number }>(`/admin/trash/${projectId}`, { method: "DELETE" }),

  runTrashCleanup: () =>
    request<{
      eligible: number;
      trashed: number;
      filesDeleted: number;
      bytesFreed: number;
      idleDays: number;
      errors: Array<{ projectId: string; error: string }>;
    }>("/admin/trash/run-cleanup", { method: "POST" }),

  me: () => request<{ company: Company; subscription: Subscription | null }>("/companies/me"),
  approvalMatrix: () => request<{ rules: Array<{ entityType: string; submitRoles: string[]; approveRoles: string[]; submitPermission: string | null; approvePermission: string | null; singleAdminException: boolean }>; source: string }>("/companies/me/approval-matrix"),
  updateMe: (data: CompanyUpdateInput) => request<Company>("/companies/me", { method: "PUT", body: JSON.stringify(data) }),
  enterCompany: (companyId: string) => request<CurrentUser>(`/admin/companies/${companyId}/enter`, { method: "POST" }),
  exitImpersonation: () => request<CurrentUser>("/admin/impersonation/exit", { method: "POST" }),
  uploadLogo: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/companies/me/logo", { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<Company>;
  },
  submitPaymentProof: async (data: {
    plan: string;
    billingCycle?: "monthly" | "annual";
    amount: number;
    currency?: string;
    method: string;
    reference?: string;
    notes?: string;
    file: File;
  }) => {
    const form = new FormData();
    form.append("plan", data.plan);
    if (data.billingCycle) form.append("billingCycle", data.billingCycle);
    form.append("amount", String(data.amount));
    form.append("currency", data.currency ?? "MZN");
    form.append("method", data.method);
    if (data.reference) form.append("reference", data.reference);
    if (data.notes) form.append("notes", data.notes);
    form.append("file", data.file);
    const res = await fetch("/api/companies/me/payment-proofs", { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.error ?? `Erro ${res.status}`);
    }
    return res.json() as Promise<PaymentProof>;
  },
  listMyPaymentProofs: () => request<PaymentProof[]>("/companies/me/payment-proofs"),
  listPendingPaymentProofs: (status?: "pendente" | "aprovado" | "rejeitado") =>
    request<PaymentProof[]>(`/admin/payment-proofs${status ? `?status=${status}` : ""}`),
  paymentProofFileUrl: (id: string) => `/api/admin/payment-proofs/${id}/file`,
  approvePaymentProof: (id: string, data?: { periodEnd?: string; notes?: string }) =>
    request<{ proof: PaymentProof; payment: PlatformPayment }>(`/admin/payment-proofs/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  rejectPaymentProof: (id: string, reason: string) =>
    request<PaymentProof>(`/admin/payment-proofs/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  getMailStatus: () => request<{ enabled: boolean }>("/admin/mail/status"),
  sendTestEmail: () => request<{ ok: true; sentTo: string }>("/admin/mail/test", { method: "POST" }),

  getMonitoringStatus: () => request<{ enabled: boolean }>("/admin/monitoring/status"),
  sendTestError: () => request<{ ok: true }>("/admin/monitoring/test", { method: "POST" }),

  submitLead: (data: { source: "plan_upgrade" | "credit_pack"; planOrPack?: string; notes?: string }) =>
    request<{ ok: true }>("/companies/me/leads", { method: "POST", body: JSON.stringify(data) }),
  listLeads: (status?: CommercialLead["status"]) => request<CommercialLead[]>(`/admin/leads${status ? `?status=${status}` : ""}`),
  updateLeadStatus: (id: string, status: CommercialLead["status"]) =>
    request<CommercialLead>(`/admin/leads/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  leadProofUrl: (id: string) => `/api/admin/leads/${id}/proof`,
};
